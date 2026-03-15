import { env } from "$amplify/env/get-match-boxscore-details";

import type { Schema } from "../resource";
import { getMatchBoxscoreDetails } from "../_backend/match-store";

type Handler = Schema["getMatchBoxscoreDetails"]["functionHandler"];

export const handler: Handler = async (event) => {
  const payload = await getMatchBoxscoreDetails({
    env,
    identity: event.identity,
    matchId: event.arguments.matchId,
  });

  return {
    status: "READY",
    payload,
    error: null,
  };
};
