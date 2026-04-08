import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const packageJsonPath = join(repoRoot, "package.json");

test("sandbox scripts expose the happy path and raw escape hatch", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};

  assert.equal(
    scripts.sandbox,
    "node --import tsx ./scripts/deploy-workflow.ts sandbox:up",
  );
  assert.equal(
    scripts["sandbox:once"],
    "node --import tsx ./scripts/deploy-workflow.ts sandbox:up --once",
  );
  assert.equal(
    scripts["sandbox:raw"],
    "node ./scripts/ampx-with-env.mjs sandbox",
  );
  assert.equal(
    scripts["lint:deploy:sandbox"],
    "node --max-old-space-size=6144 ./node_modules/eslint/bin/eslint.js --cache --cache-location ./.eslintcache.deploy-sandbox app amplify tests scripts lib proxy.ts next.config.ts eslint.config.mjs",
  );
  assert.equal(
    scripts["typecheck:app:deploy:sandbox"],
    "tsc -p tsconfig.app.json --noEmit --incremental --tsBuildInfoFile ./.tsbuildinfo.deploy-sandbox",
  );
  assert.equal(
    scripts["verify:deploy:sandbox"],
    "npm run lint:deploy:sandbox && npm run typecheck:app:deploy:sandbox",
  );
  assert.equal(
    scripts["hosted:sync-compute-role"],
    "node --import tsx ./scripts/sync-hosted-compute-role.ts",
  );
});
