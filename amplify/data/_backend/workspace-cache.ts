import type { Schema } from "../resource";

export const WORKSPACE_CACHE_VERSION = 4;

export type WorkspaceCachePayload = NonNullable<
  Schema["BbConnection"]["type"]["workspaceCacheJson"]
>;

export function buildWorkspaceCachePayload(input: {
  home: WorkspaceCachePayload["home"];
  teamHub: WorkspaceCachePayload["teamHub"];
  scout: WorkspaceCachePayload["scout"];
  leagueIntel: WorkspaceCachePayload["leagueIntel"];
  playerLab: WorkspaceCachePayload["playerLab"];
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

  if (!home || !teamHub || !scout || !leagueIntel || !playerLab) {
    return null;
  }

  return {
    version: WORKSPACE_CACHE_VERSION,
    home: home as WorkspaceCachePayload["home"],
    teamHub: teamHub as WorkspaceCachePayload["teamHub"],
    scout: scout as WorkspaceCachePayload["scout"],
    leagueIntel: leagueIntel as WorkspaceCachePayload["leagueIntel"],
    playerLab: playerLab as WorkspaceCachePayload["playerLab"],
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
