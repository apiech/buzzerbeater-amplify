import { env } from "$amplify/env/get-latest-opponent-forecast";

import type { Schema } from "../resource";
import { getLatestOpponentForecast } from "../_backend/opponent-forecast";

type Handler = Schema["getLatestOpponentForecast"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getLatestOpponentForecast({
    env,
    identity: event.identity,
    teamId: event.arguments.teamId,
  });
};
