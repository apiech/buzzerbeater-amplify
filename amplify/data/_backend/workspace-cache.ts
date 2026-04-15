import {
  WORKSPACE_CACHE_VERSION,
  assertHomeWorkspace,
  assertWorkspaceCachePayload,
  readWorkspaceCachePayloadContract,
  type WorkspaceCachePayloadShape,
} from "../../../lib/owned-data/contracts";
import { projectWorkspaceCacheConnection } from "./connection-projection";

export { WORKSPACE_CACHE_VERSION };

export type WorkspaceCachePayload = WorkspaceCachePayloadShape;
type WorkspaceCachePayloadInput = {
  home: unknown;
  teamHub: unknown;
  scout: unknown;
  leagueIntel: unknown;
  playerLab: unknown;
  arena: unknown;
};

type ErrorWithMessage = {
  message?: string | null;
};

export function buildWorkspaceCachePayload(
  input: WorkspaceCachePayloadInput,
): WorkspaceCachePayload {
  const home = assertHomeWorkspace(input.home, "workspace cache payload home");

  return assertWorkspaceCachePayload(
    {
      version: WORKSPACE_CACHE_VERSION,
      ...input,
      home: {
        ...home,
        connection: projectWorkspaceCacheConnection(
          home.connection,
          "workspace cache payload home.connection",
        ),
      },
    },
    "workspace cache payload",
  );
}

export function readWorkspaceCachePayload(
  value: unknown,
): WorkspaceCachePayload | null {
  return readWorkspaceCachePayloadContract(value);
}

export function isLegacyWorkspaceCacheCoercionError(
  error: ErrorWithMessage | null | undefined,
): boolean {
  const message = error?.message?.trim();
  if (!message) {
    return false;
  }

  const isCoercionError =
    message.includes("Cannot return null for non-nullable type") ||
    message.includes("type mismatch error");
  const mentionsWorkspaceCache = message.includes("workspaceCacheJson");
  const mentionsWorkspacePayload =
    message.includes("WorkspaceCachePayload") ||
    message.includes("/getBbConnection/");

  return isCoercionError && mentionsWorkspaceCache && mentionsWorkspacePayload;
}

export function partitionLegacyWorkspaceCacheCoercionErrors<
  TError extends ErrorWithMessage,
>(
  errors: readonly TError[] | null | undefined,
): {
  legacyErrors: TError[];
  otherErrors: TError[];
} {
  const legacyErrors: TError[] = [];
  const otherErrors: TError[] = [];

  for (const error of errors ?? []) {
    if (isLegacyWorkspaceCacheCoercionError(error)) {
      legacyErrors.push(error);
      continue;
    }

    otherErrors.push(error);
  }

  return {
    legacyErrors,
    otherErrors,
  };
}
