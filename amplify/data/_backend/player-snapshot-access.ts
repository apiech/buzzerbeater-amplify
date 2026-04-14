import {
  parseStoredOwnedRosterPlayer,
  type BBApiOwnedRosterPlayer,
} from "../../../lib/bbapi";
import {
  listCanonicalPlayerSkillSnapshots,
  upsertCanonicalPlayerSkillSnapshot,
  type CanonicalPlayerSkillSnapshotRecord,
} from "./canonical-player-snapshots";
import {
  getBbConnection,
  getTrackedPlayer,
  listPlayerSkillObservations,
  type BbConnectionRecord,
  type PlayerSkillObservationRecord,
} from "./repository";
import { readWorkspaceCachePayload } from "./workspace-cache";

type GraphqlEnv = Record<string, string | undefined>;

export type { CanonicalPlayerSkillSnapshotRecord };

export type WorkspacePlayerHistoryRecord = {
  bestPosition: string | null;
  capturedAt: string | null;
  dmi: number | null;
  gameShape: string | null;
  injuryWeeks: number | null;
  salary: number | null;
  weekKey: string | null;
};

const runtime = {
  getBbConnection,
  getTrackedPlayer,
  listCanonicalPlayerSkillSnapshots,
  listPlayerSkillObservations,
  upsertCanonicalPlayerSkillSnapshot,
};

export const __testing = {
  buildHistoryKey,
  mergeWorkspacePlayerHistory,
  parseCanonicalSnapshotProfile,
  resolveWorkspacePlayer,
  runtime,
};

export async function listWorkspacePlayerHistory(
  env: GraphqlEnv,
  userId: string,
  playerId: string,
): Promise<WorkspacePlayerHistoryRecord[]> {
  const connection = await runtime.getBbConnection(env, userId);
  if (!resolveWorkspacePlayer(connection, playerId)) {
    throw new Error("The requested player is not available in the current workspace.");
  }

  const [observations, canonicalSnapshots] = await Promise.all([
    runtime.listPlayerSkillObservations(env, userId, playerId),
    runtime.listCanonicalPlayerSkillSnapshots(env, playerId, 104),
  ]);

  return mergeWorkspacePlayerHistory(observations, canonicalSnapshots);
}

export async function getOwnerTrackedPlayerProfile(
  env: GraphqlEnv,
  userId: string,
  playerId: string,
): Promise<BBApiOwnedRosterPlayer | null> {
  const connection = await runtime.getBbConnection(env, userId);
  if (!resolveWorkspacePlayer(connection, playerId)) {
    throw new Error("The requested player is not available in the current workspace.");
  }

  const trackedPlayer = await runtime.getTrackedPlayer(env, userId, playerId);
  const trackedProfile = parseStoredOwnedRosterPlayer(trackedPlayer?.profileJson);
  if (trackedProfile) {
    return trackedProfile;
  }

  const canonicalSnapshots = await runtime.listCanonicalPlayerSkillSnapshots(
    env,
    playerId,
    12,
  );
  return (
    canonicalSnapshots
      .map(parseCanonicalSnapshotProfile)
      .find((profile): profile is BBApiOwnedRosterPlayer => profile !== null) ??
    null
  );
}

export async function storeCanonicalPlayerSkillSnapshot(
  env: GraphqlEnv,
  record: CanonicalPlayerSkillSnapshotRecord,
): Promise<void> {
  await runtime.upsertCanonicalPlayerSkillSnapshot(env, record);
}

function mergeWorkspacePlayerHistory(
  observations: PlayerSkillObservationRecord[],
  canonicalSnapshots: CanonicalPlayerSkillSnapshotRecord[],
): WorkspacePlayerHistoryRecord[] {
  const merged = new Map<string, WorkspacePlayerHistoryRecord>();

  for (const snapshot of canonicalSnapshots) {
    const sanitized = toWorkspacePlayerHistoryRecord(snapshot);
    const key = buildHistoryKey(sanitized);
    if (key) {
      merged.set(key, sanitized);
    }
  }

  for (const observation of observations) {
    const sanitized = toWorkspacePlayerHistoryRecord(observation);
    const key = buildHistoryKey(sanitized);
    if (key) {
      merged.set(key, sanitized);
    }
  }

  return Array.from(merged.values());
}

function parseCanonicalSnapshotProfile(
  snapshot: CanonicalPlayerSkillSnapshotRecord,
): BBApiOwnedRosterPlayer | null {
  const payload = toRecord(snapshot.payload);
  return parseStoredOwnedRosterPlayer(payload?.profile ?? payload);
}

function toWorkspacePlayerHistoryRecord(
  snapshot: {
    bestPosition?: unknown;
    capturedAt?: unknown;
    dmi?: unknown;
    gameShape?: unknown;
    injuryWeeks?: unknown;
    salary?: unknown;
    weekKey?: unknown;
  },
): WorkspacePlayerHistoryRecord {
  return {
    bestPosition: asString(snapshot.bestPosition),
    capturedAt: asString(snapshot.capturedAt),
    dmi: asNumber(snapshot.dmi),
    gameShape: asString(snapshot.gameShape),
    injuryWeeks: asNumber(snapshot.injuryWeeks),
    salary: asNumber(snapshot.salary),
    weekKey: asString(snapshot.weekKey),
  };
}

function buildHistoryKey(
  snapshot: WorkspacePlayerHistoryRecord,
): string | null {
  return snapshot.capturedAt ?? snapshot.weekKey;
}

function resolveWorkspacePlayer(
  connection: BbConnectionRecord | null,
  playerId: string,
): Record<string, unknown> | null {
  const cache = readWorkspaceCachePayload(connection?.workspaceCacheJson);
  const teamHub = cache?.teamHub;
  const playerLab = cache?.playerLab;
  const candidates = [
    ...toRecordArray(teamHub?.roster),
    ...toRecordArray(playerLab?.players),
  ];

  return (
    candidates.find((player) => asString(player.playerId) === playerId) ?? null
  );
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
