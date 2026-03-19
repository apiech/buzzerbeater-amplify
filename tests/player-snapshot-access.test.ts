import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as snapshotAccessTesting,
  getOwnerTrackedPlayerProfile,
  listWorkspacePlayerHistory,
} from "../amplify/data/_backend/player-snapshot-access";

test("listWorkspacePlayerHistory rejects players outside the caller workspace cache", async () => {
  await withSnapshotAccessRuntime(
    {
      getBbConnection: async () => ({
        workspaceCacheJson: {
          teamHub: {
            roster: [{ playerId: "other-player" }],
          },
          playerLab: {
            players: [],
          },
        },
      }),
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
          age: 26,
          skills: {
            jumpShot: 7,
          },
        },
      }),
    },
    async () => {
      const profile = await getOwnerTrackedPlayerProfile({} as any, "user-1", "p1");
      assert.deepStrictEqual(profile, {
        age: 26,
        skills: {
          jumpShot: 7,
        },
      });
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
      teamHub: {
        roster: [{ playerId }],
      },
      playerLab: {
        players: [],
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
