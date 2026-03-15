import { env } from "$amplify/env/get-accessible-match";

import type { Schema } from "../resource";
import { getAccessibleMatch } from "../_backend/match-store";

type Handler = Schema["getAccessibleMatch"]["functionHandler"];

export const handler: Handler = async (event) => {
  const payload = await getAccessibleMatch({
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
