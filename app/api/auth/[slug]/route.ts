import { createAuthRouteHandlers } from "@/app/server/amplify-server";
import { maybeCreateMaintenanceRedirectResponse } from "@/app/server/maintenance";

async function getAuthHandler() {
  return createAuthRouteHandlers({
    redirectOnSignInComplete: "/workspace/home",
    redirectOnSignOutComplete: "/login",
  });
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      slug: string;
    }>;
  },
) {
  const { slug } = await context.params;
  if (!slug.endsWith("-callback")) {
    const maintenanceRedirect = await maybeCreateMaintenanceRedirectResponse({
      url: request.url,
    });
    if (maintenanceRedirect) {
      return maintenanceRedirect;
    }
  }

  const handler = await getAuthHandler();
  return handler(request, context as never);
}
