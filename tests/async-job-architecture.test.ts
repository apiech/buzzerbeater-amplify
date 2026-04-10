import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("async job workflows are colocated with their lambda stacks", () => {
  const jobFiles = [
    "game-day-recap-jobs.ts",
    "league-history-jobs.ts",
    "next-game-recommendation-jobs.ts",
    "opponent-forecast-jobs.ts",
    "prediction-jobs.ts",
  ];

  for (const fileName of jobFiles) {
    const source = readFileSync(
      join(repoRoot, "amplify", "_backend", fileName),
      "utf8",
    );

    assert.match(source, /Stack\.of\(/, `${fileName} should colocate workflows`);
    assert.doesNotMatch(
      source,
      /createStack\(/,
      `${fileName} should not create a separate workflow stack`,
    );
  }
});
