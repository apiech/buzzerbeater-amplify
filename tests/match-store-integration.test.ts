import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const source = readFileSync(
  join(repoRoot, "amplify", "_backend", "match-store-integration.ts"),
  "utf8",
);

test("match-store integration imports shared infra resources instead of provisioning app-local copies", () => {
  assert.match(source, /SharedInfraBindings/);
  assert.match(source, /Bucket\.fromBucketName/);
  assert.match(source, /Table\.fromTableName/);
  assert.doesNotMatch(source, /new Bucket\(/);
  assert.doesNotMatch(source, /new Table\(/);
  assert.doesNotMatch(source, /MATCH_DATA_PLANE_SOURCE/);
  assert.doesNotMatch(source, /resolveExternalMatchStoreConfig/);
  assert.doesNotMatch(source, /sync:match-data-plane/);
  assert.doesNotMatch(source, /\.env\.match-data-plane/);
});

test("team highlights submitter derives queue access from the imported shared infra queue url", () => {
  assert.match(source, /TEAM_HIGHLIGHTS_SCAN_QUEUE_URL/);
  assert.match(source, /grantSqsSendAccessFromQueueUrl/);
  assert.match(source, /arn:\$\{stack\.partition\}:sqs:/);
});

test("active tracked team wiring is limited to explicit enrollment and refresh paths", () => {
  assert.match(source, /const activeTrackedTeamSyncFunctions = \[/);
  assert.match(source, /backend\.connectBbAccount/);
  assert.match(source, /backend\.disconnectBbAccount/);
  assert.match(source, /backend\.refreshWorkspace/);
  assert.match(source, /backend\.refreshBbWorkspaceWorker/);
  const start = source.indexOf("const activeTrackedTeamSyncFunctions");
  const end = source.indexOf("const workspaceSnapshotWriteFunctions");
  const activeTrackedSection = source.slice(start, end);
  assert.doesNotMatch(activeTrackedSection, /backend\.getHomeWorkspace/);
  assert.doesNotMatch(activeTrackedSection, /backend\.getMyTeamHighlights/);
});

test("browse-time workspace writers keep player snapshot access without active tracked team wiring", () => {
  assert.match(source, /const workspaceSnapshotWriteFunctions = \[/);
  assert.match(source, /backend\.getHomeWorkspace/);
  assert.match(source, /backend\.getTeamHub/);
  assert.match(source, /backend\.getScoutWorkspace/);
  assert.match(source, /backend\.getLeagueIntel/);
  assert.match(source, /backend\.getPlayerLab/);
  assert.match(source, /backend\.getRivalsWorkspace/);
  assert.match(source, /PLAYER_SKILL_SNAPSHOT_TABLE_NAME/);
});

test("team highlights handlers no longer receive active tracked team table wiring", () => {
  assert.match(source, /backend\.getMyTeamHighlights/);
  assert.match(source, /backend\.submitMyTeamHighlightsScan/);
  assert.doesNotMatch(source, /const teamHighlightsFunctions = \[/);
  assert.doesNotMatch(source, /activeTrackedTeamsTable\.grantReadData/);
});
