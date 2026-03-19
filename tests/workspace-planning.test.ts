import assert from "node:assert/strict";
import test from "node:test";

import { buildSalaryProjectionPayload } from "../amplify/data/_backend/workspace";

test("buildSalaryProjectionPayload computes trend and flag fit", () => {
  const projection = buildSalaryProjectionPayload({
    player: {
      playerId: "p1",
      fullName: "Flag Prospect",
      bestPosition: "SF",
      nationalityName: "USA",
      salary: 50000,
      profileJson: {
        nationality: {
          name: "USA",
        },
      },
    },
    snapshots: [
      { weekKey: "2026-W09", salary: 47000 },
      { weekKey: "2026-W10", salary: 49000 },
      { weekKey: "2026-W11", salary: 50000 },
    ],
    teamCountryName: "USA",
  });

  assert.equal(projection.currentSalary, 50000);
  assert.equal(projection.projectedSalary, 51500);
  assert.equal(projection.trend, "UP");
  assert.equal(projection.isFlagTarget, true);
});
