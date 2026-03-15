import { defineFunction } from "@aws-amplify/backend";

export const getAccessibleMatch = defineFunction({
  resourceGroupName: "data",
  name: "get-accessible-match",
  entry: "../data/get-accessible-match/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
