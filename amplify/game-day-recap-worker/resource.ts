import { defineFunction } from "@aws-amplify/backend";

import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";

export const gameDayRecapWorker = defineFunction({
  resourceGroupName: "data",
  name: "game-day-recap-worker",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 1024,
  environment: buildBbConnectionSecretFunctionEnvironment(),
});
