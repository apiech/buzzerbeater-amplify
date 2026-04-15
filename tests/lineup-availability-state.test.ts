import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLineupAvailabilityOverride,
  countPendingLineupAvailabilityChanges,
  normalizeExcludedPlayerIds,
  readTeamLineupAvailabilityOverride,
  resolvePendingLineupAvailabilityChange,
  teamLineupAvailabilityOverridesEqual,
  toggleExcludedPlayerId,
  writeTeamLineupAvailabilityOverride,
} from "../app/lineup-availability-state";

function createMemoryStorage(): Storage {
  const backing = new Map<string, string>();
  return {
    clear() {
      backing.clear();
    },
    getItem(key) {
      return backing.get(key) ?? null;
    },
    key(index) {
      return Array.from(backing.keys())[index] ?? null;
    },
    get length() {
      return backing.size;
    },
    removeItem(key) {
      backing.delete(key);
    },
    setItem(key, value) {
      backing.set(key, value);
    },
  };
}

test("normalizeExcludedPlayerIds trims, dedupes, and sorts ids", () => {
  assert.deepEqual(
    normalizeExcludedPlayerIds([" p2 ", "", "p1", "p2", 3 as never]),
    ["p1", "p2"],
  );
});

test("team-scoped availability overrides round-trip through storage", () => {
  const storage = createMemoryStorage();

  writeTeamLineupAvailabilityOverride(storage, "team-a", {
    excludedPlayerIds: ["p2", "p1", "p2"],
  });
  writeTeamLineupAvailabilityOverride(storage, "team-b", {
    excludedPlayerIds: ["p9"],
  });

  assert.deepEqual(readTeamLineupAvailabilityOverride(storage, "team-a"), {
    excludedPlayerIds: ["p1", "p2"],
  });
  assert.deepEqual(readTeamLineupAvailabilityOverride(storage, "team-b"), {
    excludedPlayerIds: ["p9"],
  });
  assert.deepEqual(readTeamLineupAvailabilityOverride(storage, "team-c"), {
    excludedPlayerIds: [],
  });
});

test("toggleExcludedPlayerId adds and removes player ids", () => {
  const added = toggleExcludedPlayerId({ excludedPlayerIds: [] }, "p4");
  assert.deepEqual(added, { excludedPlayerIds: ["p4"] });

  const removed = toggleExcludedPlayerId(added, "p4");
  assert.deepEqual(removed, { excludedPlayerIds: [] });
});

test("availability override equality ignores ordering", () => {
  assert.equal(
    teamLineupAvailabilityOverridesEqual(
      { excludedPlayerIds: ["p2", "p1"] },
      { excludedPlayerIds: ["p1", "p2"] },
    ),
    true,
  );
  assert.equal(
    teamLineupAvailabilityOverridesEqual(
      { excludedPlayerIds: ["p1"] },
      { excludedPlayerIds: ["p1", "p2"] },
    ),
    false,
  );
});

test("pending availability changes count the symmetric difference", () => {
  assert.equal(
    countPendingLineupAvailabilityChanges(
      { excludedPlayerIds: ["p1", "p2"] },
      { excludedPlayerIds: ["p2", "p3"] },
    ),
    2,
  );
  assert.equal(
    countPendingLineupAvailabilityChanges(
      { excludedPlayerIds: ["p2", "p1"] },
      { excludedPlayerIds: ["p1", "p2"] },
    ),
    0,
  );
  assert.equal(
    countPendingLineupAvailabilityChanges(
      { excludedPlayerIds: ["p1"] },
      { excludedPlayerIds: [] },
    ),
    1,
  );
});

test("pending availability changes classify exclusions and inclusions per player", () => {
  assert.equal(
    resolvePendingLineupAvailabilityChange(
      { excludedPlayerIds: ["p1"] },
      { excludedPlayerIds: ["p1", "p2"] },
      "p2",
    ),
    "PENDING_EXCLUSION",
  );
  assert.equal(
    resolvePendingLineupAvailabilityChange(
      { excludedPlayerIds: ["p1", "p2"] },
      { excludedPlayerIds: ["p2"] },
      "p1",
    ),
    "PENDING_INCLUSION",
  );
  assert.equal(
    resolvePendingLineupAvailabilityChange(
      { excludedPlayerIds: ["p1"] },
      { excludedPlayerIds: ["p1"] },
      "p1",
    ),
    null,
  );
});

test("applyLineupAvailabilityOverride keeps system-unavailable players locked out", () => {
  const roster = [
    {
      available: true,
      fullName: "Starter",
      playerId: "p1",
    },
    {
      available: false,
      fullName: "Injured Wing",
      playerId: "p2",
    },
  ] as any;

  const effectiveRoster = applyLineupAvailabilityOverride(roster, {
    excludedPlayerIds: ["p1", "p2"],
  });

  assert.deepEqual(
    effectiveRoster.map((player) => ({
      availabilityStatus: player.availabilityStatus,
      available: player.available,
      isCoachExcluded: player.isCoachExcluded,
      playerId: player.playerId,
    })),
    [
      {
        availabilityStatus: "COACH_EXCLUDED",
        available: false,
        isCoachExcluded: true,
        playerId: "p1",
      },
      {
        availabilityStatus: "SYSTEM_UNAVAILABLE",
        available: false,
        isCoachExcluded: false,
        playerId: "p2",
      },
    ],
  );
});
