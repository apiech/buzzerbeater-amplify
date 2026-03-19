import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readmeEnvSectionEnd,
  readmeEnvSectionStart,
  renderReadmeEnvSection,
} from "../../scripts/env-contract.mjs";
import { applyReadmeEnvSection } from "../../scripts/render-env-docs.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "../..");

test("README env section stays synchronized with the env contract renderer", () => {
  const source = readFileSync(join(repoRoot, "README.md"), "utf8");
  assert.match(
    source,
    new RegExp(readmeEnvSectionStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    source,
    new RegExp(readmeEnvSectionEnd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(source, applyReadmeEnvSection(source));
  assert.match(source, /Shared ML Infra Bindings/);
  assert.match(source, /BB_SHARED_ENVIRONMENT_NAME/);
  assert.match(source, /MATCH_STORE_BUCKET_NAME/);
  assert.doesNotMatch(source, /MATCH_DATA_PLANE_SOURCE/);
  assert.doesNotMatch(source, /MATCH_DATA_PLANE_STACK_NAME/);
  assert.doesNotMatch(source, /sync:match-data-plane/);
  assert.doesNotMatch(source, /\.env\.match-data-plane/);
  assert.match(
    source,
    new RegExp(renderReadmeEnvSection().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
