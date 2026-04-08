import assert from "node:assert/strict";
import test from "node:test";

import { __testing as dashboardTesting } from "../app/dashboard-app";
import { __testing as boxscorePageTesting } from "../app/workspace/boxscores/[matchId]/boxscore-page-client";

test("readPayload parses JSON string payloads from workspace handlers", () => {
  const payload = dashboardTesting.readPayload<{ team: { teamName: string } }>({
    payload: JSON.stringify({
      team: {
        teamName: "Visionaries",
      },
    }),
  } as any);

  assert.deepStrictEqual(payload, {
    team: {
      teamName: "Visionaries",
    },
  });
});

test("readPayload preserves object payloads returned by generated clients", () => {
  const payload = dashboardTesting.readPayload<{ summary: { wins: number } }>({
    payload: {
      summary: {
        wins: 10,
      },
    },
  } as any);

  assert.deepStrictEqual(payload, {
    summary: {
      wins: 10,
    },
  });
});

test("formatPlayerMeta surfaces recent starts before minutes or scoring", () => {
  assert.equal(
    dashboardTesting.formatPlayerMeta({
      fullName: "Wing Stopper",
      bestPosition: "SF",
      salary: 150000,
      ppg: 7.4,
      recentStartCount: 4,
      recentAvgMinutes: 31.4,
    } as any),
    "SF • $150,000 • 4 GS • 31.4 MPG",
  );
  assert.equal(
    dashboardTesting.formatPlayerMeta({
      fullName: "Bench Gunner",
      bestPosition: "SG",
      salary: 60000,
      ppg: 13.2,
      recentStartCount: null,
      recentAvgMinutes: null,
    } as any),
    "SG • $60,000 • 13.2 PPG",
  );
});

test("sortLineupHelperRoster orders numeric owner-roster columns descending", () => {
  const roster = [
    createRosterPlayer("zeta", {
      dmi: 120000,
      skills: { js: 9 },
    }),
    createRosterPlayer("alpha", {
      dmi: 250000,
      skills: { js: 14 },
    }),
    createRosterPlayer("beta", {
      dmi: 250000,
      skills: { js: 11 },
    }),
  ];

  assert.deepStrictEqual(
    dashboardTesting
      .sortLineupHelperRoster(roster as any, "dmi", "desc")
      .map((player) => player.fullName),
    ["alpha", "beta", "zeta"],
  );
  assert.deepStrictEqual(
    dashboardTesting
      .sortLineupHelperRoster(roster as any, "js", "desc")
      .map((player) => player.fullName),
    ["alpha", "beta", "zeta"],
  );
});

test("sortLineupHelperRoster keeps unavailable skill rows below players with owner snapshots", () => {
  const roster = [
    createRosterPlayer("available", {
      available: true,
      skills: { rb: 10 },
    }),
    createRosterPlayer("missing", {
      available: false,
      skills: { rb: 99 },
    }),
  ];

  assert.deepStrictEqual(
    dashboardTesting
      .sortLineupHelperRoster(roster as any, "rb", "desc")
      .map((player) => player.fullName),
    ["available", "missing"],
  );
});

test("boxscore helper scoreline and player sorting favor starters first", () => {
  assert.equal(
    boxscorePageTesting.buildScoreline({
      homeTeam: {
        teamName: "Visionaries",
        score: 99,
      },
      awayTeam: {
        teamName: "Rivals",
        score: 91,
      },
    } as any),
    "Visionaries 99 - 91 Rivals",
  );

  assert.deepStrictEqual(
    boxscorePageTesting
      .sortBoxscorePlayers([
        createBoxscorePlayer("Bench Burst", 29, false),
        createBoxscorePlayer("Starter Short", 18, true),
        createBoxscorePlayer("Starter Heavy", 34, true),
      ] as any)
      .map((player) => player.fullName),
    ["Starter Heavy", "Starter Short", "Bench Burst"],
  );
});

test("opponent forecast polling stops after terminal statuses", () => {
  assert.equal(
    dashboardTesting.isOpponentForecastTerminalStatus("SUCCEEDED"),
    true,
  );
  assert.equal(
    dashboardTesting.isOpponentForecastTerminalStatus("FAILED"),
    true,
  );
  assert.equal(
    dashboardTesting.isOpponentForecastTerminalStatus("INVOKING_MODEL"),
    false,
  );
});

function createRosterPlayer(
  name: string,
  overrides: Partial<{
    available: boolean;
    dmi: number | null;
    skills: Partial<Record<string, number>>;
  }> = {},
) {
  return {
    playerId: name,
    fullName: name,
    available: overrides.available ?? true,
    bestPosition: "SF",
    age: 27,
    salary: 100000,
    gameShape: "strong",
    dmi: overrides.dmi ?? 100000,
    skills: {
      js: 10,
      jr: 10,
      od: 10,
      ha: 10,
      dr: 10,
      pa: 10,
      is: 10,
      id: 10,
      rb: 10,
      sb: 10,
      st: 10,
      ft: 10,
      ex: 10,
      gs: 10,
      ...overrides.skills,
    },
  };
}

function createBoxscorePlayer(
  fullName: string,
  minutes: number,
  isStarter: boolean,
) {
  return {
    playerId: fullName,
    fullName,
    minutes,
    isStarter,
    performance: [],
  };
}
