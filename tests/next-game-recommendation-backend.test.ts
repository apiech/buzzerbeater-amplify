import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as recommendationTesting,
} from "../amplify/data/_backend/next-game-recommendation";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

test("normalizeRecommendationInput defaults enthusiasm and validates switch mappings", () => {
  assert.deepStrictEqual(
    recommendationTesting.normalizeRecommendationInput({
      defensiveSwitch: {
        c: "c",
        pf: "pf",
        pg: "pg",
        sf: "sf",
        sg: "sg",
      },
    }),
    {
      enthusiasm: 8,
      defensiveSwitch: {
        pg: "PG",
        sg: "SG",
        sf: "SF",
        pf: "PF",
        c: "C",
      },
    },
  );

  assert.throws(
    () =>
      recommendationTesting.normalizeRecommendationInput({
        enthusiasm: 11,
        defensiveSwitch: {
          pg: "PG",
          sg: "PG",
          sf: "SF",
          pf: "PF",
          c: "C",
        },
      }),
    /one-to-one mapping/i,
  );
});

test("effortChoiceToOrdinal maps take-it-easy, normal, and crunch-time labels", () => {
  assert.equal(recommendationTesting.effortChoiceToOrdinal("Take It Easy"), -1);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("TIE"), -1);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("Normal"), 0);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("CT"), 1);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("Crunch Time"), 1);
});

test("buildPredictorPerspective flips home-away orientation for away games", () => {
  const perspective = recommendationTesting.buildPredictorPerspective({
    opponentDefense: "ManToMan",
    opponentEffort: 1,
    opponentOffense: "Motion",
    opponentRatings: {
      outsideScoring: 6,
      insideScoring: 7,
      outsideDefense: 8,
      insideDefense: 9,
      rebounding: 10,
      offensiveFlow: 11,
    },
    ourDefense: "23Zone",
    ourEffort: -1,
    ourIsHome: false,
    ourOffense: "Base",
    ourRatings: {
      outsideScoring: 1,
      insideScoring: 2,
      outsideDefense: 3,
      insideDefense: 4,
      rebounding: 5,
      offensiveFlow: 6,
    },
  });

  assert.equal(perspective.teamIsHome, false);
  assert.equal(perspective.payload.home_offStrategy, "Motion");
  assert.equal(perspective.payload.away_offStrategy, "Base");
  assert.equal(perspective.payload.effortDelta, 2);
  assert.equal(perspective.payload.home_outsideScoring, 6);
  assert.equal(perspective.payload.away_outsideScoring, 1);
});

test("adaptPredictionResultToUserPerspective flips away-game margin and scores", () => {
  assert.deepStrictEqual(
    recommendationTesting.adaptPredictionResultToUserPerspective(
      {
        awayScore: 91.2,
        homeScore: 101.4,
        pointDiff: 10.2,
      },
      false,
    ),
    {
      predictedOpponentScore: 101.4,
      predictedPointDiff: -10.2,
      predictedTeamScore: 91.2,
    },
  );
});

test("candidate selection prefers biggest win and efficient 10-point win", () => {
  const candidates = [
    createCandidate("Base Offense", "Man to man", "Normal", 12.2, 108, 95, 1),
    createCandidate("Motion", "2-3 Zone", "Take It Easy", 10.1, 102, 91.9, 0),
    createCandidate("Run and Gun", "Full Court Press", "Crunch Time", 15.4, 111, 95.6, 2),
  ];

  assert.equal(
    recommendationTesting.selectBiggestWinCandidate(candidates)?.offense,
    "Run and Gun",
  );
  assert.equal(
    recommendationTesting.selectEfficientWinCandidate(candidates)?.offense,
    "Motion",
  );
});

test("efficient selection falls back to smallest positive win, then least-bad margin", () => {
  const noTenPointWin = [
    createCandidate("Base Offense", "Man to man", "Normal", 8.9, 101, 92.1, 1),
    createCandidate("Motion", "2-3 Zone", "Take It Easy", 3.2, 96.5, 93.3, 0),
  ];
  assert.equal(
    recommendationTesting.selectEfficientWinCandidate(noTenPointWin)?.offense,
    "Motion",
  );

  const noPositiveWin = [
    createCandidate("Base Offense", "Man to man", "Normal", -6.4, 90, 96.4, 1),
    createCandidate("Motion", "2-3 Zone", "Take It Easy", -2.1, 91.4, 93.5, 0),
  ];
  assert.equal(
    recommendationTesting.selectEfficientWinCandidate(noPositiveWin)?.offense,
    "Motion",
  );
});

test("jobMatchesRecommendationSettings and stale detection use exact persisted settings", () => {
  assert.equal(
    recommendationTesting.jobMatchesRecommendationSettings(
      {
        enthusiasm: 8,
        matchId: "m-1",
        opponentTeamId: "opp-1",
        switchC: "C",
        switchPf: "PF",
        switchPg: "PG",
        switchSf: "SF",
        switchSg: "SG",
      },
      {
        enthusiasm: 8,
        matchId: "m-1",
        opponentTeamId: "opp-1",
        defensiveSwitch: {
          pg: "PG",
          sg: "SG",
          sf: "SF",
          pf: "PF",
          c: "C",
        },
      },
    ),
    true,
  );
  assert.equal(
    recommendationTesting.computeRecommendationStale("forecast-1", "forecast-2"),
    true,
  );
  assert.equal(
    recommendationTesting.computeRecommendationStale("forecast-2", "forecast-2"),
    false,
  );
});

function createCandidate(
  offense: string,
  defense: string,
  effortChoice: string,
  predictedPointDiff: number,
  predictedTeamScore: number,
  predictedOpponentScore: number,
  effortCost: number,
) {
  return {
    offense,
    defense,
    effortChoice,
    effortCost,
    effortValue: effortCost - 1,
    lineup: [
      {
        playerId: "p1",
        fullName: "Lead Guard",
        position: "PG",
        minutes: 36,
      },
    ],
    predictedPointDiff,
    predictedTeamScore,
    predictedOpponentScore,
  };
}
