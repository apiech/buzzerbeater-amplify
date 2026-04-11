import { isReadName, runReadOperation } from "@/app/server/read-bff";
import { createAuthenticatedOperationRoute } from "@/app/api/app/operation-route";

export const POST = createAuthenticatedOperationRoute({
  isOperationName: isReadName,
  label: "read",
  runOperation: async ({ body, currentUser, name }) =>
    runReadOperation(name, currentUser.userId, body),
});
