import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

function readAppFile(pathSegments: string[]): string {
  return readFileSync(join(currentDir, "..", ...pathSegments), "utf8");
}

test("work-in-progress notice copy includes WIP phrasing", () => {
  const noticeSource = readAppFile([
    "app",
    "ui",
    "primitives",
    "work-in-progress-notice.tsx",
  ]);

  assert.match(noticeSource, /Work in progress \(WIP\):/);
  assert.match(noticeSource, /has not been thoroughly tested yet/);
  assert.match(noticeSource, /is not fully ready/);
});

test("staff, arena, and salary calculator surfaces all show the WIP notice", () => {
  const staffSource = readAppFile(["app", "staff-market-panel.tsx"]);
  const arenaSource = readAppFile(["app", "arena-panel.tsx"]);
  const dashboardSource = readAppFile(["app", "dashboard-app.tsx"]);

  assert.match(staffSource, /subject="This staff market page"/);
  assert.match(arenaSource, /subject="This arena pricing page"/);
  assert.match(dashboardSource, /subject="This salary calculator section"/);
});
