import { defineFunction } from "@aws-amplify/backend";

export const getAccessiblePlayByPlay = defineFunction({
  resourceGroupName: "data",
  name: "get-accessible-play-by-play",
  entry: "../data/get-accessible-play-by-play/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
