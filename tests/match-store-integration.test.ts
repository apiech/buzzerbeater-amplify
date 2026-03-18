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
