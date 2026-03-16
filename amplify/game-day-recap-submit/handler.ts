import { env } from "$amplify/env/game-day-recap-submit";

import type { Schema } from "../data/resource";
import { submitGameDayRecap } from "../data/_backend/game-day-recap";

type Handler = Schema["submitGameDayRecap"]["functionHandler"];

export const handler: Handler = async (event) => {
  const queueUrl = env.GAME_DAY_RECAP_QUEUE_URL;
  if (!queueUrl) {
    throw new Error(
      "Game day recap queue URL environment variable was not found.",
    );
  }

  return submitGameDayRecap({
    env,
    gameDate: event.arguments.gameDate,
    identity: event.identity,
    leagueId: event.arguments.leagueId,
    queueUrl,
  });
};
