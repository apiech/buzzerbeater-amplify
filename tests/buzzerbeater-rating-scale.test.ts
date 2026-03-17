import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatBuzzerBeaterLabel,
  renderBuzzerBeaterHtmlSpan,
  resolveBuzzerBeaterNumericValue,
  resolveBuzzerBeaterValue,
} from "../lib/buzzerbeater/rating-scale";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(currentDir, "..", "app");

test("player ratings resolve with the canonical 1-based color mapping", () => {
  const resolved = resolveBuzzerBeaterValue({
    scale: "player_rating",
    value: 4,
  });

  assert.ok(resolved);
  assert.equal(resolved.displayLabel, "inept");
  assert.equal(resolved.color, "#2B0E9D");
  assert.equal(resolveBuzzerBeaterNumericValue("player_rating", "inept"), 4);
});

test("enthusiasm supports 15 levels with overflow on unstoppable", () => {
  assert.equal(
    formatBuzzerBeaterLabel({ scale: "enthusiasm", value: 15 }),
    "unstoppable",
  );
  assert.equal(
    formatBuzzerBeaterLabel({ scale: "enthusiasm", value: 16 }),
    "unstoppable (16)",
  );
});

test("potential stays capped at all-time great", () => {
  assert.equal(
    formatBuzzerBeaterLabel({ scale: "potential", value: 11 }),
    "all-time great",
  );
  assert.equal(
    formatBuzzerBeaterLabel({ scale: "potential", value: 99 }),
    "all-time great",
  );
});

test("HTML rating spans use the canonical color", () => {
  assert.equal(
    renderBuzzerBeaterHtmlSpan("4", { scale: "player_rating", value: 4 }),
    '<span style="color:#2B0E9D">4</span>',
  );
});

test("rating color wiring is present in the primary web surfaces", () => {
  const lineupHelperSource = readFileSync(join(appDir, "lineup-helper.tsx"), "utf8");
  const dashboardSource = readFileSync(join(appDir, "dashboard-app.tsx"), "utf8");
  const predictionSource = readFileSync(join(appDir, "prediction-panel.tsx"), "utf8");

  assert.match(lineupHelperSource, /allScaleValues\("enthusiasm"\)/);
  assert.match(lineupHelperSource, /scale="team_rating"/);
  assert.match(lineupHelperSource, /scale="player_rating"/);
  assert.match(lineupHelperSource, /scale="game_shape"/);
  assert.match(dashboardSource, /scale="game_shape"/);
  assert.match(predictionSource, /buzzerBeaterColorStyle/);
});
