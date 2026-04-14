import assert from "node:assert/strict";
import test from "node:test";

import {
  inflateStoredMatchBoxscore,
  readStoredMatchBoxscoreDetails,
} from "../amplify/data/_backend/stored-boxscore";

test("readStoredMatchBoxscoreDetails normalizes partially stored payloads", () => {
  const payload = readStoredMatchBoxscoreDetails(
    {
      matchId: "m-stored",
      source: "",
      homeTeam: {
        teamId: "T1",
        teamName: "Home",
        teamTotals: {
          fg: "40",
        },
        efficiency: {
          pp100: "101.2",
        },
        players: [
          {
            playerId: "p1",
            fullName: "Home Guard",
            isStarter: null,
            performance: null,
            minutesByPosition: {
              PG: "24",
            },
          },
        ],
      },
      awayTeam: {
        teamId: "T2",
        teamName: "Away",
        players: [],
      },
    },
    "MATCH_BOXSCORE_CACHE",
  );

  if (!payload?.homeTeam) {
    assert.fail("Expected a normalized home team.");
  }
  const homePlayer = payload.homeTeam.players[0];
  if (!homePlayer) {
    assert.fail("Expected a normalized player line.");
  }
  assert.equal(payload.source, "MATCH_BOXSCORE_CACHE");
  assert.deepStrictEqual(payload.homeTeam.teamTotals, [
    { key: "fg", numberValue: 40 },
  ]);
  assert.deepStrictEqual(payload.homeTeam.efficiency, [
    { key: "pp100", numberValue: 101.2 },
  ]);
  assert.equal(homePlayer.isStarter, false);
  assert.deepStrictEqual(homePlayer.performance, []);
  assert.deepStrictEqual(homePlayer.minutesByPosition, [
    { key: "PG", numberValue: 24 },
  ]);
});

test("inflateStoredMatchBoxscore safely inflates malformed stored payloads", () => {
  const inflated = inflateStoredMatchBoxscore({
    matchId: "m-stored",
    source: "MATCH_BOXSCORE_CACHE",
    homeTeam: {
      teamId: "T1",
      teamName: "Home",
      teamTotals: {
        fg: "40",
      },
      players: [
        {
          playerId: "p1",
          fullName: "Home Guard",
          isStarter: null,
          performance: {
            points: "12",
          },
          minutesByPosition: {
            PG: "24",
          },
        },
      ],
    },
    awayTeam: {
      teamId: "T2",
      teamName: "Away",
      players: [],
    },
  });

  if (!inflated?.homeTeam || Array.isArray(inflated.homeTeam)) {
    assert.fail("Expected an inflated home team object.");
  }
  const homePlayer = Array.isArray(inflated.homeTeam.players)
    ? inflated.homeTeam.players[0]
    : null;
  if (!homePlayer || Array.isArray(homePlayer)) {
    assert.fail("Expected an inflated player object.");
  }
  assert.deepStrictEqual(inflated.homeTeam.teamTotals, {
    fg: 40,
  });
  assert.equal(homePlayer.isStarter, false);
  assert.deepStrictEqual(homePlayer.performanceStats, {
    points: 12,
  });
  assert.deepStrictEqual(homePlayer.minutesByPosition, {
    PG: 24,
  });
});

test("stored boxscore helpers preserve attendance payloads", () => {
  const payload = readStoredMatchBoxscoreDetails(
    {
      matchId: "m-attendance",
      source: "MATCH_BOXSCORE_CACHE",
      attendance: {
        bleachers: "8000",
        lowerTier: "2500",
        courtside: "400",
        luxury: "32",
      },
      homeTeam: {
        teamId: "T1",
        teamName: "Home",
        players: [],
      },
      awayTeam: {
        teamId: "T2",
        teamName: "Away",
        players: [],
      },
    },
    "MATCH_BOXSCORE_CACHE",
  );
  const inflated = inflateStoredMatchBoxscore(payload);

  assert.deepStrictEqual(payload?.attendance, {
    bleachers: 8000,
    lowerTier: 2500,
    courtside: 400,
    luxury: 32,
  });
  assert.deepStrictEqual(inflated?.attendance, {
    bleachers: 8000,
    lowerTier: 2500,
    courtside: 400,
    luxury: 32,
  });
});
