import { env } from "$amplify/env/get-scout-workspace";

import type { Schema } from "../resource";
import { getScoutWorkspaceForTeam } from "../_backend/workspace";

type Handler = Schema["getScoutWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getScoutWorkspaceForTeam({
    env,
    identity: event.identity,
    teamId: event.arguments.teamId ?? null,
  });

  return workspace.scout;
};
