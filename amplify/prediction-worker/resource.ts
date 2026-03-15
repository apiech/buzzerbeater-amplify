import { defineFunction } from "@aws-amplify/backend";

export const predictionWorker = defineFunction({
  resourceGroupName: "data",
  name: "prediction-worker",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 1024,
});
