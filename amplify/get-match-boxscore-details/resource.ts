import { defineFunction } from "@aws-amplify/backend";

import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";

export const getMatchBoxscoreDetails = defineFunction({
  resourceGroupName: "data",
  name: "get-match-boxscore-details",
  entry: "../data/get-match-boxscore-details/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: buildBbConnectionSecretFunctionEnvironment(),
});
