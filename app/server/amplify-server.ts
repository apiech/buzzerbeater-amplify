import { cookies } from "next/headers";
import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { generateServerClientUsingCookies } from "@aws-amplify/adapter-nextjs/data";
import { getCurrentUser } from "aws-amplify/auth/server";

import type { Schema } from "@/amplify/data/resource";
import outputs from "@/amplify_outputs.json";

export const { createAuthRouteHandlers, runWithAmplifyServerContext } =
  createServerRunner({
    config: outputs,
  });

export const serverDataClient = generateServerClientUsingCookies<Schema>({
  config: outputs,
  cookies,
});

export type ServerCurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

export async function getServerCurrentUser(): Promise<ServerCurrentUser | null> {
  try {
    return await runWithAmplifyServerContext({
      nextServerContext: { cookies },
      operation: (contextSpec) => getCurrentUser(contextSpec),
    });
  } catch {
    return null;
  }
}

export async function requireServerCurrentUser(): Promise<ServerCurrentUser> {
  const currentUser = await getServerCurrentUser();
  if (!currentUser) {
    throw new Error("Authentication is required.");
  }

  return currentUser;
}

export function resolveViewerEmail(
  currentUser: Pick<ServerCurrentUser, "signInDetails" | "username">,
): string {
  return currentUser.signInDetails?.loginId ?? currentUser.username;
}
