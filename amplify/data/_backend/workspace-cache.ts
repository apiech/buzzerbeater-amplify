export const WORKSPACE_CACHE_VERSION = 2;

export type WorkspaceCachePayload = {
  version: number;
  home: Record<string, unknown>;
  teamHub: Record<string, unknown>;
  scout: Record<string, unknown>;
  leagueIntel: Record<string, unknown>;
  playerLab: Record<string, unknown>;
};

export function buildWorkspaceCachePayload(input: {
  home: Record<string, unknown>;
  teamHub: Record<string, unknown>;
  scout: Record<string, unknown>;
  leagueIntel: Record<string, unknown>;
  playerLab: Record<string, unknown>;
}): WorkspaceCachePayload {
  return {
    version: WORKSPACE_CACHE_VERSION,
    ...input,
  };
}

export function readWorkspaceCachePayload(
  value: unknown,
): WorkspaceCachePayload | null {
  const cache = toRecord(value);
  if (!cache || asNumber(cache.version) !== WORKSPACE_CACHE_VERSION) {
    return null;
  }

  const home = toRecord(cache.home);
  const teamHub = toRecord(cache.teamHub);
  const scout = toRecord(cache.scout);
  const leagueIntel = toRecord(cache.leagueIntel);
  const playerLab = toRecord(cache.playerLab);

  if (!home || !teamHub || !scout || !leagueIntel || !playerLab) {
    return null;
  }

  return {
    version: WORKSPACE_CACHE_VERSION,
    home,
    teamHub,
    scout,
    leagueIntel,
    playerLab,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
