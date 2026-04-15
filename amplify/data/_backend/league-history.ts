import {
  BBXmlApiClient,
  type BBApiStandings,
  type BBXmlApiClientOptions,
} from "../../../lib/bbapi";
import type { Schema } from "../resource";
import { resolveBbAccessKey } from "./credentials";
import {
  getBbConnection,
  getLeagueHistoryBackfill,
  listLeagueHistoryStandingCachesByLeagueId,
  type BbConnectionRecord,
  type LeagueHistoryBackfillRecord,
  type LeagueHistoryStandingCacheRecord,
  upsertLeagueHistoryBackfill,
  upsertLeagueHistoryStandingCache,
} from "./repository";
import {
  buildExecutionName,
  startStateMachineExecution,
} from "./step-functions";
import {
  assertMaintenanceInactive,
  toMaintenanceAwareErrorMessage,
} from "./maintenance";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type LeagueHistoryAuditResult = ResolverResult<"getLeagueHistoryAudit">;
type LeagueHistoryResult = ResolverResult<"getLeagueHistory">;
type LeagueHistoryRow = LeagueHistoryResult["rows"][number];
type LeagueHistoryStatus = NonNullable<LeagueHistoryResult["status"]>;
type LeagueHistoryBackfillRefreshMode = NonNullable<
  NonNullable<Schema["submitLeagueHistoryBackfill"]["args"]>["refreshMode"]
>;
type SubmitLeagueHistoryBackfillResult =
  ResolverResult<"submitLeagueHistoryBackfill">;

type LeagueHistoryMessage = {
  leagueId: string;
  refreshMode?: LeagueHistoryBackfillRefreshMode | null;
  requestedAt: string;
  userId: string;
};

type CreateBbClient = (
  options: BBXmlApiClientOptions,
) => Pick<BBXmlApiClient, "getSeasons" | "getStandings">;

type SubmitDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: CreateBbClient;
  getBbConnection: typeof getBbConnection;
  getLeagueHistoryBackfill: typeof getLeagueHistoryBackfill;
  listLeagueHistoryStandingCachesByLeagueId: typeof listLeagueHistoryStandingCachesByLeagueId;
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: LeagueHistoryMessage,
  ) => Promise<string>;
  upsertLeagueHistoryBackfill: typeof upsertLeagueHistoryBackfill;
};

type GetDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: CreateBbClient;
  getBbConnection: typeof getBbConnection;
  getLeagueHistoryBackfill: typeof getLeagueHistoryBackfill;
  listLeagueHistoryStandingCachesByLeagueId: typeof listLeagueHistoryStandingCachesByLeagueId;
  resolveBbAccessKey: typeof resolveBbAccessKey;
};

type ProcessDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: CreateBbClient;
  getBbConnection: typeof getBbConnection;
  getLeagueHistoryBackfill: typeof getLeagueHistoryBackfill;
  listLeagueHistoryStandingCachesByLeagueId: typeof listLeagueHistoryStandingCachesByLeagueId;
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  upsertLeagueHistoryBackfill: typeof upsertLeagueHistoryBackfill;
  upsertLeagueHistoryStandingCache: typeof upsertLeagueHistoryStandingCache;
};

type SubmitDependencyOverrides = Partial<SubmitDependencies>;
type GetDependencyOverrides = Partial<GetDependencies>;
type ProcessDependencyOverrides = Partial<ProcessDependencies>;

type ResolvedLeagueRequest = {
  connection: BbConnectionRecord;
  leagueId: string;
  requestedLeagueId: string | null;
  userId: string;
};

type HistoricalSeasonSummary = {
  currentSeason: number | null;
  historicalSeasons: number[];
  storedHistoricalSeasons: number[];
};

const ACTIVE_BACKFILL_STATES = new Set([
  "FETCHING_STANDINGS",
  "QUEUED",
  "RESOLVING_SEASONS",
]);
const DEFAULT_LEAGUE_HISTORY_BACKFILL_REFRESH_MODE: LeagueHistoryBackfillRefreshMode =
  "MISSING_ONLY";

const defaultSubmitDependencies: SubmitDependencies = {
  assertMaintenanceInactive,
  createBbClient: (options) => new BBXmlApiClient(options),
  getBbConnection,
  getLeagueHistoryBackfill,
  listLeagueHistoryStandingCachesByLeagueId,
  now: () => new Date(),
  resolveBbAccessKey,
  startWorkflowExecution: async (stateMachineArn, executionName, message) => {
    return startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    });
  },
  upsertLeagueHistoryBackfill,
};

const defaultGetDependencies: GetDependencies = {
  assertMaintenanceInactive,
  createBbClient: (options) => new BBXmlApiClient(options),
  getBbConnection,
  getLeagueHistoryBackfill,
  listLeagueHistoryStandingCachesByLeagueId,
  resolveBbAccessKey,
};

const defaultProcessDependencies: ProcessDependencies = {
  assertMaintenanceInactive,
  createBbClient: (options) => new BBXmlApiClient(options),
  getBbConnection,
  getLeagueHistoryBackfill,
  listLeagueHistoryStandingCachesByLeagueId,
  now: () => new Date(),
  resolveBbAccessKey,
  upsertLeagueHistoryBackfill,
  upsertLeagueHistoryStandingCache,
};

export const __testing = {
  aggregateLeagueHistoryRows,
  collectLeagueHistoryNameCollisions,
  determineMissingHistoricalSeasons,
  determineHistoricalSeasonsToFetch,
  findLeagueHistoryNameMismatches,
  hasActiveLeagueHistoryBackfill,
  normalizeLeagueHistoryBackfillRefreshMode,
  normalizeLeagueHistoryTeamName,
  normalizeLeagueId,
  sortLeagueHistoryRows,
};

export async function submitLeagueHistoryBackfill(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    leagueId?: string | null;
    refreshMode?: LeagueHistoryBackfillRefreshMode | null;
    stateMachineArn: string;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<SubmitLeagueHistoryBackfillResult> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();
  const refreshMode = normalizeLeagueHistoryBackfillRefreshMode(
    args.refreshMode,
  );

  const request = await resolveLeagueRequest(
    args.env,
    args.identity,
    args.leagueId,
    {
      getBbConnection: deps.getBbConnection,
    },
  );
  const existingStatus = await deps.getLeagueHistoryBackfill(
    args.env,
    request.leagueId,
  );
  if (existingStatus && hasActiveLeagueHistoryBackfill(existingStatus)) {
    return toSubmitResult(existingStatus, false);
  }

  const historicalSeasonSummary = await summarizeHistoricalSeasons(
    args.env,
    request,
    {
      createBbClient: deps.createBbClient,
      listLeagueHistoryStandingCachesByLeagueId:
        deps.listLeagueHistoryStandingCachesByLeagueId,
      resolveBbAccessKey: deps.resolveBbAccessKey,
    },
  );
  const historicalSeasonsExpected =
    historicalSeasonSummary.historicalSeasons.length;
  const historicalSeasonsStored =
    historicalSeasonSummary.storedHistoricalSeasons.length;

  if (
    refreshMode === "MISSING_ONLY" &&
    historicalSeasonsExpected === historicalSeasonsStored
  ) {
    const completedAt = deps.now().toISOString();
    const completedStatus: LeagueHistoryBackfillRecord = {
      completedAt,
      error: null,
      historicalSeasonsExpected,
      historicalSeasonsStored,
      lastCompletedSeason:
        historicalSeasonSummary.historicalSeasons[
          historicalSeasonSummary.historicalSeasons.length - 1
        ] ?? null,
      leagueId: request.leagueId,
      leagueName:
        existingStatus?.leagueName ??
        (request.leagueId === request.connection.leagueId
          ? request.connection.leagueName
          : null),
      executionArn: existingStatus?.executionArn ?? null,
      requestedAt: existingStatus?.requestedAt ?? completedAt,
      startedAt: existingStatus?.startedAt ?? completedAt,
      status: "SUCCEEDED",
      updatedAt: completedAt,
    };
    await deps.upsertLeagueHistoryBackfill(args.env, completedStatus);
    return toSubmitResult(completedStatus, false);
  }

  const requestedAt = deps.now().toISOString();
  const queuedStatus: LeagueHistoryBackfillRecord = {
    completedAt: null,
    error: null,
    historicalSeasonsExpected,
    historicalSeasonsStored,
    lastCompletedSeason: existingStatus?.lastCompletedSeason ?? null,
    leagueId: request.leagueId,
    leagueName:
      existingStatus?.leagueName ??
      (request.leagueId === request.connection.leagueId
        ? request.connection.leagueName
        : null),
    executionArn: null,
    requestedAt,
    startedAt: null,
    status: "QUEUED",
    updatedAt: requestedAt,
  };

  await deps.upsertLeagueHistoryBackfill(args.env, queuedStatus);

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "league-history",
        `${request.leagueId}:${request.userId}:${requestedAt}`,
      ),
      {
        leagueId: request.leagueId,
        refreshMode,
        requestedAt,
        userId: request.userId,
      },
    );
    const runningStatus: LeagueHistoryBackfillRecord = {
      ...queuedStatus,
      executionArn,
    };
    await deps.upsertLeagueHistoryBackfill(args.env, runningStatus);
    return toSubmitResult(runningStatus, true);
  } catch (error) {
    const failedAt = deps.now().toISOString();
    const failedStatus: LeagueHistoryBackfillRecord = {
      ...queuedStatus,
      completedAt: failedAt,
      error: toErrorMessage(error),
      status: "FAILED",
      updatedAt: failedAt,
    };
    await deps.upsertLeagueHistoryBackfill(args.env, failedStatus);
    throw error;
  }
}

export async function getLeagueHistory(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    leagueId?: string | null;
  },
  dependencies: GetDependencyOverrides = defaultGetDependencies,
): Promise<LeagueHistoryResult> {
  const deps: GetDependencies = {
    ...defaultGetDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const request = await resolveLeagueRequest(
    args.env,
    args.identity,
    args.leagueId,
    {
      getBbConnection: deps.getBbConnection,
    },
  );
  const [status, cachedRows] = await Promise.all([
    deps.getLeagueHistoryBackfill(args.env, request.leagueId),
    listAllLeagueHistoryStandingCaches(
      args.env,
      request.leagueId,
      deps.listLeagueHistoryStandingCachesByLeagueId,
    ),
  ]);

  let liveStandings: BBApiStandings | null = null;
  let warning: string | null = null;
  try {
    const bb = await createLeagueHistoryBbClient(
      args.env,
      request.connection,
      request.userId,
      {
        createBbClient: deps.createBbClient,
        resolveBbAccessKey: deps.resolveBbAccessKey,
      },
    );
    liveStandings = await bb.getStandings(request.leagueId);
  } catch (error) {
    warning = toErrorMessage(error);
  }

  const liveRows =
    liveStandings === null
      ? []
      : standingsToHistoryRecords(liveStandings, request.leagueId);
  const mixedNameTeams = collectLeagueHistoryNameCollisions([
    ...cachedRows,
    ...liveRows,
  ]);
  const rows = sortLeagueHistoryRows(
    aggregateLeagueHistoryRows([...cachedRows, ...liveRows]),
  );
  const historicalSeasonsStored = countDistinctStoredSeasons(cachedRows);
  const leagueName =
    liveStandings?.league?.name ??
    status?.leagueName ??
    cachedRows.find((row) => row.leagueName)?.leagueName ??
    (request.leagueId === request.connection.leagueId
      ? request.connection.leagueName
      : null);

  return {
    league: {
      id: request.leagueId,
      name: leagueName,
    },
    requestedLeagueId: request.requestedLeagueId,
    rows,
    status: status ? toStatus(status) : null,
    summary: {
      currentSeason: liveStandings?.season ?? null,
      historicalSeasonsStored,
      totalTeams: rows.length,
    },
    warning: joinWarnings([
      warning,
      buildMixedNameLeagueHistoryWarning(mixedNameTeams),
    ]),
  };
}

export async function getLeagueHistoryAudit(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    includeLiveComparison?: boolean | null;
    leagueId?: string | null;
  },
  dependencies: GetDependencyOverrides = defaultGetDependencies,
): Promise<LeagueHistoryAuditResult> {
  const deps: GetDependencies = {
    ...defaultGetDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const request = await resolveLeagueRequest(
    args.env,
    args.identity,
    args.leagueId,
    {
      getBbConnection: deps.getBbConnection,
    },
  );
  const cachedRows = await listAllLeagueHistoryStandingCaches(
    args.env,
    request.leagueId,
    deps.listLeagueHistoryStandingCachesByLeagueId,
  );

  const includeLiveComparison = Boolean(args.includeLiveComparison);
  const mixedNameTeams = collectLeagueHistoryNameCollisions(cachedRows);
  let liveRows: LeagueHistoryStandingCacheRecord[] = [];
  let liveComparisonIncluded = false;
  let warning: string | null = null;
  let leagueName =
    cachedRows.find((row) => row.leagueName)?.leagueName ??
    (request.leagueId === request.connection.leagueId
      ? request.connection.leagueName
      : null);

  if (includeLiveComparison) {
    try {
      const bb = await createLeagueHistoryBbClient(
        args.env,
        request.connection,
        request.userId,
        {
          createBbClient: deps.createBbClient,
          resolveBbAccessKey: deps.resolveBbAccessKey,
        },
      );
      const liveHistory = await loadAllLeagueHistoryRows(request.leagueId, bb);
      leagueName = liveHistory.leagueName ?? leagueName;
      liveRows = liveHistory.rows;
      liveComparisonIncluded = true;
    } catch (error) {
      warning = toErrorMessage(error);
    }
  }

  return {
    cachedRows: sortLeagueHistoryRows(aggregateLeagueHistoryRows(cachedRows)),
    league: {
      id: request.leagueId,
      name: leagueName,
    },
    liveComparisonIncluded,
    liveRows: sortLeagueHistoryRows(aggregateLeagueHistoryRows(liveRows)),
    mixedNameTeams,
    nameMismatches: liveComparisonIncluded
      ? findLeagueHistoryNameMismatches(cachedRows, liveRows)
      : [],
    requestedLeagueId: request.requestedLeagueId,
    warning: joinWarnings([
      warning,
      buildMixedNameLeagueHistoryWarning(mixedNameTeams),
    ]),
  };
}

export async function processLeagueHistoryBackfill(
  args: {
    env: GraphqlEnv;
    message?: LeagueHistoryMessage;
    messageBody?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveLeagueHistoryMessage(args);
  const refreshMode = normalizeLeagueHistoryBackfillRefreshMode(
    message.refreshMode,
  );
  const connection = await deps.getBbConnection(args.env, message.userId);
  if (!connection) {
    throw new Error(
      "A connected BuzzerBeater account is required for league history backfill.",
    );
  }

  const now = deps.now().toISOString();
  const existingStatus = await deps.getLeagueHistoryBackfill(
    args.env,
    message.leagueId,
  );
  await deps.upsertLeagueHistoryBackfill(args.env, {
    completedAt: null,
    error: null,
    executionArn: existingStatus?.executionArn ?? null,
    historicalSeasonsExpected:
      existingStatus?.historicalSeasonsExpected ?? null,
    historicalSeasonsStored: existingStatus?.historicalSeasonsStored ?? null,
    lastCompletedSeason: existingStatus?.lastCompletedSeason ?? null,
    leagueId: message.leagueId,
    leagueName: existingStatus?.leagueName ?? null,
    requestedAt: existingStatus?.requestedAt ?? message.requestedAt,
    startedAt: existingStatus?.startedAt ?? now,
    status: "RESOLVING_SEASONS",
    updatedAt: now,
  });

  let historicalSeasonsExpected: number | null = null;
  let historicalSeasonsStored: number | null = null;
  let lastCompletedSeason: number | null =
    existingStatus?.lastCompletedSeason ?? null;
  let leagueName: string | null = existingStatus?.leagueName ?? null;

  try {
    await deps.assertMaintenanceInactive();

    const bb = await createLeagueHistoryBbClient(
      args.env,
      connection,
      message.userId,
      {
        createBbClient: deps.createBbClient,
        resolveBbAccessKey: deps.resolveBbAccessKey,
      },
    );
    await deps.assertMaintenanceInactive();

    const seasonsResponse = await bb.getSeasons();
    const availableSeasons = seasonsResponse.seasons
      .map((season) => season.id)
      .filter((season): season is number => season !== null)
      .sort((left, right) => left - right);
    const cachedRows = await listAllLeagueHistoryStandingCaches(
      args.env,
      message.leagueId,
      deps.listLeagueHistoryStandingCachesByLeagueId,
    );
    const currentSeason = availableSeasons.at(-1) ?? null;
    const storedHistoricalSeasonSet = new Set(
      cachedRows
        .map((row) => row.season)
        .filter((season) => currentSeason === null || season < currentSeason),
    );
    const historicalSeasons = availableSeasons.filter(
      (season) => currentSeason === null || season < currentSeason,
    );
    const seasonsToFetch = determineHistoricalSeasonsToFetch({
      cachedRows,
      currentSeason,
      refreshMode,
      seasons: availableSeasons,
    });
    historicalSeasonsExpected = historicalSeasons.length;
    historicalSeasonsStored = countDistinctStoredSeasons(cachedRows);

    if (!seasonsToFetch.length) {
      const completedAt = deps.now().toISOString();
      await deps.upsertLeagueHistoryBackfill(args.env, {
        completedAt,
        error: null,
        historicalSeasonsExpected,
        historicalSeasonsStored,
        lastCompletedSeason:
          historicalSeasons[historicalSeasons.length - 1] ??
          lastCompletedSeason,
        leagueId: message.leagueId,
        leagueName,
        executionArn: existingStatus?.executionArn ?? null,
        requestedAt: existingStatus?.requestedAt ?? message.requestedAt,
        startedAt: existingStatus?.startedAt ?? now,
        status: "SUCCEEDED",
        updatedAt: completedAt,
      });
      return;
    }

    for (const season of seasonsToFetch) {
      await deps.assertMaintenanceInactive();
      const standings = await bb.getStandings(message.leagueId, season);
      const seasonRows = standingsToHistoryRecords(standings, message.leagueId);
      leagueName = standings.league?.name ?? leagueName;

      for (const row of seasonRows) {
        await deps.upsertLeagueHistoryStandingCache(args.env, row);
      }

      storedHistoricalSeasonSet.add(season);
      historicalSeasonsStored = storedHistoricalSeasonSet.size;
      lastCompletedSeason = season;
      const updatedAt = deps.now().toISOString();
      await deps.upsertLeagueHistoryBackfill(args.env, {
        completedAt: null,
        error: null,
        historicalSeasonsExpected,
        historicalSeasonsStored,
        lastCompletedSeason,
        leagueId: message.leagueId,
        leagueName,
        executionArn: existingStatus?.executionArn ?? null,
        requestedAt: existingStatus?.requestedAt ?? message.requestedAt,
        startedAt: existingStatus?.startedAt ?? now,
        status: "FETCHING_STANDINGS",
        updatedAt,
      });
    }

    const completedAt = deps.now().toISOString();
    await deps.upsertLeagueHistoryBackfill(args.env, {
      completedAt,
      error: null,
      historicalSeasonsExpected,
      historicalSeasonsStored,
      lastCompletedSeason,
      leagueId: message.leagueId,
      leagueName,
      executionArn: existingStatus?.executionArn ?? null,
      requestedAt: existingStatus?.requestedAt ?? message.requestedAt,
      startedAt: existingStatus?.startedAt ?? now,
      status: "SUCCEEDED",
      updatedAt: completedAt,
    });
  } catch (error) {
    const failedAt = deps.now().toISOString();
    await deps.upsertLeagueHistoryBackfill(args.env, {
      completedAt: failedAt,
      error: toMaintenanceAwareErrorMessage(error),
      historicalSeasonsExpected,
      historicalSeasonsStored,
      lastCompletedSeason,
      leagueId: message.leagueId,
      leagueName,
      executionArn: existingStatus?.executionArn ?? null,
      requestedAt: existingStatus?.requestedAt ?? message.requestedAt,
      startedAt: existingStatus?.startedAt ?? now,
      status: "FAILED",
      updatedAt: failedAt,
    });
    throw error;
  }
}

async function summarizeHistoricalSeasons(
  env: GraphqlEnv,
  request: ResolvedLeagueRequest,
  dependencies: Pick<
    SubmitDependencies,
    | "createBbClient"
    | "listLeagueHistoryStandingCachesByLeagueId"
    | "resolveBbAccessKey"
  >,
): Promise<HistoricalSeasonSummary> {
  const bb = await createLeagueHistoryBbClient(
    env,
    request.connection,
    request.userId,
    {
      createBbClient: dependencies.createBbClient,
      resolveBbAccessKey: dependencies.resolveBbAccessKey,
    },
  );
  const [cachedRows, seasonsResponse] = await Promise.all([
    listAllLeagueHistoryStandingCaches(
      env,
      request.leagueId,
      dependencies.listLeagueHistoryStandingCachesByLeagueId,
    ),
    bb.getSeasons(),
  ]);
  const seasons = seasonsResponse.seasons
    .map((season) => season.id)
    .filter((season): season is number => season !== null)
    .sort((left, right) => left - right);
  const currentSeason = seasons.at(-1) ?? null;
  const historicalSeasons = seasons.filter(
    (season) => currentSeason === null || season < currentSeason,
  );

  return {
    currentSeason,
    historicalSeasons,
    storedHistoricalSeasons: Array.from(
      new Set(cachedRows.map((row) => row.season)),
    ).sort((left, right) => left - right),
  };
}

async function listAllLeagueHistoryStandingCaches(
  env: GraphqlEnv,
  leagueId: string,
  listFn: typeof listLeagueHistoryStandingCachesByLeagueId,
): Promise<LeagueHistoryStandingCacheRecord[]> {
  const rows: LeagueHistoryStandingCacheRecord[] = [];
  let nextToken: string | null = null;

  do {
    const page = await listFn(env, leagueId, {
      limit: 500,
      nextToken,
    });
    rows.push(...page.records);
    nextToken = page.nextToken;
  } while (nextToken);

  return rows;
}

async function resolveLeagueRequest(
  env: GraphqlEnv,
  identity: unknown,
  leagueId: string | null | undefined,
  dependencies: Pick<SubmitDependencies, "getBbConnection">,
): Promise<ResolvedLeagueRequest> {
  const userId = resolveUserId(identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const connection = await dependencies.getBbConnection(env, userId);
  if (!connection) {
    throw new Error(
      "Connect a BuzzerBeater account before loading league history.",
    );
  }

  const requestedLeagueId = normalizeLeagueId(leagueId);
  const effectiveLeagueId = requestedLeagueId ?? connection.leagueId ?? null;
  if (!effectiveLeagueId) {
    throw new Error("A league ID is required to load league history.");
  }

  return {
    connection,
    leagueId: effectiveLeagueId,
    requestedLeagueId,
    userId,
  };
}

async function createLeagueHistoryBbClient(
  env: GraphqlEnv,
  connection: BbConnectionRecord,
  userId: string,
  dependencies: Pick<
    SubmitDependencies,
    "createBbClient" | "resolveBbAccessKey"
  >,
): Promise<ReturnType<CreateBbClient>> {
  const accessKey = await dependencies.resolveBbAccessKey(env, userId);
  return dependencies.createBbClient({
    securityCode: accessKey,
    username: connection.bbLoginName,
  });
}

function toStatus(status: LeagueHistoryBackfillRecord): LeagueHistoryStatus {
  return {
    completedAt: status.completedAt ?? null,
    executionArn: status.executionArn ?? null,
    error: status.error ?? null,
    historicalSeasonsExpected: status.historicalSeasonsExpected ?? null,
    historicalSeasonsStored: status.historicalSeasonsStored ?? null,
    lastCompletedSeason: status.lastCompletedSeason ?? null,
    leagueId: status.leagueId,
    leagueName: status.leagueName ?? null,
    requestedAt: status.requestedAt,
    startedAt: status.startedAt ?? null,
    status: status.status,
    updatedAt: status.updatedAt,
  };
}

function toSubmitResult(
  status: LeagueHistoryBackfillRecord,
  queued: boolean,
): SubmitLeagueHistoryBackfillResult {
  return {
    executionArn: status.executionArn ?? null,
    leagueId: status.leagueId,
    leagueName: status.leagueName ?? null,
    queued,
    requestedAt: status.requestedAt,
    status: status.status,
  };
}

function standingsToHistoryRecords(
  standings: BBApiStandings,
  fallbackLeagueId: string,
): LeagueHistoryStandingCacheRecord[] {
  return standings.conferences.flatMap((conference) =>
    conference.teams.flatMap((team) => {
      if (!team.id || standings.season === null) {
        return [];
      }

      return [
        {
          conferenceIndex: conference.index,
          fetchedAt: standings.retrievedAt ?? null,
          isBot: team.isBot ?? null,
          leagueId: standings.league?.id ?? fallbackLeagueId,
          leagueName: standings.league?.name ?? null,
          losses: team.losses ?? null,
          pa: team.pa ?? null,
          pf: team.pf ?? null,
          season: standings.season,
          teamId: team.id,
          teamName: team.teamName ?? `Team ${team.id}`,
          wins: team.wins ?? null,
        },
      ];
    }),
  );
}

function countDistinctStoredSeasons(
  rows: readonly LeagueHistoryStandingCacheRecord[],
): number {
  return new Set(rows.map((row) => row.season)).size;
}

export function determineMissingHistoricalSeasons(args: {
  cachedRows: readonly LeagueHistoryStandingCacheRecord[];
  currentSeason: number | null;
  seasons: readonly number[];
}): number[] {
  const storedHistoricalSeasons = new Set(
    args.cachedRows
      .map((row) => row.season)
      .filter(
        (season) => args.currentSeason === null || season < args.currentSeason,
      ),
  );

  return args.seasons.filter(
    (season) =>
      (args.currentSeason === null || season < args.currentSeason) &&
      !storedHistoricalSeasons.has(season),
  );
}

export function determineHistoricalSeasonsToFetch(args: {
  cachedRows: readonly LeagueHistoryStandingCacheRecord[];
  currentSeason: number | null;
  refreshMode: LeagueHistoryBackfillRefreshMode;
  seasons: readonly number[];
}): number[] {
  if (args.refreshMode === "REFRESH_ALL_HISTORICAL") {
    return args.seasons.filter(
      (season) => args.currentSeason === null || season < args.currentSeason,
    );
  }

  return determineMissingHistoricalSeasons(args);
}

export function aggregateLeagueHistoryRows(
  rows: readonly LeagueHistoryStandingCacheRecord[],
): LeagueHistoryRow[] {
  const aggregated = new Map<
    string,
    {
      teamId: string;
      teamName: string;
      seasons: Set<number>;
      wins: number;
      losses: number;
      pf: number;
      pa: number;
    }
  >();

  for (const row of rows) {
    if (!row.teamId) {
      continue;
    }

    const identityKey = buildLeagueHistoryIdentityKey(row);
    const current = aggregated.get(identityKey) ?? {
      losses: 0,
      pa: 0,
      pf: 0,
      seasons: new Set<number>(),
      teamId: row.teamId,
      teamName: normalizeLeagueHistoryTeamName(row),
      wins: 0,
    };

    if (typeof row.season === "number") {
      current.seasons.add(row.season);
    }
    current.teamName = normalizeLeagueHistoryTeamName(row);
    current.wins += row.wins ?? 0;
    current.losses += row.losses ?? 0;
    current.pf += row.pf ?? 0;
    current.pa += row.pa ?? 0;
    aggregated.set(identityKey, current);
  }

  return Array.from(aggregated.values()).map((row) => {
    const games = row.wins + row.losses;
    const pointMargin = row.pf - row.pa;

    return {
      averageMargin: games > 0 ? pointMargin / games : 0,
      games,
      losses: row.losses,
      pa: row.pa,
      pf: row.pf,
      pointMargin,
      seasons: row.seasons.size,
      teamId: row.teamId,
      teamName: row.teamName,
      winPct: games > 0 ? row.wins / games : 0,
      wins: row.wins,
    };
  });
}

export function sortLeagueHistoryRows(
  rows: readonly LeagueHistoryRow[],
): LeagueHistoryRow[] {
  return [...rows].sort((left, right) => {
    if (right.wins !== left.wins) {
      return right.wins - left.wins;
    }
    if (right.winPct !== left.winPct) {
      return right.winPct - left.winPct;
    }
    if (right.pointMargin !== left.pointMargin) {
      return right.pointMargin - left.pointMargin;
    }
    const teamNameComparison = left.teamName.localeCompare(right.teamName);
    if (teamNameComparison !== 0) {
      return teamNameComparison;
    }
    return left.teamId.localeCompare(right.teamId);
  });
}

export function hasActiveLeagueHistoryBackfill(
  status: Pick<LeagueHistoryBackfillRecord, "status"> | null | undefined,
): boolean {
  return Boolean(status && ACTIVE_BACKFILL_STATES.has(status.status));
}

function parseQueueMessage(body: string): LeagueHistoryMessage {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const leagueId = normalizeLeagueId(parsed.leagueId);
  const refreshMode = normalizeLeagueHistoryBackfillRefreshMode(
    parsed.refreshMode,
  );
  const requestedAt = asOptionalString(parsed.requestedAt);
  const userId = asOptionalString(parsed.userId);

  if (!leagueId || !requestedAt || !userId) {
    throw new Error(
      "League history queue message must include leagueId, requestedAt, and userId.",
    );
  }

  return {
    leagueId,
    refreshMode,
    requestedAt,
    userId,
  };
}

function resolveLeagueHistoryMessage(args: {
  message?: LeagueHistoryMessage;
  messageBody?: string;
}): LeagueHistoryMessage {
  if (args.message) {
    return args.message;
  }
  if (!args.messageBody) {
    throw new Error("League history payload was not provided.");
  }
  return parseQueueMessage(args.messageBody);
}

export function normalizeLeagueId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveUserId(identity: unknown): string | null {
  const record =
    identity && typeof identity === "object" && !Array.isArray(identity)
      ? (identity as Identity)
      : null;
  return record?.sub ?? null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeLeagueHistoryBackfillRefreshMode(
  value: unknown,
): LeagueHistoryBackfillRefreshMode {
  return value === "REFRESH_ALL_HISTORICAL"
    ? value
    : DEFAULT_LEAGUE_HISTORY_BACKFILL_REFRESH_MODE;
}

export function normalizeLeagueHistoryTeamName(
  row: Pick<LeagueHistoryStandingCacheRecord, "teamId" | "teamName">,
): string {
  const normalizedTeamName =
    typeof row.teamName === "string" ? row.teamName.trim() : "";
  return normalizedTeamName.length > 0
    ? normalizedTeamName
    : `Team ${row.teamId}`;
}

export function collectLeagueHistoryNameCollisions(
  rows: readonly Pick<
    LeagueHistoryStandingCacheRecord,
    "season" | "teamId" | "teamName"
  >[],
): LeagueHistoryAuditResult["mixedNameTeams"] {
  const grouped = new Map<
    string,
    {
      firstSeason: number | null;
      lastSeason: number | null;
      rowCount: number;
      seasons: Set<number>;
      teamId: string;
      teamNames: Set<string>;
    }
  >();

  for (const row of rows) {
    if (!row.teamId) {
      continue;
    }

    const current = grouped.get(row.teamId) ?? {
      firstSeason: null,
      lastSeason: null,
      rowCount: 0,
      seasons: new Set<number>(),
      teamId: row.teamId,
      teamNames: new Set<string>(),
    };

    current.rowCount += 1;
    current.teamNames.add(normalizeLeagueHistoryTeamName(row));
    if (typeof row.season === "number") {
      current.seasons.add(row.season);
      current.firstSeason =
        current.firstSeason === null
          ? row.season
          : Math.min(current.firstSeason, row.season);
      current.lastSeason =
        current.lastSeason === null
          ? row.season
          : Math.max(current.lastSeason, row.season);
    }

    grouped.set(row.teamId, current);
  }

  return Array.from(grouped.values())
    .filter((row) => row.teamNames.size > 1)
    .map((row) => ({
      firstSeason: row.firstSeason,
      lastSeason: row.lastSeason,
      rowCount: row.rowCount,
      seasonCount: row.seasons.size,
      teamId: row.teamId,
      teamNames: Array.from(row.teamNames).sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => {
      if (right.seasonCount !== left.seasonCount) {
        return right.seasonCount - left.seasonCount;
      }
      return left.teamId.localeCompare(right.teamId);
    });
}

export function findLeagueHistoryNameMismatches(
  cachedRows: readonly LeagueHistoryStandingCacheRecord[],
  liveRows: readonly LeagueHistoryStandingCacheRecord[],
): LeagueHistoryAuditResult["nameMismatches"] {
  const liveNamesBySeasonTeam = new Map<string, string>();
  const mismatches = new Map<
    string,
    LeagueHistoryAuditResult["nameMismatches"][number]
  >();

  for (const row of liveRows) {
    const seasonTeamKey = buildLeagueHistorySeasonTeamKey(row);
    if (!seasonTeamKey) {
      continue;
    }
    liveNamesBySeasonTeam.set(
      seasonTeamKey,
      normalizeLeagueHistoryTeamName(row),
    );
  }

  for (const row of cachedRows) {
    const seasonTeamKey = buildLeagueHistorySeasonTeamKey(row);
    if (!seasonTeamKey) {
      continue;
    }

    const liveTeamName = liveNamesBySeasonTeam.get(seasonTeamKey);
    if (!liveTeamName) {
      continue;
    }

    const cachedTeamName = normalizeLeagueHistoryTeamName(row);
    if (cachedTeamName === liveTeamName) {
      continue;
    }

    mismatches.set(seasonTeamKey, {
      cachedTeamName,
      liveTeamName,
      season: row.season,
      teamId: row.teamId,
    });
  }

  return Array.from(mismatches.values()).sort((left, right) => {
    if (left.season !== right.season) {
      return left.season - right.season;
    }
    return left.teamId.localeCompare(right.teamId);
  });
}

async function loadAllLeagueHistoryRows(
  leagueId: string,
  bb: Pick<BBXmlApiClient, "getSeasons" | "getStandings">,
): Promise<{
  leagueName: string | null;
  rows: LeagueHistoryStandingCacheRecord[];
}> {
  const seasonsResponse = await bb.getSeasons();
  const seasons = seasonsResponse.seasons
    .map((season) => season.id)
    .filter((season): season is number => season !== null)
    .sort((left, right) => left - right);
  const rows: LeagueHistoryStandingCacheRecord[] = [];
  let leagueName: string | null = null;

  for (const season of seasons) {
    const standings = await bb.getStandings(leagueId, season);
    leagueName = standings.league?.name ?? leagueName;
    rows.push(...standingsToHistoryRecords(standings, leagueId));
  }

  return {
    leagueName,
    rows,
  };
}

function buildLeagueHistoryIdentityKey(
  row: Pick<LeagueHistoryStandingCacheRecord, "teamId" | "teamName">,
): string {
  return `${row.teamId}::${normalizeLeagueHistoryTeamName(row)}`;
}

function buildLeagueHistorySeasonTeamKey(
  row: Pick<LeagueHistoryStandingCacheRecord, "season" | "teamId">,
): string | null {
  return typeof row.season === "number" && row.teamId
    ? `${row.season}::${row.teamId}`
    : null;
}

function buildMixedNameLeagueHistoryWarning(
  mixedNameTeams: readonly LeagueHistoryAuditResult["mixedNameTeams"][number][],
): string | null {
  if (!mixedNameTeams.length) {
    return null;
  }

  const affectedTeamCount = mixedNameTeams.length;
  return affectedTeamCount === 1
    ? "Historical rows for 1 team ID include multiple name eras and are split into separate rows in this table."
    : `Historical rows for ${affectedTeamCount} team IDs include multiple name eras and are split into separate rows in this table.`;
}

function joinWarnings(
  warnings: readonly (string | null | undefined)[],
): string | null {
  const normalized = warnings
    .map((warning) => warning?.trim())
    .filter((warning): warning is string => Boolean(warning));

  return normalized.length > 0 ? normalized.join(" ") : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
