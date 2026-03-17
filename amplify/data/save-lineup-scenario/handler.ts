import { env } from "$amplify/env/save-lineup-scenario";

import type { Schema } from "../resource";
import { saveLineupScenario } from "../_backend/workspace";

type Handler = Schema["saveLineupScenario"]["functionHandler"];

export const handler: Handler = async (event) => {
  return saveLineupScenario({
    env,
    identity: event.identity,
    name: event.arguments.name,
    starters: event.arguments.starters,
    minuteTargets: event.arguments.minuteTargets,
    note: event.arguments.note,
  });
};
