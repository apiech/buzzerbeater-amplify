import { env } from "$amplify/env/get-latest-next-game-recommendation";

import type { Schema } from "../resource";
import { getLatestNextGameRecommendation } from "../_backend/next-game-recommendation";

type Handler = Schema["getLatestNextGameRecommendation"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getLatestNextGameRecommendation({
    env,
    identity: event.identity,
    input: event.arguments.input,
  });
};
