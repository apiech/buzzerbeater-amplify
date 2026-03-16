import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkspaceSection,
  workspaceSections,
} from "../app/workspace-sections";

test("normalizeWorkspaceSection accepts known product routes", () => {
  for (const section of workspaceSections) {
    assert.equal(normalizeWorkspaceSection(section.id), section.id);
  }
});

test("workspace sections expose the dedicated lineups route", () => {
  assert.equal(
    workspaceSections.some((section) => section.id === "lineups"),
    true,
  );
});

test("normalizeWorkspaceSection falls back to home", () => {
  assert.equal(normalizeWorkspaceSection(undefined), "home");
  assert.equal(normalizeWorkspaceSection("unknown"), "home");
});
