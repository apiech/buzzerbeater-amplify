import { isMutationName, runMutationOperation } from "@/app/server/amplify-bff";
import { createAuthenticatedOperationRoute } from "@/app/api/app/operation-route";

export const POST = createAuthenticatedOperationRoute({
  isOperationName: isMutationName,
  label: "mutation",
  runOperation: async ({ body, name }) => runMutationOperation(name, body),
});
