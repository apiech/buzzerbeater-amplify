import { defineFunction } from "@aws-amplify/backend";

import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";

export const opponentForecastWorker = defineFunction({
  resourceGroupName: "data",
  name: "opponent-forecast-worker",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 1024,
  environment: buildBbConnectionSecretFunctionEnvironment(),
});
