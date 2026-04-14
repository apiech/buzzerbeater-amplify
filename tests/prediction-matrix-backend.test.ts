import assert from "node:assert/strict";
import test from "node:test";

import { buildPlannerPairDefinitions } from "../amplify/data/_backend/next-game-recommendation";
import { evaluatePredictionMatrix } from "../amplify/data/_backend/prediction-matrix";

test("evaluatePredictionMatrix accepts an AWSJSON string request payload", async () => {
  const firstPair = buildPlannerPairDefinitions()[0];
  assert.ok(firstPair, "expected at least one planner pair");
  let endpointPayload: Record<string, unknown> | null = null;

  const result = await evaluatePredictionMatrix(
    {
      endpointName: "prediction-endpoint",
      env: {},
      identity: { sub: "user-1" },
      request: JSON.stringify({
        teamA: {
          defense: "Man to Man",
          effortChoice: "Normal",
          offense: "Base",
          ratings: {
            insideDefense: 10,
            insideScoring: 10,
            offensiveFlow: 10,
            outsideDefense: 10,
            outsideScoring: 10,
            rebounding: 10,
          },
          teamId: "our-team",
          teamName: "Our Team",
        },
        teamB: {
          defense: "Man to Man",
          effortChoice: "Normal",
          offense: "Base",
          ratings: {
            insideDefense: 9,
            insideScoring: 9,
            offensiveFlow: 9,
            outsideDefense: 9,
            outsideScoring: 9,
            rebounding: 9,
          },
          teamId: "opp-team",
          teamName: "Opponent",
        },
        modelKey: "catboost",
        venue: "NEUTRAL",
      }),
    },
    {
      assertMaintenanceInactive: async () => {},
      invokePredictionEndpoint: async (_endpointName, payload) => {
        endpointPayload = payload;
        return {
          expectedMatrix: {
            label: "Expected",
            probability: 1,
            rows: [
              {
                cells: [
                  {
                    available: true,
                    bestEffortChoice: "Normal",
                    ourPairId: firstPair.pairId,
                    opponentPairId: firstPair.pairId,
                    predictedOpponentScore: 82,
                    predictedPointDiff: 6,
                    predictedTeamScore: 88,
                  },
                ],
                opponentPairId: firstPair.pairId,
              },
            ],
            scenarioId: null,
            viewId: "expected",
          },
          modelKey: "catboost",
          modelVersion: "matrix-v1",
          planEvaluations: [
            {
              defense: firstPair.displayDefense,
              effortChoice: "Normal",
              effortCost: 0,
              effortValue: 5,
              offense: firstPair.displayOffense,
              pairId: firstPair.pairId,
              scenarioResults: [
                {
                  available: true,
                  predictedOpponentScore: 82,
                  predictedPointDiff: 6,
                  predictedTeamScore: 88,
                  scenarioId: "current",
                },
              ],
            },
          ],
          scenarioMatrices: [
            {
              label: "Current opponent setup",
              probability: 1,
              rows: [
                {
                  cells: [
                    {
                      available: true,
                      bestEffortChoice: "Normal",
                      ourPairId: firstPair.pairId,
                      opponentPairId: firstPair.pairId,
                      predictedOpponentScore: 82,
                      predictedPointDiff: 6,
                      predictedTeamScore: 88,
                    },
                  ],
                  opponentPairId: firstPair.pairId,
                },
              ],
              scenarioId: "current",
              viewId: "current",
            },
          ],
        };
      },
      requireFeatureAccess: async () => {},
    },
  );

  assert.equal(result.modelKey, "catboost");
  assert.equal(result.venue, "NEUTRAL");
  assert.equal(result.selectedTeamAPairId, firstPair.pairId);
  assert.equal(result.selectedTeamBPairId, firstPair.pairId);
  assert.equal(endpointPayload?.modelKey, "catboost");
});

test("evaluatePredictionMatrix omits modelKey when the request uses the bundle default", async () => {
  const firstPair = buildPlannerPairDefinitions()[0];
  assert.ok(firstPair, "expected at least one planner pair");
  let endpointPayload: Record<string, unknown> | null = null;

  await evaluatePredictionMatrix(
    {
      endpointName: "prediction-endpoint",
      env: {},
      identity: { sub: "user-1" },
      request: {
        teamA: {
          defense: "Man to Man",
          effortChoice: "Normal",
          offense: "Base",
          ratings: {
            insideDefense: 10,
            insideScoring: 10,
            offensiveFlow: 10,
            outsideDefense: 10,
            outsideScoring: 10,
            rebounding: 10,
          },
          teamId: "our-team",
          teamName: "Our Team",
        },
        teamB: {
          defense: "Man to Man",
          effortChoice: "Normal",
          offense: "Base",
          ratings: {
            insideDefense: 9,
            insideScoring: 9,
            offensiveFlow: 9,
            outsideDefense: 9,
            outsideScoring: 9,
            rebounding: 9,
          },
          teamId: "opp-team",
          teamName: "Opponent",
        },
        venue: "NEUTRAL",
      },
    },
    {
      assertMaintenanceInactive: async () => {},
      invokePredictionEndpoint: async (_endpointName, payload) => {
        endpointPayload = payload;
        return {
          expectedMatrix: {
            label: "Expected",
            probability: 1,
            rows: [
              {
                cells: [
                  {
                    available: true,
                    bestEffortChoice: "Normal",
                    ourPairId: firstPair.pairId,
                    opponentPairId: firstPair.pairId,
                    predictedOpponentScore: 82,
                    predictedPointDiff: 6,
                    predictedTeamScore: 88,
                  },
                ],
                opponentPairId: firstPair.pairId,
              },
            ],
            scenarioId: null,
            viewId: "expected",
          },
          modelVersion: "matrix-v1",
          planEvaluations: [
            {
              defense: firstPair.displayDefense,
              effortChoice: "Normal",
              effortCost: 0,
              effortValue: 5,
              offense: firstPair.displayOffense,
              pairId: firstPair.pairId,
              scenarioResults: [
                {
                  available: true,
                  predictedOpponentScore: 82,
                  predictedPointDiff: 6,
                  predictedTeamScore: 88,
                  scenarioId: "current",
                },
              ],
            },
          ],
          scenarioMatrices: [
            {
              label: "Current opponent setup",
              probability: 1,
              rows: [
                {
                  cells: [
                    {
                      available: true,
                      bestEffortChoice: "Normal",
                      ourPairId: firstPair.pairId,
                      opponentPairId: firstPair.pairId,
                      predictedOpponentScore: 82,
                      predictedPointDiff: 6,
                      predictedTeamScore: 88,
                    },
                  ],
                  opponentPairId: firstPair.pairId,
                },
              ],
              scenarioId: "current",
              viewId: "current",
            },
          ],
        };
      },
      requireFeatureAccess: async () => {},
    },
  );

  assert.equal(endpointPayload?.modelKey, undefined);
});

test("evaluatePredictionMatrix explains when the predictor endpoint is still on the legacy contract", async () => {
  await assert.rejects(
    () =>
      evaluatePredictionMatrix(
        {
          endpointName: "prediction-endpoint",
          env: {},
          identity: { sub: "user-1" },
          request: {
            teamA: {
              defense: "Man to Man",
              effortChoice: "Normal",
              offense: "Base",
              ratings: {
                insideDefense: 10,
                insideScoring: 10,
                offensiveFlow: 10,
                outsideDefense: 10,
                outsideScoring: 10,
                rebounding: 10,
              },
              teamId: "our-team",
              teamName: "Our Team",
            },
            teamB: {
              defense: "Man to Man",
              effortChoice: "Normal",
              offense: "Base",
              ratings: {
                insideDefense: 9,
                insideScoring: 9,
                offensiveFlow: 9,
                outsideDefense: 9,
                outsideScoring: 9,
                rebounding: 9,
              },
              teamId: "opp-team",
              teamName: "Opponent",
            },
            venue: "NEUTRAL",
          },
        },
        {
          assertMaintenanceInactive: async () => {},
          invokePredictionEndpoint: async () => {
            throw new Error(
              'Received client error (400) from model with message "{\\"error\\":\\"Prediction request is missing required fields: away_defStrategy, away_insideDefense, away_insideScoring, away_offStrategy, away_offensiveFlow, away_outsideDefense, away_outsideScoring, away_rebounding, home_defStrategy, home_insideDefense, home_insideScoring, home_offStrategy, home_offensiveFlow, home_outsideDefense, home_outsideScoring, home_rebounding\\"}"',
            );
          },
          requireFeatureAccess: async () => {},
        },
      ),
    /legacy flat matchup contract/,
  );
});
