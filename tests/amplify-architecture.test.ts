import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("lambda data access uses the Amplify runtime client", () => {
  const clientSource = readFileSync(
    join(repoRoot, "amplify", "data", "_backend", "data-client.ts"),
    "utf8",
  );

  assert.match(clientSource, /getAmplifyDataClientConfig/);
  assert.match(clientSource, /generateClient<Schema>\(\)/);
});

test("backend.ts does not manually wire GraphQL endpoint environment variables", () => {
  const backendSource = readFileSync(join(repoRoot, "amplify", "backend.ts"), "utf8");

  assert.doesNotMatch(backendSource, /AMPLIFY_DATA_GRAPHQL_ENDPOINT/);
  assert.doesNotMatch(backendSource, /_GRAPHQL_ENDPOINT/);
});

test("match-store runtime wiring no longer uses per-user Secrets Manager", () => {
  const integrationSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "match-store-integration.ts"),
    "utf8",
  );
  const dataPlaneStackSource = readFileSync(
    join(repoRoot, "infra", "match-data-plane", "lib", "match-data-plane-stack.ts"),
    "utf8",
  );

  assert.doesNotMatch(integrationSource, /BB_CONNECTION_SECRET_PREFIX/);
  assert.doesNotMatch(integrationSource, /secretsmanager:/);
  assert.doesNotMatch(dataPlaneStackSource, /secretsmanager:/);
  assert.match(dataPlaneStackSource, /BB_CONNECTION_ENCRYPTION_SECRET/);
});

test("scheduled maintenance rules live in the data lambda stack", () => {
  const refreshJobsSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "refresh-jobs.ts"),
    "utf8",
  );
  const retentionSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "operational-retention.ts"),
    "utf8",
  );

  assert.match(
    refreshJobsSource,
    /Stack\.of\(backend\.refreshBbWorkspaces\.resources\.lambda\)/,
  );
  assert.match(
    retentionSource,
    /Stack\.of\(backend\.pruneOperationalData\.resources\.lambda\)/,
  );
});
