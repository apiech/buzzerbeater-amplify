import { env } from "$amplify/env/game-day-recap-worker";

import {
  processQueuedRecapJob,
} from "../data/_backend/game-day-recap";
import {
  normalizeRecapInterviewIntensity,
} from "../data/_backend/game-day-recap-request";
import type { RecapQueueMessage } from "../data/_backend/game-day-recap-request";

type RuntimeEnv = Record<string, string | undefined>;
type RecapJobMessage = {
  interviewIntensity?: "clean" | "full_heat" | "none" | "pg13";
  kind:
    | "LEAGUE_DATE"
    | "LEAGUE_GAME_DAY"
    | "LEAGUE_GAME_DAY_PERFORMANCES"
    | "SINGLE_GAME";
  modelId?: string;
  modelJudgeEnabled?: boolean;
  qualityTier?: "standard" | "premium";
  requestedAt: string;
  targetKey: string;
  userId: string;
};

export const handler = async (
  event: RecapJobMessage,
  context: {
    getRemainingTimeInMillis(): number;
  },
): Promise<{ ok: true }> => {
  const runtimeEnv = env as RuntimeEnv;
  const fallbackModelId = runtimeEnv["GAME_DAY_RECAP_MODEL_ID"];
  const message: RecapQueueMessage = {
    ...event,
    interviewIntensity: normalizeRecapInterviewIntensity(
      event.interviewIntensity,
    ),
    modelJudgeEnabled: event.modelJudgeEnabled === true,
    qualityTier: event.qualityTier ?? "standard",
  };
  console.info("[game-day-recap-worker] execution.start", {
    interviewIntensity: message.interviewIntensity,
    kind: message.kind,
    modelId: message.modelId ?? fallbackModelId ?? null,
    modelJudgeEnabled: message.modelJudgeEnabled,
    qualityTier: message.qualityTier,
    requestedAt: message.requestedAt,
    targetKey: message.targetKey,
    userId: message.userId,
  });
  await processQueuedRecapJob({
    env,
    message,
    modelId: fallbackModelId,
    remainingTimeInMillis: () => context.getRemainingTimeInMillis(),
    region: runtimeEnv.AWS_REGION,
  });
  return { ok: true };
};
