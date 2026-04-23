import { defineFunction } from "@aws-amplify/backend";

export const gameDayRecapFailureFinalizer = defineFunction({
  resourceGroupName: "data",
  name: "game-day-recap-failure-finalizer",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
