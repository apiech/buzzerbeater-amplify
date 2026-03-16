import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSubmissionRequest,
  createDefaultManualPredictionInput,
} from "../app/prediction-panel";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const fixturePath = join(currentDir, "fixtures", "prediction-resolved-input.json");

test("manual prediction fixture stays aligned with the webapp payload shape", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  const defaults = createDefaultManualPredictionInput();

  assert.deepStrictEqual(Object.keys(fixture).sort(), Object.keys(defaults).sort());
});

test("connected submission always carries the manual fallback payload", () => {
  const manualInput = createDefaultManualPredictionInput();
  const submission = buildSubmissionRequest({
    mode: "CONNECTED",
    manualInput,
    homeSourceMatchId: "home-match",
    awaySourceMatchId: "away-match",
    homeTeamId: "HOME",
    awayTeamId: "AWAY",
  });

  assert.equal(submission.mode, "CONNECTED");
  const connectedInput = (submission as { connectedInput: Record<string, unknown> }).connectedInput;
  assert.deepStrictEqual(connectedInput.manualFallback, manualInput);
  assert.equal("home_gdp_focus" in connectedInput, false);
  assert.equal("home_gdp_pace" in connectedInput, false);
  assert.equal("away_gdp_focus" in connectedInput, false);
  assert.equal("away_gdp_pace" in connectedInput, false);
});
