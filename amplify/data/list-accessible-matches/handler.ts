import { env } from "$amplify/env/list-accessible-matches";

import type { Schema } from "../resource";
import { listAccessibleMatches } from "../_backend/match-store";

type Handler = Schema["listAccessibleMatches"]["functionHandler"];

export const handler: Handler = async (event) => {
  const payload = await listAccessibleMatches({
    env,
    identity: event.identity,
    teamId: event.arguments.teamId,
    season: event.arguments.season ?? null,
    cursor: event.arguments.cursor,
  });

  return {
    status: "READY",
    payload,
    error: null,
  };
};
