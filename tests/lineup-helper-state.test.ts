import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentMatrixFromLineup,
  assignmentsFromMatrix,
  coerceEnthusiasm,
  emptyMinuteMatrix,
  validateLineupMatrix,
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

function buildLegalMatrix() {
  const matrix = emptyMinuteMatrix(players);
  matrix.p1.PG = 42;
  matrix.p2.SG = 42;
  matrix.p3.SF = 42;
  matrix.p4.PF = 42;
  matrix.p5.C = 42;
  matrix.p6.PG = 6;
  matrix.p6.SG = 6;
  matrix.p6.SF = 6;
  matrix.p6.PF = 6;
  matrix.p6.C = 6;
  return matrix;
}

test("lineup helper matrix conversion preserves explicit legal assignments", () => {
  const assignments = [
    { playerId: "p1", position: "PG", minutes: 42 },
    { playerId: "p2", position: "SG", minutes: 42 },
    { playerId: "p3", position: "SF", minutes: 42 },
    { playerId: "p4", position: "PF", minutes: 42 },
    { playerId: "p5", position: "C", minutes: 42 },
    { playerId: "p6", position: "PG", minutes: 6 },
    { playerId: "p6", position: "SG", minutes: 6 },
    { playerId: "p6", position: "SF", minutes: 6 },
    { playerId: "p6", position: "PF", minutes: 6 },
    { playerId: "p6", position: "C", minutes: 6 },
  ] as const;

  const matrix = assignmentMatrixFromLineup(players, assignments as any);
  const roundTrip = assignmentsFromMatrix(matrix);
  assert.deepEqual(roundTrip, assignments);
});

test("lineup helper validation rejects non-6-minute inputs", () => {
  const matrix = buildLegalMatrix();
  matrix.p1.PG = 41;
  matrix.p6.PG = 7;

  const validation = validateLineupMatrix(players, matrix);
  assert.equal(
    validation.errors.includes(
      "Lead Guard has illegal PG minutes. Use 6-minute increments up to 42.",
    ),
    true,
  );
  assert.equal(
    validation.errors.includes(
      "Sixth Man has illegal PG minutes. Use 6-minute increments up to 42.",
    ),
    true,
  );
});

test("lineup helper validation rejects 48 minutes on one player", () => {
  const matrix = buildLegalMatrix();
  matrix.p1.PG = 48;
  matrix.p6.PG = 0;

  const validation = validateLineupMatrix(players, matrix);
  assert.equal(
    validation.errors.includes("Lead Guard exceeds 42 total minutes."),
    true,
  );
  assert.equal(
    validation.errors.includes(
      "PG must use one of the legal minute splits: 42/6, 36/12, 30/18, 30/12/6, or 24/18/6.",
    ),
    true,
  );
});

test("lineup helper validation rejects duplicate starters across positions", () => {
  const matrix = emptyMinuteMatrix(players);
  matrix.p1.PG = 24;
  matrix.p2.PG = 18;
  matrix.p6.PG = 6;
  matrix.p1.SG = 24;
  matrix.p3.SG = 18;
  matrix.p7.SG = 6;
  matrix.p3.SF = 42;
  matrix.p6.SF = 6;
  matrix.p4.PF = 42;
  matrix.p6.PF = 6;
  matrix.p5.C = 42;
  matrix.p6.C = 6;

  const validation = validateLineupMatrix(players, matrix);
  assert.equal(
    validation.errors.includes("A player cannot start at multiple positions."),
    true,
  );
});

test("lineup helper validation accepts a legal three-player split and derives roles", () => {
  const matrix = buildLegalMatrix();
  matrix.p1.PG = 30;
  matrix.p6.PG = 12;
  matrix.p7.PG = 6;

  const validation = validateLineupMatrix(players, matrix);
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

test("lineup helper enthusiasm coercion now accepts the documented 1..15 range", () => {
  assert.equal(coerceEnthusiasm(15), 15);
  assert.equal(coerceEnthusiasm(99), 15);
  assert.equal(coerceEnthusiasm(0), 1);
});
