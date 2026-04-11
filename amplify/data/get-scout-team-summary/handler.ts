import { env } from "$amplify/env/get-scout-team-summary";

import type { Schema } from "../resource";
import { getScoutTeamSummaryForTeam } from "../_backend/workspace";

type Handler = Schema["getScoutTeamSummary"]["functionHandler"];

export const handler: Handler = async (event) => {
  const workspace = await getScoutTeamSummaryForTeam({
    env,
    force: event.arguments.force ?? false,
    identity: event.identity,
    teamId: event.arguments.teamId ?? null,
  });

  return workspace.scout;
};
