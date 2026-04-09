import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  describeHighlightsEmptyState,
  describeScanStatus,
  getTeamHighlightsScanActionLabel,
  hasActiveTeamHighlightsScan,
  hasRecordedTeamHighlightsHistory,
  isReconnectRequiredHighlightsError,
  isTeamHighlightsScanStale,
} from "../app/highlights-panel";
import type { TeamHighlightsPayload, TeamHighlightsScanStatus } from "../app/types";

const currentDir = dirname(fileURLToPath(import.meta.url));

function createScanStatus(
  status: TeamHighlightsScanStatus["status"],
  overrides: Partial<TeamHighlightsScanStatus> = {},
): TeamHighlightsScanStatus {
  return {
    brokenMatches: [],
    completedAt: null,
    currentSeason: null,
    errorCode: null,
    error: null,
    matchesAlreadyRecorded: null,
    matchesCompleted: null,
    matchesDiscovered: null,
    matchesEnqueuedForIngest: null,
    matchesEnqueuedForMaterialize: null,
    matchesFailed: null,
    matchesProcessedThisRun: null,
    matchesReused: null,
    matchesWithMoments: null,
    matchesWithoutMoments: null,
    momentsWritten: null,
    requestedAt: "2026-03-15T12:00:00.000Z",
    seasonsFrom: null,
    seasonsTo: null,
    startedAt: null,
    status,
    teamId: "team-1",
    teamName: "Alpha",
    unsupportedSeasonsWarning: null,
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
  assert.equal(
    hasActiveTeamHighlightsScan(createScanStatus("WAITING_FOR_MATCH_JOBS")),
    true,
  );
  assert.equal(hasActiveTeamHighlightsScan(createScanStatus("SUCCEEDED")), false);
});

test("isTeamHighlightsScanStale only trips for outdated active scans", () => {
  assert.equal(
    isTeamHighlightsScanStale(
      createScanStatus("WAITING_FOR_MATCH_JOBS", {
        requestedAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
      }),
    ),
    true,
  );
  assert.equal(
    isTeamHighlightsScanStale(createScanStatus("SUCCEEDED")),
    false,
  );
});

test("hasRecordedTeamHighlightsHistory recognizes initialized coverage", () => {
  assert.equal(
    hasRecordedTeamHighlightsHistory(createScanStatus("SUCCEEDED")),
    true,
  );
  assert.equal(
    hasRecordedTeamHighlightsHistory(
      createScanStatus("FAILED", {
        matchesAlreadyRecorded: 0,
        matchesProcessedThisRun: 0,
      }),
    ),
    false,
  );
  assert.equal(
    hasRecordedTeamHighlightsHistory(
      createScanStatus("FAILED", {
        matchesProcessedThisRun: 2,
      }),
    ),
    true,
  );
});

test("describeHighlightsEmptyState guides the user through empty and active states", () => {
  assert.match(
    describeHighlightsEmptyState(null, {
      isLoading: true,
      isScanStale: false,
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
        isScanStale: false,
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
        isScanStale: false,
        onlyOutcomeChange: true,
      },
    ),
    /none match the current outcome-change filter/i,
  );

  assert.match(
    describeHighlightsEmptyState(
      createPayload({
        scanStatus: createScanStatus("WAITING_FOR_MATCH_JOBS", {
          requestedAt: "2000-01-01T00:00:00.000Z",
          updatedAt: "2000-01-01T00:00:00.000Z",
        }),
      }),
      {
        isLoading: false,
        isScanStale: true,
        onlyOutcomeChange: true,
      },
    ),
    /stopped updating/i,
  );

  assert.match(
    describeHighlightsEmptyState(
      createPayload({
        scanStatus: createScanStatus("FAILED", {
          errorCode: "reconnect_required",
          error:
            "Reconnect BuzzerBeater: the saved credential for this environment can no longer be decrypted.",
        }),
      }),
      {
        isLoading: false,
        isScanStale: false,
        onlyOutcomeChange: true,
      },
    ),
    /reconnect buzzerbeater/i,
  );
});

test("isReconnectRequiredHighlightsError recognizes credential drift failures", () => {
  assert.equal(
    isReconnectRequiredHighlightsError(
      "Reconnect BuzzerBeater: the saved credential for this environment can no longer be decrypted.",
    ),
    true,
  );
  assert.equal(
    isReconnectRequiredHighlightsError("The request failed."),
    false,
  );
  assert.equal(
    isReconnectRequiredHighlightsError(
      "BuzzerBeater credential secret mismatch: the saved credential was encrypted with a different environment secret.",
      "secret_mismatch",
    ),
    false,
  );
});

test("describeScanStatus stays user-facing", () => {
  const description = describeScanStatus(
    createScanStatus("RESOLVING_HISTORY", {
      matchesDiscovered: 24,
      matchesAlreadyRecorded: 6,
      matchesProcessedThisRun: 18,
      matchesWithMoments: 10,
      matchesWithoutMoments: 8,
      momentsWritten: 14,
      seasonsFrom: 50,
      seasonsTo: 52,
    }),
  );

  assert.match(description, /found 24 completed games/i);
  assert.match(
    description,
    /6 games were already recorded for this team before this run/i,
  );
  assert.match(description, /18 games were processed in this run/i);
  assert.match(
    description,
    /10 processed games produced at least one saved moment/i,
  );
  assert.match(description, /14 moments were written in this run/i);
  assert.doesNotMatch(description, /ingest|materialize|backfill/i);

  const waitingDescription = describeScanStatus(
    createScanStatus("WAITING_FOR_MATCH_JOBS", {
      matchesProcessedThisRun: 3,
      matchesFailed: 1,
      matchesAlreadyRecorded: 6,
      matchesDiscovered: 24,
      seasonsFrom: 50,
      seasonsTo: 52,
    }),
  );
  assert.match(
    waitingDescription,
    /6 games were already recorded for this team before this run/i,
  );
  assert.match(waitingDescription, /3 games were processed in this run/i);
  assert.doesNotMatch(waitingDescription, /ingest|materialize|backfill/i);

  const gapsDescription = describeScanStatus(
    createScanStatus("COMPLETED_WITH_GAPS", {
      brokenMatches: [
        {
          awayTeamName: "Great 8",
          boxscoreUrl: "https://www.buzzerbeater.com/match/1006000001/boxscore.aspx",
          homeTeamName: "Big 8",
          issue: "BBXmlApiError: ServerError (boxscore.aspx)",
          matchId: "1006000001",
          matchType: "unknown",
          season: 8,
          startTime: "2009-04-16T00:00:00.000Z",
        },
      ],
      matchesDiscovered: 24,
      matchesAlreadyRecorded: 6,
      seasonsFrom: 50,
      seasonsTo: 52,
    }),
  );
  assert.match(
    gapsDescription,
    /could not be prepared from buzzerbeater data/i,
  );

  const reconnectFailureDescription = describeScanStatus(
    createScanStatus("FAILED", {
      errorCode: "reconnect_required",
      error:
        "Reconnect BuzzerBeater: the saved credential for this environment can no longer be decrypted.",
    }),
  );
  assert.match(
    reconnectFailureDescription,
    /credential for this environment can no longer be decrypted/i,
  );

  const secretMismatchDescription = describeScanStatus(
    createScanStatus("FAILED", {
      errorCode: "secret_mismatch",
      error:
        "BuzzerBeater credential secret mismatch: the saved credential was encrypted with a different environment secret.",
    }),
  );
  assert.match(
    secretMismatchDescription,
    /different environment secret/i,
  );
});

test("scan action label matches scan lifecycle states", () => {
  assert.equal(
    getTeamHighlightsScanActionLabel(createScanStatus("QUEUED"), {
      hasActiveScan: true,
      hasRecordedHistory: false,
      isScanStale: false,
    }),
    "Scan running",
  );
  assert.equal(
    getTeamHighlightsScanActionLabel(createScanStatus("FAILED"), {
      hasActiveScan: false,
      hasRecordedHistory: false,
      isScanStale: false,
    }),
    "Retry scan",
  );
  assert.equal(
    getTeamHighlightsScanActionLabel(createScanStatus("WAITING_FOR_MATCH_JOBS"), {
      hasActiveScan: false,
      hasRecordedHistory: false,
      isScanStale: true,
    }),
    "Retry scan",
  );
  assert.equal(
    getTeamHighlightsScanActionLabel(createScanStatus("COMPLETED_WITH_GAPS"), {
      hasActiveScan: false,
      hasRecordedHistory: true,
      isScanStale: false,
    }),
    "Extend history",
  );
  assert.equal(
    getTeamHighlightsScanActionLabel(createScanStatus("SUCCEEDED"), {
      hasActiveScan: false,
      hasRecordedHistory: true,
      isScanStale: false,
    }),
    "Extend history",
  );
  assert.equal(
    getTeamHighlightsScanActionLabel(null, {
      hasActiveScan: false,
      hasRecordedHistory: false,
      isScanStale: false,
    }),
    "Scan history",
  );
});

test("highlights panel polls active scans silently", () => {
  const source = readFileSync(
    join(currentDir, "..", "app", "highlights-panel.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /\bRefresh\b/);
  assert.match(source, /window\.setInterval/);
  assert.match(source, /loadHighlightsEffect\(\{ silent: true \}\)/);
  assert.match(source, /Clear data/);
  assert.match(source, /\bTry again\b/);
  assert.match(source, /label=\"Found\"/);
  assert.match(source, /label=\"Already recorded\"/);
  assert.match(source, /label=\"Processed this run\"/);
  assert.match(source, /label=\"Moments written\"/);
  assert.match(
    source,
    /ended before all moments were[\s\S]*Retry it to start a fresh run\./,
  );
  assert.match(
    source,
    /Reconnect BuzzerBeater in this environment and then rerun the scan\./,
  );
  assert.match(
    source,
    /different BB credential secret than the one that encrypted the saved credential/i,
  );
  assert.match(source, /Moments are ready for the rest of your history/);
  assert.match(source, /could not be prepared from BuzzerBeater data/);
  assert.match(source, /Open viewer/);
  assert.match(source, /target="_blank"/);
});
