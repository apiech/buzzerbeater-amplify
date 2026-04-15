import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testing as lineupHelperTesting } from "../app/lineup-helper";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const lineupHelperSource = readFileSync(
  join(repoRoot, "app", "lineup-helper.tsx"),
  "utf8",
);

function assertSourceMatches(pattern: RegExp, message: string) {
  assert.equal(pattern.test(lineupHelperSource), true, message);
}

test("pending availability helper copy stays stable", () => {
  assert.equal(
    lineupHelperTesting.buildPendingAvailabilitySummary(1),
    "1 roster change pending. Apply changes to rebuild the lineup and refresh ratings.",
  );
  assert.equal(
    lineupHelperTesting.buildPendingAvailabilitySummary(3),
    "3 roster changes pending. Apply changes to rebuild the lineup and refresh ratings.",
  );
  assert.equal(
    lineupHelperTesting.formatPendingAvailabilityChange("PENDING_EXCLUSION"),
    "Pending exclusion",
  );
  assert.equal(
    lineupHelperTesting.formatPendingAvailabilityChange("PENDING_INCLUSION"),
    "Pending inclusion",
  );
});

test("lineup helper stages availability overrides before rebuilding", () => {
  assertSourceMatches(
    /const \[appliedAvailabilityOverride, setAppliedAvailabilityOverride\]/,
    "expected the applied availability override state to exist",
  );
  assertSourceMatches(
    /const \[draftAvailabilityOverride, setDraftAvailabilityOverride\]/,
    "expected the draft availability override state to exist",
  );
  assertSourceMatches(/>\s*Apply changes\s*</, "expected an Apply changes action");
  assertSourceMatches(/>\s*Discard\s*</, "expected a Discard action");
  assertSourceMatches(/>\s*Clear all\s*</, "expected a Clear all action");
  assertSourceMatches(
    /function handleTogglePlayerExclusion\(playerId: string\) \{[\s\S]*setDraftAvailabilityOverride\(\(current\) =>[\s\S]*toggleExcludedPlayerId\(current, playerId\)/,
    "expected toggles to stage exclusions in draft state",
  );
  assertSourceMatches(
    /async function handleApplyAvailabilityChanges\(\) \{[\s\S]*setAppliedAvailabilityOverride\(nextAvailabilityOverride\);[\s\S]*await performOptimizeForRoster\(\{[\s\S]*rebuildReason: "APPLY",/,
    "expected apply changes to persist the draft override before rebuilding",
  );
  assertSourceMatches(
    /function handleDiscardAvailabilityChanges\(\) \{[\s\S]*setDraftAvailabilityOverride\(appliedAvailabilityOverride\);/,
    "expected discard to reset the draft override to the applied state",
  );
  assertSourceMatches(
    /function handleClearDraftExcludedPlayers\(\) \{[\s\S]*setDraftAvailabilityOverride\(\{ excludedPlayerIds: \[\] \}\);/,
    "expected clear all to empty the draft exclusions",
  );
});

test("lineup helper rebuilds once on hydration when saved exclusions exist", () => {
  assertSourceMatches(
    /setInitialAvailabilityRepairPending\([\s\S]*nextAvailabilityOverride\.excludedPlayerIds\.length > 0/,
    "expected hydration to flag saved exclusions for a one-time rebuild",
  );
  assertSourceMatches(
    /void runOptimizeForRosterEffect\(\{[\s\S]*availabilityOverride: appliedAvailabilityOverride,[\s\S]*rebuildReason: "HYDRATE",/,
    "expected hydration to rebuild through the effect-only optimize wrapper",
  );
  assertSourceMatches(
    /const showLineupRebuildState =[\s\S]*shouldHideActiveLineup \|\| isRebuildingAvailabilityLineup;/,
    "expected a shared rebuild-state gate for lineup visibility",
  );
  assertSourceMatches(
    /Loading your applied coach exclusions before showing the lineup plan\./,
    "expected hydration copy explaining the staged rebuild state",
  );
});

test("lineup helper clears stale evaluation when an applied rebuild fails", () => {
  assertSourceMatches(
    /async function handleApplyAvailabilityChanges\(\) \{[\s\S]*setAppliedAvailabilityOverride\(nextAvailabilityOverride\);[\s\S]*await performOptimizeForRoster\(/,
    "expected apply changes to await the shared optimize helper",
  );
  assertSourceMatches(
    /catch \(error\) \{[\s\S]*setEvaluation\(null\);[\s\S]*setEvaluationError\(readQueryError\(error\)\);/,
    "expected rebuild failures to clear stale evaluation output",
  );
});

test("lineup helper disables lineup edits while roster draft changes are pending", () => {
  assertSourceMatches(
    /const lineupPlanControlsDisabled =[\s\S]*hasPendingAvailabilityChanges;/,
    "expected lineup controls to disable while draft changes are pending",
  );
  assertSourceMatches(
    /availableRosterCount === 0 \|\|[\s\S]*hasPendingAvailabilityChanges \|\|[\s\S]*showLineupRebuildState/,
    "expected action buttons to account for pending changes and rebuild state",
  );
  assertSourceMatches(
    /disabled=\{lineupPlanControlsDisabled\}/,
    "expected lineup controls to bind the shared disabled state",
  );
  assertSourceMatches(
    /disabled=\{\s*!enabled \|\| lineupPlanControlsDisabled\s*\}/,
    "expected lineup select controls to honor the shared disabled state",
  );
  assertSourceMatches(
    /Current lineup and ratings still reflect the last applied roster\./,
    "expected helper copy to explain pending draft changes",
  );
});
