import { env } from "$amplify/env/get-lineup-helper-workspace";

import type { Schema } from "../resource";
import { getLineupHelperWorkspace } from "../_backend/lineup-helper";

type Handler = Schema["getLineupHelperWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getLineupHelperWorkspace({
    env,
    identity: event.identity,
  });
};
