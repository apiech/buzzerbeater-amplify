import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testing as leaguePanelTesting } from "../app/league-panel";

const currentDir = dirname(fileURLToPath(import.meta.url));

test("league panel helpers flatten standings in conference order", () => {
  const rows = leaguePanelTesting.flattenLeagueStandings({
    comparisons: null,
    freshnessMessage: null,
    freshnessStatus: "FRESH",
    league: {
      id: "league-1",
      name: "NBBA",
    },
    season: 72,
    standings: [
      {
        index: 0,
        teams: [
          {
            losses: 4,
            pointMargin: 30,
            teamId: "alpha",
            teamName: "Alpha",
            wins: 10,
          },
        ],
      },
      {
        index: 1,
        teams: [
          {
            losses: 6,
            pointMargin: -8,
            teamId: "beta",
            teamName: "Beta",
            wins: 8,
          },
        ],
      },
    ],
  } as any);

  assert.deepStrictEqual(
    rows.map((row) => [row.teamId, row.standingsIndex]),
    [
      ["alpha", 0],
      ["beta", 1],
    ],
  );
});

test("league panel helper copy stays user-facing for incomplete comparisons", () => {
  assert.equal(
    leaguePanelTesting.describeLeagueComparisonState(0),
    "All league comparison rows are ready.",
  );
  assert.match(
    leaguePanelTesting.describeLeagueComparisonState(2),
    /2 teams could not be fully refreshed/i,
  );
});

test("league panel helper highlights only the connected team row", () => {
  assert.equal(
    leaguePanelTesting.isCurrentLeagueTeamRow("team-1", "team-1"),
    true,
  );
  assert.equal(
    leaguePanelTesting.isCurrentLeagueTeamRow("team-2", "team-1"),
    false,
  );
});

test("league panel can carry an explicit unavailable freshness state", () => {
  const unavailableLeague = {
    comparisons: null,
    freshnessMessage:
      "Live league standings are unavailable right now. League tables and projections stay hidden until a fresh refresh succeeds.",
    freshnessStatus: "UNAVAILABLE",
    league: {
      id: "league-1",
      name: "NBBA",
    },
    season: 72,
    standings: [],
  } as any;

  assert.equal(unavailableLeague.freshnessStatus, "UNAVAILABLE");
  assert.equal(unavailableLeague.season, 72);
  assert.match(
    leaguePanelTesting.describeUnavailableLeagueState(
      unavailableLeague.freshnessMessage,
    ),
    /retry automatically/i,
  );
  assert.equal(
    leaguePanelTesting.describeUnavailableLeagueState(
      "Live league standings did not match the current season.",
    ),
    "Live league standings did not match the current season.",
  );
});

test("league panel projection helpers keep selection copy and finish odds readable", () => {
  assert.equal(
    leaguePanelTesting.describeProjectionSelectionStrategy(
      "CURRENT_SEASON_15TH_PERCENTILE",
    ),
    "Current-season 15th percentile snapshot",
  );
  assert.match(
    leaguePanelTesting.describeProjectionProgress({
      completedPhases: [],
      completedUnits: 4,
      currentPhaseStartedAt: "2026-05-01T00:00:00.000Z",
      phaseCount: 7,
      phaseIndex: 2,
      phaseKey: "COLLECTING_SNAPSHOTS",
      summary: "Collecting historical team snapshots.",
      totalUnits: 12,
      unitLabel: "teams",
      updatedAt: "2026-05-01T00:00:05.000Z",
    } as any),
    /4 of 12 teams/i,
  );
  assert.equal(
    leaguePanelTesting.formatFinishDistribution([
      { place: 1, probability: 0.42 },
      { place: 2, probability: 0.31 },
      { place: 3, probability: 0.009 },
    ]),
    "1: 42% · 2: 31%",
  );
});

test("league panel renders all five tabs, row highlighting, and scrollable tables", () => {
  const source = readFileSync(
    join(currentDir, "..", "app", "league-panel.tsx"),
    "utf8",
  );

  assert.match(source, /label: "Standings"/);
  assert.match(source, /label: "Projection"/);
  assert.match(source, /label: "Offense"/);
  assert.match(source, /label: "Defense"/);
  assert.match(source, /label: "Payroll"/);
  assert.match(source, /label: "Arena"/);
  assert.match(source, /bg-accent\/10/);
  assert.match(source, /TableShell/);
  assert.match(source, /could not be fully refreshed, so some comparison cells are blank/i);
  assert.match(
    source,
    /This section refreshes itself when live standings are missing/i,
  );
  assert.match(source, /Refreshing live league standings now/);
  assert.match(source, /describeUnavailableLeagueState/);
  assert.match(source, /isRefreshingLeague/);
  assert.match(source, /isFreshLeague && comparisons\?\.incompleteTeamCount/);
  assert.match(source, /Current-season 15th percentile snapshot/);
  assert.match(source, /Canonical standings rank teams by expected wins/i);
  assert.match(source, /Wins range/);
  assert.match(source, /Source tactics:/);
  assert.match(source, /Minimax tactics/);
  assert.match(source, /Remaining game probabilities/);
});
