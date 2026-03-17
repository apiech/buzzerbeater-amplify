import assert from "node:assert/strict";
import test from "node:test";

import {
  describeHighlightsEmptyState,
  describeScanStatus,
  hasActiveTeamHighlightsScan,
} from "../app/highlights-panel";
import type { TeamHighlightsPayload, TeamHighlightsScanStatus } from "../app/types";

function createScanStatus(
  status: string,
  overrides: Partial<TeamHighlightsScanStatus> = {},
): TeamHighlightsScanStatus {
  return {
    completedAt: null,
    error: null,
    matchesDiscovered: null,
    matchesEnqueuedForIngest: null,
    matchesEnqueuedForMaterialize: null,
    matchesReused: null,
    requestedAt: "2026-03-15T12:00:00.000Z",
    seasonsFrom: null,
    seasonsTo: null,
    startedAt: null,
    status,
    teamId: "team-1",
    teamName: "Alpha",
    updatedAt: "2026-03-15T12:00:00.000Z",
    ...overrides,
  };
}

function createPayload(
  overrides: Partial<TeamHighlightsPayload> = {},
): TeamHighlightsPayload {
  return {
    filters: {
      onlyOutcomeChange: true,
      perspective: "BOTH" as TeamHighlightsPayload["filters"]["perspective"],
    },
    items: [],
    nextCursor: null,
    scanStatus: createScanStatus("SUCCEEDED"),
    summary: {
      againstMoments: 0,
      filteredMoments: 0,
      forMoments: 0,
      outcomeChangeMoments: 0,
      totalMoments: 0,
    },
    team: {
      teamId: "team-1",
      teamName: "Alpha",
    },
    ...overrides,
  };
}

test("hasActiveTeamHighlightsScan recognizes non-terminal scan states", () => {
  assert.equal(hasActiveTeamHighlightsScan(createScanStatus("QUEUED")), true);
  assert.equal(
    hasActiveTeamHighlightsScan(createScanStatus("ENQUEUING_MATCHES")),
    true,
  );
  assert.equal(hasActiveTeamHighlightsScan(createScanStatus("SUCCEEDED")), false);
});

test("describeHighlightsEmptyState guides the user through empty and active states", () => {
  assert.match(
    describeHighlightsEmptyState(null, {
      isLoading: true,
      onlyOutcomeChange: true,
    }),
    /loading the latest moments/i,
  );

  assert.match(
    describeHighlightsEmptyState(
      createPayload({
        scanStatus: createScanStatus("QUEUED"),
      }),
      {
        isLoading: false,
        onlyOutcomeChange: true,
      },
    ),
    /scanning team history/i,
  );

  assert.match(
    describeHighlightsEmptyState(
      createPayload({
        summary: {
          againstMoments: 3,
          filteredMoments: 0,
          forMoments: 4,
          outcomeChangeMoments: 5,
          totalMoments: 7,
        },
      }),
      {
        isLoading: false,
        onlyOutcomeChange: true,
      },
    ),
    /none match the current outcome-change filter/i,
  );
});

test("describeScanStatus stays user-facing", () => {
  const description = describeScanStatus(
    createScanStatus("RESOLVING_HISTORY", {
      matchesDiscovered: 24,
      matchesReused: 6,
      seasonsFrom: 50,
      seasonsTo: 52,
    }),
  );

  assert.match(description, /found 24 completed games/i);
  assert.match(description, /6 games were already ready/i);
  assert.doesNotMatch(description, /ingest|materialize|backfill/i);
});
