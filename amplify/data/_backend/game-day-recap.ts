import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

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
import { resolveBbAccessKey } from "./credentials";
import {
  getBbConnection,
  getGameDayRecap,
  updateGameDayRecap,
  upsertGameDayRecap,
  type BbConnectionRecord,
  type GameDayRecapStatus,
} from "./repository";
import { requireFeatureAccess } from "./billing";

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

type GameDayRecapQueueMessage = {
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
  league: {
    gameDate: string;
    leagueId: string;
    leagueName: string | null;
    season: number;
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
  conferenceIndex: number;
  conferencePosition: number;
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

type SlateGame = {
  awayTeamId: string;
  awayTeamName: string;
  homeTeamId: string;
  homeTeamName: string;
  matchId: string;
  startTime: string | null;
  type: string | null;
};

type BedrockGameDayRecapProvider = {
  generate: (payload: GameDayRecapPromptPayload) => Promise<GameDayRecapResultPayload>;
  modelId: string;
  providerName: "bedrock";
};

type SubmitDependencies = {
  enqueueRecapJob: (
    queueUrl: string,
    message: GameDayRecapQueueMessage,
  ) => Promise<void>;
  getGameDayRecap: typeof getGameDayRecap;
  now: () => Date;
  requireFeatureAccess: typeof requireFeatureAccess;
  updateGameDayRecap: typeof updateGameDayRecap;
  upsertGameDayRecap: typeof upsertGameDayRecap;
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
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  updateGameDayRecap: typeof updateGameDayRecap;
};

const GAME_DAY_RECAP_PROMPT_VERSION = "gameday-recap-v1";
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
  enqueueRecapJob: async (queueUrl, message) => {
    const sqs = new SQSClient({});
    await sqs.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(message),
        QueueUrl: queueUrl,
      }),
    );
  },
  getGameDayRecap,
  now: () => new Date(),
  requireFeatureAccess,
  updateGameDayRecap,
  upsertGameDayRecap,
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
  now: () => new Date(),
  resolveBbAccessKey,
  updateGameDayRecap,
};

export async function submitGameDayRecap(
  args: {
    env: GraphqlEnv;
    gameDate: string;
    identity: unknown;
    leagueId: string;
    queueUrl: string;
  },
  dependencies: SubmitDependencies = defaultSubmitDependencies,
): Promise<{ targetKey: string }> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  logGameDayRecapInfo("submit.received", {
    gameDate: args.gameDate,
    leagueId: args.leagueId,
    userId,
  });

  await dependencies.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });

  const request = normalizeGameDayRecapRequest({
    gameDate: args.gameDate,
    leagueId: args.leagueId,
  });
  const targetKey = buildGameDayRecapTargetKey(request.leagueId, request.gameDate);
  const existing = await dependencies.getGameDayRecap(args.env, userId, targetKey);

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
    return { targetKey };
  }

  const requestedAt = dependencies.now().toISOString();

  logGameDayRecapInfo("submit.persisting_job", {
    requestedAt,
    targetKey,
    userId,
  });

  await dependencies.upsertGameDayRecap(args.env, {
    completedAt: null,
    coverageJson: null,
    error: null,
    gameDate: request.gameDate,
    leagueId: request.leagueId,
    leagueName: existing?.leagueName ?? null,
    modelId: null,
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
  });

  try {
    logGameDayRecapInfo("submit.enqueue.start", {
      requestedAt,
      targetKey,
      userId,
    });
    await dependencies.enqueueRecapJob(args.queueUrl, {
      requestedAt,
      targetKey,
      userId,
    });
    logGameDayRecapInfo("submit.enqueue.succeeded", {
      requestedAt,
      targetKey,
      userId,
    });
  } catch (error) {
    logGameDayRecapError("submit.enqueue.failed", {
      requestedAt,
      targetKey,
      userId,
      ...toLoggableError(error),
    });
    await dependencies.updateGameDayRecap(args.env, {
      completedAt: dependencies.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }

  logGameDayRecapInfo("submit.completed", {
    requestedAt,
    targetKey,
    userId,
  });
  return { targetKey };
}

export async function processGameDayRecap(
  args: {
    env: GraphqlEnv;
    messageBody: string;
    modelId: string;
    region?: string;
  },
  dependencies: ProcessDependencies = defaultProcessDependencies,
): Promise<void> {
  const message = parseGameDayRecapQueueMessage(args.messageBody);
  logGameDayRecapInfo("process.message.received", {
    requestedAt: message.requestedAt,
    targetKey: message.targetKey,
    userId: message.userId,
  });
  const recap = await dependencies.getGameDayRecap(
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
    await dependencies.updateGameDayRecap(args.env, {
      error: null,
      modelId: args.modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const connection = await requireBbConnection(
      args.env,
      recap.userId,
      dependencies,
    );
    const accessKey = await dependencies.resolveBbAccessKey(args.env, recap.userId);
    const bb = dependencies.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });

    logGameDayRecapInfo("process.bb_connection.ready", {
      bbLoginName: connection.bbLoginName,
      gameDate: recap.gameDate,
      leagueId: recap.leagueId,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    logGameDayRecapInfo("process.fetch_seasons.start", {
      gameDate: recap.gameDate,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    const seasons = await bb.getSeasons();
    const seasonDiagnostics = summarizeSeasonDiagnostics(seasons, recap.gameDate);
    logGameDayRecapInfo("process.fetch_seasons.succeeded", {
      gameDate: recap.gameDate,
      seasonCount: seasons.seasons.length,
      seasons: seasonDiagnostics,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const parsedSeasonsLookUnusable =
      seasonDiagnostics.length === 0 ||
      seasonDiagnostics.every((season) => !season.hasUsableBounds);
    if (parsedSeasonsLookUnusable) {
      await logRawSeasonsXmlDiagnostics({
        bb,
        gameDate: recap.gameDate,
        leagueId: recap.leagueId,
        parsedSeasons: seasons,
        reason: "parsed_seasons_unusable",
        targetKey: recap.targetKey,
        userId: recap.userId,
      });
    }

    let season: number;
    try {
      logGameDayRecapInfo("process.resolve_season.start", {
        gameDate: recap.gameDate,
        targetKey: recap.targetKey,
        userId: recap.userId,
      });
      season = resolveSeasonForDate(seasons, recap.gameDate);
    } catch (error) {
      await logRawSeasonsXmlDiagnostics({
        bb,
        gameDate: recap.gameDate,
        leagueId: recap.leagueId,
        parsedSeasons: seasons,
        reason: "resolve_season_failed",
        targetKey: recap.targetKey,
        userId: recap.userId,
      });
      throw error;
    }

    logGameDayRecapInfo("process.resolve_season.succeeded", {
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    logGameDayRecapInfo("process.fetch_standings.start", {
      leagueId: recap.leagueId,
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    const standings = await bb.getStandings(recap.leagueId, season);
    logGameDayRecapInfo("process.fetch_standings.succeeded", {
      leagueName: standings.league?.name ?? null,
      season: standings.season ?? null,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    logGameDayRecapInfo("process.resolve_slate.start", {
      gameDate: recap.gameDate,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    const slate = await resolveLeagueDaySlate({
      bb,
      gameDate: recap.gameDate,
      standings,
    });
    logGameDayRecapInfo("process.resolve_slate.succeeded", {
      requestedGames: slate.length,
      slate: slate.map((game) => ({
        awayTeamId: game.awayTeamId,
        homeTeamId: game.homeTeamId,
        matchId: game.matchId,
        startTime: game.startTime,
        type: game.type,
      })),
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    logGameDayRecapInfo("process.status_transition", {
      nextStatus: "BUILDING_CONTEXT",
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    await dependencies.updateGameDayRecap(args.env, {
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
      gameDate: recap.gameDate,
      leagueId: recap.leagueId,
      requestedGames: slate,
      season,
      standings,
    });
    coverage = promptPayload.coverage;

    logGameDayRecapInfo("process.prompt_payload.ready", {
      coverage,
      gameCount: promptPayload.games.length,
      leagueName: promptPayload.league.leagueName,
      season: promptPayload.league.season,
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
    await dependencies.updateGameDayRecap(args.env, {
      coverageJson: coverage,
      leagueName: promptPayload.league.leagueName,
      season,
      status: "INVOKING_MODEL",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const provider = dependencies.createProvider({
      modelId: args.modelId,
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

    await dependencies.updateGameDayRecap(args.env, {
      completedAt: dependencies.now().toISOString(),
      coverageJson: coverage,
      error: null,
      leagueName: promptPayload.league.leagueName,
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
    await dependencies.updateGameDayRecap(args.env, {
      completedAt: dependencies.now().toISOString(),
      coverageJson: coverage,
      error: error instanceof Error ? error.message : String(error),
      modelId: args.modelId,
      modelProvider: "bedrock",
      promptVersion: GAME_DAY_RECAP_PROMPT_VERSION,
      status: "FAILED",
      targetKey: recap.targetKey,
      userId: recap.userId,
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

export function buildGameDayRecapTargetKey(
  leagueId: string,
  gameDate: string,
): string {
  return `${leagueId}#${gameDate}`;
}

export function parseGameDayRecapQueueMessage(
  messageBody: string,
): GameDayRecapQueueMessage {
  const payload = requireRecord(JSON.parse(messageBody), "Game day recap queue message");
  const userId = asOptionalString(payload.userId)?.trim();
  const targetKey = asOptionalString(payload.targetKey)?.trim();
  const requestedAt = asOptionalString(payload.requestedAt)?.trim();

  if (!userId || !targetKey || !requestedAt) {
    throw new Error(
      "Game day recap queue message must include userId, targetKey, and requestedAt.",
    );
  }

  return {
    requestedAt,
    targetKey,
    userId,
  };
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
  throw new Error(`No BuzzerBeater season covers ${gameDate}.`);
}

export async function resolveLeagueDaySlate(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  gameDate: string;
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

  const slateByMatchId = new Map<string, SlateGame>();

  for (const schedule of schedules) {
    for (const match of schedule.matches) {
      const matchId = match.id?.trim();
      const matchDate = resolveDateKey(match.startTime);
      if (!matchId || matchDate !== args.gameDate) {
        continue;
      }

      const homeTeamId = match.homeTeam.id?.trim();
      const awayTeamId = match.awayTeam.id?.trim();
      if (
        !homeTeamId ||
        !awayTeamId ||
        !standingTeams.has(homeTeamId) ||
        !standingTeams.has(awayTeamId)
      ) {
        continue;
      }

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

  return Array.from(slateByMatchId.values()).sort((left, right) =>
    compareTimestamps(left.startTime, right.startTime),
  );
}

export function buildGameDayRecapBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapPromptPayload;
}) {
  return {
    inferenceConfig: {
      maxTokens: 5000,
      temperature: 0.45,
      topP: 0.9,
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
                    "Write a concise day-level headline and lede for the slate.",
                    "Write one reporter-style recap for each game in medium length.",
                    "Use only the provided evidence and keep any strategic de-emphasis language cautious.",
                  ],
                },
                slateContext: args.payload,
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
              "Reporter-style game day recap output for one league slate.",
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
          "You are writing basketball game recaps for a league slate.",
          "Use only supplied facts. Do not invent transfers, injuries, off-court news, or play-by-play.",
          "If the evidence suggests one side may have treated the game as lower priority, phrase it cautiously and never call it a punt unless the evidence is explicit.",
          "Headlines should be vivid but factual.",
        ].join(" "),
      },
    ],
  };
}

export function assertSupportedBedrockRecapModel(
  modelId: string,
  region: string | undefined,
): void {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) {
    throw new Error("GAME_DAY_RECAP_MODEL_ID must not be empty.");
  }

  const normalizedRegion = region?.trim();
  if (!normalizedRegion || !SUPPORTED_COMMERCIAL_REGION_PATTERN.test(normalizedRegion)) {
    throw new Error(
      `Game day recap structured output currently requires a supported commercial Bedrock region. Received ${normalizedRegion ?? "unknown"}.`,
    );
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

async function buildGameDayRecapPromptPayload(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore" | "getSchedule" | "getTeamInfo">;
  connection: BbConnectionRecord;
  gameDate: string;
  leagueId: string;
  requestedGames: SlateGame[];
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

    const evidenceSignals = buildEvidenceSignals({
      awayContext,
      boxScore,
      homeContext,
    });
    const standingsContext = buildStandingsContext({
      awayContext,
      homeContext,
    });

    promptGames.push({
      effortDelta: boxScore.effortDelta,
      evidenceSignals,
      finalMargin: Math.abs((boxScore.homeTeam.score ?? 0) - (boxScore.awayTeam.score ?? 0)),
      matchId: requestedGame.matchId,
      neutral: boxScore.neutral,
      quarterScores: {
        away: boxScore.awayTeam.partialScores,
        home: boxScore.homeTeam.partialScores,
      },
      standingsContext,
      teams: {
        away: buildPromptTeam(boxScore.awayTeam, awayContext),
        home: buildPromptTeam(boxScore.homeTeam, homeContext),
      },
      type: boxScore.type ?? requestedGame.type,
    });
  }

  const leagueName =
    args.standings.league?.name ??
    (args.connection.leagueId === args.leagueId ? args.connection.leagueName : null) ??
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
    league: {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      leagueName,
      season: args.season,
    },
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
    const margin = points - opponentPartials[index];
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

type SeasonResolutionDiagnostic = {
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

function summarizeSeasonDiagnostics(
  seasons: BBApiSeasons,
  gameDate: string,
): SeasonResolutionDiagnostic[] {
  const matchTimestamp = parseDateOnlyToTimestamp(gameDate);

  return seasons.seasons.map((season) => {
    const normalizedStart = resolveDateKey(season.start);
    const normalizedFinish = resolveDateKey(season.finish);
    const startTimestamp = parseDateOnlyToTimestamp(normalizedStart);
    const finishTimestamp = parseDateOnlyToTimestamp(normalizedFinish);
    const hasUsableBounds =
      season.id !== null &&
      season.id !== undefined &&
      Number.isFinite(startTimestamp) &&
      Number.isFinite(finishTimestamp);
    const matchesGameDate = hasUsableBounds
      ? startTimestamp <= matchTimestamp && matchTimestamp <= finishTimestamp
      : false;

    return {
      finish: season.finish,
      finishTimestamp: toFiniteNumberOrNull(finishTimestamp),
      hasUsableBounds,
      id: season.id,
      invalidBounds:
        Boolean(normalizedStart || normalizedFinish) &&
        (!Number.isFinite(startTimestamp) || !Number.isFinite(finishTimestamp)),
      matchesGameDate,
      normalizedFinish,
      normalizedStart,
      start: season.start,
      startTimestamp: toFiniteNumberOrNull(startTimestamp),
    };
  });
}

async function logRawSeasonsXmlDiagnostics(args: {
  bb: ProcessDependencies["createBbClient"] extends (...input: never[]) => infer T
    ? T
    : never;
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
    return directMatch[1];
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
  buildGameDayRecapTargetKey,
  buildTeamSeasonContext,
  extractStandingTeams,
  extractTopPlayers,
  formatCurrentStreak,
  formatLastFive,
  listCompletedMatchesBefore,
  normalizeGameDayRecapRequest,
  parseGameDayRecapQueueMessage,
  resolveLeagueDaySlate,
  resolveSeasonForDate,
  summarizeSeasonDiagnostics,
  validateGameDayRecapResult,
};
