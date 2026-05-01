import { defineFunction } from "@aws-amplify/backend";

export const leagueSeasonSimulationFailureFinalizer = defineFunction({
  resourceGroupName: "data",
  name: "league-season-simulation-failure-finalizer",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
