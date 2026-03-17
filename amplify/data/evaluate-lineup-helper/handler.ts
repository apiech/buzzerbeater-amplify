import type { Schema } from "../resource";
import { evaluateLineupHelper } from "../_backend/lineup-helper";

type Handler = Schema["evaluateLineupHelper"]["functionHandler"];

export const handler: Handler = async (event) => {
  return evaluateLineupHelper({
    roster: event.arguments.roster,
    assignments: event.arguments.assignments,
    context: event.arguments.context,
  });
};
