import type { Schema } from "../resource";

export const WORKSPACE_CACHE_VERSION = 5;

type StoredWorkspaceCachePayload = NonNullable<
  Schema["BbConnection"]["type"]["workspaceCacheJson"]
>;

export type WorkspaceCachePayload = Omit<StoredWorkspaceCachePayload, "arena"> & {
  arena: NonNullable<StoredWorkspaceCachePayload["arena"]>;
};

type ErrorWithMessage = {
  message?: string | null;
};

export function buildWorkspaceCachePayload(input: {
  home: WorkspaceCachePayload["home"];
  teamHub: WorkspaceCachePayload["teamHub"];
  scout: WorkspaceCachePayload["scout"];
  leagueIntel: WorkspaceCachePayload["leagueIntel"];
  playerLab: WorkspaceCachePayload["playerLab"];
  arena: WorkspaceCachePayload["arena"];
}): WorkspaceCachePayload {
  return {
    version: WORKSPACE_CACHE_VERSION,
    ...input,
  };
}

export function readWorkspaceCachePayload(
  value: unknown,
): WorkspaceCachePayload | null {
  const cache = toRecord(parseLegacyJsonValue(value));
  if (!cache || asNumber(cache.version) !== WORKSPACE_CACHE_VERSION) {
    return null;
  }

  const home = toRecord(cache.home);
  const teamHub = toRecord(cache.teamHub);
  const scout = toRecord(cache.scout);
  const leagueIntel = toRecord(cache.leagueIntel);
  const playerLab = toRecord(cache.playerLab);
  const arena = toRecord(cache.arena);

  if (!home || !teamHub || !scout || !leagueIntel || !playerLab || !arena) {
    return null;
  }

  return {
    version: WORKSPACE_CACHE_VERSION,
    home: home as WorkspaceCachePayload["home"],
    teamHub: teamHub as WorkspaceCachePayload["teamHub"],
    scout: scout as WorkspaceCachePayload["scout"],
    leagueIntel: leagueIntel as WorkspaceCachePayload["leagueIntel"],
    playerLab: playerLab as WorkspaceCachePayload["playerLab"],
    arena: arena as WorkspaceCachePayload["arena"],
  };
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

function parseLegacyJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
