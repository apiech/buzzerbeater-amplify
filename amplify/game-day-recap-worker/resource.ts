import { defineFunction, secret } from "@aws-amplify/backend";

export const gameDayRecapWorker = defineFunction({
  resourceGroupName: "data",
  name: "game-day-recap-worker",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 1024,
  environment: {
    BB_CONNECTION_ENCRYPTION_SECRET: secret("BB_CONNECTION_ENCRYPTION_SECRET"),
  },
});
