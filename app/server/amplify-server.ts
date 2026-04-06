import { cookies } from "next/headers";
import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { generateServerClientUsingCookies } from "@aws-amplify/adapter-nextjs/data";
import {
  fetchUserAttributes,
  getCurrentUser,
} from "aws-amplify/auth/server";

import type { Schema } from "@/amplify/data/resource";
import { loadAmplifyOutputs } from "@/app/amplify-outputs";
import { resolveViewerLabel } from "@/app/viewer-identity";

type ServerRunner = ReturnType<typeof createServerRunner>;
type CreateAuthRouteHandlers = ServerRunner["createAuthRouteHandlers"];
type RunWithAmplifyServerContext = ServerRunner["runWithAmplifyServerContext"];
type ServerDataClient = ReturnType<typeof generateServerClientUsingCookies<Schema>>;
type AmplifyServerRuntime = {
  createAuthRouteHandlers: CreateAuthRouteHandlers;
  runWithAmplifyServerContext: RunWithAmplifyServerContext;
  serverDataClient: ServerDataClient;
};
type AmplifyServerRuntimeLoader = () => Promise<AmplifyServerRuntime>;
type NextServerContext =
  Parameters<RunWithAmplifyServerContext>[0]["nextServerContext"];
type ServerContextSpec = Parameters<
  Parameters<RunWithAmplifyServerContext>[0]["operation"]
>[0];

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

export async function createAuthRouteHandlers(
  input: Parameters<CreateAuthRouteHandlers>[0],
): Promise<ReturnType<CreateAuthRouteHandlers>> {
  const runtime = await getAmplifyServerRuntime();
  return runtime.createAuthRouteHandlers(input);
}

export async function runWithAmplifyServerContext<OperationResult>(input: {
  nextServerContext: NextServerContext;
  operation(
    contextSpec: ServerContextSpec,
  ): OperationResult | Promise<OperationResult>;
}): Promise<OperationResult> {
  const runtime = await getAmplifyServerRuntime();
  return runtime.runWithAmplifyServerContext(input);
}

export async function getServerDataClient(): Promise<ServerDataClient> {
  return (await getAmplifyServerRuntime()).serverDataClient;
}

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
