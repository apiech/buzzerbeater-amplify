import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderEnvTemplate } from "../scripts/env-contract.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("env-template stays synchronized with the env contract renderer", () => {
  const source = readFileSync(join(repoRoot, "env-template"), "utf8");
  assert.equal(source, renderEnvTemplate());
});
