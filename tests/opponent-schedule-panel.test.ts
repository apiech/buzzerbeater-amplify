import assert from "node:assert/strict";
import test from "node:test";

import { __testing as scheduleTesting } from "../app/opponent-schedule-panel";

test("schedule helpers format BBStats totals and pending rows", () => {
  assert.equal(scheduleTesting.formatBbstats(null), "—");
  assert.equal(scheduleTesting.formatBbstats(127), "127");

  assert.equal(
    scheduleTesting.formatResult({
      opponentScore: null,
      outcome: "PENDING",
      teamScore: null,
    } as any),
    "Upcoming",
  );
  assert.equal(
    scheduleTesting.formatResult({
      opponentScore: 88,
      outcome: "WIN",
      teamScore: 102,
    } as any),
    "102-88 W",
  );
});

test("schedule helpers map seriousness badges to the right tones", () => {
  assert.equal(scheduleTesting.toneForSeriousness("YES"), "success");
  assert.equal(scheduleTesting.toneForSeriousness("MAYBE"), "note");
  assert.equal(scheduleTesting.toneForSeriousness("NO"), "danger");
});

test("schedule helpers keep the default and filtered empty-state copy stable", () => {
  assert.equal(
    scheduleTesting.defaultScheduleEmptyStateMessage(),
    "No schedule is available until a scout target is selected.",
  );
  assert.equal(
    scheduleTesting.scheduleTableEmptyStateMessage(),
    "No games match the current season and game-type filters.",
  );
});
