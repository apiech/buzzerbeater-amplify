import { env } from "$amplify/env/get-league-history";

import type { Schema } from "../resource";
import { getLeagueHistory } from "../_backend/league-history";

type Handler = Schema["getLeagueHistory"]["functionHandler"];

export const handler: Handler = async (event) =>
  getLeagueHistory({
    env,
    identity: event.identity,
    leagueId: event.arguments.leagueId,
  });
