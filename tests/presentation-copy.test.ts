import assert from "node:assert/strict";
import test from "node:test";

import {
  formatConnectionStatus,
  formatHighlightsStatus,
  formatNextGameRecommendationStatus,
  formatOpponentForecastStatus,
  formatPreviewStatus,
  formatSyncKind,
  formatWriteupStatus,
  isActiveStatus,
} from "../app/ui/presentation";

test("status labels use plain-language connection copy", () => {
  assert.equal(formatConnectionStatus("CONNECTED"), "Up to date");
  assert.equal(formatConnectionStatus("SYNCING"), "Updating club data");
  assert.equal(formatConnectionStatus("FAILED"), "Needs attention");
});

test("status labels use plain-language preview, writeup, and highlights copy", () => {
  assert.equal(formatPreviewStatus("QUEUED"), "Preview running");
  assert.equal(formatPreviewStatus("SUCCEEDED"), "Preview ready");
  assert.equal(formatPreviewStatus("FAILED"), "Preview failed");

  assert.equal(formatWriteupStatus("BUILDING_CONTEXT"), "Writeup in progress");
  assert.equal(formatWriteupStatus("SUCCEEDED"), "Writeup ready");
  assert.equal(formatWriteupStatus("FAILED"), "Writeup failed");

  assert.equal(formatHighlightsStatus("RESOLVING_HISTORY"), "Scanning team history");
  assert.equal(formatHighlightsStatus("WAITING_FOR_MATCH_JOBS"), "Preparing moments");
  assert.equal(
    formatHighlightsStatus("COMPLETED_WITH_GAPS"),
    "Moments ready with gaps",
  );
  assert.equal(formatHighlightsStatus("SUCCEEDED"), "Moments ready");
  assert.equal(formatHighlightsStatus("FAILED"), "Scan failed");
  assert.notEqual(formatHighlightsStatus("QUEUED"), "Moments ready");
  assert.notEqual(formatHighlightsStatus("COMPLETED_WITH_GAPS"), "Moments ready");
  assert.notEqual(formatHighlightsStatus("WAITING_FOR_MATCH_JOBS"), "Moments ready");
  assert.notEqual(formatHighlightsStatus("FAILED"), "Moments ready");
});

test("next-game and opponent outlook statuses stay user-facing during long-running work", () => {
  assert.equal(
    formatOpponentForecastStatus("RESOLVING_CONTEXT"),
    "Resolving opponent context",
  );
  assert.equal(
    formatOpponentForecastStatus("SUCCEEDED"),
    "Opponent outlook ready",
  );
  assert.equal(
    formatNextGameRecommendationStatus("PREPARING_INPUTS"),
    "Preparing recommendation",
  );
  assert.equal(
    formatNextGameRecommendationStatus("OPTIMIZING_LINEUPS"),
    "Optimizing usable lineups",
  );
  assert.equal(
    formatNextGameRecommendationStatus("SCORING_MATCHUPS"),
    "Scoring matchup combinations",
  );
  assert.equal(
    formatNextGameRecommendationStatus("BUILDING_PLANNER"),
    "Building final planner",
  );
  assert.equal(
    formatNextGameRecommendationStatus("SUCCEEDED"),
    "Recommendation ready",
  );
  assert.equal(isActiveStatus("EVALUATING_CANDIDATES"), true);
  assert.equal(isActiveStatus("OPTIMIZING_LINEUPS"), true);
});

test("sync labels hide backend kind names", () => {
  assert.equal(formatSyncKind("workspace-refresh"), "Club data refresh");
});
