import { defineFunction } from "@aws-amplify/backend";

export const listAccessibleMatches = defineFunction({
  resourceGroupName: "data",
  name: "list-accessible-matches",
  entry: "../data/list-accessible-matches/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
