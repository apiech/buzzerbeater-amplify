import { env } from "$amplify/env/get-player-lab";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";

type Handler = Schema["getPlayerLab"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getOrRefreshWorkspace({
    env,
    force: event.arguments.force ?? false,
    identity: event.identity,
    syncActiveTrackedTeams: false,
  });

  return workspace.playerLab;
};
