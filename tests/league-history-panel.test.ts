import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canDisplayLeagueHistoryRows,
  describeLeagueHistoryStatus,
  hasActiveLeagueHistoryBackfill,
  sortLeagueHistoryRows,
} from "../app/league-history-panel";
import type {
  LeagueHistoryBackfillStatus,
  LeagueHistoryPayload,
  LeagueHistoryRow,
} from "../app/types";

const currentDir = dirname(fileURLToPath(import.meta.url));

test("hasActiveLeagueHistoryBackfill recognizes active worker states", () => {
  assert.equal(hasActiveLeagueHistoryBackfill(createStatus("QUEUED")), true);
  assert.equal(
    hasActiveLeagueHistoryBackfill(createStatus("FETCHING_STANDINGS")),
    true,
  );
  assert.equal(hasActiveLeagueHistoryBackfill(createStatus("SUCCEEDED")), false);
});

test("league history rows stay hidden until the backfill succeeds", () => {
  assert.equal(
    canDisplayLeagueHistoryRows(
      createPayload({
        status: createStatus("FETCHING_STANDINGS"),
      }),
    ),
    false,
  );
  assert.equal(
    canDisplayLeagueHistoryRows(
      createPayload({
        status: createStatus("SUCCEEDED"),
      }),
    ),
    true,
  );
});

test("sortLeagueHistoryRows defaults to wins, then win percentage, then margin", () => {
  const rows = sortLeagueHistoryRows(
    [
      createRow({
        pointMargin: 100,
        teamId: "B",
        teamName: "Beta",
        winPct: 0.75,
        wins: 18,
      }),
      createRow({
        pointMargin: 130,
        teamId: "A",
        teamName: "Alpha",
        winPct: 0.8,
        wins: 18,
      }),
      createRow({
        pointMargin: 200,
        teamId: "C",
        teamName: "Gamma",
        winPct: 0.82,
        wins: 20,
      }),
    ],
    {
      direction: "desc",
      key: "wins",
    },
  );

  assert.deepStrictEqual(
    rows.map((row) => row.teamId),
    ["C", "A", "B"],
  );
});

test("describeLeagueHistoryStatus stays user-facing during progress and failure states", () => {
  assert.match(
    describeLeagueHistoryStatus(createStatus("FETCHING_STANDINGS", {
      historicalSeasonsExpected: 10,
      historicalSeasonsStored: 4,
    }), {
      isLoading: false,
      leagueId: "L1",
    }),
    /stored 4 of 10 completed seasons/i,
  );

  assert.match(
    describeLeagueHistoryStatus(createStatus("FAILED", {
      error: "League could not be loaded.",
    }), {
      isLoading: false,
      leagueId: "L1",
    }),
    /failed/i,
  );
});

test("league history silently polls active backfills without browser realtime subscriptions", () => {
  const source = readFileSync(
    join(currentDir, "..", "app", "league-history-panel.tsx"),
    "utf8",
  );

  assert.match(source, /useQuery\(/);
  assert.match(source, /leagueHistoryQueryOptions/);
  assert.match(source, /refetchInterval: \(query\) =>/);
  assert.match(
    source,
    /hasActiveLeagueHistoryBackfill\(query\.state\.data\?\.status \?\? null\)/,
  );
  assert.match(source, /ensureBackfill: false/);
  assert.doesNotMatch(source, /amplify-realtime/);
  assert.doesNotMatch(source, /getRealtimeClient/);
  assert.doesNotMatch(source, /\.subscribe\(/);
});

function createStatus(
  status: LeagueHistoryBackfillStatus["status"],
  overrides: Partial<LeagueHistoryBackfillStatus> = {},
): LeagueHistoryBackfillStatus {
  return {
    completedAt: null,
    error: null,
    historicalSeasonsExpected: 3,
    historicalSeasonsStored: 3,
    lastCompletedSeason: 71,
    leagueId: "L1",
    leagueName: "League One",
    requestedAt: "2026-03-19T12:00:00.000Z",
    startedAt: "2026-03-19T12:01:00.000Z",
    status,
    updatedAt: "2026-03-19T12:02:00.000Z",
    ...overrides,
  };
}

function createPayload(
  overrides: Partial<LeagueHistoryPayload> = {},
): LeagueHistoryPayload {
  return {
    league: {
      id: "L1",
      name: "League One",
    },
    requestedLeagueId: null,
    rows: [createRow()],
    status: createStatus("SUCCEEDED"),
    summary: {
      currentSeason: 72,
      historicalSeasonsStored: 3,
      totalTeams: 1,
    },
    warning: null,
    ...overrides,
  };
}

function createRow(overrides: Partial<LeagueHistoryRow> = {}): LeagueHistoryRow {
  return {
    averageMargin: 5,
    games: 20,
    losses: 5,
    pa: 1500,
    pf: 1600,
    pointMargin: 100,
    seasons: 2,
    teamId: "T1",
    teamName: "Team One",
    winPct: 0.75,
    wins: 15,
    ...overrides,
  };
}
