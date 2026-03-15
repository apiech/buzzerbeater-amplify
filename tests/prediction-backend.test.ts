import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePredictionRequest,
  resolveConnectedInput,
} from "../amplify/data/_backend/prediction";

const manualFallback = {
  home_outsideScoring: 8,
  home_insideScoring: 8,
  home_outsideDefense: 8,
  home_insideDefense: 8,
  home_rebounding: 8,
  home_offensiveFlow: 8,
  away_outsideScoring: 7,
  away_insideScoring: 7,
  away_outsideDefense: 7,
  away_insideDefense: 7,
  away_rebounding: 7,
  away_offensiveFlow: 7,
  home_offStrategy: "Base",
  home_defStrategy: "ManToMan",
  away_offStrategy: "Push",
  away_defStrategy: "23Zone",
  neutral: "0",
  effortDelta: 0,
  home_gdp_focus: "N/A",
  home_gdp_pace: "N/A",
  away_gdp_focus: "N/A",
  away_gdp_pace: "N/A",
};

function createMatchBoxscoreRecord(args: {
  matchId: string;
  teamId: string;
  opponentTeamId: string;
  offStrategy: string;
  defStrategy: string;
  teamRatings: Record<string, number>;
  opponentRatings: Record<string, number>;
}) {
  return {
    matchId: args.matchId,
    teamId: args.teamId,
    opponentTeamId: args.opponentTeamId,
    offStrategy: args.offStrategy,
    defStrategy: args.defStrategy,
    opponentOffStrategy: "Base",
    opponentDefStrategy: "ManToMan",
    teamRatingsJson: args.teamRatings,
    opponentRatingsJson: args.opponentRatings,
    boxscoreJson: {
      homeTeam: {
        id: args.teamId,
        gdp: {
          focus: "Balanced.hit",
          pace: "Normal.hit",
        },
      },
      awayTeam: {
        id: args.opponentTeamId,
        gdp: {
          focus: "Inside.miss",
          pace: "Slow.miss",
        },
      },
    },
  };
}

test("normalizePredictionRequest rejects unsupported modes", () => {
  assert.throws(
    () => normalizePredictionRequest({ mode: "mystery" }),
    /either MANUAL or CONNECTED/i,
  );
});

test("resolveConnectedInput prefers cached boxscores and merges direct overrides", async () => {
  const homeRecord = createMatchBoxscoreRecord({
    matchId: "home-1",
    teamId: "HOME",
    opponentTeamId: "AWAY",
    offStrategy: "Motion",
    defStrategy: "32Zone",
    teamRatings: {
      outsideScoring: 12.1,
      insideScoring: 10.4,
      outsideDefense: 11.5,
      insideDefense: 10.7,
      rebounding: 9.8,
      offensiveFlow: 11.1,
    },
    opponentRatings: {
      outsideScoring: 8.2,
      insideScoring: 8.3,
      outsideDefense: 7.9,
      insideDefense: 8.1,
      rebounding: 7.8,
      offensiveFlow: 8.4,
    },
  });
  const awayRecord = createMatchBoxscoreRecord({
    matchId: "away-1",
    teamId: "AWAY",
    opponentTeamId: "HOME",
    offStrategy: "Push",
    defStrategy: "23Zone",
    teamRatings: {
      outsideScoring: 10.2,
      insideScoring: 9.7,
      outsideDefense: 8.9,
      insideDefense: 9.4,
      rebounding: 8.8,
      offensiveFlow: 9.2,
    },
    opponentRatings: {
      outsideScoring: 7.1,
      insideScoring: 7.3,
      outsideDefense: 7.2,
      insideDefense: 7.4,
      rebounding: 7.5,
      offensiveFlow: 7.6,
    },
  });

  const resolved = await resolveConnectedInput(
    {},
    "user-1",
    {
      homeSourceMatchId: "home-1",
      awaySourceMatchId: "away-1",
      homeTeamId: "HOME",
      awayTeamId: "AWAY",
      neutral: "1",
      effortDelta: 1,
      manualFallback,
    },
    {
      getMatchBoxscore: async (_env, _userId, matchId) =>
        matchId === "home-1" ? homeRecord : awayRecord,
    },
  );

  assert.equal(resolved.home_outsideScoring, 12.1);
  assert.equal(resolved.home_offStrategy, "Motion");
  assert.equal(resolved.away_outsideScoring, 10.2);
  assert.equal(resolved.away_defStrategy, "23Zone");
  assert.equal(resolved.home_gdp_focus, "Balanced.hit");
  assert.equal(resolved.away_gdp_pace, "Normal.hit");
  assert.equal(resolved.neutral, "1");
  assert.equal(resolved.effortDelta, 1);
});

test("resolveConnectedInput falls back to manual values when cache misses occur", async () => {
  const resolved = await resolveConnectedInput(
    {},
    "user-1",
    {
      homeSourceMatchId: "missing-home",
      awaySourceMatchId: "missing-away",
      manualFallback,
    },
    {
      getMatchBoxscore: async () => null,
    },
  );

  assert.deepStrictEqual(resolved, manualFallback);
});

test("resolveConnectedInput still fails without any usable source data", async () => {
  await assert.rejects(
    () =>
      resolveConnectedInput(
        {},
        "user-1",
        {
          homeSourceMatchId: "missing-home",
        },
        {
          getMatchBoxscore: async () => null,
        },
      ),
    /unavailable in cache/i,
  );
});
