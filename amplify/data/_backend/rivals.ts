import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

import {
  BBXmlApiClient,
  type BBApiScheduleMatch,
  type BBXmlApiClientOptions,
} from "../../../lib/bbapi";
import type { Schema } from "../resource";
import { resolveBbAccessKey } from "./credentials";
import { assertMaintenanceInactive } from "./maintenance";
import {
  deleteRivalryMatchFact,
  getBbConnection,
  getRivalsBackfill,
  getRivalsWorkspaceCache,
  listRivalryMatchFactsByUserAndTeamId,
  type BbConnectionRecord,
  type RivalryMatchFactRecord,
  type RivalsBackfillRecord,
  upsertRivalryMatchFact,
  upsertRivalsBackfill,
} from "./repository";
import {
  buildExecutionName,
  startStateMachineExecution,
} from "./step-functions";
import { resolveUserId } from "./workspace-connection";

type GraphqlEnv = Record<string, string | undefined>;

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type RivalsWorkspaceResult = ResolverResult<"getRivalsWorkspace">;
type RivalsWorkspaceSummary = RivalsWorkspaceResult["summary"];
type RivalsCompetitionOption = RivalsWorkspaceResult["competitionOptions"][number];
type RivalsSeasonRange = RivalsWorkspaceResult["seasonRange"];
type RivalryRow = RivalsWorkspaceResult["rows"][number];
type RivalryDetail = NonNullable<RivalsWorkspaceResult["selectedRivalry"]>;
type RivalryMatch = NonNullable<RivalryDetail["matches"]>[number];
type RivalryCompetitionBreakdownRow =
  RivalryDetail["competitionBreakdown"][number];
type RivalrySeasonBreakdownRow = RivalryDetail["seasonBreakdown"][number];
type RivalsBackfillStatus = NonNullable<RivalsWorkspaceResult["status"]>;
type SubmitRivalsBackfillResult =
  ResolverResult<"submitRivalsBackfill">;

type CreateBbClient = (
  options: BBXmlApiClientOptions,
) => Pick<BBXmlApiClient, "getSchedule" | "getSeasons" | "login">;

type ScheduleFetchResult =
  | {
      matches: BBApiScheduleMatch[];
      season: number;
    }
  | {
      error: string;
      season: number;
    };

type RivalsBackfillMessage = {
  requestedAt: string;
  teamId: string;
  userId: string;
};

type RivalsWorkspaceFiltersInput = {
  competitionKeys?: readonly string[] | null;
  endSeason?: number | null;
  outcomes?: readonly string[] | null;
  selectedOpponentId?: string | null;
  startSeason?: number | null;
  tvScopes?: readonly string[] | null;
  venues?: readonly string[] | null;
};

type ResolvedRivalsFilters = {
  competitionKeys: string[];
  endSeason: number | null;
  outcomes: Array<RivalryMatch["outcome"]>;
  selectedOpponentId: string | null;
  startSeason: number | null;
  tvScopes: TvScope[];
  venues: Array<RivalryMatch["venue"]>;
};

type NormalizedCompetition = {
  competitionKey: CompetitionKey;
  competitionLabel: RivalryMatch["competitionLabel"];
  isTvGame: boolean;
  stageKey: RivalryMatch["stageKey"];
  stageLabel: RivalryMatch["stageLabel"];
};

type BuiltRivalsDataset = {
  failedSeasons: number[];
  generatedAt: string;
  matches: RivalryMatch[];
  seasonsScanned: number;
  summary: RivalsWorkspaceSummary;
  syncedAt: string | null;
  team: {
    shortName: string | null;
    teamId: string;
    teamName: string | null;
  };
  warning: string | null;
};

type LegacyRivalsWorkspaceCache =
  | {
      generatedAt?: string | null;
      matchesJson?: unknown;
      shortName?: string | null;
      summaryJson?: unknown;
      syncedAt?: string | null;
      teamId?: string | null;
      teamName?: string | null;
      warning?: string | null;
    }
  | null;

type RivalsMatchesCacheEncoding = "BROTLI_BASE64_V1";

const RIVALS_MATCHES_CACHE_ENCODING: RivalsMatchesCacheEncoding =
  "BROTLI_BASE64_V1";
const LEGACY_RIVALS_MATCHES_CACHE_ENCODING = "brotli-base64-v1";

type RivalsMatchesCacheEnvelope = {
  encoding: RivalsMatchesCacheEncoding;
  payload: string;
};

type TvScope = "TV" | "NON_TV";

type ResolvedRivalsContext = {
  connection: BbConnectionRecord;
  teamId: string;
  teamName: string | null;
  userId: string;
};

type SubmitDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  getBbConnection: typeof getBbConnection;
  getRivalsBackfill: typeof getRivalsBackfill;
  now: () => Date;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: RivalsBackfillMessage,
  ) => Promise<string>;
  upsertRivalsBackfill: typeof upsertRivalsBackfill;
};

type GetDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  getBbConnection: typeof getBbConnection;
  getRivalsBackfill: typeof getRivalsBackfill;
  getRivalsWorkspaceCache: typeof getRivalsWorkspaceCache;
  listRivalryMatchFactsByUserAndTeamId: typeof listRivalryMatchFactsByUserAndTeamId;
  now: () => Date;
};

type ProcessDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: CreateBbClient;
  deleteRivalryMatchFact: typeof deleteRivalryMatchFact;
  getBbConnection: typeof getBbConnection;
  getRivalsBackfill: typeof getRivalsBackfill;
  listRivalryMatchFactsByUserAndTeamId: typeof listRivalryMatchFactsByUserAndTeamId;
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  upsertRivalryMatchFact: typeof upsertRivalryMatchFact;
  upsertRivalsBackfill: typeof upsertRivalsBackfill;
};

type SyncRivalryFactsDependencies = {
  upsertRivalryMatchFact: typeof upsertRivalryMatchFact;
};

type SubmitDependencyOverrides = Partial<SubmitDependencies>;
type GetDependencyOverrides = Partial<GetDependencies>;
type ProcessDependencyOverrides = Partial<ProcessDependencies>;
type SyncRivalryFactsDependencyOverrides = Partial<SyncRivalryFactsDependencies>;

const ACTIVE_BACKFILL_STATES = new Set([
  "BUILDING_DATASET",
  "FETCHING_SCHEDULES",
  "FETCHING_SEASONS",
  "QUEUED",
]);
const DEFAULT_FETCH_CONCURRENCY = 4;
const FACT_DELETE_CONCURRENCY = 20;
const FACT_UPSERT_CONCURRENCY = 20;
const DEFAULT_OUTCOMES: Array<RivalryMatch["outcome"]> = ["WIN", "LOSS"];
const DEFAULT_TV_SCOPES: TvScope[] = ["TV", "NON_TV"];
const DEFAULT_VENUES: Array<RivalryMatch["venue"]> = ["HOME", "ROAD"];
const competitionOrder = [
  "LEAGUE_REGULAR_SEASON",
  "PLAYOFFS",
  "CUP",
  "SCRIMMAGE",
  "PRIVATE_LEAGUE",
  "BUZZERBEATER_BEST",
  "BUZZERBEATER_MADNESS",
  "OTHER",
] as const;
type CompetitionKey = (typeof competitionOrder)[number];

const defaultSubmitDependencies: SubmitDependencies = {
  assertMaintenanceInactive,
  getBbConnection,
  getRivalsBackfill,
  now: () => new Date(),
  startWorkflowExecution: async (stateMachineArn, executionName, message) =>
    startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    }),
  upsertRivalsBackfill,
};

const defaultGetDependencies: GetDependencies = {
  assertMaintenanceInactive,
  getBbConnection,
  getRivalsBackfill,
  getRivalsWorkspaceCache,
  listRivalryMatchFactsByUserAndTeamId,
  now: () => new Date(),
};

const defaultProcessDependencies: ProcessDependencies = {
  assertMaintenanceInactive,
  createBbClient: (options) => new BBXmlApiClient(options),
  deleteRivalryMatchFact,
  getBbConnection,
  getRivalsBackfill,
  listRivalryMatchFactsByUserAndTeamId,
  now: () => new Date(),
  resolveBbAccessKey,
  upsertRivalryMatchFact,
  upsertRivalsBackfill,
};

const defaultSyncRivalryFactsDependencies: SyncRivalryFactsDependencies = {
  upsertRivalryMatchFact,
};

export const __testing = {
  buildCompetitionBreakdown,
  buildRivalryMatch,
  compactNullableStringArray,
  buildRivalryRows,
  buildSeasonBreakdown,
  buildWorkspaceFromMatches,
  classifyScheduleMatchType,
  decodeCachedRivalryMatches,
  encodeCachedRivalryMatches,
  filterRivalryMatches,
  formatStageToken,
  hasActiveRivalsBackfill,
  matchIncludesTeam,
  normalizeSeasonBound,
  readFailedSeasons,
  resolveWorkspaceFilters,
};

export async function getRivalsWorkspace(
  args: {
    competitionKeys?: readonly string[] | null;
    endSeason?: number | null;
    env: GraphqlEnv;
    identity: unknown;
    outcomes?: readonly string[] | null;
    selectedOpponentId?: string | null;
    startSeason?: number | null;
    tvScopes?: readonly string[] | null;
    venues?: readonly string[] | null;
  },
  dependencies: GetDependencyOverrides = defaultGetDependencies,
): Promise<RivalsWorkspaceResult> {
  const deps: GetDependencies = {
    ...defaultGetDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const context = await resolveRivalsContext(args.env, args.identity, {
    getBbConnection: deps.getBbConnection,
  });
  const [facts, cache, status] = await Promise.all([
    deps.listRivalryMatchFactsByUserAndTeamId(
      args.env,
      context.userId,
      context.teamId,
    ),
    deps.getRivalsWorkspaceCache(args.env, context.userId, context.teamId),
    deps.getRivalsBackfill(args.env, context.userId, context.teamId),
  ]);

  const filters = toFilterInput(args);
  logRivalsInfo("getRivalsWorkspace.loaded", {
    factCount: facts.length,
    filters,
    hasLegacyCache: Boolean(cache),
    selectedOpponentId: filters.selectedOpponentId ?? null,
    teamId: context.teamId,
    userId: context.userId,
  });

  if (facts.length > 0) {
    return buildWorkspaceFromMatches({
      filters,
      generatedAt:
        context.connection.lastSyncAt ??
        status?.generatedAt ??
        deps.now().toISOString(),
      matches: facts.map(rivalryMatchFactToMatch),
      status,
      summaryOverride: null,
      syncedAt: context.connection.lastSyncAt ?? null,
      team: {
        shortName: context.connection.shortName ?? null,
        teamId: context.connection.teamId ?? null,
        teamName: context.connection.teamName ?? null,
      },
      warning: buildWarning(readFailedSeasons(status)),
    });
  }

  return buildWorkspaceFromLegacyCache({
    cache,
    connection: context.connection,
    filters,
    generatedAt: deps.now().toISOString(),
    status,
  });
}

export async function submitRivalsBackfill(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    stateMachineArn: string;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<SubmitRivalsBackfillResult> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const context = await resolveRivalsContext(args.env, args.identity, {
    getBbConnection: deps.getBbConnection,
  });
  const existingStatus = await deps.getRivalsBackfill(
    args.env,
    context.userId,
    context.teamId,
  );
  if (existingStatus && hasActiveRivalsBackfill(existingStatus)) {
    return toSubmitResult(existingStatus, false);
  }

  const requestedAt = deps.now().toISOString();
  const queuedStatus: RivalsBackfillRecord = {
    completedAt: null,
    error: null,
    executionArn: null,
    failedSeasons: existingStatus?.failedSeasons ?? [],
    generatedAt: existingStatus?.generatedAt ?? null,
    requestedAt,
    seasonsScanned: existingStatus?.seasonsScanned ?? null,
    startedAt: null,
    status: "QUEUED",
    teamId: context.teamId,
    teamName: context.teamName,
    totalCompletedGames: existingStatus?.totalCompletedGames ?? null,
    totalOpponents: existingStatus?.totalOpponents ?? null,
    updatedAt: requestedAt,
    userId: context.userId,
  };
  await deps.upsertRivalsBackfill(args.env, queuedStatus);

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "rivals",
        `${context.teamId}:${context.userId}:${requestedAt}`,
      ),
      {
        requestedAt,
        teamId: context.teamId,
        userId: context.userId,
      },
    );
    const runningStatus: RivalsBackfillRecord = {
      ...queuedStatus,
      executionArn,
    };
    await deps.upsertRivalsBackfill(args.env, runningStatus);
    return toSubmitResult(runningStatus, true);
  } catch (error) {
    const failedAt = deps.now().toISOString();
    const failedStatus: RivalsBackfillRecord = {
      ...queuedStatus,
      completedAt: failedAt,
      error: toErrorMessage(error),
      status: "FAILED",
      updatedAt: failedAt,
    };
    await deps.upsertRivalsBackfill(args.env, failedStatus);
    throw error;
  }
}

export async function processRivalsBackfill(
  args: {
    env: GraphqlEnv;
    message: RivalsBackfillMessage;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const connection = await deps.getBbConnection(args.env, args.message.userId);
  if (!connection?.bbLoginName) {
    throw new Error(
      "A connected BuzzerBeater account is required for rivals backfill.",
    );
  }

  const currentStatus = await deps.getRivalsBackfill(
    args.env,
    args.message.userId,
    args.message.teamId,
  );
  if (currentStatus && currentStatus.requestedAt !== args.message.requestedAt) {
    return;
  }

  const startedAt = deps.now().toISOString();
  await deps.upsertRivalsBackfill(args.env, {
    completedAt: null,
    error: null,
    executionArn: currentStatus?.executionArn ?? null,
    failedSeasons: currentStatus?.failedSeasons ?? [],
    generatedAt: currentStatus?.generatedAt ?? null,
    requestedAt: args.message.requestedAt,
    seasonsScanned: currentStatus?.seasonsScanned ?? null,
    startedAt,
    status: "FETCHING_SEASONS",
    teamId: args.message.teamId,
    teamName: connection.teamName ?? null,
    totalCompletedGames: currentStatus?.totalCompletedGames ?? null,
    totalOpponents: currentStatus?.totalOpponents ?? null,
    updatedAt: startedAt,
    userId: args.message.userId,
  });

  try {
    const accessKey = await deps.resolveBbAccessKey(
      args.env,
      args.message.userId,
    );
    const bbClient = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });
    await bbClient.login();

    const seasonsResponse = await bbClient.getSeasons();
    const seasons = seasonsResponse.seasons
      .map((season) => season.id)
      .filter((seasonId): seasonId is number => Number.isInteger(seasonId))
      .sort((left, right) => left - right);

    logRivalsInfo("processRivalsBackfill.seasons", {
      seasonCount: seasons.length,
      teamId: args.message.teamId,
      userId: args.message.userId,
    });

    const scheduleStartedAt = deps.now().toISOString();
    await deps.upsertRivalsBackfill(args.env, {
      completedAt: null,
      error: null,
      executionArn: currentStatus?.executionArn ?? null,
      failedSeasons: currentStatus?.failedSeasons ?? [],
      generatedAt: currentStatus?.generatedAt ?? null,
      requestedAt: args.message.requestedAt,
      seasonsScanned: seasons.length,
      startedAt,
      status: "FETCHING_SCHEDULES",
      teamId: args.message.teamId,
      teamName: connection.teamName ?? null,
      totalCompletedGames: currentStatus?.totalCompletedGames ?? null,
      totalOpponents: currentStatus?.totalOpponents ?? null,
      updatedAt: scheduleStartedAt,
      userId: args.message.userId,
    });

    const scheduleResults = await mapWithConcurrency(
      seasons,
      DEFAULT_FETCH_CONCURRENCY,
      async (season): Promise<ScheduleFetchResult> => {
        try {
          const schedule = await bbClient.getSchedule(args.message.teamId, season);
          return {
            matches: schedule.matches,
            season,
          };
        } catch (error) {
          return {
            error: toErrorMessage(error),
            season,
          };
        }
      },
    );

    const buildStartedAt = deps.now().toISOString();
    await deps.upsertRivalsBackfill(args.env, {
      completedAt: null,
      error: null,
      executionArn: currentStatus?.executionArn ?? null,
      failedSeasons: currentStatus?.failedSeasons ?? [],
      generatedAt: currentStatus?.generatedAt ?? null,
      requestedAt: args.message.requestedAt,
      seasonsScanned: seasons.length,
      startedAt,
      status: "BUILDING_DATASET",
      teamId: args.message.teamId,
      teamName: connection.teamName ?? null,
      totalCompletedGames: currentStatus?.totalCompletedGames ?? null,
      totalOpponents: currentStatus?.totalOpponents ?? null,
      updatedAt: buildStartedAt,
      userId: args.message.userId,
    });

    const builtDataset = buildRivalsDataset({
      generatedAt: deps.now().toISOString(),
      scheduleResults,
      seasons,
      shortName: connection.shortName ?? null,
      syncedAt: connection.lastSyncAt ?? null,
      teamId: args.message.teamId,
      teamName: connection.teamName ?? null,
    });

    const existingFacts = await deps.listRivalryMatchFactsByUserAndTeamId(
      args.env,
      args.message.userId,
      args.message.teamId,
    );
    const nextFacts = builtDataset.matches.map((match) =>
      rivalryMatchToFactRecord(args.message.userId, args.message.teamId, match),
    );
    const nextMatchIds = new Set(nextFacts.map((fact) => fact.matchId));
    const staleFacts = existingFacts.filter(
      (fact) => !nextMatchIds.has(fact.matchId),
    );

    await mapWithConcurrency(
      nextFacts,
      FACT_UPSERT_CONCURRENCY,
      async (fact) => {
        await deps.upsertRivalryMatchFact(args.env, fact);
      },
    );
    await mapWithConcurrency(
      staleFacts,
      FACT_DELETE_CONCURRENCY,
      async (fact) => {
        await deps.deleteRivalryMatchFact(args.env, {
          matchId: fact.matchId,
          teamId: fact.teamId,
          userId: fact.userId,
        });
      },
    );

    logRivalsInfo("processRivalsBackfill.persisted_facts", {
      deletedFactCount: staleFacts.length,
      failedSeasonCount: builtDataset.failedSeasons.length,
      factCount: nextFacts.length,
      selectedTeamId: args.message.teamId,
      userId: args.message.userId,
    });

    const completedAt = deps.now().toISOString();
    await deps.upsertRivalsBackfill(args.env, {
      completedAt,
      error: null,
      executionArn: currentStatus?.executionArn ?? null,
      failedSeasons: builtDataset.failedSeasons,
      generatedAt: builtDataset.generatedAt,
      requestedAt: args.message.requestedAt,
      seasonsScanned: builtDataset.seasonsScanned,
      startedAt,
      status: "SUCCEEDED",
      teamId: args.message.teamId,
      teamName: builtDataset.team.teamName ?? null,
      totalCompletedGames: builtDataset.summary.totalCompletedGames,
      totalOpponents: builtDataset.summary.totalOpponents,
      updatedAt: completedAt,
      userId: args.message.userId,
    });
  } catch (error) {
    const failedAt = deps.now().toISOString();
    await deps.upsertRivalsBackfill(args.env, {
      completedAt: failedAt,
      error: toErrorMessage(error),
      executionArn: currentStatus?.executionArn ?? null,
      failedSeasons: currentStatus?.failedSeasons ?? [],
      generatedAt: currentStatus?.generatedAt ?? null,
      requestedAt: args.message.requestedAt,
      seasonsScanned: currentStatus?.seasonsScanned ?? null,
      startedAt: currentStatus?.startedAt ?? startedAt,
      status: "FAILED",
      teamId: args.message.teamId,
      teamName: connection.teamName ?? null,
      totalCompletedGames: currentStatus?.totalCompletedGames ?? null,
      totalOpponents: currentStatus?.totalOpponents ?? null,
      updatedAt: failedAt,
      userId: args.message.userId,
    });
    throw error;
  }
}

export async function syncRivalryMatchFactsFromSchedule(args: {
  env: GraphqlEnv;
  matches: readonly BBApiScheduleMatch[];
  season: number | null | undefined;
  teamId: string;
  userId: string;
}, dependencies: SyncRivalryFactsDependencyOverrides = defaultSyncRivalryFactsDependencies): Promise<number> {
  const deps: SyncRivalryFactsDependencies = {
    ...defaultSyncRivalryFactsDependencies,
    ...dependencies,
  };
  if (!isIntegerNumber(args.season)) {
    return 0;
  }
  const season = args.season;

  const rivalryMatchesById = new Map<string, RivalryMatch>();
  for (const match of args.matches) {
    const rivalryMatch = buildRivalryMatch({
      match,
      season,
      teamId: args.teamId,
    });
    if (!rivalryMatch) {
      continue;
    }
    rivalryMatchesById.set(rivalryMatch.matchId, rivalryMatch);
  }

  const facts = Array.from(rivalryMatchesById.values()).map((match) =>
    rivalryMatchToFactRecord(args.userId, args.teamId, match),
  );
  await mapWithConcurrency(facts, FACT_UPSERT_CONCURRENCY, async (fact) => {
    await deps.upsertRivalryMatchFact(args.env, fact);
  });

  logRivalsInfo("syncRivalryMatchFactsFromSchedule.upserted", {
    factCount: facts.length,
    season: args.season,
    teamId: args.teamId,
    userId: args.userId,
  });

  return facts.length;
}

function buildRivalsDataset(args: {
  generatedAt: string;
  scheduleResults: readonly ScheduleFetchResult[];
  seasons: readonly number[];
  shortName: string | null;
  syncedAt: string | null;
  teamId: string;
  teamName: string | null;
}): BuiltRivalsDataset {
  const rivalryMatchesById = new Map<string, RivalryMatch>();
  const failedSeasons: number[] = [];

  for (const result of args.scheduleResults) {
    if ("error" in result) {
      failedSeasons.push(result.season);
      continue;
    }

    for (const match of result.matches) {
      const rivalryMatch = buildRivalryMatch({
        match,
        season: result.season,
        teamId: args.teamId,
      });
      if (!rivalryMatch) {
        continue;
      }

      rivalryMatchesById.set(rivalryMatch.matchId, rivalryMatch);
    }
  }

  const matches = Array.from(rivalryMatchesById.values()).sort((left, right) =>
    compareTimestamps(right.startTime, left.startTime),
  );
  const summary = buildSummaryFromMatches(matches, {
    failedSeasons,
    seasonsScanned: args.seasons.length,
  });

  return {
    failedSeasons,
    generatedAt: args.generatedAt,
    matches,
    seasonsScanned: args.seasons.length,
    summary,
    syncedAt: args.syncedAt ?? null,
    team: {
      shortName: args.shortName,
      teamId: args.teamId,
      teamName: args.teamName,
    },
    warning: buildWarning(failedSeasons),
  };
}

function buildWorkspaceFromLegacyCache(args: {
  cache: LegacyRivalsWorkspaceCache;
  connection: BbConnectionRecord;
  filters: RivalsWorkspaceFiltersInput;
  generatedAt: string;
  status: RivalsBackfillRecord | null;
}): RivalsWorkspaceResult {
  const cachedMatches = decodeCachedRivalryMatches(args.cache?.matchesJson);
  const cachedSummary = isRivalsWorkspaceSummary(args.cache?.summaryJson)
    ? args.cache.summaryJson
    : buildEmptySummary();
  const teamId = args.connection.teamId ?? args.cache?.teamId ?? null;
  const teamName = args.cache?.teamName ?? args.connection.teamName ?? null;
  const shortName = args.cache?.shortName ?? args.connection.shortName ?? null;

  return buildWorkspaceFromMatches({
    filters: args.filters,
    generatedAt: args.cache?.generatedAt ?? args.generatedAt,
    matches: cachedMatches,
    status: args.status,
    summaryOverride: cachedSummary,
    syncedAt: args.cache?.syncedAt ?? args.connection.lastSyncAt ?? null,
    team: {
      shortName,
      teamId,
      teamName,
    },
    warning: args.cache?.warning ?? null,
  });
}

function buildWorkspaceFromMatches(args: {
  filters: RivalsWorkspaceFiltersInput;
  generatedAt: string;
  matches: readonly RivalryMatch[];
  status: RivalsBackfillRecord | null;
  summaryOverride: RivalsWorkspaceSummary | null;
  syncedAt: string | null;
  team: {
    shortName: string | null;
    teamId: string | null;
    teamName: string | null;
  };
  warning: string | null;
}): RivalsWorkspaceResult {
  const competitionOptions = buildCompetitionOptions(args.matches);
  const availableSeasons = buildAvailableSeasons(args.matches);
  const filters = resolveWorkspaceFilters({
    availableCompetitionKeys: competitionOptions.map((option) => option.key),
    availableSeasons,
    requested: args.filters,
  });
  const filteredMatches = filterRivalryMatches(args.matches, filters);
  const rows = sortRivalryRowsForSelection(buildRivalryRows(filteredMatches));
  const selectedOpponentId = resolveSelectedOpponentId(
    filters.selectedOpponentId,
    rows,
  );
  const selectedRow =
    rows.find((row) => row.opponentTeamId === selectedOpponentId) ?? null;
  const selectedMatches = selectedRow
    ? filteredMatches
        .filter((match) => match.opponentTeamId === selectedRow.opponentTeamId)
        .sort((left, right) => compareTimestamps(right.startTime, left.startTime))
    : [];

  return {
    competitionOptions,
    generatedAt: args.generatedAt,
    rows,
    seasonRange: buildSeasonRange(availableSeasons, filters),
    selectedOpponentId: selectedOpponentId ?? null,
    selectedRivalry: selectedRow
      ? {
          competitionBreakdown: buildCompetitionBreakdown(selectedMatches),
          matches: selectedMatches,
          row: selectedRow,
          seasonBreakdown: buildSeasonBreakdown(selectedMatches),
        }
      : null,
    status: args.status ? toStatus(args.status) : null,
    summary:
      args.summaryOverride ??
      buildSummaryFromMatches(args.matches, {
        failedSeasons: readFailedSeasons(args.status),
        seasonsScanned: args.status?.seasonsScanned ?? null,
      }),
    syncedAt: args.syncedAt ?? null,
    team: args.team,
    warning: resolveWorkspaceWarning(args.warning, args.status, args.matches.length),
  };
}

function buildCompetitionOptions(
  matches: readonly RivalryMatch[],
): RivalsCompetitionOption[] {
  const options = new Map<
    string,
    { count: number; label: string }
  >();

  for (const match of matches) {
    const current = options.get(match.competitionKey);
    if (current) {
      current.count += 1;
      continue;
    }

    options.set(match.competitionKey, {
      count: 1,
      label: resolveCompetitionLabel(
        match.competitionKey,
        match.competitionLabel,
      ),
    });
  }

  return Array.from(options.entries())
    .sort((left, right) => compareCompetition(left[0], right[0]))
    .map(([key, value]) => ({
      count: value.count,
      key,
      label: value.label,
    }));
}

function buildAvailableSeasons(matches: readonly RivalryMatch[]): number[] {
  return Array.from(new Set(matches.map((match) => match.season))).sort(
    (left, right) => left - right,
  );
}

function buildSeasonRange(
  availableSeasons: readonly number[],
  filters: ResolvedRivalsFilters,
): RivalsSeasonRange {
  return {
    availableSeasons: [...availableSeasons],
    endSeason: availableSeasons.length ? filters.endSeason : null,
    startSeason: availableSeasons.length ? filters.startSeason : null,
  };
}

function buildSummaryFromMatches(
  matches: readonly RivalryMatch[],
  options: {
    failedSeasons?: readonly number[] | null;
    seasonsScanned?: number | null;
  } = {},
): RivalsWorkspaceSummary {
  const wins = matches.filter((match) => match.outcome === "WIN").length;
  const losses = matches.filter((match) => match.outcome === "LOSS").length;
  const tvGames = matches.filter((match) => match.isTvGame).length;
  const opponents = new Set(matches.map((match) => match.opponentTeamId));
  const availableSeasons = buildAvailableSeasons(matches);
  const failedSeasons = normalizeIntegerArray(options.failedSeasons);

  return {
    failedSeasonCount: failedSeasons.length,
    failedSeasons,
    firstSeason: availableSeasons[0] ?? null,
    lastSeason: availableSeasons.at(-1) ?? null,
    losses,
    seasonsScanned:
      options.seasonsScanned ??
      availableSeasons.length,
    seasonsWithGames: availableSeasons.length,
    totalCompletedGames: matches.length,
    totalOpponents: opponents.size,
    tvGames,
    wins,
  };
}

function resolveWorkspaceFilters(args: {
  availableCompetitionKeys: readonly string[];
  availableSeasons: readonly number[];
  requested: RivalsWorkspaceFiltersInput;
}): ResolvedRivalsFilters {
  const startSeason = normalizeSeasonBound(
    args.requested.startSeason,
    args.availableSeasons,
  );
  const endSeason = normalizeSeasonBound(
    args.requested.endSeason,
    args.availableSeasons,
  );
  const normalizedCompetitionKeys =
    args.requested.competitionKeys == null
      ? [...args.availableCompetitionKeys]
      : args.requested.competitionKeys.filter((value) =>
          args.availableCompetitionKeys.includes(value),
        );
  const normalizedOutcomes = normalizeEnumArray(
    args.requested.outcomes,
    DEFAULT_OUTCOMES,
  );
  const normalizedTvScopes = normalizeEnumArray(
    args.requested.tvScopes,
    DEFAULT_TV_SCOPES,
  );
  const normalizedVenues = normalizeEnumArray(
    args.requested.venues,
    DEFAULT_VENUES,
  );

  return {
    competitionKeys: normalizedCompetitionKeys,
    endSeason:
      startSeason !== null && endSeason !== null && startSeason > endSeason
        ? startSeason
        : endSeason,
    outcomes: normalizedOutcomes,
    selectedOpponentId: normalizeNonEmptyString(args.requested.selectedOpponentId),
    startSeason:
      startSeason !== null && endSeason !== null && startSeason > endSeason
        ? endSeason
        : startSeason,
    tvScopes: normalizedTvScopes,
    venues: normalizedVenues,
  };
}

function filterRivalryMatches(
  matches: readonly RivalryMatch[],
  filters: ResolvedRivalsFilters,
): RivalryMatch[] {
  return matches.filter((match) => {
    if (!filters.competitionKeys.includes(match.competitionKey)) {
      return false;
    }

    if (!filters.venues.includes(match.venue)) {
      return false;
    }

    if (!filters.outcomes.includes(match.outcome)) {
      return false;
    }

    if (!filters.tvScopes.includes(resolveTvScope(match))) {
      return false;
    }

    if (
      filters.startSeason !== null &&
      filters.endSeason !== null &&
      (match.season < filters.startSeason || match.season > filters.endSeason)
    ) {
      return false;
    }

    return true;
  });
}

function buildRivalryRows(matches: readonly RivalryMatch[]): RivalryRow[] {
  const rows = new Map<string, RivalryRow & { matches: RivalryMatch[]; totalMargin: number }>();

  for (const match of matches) {
    const current =
      rows.get(match.opponentTeamId) ??
      ({
        averageMargin: 0,
        currentStreak: "N/A",
        games: 0,
        homeLosses: 0,
        homeWins: 0,
        lastMatch: null,
        leagueLosses: 0,
        leagueWins: 0,
        losses: 0,
        matches: [],
        opponentTeamId: match.opponentTeamId,
        opponentTeamName: match.opponentTeamName,
        playoffLosses: 0,
        playoffWins: 0,
        roadLosses: 0,
        roadWins: 0,
        seasons: [],
        totalMargin: 0,
        tvGames: 0,
        winPct: 0,
        wins: 0,
      } satisfies RivalryRow & {
        matches: RivalryMatch[];
        totalMargin: number;
      });

    current.games += 1;
    current.matches.push(match);
    current.totalMargin += match.margin;
    current.lastMatch = pickLaterTimestamp(current.lastMatch, match.startTime);

    if (!current.seasons.includes(match.season)) {
      current.seasons.push(match.season);
    }

    if (match.outcome === "WIN") {
      current.wins += 1;
      if (match.venue === "HOME") {
        current.homeWins += 1;
      } else {
        current.roadWins += 1;
      }
    } else {
      current.losses += 1;
      if (match.venue === "HOME") {
        current.homeLosses += 1;
      } else {
        current.roadLosses += 1;
      }
    }

    if (match.competitionKey === "LEAGUE_REGULAR_SEASON") {
      if (match.outcome === "WIN") {
        current.leagueWins += 1;
      } else {
        current.leagueLosses += 1;
      }
    }

    if (match.competitionKey === "PLAYOFFS") {
      if (match.outcome === "WIN") {
        current.playoffWins += 1;
      } else {
        current.playoffLosses += 1;
      }
    }

    if (match.isTvGame) {
      current.tvGames += 1;
    }

    rows.set(match.opponentTeamId, current);
  }

  return Array.from(rows.values()).map((row) => ({
    averageMargin: row.games ? row.totalMargin / row.games : 0,
    currentStreak: buildCurrentStreak(row.matches),
    games: row.games,
    homeLosses: row.homeLosses,
    homeWins: row.homeWins,
    lastMatch: row.lastMatch,
    leagueLosses: row.leagueLosses,
    leagueWins: row.leagueWins,
    losses: row.losses,
    opponentTeamId: row.opponentTeamId,
    opponentTeamName: row.opponentTeamName,
    playoffLosses: row.playoffLosses,
    playoffWins: row.playoffWins,
    roadLosses: row.roadLosses,
    roadWins: row.roadWins,
    seasons: [...row.seasons].sort((left, right) => left - right),
    tvGames: row.tvGames,
    winPct: row.games ? row.wins / row.games : 0,
    wins: row.wins,
  }));
}

function sortRivalryRowsForSelection(
  rows: readonly RivalryRow[],
): RivalryRow[] {
  return [...rows].sort((left, right) => {
    if (right.wins !== left.wins) {
      return right.wins - left.wins;
    }
    if (right.winPct !== left.winPct) {
      return right.winPct - left.winPct;
    }
    if (right.games !== left.games) {
      return right.games - left.games;
    }
    return left.opponentTeamName.localeCompare(right.opponentTeamName);
  });
}

function buildCompetitionBreakdown(
  matches: readonly RivalryMatch[],
): RivalryCompetitionBreakdownRow[] {
  const rows = new Map<
    string,
    RivalryCompetitionBreakdownRow & { totalMargin: number }
  >();

  for (const match of matches) {
    const current = rows.get(match.competitionKey) ?? {
      averageMargin: 0,
      competitionKey: match.competitionKey,
      competitionLabel: resolveCompetitionLabel(
        match.competitionKey,
        match.competitionLabel,
      ),
      games: 0,
      homeLosses: 0,
      homeWins: 0,
      losses: 0,
      roadLosses: 0,
      roadWins: 0,
      totalMargin: 0,
      tvGames: 0,
      wins: 0,
    };

    current.games += 1;
    current.totalMargin += match.margin;
    if (match.outcome === "WIN") {
      current.wins += 1;
      if (match.venue === "HOME") {
        current.homeWins += 1;
      } else {
        current.roadWins += 1;
      }
    } else {
      current.losses += 1;
      if (match.venue === "HOME") {
        current.homeLosses += 1;
      } else {
        current.roadLosses += 1;
      }
    }

    if (match.isTvGame) {
      current.tvGames += 1;
    }

    rows.set(match.competitionKey, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      averageMargin: row.games ? row.totalMargin / row.games : 0,
      competitionKey: row.competitionKey,
      competitionLabel: row.competitionLabel,
      games: row.games,
      homeLosses: row.homeLosses,
      homeWins: row.homeWins,
      losses: row.losses,
      roadLosses: row.roadLosses,
      roadWins: row.roadWins,
      tvGames: row.tvGames,
      wins: row.wins,
    }))
    .sort((left, right) =>
      compareCompetition(left.competitionKey, right.competitionKey),
    );
}

function buildSeasonBreakdown(
  matches: readonly RivalryMatch[],
): RivalrySeasonBreakdownRow[] {
  const rows = new Map<
    number,
    RivalrySeasonBreakdownRow & { totalMargin: number }
  >();

  for (const match of matches) {
    const current = rows.get(match.season) ?? {
      averageMargin: 0,
      games: 0,
      lastMatch: null,
      leagueLosses: 0,
      leagueWins: 0,
      losses: 0,
      season: match.season,
      totalMargin: 0,
      tvGames: 0,
      wins: 0,
    };

    current.games += 1;
    current.totalMargin += match.margin;
    current.lastMatch = pickLaterTimestamp(current.lastMatch, match.startTime);

    if (match.outcome === "WIN") {
      current.wins += 1;
    } else {
      current.losses += 1;
    }

    if (match.competitionKey === "LEAGUE_REGULAR_SEASON") {
      if (match.outcome === "WIN") {
        current.leagueWins += 1;
      } else {
        current.leagueLosses += 1;
      }
    }

    if (match.isTvGame) {
      current.tvGames += 1;
    }

    rows.set(match.season, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      averageMargin: row.games ? row.totalMargin / row.games : 0,
      games: row.games,
      lastMatch: row.lastMatch,
      leagueLosses: row.leagueLosses,
      leagueWins: row.leagueWins,
      losses: row.losses,
      season: row.season,
      tvGames: row.tvGames,
      wins: row.wins,
    }))
    .sort((left, right) => right.season - left.season);
}

function buildCurrentStreak(matches: readonly RivalryMatch[]): string {
  if (!matches.length) {
    return "N/A";
  }

  const ordered = [...matches].sort((left, right) =>
    compareTimestamps(right.startTime, left.startTime),
  );
  const streakOutcome = ordered[0]?.outcome;
  if (!streakOutcome) {
    return "N/A";
  }

  let streakLength = 0;
  for (const match of ordered) {
    if (match.outcome !== streakOutcome) {
      break;
    }
    streakLength += 1;
  }

  return `${streakOutcome === "WIN" ? "W" : "L"}${streakLength}`;
}

function resolveSelectedOpponentId(
  requestedSelectedOpponentId: string | null,
  rows: readonly RivalryRow[],
): string | null {
  if (
    requestedSelectedOpponentId &&
    rows.some((row) => row.opponentTeamId === requestedSelectedOpponentId)
  ) {
    return requestedSelectedOpponentId;
  }

  return rows[0]?.opponentTeamId ?? null;
}

function resolveWorkspaceWarning(
  warning: string | null,
  status: RivalsBackfillRecord | null,
  matchCount: number,
): string | null {
  const normalizedWarning = normalizeNonEmptyString(warning);
  if (normalizedWarning) {
    return normalizedWarning;
  }

  return buildEmptyWorkspaceWarning(status, matchCount);
}

function buildEmptyWorkspaceWarning(
  status: RivalsBackfillRecord | null,
  cachedMatchCount: number,
): string | null {
  if (cachedMatchCount > 0) {
    return null;
  }

  if (!status) {
    return "No rivals history is cached yet. Click Refresh to build it.";
  }

  if (status.status === "FAILED") {
    return status.error ?? "The last rivals refresh failed.";
  }

  if (hasActiveRivalsBackfill(status)) {
    return "Rivals history is refreshing in the background. Cached results will appear when the scan completes.";
  }

  return null;
}

function toStatus(status: RivalsBackfillRecord): RivalsBackfillStatus {
  return {
    completedAt: status.completedAt ?? null,
    error: status.error ?? null,
    executionArn: status.executionArn ?? null,
    generatedAt: status.generatedAt ?? null,
    requestedAt: status.requestedAt,
    startedAt: status.startedAt ?? null,
    status: status.status,
    teamId: status.teamId,
    teamName: status.teamName ?? null,
    totalCompletedGames: status.totalCompletedGames ?? null,
    totalOpponents: status.totalOpponents ?? null,
    updatedAt: status.updatedAt,
    userId: status.userId,
  };
}

function toSubmitResult(
  status: RivalsBackfillRecord,
  queued: boolean,
): SubmitRivalsBackfillResult {
  return {
    executionArn: status.executionArn ?? null,
    queued,
    requestedAt: status.requestedAt,
    status: status.status,
    teamId: status.teamId,
    teamName: status.teamName ?? null,
  };
}

function hasActiveRivalsBackfill(
  status: Pick<RivalsBackfillRecord, "status"> | null | undefined,
): boolean {
  return Boolean(status && ACTIVE_BACKFILL_STATES.has(status.status));
}

async function resolveRivalsContext(
  env: GraphqlEnv,
  identity: unknown,
  deps: Pick<GetDependencies | SubmitDependencies, "getBbConnection">,
): Promise<ResolvedRivalsContext> {
  const userId = resolveUserId(identity);
  if (!userId) {
    throw new Error("You must be signed in to load rivals.");
  }

  const connection = await deps.getBbConnection(env, userId);
  if (!connection?.teamId) {
    throw new Error("Connect a BuzzerBeater account before loading rivals.");
  }

  return {
    connection,
    teamId: connection.teamId,
    teamName: connection.teamName ?? null,
    userId,
  };
}

function buildEmptySummary(): RivalsWorkspaceSummary {
  return {
    failedSeasonCount: 0,
    failedSeasons: [],
    firstSeason: null,
    lastSeason: null,
    losses: 0,
    seasonsScanned: 0,
    seasonsWithGames: 0,
    totalCompletedGames: 0,
    totalOpponents: 0,
    tvGames: 0,
    wins: 0,
  };
}

function isRivalsWorkspaceSummary(
  value: unknown,
): value is RivalsWorkspaceSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const summary = value as Partial<RivalsWorkspaceSummary>;
  return (
    typeof summary.failedSeasonCount === "number" &&
    Array.isArray(summary.failedSeasons) &&
    typeof summary.losses === "number" &&
    typeof summary.seasonsScanned === "number" &&
    typeof summary.seasonsWithGames === "number" &&
    typeof summary.totalCompletedGames === "number" &&
    typeof summary.totalOpponents === "number" &&
    typeof summary.tvGames === "number" &&
    typeof summary.wins === "number"
  );
}

function encodeCachedRivalryMatches(
  matches: readonly RivalryMatch[],
): RivalsMatchesCacheEnvelope {
  const json = JSON.stringify(matches);
  const compressed = brotliCompressSync(Buffer.from(json, "utf8"));
  return {
    encoding: RIVALS_MATCHES_CACHE_ENCODING,
    payload: compressed.toString("base64"),
  };
}

function decodeCachedRivalryMatches(value: unknown): RivalryMatch[] {
  if (Array.isArray(value)) {
    return value as RivalryMatch[];
  }

  if (!isRivalsMatchesCacheEnvelope(value)) {
    return [];
  }

  try {
    const decompressed = brotliDecompressSync(
      Buffer.from(value.payload, "base64"),
    );
    const parsed = JSON.parse(decompressed.toString("utf8"));
    return Array.isArray(parsed) ? (parsed as RivalryMatch[]) : [];
  } catch {
    return [];
  }
}

function isRivalsMatchesCacheEnvelope(
  value: unknown,
): value is RivalsMatchesCacheEnvelope {
  const encoding =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { encoding?: unknown }).encoding
      : undefined;

  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (encoding === RIVALS_MATCHES_CACHE_ENCODING ||
      encoding === LEGACY_RIVALS_MATCHES_CACHE_ENCODING) &&
    typeof (value as { payload?: unknown }).payload === "string"
  );
}

function readFailedSeasons(
  status: Pick<RivalsBackfillRecord, "failedSeasons"> | null | undefined,
): number[] {
  return normalizeIntegerArray(status?.failedSeasons);
}

function buildRivalryMatch(args: {
  match: BBApiScheduleMatch;
  season: number;
  teamId: string;
}): RivalryMatch | null {
  const { match, season, teamId } = args;
  const matchId = normalizeNonEmptyString(match.id);
  const startTime = normalizeNonEmptyString(match.startTime);
  if (!matchId || !startTime) {
    return null;
  }

  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }

  const teamScore = deriveTeamScore(match, teamId);
  const opponentScore = deriveOpponentScore(match, teamId);
  const opponentTeamId = deriveOpponentTeamId(match, teamId);
  const opponentTeamName = deriveOpponentTeamName(match, teamId);
  if (
    teamScore === null ||
    opponentScore === null ||
    !opponentTeamId ||
    !opponentTeamName
  ) {
    return null;
  }

  const competition = classifyScheduleMatchType(match.type);
  const margin = teamScore - opponentScore;

  return {
    competitionKey: competition.competitionKey,
    competitionLabel: competition.competitionLabel,
    gameDate: toGameDate(startTime),
    isHome: isTeamHome(match, teamId),
    isTvGame: competition.isTvGame,
    margin,
    matchId,
    opponentScore,
    opponentTeamId,
    opponentTeamName,
    outcome: margin >= 0 ? "WIN" : "LOSS",
    rawType: normalizeRawType(match.type),
    season,
    stageKey: competition.stageKey,
    stageLabel: competition.stageLabel,
    startTime,
    teamScore,
    venue: isTeamHome(match, teamId) ? "HOME" : "ROAD",
  };
}

function rivalryMatchToFactRecord(
  userId: string,
  teamId: string,
  match: RivalryMatch,
): RivalryMatchFactRecord {
  if (!match.startTime) {
    throw new Error("Rivalry match facts require a startTime.");
  }

  return {
    competitionKey: match.competitionKey,
    competitionLabel: match.competitionLabel,
    gameDate: match.gameDate ?? null,
    isHome: match.isHome,
    isTvGame: match.isTvGame,
    margin: match.margin,
    matchId: match.matchId,
    opponentScore: match.opponentScore,
    opponentTeamId: match.opponentTeamId,
    opponentTeamName: match.opponentTeamName,
    outcome: match.outcome,
    rawType: match.rawType ?? null,
    season: match.season,
    stageKey: match.stageKey ?? null,
    stageLabel: match.stageLabel ?? null,
    startTime: match.startTime,
    teamId,
    teamScore: match.teamScore,
    userId,
    venue: match.venue,
  };
}

function rivalryMatchFactToMatch(fact: RivalryMatchFactRecord): RivalryMatch {
  return {
    competitionKey: fact.competitionKey,
    competitionLabel: fact.competitionLabel,
    gameDate: fact.gameDate ?? null,
    isHome: fact.isHome,
    isTvGame: fact.isTvGame,
    margin: fact.margin,
    matchId: fact.matchId,
    opponentScore: fact.opponentScore,
    opponentTeamId: fact.opponentTeamId,
    opponentTeamName: fact.opponentTeamName,
    outcome: fact.outcome,
    rawType: fact.rawType ?? null,
    season: fact.season,
    stageKey: fact.stageKey ?? null,
    stageLabel: fact.stageLabel ?? null,
    startTime: fact.startTime,
    teamScore: fact.teamScore,
    venue: fact.venue,
  };
}

function classifyScheduleMatchType(rawType: string | null | undefined): NormalizedCompetition {
  const normalized = rawType?.trim().toUpperCase() ?? "";
  if (!normalized) {
    return {
      competitionKey: "OTHER",
      competitionLabel: competitionLabelByKey.OTHER,
      isTvGame: false,
      stageKey: null,
      stageLabel: null,
    };
  }

  const segments = normalized.split(".").filter(Boolean);
  const nonTvSegments = segments.filter((segment) => segment !== "TV");
  const isTvGame = segments.includes("TV");
  const primary = nonTvSegments[0] ?? normalized;

  switch (primary) {
    case "LEAGUE": {
      const stageToken = nonTvSegments[1] ?? "RS";
      const isPlayoffStage =
        stageToken === "PLAYOUT" || isPlayoffLike(stageToken);
      return {
        competitionKey: isPlayoffStage
          ? "PLAYOFFS"
          : "LEAGUE_REGULAR_SEASON",
        competitionLabel: isPlayoffStage
          ? competitionLabelByKey.PLAYOFFS
          : competitionLabelByKey.LEAGUE_REGULAR_SEASON,
        isTvGame,
        stageKey: normalizeStageKey(stageToken),
        stageLabel: formatStageToken(stageToken),
      };
    }
    case "CUP":
      return {
        competitionKey: "CUP",
        competitionLabel: competitionLabelByKey.CUP,
        isTvGame,
        stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
        stageLabel: formatStageToken(nonTvSegments[1] ?? null),
      };
    case "SCRIMMAGE":
      return {
        competitionKey: "SCRIMMAGE",
        competitionLabel: competitionLabelByKey.SCRIMMAGE,
        isTvGame,
        stageKey: null,
        stageLabel: null,
      };
    case "PL":
    case "PRIVATE":
    case "PRIVATELEAGUE":
      return {
        competitionKey: "PRIVATE_LEAGUE",
        competitionLabel: competitionLabelByKey.PRIVATE_LEAGUE,
        isTvGame,
        stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
        stageLabel: formatStageToken(nonTvSegments[1] ?? null),
      };
    case "BBB":
      return {
        competitionKey: "BUZZERBEATER_BEST",
        competitionLabel: competitionLabelByKey.BUZZERBEATER_BEST,
        isTvGame,
        stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
        stageLabel: formatStageToken(nonTvSegments[1] ?? null),
      };
    case "BBM":
      return {
        competitionKey: "BUZZERBEATER_MADNESS",
        competitionLabel: competitionLabelByKey.BUZZERBEATER_MADNESS,
        isTvGame,
        stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
        stageLabel: formatStageToken(nonTvSegments[1] ?? null),
      };
    default:
      return {
        competitionKey: isPlayoffLike(nonTvSegments[1] ?? null)
          ? "PLAYOFFS"
          : "OTHER",
        competitionLabel: isPlayoffLike(nonTvSegments[1] ?? null)
          ? competitionLabelByKey.PLAYOFFS
          : competitionLabelByKey.OTHER,
        isTvGame,
        stageKey: normalizeStageKey(
          nonTvSegments[1] ?? nonTvSegments[0] ?? null,
        ),
        stageLabel: formatStageToken(
          nonTvSegments[1] ?? nonTvSegments[0] ?? null,
        ),
      };
  }
}

const competitionLabelByKey: Record<
  CompetitionKey,
  RivalryMatch["competitionLabel"]
> = {
  BUZZERBEATER_BEST: "BuzzerBeater's Best",
  BUZZERBEATER_MADNESS: "BuzzerBeater Madness",
  CUP: "Cup",
  LEAGUE_REGULAR_SEASON: "League regular season",
  OTHER: "Other",
  PLAYOFFS: "Playoffs",
  PRIVATE_LEAGUE: "Private league",
  SCRIMMAGE: "Scrimmage",
};

function isCompetitionKey(value: string): value is CompetitionKey {
  return competitionOrder.includes(value as CompetitionKey);
}

function resolveCompetitionLabel(
  competitionKey: string,
  competitionLabel: string | null | undefined,
): string {
  if (competitionLabel) {
    return competitionLabel;
  }

  return isCompetitionKey(competitionKey)
    ? competitionLabelByKey[competitionKey]
    : competitionKey;
}

function isPlayoffLike(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return (
    normalized.includes("final") ||
    normalized.includes("playin") ||
    normalized.includes("playoff") ||
    normalized.includes("semifinal") ||
    normalized.includes("quarterfinal") ||
    /^round\d+$/.test(normalized)
  );
}

function normalizeRawType(type: string | null | undefined): string | null {
  const normalized = type?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeStageKey(value: string | null): string | null {
  return value ? value.replace(/[^a-z0-9]+/gi, "_").toLowerCase() : null;
}

function formatStageToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/_/g, "");
  const mappedLabel = STAGE_LABELS[normalized.toLowerCase()];
  if (mappedLabel) {
    return mappedLabel;
  }

  const roundMatch = /^round(\d+)$/i.exec(normalized);
  if (roundMatch) {
    return `Round ${roundMatch[1]}`;
  }

  return value
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

const STAGE_LABELS: Record<string, string> = {
  bronze: "Bronze game",
  final: "Final",
  finals: "Final",
  playin: "Play-in",
  playout: "Playout",
  quarterfinal: "Quarterfinal",
  quarterfinals: "Quarterfinal",
  regularseason: "Regular season",
  roundof16: "Round of 16",
  roundof32: "Round of 32",
  roundof64: "Round of 64",
  rs: "Regular season",
  semifinal: "Semifinal",
  semifinals: "Semifinal",
  thirdplace: "Third place",
};

function matchIncludesTeam(
  match: BBApiScheduleMatch,
  teamId: string,
): boolean {
  return match.homeTeam.id === teamId || match.awayTeam.id === teamId;
}

function deriveOpponentTeamId(
  match: BBApiScheduleMatch,
  teamId: string,
): string | null {
  return match.homeTeam.id === teamId ? match.awayTeam.id : match.homeTeam.id;
}

function deriveOpponentTeamName(
  match: BBApiScheduleMatch,
  teamId: string,
): string | null {
  return match.homeTeam.id === teamId
    ? match.awayTeam.teamName
    : match.homeTeam.teamName;
}

function deriveTeamScore(
  match: BBApiScheduleMatch,
  teamId: string,
): number | null {
  return match.homeTeam.id === teamId
    ? match.homeTeam.score
    : match.awayTeam.score;
}

function deriveOpponentScore(
  match: BBApiScheduleMatch,
  teamId: string,
): number | null {
  return match.homeTeam.id === teamId
    ? match.awayTeam.score
    : match.homeTeam.score;
}

function isTeamHome(match: BBApiScheduleMatch, teamId: string): boolean {
  return match.homeTeam.id === teamId;
}

function toGameDate(startTime: string): string {
  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) {
    return startTime.slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function compareCompetition(left: string, right: string): number {
  const leftIndex = competitionOrder.indexOf(
    left as (typeof competitionOrder)[number],
  );
  const rightIndex = competitionOrder.indexOf(
    right as (typeof competitionOrder)[number],
  );

  return normalizeOrderValue(leftIndex) - normalizeOrderValue(rightIndex);
}

function normalizeOrderValue(value: number): number {
  return value === -1 ? Number.MAX_SAFE_INTEGER : value;
}

function pickLaterTimestamp(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  return compareTimestamps(current, candidate) >= 0
    ? (current ?? null)
    : (candidate ?? null);
}

function compareTimestamps(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return parseTimestamp(left) - parseTimestamp(right);
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function resolveTvScope(match: RivalryMatch): TvScope {
  return match.isTvGame ? "TV" : "NON_TV";
}

export function compactNullableStringArray(
  input: readonly (string | null | undefined)[] | null | undefined,
): string[] | undefined {
  if (input == null) {
    return undefined;
  }

  return input.filter((value): value is string => typeof value === "string");
}

function normalizeSeasonBound(
  value: number | null | undefined,
  availableSeasons: readonly number[],
): number | null {
  if (!availableSeasons.length) {
    return null;
  }

  if (!isIntegerNumber(value)) {
    return null;
  }
  const normalizedValue = value;
  const lowerBound = availableSeasons[0];
  const upperBound = availableSeasons.at(-1);
  if (lowerBound === undefined || upperBound === undefined) {
    return null;
  }

  if (availableSeasons.includes(normalizedValue)) {
    return normalizedValue;
  }

  return Math.max(
    lowerBound,
    Math.min(upperBound, normalizedValue),
  );
}

function normalizeEnumArray<TValue extends string>(
  input: readonly string[] | null | undefined,
  allowedValues: readonly TValue[],
): TValue[] {
  if (input == null) {
    return [...allowedValues];
  }

  const allowed = new Set<string>(allowedValues);
  return input.filter((value): value is TValue => allowed.has(value));
}

function normalizeIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is number => Number.isInteger(entry));
}

function isIntegerNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildWarning(failedSeasons: readonly number[]): string | null {
  if (!failedSeasons.length) {
    return null;
  }

  const listedSeasons = failedSeasons.slice(0, 6).join(", ");
  const suffix =
    failedSeasons.length > 6 ? `, and ${failedSeasons.length - 6} more` : "";
  return `Live history is partial. The schedule scan failed for season${failedSeasons.length === 1 ? "" : "s"} ${listedSeasons}${suffix}.`;
}

function toFilterInput(args: {
  competitionKeys?: readonly string[] | null;
  endSeason?: number | null;
  identity?: unknown;
  outcomes?: readonly string[] | null;
  selectedOpponentId?: string | null;
  startSeason?: number | null;
  tvScopes?: readonly string[] | null;
  venues?: readonly string[] | null;
}): RivalsWorkspaceFiltersInput {
  return {
    competitionKeys: args.competitionKeys,
    endSeason: args.endSeason,
    outcomes: args.outcomes,
    selectedOpponentId: args.selectedOpponentId,
    startSeason: args.startSeason,
    tvScopes: args.tvScopes,
    venues: args.venues,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logRivalsInfo(
  message: string,
  fields: Record<string, unknown>,
): void {
  console.info(`[rivals] ${message}`, fields);
}

async function mapWithConcurrency<TInput, TResult>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) {
        return;
      }

      results[currentIndex] = await mapper(item, currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await worker();
    }),
  );

  return results;
}
