import { env } from "$amplify/env/submit-league-game-day-recap";

import type { Schema } from "../resource";
import { submitLeagueGameDayRecap } from "../_backend/game-day-recap";

type Handler = Schema["submitLeagueGameDayRecap"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const queueUrl = (env as RuntimeEnv)["GAME_DAY_RECAP_QUEUE_URL"];
  if (!queueUrl) {
    throw new Error("Game day recap queue URL environment variable was not found.");
  }

  return submitLeagueGameDayRecap({
    env,
    gameDayNumber: event.arguments.gameDayNumber,
    identity: event.identity,
    leagueId: event.arguments.leagueId,
    queueUrl,
    season: event.arguments.season ?? null,
  });
};
