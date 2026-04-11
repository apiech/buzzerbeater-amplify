import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

import {
  BBXmlApiClient,
  BBXmlApiParseError,
  type BBXmlApiClientOptions,
} from "../../../lib/bbapi";
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
import { formatBuzzerBeaterLabel } from "../../../lib/buzzerbeater/rating-scale";
import { RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME } from "../../_shared/game-day-recap-errors";
import { resolveBbAccessKey } from "./credentials";
import {
  buildGameDayRecapTargetKey,
  buildLeagueGameDayRecapTargetKey,
  buildSingleGameSummaryTargetKey,
  normalizeGameDayRecapRequest,
  normalizeLeagueGameDayRecapRequest,
  normalizeSingleGameSummaryRequest,
  parseGameDayRecapQueueMessage,
  type RecapJobKind,
  type RecapQueueMessage,
} from "./game-day-recap-request";
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
import {
  assertMaintenanceInactive,
  toMaintenanceAwareErrorMessage,
} from "./maintenance";
import { classifyCompetition } from "./match-importance";
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

type TeamSeasonContextPromptField = string | null;

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

type GameDayRecapResultGame = GameDayRecapResultPayload["games"][number];
type GameDayRecapResultSummary = GameDayRecapResultPayload["summary"];

type GameDayRecapPromptPeriodFact = {
  awayScore: number;
  homeScore: number;
  label: string;
  margin: number;
  period: number;
  winningSide: "away" | "home" | "tie";
};

type GameDayRecapPromptQuarterFacts = {
  decisiveQuarter:
    | (GameDayRecapPromptPeriodFact & {
        winningSide: "away" | "home";
      })
    | null;
  fourthQuarterOutcome: GameDayRecapPromptPeriodFact | null;
  periods: GameDayRecapPromptPeriodFact[];
};

type GameDayRecapPromptGame = {
  effortDelta: number | null;
  evidenceSignals: string[];
  finalMargin: number;
  matchId: string;
  neutral: boolean | null;
  quarterFacts: GameDayRecapPromptQuarterFacts;
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
  games: GameDayRecapPromptGame[];
};

type GameDayRecapPromptTeam = {
  conferenceIndex: number | null;
  conferencePosition: number | null;
  defStrategy: string | null;
  efficiency: Record<string, number | string>;
  gdp: Record<string, number | string>;
  lastFive: TeamSeasonContextPromptField;
  lastFiveEnteringGame: TeamSeasonContextPromptField;
  name: string;
  offStrategy: string | null;
  ratingLabels: Record<string, string>;
  recentAverageMargin: number | null;
  recentSignalFlags: string[];
  record: TeamSeasonContextPromptField;
  recordEnteringGame: TeamSeasonContextPromptField;
  score: number;
  streak: TeamSeasonContextPromptField;
  streakEnteringGame: TeamSeasonContextPromptField;
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
  isScheduleFinal: boolean;
  homeTeamId: string;
  homeTeamName: string;
  matchId: string;
  scheduledAwayScore: number | null;
  scheduledHomeScore: number | null;
  startTime: string | null;
  type: string | null;
};

type BoxScoreLoadErrorDetails = {
  bodyPreview?: string;
  endpoint?: string;
  errorMessage: string;
  errorName?: string;
  status?: number;
};

type BoxScoreLoadResult =
  | {
      boxScore: BBApiBoxScore;
      kind: "ok";
    }
  | {
      boxScore: BBApiBoxScore;
      kind: "incomplete_boxscore";
    }
  | {
      error: BoxScoreLoadErrorDetails;
      kind: "api_fetch_failed";
    }
  | {
      error: BoxScoreLoadErrorDetails;
      kind: "parse_failed";
    };

type ScheduleMatchInclusionPredicate = (match: BBApiScheduleMatch) => boolean;
type GameDayRecapGenerateOptions = {
  validationFeedback?: string[];
};

type GameDayRecapSemanticValidationIssueField = "headline" | "writeup";
type GameDayRecapSemanticValidationIssueKind =
  | "compact_streak_mismatch"
  | "quarter_score_mismatch"
  | "quarter_winner_score_mismatch"
  | "record_mismatch"
  | "tied_quarter_claim"
  | "wrong_quarter_winner";
type GameDayRecapSemanticValidationIssueSalvage =
  | "drop_only"
  | "patch_or_remove";
type GameDayRecapSemanticValidationIssue = {
  actualValue?: string;
  feedback: string;
  field: GameDayRecapSemanticValidationIssueField;
  kind: GameDayRecapSemanticValidationIssueKind;
  matchId: string;
  period?: number;
  reason: string;
  salvage: GameDayRecapSemanticValidationIssueSalvage;
  sentence: string;
  sentenceIndex: number;
  teamSide?: "away" | "home";
};

type GeneratedGameDayRecap = {
  coverageIssues: CoverageIssue[];
  result: GameDayRecapResultPayload;
};

class RetryableCompletedSlateCoverageError extends Error {
  readonly coverage: GameDayRecapCoveragePayload;

  constructor(
    coverage: GameDayRecapCoveragePayload,
    message = "Completed slate recap coverage is incomplete because one or more final box scores could not be processed.",
  ) {
    super(message);
    this.name = RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME;
    this.coverage = coverage;
  }
}

class GameDayRecapSemanticValidationError extends Error {
  readonly feedbackLines: string[];
  readonly issues: GameDayRecapSemanticValidationIssue[];

  constructor(issues: GameDayRecapSemanticValidationIssue[]) {
    super(
      `Game day recap response contained factual contradictions: ${issues
        .map((issue) => `match ${issue.matchId}: ${issue.reason}`)
        .join("; ")}`,
    );
    this.name = "GameDayRecapSemanticValidationError";
    this.feedbackLines = issues.map((issue) => issue.feedback);
    this.issues = issues;
  }
}

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
  generate: (
    payload: GameDayRecapPromptPayload,
    options?: GameDayRecapGenerateOptions,
  ) => Promise<unknown>;
  modelId: string;
  providerName: "bedrock";
};

type SubmitDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
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
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: (
    options: BBXmlApiClientOptions,
  ) => Pick<
    BBXmlApiClient,
    | "getBoxScore"
    | "getSchedule"
    | "getSeasons"
    | "getStandings"
    | "getTeamInfo"
  > &
    Partial<Pick<BBXmlApiClient, "getSeasonsXml">>;
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

const GAME_DAY_RECAP_PROMPT_VERSION = "gameday-recap-v2";
const GAME_DAY_RECAP_MODEL_ENV_NAME = "GAME_DAY_RECAP_MODEL_ID";
const GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME = "GAME_DAY_RECAP_MODEL_ID_PREMIUM";
const GAME_DAY_RECAP_DECISIVE_QUARTER_MARGIN = 8;
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
  assertMaintenanceInactive,
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
  assertMaintenanceInactive,
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
  await deps.assertMaintenanceInactive();

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
  const targetKey = buildGameDayRecapTargetKey(
    request.leagueId,
    request.gameDate,
  );
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
  await deps.assertMaintenanceInactive();

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
  await deps.assertMaintenanceInactive();

  const planId = await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });

  const request = normalizeSingleGameSummaryRequest({
    matchId: args.matchId,
  });
  const targetKey = buildSingleGameSummaryTargetKey(request.matchId);
  const existing = await deps.getSingleGameSummary(args.env, userId, targetKey);
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
    await deps.assertMaintenanceInactive();
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

    await deps.assertMaintenanceInactive();
    const connection = await requireBbConnection(args.env, recap.userId, deps);
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

    const { season, slate, standings } =
      await resolveSeasonedLeagueSlateForRecap({
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
      enforceCompletedSlateCoverage: true,
      now: deps.now(),
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
      targetKey: recap.targetKey,
      userId: recap.userId,
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

    await deps.assertMaintenanceInactive();
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
    const generatedRecap = await generateValidatedGameDayRecap({
      payload: promptPayload,
      provider,
    });
    coverage = mergeCoverageIssues(coverage, generatedRecap.coverageIssues);
    logGameDayRecapInfo("process.provider.succeeded", {
      gameCount: generatedRecap.result.games.length,
      summaryHeadline: generatedRecap.result.summary.headline,
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
      resultJson: generatedRecap.result,
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
    if (isRetryableCompletedSlateCoverageError(error)) {
      coverage = error.coverage;
    }
    logGameDayRecapError("process.failed", {
      coverage,
      targetKey: recap.targetKey,
      userId: recap.userId,
      ...toLoggableError(error),
    });
    await deps.updateGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: toMaintenanceAwareErrorMessage(error),
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
    await deps.assertMaintenanceInactive();
    await deps.updateLeagueGameDayRecap(args.env, {
      error: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    await deps.assertMaintenanceInactive();
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
      throw new Error(
        `Unable to resolve a season for league ${recap.leagueId}.`,
      );
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
      enforceCompletedSlateCoverage: true,
      now: deps.now(),
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
        timeZone: resolveLeagueTimeZone(connection, standings),
      },
      season,
      standings,
      targetKey: recap.targetKey,
      userId: recap.userId,
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

    await deps.assertMaintenanceInactive();
    const provider = deps.createProvider({
      modelId,
      region: args.region,
    });
    const generatedRecap = await generateValidatedGameDayRecap({
      payload: promptPayload,
      provider,
    });
    coverage = mergeCoverageIssues(coverage, generatedRecap.coverageIssues);

    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: null,
      leagueName: promptPayload.request.leagueName,
      modelId: provider.modelId,
      modelProvider: provider.providerName,
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      resultJson: generatedRecap.result,
      season,
      status: "SUCCEEDED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
  } catch (error) {
    if (isRetryableCompletedSlateCoverageError(error)) {
      coverage = error.coverage;
    }
    logGameDayRecapError("process.failed", {
      coverage,
      targetKey: recap.targetKey,
      userId: recap.userId,
      ...toLoggableError(error),
    });
    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: toMaintenanceAwareErrorMessage(error),
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
    await deps.assertMaintenanceInactive();
    await deps.updateSingleGameSummary(args.env, {
      error: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "RESOLVING_SLATE",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });

    await deps.assertMaintenanceInactive();
    const connection = await requireBbConnection(
      args.env,
      summary.userId,
      deps,
    );
    const accessKey = await deps.resolveBbAccessKey(args.env, summary.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });
    const boxScore = await bb.getBoxScore(summary.matchId);
    if (boxScore.homeTeam.score === null || boxScore.awayTeam.score === null) {
      throw new Error(
        `Match ${summary.matchId} does not have a final box score yet.`,
      );
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

    await deps.assertMaintenanceInactive();
    const provider = deps.createProvider({
      modelId,
      region: args.region,
    });
    const generatedRecap = await generateValidatedGameDayRecap({
      payload: promptPayload,
      provider,
    });
    coverage = mergeCoverageIssues(coverage, generatedRecap.coverageIssues);

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
      resultJson: generatedRecap.result,
      season: promptPayload.request.season,
      status: "SUCCEEDED",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });
  } catch (error) {
    await deps.updateSingleGameSummary(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: toMaintenanceAwareErrorMessage(error),
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
    throw new Error(
      `${GAME_DAY_RECAP_MODEL_ENV_NAME} must be set for recap generation.`,
    );
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

      const matchDate = resolveCalendarDateKey(
        match.startTime,
        diagnostics.timeZone,
      );
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
        slateByMatchId.set(
          matchId,
          toSlateGameFromScheduleMatch({
            awayTeamName:
              match.awayTeam.teamName ??
              standingTeams.get(awayTeamId)?.teamName ??
              "Away team",
            homeTeamName:
              match.homeTeam.teamName ??
              standingTeams.get(homeTeamId)?.teamName ??
              "Home team",
            match,
          }),
        );
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
      .sort((left, right) =>
        compareTimestamps(left.startTime, right.startTime),
      );

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
        ...toSlateGameFromScheduleMatch({
          awayTeamName:
            match.awayTeam.teamName ??
            standingTeams.get(awayTeamId)?.teamName ??
            "Away team",
          homeTeamName:
            match.homeTeam.teamName ??
            standingTeams.get(homeTeamId)?.teamName ??
            "Home team",
          match,
        }),
        gameDayNumbers: new Set([gameDayNumber]),
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

function isRegularSeasonLeagueMatchType(
  type: string | null | undefined,
): boolean {
  const normalizedType = type?.trim().toLowerCase();
  return Boolean(
    normalizedType &&
    (normalizedType === "league" ||
      normalizedType === "league.rs" ||
      normalizedType === "league.regularseason"),
  );
}

function toSlateGameFromScheduleMatch(args: {
  awayTeamName: string;
  homeTeamName: string;
  match: BBApiScheduleMatch;
}): SlateGame {
  return {
    awayTeamId: args.match.awayTeam.id?.trim() ?? "unknown-away",
    awayTeamName: args.awayTeamName,
    isScheduleFinal:
      args.match.homeTeam.score !== null && args.match.awayTeam.score !== null,
    homeTeamId: args.match.homeTeam.id?.trim() ?? "unknown-home",
    homeTeamName: args.homeTeamName,
    matchId: args.match.id?.trim() ?? "unknown-match",
    scheduledAwayScore: args.match.awayTeam.score,
    scheduledHomeScore: args.match.homeTeam.score,
    startTime: args.match.startTime,
    type: args.match.type,
  };
}

export function buildGameDayRecapBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapPromptPayload;
  validationFeedback?: string[];
}) {
  const validationFeedback = args.validationFeedback?.filter(Boolean) ?? [];

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
                  validationFeedback:
                    validationFeedback.length > 0 ? validationFeedback : undefined,
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
          "Unqualified team record, streak, and recent-form fields describe the postgame state after the final result.",
          "Team context fields ending in EnteringGame describe the state before tipoff and should only appear when you are explicitly contrasting the pregame setup.",
          "Use quarterFacts as the source of truth for period-by-period scoring. If a quarter is tied, do not say either team outscored, won, or took that quarter.",
          "If you mention team ratings, use the supplied BuzzerBeater word labels rather than raw numeric scores.",
          "Headlines should be vivid but factual.",
          validationFeedback.length > 0
            ? `Previous draft issues to correct: ${validationFeedback.join(" ")}`
            : "",
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
  if (
    !normalizedRegion ||
    !SUPPORTED_COMMERCIAL_REGION_PATTERN.test(normalizedRegion)
  ) {
    throw new Error(
      `Game day recap structured output currently requires a supported commercial Bedrock region. Received ${normalizedRegion ?? "unknown"}.`,
    );
  }
}

async function buildGameDayRecapPromptPayload(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore" | "getSchedule" | "getTeamInfo">;
  connection: BbConnectionRecord;
  enforceCompletedSlateCoverage?: boolean;
  now: Date;
  requestedGames: SlateGame[];
  request: GameDayRecapPromptPayload["request"];
  season: number;
  standings: BBApiStandings;
  targetKey: string;
  userId: string;
}): Promise<GameDayRecapPromptPayload> {
  const includeRecapContextMatch = isRegularSeasonLeagueContextMatch;
  const standingsIndex = extractStandingTeams(args.standings);
  const schedules = await Promise.all(
    Array.from(standingsIndex.keys()).map(
      async (teamId) =>
        [teamId, await args.bb.getSchedule(teamId, args.season)] as const,
    ),
  );
  const scheduleByTeamId = new Map<string, BBApiSchedule>(schedules);
  const boxScoreCache = new Map<string, Promise<BoxScoreLoadResult>>();
  const coverageIssues: CoverageIssue[] = [];
  const finalCoverageBlockers: CoverageIssue[] = [];
  const promptGames: GameDayRecapPromptPayload["games"] = [];

  for (const requestedGame of args.requestedGames) {
    const boxScoreResult = await loadBoxScore(
      args.bb,
      boxScoreCache,
      requestedGame.matchId,
    );
    const expectedFinal = isRequestedGameExpectedFinal({
      now: args.now,
      request: args.request,
      requestedGame,
    });
    if (boxScoreResult.kind !== "ok") {
      if (boxScoreResult.kind === "api_fetch_failed") {
        logGameDayRecapWarn("process.box_score_fetch_failed", {
          expectedFinal,
          matchId: requestedGame.matchId,
          scheduledAwayScore: requestedGame.scheduledAwayScore,
          scheduledHomeScore: requestedGame.scheduledHomeScore,
          scheduleFinal: requestedGame.isScheduleFinal,
          targetKey: args.targetKey,
          userId: args.userId,
          ...boxScoreResult.error,
        });
      } else if (boxScoreResult.kind === "parse_failed") {
        logGameDayRecapWarn("process.box_score_parse_failed", {
          expectedFinal,
          matchId: requestedGame.matchId,
          scheduledAwayScore: requestedGame.scheduledAwayScore,
          scheduledHomeScore: requestedGame.scheduledHomeScore,
          scheduleFinal: requestedGame.isScheduleFinal,
          targetKey: args.targetKey,
          userId: args.userId,
          ...boxScoreResult.error,
        });
      } else {
        logGameDayRecapWarn("process.box_score_incomplete", {
          awayScore: boxScoreResult.boxScore.awayTeam.score,
          expectedFinal,
          homeScore: boxScoreResult.boxScore.homeTeam.score,
          matchId: requestedGame.matchId,
          scheduledAwayScore: requestedGame.scheduledAwayScore,
          scheduledHomeScore: requestedGame.scheduledHomeScore,
          scheduleFinal: requestedGame.isScheduleFinal,
          targetKey: args.targetKey,
          userId: args.userId,
        });
      }

      const issue: CoverageIssue = {
        awayTeamName: requestedGame.awayTeamName,
        homeTeamName: requestedGame.homeTeamName,
        matchId: requestedGame.matchId,
        reason:
          boxScoreResult.kind === "incomplete_boxscore"
            ? "final box score was incomplete"
            : boxScoreResult.kind === "parse_failed"
              ? "final box score response could not be parsed"
              : "final box score was unavailable",
      };
      coverageIssues.push(issue);
      if (expectedFinal) {
        finalCoverageBlockers.push(issue);
      }
      continue;
    }
    const boxScore = boxScoreResult.boxScore;

    const homeSchedule = scheduleByTeamId.get(requestedGame.homeTeamId);
    const awaySchedule = scheduleByTeamId.get(requestedGame.awayTeamId);
    const homeStanding = standingsIndex.get(requestedGame.homeTeamId);
    const awayStanding = standingsIndex.get(requestedGame.awayTeamId);
    if (!homeSchedule || !awaySchedule || !homeStanding || !awayStanding) {
      coverageIssues.push({
        awayTeamName: requestedGame.awayTeamName,
        homeTeamName: requestedGame.homeTeamName,
        matchId: requestedGame.matchId,
        reason:
          "team context could not be resolved from standings or schedules",
      });
      continue;
    }

    const [homeRecentBoxScores, awayRecentBoxScores] = await Promise.all([
      loadRecentCompletedBoxScores({
        bb: args.bb,
        boxScoreCache,
        gameStartTime: requestedGame.startTime,
        includeMatch: includeRecapContextMatch,
        limit: 3,
        schedule: homeSchedule,
      }),
      loadRecentCompletedBoxScores({
        bb: args.bb,
        boxScoreCache,
        gameStartTime: requestedGame.startTime,
        includeMatch: includeRecapContextMatch,
        limit: 3,
        schedule: awaySchedule,
      }),
    ]);

    const homeContext = buildTeamSeasonContext({
      boxScores: homeRecentBoxScores,
      gameStartTime: requestedGame.startTime,
      includeMatch: includeRecapContextMatch,
      schedule: homeSchedule,
      standing: homeStanding,
    });
    const awayContext = buildTeamSeasonContext({
      boxScores: awayRecentBoxScores,
      gameStartTime: requestedGame.startTime,
      includeMatch: includeRecapContextMatch,
      schedule: awaySchedule,
      standing: awayStanding,
    });
    const homePostgameContext = derivePostgameTeamSeasonContext({
      boxScore,
      enteringGameContext: homeContext,
      priorBoxScores: homeRecentBoxScores,
    });
    const awayPostgameContext = derivePostgameTeamSeasonContext({
      boxScore,
      enteringGameContext: awayContext,
      priorBoxScores: awayRecentBoxScores,
    });

    promptGames.push(
      buildPromptGame({
        awayEnteringGameContext: awayContext,
        awayPostgameContext,
        boxScore,
        hasHistoricalContext: true,
        homeEnteringGameContext: homeContext,
        homePostgameContext,
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
  if (
    args.enforceCompletedSlateCoverage &&
    finalCoverageBlockers.length > 0 &&
    isCoverageStrictForRequest(args.request)
  ) {
    logGameDayRecapWarn("process.completed_slate_coverage_blocked", {
      blockedGames: finalCoverageBlockers,
      coverage,
      requestKind: args.request.kind,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    throw new RetryableCompletedSlateCoverageError(coverage);
  }

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
  const homeEnteringGameContext = buildNeutralTeamSeasonContext(
    args.boxScore.homeTeam,
  );
  const awayEnteringGameContext = buildNeutralTeamSeasonContext(
    args.boxScore.awayTeam,
  );

  return {
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    games: [
      buildPromptGame({
        awayEnteringGameContext,
        awayPostgameContext: awayEnteringGameContext,
        boxScore: args.boxScore,
        hasHistoricalContext: false,
        homeEnteringGameContext,
        homePostgameContext: homeEnteringGameContext,
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
  awayEnteringGameContext: TeamSeasonContext;
  awayPostgameContext: TeamSeasonContext;
  boxScore: BBApiBoxScore;
  hasHistoricalContext: boolean;
  homeEnteringGameContext: TeamSeasonContext;
  homePostgameContext: TeamSeasonContext;
  requestedGame: SlateGame;
}): GameDayRecapPromptGame {
  const quarterFacts = buildQuarterFacts(args.boxScore);
  const evidenceSignals = buildEvidenceSignals({
    awayContext: args.awayPostgameContext,
    boxScore: args.boxScore,
    homeContext: args.homePostgameContext,
    quarterFacts,
  });
  const standingsContext = args.hasHistoricalContext
    ? buildStandingsContext({
        awayContext: args.awayEnteringGameContext,
        homeContext: args.homeEnteringGameContext,
      })
    : [];

  return {
    effortDelta: args.boxScore.effortDelta,
    evidenceSignals,
    finalMargin: Math.abs(
      (args.boxScore.homeTeam.score ?? 0) - (args.boxScore.awayTeam.score ?? 0),
    ),
    matchId: args.requestedGame.matchId,
    neutral: args.boxScore.neutral,
    quarterFacts,
    quarterScores: {
      away: args.boxScore.awayTeam.partialScores,
      home: args.boxScore.homeTeam.partialScores,
    },
    standingsContext,
    teams: {
      away: buildPromptTeam({
        enteringGameContext: args.awayEnteringGameContext,
        hasHistoricalContext: args.hasHistoricalContext,
        postgameContext: args.awayPostgameContext,
        team: args.boxScore.awayTeam,
      }),
      home: buildPromptTeam({
        enteringGameContext: args.homeEnteringGameContext,
        hasHistoricalContext: args.hasHistoricalContext,
        postgameContext: args.homePostgameContext,
        team: args.boxScore.homeTeam,
      }),
    },
    type: args.boxScore.type ?? args.requestedGame.type,
  };
}

function buildNeutralTeamSeasonContext(
  team: BBApiBoxScoreTeam,
): TeamSeasonContext {
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
    isScheduleFinal:
      boxScore.homeTeam.score !== null && boxScore.awayTeam.score !== null,
    homeTeamId: boxScore.homeTeam.id ?? "unknown-home",
    homeTeamName: boxScore.homeTeam.teamName ?? "Home team",
    matchId: boxScore.matchId ?? "unknown-match",
    scheduledAwayScore: boxScore.awayTeam.score,
    scheduledHomeScore: boxScore.homeTeam.score,
    startTime: boxScore.startTime,
    type: boxScore.type,
  };
}

function buildPromptTeam(args: {
  enteringGameContext: TeamSeasonContext;
  hasHistoricalContext: boolean;
  postgameContext: TeamSeasonContext;
  team: BBApiBoxScoreTeam;
}): GameDayRecapPromptTeam {
  const teamContextFields = args.hasHistoricalContext
    ? {
        lastFive: args.postgameContext.lastFive,
        lastFiveEnteringGame: args.enteringGameContext.lastFive,
        record: formatTeamRecord(args.postgameContext),
        recordEnteringGame: formatTeamRecord(args.enteringGameContext),
        streak: args.postgameContext.currentStreak,
        streakEnteringGame: args.enteringGameContext.currentStreak,
      }
    : {
        lastFive: null,
        lastFiveEnteringGame: null,
        record: null,
        recordEnteringGame: null,
        streak: null,
        streakEnteringGame: null,
      };

  return {
    conferenceIndex: args.hasHistoricalContext
      ? args.postgameContext.conferenceIndex + 1
      : null,
    conferencePosition: args.hasHistoricalContext
      ? args.postgameContext.conferencePosition
      : null,
    defStrategy: args.team.defStrategy,
    efficiency: compactScalarRecord(args.team.efficiency),
    gdp: compactScalarRecord(args.team.gdp),
    ...teamContextFields,
    name: args.postgameContext.teamName,
    offStrategy: args.team.offStrategy,
    ratingLabels: formatTeamRatingsForRecap(args.team.ratings),
    recentAverageMargin: args.hasHistoricalContext
      ? args.postgameContext.recentAverageMargin
      : null,
    recentSignalFlags: args.hasHistoricalContext
      ? args.postgameContext.recentSignalFlags
      : [],
    score: args.team.score ?? 0,
    topPlayers: extractTopPlayers(args.team.players),
  };
}

function buildEvidenceSignals(args: {
  awayContext: TeamSeasonContext;
  boxScore: BBApiBoxScore;
  homeContext: TeamSeasonContext;
  quarterFacts: GameDayRecapPromptQuarterFacts;
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
    args.homeContext.recentSignalFlags.includes(
      "possible_strategic_deemphasis",
    ) ||
    args.awayContext.recentSignalFlags.includes("possible_strategic_deemphasis")
  ) {
    signals.add("possible_strategic_deemphasis");
  }
  if (
    args.homeContext.currentStreak.startsWith("W") ||
    args.awayContext.currentStreak.startsWith("W")
  ) {
    signals.add("winning_streak_context");
  }
  if (
    args.homeContext.currentStreak.startsWith("L") ||
    args.awayContext.currentStreak.startsWith("L")
  ) {
    signals.add("losing_streak_context");
  }

  if (args.quarterFacts.decisiveQuarter) {
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
    `${args.homeContext.teamName} was ${ordinal(args.homeContext.conferencePosition)} in conference ${args.homeContext.conferenceIndex + 1} entering the game.`,
  );
  context.push(
    `${args.awayContext.teamName} was ${ordinal(args.awayContext.conferencePosition)} in conference ${args.awayContext.conferenceIndex + 1} entering the game.`,
  );

  const standingGap = Math.abs(
    args.homeContext.conferencePosition - args.awayContext.conferencePosition,
  );
  if (standingGap <= 2) {
    context.push(
      "The matchup was between clubs occupying nearby conference positions.",
    );
  }

  return context;
}

async function loadBoxScore(
  bb: Pick<BBXmlApiClient, "getBoxScore">,
  cache: Map<string, Promise<BoxScoreLoadResult>>,
  matchId: string,
): Promise<BoxScoreLoadResult> {
  const existing = cache.get(matchId);
  if (existing) {
    return existing;
  }

  const pending = bb
    .getBoxScore(matchId)
    .then((boxScore) =>
      hasCompleteBoxScore(boxScore)
        ? ({
            boxScore,
            kind: "ok",
          } satisfies BoxScoreLoadResult)
        : ({
            boxScore,
            kind: "incomplete_boxscore",
          } satisfies BoxScoreLoadResult),
    )
    .catch((error) =>
      error instanceof BBXmlApiParseError
        ? ({
            error: toBoxScoreLoadErrorDetails(error),
            kind: "parse_failed",
          } satisfies BoxScoreLoadResult)
        : ({
            error: toBoxScoreLoadErrorDetails(error),
            kind: "api_fetch_failed",
          } satisfies BoxScoreLoadResult),
    );
  cache.set(matchId, pending);
  return pending;
}

async function loadRecentCompletedBoxScores(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore">;
  boxScoreCache: Map<string, Promise<BoxScoreLoadResult>>;
  gameStartTime: string | null;
  includeMatch?: ScheduleMatchInclusionPredicate;
  limit: number;
  schedule: BBApiSchedule;
}): Promise<BBApiBoxScore[]> {
  const recentMatches = listCompletedMatchesBefore(
    args.schedule,
    args.gameStartTime,
    args.includeMatch,
  )
    .slice(0, args.limit)
    .map((match) => match.id)
    .filter((matchId): matchId is string => Boolean(matchId));

  const loaded = await Promise.all(
    recentMatches.map((matchId) =>
      loadBoxScore(args.bb, args.boxScoreCache, matchId),
    ),
  );

  return loaded.flatMap((result) =>
    result.kind === "ok" ? [result.boxScore] : [],
  );
}

function hasCompleteBoxScore(boxScore: BBApiBoxScore): boolean {
  return (
    boxScore.homeTeam.score !== null && boxScore.awayTeam.score !== null
  );
}

function toBoxScoreLoadErrorDetails(error: unknown): BoxScoreLoadErrorDetails {
  const loggable = toLoggableError(error);
  const bodyPreview =
    typeof loggable.bodyPreview === "string" ? loggable.bodyPreview : undefined;
  const endpoint =
    typeof loggable.endpoint === "string" ? loggable.endpoint : undefined;
  const errorMessage =
    typeof loggable.errorMessage === "string"
      ? loggable.errorMessage
      : String(error);
  const errorName =
    typeof loggable.errorName === "string" ? loggable.errorName : undefined;
  const status =
    typeof loggable.status === "number" ? loggable.status : undefined;

  const details: BoxScoreLoadErrorDetails = {
    errorMessage,
  };

  if (bodyPreview !== undefined) {
    details.bodyPreview = bodyPreview;
  }
  if (endpoint !== undefined) {
    details.endpoint = endpoint;
  }
  if (errorName !== undefined) {
    details.errorName = errorName;
  }
  if (status !== undefined) {
    details.status = status;
  }

  return details;
}

function isRequestedGameExpectedFinal(args: {
  now: Date;
  request: GameDayRecapPromptPayload["request"];
  requestedGame: SlateGame;
}): boolean {
  if (args.requestedGame.isScheduleFinal) {
    return true;
  }

  const timeZone = normalizeLeagueTimeZone(args.request.timeZone);
  if (!timeZone) {
    return false;
  }

  const currentLeagueDate = resolveCalendarDateKey(
    args.now.toISOString(),
    timeZone,
  );
  if (!currentLeagueDate) {
    return false;
  }

  if (args.request.kind === "LEAGUE_DATE" && args.request.gameDate) {
    return args.request.gameDate < currentLeagueDate;
  }

  const scheduledLeagueDate = resolveCalendarDateKey(
    args.requestedGame.startTime,
    timeZone,
  );
  return Boolean(scheduledLeagueDate && scheduledLeagueDate < currentLeagueDate);
}

function isCoverageStrictForRequest(
  request: GameDayRecapPromptPayload["request"],
): boolean {
  return (
    request.kind === "LEAGUE_DATE" || request.kind === "LEAGUE_GAME_DAY"
  );
}

function formatTeamRatingsForRecap(
  ratings: BBApiBoxScoreTeam["ratings"],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ratings ?? {}).flatMap(([key, value]) => {
      if (!Number.isFinite(value)) {
        return [];
      }

      const label = formatBuzzerBeaterLabel({
        scale: "team_rating",
        value,
      });
      return [[key, label ?? String(roundToOneDecimal(value))]];
    }),
  );
}

function summarizeCompletedRecord(
  matches: BBApiScheduleMatch[],
  teamId: string,
): { losses: number; wins: number } {
  return matches.reduce(
    (record, match) => {
      const margin = getMarginForTeam(match, teamId);
      if (margin === null) {
        return record;
      }

      if (margin >= 0) {
        record.wins += 1;
      } else {
        record.losses += 1;
      }
      return record;
    },
    { losses: 0, wins: 0 },
  );
}

function derivePostgameTeamSeasonContext(args: {
  boxScore: BBApiBoxScore;
  enteringGameContext: TeamSeasonContext;
  priorBoxScores: BBApiBoxScore[];
}): TeamSeasonContext {
  const currentMargin = getBoxScoreMarginForTeam(
    args.boxScore,
    args.enteringGameContext.teamId,
  );
  if (currentMargin === null) {
    return args.enteringGameContext;
  }

  const recentMargins = [currentMargin, ...args.enteringGameContext.recentMargins]
    .filter((margin): margin is number => Number.isFinite(margin))
    .slice(0, 5);
  const postgameBoxScores = [args.boxScore, ...args.priorBoxScores].slice(0, 3);
  const streakPrefix = currentMargin >= 0 ? "W" : "L";
  const priorPrefix =
    args.enteringGameContext.currentStreak.startsWith("W") ||
    args.enteringGameContext.currentStreak.startsWith("L")
      ? args.enteringGameContext.currentStreak[0]
      : null;
  const priorCount = parseInt(
    args.enteringGameContext.currentStreak.slice(1),
    10,
  );
  const streakCount =
    priorPrefix === streakPrefix && Number.isFinite(priorCount)
      ? priorCount + 1
      : 1;
  const currentStreak = `${streakPrefix}${streakCount}`;
  const recentAverageMargin = recentMargins.length
    ? roundToOneDecimal(
        recentMargins.reduce((sum, margin) => sum + margin, 0) /
          recentMargins.length,
      )
    : null;

  return {
    ...args.enteringGameContext,
    currentStreak,
    lastFive: formatLastFiveFromMargins(recentMargins),
    losses:
      args.enteringGameContext.losses + (currentMargin < 0 ? 1 : 0),
    recentAverageMargin,
    recentBoxScoreCoverage: postgameBoxScores.length,
    recentMargins,
    recentSignalFlags: buildRecentSignalFlags({
      boxScores: postgameBoxScores,
      recentAverageMargin,
      streak: currentStreak,
      teamId: args.enteringGameContext.teamId,
    }),
    wins: args.enteringGameContext.wins + (currentMargin >= 0 ? 1 : 0),
  };
}

function buildTeamSeasonContext(args: {
  boxScores: BBApiBoxScore[];
  gameStartTime: string | null;
  includeMatch?: ScheduleMatchInclusionPredicate;
  schedule: BBApiSchedule;
  standing: TeamStandingSummary;
}): TeamSeasonContext {
  const completedMatches = listCompletedMatchesBefore(
    args.schedule,
    args.gameStartTime,
    args.includeMatch,
  );
  const record = summarizeCompletedRecord(completedMatches, args.standing.teamId);
  const recentMatches = completedMatches.slice(0, 5);
  const recentMargins = recentMatches
    .map((match) => getMarginForTeam(match, args.standing.teamId))
    .filter((margin): margin is number => margin !== null);
  const streak = formatCurrentStreak(completedMatches, args.standing.teamId);
  const recentAverageMargin = recentMargins.length
    ? roundToOneDecimal(
        recentMargins.reduce((sum, margin) => sum + margin, 0) /
          recentMargins.length,
      )
    : null;

  return {
    conferenceIndex: args.standing.conferenceIndex,
    conferencePosition: args.standing.conferencePosition,
    currentStreak: streak,
    lastFive: formatLastFive(recentMatches, args.standing.teamId),
    losses: record.losses,
    recentAverageMargin,
    recentBoxScoreCoverage: args.boxScores.length,
    recentMargins,
    recentSignalFlags: buildRecentSignalFlags({
      boxScores: args.boxScores,
      recentAverageMargin,
      streak,
      teamId: args.standing.teamId,
    }),
    teamId: args.standing.teamId,
    teamName: args.standing.teamName,
    wins: record.wins,
  };
}

function buildRecentSignalFlags(args: {
  boxScores: BBApiBoxScore[];
  recentAverageMargin: number | null;
  streak: string;
  teamId: string;
}): string[] {
  const recentSignalFlags = new Set<string>();

  if (countBlowoutLosses(args.boxScores, args.teamId) >= 2) {
    recentSignalFlags.add("possible_strategic_deemphasis");
  }
  if ((args.recentAverageMargin ?? 0) <= -10) {
    recentSignalFlags.add("recent_slide");
  }
  if (args.streak.startsWith("W") && parseInt(args.streak.slice(1), 10) >= 3) {
    recentSignalFlags.add("hot_streak");
  }
  if (args.streak.startsWith("L") && parseInt(args.streak.slice(1), 10) >= 3) {
    recentSignalFlags.add("cold_streak");
  }

  return Array.from(recentSignalFlags);
}

function countBlowoutLosses(boxScores: BBApiBoxScore[], teamId: string): number {
  return boxScores.filter((boxScore) => {
    const margin = getBoxScoreMarginForTeam(boxScore, teamId);
    return margin !== null && margin <= -15;
  }).length;
}

function formatLastFiveFromMargins(margins: number[]): string {
  if (!margins.length) {
    return "0-0";
  }

  let wins = 0;
  let losses = 0;
  for (const margin of margins) {
    if (margin >= 0) {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  return `${wins}-${losses}`;
}

function formatTeamRecord(context: TeamSeasonContext): string {
  return `${context.wins}-${context.losses}`;
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
  includeMatch?: ScheduleMatchInclusionPredicate,
): BBApiScheduleMatch[] {
  const cutoff = parseTimestamp(gameStartTime);
  return [...schedule.matches]
    .filter((match) =>
      Boolean(
        match.id &&
        (includeMatch ? includeMatch(match) : true) &&
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
    .sort(
      (left, right) =>
        scorePlayerPerformance(right) - scorePlayerPerformance(left),
    )
    .slice(0, 3)
    .map((player) => {
      const performanceStats = player.performanceStats ?? {};
      return {
        assists: asNumberFromUnknown(performanceStats.ast),
        blocks: asNumberFromUnknown(performanceStats.blk),
        minutes: Object.values(
          toOptionalRecord(player.minutesByPosition) ?? {},
        ).reduce<number>(
          (sum, value) => sum + asNumberFromUnknown(value),
          0,
        ),
        name: player.fullName,
        points: asNumberFromUnknown(performanceStats.pts),
        rebounds: asNumberFromUnknown(performanceStats.reb),
        steals: asNumberFromUnknown(performanceStats.stl),
        turnovers: asNumberFromUnknown(performanceStats.to),
      };
    });
}

function isRegularSeasonLeagueContextMatch(match: BBApiScheduleMatch): boolean {
  return (
    classifyCompetition(match.type).competitionKey === "LEAGUE_REGULAR_SEASON"
  );
}

function scorePlayerPerformance(player: BBApiBoxScorePlayer): number {
  const performanceStats = player.performanceStats ?? {};
  const points = asNumberFromUnknown(performanceStats.pts);
  const rebounds = asNumberFromUnknown(performanceStats.reb);
  const assists = asNumberFromUnknown(performanceStats.ast);
  const steals = asNumberFromUnknown(performanceStats.stl);
  const blocks = asNumberFromUnknown(performanceStats.blk);
  const turnovers = asNumberFromUnknown(performanceStats.to);

  return (
    points + rebounds * 0.7 + assists * 0.7 + steals + blocks - turnovers * 0.5
  );
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

function getBoxScoreMarginForTeam(
  boxScore: BBApiBoxScore,
  teamId: string,
): number | null {
  const teamBoxScore = resolveBoxScoreTeam(boxScore, teamId);
  const opponentBoxScore = resolveOpponentBoxScoreTeam(boxScore, teamId);

  return teamBoxScore && opponentBoxScore
    ? (teamBoxScore.score ?? 0) - (opponentBoxScore.score ?? 0)
    : null;
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

function formatLastFive(matches: BBApiScheduleMatch[], teamId: string): string {
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

function buildQuarterFacts(
  boxScore: BBApiBoxScore,
): GameDayRecapPromptQuarterFacts {
  const periods = boxScore.homeTeam.partialScores.flatMap((homeScore, index) => {
    const awayScore = boxScore.awayTeam.partialScores[index];
    if (awayScore == null) {
      return [];
    }

    const margin = Math.abs(homeScore - awayScore);
    const winningSide =
      homeScore === awayScore ? "tie" : homeScore > awayScore ? "home" : "away";

    return [
      {
        awayScore,
        homeScore,
        label: formatPeriodLabel(index + 1),
        margin,
        period: index + 1,
        winningSide,
      } satisfies GameDayRecapPromptPeriodFact,
    ];
  });

  const decisiveQuarter = [...periods]
    .filter(
      (
        period,
      ): period is GameDayRecapPromptPeriodFact & {
        winningSide: "away" | "home";
      } =>
        period.winningSide !== "tie" &&
        period.margin >= GAME_DAY_RECAP_DECISIVE_QUARTER_MARGIN,
    )
    .sort((left, right) => right.margin - left.margin || left.period - right.period)
    .at(0) ?? null;

  return {
    decisiveQuarter,
    fourthQuarterOutcome:
      periods.find((period) => period.period === 4) ?? null,
    periods,
  };
}

function formatPeriodLabel(period: number): string {
  if (period <= 4) {
    return `${ordinal(period)} quarter`;
  }

  return period === 5 ? "overtime" : `${ordinal(period - 4)} overtime`;
}

function compactScalarRecord(
  input: Record<string, number | string | null> | null | undefined,
): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(input ?? {})
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
        return (
          (left.startTimestamp ?? Number.POSITIVE_INFINITY) -
          (right.startTimestamp ?? Number.POSITIVE_INFINITY)
        );
      }

      return (
        (left.id ?? Number.POSITIVE_INFINITY) -
        (right.id ?? Number.POSITIVE_INFINITY)
      );
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
        ? startTimestamp <= matchTimestamp &&
          matchTimestamp < nextStartTimestamp
        : finishTimestamp !== null
          ? startTimestamp <= matchTimestamp &&
            matchTimestamp <= finishTimestamp
          : startTimestamp <= matchTimestamp
      : false;

    return {
      finish: season.finish,
      finishTimestamp,
      hasUsableBounds,
      id: season.id,
      invalidBounds:
        Boolean(season.normalizedStart || season.normalizedFinish) &&
        !hasUsableBounds,
      matchesGameDate,
      normalizedFinish: season.normalizedFinish,
      normalizedStart: season.normalizedStart,
      start: season.start,
      startTimestamp,
    };
  });
}

async function resolveSeasonedLeagueSlateForRecap(args: {
  bb: Pick<BBXmlApiClient, "getSchedule" | "getSeasons" | "getStandings"> &
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

  if (
    currentStandings.season !== null &&
    currentStandings.season !== undefined
  ) {
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
    logGameDayRecapWarn(
      "process.resolve_current_slate.skipped_missing_season",
      {
        gameDate: args.gameDate,
        leagueId: args.leagueId,
        targetKey: args.targetKey,
        userId: args.userId,
      },
    );
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

  const candidateSeasons = resolveSeasonCandidatesForDate(
    seasons,
    args.gameDate,
  );
  logGameDayRecapInfo("process.resolve_historical_candidates", {
    candidateSeasons,
    currentSeason: currentStandings.season ?? null,
    gameDate: args.gameDate,
    targetKey: args.targetKey,
    userId: args.userId,
  });

  const triedSeasons = new Set<number>();
  if (
    currentStandings.season !== null &&
    currentStandings.season !== undefined
  ) {
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
    throw new Error(
      `Unable to resolve a BuzzerBeater season for ${args.gameDate}.`,
    );
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
      parsedSeasons: summarizeSeasonDiagnostics(
        args.parsedSeasons,
        args.gameDate,
      ),
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
      parsedSeasons: summarizeSeasonDiagnostics(
        args.parsedSeasons,
        args.gameDate,
      ),
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

function logGameDayRecapInfo(
  event: string,
  details: Record<string, unknown>,
): void {
  console.info(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function logGameDayRecapWarn(
  event: string,
  details: Record<string, unknown>,
): void {
  console.warn(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function logGameDayRecapError(
  event: string,
  details: Record<string, unknown>,
): void {
  console.error(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function isRetryableCompletedSlateCoverageError(
  error: unknown,
): error is RetryableCompletedSlateCoverageError {
  return (
    error instanceof RetryableCompletedSlateCoverageError ||
    (error instanceof Error &&
      error.name === RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME &&
      "coverage" in error)
  );
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
  if ("bodyPreview" in error && typeof error.bodyPreview === "string") {
    details.bodyPreview = error.bodyPreview;
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

function toOptionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
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
    throw new Error(
      "The saved BuzzerBeater connection is missing a login name.",
    );
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
    generate: async (payload, options) => {
      const response = await client.send(
        new ConverseCommand(
          buildGameDayRecapBedrockRequest({
            modelId: args.modelId,
            payload,
            validationFeedback: options?.validationFeedback,
          }),
        ),
      );

      const output = response.output;
      const content =
        output && "message" in output ? (output.message?.content ?? []) : [];
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

      return JSON.parse(text);
    },
    modelId: args.modelId,
    providerName: "bedrock",
  };
}

async function generateValidatedGameDayRecap(args: {
  payload: GameDayRecapPromptPayload;
  provider: BedrockGameDayRecapProvider;
}): Promise<GeneratedGameDayRecap> {
  const initialOutput = await args.provider.generate(args.payload);

  try {
    return {
      coverageIssues: [],
      result: validateGameDayRecapResult(initialOutput, args.payload.games),
    };
  } catch (error) {
    if (!isGameDayRecapSemanticValidationError(error)) {
      throw error;
    }

    const retryOutput = await args.provider.generate(args.payload, {
      validationFeedback: error.feedbackLines,
    });

    try {
      return {
        coverageIssues: [],
        result: validateGameDayRecapResult(retryOutput, args.payload.games),
      };
    } catch (retryError) {
      if (!isGameDayRecapSemanticValidationError(retryError)) {
        throw retryError;
      }

      return salvageGameDayRecapResult({
        expectedGames: args.payload.games,
        issues: retryError.issues,
        request: args.payload.request,
        result: normalizeGameDayRecapResult(retryOutput),
      });
    }
  }
}

function validateGameDayRecapResult(
  input: unknown,
  expectedGames: GameDayRecapPromptGame[],
): GameDayRecapResultPayload {
  return validateGameDayRecapPayload(
    normalizeGameDayRecapResult(input),
    expectedGames,
  );
}

function normalizeGameDayRecapResult(input: unknown): GameDayRecapResultPayload {
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
      throw new Error(
        "Game day recap result contained an incomplete game entry.",
      );
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

  const headline = asOptionalString(summary.headline)?.trim();
  const lede = asOptionalString(summary.lede)?.trim();
  if (!headline || !lede) {
    throw new Error("Game day recap summary was missing a headline or lede.");
  }

  return {
    games: validatedGames,
    summary: {
      headline,
      lede,
    },
  };
}

function validateGameDayRecapPayload(
  result: GameDayRecapResultPayload,
  expectedGames: GameDayRecapPromptGame[],
  options: {
    allowPartial?: boolean;
  } = {},
): GameDayRecapResultPayload {
  const orderedGames = orderGameDayRecapGames(
    result.games,
    expectedGames,
    options.allowPartial ?? false,
  );
  const expectedGamesByMatchId = new Map(
    expectedGames.map((game) => [game.matchId, game]),
  );
  const semanticIssues = orderedGames.flatMap((game) => {
    const expectedGame = expectedGamesByMatchId.get(game.matchId);
    return expectedGame ? validateRecapGameSemantics(game, expectedGame) : [];
  });
  if (semanticIssues.length > 0) {
    throw new GameDayRecapSemanticValidationError(semanticIssues);
  }

  return {
    games: orderedGames,
    summary: result.summary,
  };
}

function orderGameDayRecapGames(
  games: GameDayRecapResultPayload["games"],
  expectedGames: GameDayRecapPromptGame[],
  allowPartial = false,
): GameDayRecapResultPayload["games"] {
  const expectedMatchIds = expectedGames.map((game) => game.matchId);
  const matchIdSet = new Set(expectedMatchIds);
  const gamesByMatchId = new Map<string, GameDayRecapResultGame>();

  for (const game of games) {
    if (!matchIdSet.has(game.matchId)) {
      throw new Error(
        "Game day recap result did not match the expected slate coverage.",
      );
    }
    if (gamesByMatchId.has(game.matchId)) {
      throw new Error("Game day recap result contained duplicate match coverage.");
    }
    gamesByMatchId.set(game.matchId, game);
  }

  if (!allowPartial && gamesByMatchId.size !== expectedMatchIds.length) {
    throw new Error(
      "Game day recap result did not match the expected slate coverage.",
    );
  }

  const orderedGames = expectedMatchIds.flatMap((matchId) => {
    const game = gamesByMatchId.get(matchId);
    return game ? [game] : [];
  });

  if (!allowPartial && orderedGames.length !== expectedMatchIds.length) {
    const missingMatchId = expectedMatchIds.find(
      (matchId) => !gamesByMatchId.has(matchId),
    );
    throw new Error(
      missingMatchId
        ? `Game day recap result omitted match ${missingMatchId}.`
        : "Game day recap result did not match the expected slate coverage.",
    );
  }

  return orderedGames;
}

function validateRecapGameSemantics(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  return [
    ...collectSemanticIssuesForField(
      game.headline,
      "headline",
      game.matchId,
      expectedGame,
    ),
    ...collectSemanticIssuesForField(
      game.writeup,
      "writeup",
      game.matchId,
      expectedGame,
    ),
  ];
}

function collectSemanticIssuesForField(
  text: string,
  field: GameDayRecapSemanticValidationIssueField,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  return splitRecapText(text).flatMap((sentence, sentenceIndex) => [
    ...validateQuarterSentence(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validateRecordSentence(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validateCompactStreakSentence(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
  ]);
}

function validateQuarterSentence(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  const referencedPeriod = extractReferencedQuarter(sentence);
  if (!referencedPeriod) {
    return [];
  }

  const periodFact = expectedGame.quarterFacts.periods.find(
    (period) => period.period === referencedPeriod,
  );
  if (!periodFact) {
    return [];
  }

  const quarterWinnerVerbMatch = sentence.match(
    /\b(?:outscor(?:e|ed|es|ing)|won|take(?:s|n)?|took|claim(?:ed|s|ing))\b/i,
  );
  if (!quarterWinnerVerbMatch) {
    return [];
  }

  const issues: GameDayRecapSemanticValidationIssue[] = [];
  const periodMatch = sentence.match(
    /\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+quarter\b/i,
  );
  const scorePair = findClosestScorePair(sentence, periodMatch?.index ?? 0);
  const winnerSide = resolveExplicitQuarterWinnerSide(sentence, expectedGame);

  if (scorePair) {
    const matchesActualScore =
      (scorePair.first === periodFact.homeScore &&
        scorePair.second === periodFact.awayScore) ||
      (scorePair.first === periodFact.awayScore &&
        scorePair.second === periodFact.homeScore);
    if (!matchesActualScore) {
      issues.push({
        actualValue: `${periodFact.homeScore}-${periodFact.awayScore}`,
        feedback: `For match ${matchId}, the ${periodFact.label} score was ${periodFact.homeScore}-${periodFact.awayScore} from the home-away view (${periodFact.awayScore}-${periodFact.homeScore} from the away-home view). Do not use ${scorePair.first}-${scorePair.second}.`,
        field,
        kind: "quarter_score_mismatch",
        matchId,
        period: periodFact.period,
        reason: `${periodFact.label} was ${periodFact.homeScore}-${periodFact.awayScore}, not ${scorePair.first}-${scorePair.second}.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
      });
      return issues;
    }

    if (scorePair.first === scorePair.second) {
      issues.push({
        actualValue: `${scorePair.first}-${scorePair.second}`,
        feedback: `For match ${matchId}, the ${periodFact.label} was tied ${scorePair.first}-${scorePair.second}. Do not say either team outscored, won, or took that quarter.`,
        field,
        kind: "tied_quarter_claim",
        matchId,
        period: periodFact.period,
        reason: `${periodFact.label} was tied ${scorePair.first}-${scorePair.second}, so no team outscored the other.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
      });
      return issues;
    }
  }

  if (!winnerSide) {
    return issues;
  }

  if (periodFact.winningSide === "tie") {
    issues.push({
      actualValue: `${periodFact.homeScore}-${periodFact.awayScore}`,
      feedback: `For match ${matchId}, the ${periodFact.label} was tied ${periodFact.homeScore}-${periodFact.awayScore}. Do not say ${expectedGame.teams[winnerSide].name} won that quarter.`,
      field,
      kind: "wrong_quarter_winner",
      matchId,
      period: periodFact.period,
      reason: `${expectedGame.teams[winnerSide].name} was credited with winning a tied ${periodFact.label}.`,
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
      teamSide: winnerSide,
    });
    return issues;
  }

  if (periodFact.winningSide !== winnerSide) {
    issues.push({
      actualValue: expectedGame.teams[periodFact.winningSide].name,
      feedback: `For match ${matchId}, ${expectedGame.teams[periodFact.winningSide].name} won the ${periodFact.label} ${winnerFacingQuarterScore(periodFact, periodFact.winningSide)}. Do not say ${expectedGame.teams[winnerSide].name} won that quarter.`,
      field,
      kind: "wrong_quarter_winner",
      matchId,
      period: periodFact.period,
      reason: `${expectedGame.teams[winnerSide].name} was credited with the ${periodFact.label}, but ${expectedGame.teams[periodFact.winningSide].name} actually won it.`,
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
      teamSide: winnerSide,
    });
    return issues;
  }

  if (scorePair) {
    const expectedWinnerScore =
      winnerSide === "home" ? periodFact.homeScore : periodFact.awayScore;
    const expectedLoserScore =
      winnerSide === "home" ? periodFact.awayScore : periodFact.homeScore;
    if (
      scorePair.first !== expectedWinnerScore ||
      scorePair.second !== expectedLoserScore
    ) {
      issues.push({
        actualValue: `${expectedWinnerScore}-${expectedLoserScore}`,
        feedback: `For match ${matchId}, if you say ${expectedGame.teams[winnerSide].name} won the ${periodFact.label}, use ${expectedWinnerScore}-${expectedLoserScore}.`,
        field,
        kind: "quarter_winner_score_mismatch",
        matchId,
        period: periodFact.period,
        reason: `${expectedGame.teams[winnerSide].name} was paired with the wrong ${periodFact.label} score.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
        teamSide: winnerSide,
      });
    }
  }

  return issues;
}

function validateRecordSentence(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  if (hasPregameQualifier(sentence)) {
    return [];
  }

  const issues: GameDayRecapSemanticValidationIssue[] = [];

  for (const side of ["home", "away"] as const) {
    const team = expectedGame.teams[side];
    if (!team.record) {
      continue;
    }

    const escapedName = escapeRegExp(team.name);
    const parentheticalMatch = sentence.match(
      new RegExp(`${escapedName}[^.!?]{0,20}\\((\\d{1,2})-(\\d{1,2})\\)`, "i"),
    );
    if (parentheticalMatch) {
      const mentionedRecord = `${parentheticalMatch[1]}-${parentheticalMatch[2]}`;
      if (mentionedRecord !== team.record) {
        issues.push({
          actualValue: team.record,
          feedback: `For match ${matchId}, ${team.name}'s postgame record is ${team.record}. Do not use ${mentionedRecord}.`,
          field,
          kind: "record_mismatch",
          matchId,
          reason: `${team.name} was given a ${mentionedRecord} record instead of ${team.record}.`,
          salvage: semanticIssueSalvageForField(field),
          sentence,
          sentenceIndex,
          teamSide: side,
        });
      }
      continue;
    }

    const directionalMatch = sentence.match(
      new RegExp(
        `${escapedName}[^.!?]{0,40}\\b(?:now\\s+at|at|to|improved\\s+to|moved\\s+to|fell\\s+to|dropped\\s+to)\\s+(\\d{1,2})-(\\d{1,2})\\b`,
        "i",
      ),
    );
    if (!directionalMatch) {
      continue;
    }

    const mentionedRecord = `${directionalMatch[1]}-${directionalMatch[2]}`;
    if (mentionedRecord !== team.record) {
      issues.push({
        actualValue: team.record,
        feedback: `For match ${matchId}, ${team.name}'s postgame record is ${team.record}. Do not use ${mentionedRecord}.`,
        field,
        kind: "record_mismatch",
        matchId,
        reason: `${team.name} was said to be ${mentionedRecord} instead of ${team.record}.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
        teamSide: side,
      });
    }
  }

  return issues;
}

function validateCompactStreakSentence(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  if (hasPregameQualifier(sentence)) {
    return [];
  }

  const issues: GameDayRecapSemanticValidationIssue[] = [];

  for (const side of ["home", "away"] as const) {
    const team = expectedGame.teams[side];
    if (!team.streak) {
      continue;
    }

    const compactStreakMatch = sentence.match(
      new RegExp(
        `${escapeRegExp(team.name)}[^.!?]{0,40}\\b([WL])(\\d{1,2})\\b`,
        "i",
      ),
    );
    if (!compactStreakMatch) {
      continue;
    }

    const mentionedStreak = `${compactStreakMatch[1]?.toUpperCase() ?? ""}${compactStreakMatch[2]}`;
    if (mentionedStreak !== team.streak) {
      issues.push({
        actualValue: team.streak,
        feedback: `For match ${matchId}, ${team.name}'s postgame streak is ${team.streak}. Do not use ${mentionedStreak}.`,
        field,
        kind: "compact_streak_mismatch",
        matchId,
        reason: `${team.name} was given a ${mentionedStreak} streak instead of ${team.streak}.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
        teamSide: side,
      });
    }
  }

  return issues;
}

function semanticIssueSalvageForField(
  field: GameDayRecapSemanticValidationIssueField,
): GameDayRecapSemanticValidationIssueSalvage {
  return field === "writeup" ? "patch_or_remove" : "drop_only";
}

function salvageGameDayRecapResult(args: {
  expectedGames: GameDayRecapPromptGame[];
  issues: GameDayRecapSemanticValidationIssue[];
  request: GameDayRecapPromptPayload["request"];
  result: GameDayRecapResultPayload;
}): GeneratedGameDayRecap {
  const orderedGames = orderGameDayRecapGames(args.result.games, args.expectedGames);
  const issuesByMatchId = new Map<string, GameDayRecapSemanticValidationIssue[]>();

  for (const issue of args.issues) {
    const issues = issuesByMatchId.get(issue.matchId);
    if (issues) {
      issues.push(issue);
      continue;
    }
    issuesByMatchId.set(issue.matchId, [issue]);
  }

  const retainedGames: GameDayRecapResultPayload["games"] = [];
  const coverageIssues: CoverageIssue[] = [];

  for (const expectedGame of args.expectedGames) {
    const currentGame = orderedGames.find((game) => game.matchId === expectedGame.matchId);
    if (!currentGame) {
      continue;
    }

    const issues = issuesByMatchId.get(currentGame.matchId) ?? [];
    if (!issues.length) {
      retainedGames.push(currentGame);
      continue;
    }

    const salvagedGame = salvageGameDayRecapGame({
      expectedGame,
      game: currentGame,
      issues,
    });
    if (salvagedGame) {
      retainedGames.push(salvagedGame);
      continue;
    }

    coverageIssues.push({
      awayTeamName: expectedGame.teams.away.name,
      homeTeamName: expectedGame.teams.home.name,
      matchId: currentGame.matchId,
      reason: "removed after factual validation could not be safely repaired",
    });
  }

  if (!retainedGames.length) {
    throw new Error(
      "Game day recap response could not be safely repaired because every game summary still contained factual contradictions.",
    );
  }

  const result = coverageIssues.length
    ? {
        games: retainedGames,
        summary: buildSafePartialRecapSummary({
          droppedGameCount: coverageIssues.length,
          request: args.request,
          retainedGameCount: retainedGames.length,
        }),
      }
    : {
        games: retainedGames,
        summary: args.result.summary,
      };

  return {
    coverageIssues,
    result: validateGameDayRecapPayload(result, args.expectedGames, {
      allowPartial: coverageIssues.length > 0,
    }),
  };
}

function salvageGameDayRecapGame(args: {
  expectedGame: GameDayRecapPromptGame;
  game: GameDayRecapResultGame;
  issues: GameDayRecapSemanticValidationIssue[];
}): GameDayRecapResultGame | null {
  if (
    args.issues.some(
      (issue) => issue.field === "headline" || issue.salvage === "drop_only",
    )
  ) {
    return null;
  }

  const patchedGame = applyGameWriteupRepairs(args.game, args.expectedGame, args.issues);
  const remainingAfterPatch = validateRecapGameSemantics(
    patchedGame,
    args.expectedGame,
  );
  if (remainingAfterPatch.length === 0) {
    return patchedGame;
  }
  if (
    remainingAfterPatch.some(
      (issue) => issue.field === "headline" || issue.salvage === "drop_only",
    )
  ) {
    return null;
  }

  const trimmedGame = removeInvalidWriteupSentences(
    patchedGame,
    remainingAfterPatch,
  );
  if (!trimmedGame) {
    return null;
  }

  return validateRecapGameSemantics(trimmedGame, args.expectedGame).length === 0
    ? trimmedGame
    : null;
}

function applyGameWriteupRepairs(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
  issues: GameDayRecapSemanticValidationIssue[],
): GameDayRecapResultGame {
  const sentences = splitRecapText(game.writeup);
  const issuesBySentence = new Map<number, GameDayRecapSemanticValidationIssue[]>();

  for (const issue of issues) {
    if (issue.field !== "writeup") {
      continue;
    }
    const sentenceIssues = issuesBySentence.get(issue.sentenceIndex);
    if (sentenceIssues) {
      sentenceIssues.push(issue);
      continue;
    }
    issuesBySentence.set(issue.sentenceIndex, [issue]);
  }

  for (const [sentenceIndex, sentenceIssues] of Array.from(
    issuesBySentence.entries(),
  )) {
    const replacement = buildSafeReplacementSentence(
      choosePreferredRepairIssue(sentenceIssues),
      expectedGame,
    );
    if (!replacement || !sentences[sentenceIndex]) {
      continue;
    }
    sentences[sentenceIndex] = replacement;
  }

  return {
    ...game,
    writeup: sentences.join(" "),
  };
}

function choosePreferredRepairIssue(
  issues: GameDayRecapSemanticValidationIssue[],
): GameDayRecapSemanticValidationIssue {
  const priorities: Record<GameDayRecapSemanticValidationIssueKind, number> = {
    compact_streak_mismatch: 1,
    quarter_score_mismatch: 2,
    quarter_winner_score_mismatch: 3,
    record_mismatch: 0,
    tied_quarter_claim: 4,
    wrong_quarter_winner: 5,
  };

  return [...issues].sort(
    (left, right) => priorities[left.kind] - priorities[right.kind],
  )[0] ?? issues[0]!;
}

function buildSafeReplacementSentence(
  issue: GameDayRecapSemanticValidationIssue,
  expectedGame: GameDayRecapPromptGame,
): string | null {
  switch (issue.kind) {
    case "record_mismatch": {
      const team = issue.teamSide ? expectedGame.teams[issue.teamSide] : null;
      return team?.record ? `${team.name} finished the game at ${team.record}.` : null;
    }
    case "compact_streak_mismatch": {
      const team = issue.teamSide ? expectedGame.teams[issue.teamSide] : null;
      return team?.streak
        ? `${team.name}'s postgame streak is ${team.streak}.`
        : null;
    }
    case "quarter_score_mismatch":
    case "quarter_winner_score_mismatch":
    case "wrong_quarter_winner":
    case "tied_quarter_claim": {
      if (!issue.period) {
        return null;
      }
      const periodFact = expectedGame.quarterFacts.periods.find(
        (period) => period.period === issue.period,
      );
      if (!periodFact) {
        return null;
      }

      if (periodFact.winningSide === "tie") {
        return `The ${periodFact.label} ended tied at ${periodFact.homeScore}-${periodFact.awayScore}.`;
      }

      return `${expectedGame.teams[periodFact.winningSide].name} won the ${periodFact.label} ${winnerFacingQuarterScore(periodFact, periodFact.winningSide)}.`;
    }
    default:
      return null;
  }
}

function removeInvalidWriteupSentences(
  game: GameDayRecapResultGame,
  issues: GameDayRecapSemanticValidationIssue[],
): GameDayRecapResultGame | null {
  const sentences = splitRecapText(game.writeup);
  const invalidSentenceIndexes = new Set(
    issues
      .filter((issue) => issue.field === "writeup")
      .map((issue) => issue.sentenceIndex),
  );
  const trimmedSentences = sentences.filter(
    (_sentence, sentenceIndex) => !invalidSentenceIndexes.has(sentenceIndex),
  );

  if (!trimmedSentences.length) {
    return null;
  }

  return {
    ...game,
    writeup: trimmedSentences.join(" "),
  };
}

function buildSafePartialRecapSummary(args: {
  droppedGameCount: number;
  request: GameDayRecapPromptPayload["request"];
  retainedGameCount: number;
}): GameDayRecapResultSummary {
  const label = args.request.leagueName?.trim() || args.request.label.trim();
  const retainedGamesLabel =
    args.retainedGameCount === 1 ? "game" : "games";
  const droppedGamesLabel =
    args.droppedGameCount === 1 ? "game was" : "games were";

  return {
    headline: `${label} partial roundup`,
    lede: `This partial recap covers ${args.retainedGameCount} validated ${retainedGamesLabel} from the requested slate after ${args.droppedGameCount} ${droppedGamesLabel} removed during factual validation.`,
  };
}

function mergeCoverageIssues(
  coverage: GameDayRecapCoveragePayload,
  coverageIssues: CoverageIssue[],
): GameDayRecapCoveragePayload {
  if (!coverageIssues.length) {
    return coverage;
  }

  const missingGames = [...coverage.missingGames, ...coverageIssues];
  return {
    availableGames: Math.max(0, coverage.availableGames - coverageIssues.length),
    missingGames,
    partial: true,
    requestedGames: coverage.requestedGames,
  };
}

function splitRecapText(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n\r]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractReferencedQuarter(sentence: string): number | null {
  const match = sentence.match(
    /\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+quarter\b/i,
  );
  const token = match?.[1]?.toLowerCase();
  if (!token) {
    return null;
  }

  switch (token) {
    case "first":
    case "1st":
      return 1;
    case "second":
    case "2nd":
      return 2;
    case "third":
    case "3rd":
      return 3;
    case "fourth":
    case "4th":
      return 4;
    default:
      return null;
  }
}

function findClosestScorePair(
  sentence: string,
  pivotIndex: number,
): { first: number; second: number } | null {
  let selected: { distance: number; first: number; second: number } | null = null;

  const scorePattern = /\b(\d{1,3})-(\d{1,3})\b/g;
  let match = scorePattern.exec(sentence);
  while (match) {
    const first = asOptionalNumber(match[1]);
    const second = asOptionalNumber(match[2]);
    const index = match.index ?? 0;
    if (first === null || second === null) {
      match = scorePattern.exec(sentence);
      continue;
    }

    const distance = Math.abs(index - pivotIndex);
    if (!selected || distance < selected.distance) {
      selected = { distance, first, second };
    }

    match = scorePattern.exec(sentence);
  }

  return selected
    ? {
        first: selected.first,
        second: selected.second,
      }
    : null;
}

function resolveExplicitQuarterWinnerSide(
  sentence: string,
  expectedGame: GameDayRecapPromptGame,
): "away" | "home" | null {
  for (const side of ["home", "away"] as const) {
    const teamName = expectedGame.teams[side].name;
    if (
      new RegExp(
        `${escapeRegExp(teamName)}[^.!?]{0,80}\\b(?:outscor(?:e|ed|es|ing)|won|take(?:s|n)?|took|claim(?:ed|s|ing))\\b`,
        "i",
      ).test(sentence)
    ) {
      return side;
    }
  }

  return null;
}

function winnerFacingQuarterScore(
  periodFact: GameDayRecapPromptPeriodFact,
  winnerSide: "away" | "home",
): string {
  return winnerSide === "home"
    ? `${periodFact.homeScore}-${periodFact.awayScore}`
    : `${periodFact.awayScore}-${periodFact.homeScore}`;
}

function hasPregameQualifier(sentence: string): boolean {
  return /\b(enter(?:ed|ing)|came in|coming in|before tipoff|pregame|pre-game)\b/i.test(
    sentence,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGameDayRecapSemanticValidationError(
  error: unknown,
): error is GameDayRecapSemanticValidationError {
  return error instanceof GameDayRecapSemanticValidationError;
}

export {
  buildGameDayRecapTargetKey,
  buildLeagueGameDayRecapTargetKey,
  buildSingleGameSummaryTargetKey,
  normalizeGameDayRecapRequest,
  normalizeLeagueGameDayRecapRequest,
  normalizeSingleGameSummaryRequest,
  parseGameDayRecapQueueMessage,
} from "./game-day-recap-request";

export const __testing = {
  GAME_DAY_RECAP_EVIDENCE_TAGS,
  GAME_DAY_RECAP_PROMPT_VERSION,
  GAME_DAY_RECAP_RESULT_SCHEMA,
  SUPPORTED_STRUCTURED_OUTPUT_MODEL_PATTERNS,
  buildQuarterFacts,
  buildEvidenceSignals,
  buildGameDayRecapBedrockRequest,
  buildGameDayRecapPromptPayload,
  buildSafePartialRecapSummary,
  buildGameDayRecapTargetKey,
  buildTeamSeasonContext,
  derivePostgameTeamSeasonContext,
  extractStandingTeams,
  extractTopPlayers,
  formatCurrentStreak,
  formatLastFive,
  isRegularSeasonLeagueContextMatch,
  listCompletedMatchesBefore,
  mergeCoverageIssues,
  normalizeGameDayRecapRequest,
  normalizeGameDayRecapResult,
  parseGameDayRecapQueueMessage,
  removeInvalidWriteupSentences,
  resolveConfiguredRecapModelId,
  resolveQueuedRecapModelId,
  resolveLeagueDaySlate,
  resolveLeagueGameDaySlate,
  resolveSeasonCandidatesForDate,
  resolveSeasonForDate,
  salvageGameDayRecapResult,
  summarizeSeasonDiagnostics,
  validateGameDayRecapResult,
};
