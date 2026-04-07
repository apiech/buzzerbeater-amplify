import { env } from "$amplify/env/prediction-worker";

import { processPredictionJob } from "../data/_backend/prediction";

type RuntimeEnv = Record<string, string | undefined>;
type PredictionJobMessage = {
  requestId: string;
  userId: string;
};

export const handler = async (
  event: PredictionJobMessage,
): Promise<{ ok: true }> => {
  const endpointName = (env as RuntimeEnv)["PREDICTION_ENDPOINT_NAME"];
  if (!endpointName) {
    throw new Error("Prediction endpoint name environment variable was not found.");
  }

  await processPredictionJob({
    env,
    endpointName,
    message: event,
  });
  return { ok: true };
};
