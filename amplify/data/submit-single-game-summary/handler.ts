import { env } from "$amplify/env/submit-single-game-summary";

import type { Schema } from "../resource";
import { submitSingleGameSummary } from "../_backend/game-day-recap";
import { isInterviewPersonalityType } from "../../../lib/interview-personalities";

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
    interviewIntensity: event.arguments.interviewIntensity ?? null,
    loserInterviewPersonalityType:
      isInterviewPersonalityType(event.arguments.loserInterviewPersonalityType)
        ? event.arguments.loserInterviewPersonalityType
        : null,
    matchId: event.arguments.matchId,
    modelJudgeEnabled: event.arguments.modelJudgeEnabled ?? null,
    qualityTier: event.arguments.qualityTier ?? null,
    stateMachineArn,
    winnerInterviewPersonalityType:
      isInterviewPersonalityType(event.arguments.winnerInterviewPersonalityType)
        ? event.arguments.winnerInterviewPersonalityType
        : null,
  });
};
