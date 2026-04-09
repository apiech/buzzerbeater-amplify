import type { Schema } from "../resource";
import { optimizeLineupHelper } from "../_backend/lineup-helper";

type Handler = Schema["optimizeLineupHelper"]["functionHandler"];

export const handler: Handler = async (event) => {
  return optimizeLineupHelper({
    roster: event.arguments.roster,
    context: event.arguments.context,
  });
};
