import { env } from "$amplify/env/game-day-recap-submit";

import type { Schema } from "../data/resource";
import { submitGameDayRecap } from "../data/_backend/game-day-recap";

type Handler = Schema["submitGameDayRecap"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  console.info("[game-day-recap-submit] received", {
    gameDate: event.arguments.gameDate,
    leagueId: event.arguments.leagueId,
  });
  const stateMachineArn = (env as RuntimeEnv)["GAME_DAY_RECAP_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "Game day recap state machine ARN environment variable was not found.",
    );
  }

  try {
    const result = await submitGameDayRecap({
      env,
      gameDate: event.arguments.gameDate,
      identity: event.identity,
      leagueId: event.arguments.leagueId,
      qualityTier: event.arguments.qualityTier ?? null,
      stateMachineArn,
    });

    console.info("[game-day-recap-submit] succeeded", {
      targetKey: result.targetKey,
    });
    return result;
  } catch (error) {
    console.error("[game-day-recap-submit] failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : null,
      gameDate: event.arguments.gameDate,
      leagueId: event.arguments.leagueId,
    });
    throw error;
  }
};
