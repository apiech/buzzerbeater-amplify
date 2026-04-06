import { env } from "$amplify/env/prediction-submit";

import type { Schema } from "../data/resource";
import { submitPredictionJob } from "../data/_backend/prediction";

type Handler = Schema["submitPredictionJob"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)["PREDICTION_JOB_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "Prediction state machine ARN environment variable was not found.",
    );
  }

  return submitPredictionJob({
    env,
    identity: event.identity,
    request: event.arguments.request,
    stateMachineArn,
  });
};
