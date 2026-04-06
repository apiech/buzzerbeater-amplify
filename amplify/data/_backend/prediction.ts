import { randomUUID } from "node:crypto";

import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

import {
  createPredictionJob,
  getMatchBoxscore,
  getPredictionJob,
  updatePredictionJob,
} from "./repository";
import { requireFeatureAccess } from "./billing";
import { selectBoxscorePerspective } from "./neutral-boxscore";
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

type ManualPredictionRequest = {
  mode: "MANUAL";
  manualInput: JsonRecord;
};

type ConnectedPredictionInput = {
  homeSourceMatchId?: string;
  awaySourceMatchId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  home_offStrategy?: string;
  home_defStrategy?: string;
  away_offStrategy?: string;
  away_defStrategy?: string;
  home_gdp_focus?: string;
  home_gdp_pace?: string;
  away_gdp_focus?: string;
  away_gdp_pace?: string;
  neutral?: string | number | boolean;
  effortDelta?: number;
  forecastContext?: JsonRecord;
  manualFallback?: JsonRecord;
};

type ConnectedPredictionRequest = {
  mode: "CONNECTED";
  connectedInput: ConnectedPredictionInput;
};

type PredictionSubmissionRequest =
  | ManualPredictionRequest
  | ConnectedPredictionRequest;

type ResolveConnectedInputDependencies = {
  getMatchBoxscore: typeof getMatchBoxscore;
};

type SubmitPredictionDependencies = {
  createPredictionJob: typeof createPredictionJob;
  requireFeatureAccess: typeof requireFeatureAccess;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: { jobId: string; userId: string },
  ) => Promise<string>;
  updatePredictionJob: typeof updatePredictionJob;
};

type ProcessPredictionDependencies = {
  getPredictionJob: typeof getPredictionJob;
  invokePredictionEndpoint: (
    endpointName: string,
    resolvedInput: JsonRecord,
  ) => Promise<JsonRecord>;
  resolveConnectedInput: typeof resolveConnectedInput;
  updatePredictionJob: typeof updatePredictionJob;
};

const RATING_FIELDS = [
  "outsideScoring",
  "insideScoring",
  "outsideDefense",
  "insideDefense",
  "rebounding",
  "offensiveFlow",
] as const;

const DIRECT_CONNECTED_FIELDS = [
  "home_offStrategy",
  "home_defStrategy",
  "away_offStrategy",
  "away_defStrategy",
  "home_gdp_focus",
  "home_gdp_pace",
  "away_gdp_focus",
  "away_gdp_pace",
  "neutral",
  "effortDelta",
] as const;

const defaultSubmitDependencies: SubmitPredictionDependencies = {
  createPredictionJob,
  requireFeatureAccess,
  startWorkflowExecution: async (stateMachineArn, executionName, message) => {
    return startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    });
  },
  updatePredictionJob,
};

export async function submitPredictionJob(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    request: unknown;
    stateMachineArn: string;
  },
  dependencies: SubmitPredictionDependencies = defaultSubmitDependencies,
): Promise<{ executionArn: string; jobId: string }> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  await dependencies.requireFeatureAccess({
    env: args.env,
    featureKey: "predictions",
    userId,
  });

  const normalizedRequest = normalizePredictionRequest(args.request);
  const jobId = randomUUID();

  await dependencies.createPredictionJob(args.env, {
    id: jobId,
    userId,
    status: "QUEUED",
    mode: normalizedRequest.mode,
    request: normalizedRequest,
    resolvedInputSnapshot: null,
    result: null,
    error: null,
    executionArn: null,
    modelVersion: null,
  });

  try {
    const executionArn = await dependencies.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName("prediction", jobId),
      { jobId, userId },
    );
    await dependencies.updatePredictionJob(args.env, {
      id: jobId,
      executionArn,
    });
    return { executionArn, jobId };
  } catch (error) {
    await dependencies.updatePredictionJob(args.env, {
      id: jobId,
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
    message?: { jobId: string; userId: string };
    messageBody?: string;
  },
  dependencies: ProcessPredictionDependencies = {
    getPredictionJob,
    invokePredictionEndpoint,
    resolveConnectedInput,
    updatePredictionJob,
  },
): Promise<void> {
  const message = resolvePredictionJobMessage(args);
  const job = await dependencies.getPredictionJob(args.env, message.jobId);
  if (!job || job.userId !== message.userId) {
    throw new Error(
      "Prediction job is missing or no longer belongs to the enqueued user.",
    );
  }

  try {
    await dependencies.updatePredictionJob(args.env, {
      id: job.id,
      status: "RESOLVING_INPUT",
      error: null,
    });

    const request = normalizePredictionRequest(job.request);
    const resolvedInput =
      request.mode === "MANUAL"
        ? request.manualInput
        : await dependencies.resolveConnectedInput(
            args.env,
            message.userId,
            request.connectedInput,
          );

    await dependencies.updatePredictionJob(args.env, {
      id: job.id,
      status: "INVOKING_MODEL",
      resolvedInputSnapshot: resolvedInput,
      error: null,
    });

    const result = await dependencies.invokePredictionEndpoint(
      args.endpointName,
      resolvedInput,
    );
    await dependencies.updatePredictionJob(args.env, {
      id: job.id,
      status: "SUCCEEDED",
      resolvedInputSnapshot: resolvedInput,
      result,
      modelVersion: asOptionalString(result.modelVersion),
      error: null,
    });
  } catch (error) {
    await dependencies.updatePredictionJob(args.env, {
      id: job.id,
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
  const mode = asOptionalString(record.mode)?.toUpperCase();

  if (mode === "MANUAL") {
    return {
      mode,
      manualInput: requireRecord(record.manualInput, "manualInput"),
    };
  }

  if (mode === "CONNECTED") {
    return {
      mode,
      connectedInput: requireRecord(
        record.connectedInput,
        "connectedInput",
      ) as ConnectedPredictionInput,
    };
  }

  throw new Error(
    "Prediction request mode must be either MANUAL or CONNECTED.",
  );
}

export async function resolveConnectedInput(
  env: GraphqlEnv,
  userId: string,
  connectedInput: ConnectedPredictionInput,
  dependencies: ResolveConnectedInputDependencies = { getMatchBoxscore },
): Promise<JsonRecord> {
  const resolved: JsonRecord = {
    ...(connectedInput.manualFallback ?? {}),
  };
  const canFallback = Boolean(connectedInput.manualFallback);

  if (connectedInput.homeSourceMatchId && !connectedInput.homeTeamId?.trim()) {
    throw new Error(
      "homeTeamId is required when homeSourceMatchId is provided.",
    );
  }

  if (connectedInput.awaySourceMatchId && !connectedInput.awayTeamId?.trim()) {
    throw new Error(
      "awayTeamId is required when awaySourceMatchId is provided.",
    );
  }

  if (connectedInput.homeSourceMatchId) {
    const homeBoxscore = await dependencies.getMatchBoxscore(
      env,
      userId,
      connectedInput.homeSourceMatchId,
    );
    if (!homeBoxscore && !canFallback) {
      throw new Error(
        "The selected home source match is unavailable in cache.",
      );
    }
    if (homeBoxscore) {
      Object.assign(
        resolved,
        buildSideFromBoxscore(homeBoxscore, connectedInput.homeTeamId, "home"),
      );
    }
  }

  if (connectedInput.awaySourceMatchId) {
    const awayBoxscore = await dependencies.getMatchBoxscore(
      env,
      userId,
      connectedInput.awaySourceMatchId,
    );
    if (!awayBoxscore && !canFallback) {
      throw new Error(
        "The selected away source match is unavailable in cache.",
      );
    }
    if (awayBoxscore) {
      Object.assign(
        resolved,
        buildSideFromBoxscore(awayBoxscore, connectedInput.awayTeamId, "away"),
      );
    }
  }

  for (const field of DIRECT_CONNECTED_FIELDS) {
    const value = connectedInput[field];
    if (value !== undefined && value !== null && value !== "") {
      resolved[field] = value;
    }
  }

  if (!connectedInput.homeSourceMatchId || !connectedInput.awaySourceMatchId) {
    if (!connectedInput.manualFallback) {
      throw new Error(
        "Connected predictions require cached source matches or a manual fallback payload.",
      );
    }
  }

  return resolved;
}

function buildSideFromBoxscore(
  matchBoxscore: Record<string, unknown>,
  requestedTeamId: string | undefined,
  side: "home" | "away",
): JsonRecord {
  const perspective = resolveBoxscorePerspective(
    matchBoxscore,
    requestedTeamId,
  );
  const output: JsonRecord = {};

  for (const field of RATING_FIELDS) {
    output[`${side}_${field}`] = requireNumber(
      perspective.ratings[field],
      `${side}_${field}`,
    );
  }

  output[`${side}_offStrategy`] = perspective.offStrategy ?? "Base";
  output[`${side}_defStrategy`] = perspective.defStrategy ?? "ManToMan";
  if (perspective.gdpFocus) {
    output[`${side}_gdp_focus`] = perspective.gdpFocus;
  }
  if (perspective.gdpPace) {
    output[`${side}_gdp_pace`] = perspective.gdpPace;
  }
  return output;
}

function resolveBoxscorePerspective(
  matchBoxscore: Record<string, unknown>,
  requestedTeamId: string | undefined,
): {
  ratings: JsonRecord;
  offStrategy: string | null;
  defStrategy: string | null;
  gdpFocus: string | null;
  gdpPace: string | null;
} {
  const boxscore = requireRecord(matchBoxscore.boxscoreJson, "boxscoreJson");
  const selectedTeamId = requestedTeamId?.trim() || null;
  if (!selectedTeamId) {
    throw new Error("A team id is required to resolve a source match.");
  }

  const { team: selectedSide } = selectBoxscorePerspective(
    boxscore,
    selectedTeamId,
  );
  if (!selectedSide) {
    throw new Error(
      `The requested team ${selectedTeamId} was not found in the stored boxscore.`,
    );
  }

  const gdp = asOptionalRecord(selectedSide?.gdp);
  const ratings = requireRecord(selectedSide.ratings, "ratings");

  return {
    ratings,
    offStrategy: asOptionalString(selectedSide.offStrategy),
    defStrategy: asOptionalString(selectedSide.defStrategy),
    gdpFocus: asOptionalString(gdp?.focus),
    gdpPace: asOptionalString(gdp?.pace),
  };
}

async function invokePredictionEndpoint(
  endpointName: string,
  resolvedInput: JsonRecord,
): Promise<JsonRecord> {
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
  const parsed = requireRecord(
    rawBody ? JSON.parse(rawBody) : null,
    "SageMaker prediction response",
  );

  if (
    typeof parsed.homeScore !== "number" ||
    typeof parsed.awayScore !== "number"
  ) {
    throw new Error("SageMaker response did not contain numeric scores.");
  }

  return parsed;
}

function parseQueueMessage(body: string): { jobId: string; userId: string } {
  const parsed = requireRecord(JSON.parse(body), "SQS prediction job message");
  const jobId = asOptionalString(parsed.jobId);
  const userId = asOptionalString(parsed.userId);
  if (!jobId || !userId) {
    throw new Error("Prediction queue message must include jobId and userId.");
  }
  return { jobId, userId };
}

function resolvePredictionJobMessage(args: {
  message?: { jobId: string; userId: string };
  messageBody?: string;
}): { jobId: string; userId: string } {
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
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`${label} is unavailable in the cached source match.`);
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
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
