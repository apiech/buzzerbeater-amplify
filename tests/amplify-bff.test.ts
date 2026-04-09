import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  __testing as bffTesting,
  isMutationName,
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
