import { cookies } from "next/headers";
import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { generateServerClientUsingCookies } from "@aws-amplify/adapter-nextjs/data";
import {
  fetchUserAttributes,
  getCurrentUser,
} from "aws-amplify/auth/server";

import type { Schema } from "@/amplify/data/resource";
import outputs from "@/amplify_outputs.json";
import { resolveViewerLabel } from "@/app/viewer-identity";

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

export async function resolveServerViewerLabel(
  currentUser: Pick<ServerCurrentUser, "username">,
): Promise<string | null> {
  try {
    const attributes = await runWithAmplifyServerContext({
      nextServerContext: { cookies },
      operation: (contextSpec) => fetchUserAttributes(contextSpec),
    });
    const attributeIdentity = resolveViewerLabel({
      email: attributes.email,
      name: attributes.name,
      preferredUsername: attributes.preferred_username,
      username: currentUser.username,
    });
    if (attributeIdentity) {
      return attributeIdentity;
    }
  } catch {
    // Fall back to a safe username-only resolution path when attributes are unavailable.
  }

  return resolveViewerLabel({
    username: currentUser.username,
  });
}
