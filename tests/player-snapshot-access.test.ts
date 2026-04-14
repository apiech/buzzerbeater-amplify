import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as snapshotAccessTesting,
  getOwnerTrackedPlayerProfile,
  listWorkspacePlayerHistory,
} from "../amplify/data/_backend/player-snapshot-access";
import { WORKSPACE_CACHE_VERSION } from "../amplify/data/_backend/workspace-cache";

test("listWorkspacePlayerHistory rejects players outside the caller workspace cache", async () => {
  await withSnapshotAccessRuntime(
    {
      getBbConnection: async () => createWorkspaceConnection("other-player"),
    },
    async () => {
      await assert.rejects(
        () => listWorkspacePlayerHistory({} as any, "user-1", "p1"),
        /The requested player is not available in the current workspace\./,
      );
    },
  );
});

test("listWorkspacePlayerHistory strips non-allowlisted snapshot fields", async () => {
  await withSnapshotAccessRuntime(
    {
      getBbConnection: async () => createWorkspaceConnection("p1"),
      listCanonicalPlayerSkillSnapshots: async () => [
        {
          playerId: "p1",
          weekKey: "2026-W10",
          capturedAt: "2026-03-03T10:00:00.000Z",
          salary: 110000,
          bestPosition: "SG",
          gameShape: "respectable",
          dmi: 1400,
          injuryWeeks: 1,
          payload: {
            profile: {
              skills: {
                jumpShot: 99,
              },
            },
          },
          fields: {
            hidden: true,
          },
        } as any,
      ],
      listPlayerSkillObservations: async () => [
        {
          playerId: "p1",
          weekKey: "2026-W11",
          capturedAt: "2026-03-10T10:00:00.000Z",
          salary: 120000,
          bestPosition: "PG",
          gameShape: "proficient",
          dmi: 1500,
          injuryWeeks: 0,
          payload: {
            profile: {
              skills: {
                jumpShot: 88,
              },
            },
          },
          skills: {
            jumpShot: 88,
          },
        } as any,
      ],
    },
    async () => {
      const history = await listWorkspacePlayerHistory({} as any, "user-1", "p1");
      assert.deepStrictEqual(history, [
        {
          weekKey: "2026-W10",
          capturedAt: "2026-03-03T10:00:00.000Z",
          salary: 110000,
          bestPosition: "SG",
          gameShape: "respectable",
          dmi: 1400,
          injuryWeeks: 1,
        },
        {
          weekKey: "2026-W11",
          capturedAt: "2026-03-10T10:00:00.000Z",
          salary: 120000,
          bestPosition: "PG",
          gameShape: "proficient",
          dmi: 1500,
          injuryWeeks: 0,
        },
      ]);
    },
  );
});

test("getOwnerTrackedPlayerProfile returns the owner-scoped tracked profile", async () => {
  await withSnapshotAccessRuntime(
    {
      getBbConnection: async () => createWorkspaceConnection("p1"),
      getTrackedPlayer: async () => ({
        profileJson: {
          id: "p1",
          firstName: "Lead",
          lastName: "Guard",
          fullName: "Lead Guard",
          salary: 50000,
          bestPosition: "PG",
          age: 26,
          height: 74,
          dmi: 1500,
          injuryWeeks: 0,
          nationality: {
            id: "1",
            name: "USA",
            attributes: {
              id: "1",
            },
          },
          skills: {
            gameShape: 8,
            potential: 10,
            jumpShot: 7,
            range: 6,
            outsideDef: 5,
            handling: 8,
            driving: 7,
            passing: 9,
            insideShot: 4,
            insideDef: 3,
            rebound: 4,
            block: 2,
            stamina: 8,
            freeThrow: 7,
            experience: 6,
          },
        },
      }),
    },
    async () => {
      const profile = await getOwnerTrackedPlayerProfile({} as any, "user-1", "p1");
      assert.deepStrictEqual(profile, {
        id: "p1",
        firstName: "Lead",
        lastName: "Guard",
        fullName: "Lead Guard",
        salary: 50000,
        bestPosition: "PG",
        age: 26,
        height: 74,
        dmi: 1500,
        injuryWeeks: 0,
        nationality: {
          id: "1",
          name: "USA",
          attributes: {
            id: "1",
          },
        },
        skills: {
          gameShape: 8,
          potential: 10,
          jumpShot: 7,
          range: 6,
          outsideDef: 5,
          handling: 8,
          driving: 7,
          passing: 9,
          insideShot: 4,
          insideDef: 3,
          rebound: 4,
          block: 2,
          stamina: 8,
          freeThrow: 7,
          experience: 6,
        },
      });
    },
  );
});

test("getOwnerTrackedPlayerProfile falls back to the latest canonical snapshot payload", async () => {
  await withSnapshotAccessRuntime(
    {
      getBbConnection: async () => createWorkspaceConnection("p1"),
      getTrackedPlayer: async () => null,
      listCanonicalPlayerSkillSnapshots: async () => [
        {
          playerId: "p1",
          weekKey: "2026-W11",
          capturedAt: "2026-03-10T10:00:00.000Z",
          payload: {
            profile: {
              id: "p1",
              firstName: "Lead",
              lastName: "Guard",
              fullName: "Lead Guard",
              salary: 50000,
              bestPosition: "PG",
              age: 26,
              height: 74,
              dmi: 1500,
              injuryWeeks: 0,
              nationality: {
                id: "1",
                name: "USA",
                attributes: {
                  id: "1",
                },
              },
              skills: {
                gameShape: 8,
                potential: 10,
                jumpShot: 7,
                range: 6,
                outsideDef: 5,
                handling: 8,
                driving: 7,
                passing: 9,
                insideShot: 4,
                insideDef: 3,
                rebound: 4,
                block: 2,
                stamina: 8,
                freeThrow: 7,
                experience: 6,
              },
            },
          },
        } as any,
      ],
    },
    async () => {
      const profile = await getOwnerTrackedPlayerProfile({} as any, "user-1", "p1");
      assert.ok(profile);
      assert.equal(profile.id, "p1");
      assert.equal(profile.skills.jumpShot, 7);
      assert.equal(profile.skills.passing, 9);
    },
  );
});

test("getOwnerTrackedPlayerProfile rejects players outside the caller workspace cache", async () => {
  await withSnapshotAccessRuntime(
    {
      getBbConnection: async () => createWorkspaceConnection("other-player"),
    },
    async () => {
      await assert.rejects(
        () => getOwnerTrackedPlayerProfile({} as any, "user-1", "p1"),
        /The requested player is not available in the current workspace\./,
      );
    },
  );
});

function createWorkspaceConnection(playerId: string) {
  return {
    userId: "user-1",
    bbLoginName: "coach",
    status: "CONNECTED",
    refreshSortAt: "2026-03-15T00:00:00.000Z",
    workspaceCacheJson: {
      version: WORKSPACE_CACHE_VERSION,
      home: {},
      teamHub: {
        roster: [{ playerId }],
      },
      scout: {},
      leagueIntel: {},
      playerLab: {
        players: [],
      },
      arena: {
        syncedAt: null,
        nextHomeMatch: null,
        arena: {
          name: null,
          seats: [],
          expansion: null,
        },
        economy: {
          cash: null,
          availableBalance: null,
          transactions: [],
        },
        recentHomeGames: [],
        recommendation: null,
        diagnostics: {
          comparableGameCount: 0,
          matchedSnapshotCount: 0,
          lowConfidenceReasons: [],
        },
      },
    },
  } as any;
}

async function withSnapshotAccessRuntime(
  overrides: Partial<typeof snapshotAccessTesting.runtime>,
  run: () => Promise<void>,
) {
  const original = { ...snapshotAccessTesting.runtime };
  Object.assign(snapshotAccessTesting.runtime, overrides);
  try {
    await run();
  } finally {
    Object.assign(snapshotAccessTesting.runtime, original);
  }
}
