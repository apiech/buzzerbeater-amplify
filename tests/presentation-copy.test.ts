import assert from "node:assert/strict";
import test from "node:test";

import {
  formatConnectionStatus,
  formatHighlightsStatus,
  formatPreviewStatus,
  formatSyncKind,
  formatWriteupStatus,
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

test("sync labels hide backend kind names", () => {
  assert.equal(formatSyncKind("workspace-refresh"), "Club data refresh");
});
