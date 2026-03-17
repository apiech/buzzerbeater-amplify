import { createAuthRouteHandlers } from "@/app/server/amplify-server";

function getAuthHandler() {
  return createAuthRouteHandlers({
    redirectOnSignInComplete: "/workspace/home",
    redirectOnSignOutComplete: "/login",
  });
}

export async function GET(request: Request, context: unknown) {
  return getAuthHandler()(request, context as never);
}
