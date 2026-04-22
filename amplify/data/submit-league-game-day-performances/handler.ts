import { env } from "$amplify/env/submit-league-game-day-performances";

import type { Schema } from "../resource";
import { submitLeagueGameDayPerformances } from "../_backend/game-day-recap";

type Handler = Schema["submitLeagueGameDayPerformances"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)["GAME_DAY_RECAP_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "Game day recap state machine ARN environment variable was not found.",
    );
  }

  return submitLeagueGameDayPerformances({
    env,
    gameDayNumber: event.arguments.gameDayNumber,
    identity: event.identity,
    leagueId: event.arguments.leagueId,
    season: event.arguments.season ?? null,
    stateMachineArn,
  });
};
