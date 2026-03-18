import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as repositoryTesting,
  createSyncRun,
  getBbConnection,
  getUserPreference,
  listConnectedBbConnections,
  listPlayerSkillObservations,
  listExpiredPredictionJobs,
  listExpiredSyncRuns,
  listStaleConnectedBbConnections,
  updateSyncRun,
  upsertUserPreference,
  upsertTrackedPlayer,
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

test("listConnectedBbConnections queries the status index", async (t) => {
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
          BbConnection: {
            listBbConnectionsByStatusAndRefreshSortAt: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              queryCalls.push({ input, options });
              return {
                data: [
                  {
                    userId: "u1",
                    bbLoginName: "coach-1",
                    status: "CONNECTED",
                    workspaceCacheJson: {
                      home: { team: { teamId: "1" } },
                    },
                  },
                ],
                nextToken: "page-2",
              };
            },
          },
        },
      }) as any,
  );

  const page = await listConnectedBbConnections({} as any, {
    limit: 1,
    nextToken: "page-1",
  });

  assert.deepStrictEqual(queryCalls, [
    {
      input: { status: "CONNECTED" },
      options: {
        limit: 1,
        nextToken: "page-1",
        sortDirection: "ASC",
      },
    },
  ]);
  assert.deepStrictEqual(
    page.records.map((record) => record.userId),
    ["u1"],
  );
  assert.equal(page.nextToken, "page-2");
  assert.deepStrictEqual(page.records[0]?.workspaceCacheJson, {
    home: { team: { teamId: "1" } },
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

test("listStaleConnectedBbConnections applies the stale cutoff on the index", async (t) => {
  let queryInput: Record<string, unknown> | null = null;
  let queryOptions: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            listBbConnectionsByStatusAndRefreshSortAt: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              queryInput = input;
              queryOptions = options ?? null;
              return {
                data: [
                  {
                    userId: "u2",
                    bbLoginName: "coach-2",
                    status: "CONNECTED",
                    refreshSortAt: "2026-03-15T08:00:00.000Z",
                  },
                ],
                nextToken: null,
              };
            },
          },
        },
      }) as any,
  );

  const page = await listStaleConnectedBbConnections(
    {} as any,
    "2026-03-15T12:00:00.000Z",
    { limit: 25 },
  );

  assert.deepStrictEqual(queryInput, {
    status: "CONNECTED",
    refreshSortAt: { lt: "2026-03-15T12:00:00.000Z" },
  });
  assert.deepStrictEqual(queryOptions, {
    limit: 25,
    sortDirection: "ASC",
  });
  assert.deepStrictEqual(page.records, [
    {
      userId: "u2",
      bbLoginName: "coach-2",
      status: "CONNECTED",
      refreshSortAt: "2026-03-15T08:00:00.000Z",
    },
  ]);
});

test("expired operational record helpers query expiry indexes", async (t) => {
  const syncRunCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];
  const predictionJobCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionJob: {
            listPredictionJobsByExpiryKeyAndExpiresAt: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              predictionJobCalls.push({ input, options });
              return {
                data: [
                  {
                    id: "job-1",
                    userId: "u1",
                    status: "FAILED",
                    mode: "MANUAL",
                  },
                ],
                nextToken: null,
              };
            },
          },
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
  const predictionJobPage = await listExpiredPredictionJobs(
    {} as any,
    "2026-03-15T12:00:00.000Z",
    { nextToken: "jobs-page-1" },
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
  assert.deepStrictEqual(predictionJobCalls, [
    {
      input: {
        expiryKey: "EXPIRABLE",
        expiresAt: { lt: "2026-03-15T12:00:00.000Z" },
      },
      options: {
        nextToken: "jobs-page-1",
        sortDirection: "ASC",
      },
    },
  ]);
  assert.equal(syncRunPage.nextToken, "next-sync-page");
  assert.equal(syncRunPage.records[0]?.id, "sync-1");
  assert.equal(predictionJobPage.records[0]?.id, "job-1");
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
