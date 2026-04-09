import { env } from "$amplify/env/clear-my-team-highlights-data";

import type { Schema } from "../resource";
import { clearMyTeamHighlightsData } from "../_backend/team-highlights";

type Handler = Schema["clearMyTeamHighlightsData"]["functionHandler"];

export const handler: Handler = async (event) => {
  return clearMyTeamHighlightsData({
    env,
    identity: event.identity,
  });
};
