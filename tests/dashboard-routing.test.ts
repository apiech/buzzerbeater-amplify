import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("workspace dashboard section routes are owned by a persistent route-group layout", () => {
  const layoutSource = readFileSync(
    join(repoRoot, "app", "workspace", "(dashboard)", "layout.tsx"),
    "utf8",
  );
  const shellSource = readFileSync(
    join(repoRoot, "app", "workspace", "workspace-dashboard-shell.tsx"),
    "utf8",
  );
  const sectionPageSource = readFileSync(
    join(repoRoot, "app", "workspace", "(dashboard)", "[section]", "page.tsx"),
    "utf8",
  );
  const boxscorePageSource = readFileSync(
    join(
      repoRoot,
      "app",
      "workspace",
      "boxscores",
      "[matchId]",
      "page.tsx",
    ),
    "utf8",
  );

  assert.match(layoutSource, /getServerCurrentUser/);
  assert.match(layoutSource, /resolveServerViewerLabel/);
  assert.match(layoutSource, /WorkspaceDashboardShell/);

  assert.match(shellSource, /useSelectedLayoutSegment/);
  assert.match(shellSource, /<DashboardApp/);
  assert.match(shellSource, /normalizeWorkspaceSection/);

  assert.match(sectionPageSource, /export async function generateMetadata/);
  assert.match(sectionPageSource, /return null;/);
  assert.doesNotMatch(sectionPageSource, /<DashboardApp/);
  assert.doesNotMatch(sectionPageSource, /getServerCurrentUser/);

  assert.match(boxscorePageSource, /app\/workspace\/boxscores\/\[matchId\]\/boxscore-page-client/);
  assert.match(boxscorePageSource, /getServerCurrentUser/);
  assert.doesNotMatch(boxscorePageSource, /WorkspaceDashboardShell/);
});
