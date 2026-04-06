import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

import { BBXmlApiClient, type BBXmlApiClientOptions } from "../../../lib/bbapi";
import type {
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiBoxScoreTeam,
  BBApiSchedule,
  BBApiScheduleMatch,
  BBApiScheduleMatchSide,
  BBApiSeasons,
  BBApiStandings,
} from "../../../lib/bbapi/types";
import {
  inferLeagueTimeZone,
  normalizeLeagueTimeZone,
  resolveCalendarDateKey,
} from "../../../lib/league-timezones";
import { resolveBbAccessKey } from "./credentials";
import {
  buildExecutionName,
  startStateMachineExecution,
} from "./step-functions";
import {
  getBbConnection,
  getGameDayRecap,
  getLeagueGameDayRecap,
  getSingleGameSummary,
  updateLeagueGameDayRecap,
  updateGameDayRecap,
  updateSingleGameSummary,
  upsertLeagueGameDayRecap,
  upsertGameDayRecap,
  upsertSingleGameSummary,
  type BbConnectionRecord,
  type GameDayRecapStatus,
} from "./repository";
import { requireFeatureAccess } from "./billing";
import type { PlanId } from "../../../lib/billing/plans";

type GraphqlEnv = Record<string, string | undefined>;

type JsonRecord = Record<string, unknown>;

type TeamStandingSummary = {
  conferenceIndex: number;
  conferencePosition: number;
  losses: number;
  pointMargin: number;
  teamId: string;
  teamName: string;
  wins: number;
};

type TeamSeasonContext = {
  conferenceIndex: number;
  conferencePosition: number;
  currentStreak: string;
  lastFive: string;
  losses: number;
  recentAverageMargin: number | null;
  recentBoxScoreCoverage: number;
  recentMargins: number[];
  recentSignalFlags: string[];
  teamId: string;
  teamName: string;
  wins: number;
};

type GameDayRecapSubmissionRequest = {
  gameDate: string;
  leagueId: string;
};

type LeagueGameDayRecapSubmissionRequest = {
  gameDayNumber: number;
  leagueId: string;
  season: number | null;
};

type SingleGameSummarySubmissionRequest = {
  matchId: string;
};

type RecapJobKind = "LEAGUE_DATE" | "LEAGUE_GAME_DAY" | "SINGLE_GAME";

type RecapQueueMessage = {
  kind: RecapJobKind;
  modelId?: string;
  requestedAt: string;
  targetKey: string;
  userId: string;
};

type CoverageIssue = {
  awayTeamName: string;
  homeTeamName: string;
  matchId: string;
  reason: string;
};

export type GameDayRecapCoveragePayload = {
  availableGames: number;
  missingGames: CoverageIssue[];
  partial: boolean;
  requestedGames: number;
};

export type GameDayRecapResultPayload = {
  games: Array<{
    evidenceTags: GameDayRecapEvidenceTag[];
    headline: string;
    matchId: string;
    writeup: string;
  }>;
  summary: {
    headline: string;
    lede: string;
  };
};

type GameDayRecapPromptPayload = {
  coverage: GameDayRecapCoveragePayload;
  request: {
    gameDate: string | null;
    gameDayNumber: number | null;
    kind: RecapJobKind;
    label: string;
    leagueId: string | null;
    leagueName: string | null;
    matchId: string | null;
    season: number | null;
    timeZone: string | null;
  };
  games: Array<{
    effortDelta: number | null;
    evidenceSignals: string[];
    finalMargin: number;
    matchId: string;
    neutral: boolean | null;
    quarterScores: {
      away: number[];
      home: number[];
    };
    standingsContext: string[];
    teams: {
      away: GameDayRecapPromptTeam;
      home: GameDayRecapPromptTeam;
    };
    type: string | null;
  }>;
};

type GameDayRecapPromptTeam = {
  conferenceIndex: number | null;
  conferencePosition: number | null;
  currentStreak: string;
  defStrategy: string | null;
  efficiency: Record<string, number | string>;
  gdp: Record<string, number | string>;
  lastFive: string;
  name: string;
  offStrategy: string | null;
  ratingSnapshot: Record<string, number | string>;
  recentAverageMargin: number | null;
  recentSignalFlags: string[];
  record: string;
  score: number;
  topPlayers: Array<{
    assists: number;
    blocks: number;
    minutes: number;
    name: string;
    points: number;
    rebounds: number;
    steals: number;
    turnovers: number;
  }>;
};

export type SlateGame = {
  awayTeamId: string;
  awayTeamName: string;
  homeTeamId: string;
  homeTeamName: string;
  matchId: string;
  startTime: string | null;
  type: string | null;
};

type LeagueSlateResolutionDiagnostics = {
  exactMatchCount: number;
  leagueMatchCount: number;
  nearMisses: Array<{
    awayTeamId: string | null;
    awayTeamName: string | null;
    derivedDate: string | null;
    homeTeamId: string | null;
    homeTeamName: string | null;
    matchId: string | null;
    startTime: string | null;
  }>;
  scheduleRowCount: number;
  teamCount: number;
  timeZone: string | null;
};

type BedrockGameDayRecapProvider = {
  generate: (payload: GameDayRecapPromptPayload) => Promise<GameDayRecapResultPayload>;
  modelId: string;
  providerName: "bedrock";
};

type SubmitDependencies = {
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: RecapQueueMessage,
  ) => Promise<string>;
  getGameDayRecap: typeof getGameDayRecap;
  getLeagueGameDayRecap: typeof getLeagueGameDayRecap;
  getSingleGameSummary: typeof getSingleGameSummary;
  now: () => Date;
  requireFeatureAccess: typeof requireFeatureAccess;
  updateLeagueGameDayRecap: typeof updateLeagueGameDayRecap;
  updateGameDayRecap: typeof updateGameDayRecap;
  updateSingleGameSummary: typeof updateSingleGameSummary;
  upsertLeagueGameDayRecap: typeof upsertLeagueGameDayRecap;
  upsertGameDayRecap: typeof upsertGameDayRecap;
  upsertSingleGameSummary: typeof upsertSingleGameSummary;
};

type ProcessDependencies = {
  createBbClient: (options: BBXmlApiClientOptions) => Pick<
    BBXmlApiClient,
    "getBoxScore" | "getSchedule" | "getSeasons" | "getStandings" | "getTeamInfo"
  > &
    Partial<
      Pick<
        BBXmlApiClient,
      "getSeasonsXml"
      >
    >;
  createProvider: (args: {
    modelId: string;
    region: string | undefined;
  }) => BedrockGameDayRecapProvider;
  getBbConnection: typeof getBbConnection;
  getGameDayRecap: typeof getGameDayRecap;
  getLeagueGameDayRecap: typeof getLeagueGameDayRecap;
  getSingleGameSummary: typeof getSingleGameSummary;
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  updateLeagueGameDayRecap: typeof updateLeagueGameDayRecap;
  updateGameDayRecap: typeof updateGameDayRecap;
  updateSingleGameSummary: typeof updateSingleGameSummary;
};

type SubmitDependencyOverrides = Partial<SubmitDependencies>;
type ProcessDependencyOverrides = Partial<ProcessDependencies>;

const GAME_DAY_RECAP_PROMPT_VERSION = "gameday-recap-v1";
const GAME_DAY_RECAP_MODEL_ENV_NAME = "GAME_DAY_RECAP_MODEL_ID";
const GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME = "GAME_DAY_RECAP_MODEL_ID_PREMIUM";
const TERMINAL_RECAP_STATUSES = new Set<GameDayRecapStatus>([
  "FAILED",
  "SUCCEEDED",
]);
const SUPPORTED_COMMERCIAL_REGION_PATTERN =
  /^(af|ap|ca|eu|il|me|sa|us)-[a-z]+-\d+$/;
const SUPPORTED_STRUCTURED_OUTPUT_MODEL_PATTERNS = [
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-haiku-4-5-20251001-v1:0$/i,
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-sonnet-4-5-20250929-v1:0$/i,
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-opus-4-5-20251101-v1:0$/i,
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-opus-4-6-v1$/i,
  /^qwen\.qwen3-235b-a22b-2507-v1:0$/i,
  /^qwen\.qwen3-32b-v1:0$/i,
  /^qwen\.qwen3-coder-30b-a3b-v1:0$/i,
  /^qwen\.qwen3-coder-480b-a35b-v1:0$/i,
  /^qwen\.qwen3-next-80b-a3b$/i,
  /^qwen\.qwen3-vl-235b-a22b$/i,
  /^openai\.gpt-oss-120b-1:0$/i,
  /^openai\.gpt-oss-20b-1:0$/i,
  /^openai\.gpt-oss-safeguard-120b$/i,
  /^openai\.gpt-oss-safeguard-20b$/i,
  /^deepseek\.v3-v1:0$/i,
  /^google\.gemma-3-12b-it$/i,
  /^google\.gemma-3-27b-it$/i,
  /^minimax\.minimax-m2$/i,
  /^mistral\.magistral-small-2509$/i,
  /^mistral\.ministral-3-3b-instruct$/i,
  /^mistral\.ministral-3-8b-instruct$/i,
  /^mistral\.ministral-3-14b-instruct$/i,
  /^mistral\.mistral-large-3-675b-instruct$/i,
  /^mistral\.voxtral-mini-3b-2507$/i,
  /^mistral\.voxtral-small-24b-2507$/i,
  /^moonshot\.kimi-k2-thinking$/i,
  /^nvidia\.nemotron-nano-12b-v2$/i,
  /^nvidia\.nemotron-nano-9b-v2$/i,
];
const GAME_DAY_RECAP_EVIDENCE_TAGS = [
  "blowout",
  "close_finish",
  "deemphasis_signal",
  "effort_gap",
  "losing_streak",
  "quarter_turn",
  "recent_form",
  "standings_race",
  "top_performance",
  "winning_streak",
] as const;
const GAME_DAY_RECAP_RESULT_SCHEMA = {
  additionalProperties: false,
  properties: {
    games: {
      items: {
        additionalProperties: false,
        properties: {
          evidenceTags: {
            items: {
              enum: [...GAME_DAY_RECAP_EVIDENCE_TAGS],
              type: "string",
            },
            type: "array",
          },
          headline: {
            maxLength: 160,
            minLength: 8,
            type: "string",
          },
          matchId: {
            minLength: 1,
            type: "string",
          },
          writeup: {
            maxLength: 1400,
            minLength: 80,
            type: "string",
          },
        },
        required: ["matchId", "headline", "writeup", "evidenceTags"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
    summary: {
      additionalProperties: false,
      properties: {
        headline: {
          maxLength: 160,
          minLength: 8,
          type: "string",
        },
        lede: {
          maxLength: 320,
          minLength: 40,
          type: "string",
        },
      },
      required: ["headline", "lede"],
      type: "object",
    },
  },
  required: ["summary", "games"],
  type: "object",
} as const;
const GAME_DAY_RECAP_LOG_PREFIX = "[game-day-recap]";

type GameDayRecapEvidenceTag = (typeof GAME_DAY_RECAP_EVIDENCE_TAGS)[number];

const defaultSubmitDependencies: SubmitDependencies = {
  startWorkflowExecution: async (stateMachineArn, executionName, message) => {
    return startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    });
  },
  getGameDayRecap,
  getLeagueGameDayRecap,
  getSingleGameSummary,
  now: () => new Date(),
  requireFeatureAccess,
  updateLeagueGameDayRecap,
  updateGameDayRecap,
  updateSingleGameSummary,
  upsertLeagueGameDayRecap,
  upsertGameDayRecap,
  upsertSingleGameSummary,
};

const defaultProcessDependencies: ProcessDependencies = {
  createBbClient: (options) => new BBXmlApiClient(options),
  createProvider: ({ modelId, region }) =>
    createBedrockGameDayRecapProvider({
      modelId,
      region,
    }),
  getBbConnection,
  getGameDayRecap,
  getLeagueGameDayRecap,
  getSingleGameSummary,
  now: () => new Date(),
  resolveBbAccessKey,
  updateLeagueGameDayRecap,
  updateGameDayRecap,
  updateSingleGameSummary,
};

export async function submitGameDayRecap(
  args: {
    env: GraphqlEnv;
    gameDate: string;
    identity: unknown;
    leagueId: string;
    stateMachineArn: string;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<{ executionArn: string | null; targetKey: string }> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  logGameDayRecapInfo("submit.received", {
    gameDate: args.gameDate,
    leagueId: args.leagueId,
    userId,
  });

  const planId = await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });

  const request = normalizeGameDayRecapRequest({
    gameDate: args.gameDate,
    leagueId: args.leagueId,
  });
  const targetKey = buildGameDayRecapTargetKey(request.leagueId, request.gameDate);
  const existing = await deps.getGameDayRecap(args.env, userId, targetKey);

  logGameDayRecapInfo("submit.normalized", {
    existingRequestedAt: existing?.requestedAt ?? null,
    existingStatus: existing?.status ?? null,
    gameDate: request.gameDate,
    leagueId: request.leagueId,
    targetKey,
    userId,
  });

  if (existing && !TERMINAL_RECAP_STATUSES.has(existing.status)) {
    logGameDayRecapInfo("submit.skipped_active_job", {
      existingRequestedAt: existing.requestedAt,
      existingStatus: existing.status,
      targetKey,
      userId,
    });
    return {
      executionArn: existing.executionArn ?? null,
      targetKey,
    };
  }

  const modelId = resolveConfiguredRecapModelId(args.env, planId);
  const requestedAt = deps.now().toISOString();

  logGameDayRecapInfo("submit.persisting_job", {
    modelId,
    planId,
    requestedAt,
    targetKey,
    userId,
  });

  await deps.upsertGameDayRecap(args.env, {
    completedAt: null,
    coverageJson: null,
    error: null,
    gameDate: request.gameDate,
    leagueId: request.leagueId,
    leagueName: existing?.leagueName ?? null,
    modelId,
    modelProvider: "bedrock",
    promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
    requestJson: {
      gameDate: request.gameDate,
      leagueId: request.leagueId,
      mode: "FULL_SLATE",
    },
    requestedAt,
    resultJson: null,
    season: null,
    status: "QUEUED",
    targetKey,
    userId,
    executionArn: null,
  });

  try {
    logGameDayRecapInfo("submit.execution.start", {
      requestedAt,
      targetKey,
      userId,
    });
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "gameday-recap",
        `${userId}:${targetKey}:${requestedAt}`,
      ),
      {
      kind: "LEAGUE_DATE",
      modelId,
      requestedAt,
      targetKey,
      userId,
      },
    );
    await deps.updateGameDayRecap(args.env, {
      executionArn,
      targetKey,
      userId,
    });
    logGameDayRecapInfo("submit.execution.succeeded", {
      executionArn,
      requestedAt,
      targetKey,
      userId,
    });
    return { executionArn, targetKey };
  } catch (error) {
    logGameDayRecapError("submit.execution.failed", {
      requestedAt,
      targetKey,
      userId,
      ...toLoggableError(error),
    });
    await deps.updateGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      modelId,
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }

}

export async function submitLeagueGameDayRecap(
  args: {
    env: GraphqlEnv;
    gameDayNumber: number;
    identity: unknown;
    leagueId: string;
    stateMachineArn: string;
    season?: number | null;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<{ executionArn: string | null; targetKey: string }> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const planId = await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });

  const request = normalizeLeagueGameDayRecapRequest({
    gameDayNumber: args.gameDayNumber,
    leagueId: args.leagueId,
    season: args.season ?? null,
  });
  const targetKey = buildLeagueGameDayRecapTargetKey(
    request.leagueId,
    request.gameDayNumber,
    request.season,
  );
  const existing = await deps.getLeagueGameDayRecap(
    args.env,
    userId,
    targetKey,
  );
  if (existing && !TERMINAL_RECAP_STATUSES.has(existing.status)) {
    return {
      executionArn: existing.executionArn ?? null,
      targetKey,
    };
  }

  const modelId = resolveConfiguredRecapModelId(args.env, planId);
  const requestedAt = deps.now().toISOString();
  await deps.upsertLeagueGameDayRecap(args.env, {
    completedAt: null,
    coverageJson: null,
    error: null,
    gameDayNumber: request.gameDayNumber,
    leagueId: request.leagueId,
    leagueName: existing?.leagueName ?? null,
    modelId,
    modelProvider: "bedrock",
    promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
    requestJson: {
      gameDayNumber: request.gameDayNumber,
      leagueId: request.leagueId,
      mode: "LEAGUE_GAME_DAY",
      season: request.season,
    },
    requestedAt,
    resultJson: null,
    season: request.season,
    status: "QUEUED",
    targetKey,
    userId,
    executionArn: null,
  });

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "league-gameday-recap",
        `${userId}:${targetKey}:${requestedAt}`,
      ),
      {
      kind: "LEAGUE_GAME_DAY",
      modelId,
      requestedAt,
      targetKey,
      userId,
      },
    );
    await deps.updateLeagueGameDayRecap(args.env, {
      executionArn,
      targetKey,
      userId,
    });
    return { executionArn, targetKey };
  } catch (error) {
    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      modelId,
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }
}

export async function submitSingleGameSummary(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    matchId: string;
    stateMachineArn: string;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<{ executionArn: string | null; targetKey: string }> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const planId = await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });

  const request = normalizeSingleGameSummaryRequest({
    matchId: args.matchId,
  });
  const targetKey = buildSingleGameSummaryTargetKey(request.matchId);
  const existing = await deps.getSingleGameSummary(
    args.env,
    userId,
    targetKey,
  );
  if (existing && !TERMINAL_RECAP_STATUSES.has(existing.status)) {
    return {
      executionArn: existing.executionArn ?? null,
      targetKey,
    };
  }

  const modelId = resolveConfiguredRecapModelId(args.env, planId);
  const requestedAt = deps.now().toISOString();
  await deps.upsertSingleGameSummary(args.env, {
    completedAt: null,
    coverageJson: null,
    error: null,
    gameDate: existing?.gameDate ?? null,
    leagueId: existing?.leagueId ?? null,
    leagueName: existing?.leagueName ?? null,
    matchId: request.matchId,
    modelId,
    modelProvider: "bedrock",
    promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
    requestJson: {
      matchId: request.matchId,
      mode: "SINGLE_GAME",
    },
    requestedAt,
    resultJson: null,
    season: existing?.season ?? null,
    status: "QUEUED",
    targetKey,
    userId,
    executionArn: null,
  });

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "single-game-summary",
        `${userId}:${targetKey}:${requestedAt}`,
      ),
      {
      kind: "SINGLE_GAME",
      modelId,
      requestedAt,
      targetKey,
      userId,
      },
    );
    await deps.updateSingleGameSummary(args.env, {
      executionArn,
      targetKey,
      userId,
    });
    return { executionArn, targetKey };
  } catch (error) {
    await deps.updateSingleGameSummary(args.env, {
      completedAt: deps.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      modelId,
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }
}

export async function processGameDayRecap(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage(args);
  const modelId = resolveQueuedRecapModelId(message, args.modelId);
  logGameDayRecapInfo("process.message.received", {
    modelId,
    requestedAt: message.requestedAt,
    targetKey: message.targetKey,
    userId: message.userId,
  });
  const recap = await deps.getGameDayRecap(
    args.env,
    message.userId,
    message.targetKey,
  );
  if (!recap || recap.userId !== message.userId) {
    throw new Error(
      "Game day recap request is missing or no longer belongs to the enqueued user.",
    );
  }

  logGameDayRecapInfo("process.recap.loaded", {
    completedAt: recap.completedAt,
    requestedAt: recap.requestedAt,
    status: recap.status,
    targetKey: recap.targetKey,
    userId: recap.userId,
  });

  if (
    recap.requestedAt !== message.requestedAt ||
    (recap.status === "SUCCEEDED" && recap.completedAt)
  ) {
    logGameDayRecapInfo("process.skipped_stale_or_completed", {
      recapCompletedAt: recap.completedAt,
      recapRequestedAt: recap.requestedAt,
      recapStatus: recap.status,
      requestedAt: message.requestedAt,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    return;
  }

  let coverage: GameDayRecapCoveragePayload | null = null;

  try {
    logGameDayRecapInfo("process.status_transition", {
      nextStatus: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    await deps.updateGameDayRecap(args.env, {
      error: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const connection = await requireBbConnection(
      args.env,
      recap.userId,
      deps,
    );
    const accessKey = await deps.resolveBbAccessKey(args.env, recap.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });

    logGameDayRecapInfo("process.bb_connection.ready", {
      bbLoginName: connection.bbLoginName,
      gameDate: recap.gameDate,
      leagueId: recap.leagueId,
      leagueTimeZone: resolveLeagueTimeZone(connection, null),
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const { season, slate, standings } = await resolveSeasonedLeagueSlateForRecap({
      bb,
      connection,
      gameDate: recap.gameDate,
      leagueId: recap.leagueId,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    logGameDayRecapInfo("process.status_transition", {
      nextStatus: "BUILDING_CONTEXT",
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    await deps.updateGameDayRecap(args.env, {
      coverageJson: {
        availableGames: 0,
        missingGames: [],
        partial: false,
        requestedGames: slate.length,
      },
      leagueName: standings.league?.name ?? recap.leagueName ?? null,
      season,
      status: "BUILDING_CONTEXT",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const promptPayload = await buildGameDayRecapPromptPayload({
      bb,
      connection,
      requestedGames: slate,
      request: {
        gameDate: recap.gameDate,
        gameDayNumber: null,
        kind: "LEAGUE_DATE",
        label: `${standings.league?.name ?? recap.leagueId} ${recap.gameDate}`,
        leagueId: recap.leagueId,
        leagueName: standings.league?.name ?? recap.leagueName ?? null,
        matchId: null,
        season,
        timeZone: resolveLeagueTimeZone(connection, standings),
      },
      season,
      standings,
    });
    coverage = promptPayload.coverage;

    logGameDayRecapInfo("process.prompt_payload.ready", {
      coverage,
      gameCount: promptPayload.games.length,
      leagueName: promptPayload.request.leagueName,
      season: promptPayload.request.season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    if (!promptPayload.games.length) {
      throw new Error(
        "No completed league games had enough box score coverage to generate a recap.",
      );
    }

    logGameDayRecapInfo("process.status_transition", {
      coverage,
      nextStatus: "INVOKING_MODEL",
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    await deps.updateGameDayRecap(args.env, {
      coverageJson: coverage,
      leagueName: promptPayload.request.leagueName,
      season,
      status: "INVOKING_MODEL",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const provider = deps.createProvider({
      modelId,
      region: args.region,
    });
    logGameDayRecapInfo("process.provider.ready", {
      modelId: provider.modelId,
      providerName: provider.providerName,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    const result = await provider.generate(promptPayload);
    logGameDayRecapInfo("process.provider.succeeded", {
      gameCount: result.games.length,
      summaryHeadline: result.summary.headline,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    await deps.updateGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: null,
      leagueName: promptPayload.request.leagueName,
      modelId: provider.modelId,
      modelProvider: provider.providerName,
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      resultJson: result,
      season,
      status: "SUCCEEDED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    logGameDayRecapInfo("process.completed", {
      coverage,
      finalStatus: "SUCCEEDED",
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
  } catch (error) {
    logGameDayRecapError("process.failed", {
      coverage,
      targetKey: recap.targetKey,
      userId: recap.userId,
      ...toLoggableError(error),
    });
    await deps.updateGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: error instanceof Error ? error.message : String(error),
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "FAILED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    throw error;
  }
}

export async function processQueuedRecapJob(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const message = resolveRecapMessage(args);
  switch (message.kind) {
    case "LEAGUE_GAME_DAY":
      await processLeagueGameDayRecap(args, dependencies);
      return;
    case "SINGLE_GAME":
      await processSingleGameSummary(args, dependencies);
      return;
    case "LEAGUE_DATE":
    default:
      await processGameDayRecap(args, dependencies);
  }
}

export async function processLeagueGameDayRecap(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage(args);
  const modelId = resolveQueuedRecapModelId(message, args.modelId);
  const recap = await deps.getLeagueGameDayRecap(
    args.env,
    message.userId,
    message.targetKey,
  );
  if (!recap || recap.userId !== message.userId) {
    throw new Error(
      "League game day recap request is missing or no longer belongs to the enqueued user.",
    );
  }
  if (
    recap.requestedAt !== message.requestedAt ||
    (recap.status === "SUCCEEDED" && recap.completedAt)
  ) {
    return;
  }

  let coverage: GameDayRecapCoveragePayload | null = null;

  try {
    await deps.updateLeagueGameDayRecap(args.env, {
      error: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const connection = await requireBbConnection(args.env, recap.userId, deps);
    const accessKey = await deps.resolveBbAccessKey(args.env, recap.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });

    const standings =
      recap.season !== null && recap.season !== undefined
        ? await bb.getStandings(recap.leagueId, recap.season)
        : await bb.getStandings(recap.leagueId);
    const season = standings.season ?? recap.season;
    if (season === null || season === undefined) {
      throw new Error(`Unable to resolve a season for league ${recap.leagueId}.`);
    }

    const slate = await resolveLeagueGameDaySlate({
      bb,
      gameDayNumber: recap.gameDayNumber,
      standings,
    });
    if (!slate.length) {
      throw new Error(
        `No regular-season league games were found for league ${recap.leagueId} on game day ${recap.gameDayNumber}.`,
      );
    }

    await deps.updateLeagueGameDayRecap(args.env, {
      coverageJson: {
        availableGames: 0,
        missingGames: [],
        partial: false,
        requestedGames: slate.length,
      },
      leagueName: standings.league?.name ?? recap.leagueName ?? null,
      season,
      status: "BUILDING_CONTEXT",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const promptPayload = await buildGameDayRecapPromptPayload({
      bb,
      connection,
      requestedGames: slate,
      request: {
        gameDate: null,
        gameDayNumber: recap.gameDayNumber,
        kind: "LEAGUE_GAME_DAY",
        label: `${standings.league?.name ?? recap.leagueId} game day ${recap.gameDayNumber}`,
        leagueId: recap.leagueId,
        leagueName: standings.league?.name ?? recap.leagueName ?? null,
        matchId: null,
        season,
        timeZone: null,
      },
      season,
      standings,
    });
    coverage = promptPayload.coverage;

    if (!promptPayload.games.length) {
      throw new Error(
        "No completed regular-season league games had enough box score coverage to generate a recap.",
      );
    }

    await deps.updateLeagueGameDayRecap(args.env, {
      coverageJson: coverage,
      leagueName: promptPayload.request.leagueName,
      season,
      status: "INVOKING_MODEL",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const provider = deps.createProvider({
      modelId,
      region: args.region,
    });
    const result = await provider.generate(promptPayload);

    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: null,
      leagueName: promptPayload.request.leagueName,
      modelId: provider.modelId,
      modelProvider: provider.providerName,
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      resultJson: result,
      season,
      status: "SUCCEEDED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
  } catch (error) {
    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: error instanceof Error ? error.message : String(error),
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "FAILED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    throw error;
  }
}

export async function processSingleGameSummary(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage(args);
  const modelId = resolveQueuedRecapModelId(message, args.modelId);
  const summary = await deps.getSingleGameSummary(
    args.env,
    message.userId,
    message.targetKey,
  );
  if (!summary || summary.userId !== message.userId) {
    throw new Error(
      "Single game summary request is missing or no longer belongs to the enqueued user.",
    );
  }
  if (
    summary.requestedAt !== message.requestedAt ||
    (summary.status === "SUCCEEDED" && summary.completedAt)
  ) {
    return;
  }

  let coverage: GameDayRecapCoveragePayload | null = null;

  try {
    await deps.updateSingleGameSummary(args.env, {
      error: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "RESOLVING_SLATE",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });

    const connection = await requireBbConnection(args.env, summary.userId, deps);
    const accessKey = await deps.resolveBbAccessKey(args.env, summary.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });
    const boxScore = await bb.getBoxScore(summary.matchId);
    if (boxScore.homeTeam.score === null || boxScore.awayTeam.score === null) {
      throw new Error(`Match ${summary.matchId} does not have a final box score yet.`);
    }

    const promptPayload = await buildSingleGameSummaryPromptPayload({
      bb,
      boxScore,
      connection,
      matchId: summary.matchId,
    });
    coverage = promptPayload.coverage;

    await deps.updateSingleGameSummary(args.env, {
      coverageJson: coverage,
      gameDate: promptPayload.request.gameDate,
      leagueId: promptPayload.request.leagueId,
      leagueName: promptPayload.request.leagueName,
      season: promptPayload.request.season,
      status: "INVOKING_MODEL",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });

    const provider = deps.createProvider({
      modelId,
      region: args.region,
    });
    const result = await provider.generate(promptPayload);

    await deps.updateSingleGameSummary(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: null,
      gameDate: promptPayload.request.gameDate,
      leagueId: promptPayload.request.leagueId,
      leagueName: promptPayload.request.leagueName,
      modelId: provider.modelId,
      modelProvider: provider.providerName,
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      resultJson: result,
      season: promptPayload.request.season,
      status: "SUCCEEDED",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });
  } catch (error) {
    await deps.updateSingleGameSummary(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: error instanceof Error ? error.message : String(error),
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "FAILED",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });
    throw error;
  }
}

export function normalizeGameDayRecapRequest(
  input: unknown,
): GameDayRecapSubmissionRequest {
  const record = requireRecord(input, "Game day recap request");
  const leagueId = asOptionalString(record.leagueId)?.trim();
  const gameDate = asOptionalString(record.gameDate)?.trim();

  if (!leagueId) {
    throw new Error("Game day recap requests require a leagueId.");
  }
  if (!gameDate || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
    throw new Error("Game day recap requests require a YYYY-MM-DD gameDate.");
  }
  if (!Number.isFinite(Date.parse(`${gameDate}T00:00:00Z`))) {
    throw new Error("Game day recap gameDate must be a valid calendar date.");
  }

  return {
    gameDate,
    leagueId,
  };
}

export function normalizeLeagueGameDayRecapRequest(
  input: unknown,
): LeagueGameDayRecapSubmissionRequest {
  const record = requireRecord(input, "League game day recap request");
  const leagueId = asOptionalString(record.leagueId)?.trim();
  const gameDayNumber = asOptionalNumber(record.gameDayNumber);
  const season = asOptionalNumber(record.season);

  if (!leagueId) {
    throw new Error("League game day recaps require a leagueId.");
  }
  if (
    gameDayNumber === null ||
    !Number.isInteger(gameDayNumber) ||
    gameDayNumber < 1 ||
    gameDayNumber > 22
  ) {
    throw new Error("League game day recaps require a gameDayNumber from 1 to 22.");
  }
  if (season !== null && (!Number.isInteger(season) || season < 1)) {
    throw new Error("League game day recap season must be a positive integer.");
  }

  return {
    gameDayNumber,
    leagueId,
    season,
  };
}

export function normalizeSingleGameSummaryRequest(
  input: unknown,
): SingleGameSummarySubmissionRequest {
  const record = requireRecord(input, "Single game summary request");
  const matchId = asOptionalString(record.matchId)?.trim();
  if (!matchId || !/^\d+$/.test(matchId)) {
    throw new Error("Single game summaries require a numeric matchId.");
  }

  return { matchId };
}

export function buildGameDayRecapTargetKey(
  leagueId: string,
  gameDate: string,
): string {
  return `${leagueId}#${gameDate}`;
}

export function buildLeagueGameDayRecapTargetKey(
  leagueId: string,
  gameDayNumber: number,
  season: number | null,
): string {
  return `${leagueId}#${season ?? "current"}#gameday-${gameDayNumber}`;
}

export function buildSingleGameSummaryTargetKey(matchId: string): string {
  return matchId;
}

export function parseGameDayRecapQueueMessage(
  messageBody: string,
): RecapQueueMessage {
  const payload = requireRecord(JSON.parse(messageBody), "Game day recap queue message");
  const rawKind = asOptionalString(payload.kind)?.trim();
  const modelId = asOptionalString(payload.modelId)?.trim();
  const userId = asOptionalString(payload.userId)?.trim();
  const targetKey = asOptionalString(payload.targetKey)?.trim();
  const requestedAt = asOptionalString(payload.requestedAt)?.trim();
  const kind = rawKind ?? "LEAGUE_DATE";

  if (
    !userId ||
    !targetKey ||
    !requestedAt ||
    (kind !== "LEAGUE_DATE" &&
      kind !== "LEAGUE_GAME_DAY" &&
      kind !== "SINGLE_GAME")
  ) {
    throw new Error(
      "Game day recap queue message must include kind, userId, targetKey, and requestedAt.",
    );
  }

  return {
    kind,
    ...(modelId ? { modelId } : {}),
    requestedAt,
    targetKey,
    userId,
  };
}

function resolveRecapMessage(args: {
  message?: RecapQueueMessage;
  messageBody?: string;
}): RecapQueueMessage {
  if (args.message) {
    return args.message;
  }
  if (!args.messageBody) {
    throw new Error("Game day recap payload was not provided.");
  }
  return parseGameDayRecapQueueMessage(args.messageBody);
}

function resolveConfiguredRecapModelId(
  env: GraphqlEnv,
  planId: PlanId,
): string {
  const defaultModelId = normalizeConfiguredRecapModelId(
    env[GAME_DAY_RECAP_MODEL_ENV_NAME],
    GAME_DAY_RECAP_MODEL_ENV_NAME,
    true,
  );
  if (!defaultModelId) {
    throw new Error(`${GAME_DAY_RECAP_MODEL_ENV_NAME} must be set for recap generation.`);
  }
  const premiumModelId = normalizeConfiguredRecapModelId(
    env[GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME],
    GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME,
    false,
  );

  if (planId === "premium" && premiumModelId) {
    return premiumModelId;
  }

  return defaultModelId;
}

function normalizeConfiguredRecapModelId(
  value: string | undefined,
  envName: string,
  required: boolean,
): string | null {
  const modelId = value?.trim() ?? "";
  if (!modelId) {
    if (required) {
      throw new Error(`${envName} must be set for recap generation.`);
    }
    return null;
  }

  assertSupportedBedrockRecapModelId(modelId, envName);
  return modelId;
}

function resolveQueuedRecapModelId(
  message: RecapQueueMessage,
  fallbackModelId: string | undefined,
): string {
  const resolvedModelId = message.modelId?.trim() || fallbackModelId?.trim();
  if (!resolvedModelId) {
    throw new Error(
      "Game day recap worker could not resolve a modelId from the queue message or GAME_DAY_RECAP_MODEL_ID.",
    );
  }

  return resolvedModelId;
}

export function resolveSeasonForDate(
  seasons: BBApiSeasons,
  gameDate: string,
): number {
  const matchTimestamp = parseDateOnlyToTimestamp(gameDate);
  const diagnostics = summarizeSeasonDiagnostics(seasons, gameDate);
  logGameDayRecapInfo("resolveSeasonForDate.evaluate", {
    gameDate,
    matchTimestamp: toFiniteNumberOrNull(matchTimestamp),
    seasons: diagnostics,
  });
  if (!Number.isFinite(matchTimestamp)) {
    logGameDayRecapWarn("resolveSeasonForDate.invalid_game_date", {
      gameDate,
      matchTimestamp: toFiniteNumberOrNull(matchTimestamp),
    });
    throw new Error(`Unable to resolve season for invalid date ${gameDate}.`);
  }

  const matchedSeason = diagnostics.find((season) => season.matchesGameDate);

  if (matchedSeason?.id !== null && matchedSeason?.id !== undefined) {
    logGameDayRecapInfo("resolveSeasonForDate.matched", {
      gameDate,
      seasonId: matchedSeason.id,
    });
    return matchedSeason.id;
  }

  logGameDayRecapWarn("resolveSeasonForDate.no_match", {
    gameDate,
    matchTimestamp: toFiniteNumberOrNull(matchTimestamp),
    seasons: diagnostics,
  });
  throw new Error(`Unable to resolve a BuzzerBeater season for ${gameDate}.`);
}

export async function resolveLeagueDaySlate(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  gameDate: string;
  standings: BBApiStandings;
  timeZone?: string | null;
}): Promise<SlateGame[]> {
  const { slate } = await resolveLeagueDaySlateWithDiagnostics(args);
  return slate;
}

async function resolveLeagueDaySlateWithDiagnostics(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  gameDate: string;
  standings: BBApiStandings;
  timeZone?: string | null;
}): Promise<{
  diagnostics: LeagueSlateResolutionDiagnostics;
  slate: SlateGame[];
}> {
  const standingTeams = extractStandingTeams(args.standings);
  if (!standingTeams.size) {
    return {
      diagnostics: {
        exactMatchCount: 0,
        leagueMatchCount: 0,
        nearMisses: [],
        scheduleRowCount: 0,
        teamCount: 0,
        timeZone: normalizeLeagueTimeZone(args.timeZone),
      },
      slate: [],
    };
  }

  const schedules = await Promise.all(
    Array.from(standingTeams.keys()).map(async (teamId) =>
      args.bb.getSchedule(teamId, args.standings.season ?? undefined),
    ),
  );

  const slateByMatchId = new Map<string, SlateGame>();
  const diagnostics: LeagueSlateResolutionDiagnostics = {
    exactMatchCount: 0,
    leagueMatchCount: 0,
    nearMisses: [],
    scheduleRowCount: 0,
    teamCount: standingTeams.size,
    timeZone: normalizeLeagueTimeZone(args.timeZone),
  };

  for (const schedule of schedules) {
    for (const match of schedule.matches) {
      diagnostics.scheduleRowCount += 1;
      const matchId = match.id?.trim();

      const homeTeamId = match.homeTeam.id?.trim();
      const awayTeamId = match.awayTeam.id?.trim();
      if (
        !homeTeamId ||
        !awayTeamId ||
        !standingTeams.has(homeTeamId) ||
        !standingTeams.has(awayTeamId) ||
        !isLeagueScheduleMatchType(match.type)
      ) {
        continue;
      }

      diagnostics.leagueMatchCount += 1;

      const matchDate = resolveCalendarDateKey(match.startTime, diagnostics.timeZone);
      if (!matchId || matchDate !== args.gameDate) {
        if (diagnostics.nearMisses.length < 3) {
          diagnostics.nearMisses.push({
            awayTeamId,
            awayTeamName: match.awayTeam.teamName ?? null,
            derivedDate: matchDate,
            homeTeamId,
            homeTeamName: match.homeTeam.teamName ?? null,
            matchId: matchId ?? null,
            startTime: match.startTime,
          });
        }
        continue;
      }

      diagnostics.exactMatchCount += 1;

      if (!slateByMatchId.has(matchId)) {
        slateByMatchId.set(matchId, {
          awayTeamId,
          awayTeamName: match.awayTeam.teamName ?? standingTeams.get(awayTeamId)?.teamName ?? "Away team",
          homeTeamId,
          homeTeamName: match.homeTeam.teamName ?? standingTeams.get(homeTeamId)?.teamName ?? "Home team",
          matchId,
          startTime: match.startTime,
          type: match.type,
        });
      }
    }
  }

  return {
    diagnostics,
    slate: Array.from(slateByMatchId.values()).sort((left, right) =>
      compareTimestamps(left.startTime, right.startTime),
    ),
  };
}

export async function resolveLeagueGameDaySlate(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  gameDayNumber: number;
  standings: BBApiStandings;
}): Promise<SlateGame[]> {
  const standingTeams = extractStandingTeams(args.standings);
  if (!standingTeams.size) {
    return [];
  }

  const schedules = await Promise.all(
    Array.from(standingTeams.keys()).map(async (teamId) =>
      args.bb.getSchedule(teamId, args.standings.season ?? undefined),
    ),
  );

  const slateByMatchId = new Map<
    string,
    SlateGame & {
      gameDayNumbers: Set<number>;
    }
  >();

  for (const schedule of schedules) {
    const regularSeasonMatches = schedule.matches
      .filter((match) => isRegularSeasonLeagueMatchType(match.type))
      .sort((left, right) => compareTimestamps(left.startTime, right.startTime));

    regularSeasonMatches.forEach((match, index) => {
      const gameDayNumber = index + 1;
      const matchId = match.id?.trim();
      const homeTeamId = match.homeTeam.id?.trim();
      const awayTeamId = match.awayTeam.id?.trim();
      if (
        !matchId ||
        !homeTeamId ||
        !awayTeamId ||
        !standingTeams.has(homeTeamId) ||
        !standingTeams.has(awayTeamId)
      ) {
        return;
      }

      const existing = slateByMatchId.get(matchId);
      if (existing) {
        existing.gameDayNumbers.add(gameDayNumber);
        return;
      }

      slateByMatchId.set(matchId, {
        awayTeamId,
        awayTeamName:
          match.awayTeam.teamName ??
          standingTeams.get(awayTeamId)?.teamName ??
          "Away team",
        gameDayNumbers: new Set([gameDayNumber]),
        homeTeamId,
        homeTeamName:
          match.homeTeam.teamName ??
          standingTeams.get(homeTeamId)?.teamName ??
          "Home team",
        matchId,
        startTime: match.startTime,
        type: match.type,
      });
    });
  }

  return Array.from(slateByMatchId.values())
    .filter((game) => game.gameDayNumbers.has(args.gameDayNumber))
    .sort((left, right) => compareTimestamps(left.startTime, right.startTime))
    .map(({ gameDayNumbers: _gameDayNumbers, ...game }) => game);
}

function isLeagueScheduleMatchType(type: string | null | undefined): boolean {
  const normalizedType = type?.trim().toLowerCase();
  return Boolean(
    normalizedType &&
      (normalizedType === "league" || normalizedType.startsWith("league.")),
  );
}

function isRegularSeasonLeagueMatchType(type: string | null | undefined): boolean {
  const normalizedType = type?.trim().toLowerCase();
  return Boolean(
    normalizedType &&
      (normalizedType === "league" ||
        normalizedType === "league.rs" ||
        normalizedType === "league.regularseason"),
  );
}

export function buildGameDayRecapBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapPromptPayload;
}) {
  return {
    inferenceConfig: {
      maxTokens: 5000,
      temperature: 0.8,
    },
    messages: [
      {
        content: [
          {
            text: JSON.stringify(
              {
                instructions: {
                  evidenceTags: GAME_DAY_RECAP_EVIDENCE_TAGS,
                  goals: [
                    "Write a concise headline and lede for the requested recap scope.",
                    "Write one reporter-style recap for each completed game in medium length.",
                    "Use only the provided evidence and keep any strategic de-emphasis language cautious.",
                  ],
                },
                recapContext: args.payload,
              },
              null,
              2,
            ),
          },
        ],
        role: "user" as const,
      },
    ],
    modelId: args.modelId,
    outputConfig: {
      // The JSON schema is the contract. Prompt text is only for tone and evidence use.
      textFormat: {
        structure: {
          jsonSchema: {
            description:
              "Reporter-style basketball recap output for one requested scope.",
            name: "game_day_recap",
            schema: JSON.stringify(GAME_DAY_RECAP_RESULT_SCHEMA),
          },
        },
        type: "json_schema" as const,
      },
    },
    system: [
      {
        text: [
          "You are writing basketball recaps for the requested game or slate.",
          "Use only supplied facts. Do not invent transfers, injuries, off-court news, or play-by-play.",
          "If the evidence suggests one side may have treated the game as lower priority, phrase it cautiously and never call it a punt unless the evidence is explicit.",
          "Headlines should be vivid but factual.",
        ].join(" "),
      },
    ],
  };
}

function assertSupportedBedrockRecapModelId(
  modelId: string,
  envName = GAME_DAY_RECAP_MODEL_ENV_NAME,
): void {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) {
    throw new Error(`${envName} must not be empty.`);
  }

  const supported = SUPPORTED_STRUCTURED_OUTPUT_MODEL_PATTERNS.some((pattern) =>
    pattern.test(normalizedModelId),
  );
  if (!supported) {
    throw new Error(
      `Model ${normalizedModelId} is not in the verified structured-output allowlist for game day recaps.`,
    );
  }
}

export function assertSupportedBedrockRecapModel(
  modelId: string,
  region: string | undefined,
): void {
  assertSupportedBedrockRecapModelId(modelId);

  const normalizedRegion = region?.trim();
  if (!normalizedRegion || !SUPPORTED_COMMERCIAL_REGION_PATTERN.test(normalizedRegion)) {
    throw new Error(
      `Game day recap structured output currently requires a supported commercial Bedrock region. Received ${normalizedRegion ?? "unknown"}.`,
    );
  }
}

async function buildGameDayRecapPromptPayload(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore" | "getSchedule" | "getTeamInfo">;
  connection: BbConnectionRecord;
  requestedGames: SlateGame[];
  request: GameDayRecapPromptPayload["request"];
  season: number;
  standings: BBApiStandings;
}): Promise<GameDayRecapPromptPayload> {
  const standingsIndex = extractStandingTeams(args.standings);
  const schedules = await Promise.all(
    Array.from(standingsIndex.keys()).map(async (teamId) => [
      teamId,
      await args.bb.getSchedule(teamId, args.season),
    ] as const),
  );
  const scheduleByTeamId = new Map<string, BBApiSchedule>(schedules);
  const boxScoreCache = new Map<string, Promise<BBApiBoxScore | null>>();
  const coverageIssues: CoverageIssue[] = [];
  const promptGames: GameDayRecapPromptPayload["games"] = [];

  for (const requestedGame of args.requestedGames) {
    const boxScore = await loadBoxScore(args.bb, boxScoreCache, requestedGame.matchId);
    if (
      !boxScore ||
      boxScore.homeTeam.score === null ||
      boxScore.awayTeam.score === null
    ) {
      coverageIssues.push({
        awayTeamName: requestedGame.awayTeamName,
        homeTeamName: requestedGame.homeTeamName,
        matchId: requestedGame.matchId,
        reason: boxScore ? "final box score was incomplete" : "final box score was unavailable",
      });
      continue;
    }

    const homeSchedule = scheduleByTeamId.get(requestedGame.homeTeamId);
    const awaySchedule = scheduleByTeamId.get(requestedGame.awayTeamId);
    const homeStanding = standingsIndex.get(requestedGame.homeTeamId);
    const awayStanding = standingsIndex.get(requestedGame.awayTeamId);
    if (!homeSchedule || !awaySchedule || !homeStanding || !awayStanding) {
      coverageIssues.push({
        awayTeamName: requestedGame.awayTeamName,
        homeTeamName: requestedGame.homeTeamName,
        matchId: requestedGame.matchId,
        reason: "team context could not be resolved from standings or schedules",
      });
      continue;
    }

    const [homeRecentBoxScores, awayRecentBoxScores] = await Promise.all([
      loadRecentCompletedBoxScores({
        bb: args.bb,
        boxScoreCache,
        gameStartTime: requestedGame.startTime,
        limit: 3,
        schedule: homeSchedule,
      }),
      loadRecentCompletedBoxScores({
        bb: args.bb,
        boxScoreCache,
        gameStartTime: requestedGame.startTime,
        limit: 3,
        schedule: awaySchedule,
      }),
    ]);

    const homeContext = buildTeamSeasonContext({
      boxScores: homeRecentBoxScores,
      gameStartTime: requestedGame.startTime,
      schedule: homeSchedule,
      standing: homeStanding,
    });
    const awayContext = buildTeamSeasonContext({
      boxScores: awayRecentBoxScores,
      gameStartTime: requestedGame.startTime,
      schedule: awaySchedule,
      standing: awayStanding,
    });

    promptGames.push(
      buildPromptGame({
        awayContext,
        boxScore,
        homeContext,
        requestedGame,
      }),
    );
  }

  const leagueName =
    args.standings.league?.name ??
    (args.connection.leagueId === args.request.leagueId
      ? args.connection.leagueName
      : null) ??
    null;
  const coverage: GameDayRecapCoveragePayload = {
    availableGames: promptGames.length,
    missingGames: coverageIssues,
    partial: coverageIssues.length > 0,
    requestedGames: args.requestedGames.length,
  };

  return {
    coverage,
    games: promptGames,
    request: {
      ...args.request,
      leagueName,
      season: args.season,
    },
  };
}

async function buildSingleGameSummaryPromptPayload(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore">;
  boxScore: BBApiBoxScore;
  connection: BbConnectionRecord;
  matchId: string;
}): Promise<GameDayRecapPromptPayload> {
  const requestedGame = toSlateGameFromBoxScore(args.boxScore);
  const timeZone = resolveLeagueTimeZone(args.connection, null);
  const gameDate = resolveCalendarDateKey(args.boxScore.startTime, timeZone);
  const homeContext = buildNeutralTeamSeasonContext(args.boxScore.homeTeam);
  const awayContext = buildNeutralTeamSeasonContext(args.boxScore.awayTeam);

  return {
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    games: [
      buildPromptGame({
        awayContext,
        boxScore: args.boxScore,
        homeContext,
        requestedGame,
      }),
    ],
    request: {
      gameDate,
      gameDayNumber: null,
      kind: "SINGLE_GAME",
      label: `Match ${args.matchId}`,
      leagueId: args.connection.leagueId ?? null,
      leagueName: args.connection.leagueName ?? null,
      matchId: args.matchId,
      season: null,
      timeZone,
    },
  };
}

function buildPromptGame(args: {
  awayContext: TeamSeasonContext;
  boxScore: BBApiBoxScore;
  homeContext: TeamSeasonContext;
  requestedGame: SlateGame;
}): GameDayRecapPromptPayload["games"][number] {
  const evidenceSignals = buildEvidenceSignals({
    awayContext: args.awayContext,
    boxScore: args.boxScore,
    homeContext: args.homeContext,
  });
  const standingsContext = buildStandingsContext({
    awayContext: args.awayContext,
    homeContext: args.homeContext,
  });

  return {
    effortDelta: args.boxScore.effortDelta,
    evidenceSignals,
    finalMargin: Math.abs(
      (args.boxScore.homeTeam.score ?? 0) - (args.boxScore.awayTeam.score ?? 0),
    ),
    matchId: args.requestedGame.matchId,
    neutral: args.boxScore.neutral,
    quarterScores: {
      away: args.boxScore.awayTeam.partialScores,
      home: args.boxScore.homeTeam.partialScores,
    },
    standingsContext,
    teams: {
      away: buildPromptTeam(args.boxScore.awayTeam, args.awayContext),
      home: buildPromptTeam(args.boxScore.homeTeam, args.homeContext),
    },
    type: args.boxScore.type ?? args.requestedGame.type,
  };
}

function buildNeutralTeamSeasonContext(team: BBApiBoxScoreTeam): TeamSeasonContext {
  return {
    conferenceIndex: 0,
    conferencePosition: 0,
    currentStreak: "Unknown",
    lastFive: "Unknown",
    losses: 0,
    recentAverageMargin: null,
    recentBoxScoreCoverage: 0,
    recentMargins: [],
    recentSignalFlags: [],
    teamId: team.id ?? "unknown",
    teamName: team.teamName ?? "Team",
    wins: 0,
  };
}

function toSlateGameFromBoxScore(boxScore: BBApiBoxScore): SlateGame {
  return {
    awayTeamId: boxScore.awayTeam.id ?? "unknown-away",
    awayTeamName: boxScore.awayTeam.teamName ?? "Away team",
    homeTeamId: boxScore.homeTeam.id ?? "unknown-home",
    homeTeamName: boxScore.homeTeam.teamName ?? "Home team",
    matchId: boxScore.matchId ?? "unknown-match",
    startTime: boxScore.startTime,
    type: boxScore.type,
  };
}

function buildPromptTeam(
  team: BBApiBoxScoreTeam,
  seasonContext: TeamSeasonContext,
): GameDayRecapPromptTeam {
  return {
    conferenceIndex: seasonContext.conferenceIndex + 1,
    conferencePosition: seasonContext.conferencePosition,
    currentStreak: seasonContext.currentStreak,
    defStrategy: team.defStrategy,
    efficiency: compactScalarRecord(team.efficiency),
    gdp: compactScalarRecord(team.gdp),
    lastFive: seasonContext.lastFive,
    name: seasonContext.teamName,
    offStrategy: team.offStrategy,
    ratingSnapshot: compactScalarRecord(team.ratings),
    recentAverageMargin: seasonContext.recentAverageMargin,
    recentSignalFlags: seasonContext.recentSignalFlags,
    record: `${seasonContext.wins}-${seasonContext.losses}`,
    score: team.score ?? 0,
    topPlayers: extractTopPlayers(team.players),
  };
}

function buildEvidenceSignals(args: {
  awayContext: TeamSeasonContext;
  boxScore: BBApiBoxScore;
  homeContext: TeamSeasonContext;
}): string[] {
  const signals = new Set<string>();
  const finalMargin = Math.abs(
    (args.boxScore.homeTeam.score ?? 0) - (args.boxScore.awayTeam.score ?? 0),
  );

  if (finalMargin <= 5) {
    signals.add("close_finish");
  }
  if (finalMargin >= 18) {
    signals.add("blowout");
  }
  if (Math.abs(args.boxScore.effortDelta ?? 0) >= 2) {
    signals.add("effort_gap");
  }
  if (
    args.homeContext.recentSignalFlags.includes("possible_strategic_deemphasis") ||
    args.awayContext.recentSignalFlags.includes("possible_strategic_deemphasis")
  ) {
    signals.add("possible_strategic_deemphasis");
  }
  if (args.homeContext.currentStreak.startsWith("W") || args.awayContext.currentStreak.startsWith("W")) {
    signals.add("winning_streak_context");
  }
  if (args.homeContext.currentStreak.startsWith("L") || args.awayContext.currentStreak.startsWith("L")) {
    signals.add("losing_streak_context");
  }

  const homeQuarterRun = computeBestQuarterMargin(args.boxScore.homeTeam.partialScores, args.boxScore.awayTeam.partialScores);
  const awayQuarterRun = computeBestQuarterMargin(args.boxScore.awayTeam.partialScores, args.boxScore.homeTeam.partialScores);
  if ((homeQuarterRun && homeQuarterRun.margin >= 8) || (awayQuarterRun && awayQuarterRun.margin >= 8)) {
    signals.add("decisive_quarter_run");
  }

  return Array.from(signals);
}

function buildStandingsContext(args: {
  awayContext: TeamSeasonContext;
  homeContext: TeamSeasonContext;
}): string[] {
  const context: string[] = [];
  context.push(
    `${args.homeContext.teamName} entered ${ordinal(args.homeContext.conferencePosition)} in conference ${args.homeContext.conferenceIndex + 1} at ${args.homeContext.wins}-${args.homeContext.losses}.`,
  );
  context.push(
    `${args.awayContext.teamName} entered ${ordinal(args.awayContext.conferencePosition)} in conference ${args.awayContext.conferenceIndex + 1} at ${args.awayContext.wins}-${args.awayContext.losses}.`,
  );

  const standingGap = Math.abs(
    args.homeContext.conferencePosition - args.awayContext.conferencePosition,
  );
  if (standingGap <= 2) {
    context.push("The matchup was between clubs occupying nearby conference positions.");
  }

  return context;
}

async function loadBoxScore(
  bb: Pick<BBXmlApiClient, "getBoxScore">,
  cache: Map<string, Promise<BBApiBoxScore | null>>,
  matchId: string,
): Promise<BBApiBoxScore | null> {
  const existing = cache.get(matchId);
  if (existing) {
    return existing;
  }

  const pending = bb
    .getBoxScore(matchId)
    .then((boxScore) => boxScore)
    .catch(() => null);
  cache.set(matchId, pending);
  return pending;
}

async function loadRecentCompletedBoxScores(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore">;
  boxScoreCache: Map<string, Promise<BBApiBoxScore | null>>;
  gameStartTime: string | null;
  limit: number;
  schedule: BBApiSchedule;
}): Promise<BBApiBoxScore[]> {
  const recentMatches = listCompletedMatchesBefore(args.schedule, args.gameStartTime)
    .slice(0, args.limit)
    .map((match) => match.id)
    .filter((matchId): matchId is string => Boolean(matchId));

  const loaded = await Promise.all(
    recentMatches.map((matchId) => loadBoxScore(args.bb, args.boxScoreCache, matchId)),
  );

  return loaded.filter((boxScore): boxScore is BBApiBoxScore =>
    Boolean(
      boxScore &&
        boxScore.homeTeam.score !== null &&
        boxScore.awayTeam.score !== null,
    ),
  );
}

function buildTeamSeasonContext(args: {
  boxScores: BBApiBoxScore[];
  gameStartTime: string | null;
  schedule: BBApiSchedule;
  standing: TeamStandingSummary;
}): TeamSeasonContext {
  const completedMatches = listCompletedMatchesBefore(args.schedule, args.gameStartTime);
  const recentMatches = completedMatches.slice(0, 5);
  const recentMargins = recentMatches
    .map((match) => getMarginForTeam(match, args.standing.teamId))
    .filter((margin): margin is number => margin !== null);
  const streak = formatCurrentStreak(completedMatches, args.standing.teamId);
  const recentAverageMargin = recentMargins.length
    ? roundToOneDecimal(
        recentMargins.reduce((sum, margin) => sum + margin, 0) / recentMargins.length,
      )
    : null;

  const blowoutLosses = args.boxScores.filter(
    (boxScore) => {
      const teamBoxScore = resolveBoxScoreTeam(boxScore, args.standing.teamId);
      const opponentBoxScore = resolveOpponentBoxScoreTeam(boxScore, args.standing.teamId);
      return teamBoxScore && opponentBoxScore
        ? (teamBoxScore.score ?? 0) - (opponentBoxScore.score ?? 0) <= -15
        : false;
    },
  ).length;

  const recentSignalFlags = new Set<string>();
  if (blowoutLosses >= 2) {
    recentSignalFlags.add("possible_strategic_deemphasis");
  }
  if ((recentAverageMargin ?? 0) <= -10) {
    recentSignalFlags.add("recent_slide");
  }
  if (streak.startsWith("W") && parseInt(streak.slice(1), 10) >= 3) {
    recentSignalFlags.add("hot_streak");
  }
  if (streak.startsWith("L") && parseInt(streak.slice(1), 10) >= 3) {
    recentSignalFlags.add("cold_streak");
  }

  return {
    conferenceIndex: args.standing.conferenceIndex,
    conferencePosition: args.standing.conferencePosition,
    currentStreak: streak,
    lastFive: formatLastFive(recentMatches, args.standing.teamId),
    losses: args.standing.losses,
    recentAverageMargin,
    recentBoxScoreCoverage: args.boxScores.length,
    recentMargins,
    recentSignalFlags: Array.from(recentSignalFlags),
    teamId: args.standing.teamId,
    teamName: args.standing.teamName,
    wins: args.standing.wins,
  };
}

function extractStandingTeams(
  standings: BBApiStandings,
): Map<string, TeamStandingSummary> {
  const index = new Map<string, TeamStandingSummary>();
  standings.conferences.forEach((conference) => {
    conference.teams.forEach((team, teamIndex) => {
      if (!team.id) {
        return;
      }

      index.set(team.id, {
        conferenceIndex: conference.index,
        conferencePosition: teamIndex + 1,
        losses: team.losses ?? 0,
        pointMargin: roundToOneDecimal(
          ((team.pf ?? 0) - (team.pa ?? 0)) /
            Math.max(1, (team.wins ?? 0) + (team.losses ?? 0)),
        ),
        teamId: team.id,
        teamName: team.teamName ?? `Team ${team.id}`,
        wins: team.wins ?? 0,
      });
    });
  });

  return index;
}

function listCompletedMatchesBefore(
  schedule: BBApiSchedule,
  gameStartTime: string | null,
): BBApiScheduleMatch[] {
  const cutoff = parseTimestamp(gameStartTime);
  return [...schedule.matches]
    .filter((match) =>
      Boolean(
        match.id &&
          match.homeTeam.score !== null &&
          match.awayTeam.score !== null &&
          (!Number.isFinite(cutoff) || parseTimestamp(match.startTime) < cutoff),
      ),
    )
    .sort((left, right) => compareTimestamps(right.startTime, left.startTime));
}

function extractTopPlayers(
  players: BBApiBoxScorePlayer[],
): GameDayRecapPromptTeam["topPlayers"] {
  return [...players]
    .sort((left, right) => scorePlayerPerformance(right) - scorePlayerPerformance(left))
    .slice(0, 3)
    .map((player) => ({
      assists: asNumberFromUnknown(player.performance.ast),
      blocks: asNumberFromUnknown(player.performance.blk),
      minutes: Object.values(player.minutesByPosition).reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      ),
      name: player.fullName,
      points: asNumberFromUnknown(player.performance.pts),
      rebounds: asNumberFromUnknown(player.performance.reb),
      steals: asNumberFromUnknown(player.performance.stl),
      turnovers: asNumberFromUnknown(player.performance.to),
    }));
}

function scorePlayerPerformance(player: BBApiBoxScorePlayer): number {
  const points = asNumberFromUnknown(player.performance.pts);
  const rebounds = asNumberFromUnknown(player.performance.reb);
  const assists = asNumberFromUnknown(player.performance.ast);
  const steals = asNumberFromUnknown(player.performance.stl);
  const blocks = asNumberFromUnknown(player.performance.blk);
  const turnovers = asNumberFromUnknown(player.performance.to);

  return points + rebounds * 0.7 + assists * 0.7 + steals + blocks - turnovers * 0.5;
}

function resolveBoxScoreTeam(
  boxScore: BBApiBoxScore,
  teamId: string,
): BBApiBoxScoreTeam | null {
  if (boxScore.homeTeam.id === teamId) {
    return boxScore.homeTeam;
  }
  if (boxScore.awayTeam.id === teamId) {
    return boxScore.awayTeam;
  }
  return null;
}

function resolveOpponentBoxScoreTeam(
  boxScore: BBApiBoxScore,
  teamId: string,
): BBApiBoxScoreTeam | null {
  if (boxScore.homeTeam.id === teamId) {
    return boxScore.awayTeam;
  }
  if (boxScore.awayTeam.id === teamId) {
    return boxScore.homeTeam;
  }
  return null;
}

function getMarginForTeam(
  match: BBApiScheduleMatch,
  teamId: string,
): number | null {
  const side = resolveScheduleSide(match, teamId);
  const opponent = resolveOpponentScheduleSide(match, teamId);

  if (!side || !opponent || side.score === null || opponent.score === null) {
    return null;
  }

  return side.score - opponent.score;
}

function resolveScheduleSide(
  match: BBApiScheduleMatch,
  teamId: string,
): BBApiScheduleMatchSide | null {
  if (match.homeTeam.id === teamId) {
    return match.homeTeam;
  }
  if (match.awayTeam.id === teamId) {
    return match.awayTeam;
  }
  return null;
}

function resolveOpponentScheduleSide(
  match: BBApiScheduleMatch,
  teamId: string,
): BBApiScheduleMatchSide | null {
  if (match.homeTeam.id === teamId) {
    return match.awayTeam;
  }
  if (match.awayTeam.id === teamId) {
    return match.homeTeam;
  }
  return null;
}

function formatCurrentStreak(
  matches: BBApiScheduleMatch[],
  teamId: string,
): string {
  if (!matches.length) {
    return "No streak";
  }

  let streakLength = 0;
  let streakPrefix = "";

  for (const match of matches) {
    const margin = getMarginForTeam(match, teamId);
    if (margin === null) {
      continue;
    }

    const nextPrefix = margin >= 0 ? "W" : "L";
    if (!streakPrefix) {
      streakPrefix = nextPrefix;
    }
    if (streakPrefix !== nextPrefix) {
      break;
    }
    streakLength += 1;
  }

  return streakLength ? `${streakPrefix}${streakLength}` : "No streak";
}

function formatLastFive(
  matches: BBApiScheduleMatch[],
  teamId: string,
): string {
  if (!matches.length) {
    return "0-0";
  }

  let wins = 0;
  let losses = 0;
  for (const match of matches) {
    const margin = getMarginForTeam(match, teamId);
    if (margin === null) {
      continue;
    }
    if (margin >= 0) {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  return `${wins}-${losses}`;
}

function computeBestQuarterMargin(
  teamPartials: number[],
  opponentPartials: number[],
): { margin: number; period: number } | null {
  if (!teamPartials.length || teamPartials.length !== opponentPartials.length) {
    return null;
  }

  let bestPeriod = 0;
  let bestMargin = Number.NEGATIVE_INFINITY;
  teamPartials.forEach((points, index) => {
    const opponentPoints = opponentPartials[index];
    if (opponentPoints == null) {
      return;
    }
    const margin = points - opponentPoints;
    if (margin > bestMargin) {
      bestMargin = margin;
      bestPeriod = index + 1;
    }
  });

  return Number.isFinite(bestMargin)
    ? { margin: bestMargin, period: bestPeriod }
    : null;
}

function compactScalarRecord(
  input: Record<string, number | string | null>,
): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, number | string] => {
        const value = entry[1];
        return value !== null && value !== "";
      })
      .map(([key, value]) => [
        key,
        typeof value === "number" ? roundToOneDecimal(value) : value,
      ]),
  );
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function compareTimestamps(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return parseTimestamp(left) - parseTimestamp(right);
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function parseDateOnlyToTimestamp(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }

  return Date.parse(`${value}T00:00:00Z`);
}

export type SeasonResolutionDiagnostic = {
  finish: string | null;
  finishTimestamp: number | null;
  hasUsableBounds: boolean;
  id: number | null;
  invalidBounds: boolean;
  matchesGameDate: boolean;
  normalizedFinish: string | null;
  normalizedStart: string | null;
  start: string | null;
  startTimestamp: number | null;
};

type SeasonDiagnosticEntry = SeasonResolutionDiagnostic & {
  index: number;
};

function summarizeSeasonDiagnostics(
  seasons: BBApiSeasons,
  gameDate: string,
): SeasonResolutionDiagnostic[] {
  const matchTimestamp = parseDateOnlyToTimestamp(gameDate);
  const diagnostics = seasons.seasons.map(
    (season, index): SeasonDiagnosticEntry => {
      const normalizedStart = resolveDateKey(season.start);
      const normalizedFinish = resolveDateKey(season.finish);
      const startTimestamp = parseDateOnlyToTimestamp(normalizedStart);
      const finishTimestamp = parseDateOnlyToTimestamp(normalizedFinish);

      return {
        finish: season.finish,
        finishTimestamp: toFiniteNumberOrNull(finishTimestamp),
        hasUsableBounds: false,
        id: season.id,
        index,
        invalidBounds: false,
        matchesGameDate: false,
        normalizedFinish,
        normalizedStart,
        start: season.start,
        startTimestamp: toFiniteNumberOrNull(startTimestamp),
      };
    },
  );

  const orderedStarts = diagnostics
    .filter(
      (season) =>
        season.id !== null &&
        season.id !== undefined &&
        season.startTimestamp !== null,
    )
    .sort((left, right) => {
      if (left.startTimestamp !== right.startTimestamp) {
        return (left.startTimestamp ?? Number.POSITIVE_INFINITY) -
          (right.startTimestamp ?? Number.POSITIVE_INFINITY);
      }

      return (left.id ?? Number.POSITIVE_INFINITY) - (right.id ?? Number.POSITIVE_INFINITY);
    });
  const nextStartByIndex = new Map<number, number | null>();
  orderedStarts.forEach((season, index) => {
    nextStartByIndex.set(
      season.index,
      orderedStarts[index + 1]?.startTimestamp ?? null,
    );
  });

  return diagnostics.map((season) => {
    const startTimestamp = season.startTimestamp;
    const finishTimestamp = season.finishTimestamp;
    const nextStartTimestamp = nextStartByIndex.get(season.index) ?? null;
    const openEnded =
      startTimestamp !== null &&
      nextStartTimestamp === null &&
      finishTimestamp === null;
    const hasUsableBounds =
      season.id !== null &&
      season.id !== undefined &&
      startTimestamp !== null &&
      (openEnded || nextStartTimestamp !== null || finishTimestamp !== null);
    const matchesGameDate = hasUsableBounds
      ? nextStartTimestamp !== null
        ? startTimestamp <= matchTimestamp && matchTimestamp < nextStartTimestamp
        : finishTimestamp !== null
          ? startTimestamp <= matchTimestamp && matchTimestamp <= finishTimestamp
          : startTimestamp <= matchTimestamp
      : false;

    return {
      finish: season.finish,
      finishTimestamp,
      hasUsableBounds,
      id: season.id,
      invalidBounds:
        Boolean(season.normalizedStart || season.normalizedFinish) && !hasUsableBounds,
      matchesGameDate,
      normalizedFinish: season.normalizedFinish,
      normalizedStart: season.normalizedStart,
      start: season.start,
      startTimestamp,
    };
  });
}

async function resolveSeasonedLeagueSlateForRecap(args: {
  bb: Pick<
    BBXmlApiClient,
    "getSchedule" | "getSeasons" | "getStandings"
  > &
    Partial<Pick<BBXmlApiClient, "getSeasonsXml">>;
  connection: BbConnectionRecord;
  gameDate: string;
  leagueId: string;
  targetKey: string;
  userId: string;
}): Promise<{
  season: number;
  slate: SlateGame[];
  standings: BBApiStandings;
}> {
  logGameDayRecapInfo("process.fetch_current_standings.start", {
    gameDate: args.gameDate,
    leagueId: args.leagueId,
    targetKey: args.targetKey,
    userId: args.userId,
  });
  const currentStandings = await args.bb.getStandings(args.leagueId);
  const timeZone = resolveLeagueTimeZone(args.connection, currentStandings);
  if (!timeZone) {
    throw new Error(
      "League date recaps require a league time zone. Set one before requesting a date-based recap.",
    );
  }
  logGameDayRecapInfo("process.fetch_current_standings.succeeded", {
    leagueName: currentStandings.league?.name ?? null,
    season: currentStandings.season ?? null,
    targetKey: args.targetKey,
    timeZone,
    userId: args.userId,
  });

  if (currentStandings.season !== null && currentStandings.season !== undefined) {
    logGameDayRecapInfo("process.resolve_current_slate.start", {
      gameDate: args.gameDate,
      season: currentStandings.season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    const currentSlateResult = await resolveLeagueDaySlateWithDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      standings: currentStandings,
      timeZone,
    });
    const currentSlate = currentSlateResult.slate;
    if (currentSlate.length > 0) {
      logGameDayRecapInfo("process.resolve_current_slate.succeeded", {
        diagnostics: currentSlateResult.diagnostics,
        requestedGames: currentSlate.length,
        season: currentStandings.season,
        slate: currentSlate.map((game) => ({
          awayTeamId: game.awayTeamId,
          homeTeamId: game.homeTeamId,
          matchId: game.matchId,
          startTime: game.startTime,
          type: game.type,
        })),
        targetKey: args.targetKey,
        userId: args.userId,
      });
      return {
        season: currentStandings.season,
        slate: currentSlate,
        standings: currentStandings,
      };
    }

    logGameDayRecapInfo("process.resolve_current_slate.no_games", {
      diagnostics: currentSlateResult.diagnostics,
      gameDate: args.gameDate,
      season: currentStandings.season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
  } else {
    logGameDayRecapWarn("process.resolve_current_slate.skipped_missing_season", {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      targetKey: args.targetKey,
      userId: args.userId,
    });
  }

  logGameDayRecapInfo("process.fetch_seasons.start", {
    gameDate: args.gameDate,
    targetKey: args.targetKey,
    userId: args.userId,
  });
  const seasons = await args.bb.getSeasons();
  const seasonDiagnostics = summarizeSeasonDiagnostics(seasons, args.gameDate);
  logGameDayRecapInfo("process.fetch_seasons.succeeded", {
    gameDate: args.gameDate,
    matchedSeasonIds: seasonDiagnostics
      .filter((season) => season.matchesGameDate && season.id !== null)
      .map((season) => season.id),
    openSeasonIds: seasonDiagnostics
      .filter(
        (season) =>
          season.id !== null &&
          season.startTimestamp !== null &&
          season.finishTimestamp === null,
      )
      .map((season) => season.id),
    seasonCount: seasons.seasons.length,
    tailSeasons: seasonDiagnostics.slice(-3),
    targetKey: args.targetKey,
    userId: args.userId,
  });

  const parsedSeasonsLookUnusable =
    seasonDiagnostics.length === 0 ||
    seasonDiagnostics.every((season) => !season.hasUsableBounds);
  if (parsedSeasonsLookUnusable) {
    await logRawSeasonsXmlDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: seasons,
      reason: "parsed_seasons_unusable",
      targetKey: args.targetKey,
      userId: args.userId,
    });
  }

  const candidateSeasons = resolveSeasonCandidatesForDate(seasons, args.gameDate);
  logGameDayRecapInfo("process.resolve_historical_candidates", {
    candidateSeasons,
    currentSeason: currentStandings.season ?? null,
    gameDate: args.gameDate,
    targetKey: args.targetKey,
    userId: args.userId,
  });

  const triedSeasons = new Set<number>();
  if (currentStandings.season !== null && currentStandings.season !== undefined) {
    triedSeasons.add(currentStandings.season);
  }

  for (const season of candidateSeasons) {
    if (triedSeasons.has(season)) {
      continue;
    }

    triedSeasons.add(season);
    logGameDayRecapInfo("process.fetch_historical_standings.start", {
      leagueId: args.leagueId,
      season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    const standings = await args.bb.getStandings(args.leagueId, season);
    logGameDayRecapInfo("process.fetch_historical_standings.succeeded", {
      leagueName: standings.league?.name ?? null,
      season: standings.season ?? null,
      targetKey: args.targetKey,
      userId: args.userId,
    });

    logGameDayRecapInfo("process.resolve_historical_slate.start", {
      gameDate: args.gameDate,
      season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    const historicalSlateResult = await resolveLeagueDaySlateWithDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      standings,
      timeZone,
    });
    const slate = historicalSlateResult.slate;
    if (slate.length > 0) {
      logGameDayRecapInfo("process.resolve_historical_slate.succeeded", {
        diagnostics: historicalSlateResult.diagnostics,
        requestedGames: slate.length,
        season,
        slate: slate.map((game) => ({
          awayTeamId: game.awayTeamId,
          homeTeamId: game.homeTeamId,
          matchId: game.matchId,
          startTime: game.startTime,
          type: game.type,
        })),
        targetKey: args.targetKey,
        userId: args.userId,
      });
      return { season, slate, standings };
    }

    logGameDayRecapInfo("process.resolve_historical_slate.no_games", {
      diagnostics: historicalSlateResult.diagnostics,
      gameDate: args.gameDate,
      season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
  }

  if (candidateSeasons.length === 0) {
    await logRawSeasonsXmlDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: seasons,
      reason: "resolve_season_failed",
      targetKey: args.targetKey,
      userId: args.userId,
    });
    throw new Error(`Unable to resolve a BuzzerBeater season for ${args.gameDate}.`);
  }

  throw new Error(
    `No league games were found for league ${args.leagueId} on ${args.gameDate}.`,
  );
}

function resolveSeasonCandidatesForDate(
  seasons: BBApiSeasons,
  gameDate: string,
): number[] {
  return summarizeSeasonDiagnostics(seasons, gameDate)
    .filter(
      (season): season is SeasonResolutionDiagnostic & { id: number } =>
        season.id !== null && season.id !== undefined && season.matchesGameDate,
    )
    .map((season) => season.id);
}

async function logRawSeasonsXmlDiagnostics(args: {
  bb: Partial<Pick<BBXmlApiClient, "getSeasonsXml">>;
  gameDate: string;
  leagueId: string;
  parsedSeasons: BBApiSeasons;
  reason: string;
  targetKey: string;
  userId: string;
}): Promise<void> {
  if (typeof args.bb.getSeasonsXml !== "function") {
    logGameDayRecapWarn("process.fetch_seasons_xml.unavailable", {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: summarizeSeasonDiagnostics(args.parsedSeasons, args.gameDate),
      reason: args.reason,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    return;
  }

  try {
    const xml = await args.bb.getSeasonsXml();
    logGameDayRecapInfo("process.fetch_seasons_xml.succeeded", {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: summarizeSeasonDiagnostics(args.parsedSeasons, args.gameDate),
      rawXmlHasFinishElement: xml.includes("<finish>"),
      rawXmlHasSeasonTag: xml.includes("<season"),
      rawXmlHasStartElement: xml.includes("<start>"),
      rawXmlLength: xml.length,
      rawXmlPreview: summarizeXmlPreview(xml),
      reason: args.reason,
      targetKey: args.targetKey,
      userId: args.userId,
    });
  } catch (error) {
    logGameDayRecapWarn("process.fetch_seasons_xml.failed", {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      reason: args.reason,
      targetKey: args.targetKey,
      userId: args.userId,
      ...toLoggableError(error),
    });
  }
}

function summarizeXmlPreview(xml: string, maxLength = 500): string {
  const normalized = xml.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function toFiniteNumberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function logGameDayRecapInfo(event: string, details: Record<string, unknown>): void {
  console.info(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function logGameDayRecapWarn(event: string, details: Record<string, unknown>): void {
  console.warn(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function logGameDayRecapError(event: string, details: Record<string, unknown>): void {
  console.error(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function toLoggableError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { errorMessage: String(error) };
  }

  const details: Record<string, unknown> = {
    errorMessage: error.message,
    errorName: error.name,
  };

  if ("endpoint" in error && typeof error.endpoint === "string") {
    details.endpoint = error.endpoint;
  }
  if ("status" in error && typeof error.status === "number") {
    details.status = error.status;
  }

  return details;
}

function resolveDateKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1] ?? null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : null;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function requireRecord(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }

  return value as JsonRecord;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asNumberFromUnknown(value: unknown): number {
  return typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value) || 0
      : 0;
}

function resolveUserId(identity: unknown): string | null {
  const record = requireRecord(identity ?? {}, "Authenticated identity");
  if (typeof record.sub === "string" && record.sub.trim()) {
    return record.sub;
  }

  const claims = record.claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    return null;
  }

  const sub = (claims as Record<string, unknown>).sub;
  return typeof sub === "string" && sub.trim() ? sub : null;
}

async function requireBbConnection(
  env: GraphqlEnv,
  userId: string,
  dependencies: Pick<ProcessDependencies, "getBbConnection">,
): Promise<BbConnectionRecord> {
  const connection = await dependencies.getBbConnection(env, userId);
  if (!connection) {
    throw new Error("Connect a BuzzerBeater account before requesting recaps.");
  }
  if (!connection.bbLoginName) {
    throw new Error("The saved BuzzerBeater connection is missing a login name.");
  }
  return connection;
}

function resolveLeagueTimeZone(
  connection: BbConnectionRecord,
  standings: BBApiStandings | null,
): string | null {
  const savedTimeZone = normalizeLeagueTimeZone(connection.leagueTimeZone);
  if (savedTimeZone) {
    return savedTimeZone;
  }

  return inferLeagueTimeZone({
    countryId: standings?.country?.id ?? null,
    countryName: standings?.country?.name ?? null,
  });
}

function createBedrockGameDayRecapProvider(args: {
  modelId: string;
  region: string | undefined;
}): BedrockGameDayRecapProvider {
  assertSupportedBedrockRecapModel(args.modelId, args.region);

  const client = new BedrockRuntimeClient({
    region: args.region,
  });

  return {
    generate: async (payload) => {
      const response = await client.send(
        new ConverseCommand(
          buildGameDayRecapBedrockRequest({
            modelId: args.modelId,
            payload,
          }),
        ),
      );

      const output = response.output;
      const content = output && "message" in output
        ? output.message?.content ?? []
        : [];
      const text = content
        .map((block) => ("text" in block ? block.text : ""))
        .join("")
        .trim();

      if (!text) {
        throw new Error("Bedrock returned an empty structured recap response.");
      }
      if (response.stopReason && response.stopReason !== "end_turn") {
        throw new Error(
          `Bedrock stopped recap generation with reason ${response.stopReason}.`,
        );
      }

      return validateGameDayRecapResult(JSON.parse(text), payload.games);
    },
    modelId: args.modelId,
    providerName: "bedrock",
  };
}

function validateGameDayRecapResult(
  input: unknown,
  expectedGames: GameDayRecapPromptPayload["games"],
): GameDayRecapResultPayload {
  const record = requireRecord(input, "Game day recap result");
  const summary = requireRecord(record.summary, "Game day recap summary");
  const games = Array.isArray(record.games) ? record.games : null;
  if (!games?.length) {
    throw new Error("Game day recap result did not include any games.");
  }

  const validatedGames = games.map((game) => {
    const gameRecord = requireRecord(game, "Game day recap game");
    const matchId = asOptionalString(gameRecord.matchId)?.trim();
    const headline = asOptionalString(gameRecord.headline)?.trim();
    const writeup = asOptionalString(gameRecord.writeup)?.trim();
    const evidenceTags = Array.isArray(gameRecord.evidenceTags)
      ? gameRecord.evidenceTags
      : null;

    if (!matchId || !headline || !writeup || !evidenceTags) {
      throw new Error("Game day recap result contained an incomplete game entry.");
    }

    const validatedTags = evidenceTags.map((tag) => {
      if (
        typeof tag !== "string" ||
        !GAME_DAY_RECAP_EVIDENCE_TAGS.includes(tag as GameDayRecapEvidenceTag)
      ) {
        throw new Error(`Unsupported recap evidence tag ${String(tag)}.`);
      }
      return tag as GameDayRecapEvidenceTag;
    });

    return {
      evidenceTags: validatedTags,
      headline,
      matchId,
      writeup,
    };
  });

  const expectedMatchIds = expectedGames.map((game) => game.matchId);
  const matchIdSet = new Set(expectedMatchIds);
  if (
    validatedGames.length !== expectedMatchIds.length ||
    validatedGames.some((game) => !matchIdSet.has(game.matchId))
  ) {
    throw new Error(
      "Game day recap result did not match the expected slate coverage.",
    );
  }

  const gamesByMatchId = new Map(validatedGames.map((game) => [game.matchId, game]));

  const headline = asOptionalString(summary.headline)?.trim();
  const lede = asOptionalString(summary.lede)?.trim();
  if (!headline || !lede) {
    throw new Error("Game day recap summary was missing a headline or lede.");
  }

  return {
    games: expectedMatchIds.map((matchId) => {
      const game = gamesByMatchId.get(matchId);
      if (!game) {
        throw new Error(`Game day recap result omitted match ${matchId}.`);
      }
      return game;
    }),
    summary: {
      headline,
      lede,
    },
  };
}

export const __testing = {
  GAME_DAY_RECAP_EVIDENCE_TAGS,
  GAME_DAY_RECAP_PROMPT_VERSION,
  GAME_DAY_RECAP_RESULT_SCHEMA,
  SUPPORTED_STRUCTURED_OUTPUT_MODEL_PATTERNS,
  buildEvidenceSignals,
  buildGameDayRecapBedrockRequest,
  buildGameDayRecapPromptPayload,
  buildGameDayRecapTargetKey,
  buildTeamSeasonContext,
  extractStandingTeams,
  extractTopPlayers,
  formatCurrentStreak,
  formatLastFive,
  listCompletedMatchesBefore,
  normalizeGameDayRecapRequest,
  parseGameDayRecapQueueMessage,
  resolveConfiguredRecapModelId,
  resolveQueuedRecapModelId,
  resolveLeagueDaySlate,
  resolveLeagueGameDaySlate,
  resolveSeasonCandidatesForDate,
  resolveSeasonForDate,
  summarizeSeasonDiagnostics,
  validateGameDayRecapResult,
};
