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
  assert.doesNotMatch(
    operationsSource,
    /Latest preview engine|Latest recap model|modelVersion|modelId/,
  );
  assert.doesNotMatch(
    predictionSource,
    /recent opponent games cached|modelVersion/,
  );
  assert.doesNotMatch(
    recapSource,
    /Model \{selectedRecap\.modelId\}|description=\{`Match \$\{game\.matchId\}`\}/,
  );
});

test("user-facing copy no longer exposes pipeline or internal helper jargon", () => {
  const highlightsSource = readAppFile(["app", "highlights-panel.tsx"]);
  const lineupSource = readAppFile(["app", "lineup-helper.tsx"]);
  const sectionsSource = readAppFile(["app", "workspace-sections.ts"]);

  assert.doesNotMatch(
    highlightsSource,
    /canonical play-by-play|payloads|materialized|ingest jobs|materialize jobs|backfill/,
  );
  assert.doesNotMatch(
    lineupSource,
    /CoachParrot|Refresh cache|canonical skill snapshots|Engine status/,
  );
  assert.doesNotMatch(sectionsSource, /CoachParrot lineup helper/);
});

test("home dashboard uses dedicated boxscore routes and owner roster copy", () => {
  const dashboardSource = readAppFile(["app", "dashboard-app.tsx"]);
  const boxscoreRouteSource = readAppFile([
    "app",
    "workspace",
    "boxscores",
    "[matchId]",
    "boxscore-page-client.tsx",
  ]);

  assert.match(dashboardSource, /\/workspace\/boxscores\/\$\{encodeURIComponent\(matchId\)\}/);
  assert.doesNotMatch(dashboardSource, /handleLoadBoxscore/);
  assert.match(dashboardSource, /Owner roster and lineup context/);
  assert.match(dashboardSource, /label="Pos"/);
  assert.match(dashboardSource, /label="DMI"/);
  assert.doesNotMatch(dashboardSource, /label="Starts"/);
  assert.doesNotMatch(dashboardSource, /title="Lineup Planner"/);
  assert.match(boxscoreRouteSource, /client\.queries\.getMatchBoxscoreDetails/);
  assert.doesNotMatch(boxscoreRouteSource, /Your tactics|Opponent tactics/);
});

test("auth copy routes users through managed login instead of local password forms", () => {
  const dashboardSource = readAppFile(["app", "dashboard-app.tsx"]);
  const loginSource = readAppFile(["app", "login", "page.tsx"]);

  assert.doesNotMatch(dashboardSource, /placeholder="Create a password"/);
  assert.doesNotMatch(dashboardSource, /placeholder="Confirm your password"/);
  assert.match(loginSource, /managed login/);
  assert.match(
    loginSource,
    /Sign-in, sign-up, password reset, and account confirmation all\s+continue in Cognito managed login\./,
  );
});
