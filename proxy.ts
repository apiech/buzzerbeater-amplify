import { type NextRequest, NextResponse } from "next/server";
import { fetchAuthSession } from "aws-amplify/auth/server";

import { runWithAmplifyServerContext } from "@/app/server/amplify-server";

export async function proxy(request: NextRequest) {
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
  matcher: ["/", "/workspace/:path*"],
};
