import { env } from "$amplify/env/get-next-game-planner-detail";

import type { Schema } from "../resource";
import { getNextGamePlannerDetail } from "../_backend/next-game-recommendation";

type Handler = Schema["getNextGamePlannerDetail"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getNextGamePlannerDetail({
    artifactKey: event.arguments.artifactKey,
    env,
    identity: event.identity,
  });
};
