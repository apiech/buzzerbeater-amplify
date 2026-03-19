import { defineFunction, secret } from "@aws-amplify/backend";

export const opponentForecastWorker = defineFunction({
  resourceGroupName: "data",
  name: "opponent-forecast-worker",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 1024,
  environment: {
    BB_CONNECTION_ENCRYPTION_SECRET: secret("BB_CONNECTION_ENCRYPTION_SECRET"),
  },
});
