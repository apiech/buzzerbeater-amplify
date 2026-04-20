import { env } from "$amplify/env/get-league-intel";

import type { Schema } from "../resource";
import { getLeagueIntelWorkspace } from "../_backend/workspace";

type Handler = Schema["getLeagueIntel"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getLeagueIntelWorkspace({
    env,
    force: event.arguments.force ?? false,
    identity: event.identity,
  });
};
