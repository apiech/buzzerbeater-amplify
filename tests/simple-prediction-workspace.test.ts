import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testing as simplePredictionTesting } from "../app/workspace/simple/simple-prediction-helpers";
import { createDefaultPredictionDraft } from "../app/game-prediction-state";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("simple prediction import options are seeded from recent boxscores", () => {
  const options = simplePredictionTesting.buildPredictionImportMatchOptions([
    {
      hasBoxscore: true,
      matchId: "match-2",
      opponentTeamName: "Rivals",
      opponentScore: 88,
      outcome: "WIN",
      startTime: "2026-04-18T20:00:00.000Z",
      teamScore: 92,
    },
    {
      hasBoxscore: false,
      matchId: "match-1",
      opponentTeamName: "Ignore",
      startTime: "2026-04-10T20:00:00.000Z",
    },
  ] as any);

  assert.deepEqual(options, [
    {
      label: "Apr 18, 2026 • Rivals • WIN 92-88",
      matchId: "match-2",
    },
  ]);
});

test("simple prediction requests preserve quick manual edits while stripping hidden model selection", () => {
  const draft = {
    ...createDefaultPredictionDraft(),
    modelKey: "catboost",
    teamA: {
      ...createDefaultPredictionDraft().teamA,
      offense: "Motion",
      ratings: {
        ...createDefaultPredictionDraft().teamA.ratings,
        outsideScoring: 13.5,
      },
    },
  };

  const request = simplePredictionTesting.buildSimplePredictionRequest(draft);

  assert.equal(request.modelKey, null);
  assert.equal(request.teamA.offense, "Motion");
  assert.equal(request.teamA.ratings.outsideScoring, 13.5);
});

test("simple prediction gating blocks free plans and allows premium", () => {
  assert.equal(
    simplePredictionTesting.canUseSimplePredictionFeature({
      billingError: null,
      billingSummary: {
        accessSource: "FREE",
        hasBillingCustomer: false,
        hasLifetimeAccess: false,
        planId: "free",
      } as any,
    }),
    false,
  );
  assert.equal(
    simplePredictionTesting.canUseSimplePredictionFeature({
      billingError: null,
      billingSummary: {
        accessSource: "SUBSCRIPTION",
        hasBillingCustomer: true,
        hasLifetimeAccess: false,
        planId: "premium",
      } as any,
    }),
    true,
  );
});

test("simple prediction source stays free of classic advanced-only controls", () => {
  const source = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "simple-prediction-workspace.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /Advanced filters/);
  assert.doesNotMatch(source, /Defense breakdown/);
  assert.doesNotMatch(source, /Explore extremes/);
});
