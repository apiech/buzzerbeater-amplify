import { env } from "$amplify/env/opponent-forecast-submit";

import type { Schema } from "../data/resource";
import { submitOpponentForecastJob } from "../data/_backend/opponent-forecast";

type Handler = Schema["submitOpponentForecastJob"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const queueUrl = (env as RuntimeEnv)["OPPONENT_FORECAST_JOB_QUEUE_URL"];
  if (!queueUrl) {
    throw new Error(
      "Opponent forecast queue URL environment variable was not found.",
    );
  }

  return submitOpponentForecastJob({
    env,
    identity: event.identity,
    queueUrl,
    teamId: event.arguments.teamId,
  });
};
