import { env } from "$amplify/env/get-accessible-play-by-play";

import type { Schema } from "../resource";
import { getAccessiblePlayByPlay } from "../_backend/match-store";

type Handler = Schema["getAccessiblePlayByPlay"]["functionHandler"];

export const handler: Handler = async (event) => {
  const payload = await getAccessiblePlayByPlay({
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
