import { env } from "$amplify/env/get-lineup-plan";

import type { Schema } from "../resource";
import { getLineupPlan } from "../_backend/workspace";

type Handler = Schema["getLineupPlan"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getLineupPlan({
    env,
    identity: event.identity,
  }) as Promise<NonNullable<Schema["getLineupPlan"]["returnType"]>>;
};
