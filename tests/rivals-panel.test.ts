import assert from "node:assert/strict";
import test from "node:test";

import { __testing as rivalsPanelTesting } from "../app/rivals-panel";

test("default season range spans the first and last available season", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.buildDefaultSeasonRange(["59", "60", "61"]),
    {
      endSeason: "61",
      startSeason: "59",
    },
  );
});

test("season range normalization falls back to the available bounds", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.normalizeSeasonRange(["59", "60", "61"], "", ""),
    {
      endSeason: "61",
      startSeason: "59",
    },
  );
});

test("toggleSelectedValue removes a value from the implicit all-selected state", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.toggleSelectedValue(
      null,
      "PLAYOFFS",
      ["LEAGUE_REGULAR_SEASON", "PLAYOFFS", "CUP"],
    ),
    ["LEAGUE_REGULAR_SEASON", "CUP"],
  );
});

test("toggleSelectedValue adds a missing value back into the explicit selection", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.toggleSelectedValue(
      ["LEAGUE_REGULAR_SEASON"],
      "CUP",
      ["LEAGUE_REGULAR_SEASON", "PLAYOFFS", "CUP"],
    ),
    ["LEAGUE_REGULAR_SEASON", "CUP"],
  );
});

test("season range self-corrects when the chosen start exceeds the end", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.updateSeasonRangeFromStart(
      ["59", "60", "61"],
      "61",
      "60",
    ),
    {
      endSeason: "61",
      startSeason: "61",
    },
  );
});

test("season range self-corrects when the chosen end precedes the start", () => {
  assert.deepStrictEqual(
    rivalsPanelTesting.updateSeasonRangeFromEnd(["59", "60", "61"], "61", "59"),
    {
      endSeason: "59",
      startSeason: "59",
    },
  );
});
