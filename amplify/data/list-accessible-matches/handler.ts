import { env } from "$amplify/env/list-accessible-matches";

import type { Schema } from "../resource";
import { listAccessibleMatches } from "../_backend/match-store";

type Handler = Schema["listAccessibleMatches"]["functionHandler"];

export const handler: Handler = async (event) => {
  return listAccessibleMatches({
    env,
    identity: event.identity,
    teamId: event.arguments.teamId,
    season: event.arguments.season ?? null,
    cursor: event.arguments.cursor,
  });
};
