import { env } from "$amplify/env/get-player-trend";

import type { Schema } from "../resource";
import { getPlayerTrend } from "../_backend/workspace";

type Handler = Schema["getPlayerTrend"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getPlayerTrend({
    env,
    identity: event.identity,
    playerId: event.arguments.playerId,
  });
};
