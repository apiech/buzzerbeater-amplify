import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const appRoot = join(repoRoot, "app");

function collectFiles(root: string): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const results: string[] = [];

  for (const entry of entries) {
    if (
      entry.name === ".amplify" ||
      entry.name === ".next" ||
      entry.name === "coverage" ||
      entry.name === "dist" ||
      entry.name === "node_modules" ||
      entry.name === "tests"
    ) {
      continue;
    }

    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(entryPath));
      continue;
    }
    results.push(entryPath);
  }

  return results;
}

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

test("panel contexts no longer depend on DashboardWorkspace", () => {
  const files = [
    join(appRoot, "prediction-panel.tsx"),
    join(appRoot, "prediction-panel-state.ts"),
    join(appRoot, "recap-panel.tsx"),
    join(appRoot, "highlights-panel.tsx"),
    join(appRoot, "league-history-panel.tsx"),
    join(appRoot, "rivals-panel.tsx"),
    join(appRoot, "dashboard", "use-authenticated-workspace.ts"),
    join(appRoot, "dashboard-app.tsx"),
  ];

  for (const filePath of files) {
    assert.doesNotMatch(
      readSource(filePath),
      /\bDashboardWorkspace\b/,
      `${relative(repoRoot, filePath)} should not depend on DashboardWorkspace.`,
    );
  }
});

test("app data access stays behind the shared query layer", () => {
  const allowedFiles = new Set([
    join(appRoot, "amplify-client.ts"),
    join(appRoot, "bbapi-browser-test", "bbapi-browser-test-client.tsx"),
    join(appRoot, "dashboard", "workspace-query-client.ts"),
  ]);

  for (const filePath of collectFiles(appRoot)) {
    if (!/\.(ts|tsx)$/.test(filePath)) {
      continue;
    }
    if (allowedFiles.has(filePath)) {
      continue;
    }
    if (filePath.includes(`${join("app", "api")}`)) {
      continue;
    }

    const source = readSource(filePath);
    assert.doesNotMatch(
      source,
      /client\.(queries|mutations|reads)\./,
      `${relative(repoRoot, filePath)} should use the shared query layer instead of the raw client.`,
    );
    assert.doesNotMatch(
      source,
      /\bfetch\(/,
      `${relative(repoRoot, filePath)} should route network access through the shared query layer or app routes.`,
    );
  }
});

test("polling timers remain limited to the debounce allowlist", () => {
  const allowedSetTimeoutFiles = new Set([
    join(appRoot, "lineup-helper.tsx"),
    join(appRoot, "recap-panel.tsx"),
  ]);

  for (const filePath of collectFiles(appRoot)) {
    if (!/\.(ts|tsx)$/.test(filePath)) {
      continue;
    }

    const source = readSource(filePath);
    assert.doesNotMatch(
      source,
      /\bsetInterval\(/,
      `${relative(repoRoot, filePath)} should use TanStack Query polling instead of setInterval.`,
    );

    if (!/\bsetTimeout\(/.test(source)) {
      continue;
    }

    assert.ok(
      allowedSetTimeoutFiles.has(filePath),
      `${relative(repoRoot, filePath)} should not use setTimeout outside the explicit debounce allowlist.`,
    );
  }
});

test("legacy bundled scout operations are gone from public source surfaces", () => {
  const sourceFiles = collectFiles(repoRoot).filter(
    (filePath) =>
      /\.(ts|tsx)$/.test(filePath) &&
      !filePath.includes(`${join(repoRoot, "tests")}`),
  );

  for (const filePath of sourceFiles) {
    const source = readSource(filePath);
    assert.doesNotMatch(
      source,
      /\bgetScoutWorkspace\b/,
      `${relative(repoRoot, filePath)} should not reference the removed public getScoutWorkspace operation.`,
    );
    assert.doesNotMatch(
      source,
      /\bgetTeamHub\b/,
      `${relative(repoRoot, filePath)} should not reference the removed public getTeamHub operation.`,
    );
  }

  const workspaceSource = readSource(
    join(repoRoot, "amplify", "data", "_backend", "workspace.ts"),
  );
  assert.doesNotMatch(
    workspaceSource,
    /export async function getScoutWorkspaceForTeam/,
  );
});
