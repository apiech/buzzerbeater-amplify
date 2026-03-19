import { env } from "$amplify/env/get-rivals-workspace";

import type { Schema } from "../resource";
import { getRivalsWorkspace } from "../_backend/rivals";

type Handler = Schema["getRivalsWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getRivalsWorkspace({
    env,
    identity: event.identity,
  });
};
