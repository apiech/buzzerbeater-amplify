import assert from "node:assert/strict";
import test from "node:test";

import {
  processGameDayRecap,
  submitGameDayRecap,
} from "../amplify/data/_backend/game-day-recap";
import {
  getLeagueHistory,
  processLeagueHistoryBackfill,
  submitLeagueHistoryBackfill,
} from "../amplify/data/_backend/league-history";
import {
  processOpponentForecastJob,
  submitOpponentForecastJob,
} from "../amplify/data/_backend/opponent-forecast";
import {
  processPredictionJob,
  submitPredictionJob,
} from "../amplify/data/_backend/prediction";
import { MaintenanceModeError } from "../lib/maintenance/control-plane";

function createMaintenanceError() {
  return new MaintenanceModeError({
    activatedAt: "2026-04-08T12:00:00.000Z",
    activatedBy: "ops",
    detail: "Budget exhausted.",
    headline: "Budget exhausted",
    mode: "FULL_SITE",
    reasonCode: "BUDGET_GUARDRAIL",
    scope: "SITE",
    source: "MANUAL",
    expectedRecoveryAt: null,
    triggerId: null,
    triggerService: null,
  });
}

test("prediction jobs reject new work and persist maintenance failures", async () => {
  await assert.rejects(
    () =>
      submitPredictionJob(
        {
          env: {},
          identity: { sub: "user-1" },
          request: {
            input: {
              away_gdp_focus: "N/A",
              away_gdp_pace: "N/A",
              away_insideDefense: 7,
              away_insideScoring: 7,
              away_offensiveFlow: 7,
              away_outsideDefense: 7,
              away_outsideScoring: 7,
              away_rebounding: 7,
              effortDelta: 0,
              home_gdp_focus: "N/A",
              home_gdp_pace: "N/A",
              home_insideDefense: 8,
              home_insideScoring: 8,
              home_offensiveFlow: 8,
              home_outsideDefense: 8,
              home_outsideScoring: 8,
              home_rebounding: 8,
              neutral: "0",
            },
          },
          stateMachineArn:
            "arn:aws:states:us-east-1:123:stateMachine:prediction",
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          requireFeatureAccess: async () => {
            throw new Error("should not reach feature access");
          },
          startWorkflowExecution: async () => {
            throw new Error("should not queue");
          },
          updatePredictionJobIfRequestMatches: async () => true,
          upsertPredictionJob: async () => {
            throw new Error("should not persist queued job");
          },
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );

  const updates: Array<Record<string, unknown>> = [];
  await assert.rejects(
    () =>
      processPredictionJob(
        {
          endpointName: "predictor-endpoint",
          env: {},
          message: {
            requestId: "request-1",
            userId: "user-1",
          },
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          deletePredictionGridCellsByUserAndRequestId: async () => {},
          getPredictionJob: async () =>
            ({
              away_gdp_focus: "N/A",
              away_gdp_pace: "N/A",
              away_insideDefense: 7,
              away_insideScoring: 7,
              away_offensiveFlow: 7,
              away_outsideDefense: 7,
              away_outsideScoring: 7,
              away_rebounding: 7,
              effortDelta: 0,
              home_gdp_focus: "N/A",
              home_gdp_pace: "N/A",
              home_insideDefense: 8,
              home_insideScoring: 8,
              home_offensiveFlow: 8,
              home_outsideDefense: 8,
              home_outsideScoring: 8,
              home_rebounding: 8,
              neutral: "0",
              requestId: "request-1",
              userId: "user-1",
            }) as never,
          updatePredictionJobIfRequestMatches: async (_env, input) => {
            updates.push(input as Record<string, unknown>);
            return true;
          },
          upsertPredictionGridCells: async () => {},
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );
  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.match(String(updates.at(-1)?.error), /^MAINTENANCE:BUDGET_GUARDRAIL/);
});

test("opponent forecast jobs reject new work and persist maintenance failures", async () => {
  await assert.rejects(
    () =>
      submitOpponentForecastJob(
        {
          env: {},
          identity: { sub: "user-1" },
          stateMachineArn:
            "arn:aws:states:us-east-1:123:stateMachine:opponent-forecast",
          teamId: "200",
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          createOpponentForecastJob: async () => {
            throw new Error("should not create job");
          },
          requireFeatureAccess: async () => {
            throw new Error("should not reach feature access");
          },
          startWorkflowExecution: async () => {
            throw new Error("should not queue");
          },
          updateOpponentForecastJob: async () => {},
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );

  const updates: Array<Record<string, unknown>> = [];
  await assert.rejects(
    () =>
      processOpponentForecastJob(
        {
          endpointName: "opponent-forecast-endpoint",
          env: {},
          message: {
            jobId: "job-1",
            userId: "user-1",
          },
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          getOpponentForecastJob: async () =>
            ({
              id: "job-1",
              teamId: "200",
              userId: "user-1",
            }) as never,
          updateOpponentForecastJob: async (_env, input) => {
            updates.push(input as Record<string, unknown>);
          },
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );
  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.match(String(updates.at(-1)?.error), /^MAINTENANCE:BUDGET_GUARDRAIL/);
});

test("league history queries and workers honor maintenance mode", async () => {
  await assert.rejects(
    () =>
      getLeagueHistory(
        {
          env: {},
          identity: { sub: "user-1" },
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          createBbClient: () => {
            throw new Error("should not create bb client");
          },
          getBbConnection: async () => {
            throw new Error("should not resolve request");
          },
          getLeagueHistoryBackfill: async () => null,
          listLeagueHistoryStandingCachesByLeagueId: async () => [],
          resolveBbAccessKey: async () => "",
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );

  await assert.rejects(
    () =>
      submitLeagueHistoryBackfill(
        {
          env: {},
          identity: { sub: "user-1" },
          stateMachineArn:
            "arn:aws:states:us-east-1:123:stateMachine:league-history",
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          createBbClient: () => {
            throw new Error("should not create bb client");
          },
          getBbConnection: async () => {
            throw new Error("should not resolve request");
          },
          getLeagueHistoryBackfill: async () => null,
          listLeagueHistoryStandingCachesByLeagueId: async () => [],
          now: () => new Date("2026-04-08T12:00:00.000Z"),
          resolveBbAccessKey: async () => "",
          startWorkflowExecution: async () => {
            throw new Error("should not queue");
          },
          upsertLeagueHistoryBackfill: async () => {},
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );

  const updates: Array<Record<string, unknown>> = [];
  await assert.rejects(
    () =>
      processLeagueHistoryBackfill(
        {
          env: {},
          message: {
            leagueId: "100",
            requestedAt: "2026-04-08T12:00:00.000Z",
            userId: "user-1",
          },
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          createBbClient: () => {
            throw new Error("should not create bb client");
          },
          getBbConnection: async () =>
            ({
              bbLoginName: "coach",
              leagueId: "100",
              leagueName: "Elite League",
            }) as never,
          getLeagueHistoryBackfill: async () => null,
          listLeagueHistoryStandingCachesByLeagueId: async () => [],
          now: () => new Date("2026-04-08T12:00:00.000Z"),
          resolveBbAccessKey: async () => "secret",
          upsertLeagueHistoryBackfill: async (_env, input) => {
            updates.push(input as Record<string, unknown>);
          },
          upsertLeagueHistoryStandingCache: async () => {},
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );
  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.match(String(updates.at(-1)?.error), /^MAINTENANCE:BUDGET_GUARDRAIL/);
});

test("game day recap jobs reject new work and persist maintenance failures", async () => {
  await assert.rejects(
    () =>
      submitGameDayRecap(
        {
          env: {
            GAME_DAY_RECAP_MODEL_ID:
              "us.anthropic.claude-haiku-4-5-20251001-v1:0",
          },
          gameDate: "2026-04-08",
          identity: { sub: "user-1" },
          leagueId: "100",
          stateMachineArn:
            "arn:aws:states:us-east-1:123:stateMachine:game-day-recap",
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          getGameDayRecap: async () => null,
          getLeagueGameDayRecap: async () => null,
          getSingleGameSummary: async () => null,
          now: () => new Date("2026-04-08T12:00:00.000Z"),
          requireFeatureAccess: async () => {
            throw new Error("should not reach feature access");
          },
          startWorkflowExecution: async () => {
            throw new Error("should not queue");
          },
          updateGameDayRecap: async () => {},
          updateLeagueGameDayRecap: async () => {},
          updateSingleGameSummary: async () => {},
          upsertGameDayRecap: async () => {},
          upsertLeagueGameDayRecap: async () => {},
          upsertSingleGameSummary: async () => {},
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );

  const updates: Array<Record<string, unknown>> = [];
  await assert.rejects(
    () =>
      processGameDayRecap(
        {
          env: {},
          message: {
            kind: "LEAGUE_DATE",
            requestedAt: "2026-04-08T12:00:00.000Z",
            targetKey: "100#2026-04-08",
            userId: "user-1",
          },
          modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        },
        {
          assertMaintenanceInactive: async () => {
            throw createMaintenanceError();
          },
          getGameDayRecap: async () =>
            ({
              gameDate: "2026-04-08",
              leagueId: "100",
              requestedAt: "2026-04-08T12:00:00.000Z",
              targetKey: "100#2026-04-08",
              userId: "user-1",
            }) as never,
          updateGameDayRecap: async (_env, input) => {
            updates.push(input as Record<string, unknown>);
          },
        },
      ),
    /MAINTENANCE:BUDGET_GUARDRAIL/i,
  );
  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.match(String(updates.at(-1)?.error), /^MAINTENANCE:BUDGET_GUARDRAIL/);
});
