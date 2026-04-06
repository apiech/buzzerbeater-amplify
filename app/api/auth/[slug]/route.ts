import { createAuthRouteHandlers } from "@/app/server/amplify-server";

async function getAuthHandler() {
  return createAuthRouteHandlers({
    redirectOnSignInComplete: "/workspace/home",
    redirectOnSignOutComplete: "/login",
  });
}

export async function GET(request: Request, context: unknown) {
  const handler = await getAuthHandler();
  return handler(request, context as never);
}
