import { randomUUID } from "node:crypto";

import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

import type { Schema } from "../resource";
import { requireFeatureAccess } from "./billing";
import { selectBoxscorePerspective } from "./neutral-boxscore";
import {
  createOpponentForecastJob,
  getMatchBoxscore,
  getOpponentForecastJob,
  listOpponentForecastJobsByUser,
  updateOpponentForecastJob,
} from "./repository";
import {
  getOrRefreshWorkspace,
  getScoutWorkspaceForTeam,
  type WorkspaceBundle,
} from "./workspace";
import {
  buildExecutionName,
  startStateMachineExecution,
} from "./step-functions";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type OpponentForecastSnapshot = ResolverResult<"getLatestOpponentForecast">;
type OpponentForecastResult = NonNullable<OpponentForecastSnapshot["result"]>;
type OpponentForecastScenario = OpponentForecastResult["topScenarios"][number];
type OpponentForecastPlayerProjection = OpponentForecastScenario["starters"][number];
type OpponentForecastAnalogGame = OpponentForecastResult["analogGames"][number];
type OpponentForecastSignal = OpponentForecastResult["featureSignals"][number];

type SubmitOpponentForecastDependencies = {
  createOpponentForecastJob: typeof createOpponentForecastJob;
  requireFeatureAccess: typeof requireFeatureAccess;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: { jobId: string; userId: string },
  ) => Promise<string>;
  updateOpponentForecastJob: typeof updateOpponentForecastJob;
};

const defaultSubmitDependencies: SubmitOpponentForecastDependencies = {
  createOpponentForecastJob,
  requireFeatureAccess,
  startWorkflowExecution: async (stateMachineArn, executionName, message) => {
    return startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    });
  },
  updateOpponentForecastJob,
};

export async function submitOpponentForecastJob(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    stateMachineArn: string;
    teamId: string;
  },
  dependencies: SubmitOpponentForecastDependencies = defaultSubmitDependencies,
): Promise<{ executionArn: string; jobId: string }> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const teamId = normalizeRequiredString(args.teamId, "A scout team id");

  await dependencies.requireFeatureAccess({
    env: args.env,
    featureKey: "predictions",
    userId,
  });

  const jobId = randomUUID();
  await dependencies.createOpponentForecastJob(args.env, {
    id: jobId,
    userId,
    teamId,
    teamName: null,
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: { teamId },
    resolvedContextJson: null,
    resultJson: null,
    error: null,
    executionArn: null,
    modelVersion: null,
  });

  try {
    const executionArn = await dependencies.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName("opponent-forecast", jobId),
      { jobId, userId },
    );
    await dependencies.updateOpponentForecastJob(args.env, {
      id: jobId,
      executionArn,
    });
    return { executionArn, jobId };
  } catch (error) {
    await dependencies.updateOpponentForecastJob(args.env, {
      id: jobId,
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function getLatestOpponentForecast(args: {
  env: GraphqlEnv;
  identity: unknown;
  teamId: string;
}): Promise<OpponentForecastSnapshot | null> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const teamId = normalizeRequiredString(args.teamId, "A scout team id");
  const jobs = await listOpponentForecastJobsByUser(args.env, userId, {
    limit: 20,
  });
  const match = jobs.records.find((job) => job.teamId === teamId);
  return match ? adaptForecastJob(match) : null;
}

export async function processOpponentForecastJob(args: {
  env: GraphqlEnv;
  endpointName: string;
  message?: { jobId: string; userId: string };
  messageBody?: string;
}): Promise<void> {
  const message = resolveOpponentForecastJobMessage(args);
  const job = await getOpponentForecastJob(args.env, message.jobId);
  if (!job || job.userId !== message.userId) {
    throw new Error(
      "Opponent forecast job is missing or no longer belongs to the enqueued user.",
    );
  }

  const identity = { sub: message.userId };
  const startedAt = new Date().toISOString();

  try {
    await updateOpponentForecastJob(args.env, {
      id: job.id,
      status: "RESOLVING_CONTEXT",
      startedAt,
      completedAt: null,
      error: null,
    });

    const workspace = await getOrRefreshWorkspace({
      env: args.env,
      identity,
    });
    const { scout } = await getScoutWorkspaceForTeam({
      env: args.env,
      identity,
      teamId: job.teamId,
    });
    if (!scout.summary) {
      throw new Error("Scout workspace did not contain a selected team summary.");
    }

    const resolvedContext = await buildOpponentForecastContext({
      env: args.env,
      scout,
      userId: message.userId,
      workspace,
    });

    await updateOpponentForecastJob(args.env, {
      id: job.id,
      status: "INVOKING_MODEL",
      teamName: scout.summary.teamName ?? null,
      resolvedContextJson: resolvedContext,
      error: null,
    });

    const result = normalizeOpponentForecastResult(
      await invokeOpponentForecastEndpoint(args.endpointName, resolvedContext),
    );
    const completedAt = new Date().toISOString();

    await updateOpponentForecastJob(args.env, {
      id: job.id,
      status: "SUCCEEDED",
      teamName: scout.summary.teamName ?? null,
      completedAt,
      resolvedContextJson: resolvedContext,
      resultJson: result,
      modelVersion: result.modelVersion,
      error: null,
    });
  } catch (error) {
    await updateOpponentForecastJob(args.env, {
      id: job.id,
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function buildOpponentForecastContext(args: {
  env: GraphqlEnv;
  scout: ResolverResult<"getScoutWorkspace">;
  userId: string;
  workspace: WorkspaceBundle;
}): Promise<JsonRecord> {
  const summary = args.scout.summary;
  if (!summary) {
    throw new Error("Scout workspace is missing the selected team summary.");
  }

  const recentGameBoxscores = await loadStoredBoxscores(
    args.env,
    args.userId,
    summary.recentGames
      .map((match) => match.matchId)
      .filter((matchId): matchId is string => Boolean(matchId))
      .slice(0, 8),
    args.scout.teamId ?? null,
  );
  const headToHeadBoxscores = await loadStoredBoxscores(
    args.env,
    args.userId,
    args.scout.recentMatchups
      .map((match) => match.matchId)
      .filter((matchId): matchId is string => Boolean(matchId))
      .slice(0, 5),
    args.scout.teamId ?? null,
  );

  return {
    generatedAt: new Date().toISOString(),
    ourTeam: {
      nextMatch: args.workspace.home.nextMatch,
      recentMatches: args.workspace.home.recentMatches.slice(0, 8),
      record: args.workspace.home.team.record,
      roster: args.workspace.teamHub.roster,
      team: args.workspace.home.team,
      topPlayers: args.workspace.home.team.topPlayers,
    },
    targetTeam: {
      matchupPerspective: summary.matchupPerspective,
      nextMatch: summary.nextMatch,
      publicRoster: summary.roster,
      recentGames: summary.recentGames,
      recentGameBoxscores,
      record: summary.record,
      teamId: args.scout.teamId,
      teamName: summary.teamName,
      tendencies: summary.tendencies,
      topPlayers: summary.topPlayers,
    },
    headToHead: {
      recentMatchups: args.scout.recentMatchups,
      boxscores: headToHeadBoxscores,
    },
    leagueContext: args.workspace.leagueIntel,
  };
}

async function loadStoredBoxscores(
  env: GraphqlEnv,
  userId: string,
  matchIds: string[],
  teamId: string | null,
): Promise<JsonRecord[]> {
  const results = await Promise.all(
    Array.from(new Set(matchIds)).map(async (matchId) => {
      const record = await getMatchBoxscore(env, userId, matchId);
      return record ? adaptStoredBoxscoreForForecast(record, teamId) : null;
    }),
  );

  return results.filter((entry): entry is JsonRecord => Boolean(entry));
}

async function invokeOpponentForecastEndpoint(
  endpointName: string,
  payload: JsonRecord,
): Promise<JsonRecord> {
  const runtime = new SageMakerRuntimeClient({});
  const response = await runtime.send(
    new InvokeEndpointCommand({
      EndpointName: endpointName,
      ContentType: "application/json",
      Body: Buffer.from(JSON.stringify(payload)),
    }),
  );

  const rawBody = response.Body?.transformToString
    ? await Promise.resolve(response.Body.transformToString())
    : Buffer.from(response.Body ?? []).toString("utf-8");
  return requireRecord(
    rawBody ? JSON.parse(rawBody) : null,
    "SageMaker opponent forecast response",
  );
}

function adaptForecastJob(job: {
  id: string;
  teamId: string;
  teamName?: string | null;
  executionArn?: string | null;
  status: string;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  modelVersion?: string | null;
  resultJson?: unknown;
}): OpponentForecastSnapshot {
  return {
    jobId: job.id,
    teamId: job.teamId,
    teamName: asOptionalString(job.teamName),
    executionArn: asOptionalString(job.executionArn),
    status: normalizeForecastStatus(job.status),
    requestedAt: job.requestedAt,
    startedAt: asOptionalString(job.startedAt),
    completedAt: asOptionalString(job.completedAt),
    error: asOptionalString(job.error),
    modelVersion: asOptionalString(job.modelVersion),
    result: job.resultJson
      ? normalizeOpponentForecastResult(requireRecord(job.resultJson, "forecast result"))
      : null,
  };
}

export function normalizeOpponentForecastResult(
  input: JsonRecord,
): OpponentForecastResult {
  const coverageInput = requireRecord(input.coverage ?? {}, "forecast coverage");
  const topScenariosInput = toRecordArray(input.topScenarios);
  const analogGamesInput = toRecordArray(input.analogGames);
  const featureSignalsInput = toRecordArray(input.featureSignals);

  return {
    modelVersion: asOptionalString(input.modelVersion) ?? "unknown",
    generatedAt:
      asOptionalString(input.generatedAt) ?? new Date().toISOString(),
    confidence: asFiniteNumber(input.confidence) ?? 0,
    coverage: {
      recentGamesConsidered:
        asFiniteInteger(coverageInput.recentGamesConsidered) ??
        topScenariosInput.length,
      headToHeadGamesConsidered:
        asFiniteInteger(coverageInput.headToHeadGamesConsidered) ??
        analogGamesInput.length,
      analogGamesConsidered:
        asFiniteInteger(coverageInput.analogGamesConsidered) ??
        analogGamesInput.length,
      rosterPlayersConsidered:
        asFiniteInteger(coverageInput.rosterPlayersConsidered) ?? 0,
    },
    topScenarios: topScenariosInput.map(normalizeForecastScenario),
    analogGames: analogGamesInput.map(normalizeAnalogGame),
    featureSignals: featureSignalsInput.map(normalizeFeatureSignal),
  };
}

function normalizeForecastScenario(input: JsonRecord, index: number): OpponentForecastScenario {
  return {
    scenarioId: asOptionalString(input.scenarioId) ?? `scenario-${index + 1}`,
    label: asOptionalString(input.label) ?? `Scenario ${index + 1}`,
    probability: asFiniteNumber(input.probability) ?? 0,
    offense: asOptionalString(input.offense) ?? "Unknown",
    defense: asOptionalString(input.defense) ?? "Unknown",
    gdpFocus: asOptionalString(input.gdpFocus),
    gdpPace: asOptionalString(input.gdpPace),
    enthusiasmBand: asOptionalString(input.enthusiasmBand),
    effortChoice: asOptionalString(input.effortChoice) ?? "Normal",
    starters: toRecordArray(input.starters).map(normalizePlayerProjection),
    rotation: toRecordArray(input.rotation).map(normalizePlayerProjection),
    evidence: toStringArray(input.evidence),
  };
}

function normalizePlayerProjection(
  input: JsonRecord,
): OpponentForecastPlayerProjection {
  return {
    playerId: asOptionalString(input.playerId),
    fullName: asOptionalString(input.fullName) ?? "Unknown player",
    bestPosition: asOptionalString(input.bestPosition),
    starterProbability: asFiniteNumber(input.starterProbability),
    expectedMinutes: asFiniteInteger(input.expectedMinutes),
    minuteBandLow: asFiniteInteger(input.minuteBandLow),
    minuteBandHigh: asFiniteInteger(input.minuteBandHigh),
    injuryWeeks: asFiniteInteger(input.injuryWeeks),
    gameShape: asOptionalString(input.gameShape),
  };
}

function normalizeAnalogGame(
  input: JsonRecord,
  index: number,
): OpponentForecastAnalogGame {
  return {
    matchId: asOptionalString(input.matchId) ?? `analog-${index + 1}`,
    startTime: asOptionalString(input.startTime),
    season: asFiniteInteger(input.season),
    similarity: asFiniteNumber(input.similarity) ?? 0,
    opponentTeamName: asOptionalString(input.opponentTeamName),
    offense: asOptionalString(input.offense),
    defense: asOptionalString(input.defense),
    gdpFocus: asOptionalString(input.gdpFocus),
    gdpPace: asOptionalString(input.gdpPace),
    effortDelta: asFiniteInteger(input.effortDelta),
    teamScore: asFiniteInteger(input.teamScore),
    opponentScore: asFiniteInteger(input.opponentScore),
  };
}

function normalizeFeatureSignal(
  input: JsonRecord,
  index: number,
): OpponentForecastSignal {
  return {
    key: asOptionalString(input.key) ?? `signal-${index + 1}`,
    label: asOptionalString(input.label) ?? `Signal ${index + 1}`,
    value: asOptionalString(input.value) ?? "N/A",
    strength: asFiniteNumber(input.strength),
  };
}

function adaptStoredBoxscoreForForecast(
  matchBoxscore: Record<string, unknown>,
  teamId: string | null,
): JsonRecord | null {
  const boxscore = requireRecord(matchBoxscore.boxscoreJson, "stored boxscore payload");
  const perspective = selectBoxscorePerspective(boxscore, teamId);
  const teamSide = perspective.team;
  const opponentSide = perspective.opponent;

  if (!teamSide || !opponentSide) {
    return null;
  }

  return {
    effortDelta: asFiniteInteger(boxscore.effortDelta),
    matchId: asOptionalString(matchBoxscore.matchId),
    neutral: asOptionalBoolean(boxscore.neutral),
    opponent: {
      defStrategy: asOptionalString(opponentSide.defStrategy),
      efficiency: asOptionalRecord(opponentSide.efficiency) ?? {},
      gdp: asOptionalRecord(opponentSide.gdp) ?? {},
      offStrategy: asOptionalString(opponentSide.offStrategy),
      players: toPlayerSummaries(opponentSide.players),
      ratings: asOptionalRecord(opponentSide.ratings) ?? {},
      score: asFiniteInteger(opponentSide.score),
      teamId: asOptionalString(opponentSide.id),
      teamName: asOptionalString(opponentSide.teamName),
    },
    startTime: asOptionalString(boxscore.startTime),
    team: {
      defStrategy: asOptionalString(teamSide.defStrategy),
      efficiency: asOptionalRecord(teamSide.efficiency) ?? {},
      gdp: asOptionalRecord(teamSide.gdp) ?? {},
      offStrategy: asOptionalString(teamSide.offStrategy),
      players: toPlayerSummaries(teamSide.players),
      ratings: asOptionalRecord(teamSide.ratings) ?? {},
      score: asFiniteInteger(teamSide.score),
      teamId: asOptionalString(teamSide.id),
      teamName: asOptionalString(teamSide.teamName),
    },
    type: asOptionalString(boxscore.type),
  };
}

function toPlayerSummaries(value: unknown): JsonRecord[] {
  return toRecordArray(value).map((player) => ({
    fullName: asOptionalString(player.fullName) ?? "Unknown player",
    minutesByPosition: asOptionalRecord(player.minutesByPosition) ?? {},
    performance: asOptionalRecord(player.performance) ?? {},
    playerId: asOptionalString(player.id),
    totalMinutes: totalMinutesFromPositions(player.minutesByPosition),
  }));
}

function totalMinutesFromPositions(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  return Object.values(value).reduce<number>((sum, entry) => {
    const minutes = asFiniteNumber(entry);
    return sum + (minutes ?? 0);
  }, 0);
}

function parseQueueMessage(body: string): { jobId: string; userId: string } {
  const parsed = requireRecord(JSON.parse(body), "SQS opponent forecast job message");
  const jobId = asOptionalString(parsed.jobId);
  const userId = asOptionalString(parsed.userId);
  if (!jobId || !userId) {
    throw new Error(
      "Opponent forecast queue message must include jobId and userId.",
    );
  }
  return { jobId, userId };
}

function resolveOpponentForecastJobMessage(args: {
  message?: { jobId: string; userId: string };
  messageBody?: string;
}): { jobId: string; userId: string } {
  if (args.message) {
    return args.message;
  }
  if (!args.messageBody) {
    throw new Error("Opponent forecast job payload was not provided.");
  }
  return parseQueueMessage(args.messageBody);
}

function normalizeForecastStatus(
  value: string,
): OpponentForecastSnapshot["status"] {
  switch (value) {
    case "QUEUED":
    case "RESOLVING_CONTEXT":
    case "INVOKING_MODEL":
    case "SUCCEEDED":
    case "FAILED":
      return value;
    default:
      return "FAILED";
  }
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = asOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function toRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is JsonRecord =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asOptionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function asOptionalRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function asFiniteInteger(value: unknown): number | null {
  const parsed = asFiniteNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }

  return null;
}

function resolveUserId(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const typedIdentity = identity as Identity;
  if (typeof typedIdentity.sub === "string" && typedIdentity.sub) {
    return typedIdentity.sub;
  }

  const claimsSub = typedIdentity.claims?.sub;
  return typeof claimsSub === "string" && claimsSub ? claimsSub : null;
}
