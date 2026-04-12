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

test("boxscore helper tolerates missing player performance arrays", () => {
  assert.equal(
    boxscorePageTesting.readPlayerStat(
      {
        fullName: "Legacy Cache Guard",
      } as any,
      "pts",
    ),
    "N/A",
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

test("next-game recommendation polling stops after terminal statuses", () => {
  assert.equal(
    dashboardTesting.isNextGameRecommendationTerminalStatus("SUCCEEDED"),
    true,
  );
  assert.equal(
    dashboardTesting.isNextGameRecommendationTerminalStatus("FAILED"),
    true,
  );
  assert.equal(
    dashboardTesting.isNextGameRecommendationTerminalStatus(
      "EVALUATING_CANDIDATES",
    ),
    false,
  );
});

test("next-game recommendation blocked reasons prioritize next-opponent visibility and forecast readiness", () => {
  assert.equal(
    dashboardTesting.resolveNextGameRecommendationBlockedReason({
      isScoutViewingNextOpponent: false,
      isLoadingOpponentForecast: false,
      nextGameRecommendationError: null,
      nextMatch: {
        matchId: "m-1",
        opponentTeamId: "opp-1",
        opponentTeamName: "Rivals",
        startTime: "2026-04-09T00:00:00.000Z",
        type: "League",
        isHome: true,
      },
      opponentForecast: null,
    }),
    "Open Scout on your actual scheduled next opponent to use this recommendation tool.",
  );

  assert.equal(
    dashboardTesting.resolveNextGameRecommendationBlockedReason({
      isScoutViewingNextOpponent: true,
      isLoadingOpponentForecast: false,
      nextGameRecommendationError: null,
      nextMatch: {
        matchId: "m-1",
        opponentTeamId: "opp-1",
        opponentTeamName: "Rivals",
        startTime: "2026-04-09T00:00:00.000Z",
        type: "League",
        isHome: true,
      },
      opponentForecast: null,
    }),
    "Generate a successful opponent forecast for this next opponent before requesting recommendations.",
  );
});

test("forecast context can still resolve from scout summary when schedule data is absent", () => {
  assert.equal(
    dashboardTesting.resolveForecastTeamId({
      requestedTeamId: "opp-1",
      schedule: null,
      summary: {
        matchupPerspective: {
          opponentTeamId: "opp-1",
        },
        teamName: "Rivals",
      },
      teamId: "opp-1",
    } as any),
    "opp-1",
  );
});

test("live-match scout rollover messaging only appears for the default next-scout target", () => {
  assert.equal(
    dashboardTesting.resolveScoutEventWindowMessage({
      nextMatch: {
        matchId: "live-match",
        opponentTeamId: "live-opp",
        opponentTeamName: "Live Opponent",
        startTime: "2026-04-11T19:00:00.000Z",
        type: "League",
        isHome: true,
      },
      nextScoutMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      selectedScoutTeamId: null,
    }),
    "A live BuzzerBeater match is in progress, so this view is showing Next Opponent as your next scheduled opponent until the current game window ends.",
  );

  assert.equal(
    dashboardTesting.resolveScoutEventWindowMessage({
      nextMatch: {
        matchId: "live-match",
        opponentTeamId: "live-opp",
        opponentTeamName: "Live Opponent",
        startTime: "2026-04-11T19:00:00.000Z",
        type: "League",
        isHome: true,
      },
      nextScoutMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      selectedScoutTeamId: "manual-opp",
    }),
    null,
  );

  assert.equal(
    dashboardTesting.resolveScoutEventWindowMessage({
      nextMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      nextScoutMatch: {
        matchId: "next-match",
        opponentTeamId: "next-opp",
        opponentTeamName: "Next Opponent",
        startTime: "2026-04-14T19:00:00.000Z",
        type: "League",
        isHome: false,
      },
      selectedScoutTeamId: null,
    }),
    null,
  );
});

test("scout team changes clear dependent filters exactly once while same-team opens refetch", () => {
  assert.deepStrictEqual(
    dashboardTesting.resolveScoutTeamSelectionAction({
      nextTeamId: "opp-2",
      resolvedTeamId: "opp-1",
      urlTeamId: "opp-1",
    }),
    {
      kind: "update-url",
      nextState: {
        scoutSeason: null,
        scoutTeam: "opp-2",
        scoutTypes: null,
      },
    },
  );

  assert.deepStrictEqual(
    dashboardTesting.resolveScoutTeamSelectionAction({
      nextTeamId: "opp-1",
      resolvedTeamId: "opp-1",
      urlTeamId: "opp-1",
    }),
    {
      kind: "refetch",
    },
  );
});

test("same scout filters refetch while changed filters update the URL state", () => {
  assert.deepStrictEqual(
    dashboardTesting.resolveScoutFilterApplyAction({
      currentCompetitionKeys: ["LEAGUE", "TV"],
      currentSeason: 71,
      nextCompetitionKeys: ["TV", "LEAGUE"],
      nextSeason: 71,
    }),
    {
      kind: "refetch",
    },
  );

  assert.deepStrictEqual(
    dashboardTesting.resolveScoutFilterApplyAction({
      currentCompetitionKeys: ["LEAGUE"],
      currentSeason: 71,
      nextCompetitionKeys: ["LEAGUE", "PLAYOFFS"],
      nextSeason: 70,
    }),
    {
      kind: "update-url",
      nextState: {
        scoutSeason: 70,
        scoutTypes: ["LEAGUE", "PLAYOFFS"],
      },
    },
  );
});

test("scout schedule status copy distinguishes stale-snapshot fallback from missing schedule fallback", () => {
  assert.equal(
    dashboardTesting.resolveScoutScheduleStatusMessage({
      hasSchedule: true,
      hasSummary: true,
      scheduleError: "execution timed out",
    }),
    "The opponent summary stayed loaded, but the season schedule could not be refreshed. Showing the last successful schedule snapshot.",
  );

  assert.equal(
    dashboardTesting.resolveScoutScheduleEmptyStateMessage({
      hasSummary: true,
      scoutMessage: null,
      scheduleError: "execution timed out",
    }),
    "The season schedule is unavailable right now. Try Apply again or reopen the team view.",
  );

  assert.equal(
    dashboardTesting.resolveScoutScheduleEmptyStateMessage({
      hasSummary: true,
      scoutMessage:
        "A live BuzzerBeater match is in progress, so this page is showing the last ready scout snapshot for your next opponent until the game window ends.",
      scheduleError: null,
    }),
    "A live BuzzerBeater match is in progress, so this page is showing the last ready scout snapshot for your next opponent until the game window ends.",
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
