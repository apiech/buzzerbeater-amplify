import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  __testing as readTesting,
  isReadName,
  runReadOperation,
} from "../app/server/read-bff";
import { createStoredTeamInfo } from "./fixtures/owned-data";

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
              profileJson: JSON.stringify(
                createStoredTeamInfo({
                  teamId: "123",
                  teamName: "Buzzer Squad",
                }),
              ),
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
    accessKeyLast4: null,
    bbLoginName: "coach",
    connectedAt: null,
    countryId: null,
    countryName: null,
    lastSyncAt: null,
    lastSyncError: null,
    lastValidatedAt: null,
    leagueId: null,
    leagueName: null,
    leagueTimeZone: null,
    profileJson: createStoredTeamInfo({
      teamId: "123",
      teamName: "Buzzer Squad",
    }),
    status: "CONNECTED",
    teamId: null,
    teamName: null,
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
    accessKeyLast4: null,
    bbLoginName: "coach",
    connectedAt: null,
    countryId: null,
    countryName: null,
    lastSyncAt: null,
    lastSyncError: null,
    lastValidatedAt: null,
    leagueId: null,
    leagueName: null,
    leagueTimeZone: null,
    status: "CONNECTED",
    profileJson: null,
    teamId: null,
    teamName: null,
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
      LeagueGameDayPerformances: {
        listLeagueGameDayPerformancesByUserAndRequestedAt: async () => ({
          data: [],
          nextToken: null,
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

test("getRecapHistory skips null legacy recap rows and still returns valid items", async (t) => {
  installServerDataClient(t, {
    models: {
      GameDayRecap: {
        listGameDayRecapsByUserAndRequestedAt: async () => ({
          data: [
            null,
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
          nextToken: null,
        }),
      },
      LeagueGameDayPerformances: {
        listLeagueGameDayPerformancesByUserAndRequestedAt: async () => ({
          data: [],
          nextToken: null,
        }),
      },
      LeagueGameDayRecap: {
        listLeagueGameDayRecapsByUserAndRequestedAt: async () => ({
          data: [],
          nextToken: null,
        }),
      },
      SingleGameSummary: {
        listSingleGameSummariesByUserAndRequestedAt: async () => ({
          data: [],
          nextToken: null,
        }),
      },
    },
  });

  const result = await runReadOperation("getRecapHistory", "user-1", {
    limit: 8,
  });
  const data = result.data as { items: Array<{ kind: string; targetKey: string }> };

  assert.deepStrictEqual(
    data.items.map((item) => [item.kind, item.targetKey]),
    [["LEAGUE_DATE", "gd-1"]],
  );
});

test("getRecapHistory merges deterministic performance reports alongside writeups", async (t) => {
  installServerDataClient(t, {
    models: {
      GameDayRecap: {
        listGameDayRecapsByUserAndRequestedAt: async () => ({
          data: [],
          nextToken: null,
        }),
      },
      LeagueGameDayPerformances: {
        listLeagueGameDayPerformancesByUserAndRequestedAt: async () => ({
          data: [
            {
              userId: "user-1",
              targetKey: "perf-1",
              leagueId: "L1",
              leagueName: "League",
              gameDate: "2026-04-11",
              gameDayNumber: 22,
              season: 71,
              status: "SUCCEEDED",
              requestedAt: "2026-04-12T01:00:00.000Z",
              requestJson:
                '{"leagueId":"L1","gameDayNumber":22,"mode":"LEAGUE_GAME_DAY_PERFORMANCES","season":71}',
              resultJson:
                '{"gameDate":"2026-04-11","gameDayNumber":22,"games":[{"awayScore":81,"awayTeamName":"Delta","homeScore":91,"homeTeamName":"Gamma","matchId":"137828772"}],"leagueId":"L1","leagueName":"League","mvp":{"key":"mvp","label":"MVP","leaders":[{"efficiency":42,"minutes":40,"personalFouls":2,"playerName":"Paula Gamma","position":"PF","rating":18.7,"statLine":{"assists":1,"blocks":7,"points":22,"rebounds":22,"steals":1},"teamName":"Gamma","turnovers":2}],"value":42},"badPerformance":{"key":"bad-performance","label":"Bad performance","leaders":[{"efficiency":-9,"minutes":40,"personalFouls":0,"playerName":"Nico Beta","position":"PG","rating":0,"statLine":{"assists":2,"blocks":0,"points":6,"rebounds":6,"steals":1},"teamName":"Beta","turnovers":6}],"value":-9},"playerLeaders":[],"statCallouts":[],"teamLeaders":[],"topFive":[],"tripleDoubles":[]}',
              updatedAt: "2026-04-12T01:02:00.000Z",
            },
          ],
          nextToken: null,
        }),
      },
      LeagueGameDayRecap: {
        listLeagueGameDayRecapsByUserAndRequestedAt: async () => ({
          data: [],
          nextToken: null,
        }),
      },
      SingleGameSummary: {
        listSingleGameSummariesByUserAndRequestedAt: async () => ({
          data: [],
          nextToken: null,
        }),
      },
    },
  });

  const result = await runReadOperation("getRecapHistory", "user-1", {
    limit: 8,
  });
  const data = result.data as {
    items: Array<{
      gameDayNumber: number | null;
      kind: string;
      requestJson: { mode: string };
      targetKey: string;
    }>;
  };

  assert.deepStrictEqual(
    data.items.map((item) => [item.kind, item.targetKey]),
    [["LEAGUE_GAME_DAY_PERFORMANCES", "perf-1"]],
  );
  const [firstItem] = data.items;
  assert.ok(firstItem);
  assert.equal(firstItem.gameDayNumber, 22);
  assert.equal(
    firstItem.requestJson.mode,
    "LEAGUE_GAME_DAY_PERFORMANCES",
  );
});

test("removed lineup scenario reads are no longer exposed from the read surface", () => {
  assert.equal(isReadName("getSavedLineupScenarios"), false);
  assert.equal(isReadName("getPredictionHistory"), false);
  assert.equal(isReadName("getCurrentPrediction"), true);
});
