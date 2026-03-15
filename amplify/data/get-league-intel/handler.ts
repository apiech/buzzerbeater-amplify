import { env } from "$amplify/env/get-league-intel";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";

type Handler = Schema["getLeagueIntel"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getOrRefreshWorkspace({
    env,
    identity: event.identity,
  });

  return {
    status: "READY",
    syncedAt: workspace.connection.lastSyncAt ?? null,
    payload: workspace.leagueIntel,
    error: workspace.connection.lastSyncError ?? null,
  };
};
