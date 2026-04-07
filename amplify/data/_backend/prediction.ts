import { randomUUID } from "node:crypto";

import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

import {
  predictionEndpointResponseSchema,
  type PredictionEndpointResponse,
} from "../../../lib/prediction/contracts";
import {
  buildModelInputFromPredictionInput,
  type PredictionInputShape,
} from "../../../lib/prediction/normalization";
import { requireFeatureAccess } from "./billing";
import {
  deletePredictionGridCellsByUserAndRequestId,
  getPredictionJob,
  type PredictionGridCellRecord,
  type PredictionJobRecord,
  updatePredictionJobIfRequestMatches,
  upsertPredictionGridCells,
  upsertPredictionJob,
} from "./repository";
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

type PredictionForecastContext = {
  enthusiasmBand?: string | null;
  evidence: string[];
  forecastGeneratedAt: string;
  forecastJobId: string;
  forecastModelVersion: string;
  scenarioId: string;
  scenarioLabel: string;
  scenarioProbability: number;
  sourceTeamId: string;
};

type PredictionSubmissionRequest = {
  forecastContext?: PredictionForecastContext;
  input: PredictionInputShape;
};

type SubmitPredictionDependencies = {
  deletePredictionGridCellsByUserAndRequestId:
    typeof deletePredictionGridCellsByUserAndRequestId;
  getPredictionJob: typeof getPredictionJob;
  requireFeatureAccess: typeof requireFeatureAccess;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: { requestId: string; userId: string },
  ) => Promise<string>;
  updatePredictionJobIfRequestMatches: typeof updatePredictionJobIfRequestMatches;
  upsertPredictionJob: typeof upsertPredictionJob;
};

type ProcessPredictionDependencies = {
  deletePredictionGridCellsByUserAndRequestId:
    typeof deletePredictionGridCellsByUserAndRequestId;
  getPredictionJob: typeof getPredictionJob;
  invokePredictionEndpoint: (
    endpointName: string,
    resolvedInput: JsonRecord,
  ) => Promise<PredictionEndpointResponse>;
  updatePredictionJobIfRequestMatches: typeof updatePredictionJobIfRequestMatches;
  upsertPredictionGridCells: typeof upsertPredictionGridCells;
};

const REQUIRED_NUMERIC_FIELDS = [
  "home_outsideScoring",
  "home_insideScoring",
  "home_outsideDefense",
  "home_insideDefense",
  "home_rebounding",
  "home_offensiveFlow",
  "away_outsideScoring",
  "away_insideScoring",
  "away_outsideDefense",
  "away_insideDefense",
  "away_rebounding",
  "away_offensiveFlow",
  "effortDelta",
] as const;

const defaultSubmitDependencies: SubmitPredictionDependencies = {
  deletePredictionGridCellsByUserAndRequestId,
  getPredictionJob,
  requireFeatureAccess,
  startWorkflowExecution: async (stateMachineArn, executionName, message) =>
    startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    }),
  updatePredictionJobIfRequestMatches,
  upsertPredictionJob,
};

const defaultProcessDependencies: ProcessPredictionDependencies = {
  deletePredictionGridCellsByUserAndRequestId,
  getPredictionJob,
  invokePredictionEndpoint,
  updatePredictionJobIfRequestMatches,
  upsertPredictionGridCells,
};

export async function submitPredictionJob(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    request: unknown;
    stateMachineArn: string;
  },
  dependencies: Partial<SubmitPredictionDependencies> = {},
): Promise<{ executionArn: string; jobId: string }> {
  const runtimeDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  await runtimeDependencies.requireFeatureAccess({
    env: args.env,
    featureKey: "predictions",
    userId,
  });

  const normalizedRequest = normalizePredictionRequest(args.request);
  const previousJob = await runtimeDependencies.getPredictionJob(args.env, userId);
  const requestId = randomUUID();
  const requestedAt = new Date().toISOString();

  if (previousJob?.requestId) {
    await quietlyDeletePredictionGridCells(
      runtimeDependencies,
      args.env,
      userId,
      previousJob.requestId,
    );
  }

  await runtimeDependencies.upsertPredictionJob(args.env, {
    ...normalizedRequest.input,
    ...toForecastMetadata(normalizedRequest.forecastContext),
    userId,
    requestId,
    status: "QUEUED",
    requestedAt,
    awayScore: null,
    error: null,
    executionArn: null,
    homeScore: null,
    modelVersion: null,
    pointDiff: null,
  });

  try {
    const executionArn = await runtimeDependencies.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName("prediction", requestId),
      { requestId, userId },
    );
    await runtimeDependencies.updatePredictionJobIfRequestMatches(args.env, {
      userId,
      requestId,
      executionArn,
    });
    return { executionArn, jobId: requestId };
  } catch (error) {
    await runtimeDependencies.updatePredictionJobIfRequestMatches(args.env, {
      userId,
      requestId,
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function processPredictionJob(
  args: {
    env: GraphqlEnv;
    endpointName: string;
    message?: { requestId: string; userId: string };
    messageBody?: string;
  },
  dependencies: Partial<ProcessPredictionDependencies> = {},
): Promise<void> {
  const runtimeDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolvePredictionJobMessage(args);
  const job = await runtimeDependencies.getPredictionJob(args.env, message.userId);
  if (!job || job.requestId !== message.requestId) {
    return;
  }

  try {
    const canResolve = await runtimeDependencies.updatePredictionJobIfRequestMatches(
      args.env,
      {
        userId: job.userId,
        requestId: job.requestId,
        status: "RESOLVING_INPUT",
        error: null,
      },
    );
    if (!canResolve) {
      return;
    }

    const resolvedInput = buildModelInputFromPredictionInput(
      extractPredictionInput(job),
    );

    const canInvoke = await runtimeDependencies.updatePredictionJobIfRequestMatches(
      args.env,
      {
        userId: job.userId,
        requestId: job.requestId,
        status: "INVOKING_MODEL",
        error: null,
      },
    );
    if (!canInvoke) {
      return;
    }

    const rawResult = await runtimeDependencies.invokePredictionEndpoint(
      args.endpointName,
      resolvedInput,
    );
    const parsedResult = predictionEndpointResponseSchema.safeParse(rawResult);
    if (!parsedResult.success) {
      const issue = parsedResult.error.issues[0];
      throw new Error(
        issue
          ? `SageMaker prediction response was invalid at ${issue.path.join(".") || "root"}: ${issue.message}`
          : "SageMaker prediction response was invalid.",
      );
    }
    const result = parsedResult.data;
    const gridCells = buildPredictionGridCellRecords({
      grid: result.tacticsGrid,
      requestId: job.requestId,
      userId: job.userId,
    });
    if (countRenderablePersistedGridCells(gridCells) < 1) {
      throw new Error(
        "SageMaker response did not contain any renderable tactics-grid cells.",
      );
    }

    const latestJob = await runtimeDependencies.getPredictionJob(args.env, job.userId);
    if (!latestJob || latestJob.requestId !== job.requestId) {
      return;
    }

    await quietlyDeletePredictionGridCells(
      runtimeDependencies,
      args.env,
      job.userId,
      job.requestId,
    );
    await runtimeDependencies.upsertPredictionGridCells(args.env, gridCells);

    const didPersistSuccess =
      await runtimeDependencies.updatePredictionJobIfRequestMatches(args.env, {
        userId: job.userId,
        requestId: job.requestId,
        status: "SUCCEEDED",
        awayScore: result.awayScore ?? null,
        error: null,
        homeScore: result.homeScore ?? null,
        modelVersion: result.modelVersion ?? null,
        pointDiff: result.pointDiff ?? null,
      });
    if (!didPersistSuccess) {
      await quietlyDeletePredictionGridCells(
        runtimeDependencies,
        args.env,
        job.userId,
        job.requestId,
      );
    }
  } catch (error) {
    await quietlyDeletePredictionGridCells(
      runtimeDependencies,
      args.env,
      job.userId,
      job.requestId,
    );
    await runtimeDependencies.updatePredictionJobIfRequestMatches(args.env, {
      userId: job.userId,
      requestId: job.requestId,
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function normalizePredictionRequest(
  input: unknown,
): PredictionSubmissionRequest {
  const record = requireRecord(input, "Prediction request");
  const normalizedInput = normalizePredictionInput(record.input);
  const forecastContext = normalizePredictionForecastContext(
    record.forecastContext,
  );

  return forecastContext
    ? {
        input: normalizedInput,
        forecastContext,
      }
    : {
        input: normalizedInput,
      };
}

async function invokePredictionEndpoint(
  endpointName: string,
  resolvedInput: JsonRecord,
): Promise<PredictionEndpointResponse> {
  const runtime = new SageMakerRuntimeClient({});
  const response = await runtime.send(
    new InvokeEndpointCommand({
      EndpointName: endpointName,
      ContentType: "application/json",
      Body: Buffer.from(JSON.stringify(resolvedInput)),
    }),
  );

  const rawBody = response.Body?.transformToString
    ? await Promise.resolve(response.Body.transformToString())
    : Buffer.from(response.Body ?? []).toString("utf-8");
  const parsed = rawBody ? JSON.parse(rawBody) : null;
  const result = predictionEndpointResponseSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      issue
        ? `SageMaker prediction response was invalid at ${issue.path.join(".") || "root"}: ${issue.message}`
        : "SageMaker prediction response was invalid.",
    );
  }

  return result.data;
}

function buildPredictionGridCellRecords(args: {
  grid: PredictionEndpointResponse["tacticsGrid"];
  requestId: string;
  userId: string;
}): PredictionGridCellRecord[] {
  const records: PredictionGridCellRecord[] = [];

  for (let rowIndex = 0; rowIndex < args.grid.defenses.length; rowIndex += 1) {
    const awayDefense = args.grid.defenses[rowIndex];
    const row = args.grid.cells[rowIndex] ?? [];

    for (
      let columnIndex = 0;
      columnIndex < args.grid.offenses.length;
      columnIndex += 1
    ) {
      const homeOffense = args.grid.offenses[columnIndex];
      const cell = row[columnIndex];
      if (!cell) {
        continue;
      }
      if (
        cell.awayDefense !== awayDefense ||
        cell.homeOffense !== homeOffense
      ) {
        continue;
      }

      records.push({
        userId: args.userId,
        requestId: args.requestId,
        awayDefense: cell.awayDefense,
        homeOffense: cell.homeOffense,
        awayScore: cell.awayScore,
        homeScore: cell.homeScore,
        pointDiff: cell.pointDiff,
      });
    }
  }

  return records;
}

function countRenderablePersistedGridCells(
  cells: readonly PredictionGridCellRecord[],
): number {
  return cells.filter((cell) => {
    return (
      typeof cell.homeScore === "number" &&
      Number.isFinite(cell.homeScore) &&
      typeof cell.awayScore === "number" &&
      Number.isFinite(cell.awayScore) &&
      typeof cell.pointDiff === "number" &&
      Number.isFinite(cell.pointDiff)
    );
  }).length;
}

function extractPredictionInput(job: PredictionJobRecord): PredictionInputShape {
  return {
    home_outsideScoring: job.home_outsideScoring,
    home_insideScoring: job.home_insideScoring,
    home_outsideDefense: job.home_outsideDefense,
    home_insideDefense: job.home_insideDefense,
    home_rebounding: job.home_rebounding,
    home_offensiveFlow: job.home_offensiveFlow,
    away_outsideScoring: job.away_outsideScoring,
    away_insideScoring: job.away_insideScoring,
    away_outsideDefense: job.away_outsideDefense,
    away_insideDefense: job.away_insideDefense,
    away_rebounding: job.away_rebounding,
    away_offensiveFlow: job.away_offensiveFlow,
    home_gdp_focus: job.home_gdp_focus,
    home_gdp_pace: job.home_gdp_pace,
    away_gdp_focus: job.away_gdp_focus,
    away_gdp_pace: job.away_gdp_pace,
    neutral: job.neutral,
    effortDelta: job.effortDelta,
  };
}

function toForecastMetadata(
  forecastContext: PredictionForecastContext | undefined,
): Pick<
  PredictionJobRecord,
  | "forecastEnthusiasmBand"
  | "forecastGeneratedAt"
  | "forecastJobId"
  | "forecastModelVersion"
  | "forecastScenarioId"
  | "forecastScenarioLabel"
  | "forecastScenarioProbability"
  | "forecastSourceTeamId"
> {
  return {
    forecastEnthusiasmBand: forecastContext?.enthusiasmBand ?? null,
    forecastGeneratedAt: forecastContext?.forecastGeneratedAt ?? null,
    forecastJobId: forecastContext?.forecastJobId ?? null,
    forecastModelVersion: forecastContext?.forecastModelVersion ?? null,
    forecastScenarioId: forecastContext?.scenarioId ?? null,
    forecastScenarioLabel: forecastContext?.scenarioLabel ?? null,
    forecastScenarioProbability:
      forecastContext?.scenarioProbability ?? null,
    forecastSourceTeamId: forecastContext?.sourceTeamId ?? null,
  };
}

function normalizePredictionInput(value: unknown): PredictionInputShape {
  const input = requireRecord(value, "Prediction request input");
  const normalizedNumericValues = {} as Pick<
    PredictionInputShape,
    (typeof REQUIRED_NUMERIC_FIELDS)[number]
  >;

  for (const field of REQUIRED_NUMERIC_FIELDS) {
    normalizedNumericValues[field] = requireNumber(input[field], field);
  }

  return {
    ...normalizedNumericValues,
    home_gdp_focus: "N/A",
    home_gdp_pace: "N/A",
    away_gdp_focus: "N/A",
    away_gdp_pace: "N/A",
    neutral: requireString(input.neutral, "neutral"),
  };
}

function normalizePredictionForecastContext(
  value: unknown,
): PredictionForecastContext | undefined {
  const record = asOptionalRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    enthusiasmBand: asOptionalString(record.enthusiasmBand),
    evidence: Array.isArray(record.evidence)
      ? record.evidence.filter(
          (entry): entry is string =>
            typeof entry === "string" && Boolean(entry.trim()),
        )
      : [],
    forecastGeneratedAt: requireString(
      record.forecastGeneratedAt,
      "forecastContext.forecastGeneratedAt",
    ),
    forecastJobId: requireString(
      record.forecastJobId,
      "forecastContext.forecastJobId",
    ),
    forecastModelVersion: requireString(
      record.forecastModelVersion,
      "forecastContext.forecastModelVersion",
    ),
    scenarioId: requireString(record.scenarioId, "forecastContext.scenarioId"),
    scenarioLabel: requireString(
      record.scenarioLabel,
      "forecastContext.scenarioLabel",
    ),
    scenarioProbability: requireNumber(
      record.scenarioProbability,
      "forecastContext.scenarioProbability",
    ),
    sourceTeamId: requireString(
      record.sourceTeamId,
      "forecastContext.sourceTeamId",
    ),
  };
}

function parseQueueMessage(body: string): { requestId: string; userId: string } {
  const parsed = requireRecord(JSON.parse(body), "SQS prediction job message");
  const requestId = asOptionalString(parsed.requestId);
  const userId = asOptionalString(parsed.userId);
  if (!requestId || !userId) {
    throw new Error(
      "Prediction queue message must include requestId and userId.",
    );
  }
  return { requestId, userId };
}

function resolvePredictionJobMessage(args: {
  message?: { requestId: string; userId: string };
  messageBody?: string;
}): { requestId: string; userId: string } {
  if (args.message) {
    return args.message;
  }
  if (!args.messageBody) {
    throw new Error("Prediction job payload was not provided.");
  }
  return parseQueueMessage(args.messageBody);
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`${label} must be numeric.`);
}

function requireString(value: unknown, label: string): string {
  const normalized = asOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return normalized;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

async function quietlyDeletePredictionGridCells(
  dependencies:
    | SubmitPredictionDependencies
    | ProcessPredictionDependencies,
  env: GraphqlEnv,
  userId: string,
  requestId: string,
): Promise<void> {
  try {
    await dependencies.deletePredictionGridCellsByUserAndRequestId(
      env,
      userId,
      requestId,
    );
  } catch {
    // Old or stale rows are non-authoritative. Best-effort cleanup is enough.
  }
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
