import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_THEME_ID, isThemeId, themeOptions } from "../app/theme";

test("theme validation accepts supported account theme ids", () => {
  assert.equal(DEFAULT_THEME_ID, "clubhouse");
  assert.deepStrictEqual(
    themeOptions.map((option) => option.id),
    ["clubhouse", "arena", "nightfall"],
  );
  assert.equal(isThemeId("clubhouse"), true);
  assert.equal(isThemeId("arena"), true);
  assert.equal(isThemeId("nightfall"), true);
  assert.equal(isThemeId("locker-room"), false);
  assert.equal(isThemeId(null), false);
});
