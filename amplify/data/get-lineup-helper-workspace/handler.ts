import { env } from "$amplify/env/get-lineup-helper-workspace";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";
import { getLineupHelperWorkspace } from "../_backend/lineup-helper";

type Handler = Schema["getLineupHelperWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  if (event.arguments.force) {
    await getOrRefreshWorkspace({
      env,
      force: true,
      identity: event.identity,
      syncActiveTrackedTeams: false,
    });
  }

  return getLineupHelperWorkspace({
    env,
    identity: event.identity,
  });
};
