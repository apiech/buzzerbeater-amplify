import { env } from "$amplify/env/submit-single-game-summary";

import type { Schema } from "../resource";
import { submitSingleGameSummary } from "../_backend/game-day-recap";

type Handler = Schema["submitSingleGameSummary"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const queueUrl = (env as RuntimeEnv)["GAME_DAY_RECAP_QUEUE_URL"];
  if (!queueUrl) {
    throw new Error("Game day recap queue URL environment variable was not found.");
  }

  return submitSingleGameSummary({
    env,
    identity: event.identity,
    matchId: event.arguments.matchId,
    queueUrl,
  });
};
