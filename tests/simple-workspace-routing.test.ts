import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("simple workspace routes live outside the classic dashboard shell", () => {
  const layoutSource = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "layout.tsx"),
    "utf8",
  );
  const shellSource = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "simple-workspace-shell.tsx"),
    "utf8",
  );
  const indexPageSource = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "page.tsx"),
    "utf8",
  );
  const schedulePageSource = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "schedule", "page.tsx"),
    "utf8",
  );
  const predictionPageSource = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "prediction", "page.tsx"),
    "utf8",
  );

  assert.match(layoutSource, /getServerCurrentUser/);
  assert.doesNotMatch(layoutSource, /WorkspaceDashboardShell/);
  assert.match(shellSource, /Classic workspace/);
  assert.match(shellSource, /\/workspace\/simple\/schedule/);
  assert.match(shellSource, /\/workspace\/simple\/prediction/);
  assert.match(indexPageSource, /redirect\("\/workspace\/simple\/schedule"\)/);
  assert.match(schedulePageSource, /SimpleSchedulePageClient/);
  assert.match(predictionPageSource, /SimplePredictionPageClient/);
});
