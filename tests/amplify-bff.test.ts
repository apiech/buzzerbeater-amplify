import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  __testing as bffTesting,
  isQueryName,
  isMutationName,
  runQueryOperation,
  runMutationOperation,
} from "../app/server/amplify-bff";

function installServerDataClient(t: TestContext, client: Record<string, unknown>) {
  const originalGetServerDataClient = bffTesting.runtime.getServerDataClient;
  bffTesting.runtime.getServerDataClient = async () => client as never;
  t.after(() => {
    bffTesting.runtime.getServerDataClient = originalGetServerDataClient;
  });
}

test("clearMyTeamHighlightsData is routed through the mutation BFF", async (t) => {
  let calls = 0;

  installServerDataClient(t, {
    mutations: {
      clearMyTeamHighlightsData: async () => {
        calls += 1;
        return {
          data: {
            clearedCoverageCount: 3,
            deletedMomentCount: 12,
            teamId: "163730",
            teamName: "Visionaries",
          },
        };
      },
    },
  });

  assert.equal(isMutationName("clearMyTeamHighlightsData"), true);

  const result = await runMutationOperation("clearMyTeamHighlightsData");

  assert.equal(calls, 1);
  assert.deepStrictEqual(result.data, {
    clearedCoverageCount: 3,
    deletedMomentCount: 12,
    teamId: "163730",
    teamName: "Visionaries",
  });
});

test("getLatestNextGameRecommendation is routed through the query BFF", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    queries: {
      getLatestNextGameRecommendation: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            jobId: "recommendation-1",
            matchId: "m-1",
            opponentTeamId: "opp-1",
            enthusiasm: 8,
            defensiveSwitch: {
              pg: "PG",
              sg: "SG",
              sf: "SF",
              pf: "PF",
              c: "C",
            },
            requestedAt: "2026-04-09T00:00:00.000Z",
            status: "QUEUED",
          },
        };
      },
    },
  });

  assert.equal(isQueryName("getLatestNextGameRecommendation"), true);

  const result = await runQueryOperation("getLatestNextGameRecommendation", {
    input: {
      enthusiasm: 8,
      defensiveSwitch: {
        pg: "PG",
        sg: "SG",
        sf: "SF",
        pf: "PF",
        c: "C",
      },
    },
  });

  assert.deepStrictEqual(input, {
    input: {
      enthusiasm: 8,
      defensiveSwitch: {
        pg: "PG",
        sg: "SG",
        sf: "SF",
        pf: "PF",
        c: "C",
      },
    },
  });
  assert.equal((result.data as { jobId: string }).jobId, "recommendation-1");
});

test("getNextGamePlannerDetail is routed through the query BFF", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    queries: {
      getNextGamePlannerDetail: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            artifactKey: "artifact-1",
            generatedAt: "2026-04-12T00:00:00.000Z",
            evaluatedScenarios: [],
            opponentPairs: [],
            ourPairs: [],
            views: [],
          },
        };
      },
    },
  });

  assert.equal(isQueryName("getNextGamePlannerDetail"), true);

  const result = await runQueryOperation("getNextGamePlannerDetail", {
    artifactKey: "artifact-1",
  });

  assert.deepStrictEqual(input, {
    artifactKey: "artifact-1",
  });
  assert.equal((result.data as { artifactKey: string }).artifactKey, "artifact-1");
});

test("evaluatePredictionMatrix forwards the typed request object to GraphQL", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    queries: {
      evaluatePredictionMatrix: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            generatedAt: "2026-04-12T00:00:00.000Z",
            modelVersion: "matrix-v1",
            selectedTeamAPairId: "Base__ManToMan",
            selectedTeamBPairId: "Base__ManToMan",
            teamAPairs: [],
            teamASide: {
              defense: "Man to Man",
              effortChoice: "Normal",
              offense: "Base",
              teamId: "our-team",
              teamName: "Our Team",
            },
            teamBPairs: [],
            teamBSide: {
              defense: "Man to Man",
              effortChoice: "Normal",
              offense: "Base",
              teamId: "opp-team",
              teamName: "Opponent",
            },
            venue: "NEUTRAL",
            views: [],
          },
        };
      },
    },
  });

  await runQueryOperation("evaluatePredictionMatrix", {
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
  });

  assert.deepStrictEqual(input, {
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
  });
});
