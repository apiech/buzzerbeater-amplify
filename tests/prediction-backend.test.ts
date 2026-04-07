import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePredictionRequest,
  processPredictionJob,
  submitPredictionJob,
} from "../amplify/data/_backend/prediction";

const predictionInput = {
  home_outsideScoring: 8,
  home_insideScoring: 8,
  home_outsideDefense: 8,
  home_insideDefense: 8,
  home_rebounding: 8,
  home_offensiveFlow: 8,
  away_outsideScoring: 7,
  away_insideScoring: 7,
  away_outsideDefense: 7,
  away_insideDefense: 7,
  away_rebounding: 7,
  away_offensiveFlow: 7,
  home_gdp_focus: "N/A",
  home_gdp_pace: "N/A",
  away_gdp_focus: "N/A",
  away_gdp_pace: "N/A",
  neutral: "0",
  effortDelta: -1,
};

const legacyGdpPredictionInput = {
  ...predictionInput,
  away_gdp_focus: "Balanced.hit",
  away_gdp_pace: "Normal.hit",
};

const forecastContext = {
  evidence: ["Analog consensus"],
  forecastGeneratedAt: "2026-03-19T00:00:00.000Z",
  forecastJobId: "job-1",
  forecastModelVersion: "forecast-v1",
  scenarioId: "scenario-1",
  scenarioLabel: "Primary",
  scenarioProbability: 0.62,
  sourceTeamId: "team-1",
};

test("normalizePredictionRequest accepts the editable grid payload and provenance", () => {
  const normalized = normalizePredictionRequest({
    forecastContext,
    input: legacyGdpPredictionInput,
  });

  assert.deepStrictEqual(normalized, {
    forecastContext: {
      ...forecastContext,
      enthusiasmBand: null,
    },
    input: predictionInput,
  });
});

test("normalizePredictionRequest rejects non-object inputs", () => {
  assert.throws(
    () => normalizePredictionRequest(null),
    /prediction request must be a json object/i,
  );
});

test("submitPredictionJob rejects free-plan users before queueing work", async () => {
  await assert.rejects(
    () =>
      submitPredictionJob(
        {
          env: {},
          identity: { sub: "user-1" },
          request: { input: predictionInput },
          stateMachineArn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:prediction",
        },
        {
          requireFeatureAccess: async () => {
            throw new Error("Premium is required to use the prediction engine.");
          },
          startWorkflowExecution: async () => {
            throw new Error("startWorkflowExecution should not be called");
          },
          updatePredictionJobIfRequestMatches: async () => true,
          upsertPredictionJob: async () => {
            throw new Error("upsertPredictionJob should not be called");
          },
        },
      ),
    /premium is required/i,
  );
});

test("submitPredictionJob overwrites the current preview with a new request id", async () => {
  const upserts: Array<Record<string, unknown>> = [];
  const queuedMessages: Array<Record<string, string>> = [];
  const deletedGridRequests: string[] = [];

  const first = await submitPredictionJob(
    {
      env: {},
      identity: { sub: "user-1" },
      request: { input: predictionInput },
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:prediction",
    },
        {
          requireFeatureAccess: async () => "premium",
          deletePredictionGridCellsByUserAndRequestId: async (
            _env,
            _userId,
            requestId,
          ) => {
            deletedGridRequests.push(requestId);
          },
          getPredictionJob: async () => null,
          startWorkflowExecution: async (_arn, _name, message) => {
            queuedMessages.push(message);
            return `execution:${message.requestId}`;
          },
      updatePredictionJobIfRequestMatches: async () => true,
      upsertPredictionJob: async (_env, input) => {
        upserts.push(input as Record<string, unknown>);
      },
    },
  );

  const second = await submitPredictionJob(
    {
      env: {},
      identity: { sub: "user-1" },
      request: { forecastContext, input: predictionInput },
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:prediction",
    },
        {
          requireFeatureAccess: async () => "premium",
          deletePredictionGridCellsByUserAndRequestId: async (
            _env,
            _userId,
            requestId,
          ) => {
            deletedGridRequests.push(requestId);
          },
          getPredictionJob: async () =>
            ({
              ...predictionInput,
              requestId: String(first.jobId),
              requestedAt: "2026-03-15T00:00:00.000Z",
              status: "SUCCEEDED",
              userId: "user-1",
            }) as any,
          startWorkflowExecution: async (_arn, _name, message) => {
            queuedMessages.push(message);
            return `execution:${message.requestId}`;
      },
      updatePredictionJobIfRequestMatches: async () => true,
      upsertPredictionJob: async (_env, input) => {
        upserts.push(input as Record<string, unknown>);
      },
    },
  );

  assert.equal(upserts.length, 2);
  const firstUpsert = upserts[0];
  const secondUpsert = upserts[1];
  assert.ok(firstUpsert);
  assert.ok(secondUpsert);
  assert.equal(firstUpsert.userId, "user-1");
  assert.equal(secondUpsert.userId, "user-1");
  assert.equal(firstUpsert.status, "QUEUED");
  assert.equal(secondUpsert.status, "QUEUED");
  assert.notEqual(firstUpsert.requestId, secondUpsert.requestId);
  assert.equal(secondUpsert.error, null);
  assert.equal(secondUpsert.executionArn, null);
  assert.equal(secondUpsert.modelVersion, null);
  assert.equal(secondUpsert.away_gdp_focus, "N/A");
  assert.equal(secondUpsert.away_gdp_pace, "N/A");
  assert.deepStrictEqual(deletedGridRequests, [String(first.jobId)]);
  assert.deepStrictEqual(queuedMessages, [
    {
      requestId: String(first.jobId),
      userId: "user-1",
    },
    {
      requestId: String(second.jobId),
      userId: "user-1",
    },
  ]);
});

test("processPredictionJob ignores stale queue messages", async () => {
  let endpointCalls = 0;
  let updateCalls = 0;

  await processPredictionJob(
    {
      endpointName: "predictor-endpoint",
      env: {},
      message: {
        requestId: "stale-request",
        userId: "user-1",
      },
    },
    {
      getPredictionJob: async () =>
        ({
          ...predictionInput,
          requestId: "current-request",
          requestedAt: "2026-03-15T00:00:00.000Z",
          status: "QUEUED",
          userId: "user-1",
        }) as any,
      invokePredictionEndpoint: async () => {
        endpointCalls += 1;
        return {};
      },
      updatePredictionJobIfRequestMatches: async () => {
        updateCalls += 1;
        return true;
      },
    },
  );

  assert.equal(endpointCalls, 0);
  assert.equal(updateCalls, 0);
});

test("processPredictionJob expands the grid input with fixed hidden tactics", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let endpointInput: Record<string, unknown> | null = null;
  let persistedGridCells: Array<Record<string, unknown>> = [];

  await processPredictionJob(
    {
      endpointName: "predictor-endpoint",
      env: {},
      message: {
        requestId: "request-1",
        userId: "user-1",
      },
    },
    {
      getPredictionJob: async () =>
        ({
          ...predictionInput,
          requestId: "request-1",
          requestedAt: "2026-03-15T00:00:00.000Z",
          status: "QUEUED",
          userId: "user-1",
        }) as any,
      invokePredictionEndpoint: async (_endpointName, resolvedInput) => {
        endpointInput = resolvedInput;
        return {
          awayScore: 94.8,
          homeScore: 101.3,
          modelVersion: "bundle-v1",
          pointDiff: 6.5,
          tacticsGrid: {
            offenses: ["Base", "Motion"],
            defenses: ["ManToMan", "23Zone"],
            cells: [
              [
                {
                  awayDefense: "ManToMan",
                  awayScore: 94.8,
                  homeOffense: "Base",
                  homeScore: 101.3,
                  pointDiff: 6.5,
                },
                {
                  awayDefense: "ManToMan",
                  awayScore: 92.1,
                  homeOffense: "Motion",
                  homeScore: 104.7,
                  pointDiff: 12.6,
                },
              ],
              [
                {
                  awayDefense: "23Zone",
                  awayScore: 96.4,
                  homeOffense: "Base",
                  homeScore: 99.3,
                  pointDiff: 2.9,
                },
                {
                  awayDefense: "23Zone",
                  awayScore: null,
                  homeOffense: "Motion",
                  homeScore: null,
                  pointDiff: null,
                },
              ],
            ],
          },
        };
      },
      updatePredictionJobIfRequestMatches: async (_env, input) => {
        updates.push(input as Record<string, unknown>);
        return true;
      },
      upsertPredictionGridCells: async (_env, records) => {
        persistedGridCells = records as Array<Record<string, unknown>>;
      },
    },
  );

  assert.deepStrictEqual(endpointInput, {
    ...predictionInput,
    away_defStrategy: "ManToMan",
    away_offStrategy: "Base",
    home_defStrategy: "ManToMan",
    home_offStrategy: "Base",
  });
  assert.equal(updates[0]?.status, "RESOLVING_INPUT");
  assert.equal(updates[1]?.status, "INVOKING_MODEL");
  const successUpdate = updates[2];
  assert.ok(successUpdate);
  assert.equal(successUpdate.status, "SUCCEEDED");
  assert.equal(successUpdate.modelVersion, "bundle-v1");
  assert.equal(successUpdate.homeScore, 101.3);
  assert.equal(successUpdate.awayScore, 94.8);
  assert.equal(successUpdate.pointDiff, 6.5);
  assert.equal(persistedGridCells.length, 4);
});

test("processPredictionJob accepts a partial grid when one valid cell exists", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let persistedGridCells: Array<Record<string, unknown>> = [];

  await processPredictionJob(
    {
      endpointName: "predictor-endpoint",
      env: {},
      message: {
        requestId: "request-1",
        userId: "user-1",
      },
    },
    {
      getPredictionJob: async () =>
        ({
          ...predictionInput,
          requestId: "request-1",
          requestedAt: "2026-03-15T00:00:00.000Z",
          status: "QUEUED",
          userId: "user-1",
        }) as any,
      invokePredictionEndpoint: async () => ({
        modelVersion: "bundle-v1",
        tacticsGrid: {
          offenses: ["Base", "Motion"],
          defenses: ["ManToMan", "23Zone"],
          cells: [
            [
              {
                awayDefense: "ManToMan",
                awayScore: 94.8,
                homeOffense: "Base",
                homeScore: 101.3,
                pointDiff: 6.5,
              },
            ],
            [],
          ],
        },
      }),
      updatePredictionJobIfRequestMatches: async (_env, input) => {
        updates.push(input as Record<string, unknown>);
        return true;
      },
      upsertPredictionGridCells: async (_env, records) => {
        persistedGridCells = records as Array<Record<string, unknown>>;
      },
    },
  );

  const successUpdate = updates[2];
  assert.ok(successUpdate);
  assert.equal(successUpdate.status, "SUCCEEDED");
  assert.equal(successUpdate.modelVersion, "bundle-v1");
  assert.equal(persistedGridCells.length, 1);
});

test("processPredictionJob fails when the predictor response has no renderable grid", async () => {
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
          getPredictionJob: async () =>
            ({
              ...predictionInput,
              requestId: "request-1",
              requestedAt: "2026-03-15T00:00:00.000Z",
              status: "QUEUED",
              userId: "user-1",
            }) as any,
          invokePredictionEndpoint: async () => ({
            awayScore: 94.8,
            homeScore: 101.3,
            modelVersion: "bundle-v1",
            pointDiff: 6.5,
          }),
          updatePredictionJobIfRequestMatches: async (_env, input) => {
            updates.push(input as Record<string, unknown>);
            return true;
          },
        },
      ),
    /invalid|tactics-grid cells|tacticsGrid/i,
  );

  const failedUpdate = updates[2];
  assert.ok(failedUpdate);
  assert.equal(failedUpdate.status, "FAILED");
  assert.match(String(failedUpdate.error), /invalid|tactics-grid cells|tacticsGrid/i);
});
