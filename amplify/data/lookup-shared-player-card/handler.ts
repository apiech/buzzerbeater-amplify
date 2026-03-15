import { env } from "$amplify/env/lookup-shared-player-card";

import type { Schema } from "../resource";
import { lookupSharedPlayerCardByToken } from "../_backend/workspace";

type Handler = Schema["lookupSharedPlayerCard"]["functionHandler"];

export const handler: Handler = async (event) => {
  const payload = await lookupSharedPlayerCardByToken({
    env,
    identity: event.identity,
    shareToken: event.arguments.shareToken,
  });

  return {
    status: payload ? "READY" : "NOT_FOUND",
    payload,
    error: payload ? null : "The requested shared player card was not found.",
  };
};
