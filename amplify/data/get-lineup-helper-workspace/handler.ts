import type { Schema } from "../resource";
import { getLineupHelperWorkspace } from "../_backend/lineup-helper";

type Handler = Schema["getLineupHelperWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getLineupHelperWorkspace({
    env: process.env,
    identity: event.identity,
  }) as Promise<NonNullable<Schema["getLineupHelperWorkspace"]["returnType"]>>;
};
