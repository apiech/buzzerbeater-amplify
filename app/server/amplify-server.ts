import { cookies } from "next/headers";
import { createServerRunner, type NextServer } from "@aws-amplify/adapter-nextjs";
import { generateServerClientUsingCookies } from "@aws-amplify/adapter-nextjs/data";
import {
  fetchUserAttributes,
  getCurrentUser,
} from "aws-amplify/auth/server";
import type { GetCurrentUserOutput } from "aws-amplify/auth";
import type { V6ClientSSRCookies } from "aws-amplify/api/internals";

import type { Schema } from "@/amplify/data/resource";
import { loadAmplifyOutputs } from "@/app/amplify-outputs";
import { resolveViewerLabel } from "@/app/viewer-identity";

type ServerDataClient = V6ClientSSRCookies<Schema>;
type AuthRouteHandlerOptions = {
  customState?: string;
  redirectOnSignInComplete?: string;
  redirectOnSignOutComplete?: string;
};
type AmplifyServerRuntime = Pick<
  NextServer.CreateServerRunnerOutput,
  "createAuthRouteHandlers" | "runWithAmplifyServerContext"
> & {
  serverDataClient: ServerDataClient;
};
type AmplifyServerRuntimeLoader = () => Promise<AmplifyServerRuntime>;

let amplifyServerRuntimePromise: Promise<AmplifyServerRuntime> | null = null;
let amplifyServerRuntimeLoader: AmplifyServerRuntimeLoader =
  defaultAmplifyServerRuntimeLoader;

async function defaultAmplifyServerRuntimeLoader(): Promise<AmplifyServerRuntime> {
  const outputs = await loadAmplifyOutputs();
  const runner = createServerRunner({
    config: outputs,
  });

  return {
    createAuthRouteHandlers: runner.createAuthRouteHandlers,
    runWithAmplifyServerContext: runner.runWithAmplifyServerContext,
    serverDataClient: generateServerClientUsingCookies<Schema>({
      config: outputs,
      cookies,
    }),
  };
}

async function getAmplifyServerRuntime(): Promise<AmplifyServerRuntime> {
  if (!amplifyServerRuntimePromise) {
    amplifyServerRuntimePromise = amplifyServerRuntimeLoader().catch((error) => {
      amplifyServerRuntimePromise = null;
      throw error;
    });
  }

  return amplifyServerRuntimePromise;
}

export async function createAuthRouteHandlers(input: AuthRouteHandlerOptions) {
  const runtime = await getAmplifyServerRuntime();
  return runtime.createAuthRouteHandlers(input);
}

export async function runWithAmplifyServerContext<OperationResult>(input: {
  nextServerContext: NextServer.Context | null;
  operation: NextServer.RunWithContextInput<OperationResult>["operation"];
}): Promise<OperationResult> {
  const runtime = await getAmplifyServerRuntime();
  return runtime.runWithAmplifyServerContext(input);
}

export async function getServerDataClient(): Promise<ServerDataClient> {
  return (await getAmplifyServerRuntime()).serverDataClient;
}

export type ServerCurrentUser = GetCurrentUserOutput;

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

function resetAmplifyServerRuntimeCache(): void {
  amplifyServerRuntimePromise = null;
}

export const __testing = {
  installRuntimeLoader(loader: AmplifyServerRuntimeLoader) {
    const previousLoader = amplifyServerRuntimeLoader;
    amplifyServerRuntimeLoader = loader;
    resetAmplifyServerRuntimeCache();
    return () => {
      amplifyServerRuntimeLoader = previousLoader;
      resetAmplifyServerRuntimeCache();
    };
  },
  resetRuntimeCache: resetAmplifyServerRuntimeCache,
};
