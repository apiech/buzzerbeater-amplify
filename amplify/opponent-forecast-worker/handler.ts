import { env } from "$amplify/env/opponent-forecast-worker";

import { processOpponentForecastJob } from "../data/_backend/opponent-forecast";

type RuntimeEnv = Record<string, string | undefined>;
type OpponentForecastJobMessage = {
  jobId: string;
  userId: string;
};

export const handler = async (
  event: OpponentForecastJobMessage,
): Promise<{ ok: true }> => {
  const endpointName = (env as RuntimeEnv)["OPPONENT_FORECAST_ENDPOINT_NAME"];
  if (!endpointName) {
    throw new Error(
      "Opponent forecast endpoint name environment variable was not found.",
    );
  }

  await processOpponentForecastJob({
    env,
    endpointName,
    message: event,
  });
  return { ok: true };
};
