import { env } from "$amplify/env/evaluate-prediction-matrix";

import type { Schema } from "../resource";
import { evaluatePredictionMatrix } from "../_backend/prediction-matrix";

type Handler = Schema["evaluatePredictionMatrix"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const endpointName = (env as RuntimeEnv)["PREDICTION_ENDPOINT_NAME"];
  if (!endpointName) {
    throw new Error("Prediction endpoint environment variable was not found.");
  }

  return evaluatePredictionMatrix({
    endpointName,
    env,
    identity: event.identity,
    request: event.arguments.request,
  });
};
