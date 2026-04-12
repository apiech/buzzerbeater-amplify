import { env } from "$amplify/env/submit-rivals-backfill";

import type { Schema } from "../resource";
import { submitRivalsBackfill } from "../_backend/rivals";

type Handler = Schema["submitRivalsBackfill"]["functionHandler"];

export const handler: Handler = async (event) => {
  const stateMachineArn = env.RIVALS_BACKFILL_STATE_MACHINE_ARN;
  if (!stateMachineArn) {
    throw new Error("Rivals backfill workflow is not configured.");
  }

  return submitRivalsBackfill({
    env,
    identity: event.identity,
    stateMachineArn,
  });
};
