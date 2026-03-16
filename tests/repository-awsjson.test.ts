import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as repositoryTesting,
  createSyncRun,
  getBbConnection,
  listBbConnections,
  updateSyncRun,
  upsertTrackedPlayer,
} from "../amplify/data/_backend/repository";

test("createSyncRun serializes AWSJSON payloads before model.create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(repositoryTesting.runtime, "getClient", async () => ({
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
  }) as any);

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
    detailsJson: "{\"teamId\":\"123\"}",
    expiresAt: "2026-03-29T00:00:00.000Z",
  });
  assert.deepStrictEqual(record.detailsJson, { teamId: "123" });
});

test("updateSyncRun serializes AWSJSON payloads before model.update", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(repositoryTesting.runtime, "getClient", async () => ({
    models: {
      SyncRun: {
        update: async (input: Record<string, unknown>) => {
          updateInput = input;
          return { data: { id: "sync-1" } };
        },
      },
    },
  }) as any);

  await updateSyncRun({} as any, {
    id: "sync-1",
    status: "SUCCEEDED",
    detailsJson: { nextOpponentTeamId: "opp-1" },
  });

  assert.deepStrictEqual(updateInput, {
    id: "sync-1",
    status: "SUCCEEDED",
    detailsJson: "{\"nextOpponentTeamId\":\"opp-1\"}",
  });
});

test("generic upserts serialize AWSJSON payloads before model.create", async (t) => {
  let getInput: Record<string, unknown> | null = null;
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(repositoryTesting.runtime, "getClient", async () => ({
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
  }) as any);

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
    profileJson: "{\"playerId\":\"p1\",\"skills\":{\"outsideScoring\":12}}",
  });
});

test("getBbConnection returns JSON fields as plain objects", async (t) => {
  t.mock.method(repositoryTesting.runtime, "getClient", async () => ({
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
  }) as any);

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

test("listBbConnections follows nextToken pagination", async (t) => {
  const listInputs: Array<Record<string, unknown>> = [];

  t.mock.method(repositoryTesting.runtime, "getClient", async () => ({
    models: {
      BbConnection: {
        list: async (input: Record<string, unknown>) => {
          listInputs.push(input);
          if (!input.nextToken) {
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
          }

          return {
            data: [
              {
                userId: "u2",
                bbLoginName: "coach-2",
                status: "CONNECTED",
                workspaceCacheJson: {
                  home: { team: { teamId: "2" } },
                },
              },
            ],
            nextToken: null,
          };
        },
      },
    },
  }) as any);

  const records = await listBbConnections({} as any, 1);

  assert.deepStrictEqual(
    listInputs,
    [
      { limit: 1 },
      { limit: 1, nextToken: "page-2" },
    ],
  );
  assert.deepStrictEqual(
    records.map((record) => record.userId),
    ["u1", "u2"],
  );
  assert.deepStrictEqual(records[1]?.workspaceCacheJson, {
    home: { team: { teamId: "2" } },
  });
});
