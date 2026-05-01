import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

type PredictionRuntimeClient = Pick<SageMakerRuntimeClient, "send">;

type PredictionRuntimeDependencies = {
  client: PredictionRuntimeClient;
  sleep: (attempt: number) => Promise<void>;
};

const MAX_PREDICTION_RUNTIME_ATTEMPTS = 4;
const DEFAULT_PREDICTION_RUNTIME_CALL_TIMEOUT_MS = 30_000;
const PREDICTION_RUNTIME_CAPACITY_ERROR_MESSAGE =
  "The prediction engine is temporarily at capacity. Please try again in a minute.";
const PREDICTION_RUNTIME_RESPONSE_TOO_LARGE_ERROR_MESSAGE =
  "The prediction engine returned more detail than the service can carry.";
const PREDICTION_RUNTIME_RESPONSE_TOO_LARGE_ERROR_NAME =
  "PredictionRuntimeResponseTooLargeError";
const RETRYABLE_PREDICTION_RUNTIME_ERROR_NAMES = new Set([
  "InternalFailure",
  "ServiceUnavailableException",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
]);

let predictionRuntimeClient: PredictionRuntimeClient | null = null;

export function getPredictionRuntimeClient(): PredictionRuntimeClient {
  if (!predictionRuntimeClient) {
    predictionRuntimeClient = new SageMakerRuntimeClient({});
  }

  return predictionRuntimeClient;
}

export async function invokePredictionRuntimeEndpoint(args: {
  endpointName: string;
  payload: unknown;
  timeoutMs?: number;
}, dependencies: Partial<PredictionRuntimeDependencies> = {}): Promise<unknown> {
  const deps: PredictionRuntimeDependencies = {
    client: getPredictionRuntimeClient(),
    sleep: waitForPredictionRuntimeRetry,
    ...dependencies,
  };
  const response = await sendPredictionRuntimeCommand(
    new InvokeEndpointCommand({
      EndpointName: args.endpointName,
      ContentType: "application/json",
      Body: Buffer.from(JSON.stringify(args.payload)),
    }),
    deps,
    normalizePredictionRuntimeTimeoutMs(args.timeoutMs),
  );

  const rawBody = response.Body?.transformToString
    ? await Promise.resolve(response.Body.transformToString())
    : Buffer.from(response.Body ?? []).toString("utf-8");

  return rawBody ? JSON.parse(rawBody) : null;
}

async function sendPredictionRuntimeCommand(
  command: InvokeEndpointCommand,
  dependencies: PredictionRuntimeDependencies,
  timeoutMs: number,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_PREDICTION_RUNTIME_ATTEMPTS; attempt += 1) {
    try {
      return await sendWithTimeout(dependencies.client, command, timeoutMs);
    } catch (error) {
      lastError = error;
      if (
        !shouldRetryPredictionRuntimeError(error) ||
        attempt >= MAX_PREDICTION_RUNTIME_ATTEMPTS - 1
      ) {
        throw normalizePredictionRuntimeError(error);
      }
      await dependencies.sleep(attempt);
    }
  }

  throw normalizePredictionRuntimeError(lastError);
}

async function sendWithTimeout(
  client: PredictionRuntimeClient,
  command: InvokeEndpointCommand,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await client.send(command, {
      abortSignal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePredictionRuntimeTimeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : DEFAULT_PREDICTION_RUNTIME_CALL_TIMEOUT_MS;
}

function normalizePredictionRuntimeError(error: unknown): Error {
  if (isPredictionRuntimeResponseTooLargeError(error)) {
    return createPredictionRuntimeError(
      PREDICTION_RUNTIME_RESPONSE_TOO_LARGE_ERROR_MESSAGE,
      PREDICTION_RUNTIME_RESPONSE_TOO_LARGE_ERROR_NAME,
      error,
    );
  }

  if (isPredictionRuntimeThrottleError(error)) {
    return createPredictionRuntimeError(
      PREDICTION_RUNTIME_CAPACITY_ERROR_MESSAGE,
      "PredictionRuntimeThrottleError",
      error,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function shouldRetryPredictionRuntimeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorName = error.name.trim();
  return (
    RETRYABLE_PREDICTION_RUNTIME_ERROR_NAMES.has(errorName) ||
    isPredictionRuntimeThrottleError(error)
  );
}

function isPredictionRuntimeThrottleError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /throttl/i.test(error.name) || /throttl/i.test(error.message);
}

export function isPredictionRuntimeResponseTooLargeError(
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === PREDICTION_RUNTIME_RESPONSE_TOO_LARGE_ERROR_NAME) {
    return true;
  }

  return (
    looksLikePredictionRuntimeResponseTooLargeMessage(error.message) ||
    (error.cause instanceof Error &&
      looksLikePredictionRuntimeResponseTooLargeMessage(error.cause.message))
  );
}

function looksLikePredictionRuntimeResponseTooLargeMessage(
  message: string,
): boolean {
  return (
    /response payload from the container/i.test(message) &&
    /maximum limit of 4 MB/i.test(message)
  );
}

function createPredictionRuntimeError(
  message: string,
  name: string,
  cause: unknown,
): Error {
  const resolvedCause = cause instanceof Error ? cause : new Error(String(cause));
  const error = new Error(message) as Error & { cause?: Error };
  error.name = name;
  error.cause = resolvedCause;
  return error;
}

async function waitForPredictionRuntimeRetry(attempt: number): Promise<void> {
  const delayMs = 250 * 2 ** attempt;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export const __testing = {
  DEFAULT_PREDICTION_RUNTIME_CALL_TIMEOUT_MS,
  PREDICTION_RUNTIME_CAPACITY_ERROR_MESSAGE,
  PREDICTION_RUNTIME_RESPONSE_TOO_LARGE_ERROR_MESSAGE,
  isPredictionRuntimeResponseTooLargeError,
  normalizePredictionRuntimeError,
  shouldRetryPredictionRuntimeError,
};
