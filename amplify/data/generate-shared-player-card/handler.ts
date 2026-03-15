import { env } from "$amplify/env/generate-shared-player-card";

import type { Schema } from "../resource";
import { generatePlayerCard } from "../_backend/workspace";

type Handler = Schema["generateSharedPlayerCard"]["functionHandler"];

export const handler: Handler = async (event) => {
  const result = await generatePlayerCard({
    env,
    identity: event.identity,
    playerId: event.arguments.playerId,
    title: event.arguments.title ?? null,
    note: event.arguments.note ?? null,
  });

  return result;
};
