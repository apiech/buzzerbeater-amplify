import { env } from "$amplify/env/revoke-shared-player-card";

import type { Schema } from "../resource";
import { revokePlayerCard } from "../_backend/workspace";

type Handler = Schema["revokeSharedPlayerCard"]["functionHandler"];

export const handler: Handler = async (event) => {
  return revokePlayerCard({
    env,
    identity: event.identity,
    shareToken: event.arguments.shareToken,
  });
};
