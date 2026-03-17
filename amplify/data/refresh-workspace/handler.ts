import { env } from "$amplify/env/refresh-workspace";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";

type Handler = Schema["refreshWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getOrRefreshWorkspace({
    env,
    identity: event.identity,
    force: true,
  });

  return workspace.home;
};
