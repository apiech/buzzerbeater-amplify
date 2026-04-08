import { type NextRequest, NextResponse } from "next/server";
import { fetchAuthSession } from "aws-amplify/auth/server";

import { runWithAmplifyServerContext } from "@/app/server/amplify-server";
import { maybeCreateMaintenanceRedirectResponse } from "@/app/server/maintenance";

export async function proxy(request: NextRequest) {
  if (isMaintenanceProtectedPath(request.nextUrl.pathname)) {
    const maintenanceRedirect =
      await maybeCreateMaintenanceRedirectResponse(request);
    if (maintenanceRedirect) {
      return maintenanceRedirect;
    }
  }

  if (!request.nextUrl.pathname.startsWith("/workspace")) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const authenticated = await runWithAmplifyServerContext({
    nextServerContext: {
      request,
      response,
    },
    operation: async (contextSpec) => {
      try {
        const session = await fetchAuthSession(contextSpec);
        const tokens = session.tokens;
        return Boolean(tokens?.accessToken && tokens.idToken);
      } catch {
        return false;
      }
    },
  });

  if (authenticated) {
    return response;
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/", "/login", "/store", "/workspace/:path*", "/api/auth/:path*"],
};

function isMaintenanceProtectedPath(pathname: string): boolean {
  if (
    pathname === "/api/auth/sign-in-callback" ||
    pathname === "/api/auth/sign-out-callback"
  ) {
    return false;
  }

  return true;
}
