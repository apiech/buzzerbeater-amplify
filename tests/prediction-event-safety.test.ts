import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const eventInUpdaterPattern =
  /(setDraft|onSideChange)\(\(current\)\s*=>\s*\(\{[\s\S]{0,240}?event\.(?:currentTarget|target)\.value/;

test("prediction editors snapshot field values before state updaters run", () => {
  const files = [
    "app/game-prediction-panel.tsx",
    "app/scout-opponent-panel.tsx",
  ];

  for (const relativePath of files) {
    const source = readFileSync(
      path.join(process.cwd(), relativePath),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      eventInUpdaterPattern,
      `${relativePath} should not read event values inside functional state updaters.`,
    );
  }
});
