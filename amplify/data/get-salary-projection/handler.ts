import { env } from "$amplify/env/get-salary-projection";

import type { Schema } from "../resource";
import { getSalaryProjection } from "../_backend/workspace";

type Handler = Schema["getSalaryProjection"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getSalaryProjection({
    env,
    identity: event.identity,
    playerId: event.arguments.playerId,
  }) as Promise<NonNullable<Schema["getSalaryProjection"]["returnType"]>>;
};
