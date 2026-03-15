import { defineFunction } from "@aws-amplify/backend";

export const predictionSubmit = defineFunction({
  resourceGroupName: "data",
  name: "prediction-submit",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
