import { env } from "$amplify/env/next-game-recommendation-worker";

import { processNextGameRecommendationJob } from "../data/_backend/next-game-recommendation";

type RuntimeEnv = Record<string, string | undefined>;
type RecommendationJobMessage = {
  jobId: string;
  userId: string;
};

export const handler = async (
  event: RecommendationJobMessage,
): Promise<{ ok: true }> => {
  const endpointName = (env as RuntimeEnv)["PREDICTION_ENDPOINT_NAME"];
  if (!endpointName) {
    throw new Error(
      "Prediction endpoint name environment variable was not found.",
    );
  }

  await processNextGameRecommendationJob({
    env,
    endpointName,
    message: event,
  });
  return { ok: true };
};
