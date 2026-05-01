import { env } from "$amplify/env/get-latest-league-season-simulation";

import type { Schema } from "../resource";
import { getLatestLeagueSeasonSimulation } from "../_backend/league-season-simulation";

type Handler = Schema["getLatestLeagueSeasonSimulation"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getLatestLeagueSeasonSimulation({
    env,
    identity: event.identity,
  });
};
