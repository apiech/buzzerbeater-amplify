import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testing as simpleScheduleTesting } from "../app/workspace/simple/simple-schedule-panel";
import { __testing as simpleScoutTesting } from "../app/workspace/simple/simple-scout-state";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("simple scout defaults to the next opponent when no explicit team is selected", () => {
  assert.equal(
    simpleScoutTesting.resolveSimpleScoutDefaultTeamId({
      nextScoutTeamId: "opp-next",
      requestedScoutTeamId: null,
      scoutTeamId: null,
      urlTeamId: null,
    }),
    "opp-next",
  );
});

test("simple scout filter updates preserve sorted competition keys", () => {
  const action = simpleScoutTesting.resolveSimpleScoutFilterApplyAction({
    currentCompetitionKeys: ["league.rs"],
    currentSeason: 66,
    nextCompetitionKeys: ["cup", "league.rs"],
    nextSeason: 67,
  });

  assert.deepEqual(action, {
    kind: "update-url",
    nextState: {
      scoutSeason: 67,
      scoutTypes: ["cup", "league.rs"],
    },
  });
});

test("simple schedule helpers keep the dense-table empty states stable", () => {
  assert.equal(
    simpleScheduleTesting.defaultSimpleScheduleEmptyStateMessage(),
    "No schedule is available until an opponent is selected.",
  );
  assert.equal(
    simpleScheduleTesting.simpleScheduleTableEmptyStateMessage(),
    "No games match the current filters.",
  );
});

test("simple schedule panel keeps boxscore links on the existing workspace route", () => {
  const source = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "simple-schedule-panel.tsx"),
    "utf8",
  );

  assert.match(source, /\/workspace\/boxscores\/\$\{encodeURIComponent\(row\.matchId\)\}/);
});

test("simple schedule panel uses grouped team and opponent columns", () => {
  const source = readFileSync(
    join(repoRoot, "app", "workspace", "simple", "simple-schedule-panel.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /Our plan/);
  assert.doesNotMatch(source, /Opp plan/);
  assert.match(source, /colSpan=\{3\}[\s\S]*?>\s*Team\s*</);
  assert.match(source, /colSpan=\{4\}[\s\S]*?>\s*Opponent\s*</);
});
