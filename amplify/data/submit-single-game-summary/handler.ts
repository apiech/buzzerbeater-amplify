import { env } from "$amplify/env/submit-single-game-summary";

import type { Schema } from "../resource";
import { submitSingleGameSummary } from "../_backend/game-day-recap";

type Handler = Schema["submitSingleGameSummary"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)["GAME_DAY_RECAP_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "Game day recap state machine ARN environment variable was not found.",
    );
  }

  return submitSingleGameSummary({
    env,
    identity: event.identity,
    matchId: event.arguments.matchId,
    qualityTier: event.arguments.qualityTier ?? null,
    stateMachineArn,
  });
};
