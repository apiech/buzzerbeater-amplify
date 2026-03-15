import { defineFunction, secret } from "@aws-amplify/backend";

export const getMatchBoxscoreDetails = defineFunction({
  resourceGroupName: "data",
  name: "get-match-boxscore-details",
  entry: "../data/get-match-boxscore-details/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: {
    BB_CONNECTION_ENCRYPTION_SECRET: secret("BB_CONNECTION_ENCRYPTION_SECRET"),
  },
});
