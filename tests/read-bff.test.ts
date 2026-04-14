import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  __testing as readTesting,
  isReadName,
  runReadOperation,
} from "../app/server/read-bff";

function installServerDataClient(t: TestContext, client: Record<string, unknown>) {
  const originalGetServerDataClient = readTesting.runtime.getServerDataClient;
  readTesting.runtime.getServerDataClient = async () => client as any;
  t.after(() => {
    readTesting.runtime.getServerDataClient = originalGetServerDataClient;
  });
}

test("getCurrentBbConnection reads the current owner record via get", async (t) => {
  const getCalls: Array<Record<string, unknown>> = [];

  installServerDataClient(t, {
    models: {
      BbConnection: {
        get: async (input: Record<string, unknown>) => {
          getCalls.push(input);
          return {
            data: {
              userId: "user-1",
              bbLoginName: "coach",
              profileJson: '{"teamId":"123","teamName":"Buzzer Squad"}',
              status: "CONNECTED",
              workspaceCacheJson:
                '{"version":1,"home":{},"teamHub":{},"scout":{},"leagueIntel":{},"playerLab":{}}',
            },
          };
        },
        list: async () => {
          throw new Error("BbConnection.list must not be used");
        },
      },
    },
  });

  const result = await runReadOperation("getCurrentBbConnection", "user-1");

  assert.deepStrictEqual(getCalls, [{ userId: "user-1" }]);
  assert.deepStrictEqual(result.data, {
    userId: "user-1",
    bbLoginName: "coach",
    profileJson: {
      teamId: "123",
      teamName: "Buzzer Squad",
    },
    status: "CONNECTED",
    workspaceCacheJson: null,
  });
});

test("getCurrentBbConnection suppresses legacy workspace cache coercion errors when the connection record is otherwise readable", async (t) => {
  installServerDataClient(t, {
    models: {
      BbConnection: {
        get: async () => ({
          data: {
            userId: "user-1",
            bbLoginName: "coach",
            status: "CONNECTED",
            workspaceCacheJson: null,
          },
          errors: [
            {
              message:
                "Cannot return null for non-nullable type: 'ArenaWorkspace' within parent 'WorkspaceCachePayload' (/getBbConnection/workspaceCacheJson/arena)",
            },
          ],
        }),
      },
    },
  });

  const result = await runReadOperation("getCurrentBbConnection", "user-1");

  assert.equal(result.errors, null);
  assert.deepStrictEqual(result.data, {
    userId: "user-1",
    bbLoginName: "coach",
    status: "CONNECTED",
    profileJson: null,
    workspaceCacheJson: null,
  });
});

test("getOperationsActivity uses owner-scoped index queries for every activity stream", async (t) => {
  const calls: Array<{
    model: string;
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  installServerDataClient(t, {
    models: {
      GameDayRecap: {
        listGameDayRecapsByUserAndRequestedAt: async (
          input: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.push({ model: "GameDayRecap", input, options });
          return {
            data: [
              {
                userId: "user-1",
                targetKey: "gd-1",
                leagueId: "L1",
                gameDate: "2026-03-15",
                requestedAt: "2026-03-15T12:00:00.000Z",
                requestJson: '{"leagueId":"L1","gameDate":"2026-03-15"}',
              },
            ],
          };
        },
      },
      LeagueGameDayRecap: {
        listLeagueGameDayRecapsByUserAndRequestedAt: async (
          input: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.push({ model: "LeagueGameDayRecap", input, options });
          return {
            data: [
              {
                userId: "user-1",
                targetKey: "lgd-1",
                leagueId: "L1",
                gameDayNumber: 10,
                requestedAt: "2026-03-15T11:00:00.000Z",
                requestJson: '{"leagueId":"L1","gameDayNumber":10}',
              },
            ],
          };
        },
      },
      PredictionJob: {
        get: async (input: Record<string, unknown>) => {
          calls.push({ model: "PredictionJob.get", input });
          return {
            data: {
              awayScore: 94.8,
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
              homeScore: 101.3,
              modelKey: "catboost",
              neutral: "0",
              pointDiff: 6.5,
              requestId: "request-1",
              requestedAt: "2026-03-15T09:15:00.000Z",
              status: "QUEUED",
              updatedAt: "2026-03-15T09:16:00.000Z",
              userId: "user-1",
            },
          };
        },
        list: async () => {
          throw new Error("PredictionJob.list must not be used");
        },
      },
      PredictionGridCell: {
        listPredictionGridCellsByUserIdAndRequestId: async (
          input: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.push({
            model: "PredictionGridCell.listPredictionGridCellsByUserIdAndRequestId",
            input,
            options,
          });
          return {
            data: [
              {
                awayDefense: "ManToMan",
                awayScore: 94.8,
                homeOffense: "Base",
                homeScore: 101.3,
                pointDiff: 6.5,
              },
            ],
          };
        },
      },
      SingleGameSummary: {
        listSingleGameSummariesByUserAndRequestedAt: async (
          input: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.push({ model: "SingleGameSummary", input, options });
          return {
            data: [
              {
                userId: "user-1",
                targetKey: "sg-1",
                matchId: "m1",
                requestedAt: "2026-03-15T10:00:00.000Z",
                requestJson: '{"matchId":"m1"}',
              },
            ],
          };
        },
      },
      SyncRun: {
        listSyncRunsByUserAndStartedAt: async (
          input: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.push({ model: "SyncRun", input, options });
          return { data: [{ id: "sync-1", userId: "user-1", kind: "workspace-refresh", status: "SUCCEEDED", startedAt: "2026-03-15T09:00:00.000Z" }] };
        },
      },
    },
  });

  const result = await runReadOperation("getOperationsActivity", "user-1", {
    limit: 3,
  });

  assert.deepStrictEqual(calls, [
    {
      model: "SyncRun",
      input: { userId: "user-1" },
      options: { limit: 3, sortDirection: "DESC" },
    },
    {
      model: "PredictionJob.get",
      input: { userId: "user-1" },
    },
    {
      model: "GameDayRecap",
      input: { userId: "user-1" },
      options: { limit: 3, sortDirection: "DESC" },
    },
    {
      model: "LeagueGameDayRecap",
      input: { userId: "user-1" },
      options: { limit: 3, sortDirection: "DESC" },
    },
    {
      model: "SingleGameSummary",
      input: { userId: "user-1" },
      options: { limit: 3, sortDirection: "DESC" },
    },
    {
      model: "PredictionGridCell.listPredictionGridCellsByUserIdAndRequestId",
      input: { requestId: { eq: "request-1" }, userId: "user-1" },
      options: { limit: 100, sortDirection: "ASC" },
    },
  ]);
  assert.equal((result.data as { syncRuns: Array<unknown> }).syncRuns.length, 1);
  assert.equal(
    (
      result.data as {
        currentPrediction:
          | {
              modelKey?: string | null;
              requestId: string;
              tacticsGrid?: { cells: unknown[] };
            }
          | null;
      }
    ).currentPrediction?.requestId,
    "request-1",
  );
  assert.equal(
    (
      result.data as {
        currentPrediction:
          | {
              modelKey?: string | null;
            }
          | null;
      }
    ).currentPrediction?.modelKey,
    "catboost",
  );
  assert.equal(
    (
      result.data as {
        currentPrediction:
          | {
              tacticsGrid?: { cells: unknown[] };
            }
          | null;
      }
    ).currentPrediction?.tacticsGrid?.cells.length,
    6,
  );
  assert.equal(
    (
      result.data as {
        gameDayRecaps: Array<{
          requestJson: { mode: string };
        }>;
      }
    ).gameDayRecaps[0]?.requestJson.mode,
    "FULL_SLATE",
  );
});

test("getCurrentPrediction reads the owner-keyed preview via get", async (t) => {
  const getCalls: Array<Record<string, unknown>> = [];

  installServerDataClient(t, {
    models: {
      PredictionJob: {
        get: async (input: Record<string, unknown>) => {
          getCalls.push(input);
          return {
            data: {
              awayScore: null,
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
              homeScore: null,
              modelKey: "xgb",
              neutral: "0",
              pointDiff: null,
              requestId: "request-1",
              status: "SUCCEEDED",
              requestedAt: "2026-03-15T09:15:00.000Z",
              updatedAt: "2026-03-15T09:16:00.000Z",
              userId: "user-1",
            },
          };
        },
      },
      PredictionGridCell: {
        listPredictionGridCellsByUserIdAndRequestId: async () => ({
          data: [
            {
              awayDefense: "ManToMan",
              awayScore: 95,
              homeOffense: "Base",
              homeScore: 101,
              pointDiff: 6,
            },
          ],
        }),
      },
    },
  });

  const result = await runReadOperation("getCurrentPrediction", "user-1");

  assert.deepStrictEqual(getCalls, [{ userId: "user-1" }]);
  assert.equal(
    (result.data as { requestId?: string } | null)?.requestId,
    "request-1",
  );
  assert.equal(
    (
      result.data as {
        modelKey?: string | null;
        tacticsGrid?: { cells: Array<Array<{ pointDiff: number | null }>> };
      } | null
    )?.tacticsGrid?.cells[0]?.[0]?.pointDiff,
    6,
  );
  assert.equal((result.data as { modelKey?: string | null } | null)?.modelKey, "xgb");
});

test("getRecapHistory merges owner-scoped recap streams and returns a continuation token", async (t) => {
  installServerDataClient(t, {
    models: {
      GameDayRecap: {
        list: async () => {
          throw new Error("GameDayRecap.list must not be used");
        },
        listGameDayRecapsByUserAndRequestedAt: async () => ({
          data: [
            {
              userId: "user-1",
              targetKey: "gd-1",
              leagueId: "L1",
              leagueName: "League",
              gameDate: "2026-03-15",
              status: "SUCCEEDED",
              requestedAt: "2026-03-15T11:00:00.000Z",
              requestJson: '{"leagueId":"L1","gameDate":"2026-03-15"}',
              resultJson:
                '{"games":[{"evidenceTags":["PACE"],"headline":"Top game","matchId":"g1","writeup":"Big win"}],"summary":{"headline":"Daily recap","lede":"League action"}}',
              updatedAt: "2026-03-15T11:01:00.000Z",
            },
          ],
          nextToken: "more-game-days",
        }),
      },
      LeagueGameDayRecap: {
        listLeagueGameDayRecapsByUserAndRequestedAt: async () => ({
          data: [
            {
              userId: "user-1",
              targetKey: "lgd-1",
              leagueId: "L1",
              leagueName: "League",
              gameDayNumber: 42,
              status: "SUCCEEDED",
              requestedAt: "2026-03-15T09:00:00.000Z",
              requestJson: '{"leagueId":"L1","gameDayNumber":42}',
              resultJson:
                '{"games":[{"evidenceTags":["PACE"],"headline":"Game day","matchId":"g2","writeup":"Tactical edge"}],"summary":{"headline":"Roundup","lede":"Game day summary"}}',
              updatedAt: "2026-03-15T09:01:00.000Z",
            },
          ],
          nextToken: null,
        }),
      },
      SingleGameSummary: {
        listSingleGameSummariesByUserAndRequestedAt: async () => ({
          data: [
            {
              userId: "user-1",
              targetKey: "sg-1",
              matchId: "m1",
              leagueId: "L1",
              leagueName: "League",
              status: "SUCCEEDED",
              requestedAt: "2026-03-15T12:00:00.000Z",
              requestJson: '{"matchId":"m1"}',
              resultJson:
                '{"games":[{"evidenceTags":["PACE"],"headline":"Single game","matchId":"m1","writeup":"Close finish"}],"summary":{"headline":"Single summary","lede":"One match"}}',
              updatedAt: "2026-03-15T12:01:00.000Z",
            },
          ],
          nextToken: null,
        }),
      },
    },
  });

  const result = await runReadOperation("getRecapHistory", "user-1", {
    limit: 2,
  });
  const data = result.data as { items: Array<{ kind: string; targetKey: string }>; nextToken: string | null };

  assert.deepStrictEqual(
    data.items.map((item) => [item.kind, item.targetKey]),
    [
      ["SINGLE_GAME", "sg-1"],
      ["LEAGUE_DATE", "gd-1"],
    ],
  );
  assert.equal(data.items[0]?.requestJson.mode, "SINGLE_GAME");
  assert.equal(data.items[1]?.requestJson.mode, "FULL_SLATE");
  assert.equal(typeof data.nextToken, "string");
});

test("removed lineup scenario reads are no longer exposed from the read surface", () => {
  assert.equal(isReadName("getSavedLineupScenarios"), false);
  assert.equal(isReadName("getPredictionHistory"), false);
  assert.equal(isReadName("getCurrentPrediction"), true);
});
