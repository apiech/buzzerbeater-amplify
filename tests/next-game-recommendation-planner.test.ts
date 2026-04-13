import assert from "node:assert/strict";
import test from "node:test";

import { __testing as recommendationTesting } from "../amplify/data/_backend/next-game-recommendation";

function createCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    defense: "Man to man",
    effortChoice: "Normal",
    effortCost: 1,
    effortValue: 0,
    floorPointDiff: 4,
    ceilingPointDiff: 12,
    lineup: [],
    offense: "Base Offense",
    pairId: "Base__ManToMan",
    predictedOpponentScore: 88,
    predictedPointDiff: 8,
    predictedTeamScore: 96,
    scenarioResults: [],
    weightedExpectedPointDiff: 8,
    winProbability: 0.75,
    ...overrides,
  };
}

test("planner pair definitions cover the full tactic universe and flag estimates", () => {
  const pairs = recommendationTesting.buildPlannerPairDefinitions();

  assert.equal(pairs.length, 70);
  assert.equal(
    pairs.some(
      (pair) =>
        pair.predictorOffense === "Base" &&
        pair.predictorDefense === "ManToMan" &&
        pair.supportTier === "DIRECT",
    ),
    true,
  );
  assert.equal(
    pairs.some(
      (pair) =>
        pair.predictorOffense === "InsideIsolation" &&
        pair.predictorDefense === "Press" &&
        pair.supportTier === "ESTIMATED",
    ),
    true,
  );
});

test("planner ranking helpers follow expected, safest, and efficient tie-breaks", () => {
  const bestExpected = createCandidate({
    pairId: "best",
    weightedExpectedPointDiff: 11,
    floorPointDiff: 1,
    effortChoice: "Crunch Time",
    effortCost: 2,
  });
  const safest = createCandidate({
    pairId: "safe",
    weightedExpectedPointDiff: 10,
    floorPointDiff: 6,
    effortChoice: "Normal",
    effortCost: 1,
  });
  const efficient = createCandidate({
    pairId: "efficient",
    weightedExpectedPointDiff: 10.5,
    floorPointDiff: 2,
    effortChoice: "Take It Easy",
    effortCost: 0,
  });

  assert.equal(
    recommendationTesting.selectBestExpectedCandidate([
      safest as never,
      bestExpected as never,
      efficient as never,
    ])?.pairId,
    "best",
  );
  assert.equal(
    recommendationTesting.selectSafestCandidate([
      safest as never,
      bestExpected as never,
      efficient as never,
    ])?.pairId,
    "safe",
  );
  assert.equal(
    recommendationTesting.selectEfficientWinCandidate([
      safest as never,
      bestExpected as never,
      efficient as never,
    ])?.pairId,
    "efficient",
  );
});
