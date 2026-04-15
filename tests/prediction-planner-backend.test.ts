import assert from "node:assert/strict";
import test from "node:test";

import {
  invokePlannerRequests,
  mergePlannerResponses,
  type PlannerInvocationResponse,
} from "../amplify/data/_backend/prediction-planner";

function createPlannerResponse(pairIds: string[], viewId: string) {
  return {
    expectedMatrix: {
      label: "Expected",
      probability: 1,
      rows: [
        {
          cells: pairIds.map((pairId, index) => ({
            available: true,
            bestEffortChoice: "Normal",
            ourPairId: pairId,
            opponentPairId: "opp-1",
            predictedOpponentScore: 80 + index,
            predictedPointDiff: 5 + index,
            predictedTeamScore: 85 + index,
          })),
          opponentPairId: "opp-1",
        },
      ],
      scenarioId: null,
      viewId,
    },
    modelVersion: "planner-v1",
    planEvaluations: pairIds.map((pairId, index) => ({
      defense: "Man to man",
      effortChoice: "Normal",
      effortCost: 1,
      effortValue: 0,
      offense: "Base Offense",
      pairId,
      scenarioResults: [
        {
          available: true,
          predictedOpponentScore: 80 + index,
          predictedPointDiff: 5 + index,
          predictedTeamScore: 85 + index,
          scenarioId: "scenario-a",
        },
      ],
    })),
    scenarioMatrices: [
      {
        label: "Scenario A",
        probability: 1,
        rows: [
          {
            cells: pairIds.map((pairId, index) => ({
              available: true,
              bestEffortChoice: "Normal",
              ourPairId: pairId,
              opponentPairId: "opp-1",
              predictedOpponentScore: 80 + index,
              predictedPointDiff: 5 + index,
              predictedTeamScore: 85 + index,
            })),
            opponentPairId: "opp-1",
          },
        ],
        scenarioId: "scenario-a",
        viewId: "scenario-a",
      },
    ],
  };
}

test("invokePlannerRequests parses planner chunks and reports completion progress", async () => {
  const completedRequestIds: string[] = [];

  const responses = await invokePlannerRequests({
    concurrency: 2,
    endpointName: "planner-endpoint",
    invokePredictionEndpoint: async (_endpointName, payload) => {
      const pairIds =
        (payload as {
          plannerRequest?: {
            ourPairs?: Array<{ pairId?: string }>;
          };
        }).plannerRequest?.ourPairs?.map((pair) => pair.pairId ?? "") ?? [];
      return createPlannerResponse(pairIds, "expected");
    },
    onRequestCompleted: async (result) => {
      completedRequestIds.push(result.requestId);
    },
    requests: [
      {
        payload: {
          plannerRequest: {
            ourPairs: [{ pairId: "pair-1" }, { pairId: "pair-2" }],
          },
        },
        requestId: "chunk-1",
      },
      {
        payload: {
          plannerRequest: {
            ourPairs: [{ pairId: "pair-3" }],
          },
        },
        requestId: "chunk-2",
      },
    ],
  });

  assert.equal(responses.length, 2);
  assert.deepEqual(completedRequestIds.sort(), ["chunk-1", "chunk-2"]);
  assert.equal(responses[0]?.response.planEvaluations.length, 2);
  assert.equal(responses[1]?.response.planEvaluations.length, 1);
});

test("mergePlannerResponses preserves requested planner chunk order", () => {
  const responses: PlannerInvocationResponse[] = [
    {
      elapsedMs: 10,
      payloadBytes: 128,
      requestId: "chunk-1",
      response: createPlannerResponse(["pair-1", "pair-2"], "expected"),
    },
    {
      elapsedMs: 12,
      payloadBytes: 96,
      requestId: "chunk-2",
      response: createPlannerResponse(["pair-3"], "expected"),
    },
  ];

  const merged = mergePlannerResponses({
    orderedRequestIds: ["chunk-2", "chunk-1"],
    responses,
  });

  assert.deepEqual(
    merged.planEvaluations.map((evaluation) => evaluation.pairId),
    ["pair-3", "pair-1", "pair-2"],
  );
  assert.deepEqual(
    merged.expectedMatrix.rows[0]?.cells.map((cell) => cell.ourPairId),
    ["pair-3", "pair-1", "pair-2"],
  );
  assert.deepEqual(
    merged.scenarioMatrices[0]?.rows[0]?.cells.map((cell) => cell.ourPairId),
    ["pair-3", "pair-1", "pair-2"],
  );
});
