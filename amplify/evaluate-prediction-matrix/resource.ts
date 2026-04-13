import { defineFunction } from "@aws-amplify/backend";

export const evaluatePredictionMatrix = defineFunction({
  resourceGroupName: "data",
  name: "evaluate-prediction-matrix",
  entry: "../data/evaluate-prediction-matrix/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 1024,
});
