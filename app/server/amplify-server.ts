import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { cookies } from "next/headers";
import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { generateServerClientUsingCookies } from "@aws-amplify/adapter-nextjs/data";
import {
  fetchUserAttributes,
  getCurrentUser,
} from "aws-amplify/auth/server";

import type { Schema } from "@/amplify/data/resource";
import { resolveViewerLabel } from "@/app/viewer-identity";

function loadAmplifyOutputs(): Record<string, unknown> {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), "amplify_outputs.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      // CI test runs do not materialize amplify_outputs.json before importing
      // server helpers. An empty config keeps those imports loadable until a
      // test installs a stubbed client or the real app generates outputs.
      return {};
    }

    throw error;
  }
}

const outputs = loadAmplifyOutputs();

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
