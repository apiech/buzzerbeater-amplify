import { env } from "$amplify/env/game-day-recap-worker";

import {
  processQueuedRecapJob,
} from "../data/_backend/game-day-recap";

type RuntimeEnv = Record<string, string | undefined>;
type RecapJobMessage = {
  kind: "LEAGUE_DATE" | "LEAGUE_GAME_DAY" | "SINGLE_GAME";
  modelId?: string;
  requestedAt: string;
  targetKey: string;
  userId: string;
};

export const handler = async (
  event: RecapJobMessage,
): Promise<{ ok: true }> => {
  const runtimeEnv = env as RuntimeEnv;
  const fallbackModelId = runtimeEnv["GAME_DAY_RECAP_MODEL_ID"];
  console.info("[game-day-recap-worker] execution.start", {
    kind: event.kind ?? null,
    modelId: event.modelId ?? fallbackModelId ?? null,
    requestedAt: event.requestedAt,
    targetKey: event.targetKey,
    userId: event.userId,
  });
  await processQueuedRecapJob({
    env,
    message: event,
    modelId: fallbackModelId,
    region: runtimeEnv.AWS_REGION,
  });
  return { ok: true };
};
