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
