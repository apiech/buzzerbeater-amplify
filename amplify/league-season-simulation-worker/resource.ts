import { defineFunction } from "@aws-amplify/backend";

import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";

export const leagueSeasonSimulationWorker = defineFunction({
  resourceGroupName: "data",
  name: "league-season-simulation-worker",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 3072,
  environment: buildBbConnectionSecretFunctionEnvironment(),
});
