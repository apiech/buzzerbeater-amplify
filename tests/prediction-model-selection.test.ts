import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPredictionModelLabel,
  INTERNAL_PREDICTION_MODEL_OPTIONS,
  isInternalPredictionModelPickerEnabled,
  normalizePredictionModelKey,
} from "../lib/prediction/model-selection";

test("prediction model selection helpers normalize and label supported keys", () => {
  assert.equal(normalizePredictionModelKey("  xgb  "), "xgb");
  assert.equal(normalizePredictionModelKey("   "), null);
  assert.equal(formatPredictionModelLabel("catboost"), "CatBoost");
  assert.equal(formatPredictionModelLabel("decomposition"), "Decomposition");
  assert.equal(formatPredictionModelLabel(null), "Bundle default");
  assert.ok(
    INTERNAL_PREDICTION_MODEL_OPTIONS.some(
      (option) => option.value === "decomposition",
    ),
  );
});

test("internal prediction model picker stays hidden in prod", () => {
  assert.equal(isInternalPredictionModelPickerEnabled("prod"), false);
  assert.equal(isInternalPredictionModelPickerEnabled("sandbox-karey"), true);
  assert.equal(isInternalPredictionModelPickerEnabled("dev"), true);
});
