import { env } from "$amplify/env/get-player-lab";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";

type Handler = Schema["getPlayerLab"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getOrRefreshWorkspace({
    env,
    identity: event.identity,
  });

  return {
    syncedAt: workspace.connection.lastSyncAt ?? null,
    ...workspace.playerLab,
  };
};
