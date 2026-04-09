import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentsFromLineupLayout,
  coerceEnthusiasm,
  emptyLineupLayout,
  lineupLayoutFromAssignments,
  normalizeHelperContext,
  validateLineupLayout,
} from "../app/lineup-helper-state";

const players = [
  { playerId: "p1", fullName: "Lead Guard", available: true },
  { playerId: "p2", fullName: "Shooter", available: true },
  { playerId: "p3", fullName: "Wing", available: true },
  { playerId: "p4", fullName: "Big", available: true },
  { playerId: "p5", fullName: "Anchor", available: true },
  { playerId: "p6", fullName: "Sixth Man", available: true },
  { playerId: "p7", fullName: "Bench Wing", available: true },
] as any;

function buildLegalLayout() {
  const layout = emptyLineupLayout();
  layout.PG.starterPlayerId = "p1";
  layout.PG.backupPlayerId = "p6";
  layout.SG.starterPlayerId = "p2";
  layout.SG.backupPlayerId = "p6";
  layout.SF.starterPlayerId = "p3";
  layout.SF.backupPlayerId = "p6";
  layout.PF.starterPlayerId = "p4";
  layout.PF.backupPlayerId = "p6";
  layout.C.starterPlayerId = "p5";
  layout.C.backupPlayerId = "p6";
  return layout;
}

test("lineup helper layout conversion preserves explicit legal assignments", () => {
  const assignments = [
    { playerId: "p1", position: "PG", minutes: 42 },
    { playerId: "p6", position: "PG", minutes: 6 },
    { playerId: "p2", position: "SG", minutes: 42 },
    { playerId: "p6", position: "SG", minutes: 6 },
    { playerId: "p3", position: "SF", minutes: 42 },
    { playerId: "p6", position: "SF", minutes: 6 },
    { playerId: "p4", position: "PF", minutes: 42 },
    { playerId: "p6", position: "PF", minutes: 6 },
    { playerId: "p5", position: "C", minutes: 42 },
    { playerId: "p6", position: "C", minutes: 6 },
  ] as const;

  const layout = lineupLayoutFromAssignments(assignments as any);
  const roundTrip = assignmentsFromLineupLayout(layout);
  assert.deepEqual(roundTrip, assignments);
});

test("lineup helper validation rejects duplicate players inside one position card", () => {
  const layout = buildLegalLayout();
  layout.PG.backupPlayerId = "p1";

  const validation = validateLineupLayout(
    players,
    layout,
    normalizeHelperContext({}).defensiveSwitch,
  );
  assert.equal(
    validation.errors.includes(
      "PG cannot assign the same player to starter, backup, or reserve more than once.",
    ),
    true,
  );
});

test("lineup helper validation rejects duplicate starters across positions", () => {
  const layout = buildLegalLayout();
  layout.SG.starterPlayerId = "p1";
  layout.SG.backupPlayerId = "p2";

  const validation = validateLineupLayout(
    players,
    layout,
    normalizeHelperContext({}).defensiveSwitch,
  );
  assert.equal(
    validation.errors.includes("A player cannot start at multiple positions."),
    true,
  );
});

test("lineup helper validation accepts a legal three-player split and derives roles", () => {
  const layout = buildLegalLayout();
  layout.PG.patternKey = "30-12-6";
  layout.PG.starterPlayerId = "p1";
  layout.PG.backupPlayerId = "p6";
  layout.PG.reservePlayerId = "p7";

  const validation = validateLineupLayout(
    players,
    layout,
    normalizeHelperContext({}).defensiveSwitch,
  );
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.teamTotal, 240);
  assert.deepEqual(
    validation.roleAssignments.PG.map((assignment) => ({
      minutes: assignment.minutes,
      playerId: assignment.playerId,
      role: assignment.role,
    })),
    [
      { playerId: "p1", minutes: 30, role: "starter" },
      { playerId: "p6", minutes: 12, role: "backup" },
      { playerId: "p7", minutes: 6, role: "reserve" },
    ],
  );
});

test("lineup helper validation rejects non-bijective defensive switch mappings", () => {
  const layout = buildLegalLayout();
  const context = normalizeHelperContext({
    defensiveSwitch: {
      PG: "PF",
      SG: "PF",
      SF: "SF",
      PF: "PG",
      C: "C",
    },
  });

  const validation = validateLineupLayout(players, layout, context.defensiveSwitch);
  assert.equal(
    validation.errors.includes(
      "Defensive switch must be a one-to-one mapping across PG, SG, SF, PF, and C.",
    ),
    true,
  );
});

test("lineup helper enthusiasm coercion now accepts the documented 1..15 range", () => {
  assert.equal(coerceEnthusiasm(15), 15);
  assert.equal(coerceEnthusiasm(99), 15);
  assert.equal(coerceEnthusiasm(0), 1);
});
