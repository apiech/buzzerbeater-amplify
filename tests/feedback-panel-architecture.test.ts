import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const dashboardSource = readFileSync(
  join(repoRoot, "app", "dashboard-app.tsx"),
  "utf8",
);
const feedbackPanelSource = readFileSync(
  join(repoRoot, "app", "feedback-panel.tsx"),
  "utf8",
);

test("account surfaces include the feedback deep-link shortcut and embedded feedback panel", () => {
  assert.match(dashboardSource, /href="\/workspace\/ops#feedback"/);
  assert.match(dashboardSource, /<FeedbackPanel/);
  assert.match(dashboardSource, /feedback_shortcut_clicked/);
  assert.match(feedbackPanelSource, /id="feedback"/);
  assert.match(feedbackPanelSource, /submitProductFeedbackMutation/);
});
