import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as repositoryTesting,
  createSyncRun,
  getBbConnection,
  upsertTrackedPlayer,
} from "../amplify/data/_backend/repository";

test("createSyncRun uses the Amplify data client without manual JSON serialization", async (t) => {
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
    detailsJson: { teamId: "123" },
  });
  assert.deepStrictEqual(record.detailsJson, { teamId: "123" });
});

test("generic upserts use model get/create calls with plain JSON objects", async (t) => {
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
    profileJson: {
      playerId: "p1",
      skills: { outsideScoring: 12 },
    },
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

  assert.deepStrictEqual(record?.profileJson, { teamId: "123" });
  assert.deepStrictEqual(record?.workspaceCacheJson, {
    home: { team: { teamId: "123" } },
    teamHub: {},
    scout: {},
    leagueIntel: {},
    playerLab: {},
  });
});
