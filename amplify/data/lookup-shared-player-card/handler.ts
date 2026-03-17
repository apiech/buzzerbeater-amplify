import { env } from "$amplify/env/lookup-shared-player-card";

import type { Schema } from "../resource";
import { lookupSharedPlayerCardByToken } from "../_backend/workspace";

type Handler = Schema["lookupSharedPlayerCard"]["functionHandler"];

export const handler: Handler = async (event) => {
  return lookupSharedPlayerCardByToken({
    env,
    identity: event.identity,
    shareToken: event.arguments.shareToken,
  });
};
