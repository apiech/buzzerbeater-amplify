import assert from "node:assert/strict";
import test from "node:test";

import {
  formatProjectedOutcome,
  listNextGameWizardAlternativePlans,
  resolveNextGameWizardScenarioMargin,
  selectNextGameWizardPrimaryPlan,
} from "../app/next-game-wizard-state";

function createPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    defense: "Man to man",
    defensiveSwitch: {
      pg: "PG",
      sg: "SG",
      sf: "SF",
      pf: "PF",
      c: "C",
    },
    effortChoice: "Normal",
    enthusiasm: 8,
    floorPointDiff: 2,
    lineup: [],
    offense: "Base Offense",
    pairId: "Base__ManToMan",
    predictedOpponentScore: 94,
    predictedPointDiff: 6,
    predictedTeamScore: 100,
    scenarioResults: [
      {
        available: true,
        predictedOpponentScore: 93,
        predictedPointDiff: 7,
        predictedTeamScore: 100,
        scenarioId: "scenario-1",
      },
    ],
    weightedExpectedPointDiff: 6,
    winProbability: 0.7,
    ...overrides,
  };
}

function createResult() {
  return {
    artifactKey: "artifact-1",
    bestExpectedPlan: createPlan({
      offense: "Motion",
      pairId: "Motion__ManToMan",
      weightedExpectedPointDiff: 9,
    }),
    efficientPlan: createPlan({
      effortChoice: "Take It Easy",
      offense: "Patient",
      pairId: "Patient__23Zone",
      weightedExpectedPointDiff: 5,
    }),
    efficientWinPlan: createPlan({
      effortChoice: "Take It Easy",
      offense: "Patient",
      pairId: "Patient__23Zone",
      weightedExpectedPointDiff: 5,
    }),
    evaluatedScenarios: [],
    forecastJobId: "forecast-1",
    forecastModelVersion: "forecast-v1",
    forecastScenarioId: "scenario-1",
    forecastScenarioLabel: "Primary",
    forecastScenarioProbability: 0.6,
    generatedAt: "2026-04-13T00:00:00.000Z",
    biggestWinPlan: createPlan({
      offense: "Run and Gun",
      pairId: "RunAndGun__Press",
      weightedExpectedPointDiff: 12,
    }),
    matchId: "m-1",
    opponentSourceMatchId: "source-1",
    opponentTeamId: "opp-1",
    opponentTeamName: "Rivals",
    safestPlan: createPlan({
      defense: "2-3 Zone",
      offense: "Push the Ball",
      pairId: "Push__23Zone",
      weightedExpectedPointDiff: 7,
    }),
    stale: false,
  } as any;
}

test("wizard goal presets map to the expected recommendation plans", () => {
  const result = createResult();

  assert.equal(
    selectNextGameWizardPrimaryPlan({
      goal: "BEST_CHANCE",
      result,
    })?.pairId,
    "Motion__ManToMan",
  );
  assert.equal(
    selectNextGameWizardPrimaryPlan({
      goal: "SAFEST_FLOOR",
      result,
    })?.pairId,
    "Push__23Zone",
  );
  assert.equal(
    selectNextGameWizardPrimaryPlan({
      goal: "SAVE_ENTHUSIASM",
      result,
    })?.pairId,
    "Patient__23Zone",
  );
});

test("wizard alternative plans omit the active goal and preserve the other two", () => {
  const alternatives = listNextGameWizardAlternativePlans({
    goal: "BEST_CHANCE",
    result: createResult(),
  });

  assert.deepEqual(
    alternatives.map((option) => option.goal),
    ["SAFEST_FLOOR", "SAVE_ENTHUSIASM"],
  );
});

test("wizard scenario margin prefers the selected scenario prediction", () => {
  const margin = resolveNextGameWizardScenarioMargin({
    plan: createPlan(),
    scenarioId: "scenario-1",
  });
  const missing = resolveNextGameWizardScenarioMargin({
    plan: createPlan(),
    scenarioId: "scenario-2",
  });

  assert.equal(margin, 7);
  assert.equal(missing, null);
});

test("projected outcome copy uses confidence-aware win/loss phrasing", () => {
  assert.equal(formatProjectedOutcome(4.2), "Projected to win by 4.2");
  assert.equal(formatProjectedOutcome(-2.5), "Projected to lose by 2.5");
  assert.equal(formatProjectedOutcome(0), "Projected even");
  assert.equal(formatProjectedOutcome(null), "Projection unavailable");
});
