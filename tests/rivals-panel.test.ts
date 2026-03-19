import assert from "node:assert/strict";
import test from "node:test";

import { __testing as rivalsPanelTesting } from "../app/rivals-panel";
import type { RivalsWorkspacePayload } from "../app/types";

type RivalryMatchRecord = RivalsWorkspacePayload["matches"][number];

test("competition checkbox filters support all games except scrimmages", () => {
  const matches = [
    createMatch({
      competitionKey: "LEAGUE_REGULAR_SEASON",
      matchId: "league-1",
    }),
    createMatch({
      competitionKey: "PLAYOFFS",
      matchId: "playoff-1",
    }),
    createMatch({
      competitionKey: "SCRIMMAGE",
      matchId: "scrimmage-1",
    }),
  ];

  const filtered = rivalsPanelTesting.filterRivalryMatches(matches, {
    endSeason: "61",
    selectedCompetitions: ["LEAGUE_REGULAR_SEASON", "PLAYOFFS"],
    selectedOutcomes: ["WIN", "LOSS"],
    selectedTvScopes: ["TV", "NON_TV"],
    selectedVenues: ["HOME", "ROAD"],
    startSeason: "61",
  });

  assert.deepStrictEqual(
    filtered.map((match) => match.matchId),
    ["league-1", "playoff-1"],
  );
});

test("competition checkbox filters support league and playoff only selections", () => {
  const matches = [
    createMatch({
      competitionKey: "LEAGUE_REGULAR_SEASON",
      matchId: "league-1",
    }),
    createMatch({
      competitionKey: "PLAYOFFS",
      matchId: "playoff-1",
    }),
    createMatch({
      competitionKey: "CUP",
      matchId: "cup-1",
    }),
  ];

  const filtered = rivalsPanelTesting.filterRivalryMatches(matches, {
    endSeason: "61",
    selectedCompetitions: ["LEAGUE_REGULAR_SEASON", "PLAYOFFS"],
    selectedOutcomes: ["WIN", "LOSS"],
    selectedTvScopes: ["TV", "NON_TV"],
    selectedVenues: ["HOME", "ROAD"],
    startSeason: "61",
  });

  assert.deepStrictEqual(
    filtered.map((match) => match.competitionKey),
    ["LEAGUE_REGULAR_SEASON", "PLAYOFFS"],
  );
});

test("season range filtering is inclusive", () => {
  const matches = [
    createMatch({ matchId: "s59", season: 59 }),
    createMatch({ matchId: "s60", season: 60 }),
    createMatch({ matchId: "s61", season: 61 }),
  ];

  const filtered = rivalsPanelTesting.filterRivalryMatches(matches, {
    endSeason: "60",
    selectedCompetitions: ["LEAGUE_REGULAR_SEASON"],
    selectedOutcomes: ["WIN", "LOSS"],
    selectedTvScopes: ["TV", "NON_TV"],
    selectedVenues: ["HOME", "ROAD"],
    startSeason: "60",
  });

  assert.deepStrictEqual(
    filtered.map((match) => match.matchId),
    ["s60"],
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

function createMatch(
  overrides: Partial<RivalryMatchRecord> = {},
): RivalryMatchRecord {
  return {
    competitionKey: "LEAGUE_REGULAR_SEASON",
    competitionLabel: "League regular season",
    gameDate: "2026-03-01",
    isHome: true,
    isTvGame: false,
    margin: 5,
    matchId: "match-1",
    opponentScore: 85,
    opponentTeamId: "OPP",
    opponentTeamName: "Opponent",
    outcome: "WIN",
    rawType: "league.rs",
    season: 61,
    stageKey: "REGULAR_SEASON",
    stageLabel: "Regular season",
    startTime: "2026-03-01T19:00:00Z",
    teamScore: 90,
    venue: "HOME",
    ...overrides,
  };
}
