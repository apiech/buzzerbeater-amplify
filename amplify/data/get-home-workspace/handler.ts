import { env } from "$amplify/env/get-home-workspace";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";

type Handler = Schema["getHomeWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getOrRefreshWorkspace({
    env,
    identity: event.identity,
  });

  return workspace.home;
};
