import { env } from "$amplify/env/get-home-workspace";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";

type Handler = Schema["getHomeWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getOrRefreshWorkspace({
    env,
    force: event.arguments.force ?? false,
    identity: event.identity,
    syncActiveTrackedTeams: event.arguments.force ?? false,
  });

  return workspace.home;
};
