import { env } from "$amplify/env/submit-league-game-day-recap";

import type { Schema } from "../resource";
import { submitLeagueGameDayRecap } from "../_backend/game-day-recap";

type Handler = Schema["submitLeagueGameDayRecap"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)["GAME_DAY_RECAP_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "Game day recap state machine ARN environment variable was not found.",
    );
  }

  return submitLeagueGameDayRecap({
    env,
    gameDayNumber: event.arguments.gameDayNumber,
    identity: event.identity,
    interviewIntensity: event.arguments.interviewIntensity ?? null,
    leagueId: event.arguments.leagueId,
    modelJudgeEnabled: event.arguments.modelJudgeEnabled ?? null,
    qualityTier: event.arguments.qualityTier ?? null,
    stateMachineArn,
    season: event.arguments.season ?? null,
  });
};
