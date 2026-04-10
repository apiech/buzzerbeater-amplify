import { defineFunction } from "@aws-amplify/backend";

import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";

export const nextGameRecommendationSubmit = defineFunction({
  resourceGroupName: "data",
  name: "next-game-recommendation-submit",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: buildBbConnectionSecretFunctionEnvironment(),
});
