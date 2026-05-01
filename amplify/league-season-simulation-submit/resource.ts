import { defineFunction } from "@aws-amplify/backend";

import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";

export const leagueSeasonSimulationSubmit = defineFunction({
  resourceGroupName: "data",
  name: "league-season-simulation-submit",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: buildBbConnectionSecretFunctionEnvironment(),
});
