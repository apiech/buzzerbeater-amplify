import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLineupPlanPayload,
  buildSalaryProjectionPayload,
} from "../amplify/data/_backend/workspace";

test("buildLineupPlanPayload ranks a five-man starter group and minute targets", () => {
  const plan = buildLineupPlanPayload({
    connection: {} as any,
    home: {
      team: {
        injuries: [
          {
            playerId: "p6",
            fullName: "Rotation Big",
            injuryWeeks: 1,
          },
        ],
      },
    },
    teamHub: {
      roster: [
        createPlayer("p1", "Lead Guard", "PG", 2, 14, 55000, "strong"),
        createPlayer("p2", "Shooter", "SG", 3, 12, 48000, "proficient"),
        createPlayer("p3", "Wing Stopper", "SF", 2, 11, 51000, "respectable"),
        createPlayer("p4", "Stretch Big", "PF", 1, 10, 52000, "strong"),
        createPlayer("p5", "Anchor", "C", 4, 13, 60000, "proficient"),
        createPlayer("p6", "Bench Big", "C", 0, 7, 28000, "mediocre", 1),
      ],
    },
    scout: {
      summary: {
        teamName: "Opponent",
        tendencies: {
          offense: { Push: 3, Motion: 1 },
          defense: { ManToMan: 2, Press: 1 },
        },
      },
    },
    leagueIntel: {},
    playerLab: {},
  } as any);

  assert.equal(Array.isArray(plan.recommendedStarters), true);
  assert.equal((plan.recommendedStarters as Array<unknown>).length, 5);
  assert.equal(
    (plan.recommendedStarters as Array<{ bestPosition: string }>)[0].bestPosition,
    "PG",
  );
  assert.ok(
    Object.keys(plan.minuteTargets as Record<string, number>).includes("p1"),
  );
  assert.equal(Array.isArray(plan.rotationNotes), true);
  assert.equal(Array.isArray(plan.matchupRationale), true);
});

test("buildSalaryProjectionPayload computes trend and flag fit", () => {
  const projection = buildSalaryProjectionPayload({
    player: {
      playerId: "p1",
      fullName: "Flag Prospect",
      bestPosition: "SF",
      nationalityName: "USA",
      salary: 50000,
      profileJson: {
        nationality: {
          name: "USA",
        },
      },
    },
    snapshots: [
      { weekKey: "2026-W09", salary: 47000 },
      { weekKey: "2026-W10", salary: 49000 },
      { weekKey: "2026-W11", salary: 50000 },
    ],
    teamCountryName: "USA",
  });

  assert.equal(projection.currentSalary, 50000);
  assert.equal(projection.projectedSalary, 51500);
  assert.equal(projection.trend, "UP");
  assert.equal(projection.isFlagTarget, true);
});

function createPlayer(
  playerId: string,
  fullName: string,
  bestPosition: string,
  projectedStarterCount: number,
  ppg: number,
  salary: number,
  gameShape: string,
  injuryWeeks = 0,
) {
  return {
    playerId,
    fullName,
    bestPosition,
    projectedStarterCount,
    salary,
    gameShape,
    dmi: 120000,
    injuryWeeks,
    stats: {
      ppg,
    },
  };
}
