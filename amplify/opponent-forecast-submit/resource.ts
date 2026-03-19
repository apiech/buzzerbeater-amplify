import { defineFunction } from "@aws-amplify/backend";

export const opponentForecastSubmit = defineFunction({
  resourceGroupName: "data",
  name: "opponent-forecast-submit",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
