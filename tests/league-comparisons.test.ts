import assert from "node:assert/strict";
import test from "node:test";

import { __testing as comparisonTesting } from "../amplify/data/_backend/league-comparisons";
import { __testing as workspaceTesting } from "../amplify/data/_backend/workspace";

test("league comparisons normalize percentage aliases and keep missing diff fields blank", () => {
  const comparisons = comparisonTesting.buildLeagueComparisons({
    builtAt: "2026-04-19T12:00:00.000Z",
    teamSnapshots: [
      createTeamSnapshot({
        teamStats: {
          season: 72,
          categories: {
            apg: { diff: 0.4, opp: 19.0, team: 19.4 },
            blk: { diff: -0.9, opp: 8.3, team: 7.4 },
            effg: { diff: 5.2, opp: 99.3, team: 104.5 },
            fieldGoalPct: { diff: 0.05, opp: 0.331, team: 0.381 },
            freeThrowPct: { diff: 5.6, opp: 84.5, team: 90.1 },
            oreb: { diff: 0.7, opp: 12.0, team: 12.7 },
            pf: { diff: -2.8, opp: 16.3, team: 13.5 },
            points: { diff: 17.0, opp: 74.2, team: 91.2 },
            reb: { diff: 1.6, opp: 49.8, team: 51.4 },
            stl: { diff: 0.2, opp: 5.6, team: 5.8 },
            threePointPct: { opp: 0.262, team: 0.278 },
            to: { diff: -1.5, opp: 11.0, team: 9.5 },
          },
          fields: {},
        },
      }),
    ],
  });

  assert.equal(comparisons.season, 72);
  assert.equal(comparisons.incompleteTeamCount, 0);
  assert.deepStrictEqual(comparisons.offense[0]?.points, {
    diff: 17,
    opponent: 74.2,
    team: 91.2,
  });
  assert.deepStrictEqual(comparisons.offense[0].fgPct, {
    diff: 5,
    opponent: 33.1,
    team: 38.1,
  });
  assert.deepStrictEqual(comparisons.offense[0].threePtPct, {
    diff: null,
    opponent: 26.2,
    team: 27.8,
  });
  assert.equal(comparisons.defense[0]?.turnovers?.diff, -1.5);
});

test("league payroll summaries aggregate roster salary bands with whole-dollar outputs", () => {
  const summary = comparisonTesting.buildPayrollSummary([
    createRosterPlayer(100000),
    createRosterPlayer(90000),
    createRosterPlayer(80000),
    createRosterPlayer(70000),
    createRosterPlayer(60000),
    createRosterPlayer(50000),
    createRosterPlayer(40000),
  ]);

  assert.deepStrictEqual(summary, {
    averageSalary: 70000,
    payrollRanks6To10: 90000,
    playerCount: 7,
    standardDeviation: 20000,
    top10Payroll: 490000,
    top5Payroll: 400000,
    top8Payroll: 490000,
    totalPayroll: 490000,
  });
});

test("league comparisons preserve standings order and compute arena totals", () => {
  const comparisons = comparisonTesting.buildLeagueComparisons({
    builtAt: "2026-04-19T12:00:00.000Z",
    teamSnapshots: [
      createTeamSnapshot({
        conferenceIndex: 0,
        standingsIndex: 1,
        teamId: "team-2",
        teamName: "Beta",
      }),
      createTeamSnapshot({
        arena: createArena({
          bleachers: 14000,
          courtside: 500,
          lowerTier: 6243,
          luxury: 50,
        }),
        conferenceIndex: 0,
        standingsIndex: 0,
        teamId: "team-1",
        teamName: "Alpha",
      }),
    ],
  });

  assert.deepStrictEqual(
    comparisons.arena.map((row) => row.teamId),
    ["team-1", "team-2"],
  );
  assert.equal(comparisons.arena[0]?.totalCapacity, 20793);
  assert.equal(comparisons.offense[0]?.standingsIndex, 0);
  assert.equal(comparisons.payroll[1]?.standingsIndex, 1);
});

test("league comparison snapshot fetches tolerate per-team failures without dropping rows", async () => {
  const standings = [
    {
      index: 0,
      teams: [
        {
          losses: 4,
          pointMargin: 30,
          teamId: "team-1",
          teamName: "Alpha",
          wins: 10,
        },
        {
          losses: 6,
          pointMargin: -12,
          teamId: "team-2",
          teamName: "Beta",
          wins: 8,
        },
      ],
    },
  ] as const;

  const snapshots = await workspaceTesting.fetchLeagueComparisonTeamSnapshots(
    {
      getArena: async (teamId?: string) => {
        if (teamId === "team-2") {
          throw new Error("arena unavailable");
        }
        return createArena();
      },
      getRoster: async () => ({
        players: [createRosterPlayer(50000)],
      }),
      getTeamStats: async (teamId?: string) => {
        if (teamId === "team-2") {
          throw new Error("teamstats unavailable");
        }
        return {
          categories: {},
          fields: {},
          season: 72,
        };
      },
    } as any,
    standings as any,
  );

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.incomplete, false);
  assert.equal(snapshots[1]?.incomplete, true);
  assert.equal(snapshots[1].teamId, "team-2");
  assert.equal(snapshots[1].teamStats, null);
  assert.equal(snapshots[1].arena, null);
  assert.equal(snapshots[1].rosterPlayers.length, 1);
});

function createArena(
  overrides: Partial<Record<"bleachers" | "courtside" | "lowerTier" | "luxury", number>> = {},
) {
  return {
    seats: {
      bleachers: { capacity: overrides.bleachers ?? 14000 },
      courtside: { capacity: overrides.courtside ?? 500 },
      lowerTier: { capacity: overrides.lowerTier ?? 4000 },
      luxury: { capacity: overrides.luxury ?? 50 },
    },
  } as any;
}

function createRosterPlayer(salary: number) {
  return {
    salary,
  } as any;
}

function createTeamSnapshot(
  overrides: Partial<Parameters<typeof comparisonTesting.buildLeagueComparisons>[0]["teamSnapshots"][number]> = {},
) {
  return {
    arena: createArena(),
    conferenceIndex: 0,
    incomplete: false,
    losses: 4,
    rosterPlayers: [createRosterPlayer(60000)],
    standingsIndex: 0,
    teamId: "team-1",
    teamName: "Visionaries",
    teamStats: {
      categories: {},
      fields: {},
      season: 72,
    },
    wins: 10,
    ...overrides,
  } as any;
}
