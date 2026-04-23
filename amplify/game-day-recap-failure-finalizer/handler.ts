import { env } from "$amplify/env/game-day-recap-failure-finalizer";

import { finalizeQueuedRecapJobFailure } from "../data/_backend/game-day-recap";
import type { RecapQueueMessage } from "../data/_backend/game-day-recap-request";

type WorkflowFailureEvent = RecapQueueMessage & {
  error?: unknown;
};

export const handler = async (
  event: WorkflowFailureEvent,
): Promise<{ ok: true; updated: boolean }> => {
  const result = await finalizeQueuedRecapJobFailure({
    env,
    event,
  });
  return {
    ok: true,
    updated: result.updated,
  };
};
