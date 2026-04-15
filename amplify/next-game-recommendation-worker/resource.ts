import { defineFunction } from "@aws-amplify/backend";

import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";

export const nextGameRecommendationWorker = defineFunction({
  resourceGroupName: "data",
  name: "next-game-recommendation-worker",
  entry: "./handler.ts",
  timeoutSeconds: 300,
  memoryMB: 3072,
  environment: buildBbConnectionSecretFunctionEnvironment(),
});
