import { env } from "$amplify/env/game-day-recap-worker";

import {
  processQueuedRecapJob,
} from "../data/_backend/game-day-recap";
import type { RecapQueueMessage } from "../data/_backend/game-day-recap-request";

type RuntimeEnv = Record<string, string | undefined>;
type RecapJobMessage = {
  kind:
    | "LEAGUE_DATE"
    | "LEAGUE_GAME_DAY"
    | "LEAGUE_GAME_DAY_PERFORMANCES"
    | "SINGLE_GAME";
  modelId?: string;
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
    qualityTier: event.qualityTier ?? "standard",
  };
  console.info("[game-day-recap-worker] execution.start", {
    kind: message.kind,
    modelId: message.modelId ?? fallbackModelId ?? null,
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
