import { env } from "$amplify/env/next-game-recommendation-submit";

import type { Schema } from "../data/resource";
import { submitNextGameRecommendationJob } from "../data/_backend/next-game-recommendation";

type Handler = Schema["submitNextGameRecommendationJob"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)[
    "NEXT_GAME_RECOMMENDATION_JOB_STATE_MACHINE_ARN"
  ];
  if (!stateMachineArn) {
    throw new Error(
      "Next-game recommendation state machine ARN environment variable was not found.",
    );
  }

  return submitNextGameRecommendationJob({
    env,
    identity: event.identity,
    input: event.arguments.input,
    stateMachineArn,
  });
};
