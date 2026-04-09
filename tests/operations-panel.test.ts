import assert from "node:assert/strict";
import test from "node:test";

import { hasActiveOperationsActivity } from "../app/operations-panel";
import type {
  CurrentPredictionPreview,
  GameDayRecapRecord,
  LeagueGameDayRecapRecord,
  SingleGameSummaryRecord,
  SyncRunRecord,
} from "../app/types";

test("hasActiveOperationsActivity stays idle when every activity is terminal", () => {
  assert.equal(
    hasActiveOperationsActivity({
      currentPrediction: createPrediction("SUCCEEDED"),
      gameDayRecaps: [createGameDayRecap("SUCCEEDED")],
      leagueGameDayRecaps: [createLeagueGameDayRecap("FAILED")],
      singleGameSummaries: [createSingleGameSummary("SUCCEEDED")],
      syncRuns: [createSyncRun("IDLE")],
    }),
    false,
  );
});

test("hasActiveOperationsActivity detects active sync, prediction, and recap work", () => {
  assert.equal(
    hasActiveOperationsActivity({
      currentPrediction: null,
      gameDayRecaps: [],
      leagueGameDayRecaps: [],
      singleGameSummaries: [],
      syncRuns: [createSyncRun("SYNCING")],
    }),
    true,
  );

  assert.equal(
    hasActiveOperationsActivity({
      currentPrediction: createPrediction("INVOKING_MODEL"),
      gameDayRecaps: [],
      leagueGameDayRecaps: [],
      singleGameSummaries: [],
      syncRuns: [createSyncRun("IDLE")],
    }),
    true,
  );

  assert.equal(
    hasActiveOperationsActivity({
      currentPrediction: null,
      gameDayRecaps: [createGameDayRecap("BUILDING_CONTEXT")],
      leagueGameDayRecaps: [],
      singleGameSummaries: [],
      syncRuns: [createSyncRun("IDLE")],
    }),
    true,
  );
});

function createPrediction(
  status: CurrentPredictionPreview["status"],
): CurrentPredictionPreview {
  return {
    status,
  } as CurrentPredictionPreview;
}

function createSyncRun(status: SyncRunRecord["status"]): SyncRunRecord {
  return {
    status,
  } as SyncRunRecord;
}

function createGameDayRecap(
  status: GameDayRecapRecord["status"],
): GameDayRecapRecord {
  return {
    status,
  } as GameDayRecapRecord;
}

function createLeagueGameDayRecap(
  status: LeagueGameDayRecapRecord["status"],
): LeagueGameDayRecapRecord {
  return {
    status,
  } as LeagueGameDayRecapRecord;
}

function createSingleGameSummary(
  status: SingleGameSummaryRecord["status"],
): SingleGameSummaryRecord {
  return {
    status,
  } as SingleGameSummaryRecord;
}
