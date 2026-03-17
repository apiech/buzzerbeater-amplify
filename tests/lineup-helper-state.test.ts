import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentMatrixFromLineup,
  assignmentsFromMatrix,
  emptyMinuteMatrix,
  validateLineupMatrix,
} from "../app/lineup-helper-state";

const players = [
  { playerId: "p1", fullName: "PG", available: true },
  { playerId: "p2", fullName: "SG", available: true },
  { playerId: "p3", fullName: "SF", available: true },
  { playerId: "p4", fullName: "PF", available: true },
  { playerId: "p5", fullName: "C", available: true },
] as any;

test("lineup helper matrix conversion preserves explicit assignments", () => {
  const assignments = [
    { playerId: "p1", position: "PG", minutes: 48 },
    { playerId: "p2", position: "SG", minutes: 48 },
    { playerId: "p3", position: "SF", minutes: 48 },
    { playerId: "p4", position: "PF", minutes: 48 },
    { playerId: "p5", position: "C", minutes: 48 },
  ] as const;

  const matrix = assignmentMatrixFromLineup(players, assignments as any);
  const roundTrip = assignmentsFromMatrix(matrix);
  assert.deepEqual(roundTrip, assignments);
});

test("lineup helper validation flags incomplete position totals and player overload", () => {
  const matrix = emptyMinuteMatrix(players);
  const pointGuardRow = matrix.p1;
  const shootingGuardRow = matrix.p2;
  assert.ok(pointGuardRow);
  assert.ok(shootingGuardRow);
  pointGuardRow.PG = 50;
  shootingGuardRow.SG = 20;

  const validation = validateLineupMatrix(players, matrix);
  assert.equal(validation.errors.includes("PG must total 48 minutes."), true);
  assert.equal(validation.errors.includes("PG exceeds 48 total minutes."), true);
  assert.equal(
    validation.errors.includes("The lineup must total 240 team minutes."),
    true,
  );
});

test("lineup helper validation accepts a complete five-player allocation", () => {
  const matrix = emptyMinuteMatrix(players);
  const pointGuardRow = matrix.p1;
  const shootingGuardRow = matrix.p2;
  const smallForwardRow = matrix.p3;
  const powerForwardRow = matrix.p4;
  const centerRow = matrix.p5;
  assert.ok(pointGuardRow);
  assert.ok(shootingGuardRow);
  assert.ok(smallForwardRow);
  assert.ok(powerForwardRow);
  assert.ok(centerRow);
  pointGuardRow.PG = 48;
  shootingGuardRow.SG = 48;
  smallForwardRow.SF = 48;
  powerForwardRow.PF = 48;
  centerRow.C = 48;

  const validation = validateLineupMatrix(players, matrix);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.teamTotal, 240);
});
