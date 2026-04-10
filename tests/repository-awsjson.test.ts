import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as repositoryTesting,
  createNextGameRecommendationJob,
  createOpponentForecastJob,
  createSyncRun,
  getBbConnection,
  getPredictionJob,
  getUserPreference,
  listPredictionGridCellsByUserAndRequestId,
  listPlayerSkillObservations,
  listExpiredSyncRuns,
  updateSyncRun,
  upsertBbConnection,
  upsertPredictionGridCells,
  upsertPredictionJob,
  upsertUserPreference,
  upsertTrackedPlayer,
  updatePredictionJobIfRequestMatches,
} from "../amplify/data/_backend/repository";

test("createSyncRun serializes AWSJSON payloads before model.create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SyncRun: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return {
                data: {
                  id: "sync-1",
                  userId: "u1",
                  kind: "workspace-refresh",
                  status: "SYNCING",
                  startedAt: "2026-03-15T00:00:00.000Z",
                  detailsJson: { teamId: "123" },
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await createSyncRun({} as any, {
    userId: "u1",
    kind: "workspace-refresh",
    status: "SYNCING",
    startedAt: "2026-03-15T00:00:00.000Z",
    detailsJson: { teamId: "123" },
  });

  assert.deepStrictEqual(createInput, {
    userId: "u1",
    kind: "workspace-refresh",
    status: "SYNCING",
    startedAt: "2026-03-15T00:00:00.000Z",
    detailsJson: '{"teamId":"123"}',
    expiryKey: "EXPIRABLE",
    expiresAt: "2026-03-29T00:00:00.000Z",
  });
  assert.deepStrictEqual(record.detailsJson, { teamId: "123" });
});

test("createOpponentForecastJob serializes AWSJSON payloads before model.create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          OpponentForecastJob: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return {
                data: {
                  id: "forecast-1",
                  userId: "u1",
                  teamId: "200",
                  status: "QUEUED",
                  requestJson: { teamId: "200" },
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await createOpponentForecastJob({} as any, {
    id: "forecast-1",
    userId: "u1",
    teamId: "200",
    teamName: "Rivals",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: { teamId: "200" },
    resolvedContextJson: { recentGames: 8 },
    resultJson: null,
    error: null,
    modelVersion: null,
  });

  assert.deepStrictEqual(createInput, {
    id: "forecast-1",
    userId: "u1",
    teamId: "200",
    teamName: "Rivals",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: '{"teamId":"200"}',
    resolvedContextJson: '{"recentGames":8}',
    resultJson: null,
    error: null,
    modelVersion: null,
    requestedAt: createInput?.["requestedAt"],
    expiryKey: "EXPIRABLE",
    expiresAt: createInput?.["expiresAt"],
  });
  assert.deepStrictEqual(record.requestJson, { teamId: "200" });
});

test("createNextGameRecommendationJob serializes AWSJSON payloads before model.create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          NextGameRecommendationJob: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return {
                data: {
                  id: "recommendation-1",
                  userId: "u1",
                  matchId: "m-1",
                  opponentTeamId: "opp-1",
                  enthusiasm: 8,
                  switchPg: "PG",
                  switchSg: "SG",
                  switchSf: "SF",
                  switchPf: "PF",
                  switchC: "C",
                  status: "QUEUED",
                  requestJson: {
                    input: {
                      enthusiasm: 8,
                    },
                  },
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await createNextGameRecommendationJob({} as any, {
    id: "recommendation-1",
    userId: "u1",
    matchId: "m-1",
    opponentTeamId: "opp-1",
    opponentTeamName: "Rivals",
    enthusiasm: 8,
    switchPg: "PG",
    switchSg: "SG",
    switchSf: "SF",
    switchPf: "PF",
    switchC: "C",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: {
      input: {
        enthusiasm: 8,
      },
    },
    resultJson: {
      biggestWinPlan: {
        offense: "Base Offense",
      },
    },
    error: null,
    executionArn: null,
  });

  assert.deepStrictEqual(createInput, {
    id: "recommendation-1",
    userId: "u1",
    matchId: "m-1",
    opponentTeamId: "opp-1",
    opponentTeamName: "Rivals",
    enthusiasm: 8,
    switchPg: "PG",
    switchSg: "SG",
    switchSf: "SF",
    switchPf: "PF",
    switchC: "C",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: '{"input":{"enthusiasm":8}}',
    resultJson: '{"biggestWinPlan":{"offense":"Base Offense"}}',
    error: null,
    executionArn: null,
    requestedAt: createInput?.["requestedAt"],
    expiryKey: "EXPIRABLE",
    expiresAt: createInput?.["expiresAt"],
  });
  assert.deepStrictEqual(record.requestJson, {
    input: {
      enthusiasm: 8,
    },
  });
});

test("updateSyncRun serializes AWSJSON payloads before model.update", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SyncRun: {
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: { id: "sync-1" } };
            },
          },
        },
      }) as any,
  );

  await updateSyncRun({} as any, {
    id: "sync-1",
    status: "SUCCEEDED",
    detailsJson: { nextOpponentTeamId: "opp-1" },
  });

  assert.deepStrictEqual(updateInput, {
    id: "sync-1",
    status: "SUCCEEDED",
    detailsJson: '{"nextOpponentTeamId":"opp-1"}',
  });
});

test("generic upserts serialize AWSJSON payloads before model.create", async (t) => {
  let getInput: Record<string, unknown> | null = null;
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          TrackedPlayer: {
            get: async (input: Record<string, unknown>) => {
              getInput = input;
              return { data: null };
            },
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { userId: "u1", playerId: "p1" } };
            },
          },
        },
      }) as any,
  );

  await upsertTrackedPlayer({} as any, {
    userId: "u1",
    playerId: "p1",
    teamId: "t1",
    fullName: "Prospect",
    profileJson: {
      playerId: "p1",
      skills: { outsideScoring: 12 },
    },
  });

  assert.deepStrictEqual(getInput, {
    userId: "u1",
    playerId: "p1",
  });
  assert.deepStrictEqual(createInput, {
    userId: "u1",
    playerId: "p1",
    teamId: "t1",
    fullName: "Prospect",
    profileJson: '{"playerId":"p1","skills":{"outsideScoring":12}}',
  });
});

test("upsertBbConnection preserves the explicit connection payload on create", async (t) => {
  let getInput: Record<string, unknown> | null = null;
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async (input: Record<string, unknown>) => {
              getInput = input;
              return { data: null };
            },
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { userId: "u1" } };
            },
          },
        },
      }) as any,
  );

  await upsertBbConnection({} as any, {
    userId: "u1",
    bbLoginName: "coach",
    status: "INVALID",
    connectedAt: null,
    lastValidatedAt: null,
    lastSyncAt: null,
  });

  assert.deepStrictEqual(getInput, { userId: "u1" });
  assert.ok(createInput);
  assert.equal(createInput["userId"], "u1");
  assert.equal(createInput["bbLoginName"], "coach");
  assert.equal(createInput["status"], "INVALID");
  assert.equal(createInput["connectedAt"], null);
  assert.equal(createInput["lastValidatedAt"], null);
  assert.equal(createInput["lastSyncAt"], null);
});

test("upsertBbConnection updates the existing record without adding refresh metadata", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async () => ({
              data: {
                userId: "u1",
                bbLoginName: "coach",
                status: "DISCONNECTED",
                connectedAt: "2026-03-15T00:00:00.000Z",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: { userId: "u1" } };
            },
          },
        },
      }) as any,
  );

  await upsertBbConnection({} as any, {
    userId: "u1",
    bbLoginName: "coach",
    status: "DISCONNECTED",
    connectedAt: null,
    lastValidatedAt: null,
    lastSyncAt: null,
  });

  assert.deepStrictEqual(updateInput, {
    userId: "u1",
    bbLoginName: "coach",
    status: "DISCONNECTED",
    connectedAt: null,
    lastValidatedAt: null,
    lastSyncAt: null,
  });
});

test("getBbConnection returns JSON fields as plain objects", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async () => ({
              data: {
                userId: "u1",
                bbLoginName: "apiech",
                status: "CONNECTED",
                accessKeyLast4: "****1234",
                teamId: "123",
                teamName: "Buzz City",
                shortName: "BC",
                leagueId: "9",
                leagueName: "League",
                countryId: "1",
                countryName: "USA",
                connectedAt: "2026-03-15T00:00:00.000Z",
                lastValidatedAt: "2026-03-15T00:00:00.000Z",
                lastSyncAt: "2026-03-15T00:00:00.000Z",
                lastSyncError: null,
                profileJson: { teamId: "123" },
                workspaceCacheJson: {
                  home: { team: { teamId: "123" } },
                  teamHub: {},
                  scout: {},
                  leagueIntel: {},
                  playerLab: {},
                },
              },
            }),
          },
        },
      }) as any,
  );

  const record = await getBbConnection({} as any, "u1");

  assert.ok(record);
  assert.deepStrictEqual(record.profileJson, { teamId: "123" });
  assert.deepStrictEqual(record.workspaceCacheJson, {
    home: { team: { teamId: "123" } },
    teamHub: {},
    scout: {},
    leagueIntel: {},
    playerLab: {},
  });
});

test("listPlayerSkillObservations queries the user history index with a player prefix", async (t) => {
  const queryCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PlayerSkillObservation: {
            listPlayerSkillObservationsByUserIdAndPlayerCapturedAtKey: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              queryCalls.push({ input, options });
              if (options?.nextToken === "page-2") {
                return {
                  data: [
                    {
                      userId: "u1",
                      playerId: "p1",
                      capturedAt: "2026-03-10T00:00:00.000Z",
                      playerCapturedAtKey: "p1#2026-03-10T00:00:00.000Z",
                      fullName: "Prospect Player",
                      teamId: "t1",
                    },
                  ],
                  nextToken: null,
                };
              }

              return {
                data: [
                  {
                    userId: "u1",
                    playerId: "p1",
                    capturedAt: "2026-03-17T00:00:00.000Z",
                    playerCapturedAtKey: "p1#2026-03-17T00:00:00.000Z",
                    fullName: "Prospect Player",
                    teamId: "t1",
                  },
                ],
                nextToken: "page-2",
              };
            },
          },
        },
      }) as any,
  );

  const records = await listPlayerSkillObservations({} as any, "u1", "p1", 2);

  assert.deepStrictEqual(queryCalls, [
    {
      input: {
        userId: "u1",
        playerCapturedAtKey: { beginsWith: "p1#" },
      },
      options: {
        limit: 2,
        nextToken: null,
        sortDirection: "DESC",
      },
    },
    {
      input: {
        userId: "u1",
        playerCapturedAtKey: { beginsWith: "p1#" },
      },
      options: {
        limit: 1,
        nextToken: "page-2",
        sortDirection: "DESC",
      },
    },
  ]);
  assert.deepStrictEqual(
    records.map((record) => record.capturedAt),
    ["2026-03-17T00:00:00.000Z", "2026-03-10T00:00:00.000Z"],
  );
});

test("expired sync run helper queries the expiry index", async (t) => {
  const syncRunCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SyncRun: {
            listSyncRunsByExpiryKeyAndExpiresAt: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              syncRunCalls.push({ input, options });
              return {
                data: [
                  {
                    id: "sync-1",
                    userId: "u1",
                    kind: "workspace-refresh",
                    status: "FAILED",
                    startedAt: "2026-03-01T00:00:00.000Z",
                  },
                ],
                nextToken: "next-sync-page",
              };
            },
          },
        },
      }) as any,
  );

  const syncRunPage = await listExpiredSyncRuns(
    {} as any,
    "2026-03-15T12:00:00.000Z",
    { limit: 100 },
  );

  assert.deepStrictEqual(syncRunCalls, [
    {
      input: {
        expiryKey: "EXPIRABLE",
        expiresAt: { lt: "2026-03-15T12:00:00.000Z" },
      },
      options: {
        limit: 100,
        sortDirection: "ASC",
      },
    },
  ]);
  assert.equal(syncRunPage.nextToken, "next-sync-page");
  assert.equal(syncRunPage.records[0]?.id, "sync-1");
});

test("upsertPredictionJob stores typed prediction fields without AWSJSON encoding", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionJob: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { ...input } };
            },
            get: async () => ({ data: null }),
            update: async () => {
              throw new Error("PredictionJob.update should not be called");
            },
          },
        },
      }) as any,
  );

  await upsertPredictionJob({} as any, {
    away_gdp_focus: "N/A",
    away_gdp_pace: "N/A",
    away_insideDefense: 7,
    away_insideScoring: 7,
    away_offensiveFlow: 7,
    away_outsideDefense: 7,
    away_outsideScoring: 7,
    away_rebounding: 7,
    awayScore: null,
    effortDelta: 0,
    error: null,
    executionArn: null,
    home_gdp_focus: "N/A",
    home_gdp_pace: "N/A",
    home_insideDefense: 8,
    home_insideScoring: 8,
    home_offensiveFlow: 8,
    home_outsideDefense: 8,
    home_outsideScoring: 8,
    home_rebounding: 8,
    homeScore: null,
    modelVersion: null,
    neutral: "0",
    pointDiff: null,
    requestId: "request-1",
    requestedAt: "2026-03-15T00:00:00.000Z",
    status: "QUEUED",
    userId: "u1",
  });

  assert.ok(createInput);
  assert.equal(createInput.away_gdp_focus, "N/A");
  assert.equal(createInput.home_outsideScoring, 8);
  assert.equal(createInput.executionArn, null);
  assert.equal(createInput.homeScore, null);
  assert.equal(createInput.pointDiff, null);
});

test("getPredictionJob returns the typed persisted prediction record", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionJob: {
            get: async () => ({
              data: {
                away_gdp_focus: "N/A",
                away_gdp_pace: "N/A",
                away_insideDefense: 7,
                away_insideScoring: 7,
                away_offensiveFlow: 7,
                away_outsideDefense: 7,
                away_outsideScoring: 7,
                away_rebounding: 7,
                effortDelta: 0,
                error: null,
                executionArn: null,
                home_gdp_focus: "N/A",
                home_gdp_pace: "N/A",
                home_insideDefense: 8,
                home_insideScoring: 8,
                home_offensiveFlow: 8,
                home_outsideDefense: 8,
                home_outsideScoring: 8,
                home_rebounding: 8,
                neutral: "0",
                modelVersion: "bundle-v1",
                requestId: "request-1",
                requestedAt: "2026-03-15T00:00:00.000Z",
                awayScore: 94.8,
                homeScore: 101.3,
                pointDiff: 6.5,
                status: "SUCCEEDED",
                userId: "u1",
              },
            }),
          },
        },
      }) as any,
  );

  const record = await getPredictionJob({} as any, "u1");

  assert.ok(record);
  assert.equal(record.home_outsideScoring, 8);
  assert.equal(record.away_gdp_focus, "N/A");
  assert.equal(record.homeScore, 101.3);
  assert.equal(record.pointDiff, 6.5);
});

test("prediction grid cells are stored and read as typed rows", async (t) => {
  const createInputs: Array<Record<string, unknown>> = [];
  const listCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionGridCell: {
            create: async (input: Record<string, unknown>) => {
              createInputs.push(input);
              return { data: input };
            },
            get: async () => ({ data: null }),
            listPredictionGridCellsByUserIdAndRequestId: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              listCalls.push({ input, options });
              return {
                data: [
                  {
                    awayDefense: "ManToMan",
                    awayScore: 94.8,
                    homeOffense: "Base",
                    homeScore: 101.3,
                    pointDiff: 6.5,
                    requestId: "request-1",
                    userId: "u1",
                  },
                ],
              };
            },
            update: async () => {
              throw new Error("PredictionGridCell.update should not be called");
            },
          },
        },
      }) as any,
  );

  await upsertPredictionGridCells({} as any, [
    {
      awayDefense: "ManToMan",
      awayScore: 94.8,
      homeOffense: "Base",
      homeScore: 101.3,
      pointDiff: 6.5,
      requestId: "request-1",
      userId: "u1",
    },
  ]);
  const rows = await listPredictionGridCellsByUserAndRequestId(
    {} as any,
    "u1",
    "request-1",
  );

  assert.deepStrictEqual(createInputs[0], {
    awayDefense: "ManToMan",
    awayScore: 94.8,
    homeOffense: "Base",
    homeScore: 101.3,
    pointDiff: 6.5,
    requestId: "request-1",
    userId: "u1",
  });
  assert.deepStrictEqual(listCalls, [
    {
      input: {
        requestId: { eq: "request-1" },
        userId: "u1",
      },
      options: {
        limit: 100,
        nextToken: null,
        sortDirection: "ASC",
      },
    },
  ]);
  assert.deepStrictEqual(rows, [
    {
      awayDefense: "ManToMan",
      awayScore: 94.8,
      homeOffense: "Base",
      homeScore: 101.3,
      pointDiff: 6.5,
      requestId: "request-1",
      userId: "u1",
    },
  ]);
});

test("updatePredictionJobIfRequestMatches ignores stale completions", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionJob: {
            create: async () => {
              throw new Error("PredictionJob.create should not be called");
            },
            get: async () => ({
              data: {
                requestId: "current-request",
                status: "QUEUED",
                userId: "u1",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: input };
            },
          },
        },
      }) as any,
  );

  const updated = await updatePredictionJobIfRequestMatches({} as any, {
    requestId: "stale-request",
    status: "SUCCEEDED",
    userId: "u1",
  });

  assert.equal(updated, false);
  assert.equal(updateInput, null);
});

test("getUserPreference loads the stored account theme", async (t) => {
  let getInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          UserPreference: {
            get: async (input: Record<string, unknown>) => {
              getInput = input;
              return {
                data: {
                  userId: "u1",
                  themeId: "arena",
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await getUserPreference({} as any, "u1");

  assert.deepStrictEqual(getInput, { userId: "u1" });
  assert.deepStrictEqual(record, {
    userId: "u1",
    themeId: "arena",
  });
});

test("upsertUserPreference creates a preference when one does not exist", async (t) => {
  let createInput: Record<string, unknown> | null = null;
  let updateCalled = false;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          UserPreference: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { userId: "u1", themeId: "nightfall" } };
            },
            get: async () => ({ data: null }),
            update: async () => {
              updateCalled = true;
              return { data: { userId: "u1", themeId: "nightfall" } };
            },
          },
        },
      }) as any,
  );

  await upsertUserPreference({} as any, {
    userId: "u1",
    themeId: "nightfall",
  });

  assert.equal(updateCalled, false);
  assert.deepStrictEqual(createInput, {
    userId: "u1",
    themeId: "nightfall",
  });
});

test("upsertUserPreference updates an existing preference", async (t) => {
  let createCalled = false;
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          UserPreference: {
            create: async () => {
              createCalled = true;
              return { data: { userId: "u1", themeId: "clubhouse" } };
            },
            get: async () => ({
              data: {
                userId: "u1",
                themeId: "arena",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: { userId: "u1", themeId: "clubhouse" } };
            },
          },
        },
      }) as any,
  );

  await upsertUserPreference({} as any, {
    userId: "u1",
    themeId: "clubhouse",
  });

  assert.equal(createCalled, false);
  assert.deepStrictEqual(updateInput, {
    userId: "u1",
    themeId: "clubhouse",
  });
});
