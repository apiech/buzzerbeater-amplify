import { env } from "$amplify/env/get-my-team-highlights";

import type { Schema } from "../resource";
import { getMyTeamHighlights } from "../_backend/team-highlights";

type Handler = Schema["getMyTeamHighlights"]["functionHandler"];

export const handler: Handler = async (event) => {
  const payload = await getMyTeamHighlights({
    cursor: event.arguments.cursor,
    env,
    identity: event.identity,
    onlyOutcomeChange: event.arguments.onlyOutcomeChange,
    perspective: event.arguments.perspective,
  });

  return {
    error: null,
    payload,
    status: "READY",
  };
};
