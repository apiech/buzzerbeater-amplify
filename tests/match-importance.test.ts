import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompetitiveRecentSample,
  isScrimmageLike,
  isStrategicDeemphasisLoss,
} from "../amplify/data/_backend/match-importance";

const TEAM_ID = "OUR";

test("friendly and scrimmage matches are excluded from the competitive sample", () => {
  const leagueMatch = createMatch("league-1", {
    startTime: "2026-03-05T19:00:00Z",
    teamScore: 91,
    opponentScore: 84,
    type: "league.rs",
  });
  const friendlyMatch = createMatch("friendly-1", {
    startTime: "2026-03-06T19:00:00Z",
    teamScore: 86,
    opponentScore: 82,
    type: "friendly",
  });
  const scrimmageMatch = createMatch("scrimmage-1", {
    startTime: "2026-03-07T19:00:00Z",
    teamScore: 95,
    opponentScore: 79,
    type: "scrimmage.tv",
  });

  const sample = buildCompetitiveRecentSample({
    matches: [leagueMatch, friendlyMatch, scrimmageMatch],
    boxScores: [
      createBoxScore("league-1"),
      createBoxScore("friendly-1"),
      createBoxScore("scrimmage-1"),
    ],
    teamId: TEAM_ID,
    rawLookback: 12,
    maxIncludedGames: 5,
  });

  assert.deepStrictEqual(
    sample.includedGames.map((game) => game.match.id),
    ["league-1"],
  );
  assert.deepStrictEqual(
    sample.excludedGames.map((game) => [game.match.id, game.reason]),
    [
      ["scrimmage-1", "SCRIMMAGE_LIKE"],
      ["friendly-1", "SCRIMMAGE_LIKE"],
    ],
  );
  assert.equal(isScrimmageLike("friendly"), true);
  assert.equal(isScrimmageLike("scrimmage.tv"), true);
});

test("a minus twenty-one loss is excluded but minus twenty is retained", () => {
  const minusTwentyOne = createMatch("loss-21", {
    startTime: "2026-03-07T19:00:00Z",
    teamScore: 74,
    opponentScore: 95,
    type: "league.rs",
  });
  const minusTwenty = createMatch("loss-20", {
    startTime: "2026-03-06T19:00:00Z",
    teamScore: 75,
    opponentScore: 95,
    type: "league.rs",
  });

  const sample = buildCompetitiveRecentSample({
    matches: [minusTwentyOne, minusTwenty],
    boxScores: [createBoxScore("loss-21"), createBoxScore("loss-20")],
    teamId: TEAM_ID,
    rawLookback: 12,
    maxIncludedGames: 5,
  });

  assert.equal(isStrategicDeemphasisLoss(minusTwentyOne, TEAM_ID), true);
  assert.equal(isStrategicDeemphasisLoss(minusTwenty, TEAM_ID), false);
  assert.deepStrictEqual(
    sample.includedGames.map((game) => game.match.id),
    ["loss-20"],
  );
  assert.deepStrictEqual(
    sample.excludedGames.map((game) => [game.match.id, game.reason]),
    [["loss-21", "STRATEGIC_DEEMPHASIS_LOSS"]],
  );
});

test("competitive sample takes the first five qualifying games from the raw lookback", () => {
  const matches = Array.from({ length: 12 }, (_, index) =>
    createMatch(`game-${index + 1}`, {
      startTime: `2026-03-${String(20 - index).padStart(2, "0")}T19:00:00Z`,
      teamScore: 90 + index,
      opponentScore: 80,
      type: "league.rs",
    }),
  );

  const sample = buildCompetitiveRecentSample({
    matches,
    boxScores: matches.map((match) => createBoxScore(match.id)),
    teamId: TEAM_ID,
    rawLookback: 12,
    maxIncludedGames: 5,
  });

  assert.deepStrictEqual(
    sample.includedGames.map((game) => game.match.id),
    ["game-1", "game-2", "game-3", "game-4", "game-5"],
  );
  assert.equal(sample.rawMatchesConsidered, 12);
  assert.equal(sample.excludedGames.length, 0);
});

test("competitive games without box scores are excluded with a missing-boxscore reason", () => {
  const matches = [
    createMatch("have-box", {
      startTime: "2026-03-07T19:00:00Z",
      teamScore: 88,
      opponentScore: 80,
      type: "league.rs",
    }),
    createMatch("missing-box", {
      startTime: "2026-03-06T19:00:00Z",
      teamScore: 90,
      opponentScore: 89,
      type: "cup.round1",
    }),
  ];

  const sample = buildCompetitiveRecentSample({
    matches,
    boxScores: [createBoxScore("have-box")],
    teamId: TEAM_ID,
    rawLookback: 12,
    maxIncludedGames: 5,
  });

  assert.deepStrictEqual(
    sample.includedGames.map((game) => game.match.id),
    ["have-box"],
  );
  assert.deepStrictEqual(
    sample.excludedGames.map((game) => [game.match.id, game.reason]),
    [["missing-box", "MISSING_BOXSCORE"]],
  );
});

function createMatch(
  matchId: string,
  overrides: Partial<{
    opponentScore: number;
    startTime: string;
    teamScore: number;
    type: string;
  }> = {},
) {
  return {
    id: matchId,
    startTime: overrides.startTime ?? "2026-03-01T19:00:00Z",
    type: overrides.type ?? "league.rs",
    awayTeam: {
      id: "OPP",
      teamName: "Opponent",
      score: overrides.opponentScore ?? 82,
    },
    homeTeam: {
      id: TEAM_ID,
      teamName: "Visionaries",
      score: overrides.teamScore ?? 90,
    },
  } as const;
}

function createBoxScore(matchId: string) {
  return {
    version: "1",
    retrievedAt: "2026-03-15T00:00:00Z",
    matchId,
    type: "league.rs",
    startTime: "2026-03-01T19:00:00Z",
    endTime: "2026-03-01T21:00:00Z",
    neutral: false,
    effortDelta: 0,
    attendance: {},
    awayTeam: {
      id: "OPP",
      teamName: "Opponent",
      shortName: "OPP",
      offStrategy: "Motion",
      defStrategy: "Man to man",
      score: 82,
      partialScores: [20, 20, 20, 22],
      teamTotals: {},
      ratings: null,
      efficiency: {},
      gdp: {},
      players: [],
      details: {},
    },
    homeTeam: {
      id: TEAM_ID,
      teamName: "Visionaries",
      shortName: "VIS",
      offStrategy: "Motion",
      defStrategy: "Man to man",
      score: 90,
      partialScores: [23, 22, 21, 24],
      teamTotals: {},
      ratings: null,
      efficiency: {},
      gdp: {},
      players: [],
      details: {},
    },
    details: {},
  } as const;
}
