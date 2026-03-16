import { defineFunction } from "@aws-amplify/backend";

export const gameDayRecapSubmit = defineFunction({
  resourceGroupName: "data",
  name: "game-day-recap-submit",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
