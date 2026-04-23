import { env } from "$amplify/env/set-tracked-player-interview-personality";

import type { Schema } from "../resource";
import { setTrackedPlayerInterviewPersonality } from "../_backend/workspace";

type Handler = Schema["setTrackedPlayerInterviewPersonality"]["functionHandler"];

export const handler: Handler = async (event) => {
  return setTrackedPlayerInterviewPersonality({
    env,
    identity: event.identity,
    personalityType: event.arguments.personalityType,
    playerId: event.arguments.playerId,
  });
};
