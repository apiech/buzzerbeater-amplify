import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("shared-card lookup stays authenticated-only", () => {
  const resourceSource = readFileSync(
    join(repoRoot, "amplify", "data", "resource.ts"),
    "utf8",
  );

  assert.match(
    resourceSource,
    /lookupSharedPlayerCard:[\s\S]*?authorization\(\(allow\) => \[allow\.authenticated\(\)\]\)/,
  );
  assert.doesNotMatch(resourceSource, /allow\.guest\(\)/);
});

test("shared-card mutations are provisioned server-side", () => {
  const resourceSource = readFileSync(
    join(repoRoot, "amplify", "data", "resource.ts"),
    "utf8",
  );

  assert.match(resourceSource, /generateSharedPlayerCard/);
  assert.match(resourceSource, /revokeSharedPlayerCard/);
});

test("no public shared-player route ships yet", () => {
  const routePath = join(repoRoot, "app", "shared", "player", "[token]", "page.tsx");

  assert.equal(existsSync(routePath), false);
});

test("no automated refresh schedule remains on the workspace sync function", () => {
  const resourceSource = readFileSync(
    join(repoRoot, "amplify", "data", "resource.ts"),
    "utf8",
  );

  assert.doesNotMatch(
    resourceSource,
    /name:\s*"refresh-bb-workspaces"[\s\S]*schedule:\s*"/,
  );
});
