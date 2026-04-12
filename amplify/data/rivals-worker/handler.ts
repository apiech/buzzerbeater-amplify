import { env } from "$amplify/env/rivals-worker";

import { processRivalsBackfill } from "../_backend/rivals";

type RivalsBackfillMessage = {
  requestedAt: string;
  teamId: string;
  userId: string;
};

export const handler = async (
  event: RivalsBackfillMessage,
): Promise<{ ok: true }> => {
  await processRivalsBackfill({
    env,
    message: event,
  });
  return { ok: true };
};
