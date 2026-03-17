import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

function readAppFile(pathSegments: string[]): string {
  return readFileSync(join(currentDir, "..", ...pathSegments), "utf8");
}

test("read-only dashboard surfaces avoid credential fingerprints and raw model metadata", () => {
  const dashboardSource = readAppFile(["app", "dashboard-app.tsx"]);
  const operationsSource = readAppFile(["app", "operations-panel.tsx"]);
  const predictionSource = readAppFile(["app", "prediction-panel.tsx"]);
  const recapSource = readAppFile(["app", "recap-panel.tsx"]);

  assert.doesNotMatch(dashboardSource, /accessKeyLast4/);
  assert.doesNotMatch(operationsSource, /Latest preview engine|Latest recap model|modelVersion|modelId/);
  assert.doesNotMatch(predictionSource, /recent opponent games cached|modelVersion/);
  assert.doesNotMatch(recapSource, /Model \{selectedRecap\.modelId\}|description=\{`Match \$\{game\.matchId\}`\}/);
});

test("user-facing copy no longer exposes pipeline or internal helper jargon", () => {
  const highlightsSource = readAppFile(["app", "highlights-panel.tsx"]);
  const lineupSource = readAppFile(["app", "lineup-helper.tsx"]);
  const teamToolsSource = readAppFile(["app", "team-tools.tsx"]);
  const sectionsSource = readAppFile(["app", "workspace-sections.ts"]);

  assert.doesNotMatch(highlightsSource, /canonical play-by-play|payloads|materialized|ingest jobs|materialize jobs|backfill/);
  assert.doesNotMatch(lineupSource, /CoachParrot|Refresh cache|canonical skill snapshots|Engine status/);
  assert.doesNotMatch(teamToolsSource, /Open CoachParrot helper/);
  assert.doesNotMatch(sectionsSource, /CoachParrot lineup helper/);
});
