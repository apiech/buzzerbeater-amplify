import { env } from "$amplify/env/get-league-intel";

import type { Schema } from "../resource";
import { getOrRefreshWorkspace } from "../_backend/workspace";

type Handler = Schema["getLeagueIntel"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getOrRefreshWorkspace({
    env,
    force: event.arguments.force ?? false,
    identity: event.identity,
    syncActiveTrackedTeams: event.arguments.force ?? false,
  });

  return workspace.leagueIntel;
};
