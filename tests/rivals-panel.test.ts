import assert from "node:assert/strict";
import test from "node:test";

import { __testing as rivalsPanelTesting } from "../app/rivals-panel";

type RivalryRow = Parameters<
  typeof rivalsPanelTesting.buildVisibleAggregate
>[0][number];

test("default season range spans the first and last available season", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.buildDefaultSeasonRange(["59", "60", "61"]),
    {
      endSeason: "61",
      startSeason: "59",
    },
  );
});

test("season range normalization falls back to the available bounds", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.normalizeSeasonRange(["59", "60", "61"], "", ""),
    {
      endSeason: "61",
      startSeason: "59",
    },
  );
});

test("toggleSelectedValue removes a value from the implicit all-selected state", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.toggleSelectedValue(
      null,
      "PLAYOFFS",
      ["LEAGUE_REGULAR_SEASON", "PLAYOFFS", "CUP"],
    ),
    ["LEAGUE_REGULAR_SEASON", "CUP"],
  );
});

test("toggleSelectedValue adds a missing value back into the explicit selection", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.toggleSelectedValue(
      ["LEAGUE_REGULAR_SEASON"],
      "CUP",
      ["LEAGUE_REGULAR_SEASON", "PLAYOFFS", "CUP"],
    ),
    ["LEAGUE_REGULAR_SEASON", "CUP"],
  );
});

test("season range self-corrects when the chosen start exceeds the end", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.updateSeasonRangeFromStart(
      ["59", "60", "61"],
      "61",
      "60",
    ),
    {
      endSeason: "61",
      startSeason: "61",
    },
  );
});

test("season range self-corrects when the chosen end precedes the start", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.updateSeasonRangeFromEnd(["59", "60", "61"], "61", "59"),
    {
      endSeason: "59",
      startSeason: "59",
    },
  );
});

test("buildVisibleAggregate sums visible rivalry rows and derives summary values", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.buildVisibleAggregate([
      createRivalryRow({
        averageMargin: 4,
        games: 3,
        homeLosses: 0,
        homeWins: 1,
        lastMatch: "2026-03-01T19:00:00Z",
        leagueLosses: 1,
        leagueWins: 1,
        losses: 1,
        opponentTeamId: "opp-1",
        opponentTeamName: "Beta",
        playoffLosses: 0,
        playoffWins: 1,
        roadLosses: 1,
        roadWins: 1,
        seasons: [70, 71],
        tvGames: 1,
        winPct: 2 / 3,
        wins: 2,
      }),
      createRivalryRow({
        averageMargin: -3,
        games: 2,
        homeLosses: 1,
        homeWins: 0,
        lastMatch: "2026-04-01T19:00:00Z",
        leagueLosses: 1,
        leagueWins: 0,
        losses: 1,
        opponentTeamId: "opp-2",
        opponentTeamName: "Gamma",
        playoffLosses: 0,
        playoffWins: 1,
        roadLosses: 0,
        roadWins: 1,
        seasons: [69, 71],
        tvGames: 2,
        winPct: 0.5,
        wins: 1,
      }),
    ]),
    {
      averageMargin: 1.2,
      games: 5,
      homeLosses: 1,
      homeWins: 1,
      lastMatch: "2026-04-01T19:00:00Z",
      leagueLosses: 2,
      leagueWins: 1,
      losses: 2,
      playoffLosses: 0,
      playoffWins: 2,
      roadLosses: 1,
      roadWins: 2,
      seasons: [69, 70, 71],
      tvGames: 3,
      winPct: 0.6,
      wins: 3,
    },
  );
});

test("buildVisibleAggregate returns null when no visible rows remain", () => {
  assert.equal(rivalsPanelTesting.buildVisibleAggregate([]), null);
});

function createRivalryRow(overrides: Partial<RivalryRow> = {}): RivalryRow {
  return {
    averageMargin: 0,
    currentStreak: "W1",
    games: 1,
    homeLosses: 0,
    homeWins: 0,
    lastMatch: null,
    leagueLosses: 0,
    leagueWins: 0,
    losses: 0,
    opponentTeamId: "opp-default",
    opponentTeamName: "Default",
    playoffLosses: 0,
    playoffWins: 0,
    roadLosses: 0,
    roadWins: 0,
    seasons: [],
    tvGames: 0,
    winPct: 0,
    wins: 0,
    ...overrides,
  };
}
