import { z } from "zod";

import type {
  LineupHelperRosterPlayer,
  LineupHelperWorkspaceRecord,
} from "@/app/types";
import { parseLegacyJsonField } from "@/lib/json-parsing";

export const LINEUP_AVAILABILITY_STORAGE_KEY =
  "bb.lineupAvailabilityOverrides.v1";

export type TeamLineupAvailabilityOverride = {
  excludedPlayerIds: string[];
};

export type EffectiveLineupHelperRosterPlayer = LineupHelperRosterPlayer & {
  availabilityStatus: "AVAILABLE" | "COACH_EXCLUDED" | "SYSTEM_UNAVAILABLE";
  isCoachExcluded: boolean;
  isSystemAvailable: boolean;
};

type LineupAvailabilityInputPlayer =
  LineupHelperWorkspaceRecord["roster"][number];

const availabilityOverrideSchema = z
  .record(
    z
      .object({
        excludedPlayerIds: z.array(z.string()).optional(),
      })
      .partial(),
  )
  .catch({});

export function normalizeExcludedPlayerIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function normalizeTeamLineupAvailabilityOverride(
  value: unknown,
): TeamLineupAvailabilityOverride {
  const parsed =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    excludedPlayerIds: normalizeExcludedPlayerIds(
      (parsed as { excludedPlayerIds?: unknown }).excludedPlayerIds,
    ),
  };
}

export function readTeamLineupAvailabilityOverride(
  storage: Storage | null | undefined,
  teamId: string | null | undefined,
): TeamLineupAvailabilityOverride {
  if (!storage || !teamId) {
    return { excludedPlayerIds: [] };
  }

  const raw = storage.getItem(LINEUP_AVAILABILITY_STORAGE_KEY);
  if (!raw) {
    return { excludedPlayerIds: [] };
  }

  const parsed = parseLegacyJsonField(availabilityOverrideSchema, raw);
  return normalizeTeamLineupAvailabilityOverride(parsed?.[teamId]);
}

export function writeTeamLineupAvailabilityOverride(
  storage: Storage | null | undefined,
  teamId: string | null | undefined,
  value: TeamLineupAvailabilityOverride,
): void {
  if (!storage || !teamId) {
    return;
  }

  const raw = storage.getItem(LINEUP_AVAILABILITY_STORAGE_KEY);
  const parsed = raw
    ? parseLegacyJsonField(availabilityOverrideSchema, raw)
    : {};
  const normalized = normalizeTeamLineupAvailabilityOverride(value);

  storage.setItem(
    LINEUP_AVAILABILITY_STORAGE_KEY,
    JSON.stringify({
      ...(parsed ?? {}),
      [teamId]: normalized,
    }),
  );
}

export function toggleExcludedPlayerId(
  current: TeamLineupAvailabilityOverride,
  playerId: string,
): TeamLineupAvailabilityOverride {
  const normalizedPlayerId = playerId.trim();
  if (!normalizedPlayerId) {
    return current;
  }

  return current.excludedPlayerIds.includes(normalizedPlayerId)
    ? {
        excludedPlayerIds: current.excludedPlayerIds.filter(
          (entry) => entry !== normalizedPlayerId,
        ),
      }
    : {
        excludedPlayerIds: normalizeExcludedPlayerIds([
          ...current.excludedPlayerIds,
          normalizedPlayerId,
        ]),
      };
}

export function applyLineupAvailabilityOverride(
  roster: readonly LineupAvailabilityInputPlayer[],
  override: TeamLineupAvailabilityOverride,
): EffectiveLineupHelperRosterPlayer[] {
  const excludedIds = new Set(override.excludedPlayerIds);

  return roster.map((player) => {
    const isCoachExcluded =
      player.available && excludedIds.has(player.playerId);
    const availabilityStatus = !player.available
      ? "SYSTEM_UNAVAILABLE"
      : isCoachExcluded
        ? "COACH_EXCLUDED"
        : "AVAILABLE";

    return {
      ...player,
      age: player.age ?? null,
      availabilityStatus,
      available: availabilityStatus === "AVAILABLE",
      bestPosition: player.bestPosition ?? null,
      dmi: player.dmi ?? null,
      gameShape: player.gameShape ?? null,
      injuryWeeks: player.injuryWeeks ?? null,
      isCoachExcluded,
      isSystemAvailable: player.available,
      salary: player.salary ?? null,
      snapshotCapturedAt: player.snapshotCapturedAt ?? null,
      snapshotWarning: player.snapshotWarning ?? null,
      snapshotWeekKey: player.snapshotWeekKey ?? null,
    };
  });
}
