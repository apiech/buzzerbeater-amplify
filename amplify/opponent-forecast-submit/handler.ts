import { env } from "$amplify/env/opponent-forecast-submit";

import type { Schema } from "../data/resource";
import { submitOpponentForecastJob } from "../data/_backend/opponent-forecast";

type Handler = Schema["submitOpponentForecastJob"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)["OPPONENT_FORECAST_JOB_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "Opponent forecast state machine ARN environment variable was not found.",
    );
  }

  return submitOpponentForecastJob({
    env,
    identity: event.identity,
    stateMachineArn,
    teamId: event.arguments.teamId,
  });
};
