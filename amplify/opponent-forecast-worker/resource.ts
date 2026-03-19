import { defineFunction } from "@aws-amplify/backend";

export const opponentForecastWorker = defineFunction({
  resourceGroupName: "data",
  name: "opponent-forecast-worker",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 1024,
});
