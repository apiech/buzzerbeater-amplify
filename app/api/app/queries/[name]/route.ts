import { isQueryName, runQueryOperation } from "@/app/server/amplify-bff";
import { createAuthenticatedOperationRoute } from "@/app/api/app/operation-route";

export const POST = createAuthenticatedOperationRoute({
  isOperationName: isQueryName,
  label: "query",
  runOperation: async ({ body, name }) => runQueryOperation(name, body),
});
