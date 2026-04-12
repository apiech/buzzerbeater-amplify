import {
  BBXmlApiClient,
  type BBApiScheduleMatch,
  type BBXmlApiClientOptions,
} from "../../../lib/bbapi";
import type { Schema } from "../resource";
import { resolveBbAccessKey } from "./credentials";
import { assertMaintenanceInactive } from "./maintenance";
import {
  getBbConnection,
  getRivalsBackfill,
  getRivalsWorkspaceCache,
  type BbConnectionRecord,
  type RivalsBackfillRecord,
  upsertRivalsBackfill,
  upsertRivalsWorkspaceCache,
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
type RivalryMatch = RivalsWorkspaceResult["matches"][number];
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

type NormalizedCompetition = {
  competitionKey: RivalryMatch["competitionKey"];
  competitionLabel: RivalryMatch["competitionLabel"];
  isTvGame: boolean;
  stageKey: RivalryMatch["stageKey"];
  stageLabel: RivalryMatch["stageLabel"];
};

type RivalsBackfillMessage = {
  requestedAt: string;
  teamId: string;
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
  now: () => Date;
};

type ProcessDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: CreateBbClient;
  getBbConnection: typeof getBbConnection;
  getRivalsBackfill: typeof getRivalsBackfill;
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  upsertRivalsBackfill: typeof upsertRivalsBackfill;
  upsertRivalsWorkspaceCache: typeof upsertRivalsWorkspaceCache;
};

type SubmitDependencyOverrides = Partial<SubmitDependencies>;
type GetDependencyOverrides = Partial<GetDependencies>;
type ProcessDependencyOverrides = Partial<ProcessDependencies>;

type ResolvedRivalsContext = {
  connection: BbConnectionRecord;
  teamId: string;
  teamName: string | null;
  userId: string;
};

type BuiltRivalsWorkspace = Omit<RivalsWorkspaceResult, "status">;

const DEFAULT_FETCH_CONCURRENCY = 4;
const ACTIVE_BACKFILL_STATES = new Set([
  "BUILDING_DATASET",
  "FETCHING_SCHEDULES",
  "FETCHING_SEASONS",
  "QUEUED",
]);

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
  now: () => new Date(),
};

const defaultProcessDependencies: ProcessDependencies = {
  assertMaintenanceInactive,
  createBbClient: (options) => new BBXmlApiClient(options),
  getBbConnection,
  getRivalsBackfill,
  now: () => new Date(),
  resolveBbAccessKey,
  upsertRivalsBackfill,
  upsertRivalsWorkspaceCache,
};

export const __testing = {
  buildRivalryMatch,
  buildWorkspaceFromCache,
  classifyScheduleMatchType,
  formatStageToken,
  hasActiveRivalsBackfill,
  matchIncludesTeam,
};

export async function getRivalsWorkspace(
  args: {
    env: GraphqlEnv;
    identity: unknown;
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
  const [cache, status] = await Promise.all([
    deps.getRivalsWorkspaceCache(args.env, context.userId, context.teamId),
    deps.getRivalsBackfill(args.env, context.userId, context.teamId),
  ]);

  return buildWorkspaceFromCache({
    cache,
    connection: context.connection,
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
    generatedAt: existingStatus?.generatedAt ?? null,
    requestedAt,
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
    generatedAt: currentStatus?.generatedAt ?? null,
    requestedAt: args.message.requestedAt,
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
    const accessKey = await deps.resolveBbAccessKey(args.env, args.message.userId);
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

    const scheduleStartedAt = deps.now().toISOString();
    await deps.upsertRivalsBackfill(args.env, {
      completedAt: null,
      error: null,
      executionArn: currentStatus?.executionArn ?? null,
      generatedAt: currentStatus?.generatedAt ?? null,
      requestedAt: args.message.requestedAt,
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
      generatedAt: currentStatus?.generatedAt ?? null,
      requestedAt: args.message.requestedAt,
      startedAt,
      status: "BUILDING_DATASET",
      teamId: args.message.teamId,
      teamName: connection.teamName ?? null,
      totalCompletedGames: currentStatus?.totalCompletedGames ?? null,
      totalOpponents: currentStatus?.totalOpponents ?? null,
      updatedAt: buildStartedAt,
      userId: args.message.userId,
    });

    const builtWorkspace = buildRivalsWorkspaceDataset({
      scheduleResults,
      seasons,
      teamId: args.message.teamId,
      teamName: connection.teamName ?? null,
      shortName: connection.shortName ?? null,
      syncedAt: connection.lastSyncAt ?? null,
      generatedAt: deps.now().toISOString(),
    });

    await deps.upsertRivalsWorkspaceCache(args.env, {
      generatedAt: builtWorkspace.generatedAt,
      matchesJson: builtWorkspace.matches,
      shortName: builtWorkspace.team.shortName ?? null,
      summaryJson: builtWorkspace.summary,
      syncedAt: builtWorkspace.syncedAt ?? null,
      teamId: args.message.teamId,
      teamName: builtWorkspace.team.teamName ?? null,
      userId: args.message.userId,
      warning: builtWorkspace.warning ?? null,
    });

    const completedAt = deps.now().toISOString();
    await deps.upsertRivalsBackfill(args.env, {
      completedAt,
      error: null,
      executionArn: currentStatus?.executionArn ?? null,
      generatedAt: builtWorkspace.generatedAt,
      requestedAt: args.message.requestedAt,
      startedAt,
      status: "SUCCEEDED",
      teamId: args.message.teamId,
      teamName: builtWorkspace.team.teamName ?? null,
      totalCompletedGames: builtWorkspace.summary.totalCompletedGames,
      totalOpponents: builtWorkspace.summary.totalOpponents,
      updatedAt: completedAt,
      userId: args.message.userId,
    });
  } catch (error) {
    const failedAt = deps.now().toISOString();
    await deps.upsertRivalsBackfill(args.env, {
      completedAt: failedAt,
      error: toErrorMessage(error),
      executionArn: currentStatus?.executionArn ?? null,
      generatedAt: currentStatus?.generatedAt ?? null,
      requestedAt: args.message.requestedAt,
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

function buildRivalsWorkspaceDataset(args: {
  generatedAt: string;
  scheduleResults: readonly ScheduleFetchResult[];
  seasons: readonly number[];
  shortName: string | null;
  syncedAt: string | null;
  teamId: string;
  teamName: string | null;
}): BuiltRivalsWorkspace {
  const rivalryMatchesById = new Map<string, RivalryMatch>();
  const failedSeasons: number[] = [];
  const seasonsWithGames = new Set<number>();

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
      seasonsWithGames.add(result.season);
    }
  }

  const matches = Array.from(rivalryMatchesById.values()).sort((left, right) =>
    compareTimestamps(right.startTime, left.startTime),
  );
  const wins = matches.filter((match) => match.outcome === "WIN").length;
  const losses = matches.filter((match) => match.outcome === "LOSS").length;
  const tvGames = matches.filter((match) => match.isTvGame).length;
  const opponents = new Set(matches.map((match) => match.opponentTeamId));
  const summary: RivalsWorkspaceSummary = {
    failedSeasonCount: failedSeasons.length,
    failedSeasons,
    firstSeason: args.seasons[0] ?? null,
    lastSeason: args.seasons.at(-1) ?? null,
    losses,
    seasonsScanned: args.seasons.length,
    seasonsWithGames: seasonsWithGames.size,
    totalCompletedGames: matches.length,
    totalOpponents: opponents.size,
    tvGames,
    wins,
  };

  return {
    generatedAt: args.generatedAt,
    matches,
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

function buildWorkspaceFromCache(args: {
  cache:
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
  connection: BbConnectionRecord;
  generatedAt: string;
  status: RivalsBackfillRecord | null;
}): RivalsWorkspaceResult {
  const cachedMatches = Array.isArray(args.cache?.matchesJson)
    ? (args.cache?.matchesJson as RivalryMatch[])
    : [];
  const cachedSummary = isRivalsWorkspaceSummary(args.cache?.summaryJson)
    ? args.cache.summaryJson
    : buildEmptySummary();
  const teamId = args.connection.teamId ?? args.cache?.teamId ?? null;
  const teamName = args.cache?.teamName ?? args.connection.teamName ?? null;
  const shortName = args.cache?.shortName ?? args.connection.shortName ?? null;

  return {
    generatedAt: args.cache?.generatedAt ?? args.generatedAt,
    matches: cachedMatches,
    status: args.status ? toStatus(args.status) : null,
    summary: cachedSummary,
    syncedAt: args.cache?.syncedAt ?? args.connection.lastSyncAt ?? null,
    team: {
      shortName,
      teamId,
      teamName,
    },
    warning:
      args.cache?.warning ??
      buildEmptyWorkspaceWarning(args.status, cachedMatches.length),
  };
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildRivalryMatch(args: {
  match: BBApiScheduleMatch;
  season: number;
  teamId: string;
}): RivalryMatch | null {
  const { match, season, teamId } = args;
  const matchId = match.id?.trim();
  if (!matchId) {
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

  return {
    competitionKey: competition.competitionKey,
    competitionLabel: competition.competitionLabel,
    gameDate: toGameDate(match.startTime),
    isHome: isTeamHome(match, teamId),
    isTvGame: competition.isTvGame,
    margin: teamScore - opponentScore,
    matchId,
    opponentScore,
    opponentTeamId,
    opponentTeamName,
    outcome: teamScore > opponentScore ? "WIN" : "LOSS",
    rawType: match.type ?? null,
    season,
    stageKey: competition.stageKey,
    stageLabel: competition.stageLabel,
    startTime: match.startTime ?? null,
    teamScore,
    venue: isTeamHome(match, teamId) ? "HOME" : "ROAD",
  };
}

function matchIncludesTeam(match: BBApiScheduleMatch, teamId: string): boolean {
  return match.homeTeam.id === teamId || match.awayTeam.id === teamId;
}

function classifyScheduleMatchType(
  type: string | null | undefined,
): NormalizedCompetition {
  const normalizedType = normalizeScheduleType(type);
  const segments = normalizedType
    ? normalizedType.split(".").filter(Boolean)
    : [];
  const nonTvSegments = segments.filter((segment) => segment !== "tv");
  const isTvGame = segments.includes("tv");

  if (
    nonTvSegments[0] === "league" &&
    (!nonTvSegments[1] ||
      nonTvSegments[1] === "rs" ||
      nonTvSegments[1] === "regularseason")
  ) {
    return {
      competitionKey: "LEAGUE_REGULAR_SEASON",
      competitionLabel: "League regular season",
      isTvGame,
      stageKey: "REGULAR_SEASON",
      stageLabel: "Regular season",
    };
  }

  if (nonTvSegments[0] === "league") {
    const stageKey = normalizeStageKey(nonTvSegments[1] ?? null);
    return {
      competitionKey: "PLAYOFFS",
      competitionLabel: "Playoffs",
      isTvGame,
      stageKey,
      stageLabel: formatStageToken(stageKey),
    };
  }

  if (nonTvSegments[0] === "friendly" || nonTvSegments[0] === "scrimmage") {
    return {
      competitionKey: "SCRIMMAGE",
      competitionLabel: "Scrimmage",
      isTvGame,
      stageKey: null,
      stageLabel: null,
    };
  }

  if (
    nonTvSegments.some(
      (segment) => segment === "private" || segment.startsWith("private"),
    )
  ) {
    return {
      competitionKey: "PRIVATE_LEAGUE",
      competitionLabel: "Private league",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  if (nonTvSegments[0] === "cup") {
    const stageKey = normalizeStageKey(nonTvSegments[1] ?? null);
    return {
      competitionKey: "CUP",
      competitionLabel: "Cup",
      isTvGame,
      stageKey,
      stageLabel: formatStageToken(stageKey),
    };
  }

  if (
    nonTvSegments[0] === "bbb" ||
    normalizedType?.includes("buzzerbeatersbest") ||
    normalizedType?.includes("buzzer-beaters-best")
  ) {
    return {
      competitionKey: "BUZZERBEATER_BEST",
      competitionLabel: "BuzzerBeater's Best",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  if (
    nonTvSegments[0] === "bbm" ||
    normalizedType?.includes("buzzerbeatersmadness") ||
    normalizedType?.includes("buzzer-beaters-madness") ||
    normalizedType?.includes("madness")
  ) {
    return {
      competitionKey: "BUZZERBEATER_MADNESS",
      competitionLabel: "BuzzerBeater Madness",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  return {
    competitionKey: "OTHER",
    competitionLabel: "Other",
    isTvGame,
    stageKey: normalizeStageKey(nonTvSegments[1] ?? nonTvSegments[0] ?? null),
    stageLabel: formatStageToken(
      normalizeStageKey(nonTvSegments[1] ?? nonTvSegments[0] ?? null),
    ),
  };
}

function normalizeScheduleType(type: string | null | undefined): string | null {
  const normalized = type?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeStageKey(value: string | null): string | null {
  return value ? value.replace(/[^a-z0-9]+/g, "_") : null;
}

function formatStageToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/_/g, "");
  const mappedLabel = STAGE_LABELS[normalized];
  if (mappedLabel) {
    return mappedLabel;
  }

  const roundMatch = /^round(\d+)$/.exec(normalized);
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

function toGameDate(startTime: string | null): string | null {
  if (!startTime) {
    return null;
  }

  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) {
    return startTime.slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
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

function buildWarning(failedSeasons: readonly number[]): string | null {
  if (!failedSeasons.length) {
    return null;
  }

  const listedSeasons = failedSeasons.slice(0, 6).join(", ");
  const suffix =
    failedSeasons.length > 6 ? `, and ${failedSeasons.length - 6} more` : "";
  return `Live history is partial. The schedule scan failed for season${failedSeasons.length === 1 ? "" : "s"} ${listedSeasons}${suffix}.`;
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

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
