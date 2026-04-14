import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrRepairRecentCachedMatchBoxscore,
  getNormalizedCachedMatchBoxscore,
  normalizeCachedMatchBoxscoreRecord,
} from "../amplify/data/_backend/cached-boxscore";

test("normalizeCachedMatchBoxscoreRecord returns a typed boxscore for stored rows", () => {
  const normalized = normalizeCachedMatchBoxscoreRecord({
    boxscoreJson: {
      matchId: "m-stored",
      source: "MATCH_BOXSCORE_CACHE",
      homeTeam: {
        teamId: "T1",
        teamName: "Home",
        players: [],
      },
      awayTeam: {
        teamId: "T2",
        teamName: "Away",
        players: [],
      },
    },
    matchId: "m-stored",
  });

  assert.ok(normalized);
  assert.equal(normalized.boxscore.matchId, "m-stored");
  assert.equal(normalized.record.matchId, "m-stored");
});

test("normalizeCachedMatchBoxscoreRecord tolerates malformed legacy rows", () => {
  const normalized = normalizeCachedMatchBoxscoreRecord({
    boxscoreJson: "{not-json",
    matchId: "m-bad",
  });

  assert.equal(normalized, null);
});

test("getNormalizedCachedMatchBoxscore returns null when the cached row is unreadable", async () => {
  const normalized = await getNormalizedCachedMatchBoxscore({
    env: {},
    getRecord: async () => ({
      boxscoreJson: "{not-json",
      matchId: "m-bad",
    }),
    matchId: "m-bad",
    userId: "user-1",
  });

  assert.equal(normalized, null);
});

test("getOrRepairRecentCachedMatchBoxscore returns a cache hit without live repair", async () => {
  let repaired = false;
  let persisted = false;

  const normalized = await getOrRepairRecentCachedMatchBoxscore({
    createBbClient: () => ({
      getBoxScore: async () => {
        repaired = true;
        throw new Error("live repair should not run");
      },
    }),
    env: {},
    getBbConnection: async () => ({ bbLoginName: "coach-alpha" }),
    matchId: "m-hit",
    readRecord: async () => ({
      status: "hit",
      record: {
        matchId: "m-hit",
        boxscoreJson: {
          matchId: "m-hit",
          source: "WORKSPACE_CACHE",
          homeTeam: {
            teamId: "T1",
            teamName: "Home",
            players: [],
          },
          awayTeam: {
            teamId: "T2",
            teamName: "Away",
            players: [],
          },
        },
      } as any,
    }),
    resolveBbAccessKey: async () => "secret",
    upsertMatchBoxscore: async () => {
      persisted = true;
    },
    userId: "user-1",
  });

  assert.ok(normalized);
  assert.equal(normalized.boxscore.matchId, "m-hit");
  assert.equal(repaired, false);
  assert.equal(persisted, false);
});

test("getOrRepairRecentCachedMatchBoxscore repairs an unreadable cache row", async () => {
  let repaired = false;
  const persistedMatchIds: string[] = [];

  const normalized = await getOrRepairRecentCachedMatchBoxscore({
    createBbClient: () => ({
      getBoxScore: async (matchId: string) => {
        repaired = true;
        return {
          matchId,
          retrievedAt: "2026-04-14T06:40:00.000Z",
          homeTeam: {
            id: "T1",
            teamName: "Home",
            offStrategy: "Motion",
            defStrategy: "23Zone",
            players: [],
          },
          awayTeam: {
            id: "T2",
            teamName: "Away",
            offStrategy: "Base",
            defStrategy: "ManToMan",
            players: [],
          },
        } as any;
      },
    }),
    env: {},
    getBbConnection: async () => ({ bbLoginName: "coach-alpha" }),
    matchId: "m-repair",
    readRecord: async () => ({
      status: "unreadable",
      errorMessage: "legacy row",
    }),
    resolveBbAccessKey: async () => "secret",
    upsertMatchBoxscore: async (_env, record) => {
      persistedMatchIds.push(String(record.matchId));
    },
    userId: "user-1",
  });

  assert.ok(normalized);
  assert.equal(normalized.boxscore.matchId, "m-repair");
  assert.equal(repaired, true);
  assert.deepStrictEqual(persistedMatchIds, ["m-repair"]);
});

test("getOrRepairRecentCachedMatchBoxscore does not live-repair a plain cache miss", async () => {
  let repaired = false;

  const normalized = await getOrRepairRecentCachedMatchBoxscore({
    createBbClient: () => ({
      getBoxScore: async () => {
        repaired = true;
        throw new Error("live repair should not run");
      },
    }),
    env: {},
    getBbConnection: async () => ({ bbLoginName: "coach-alpha" }),
    matchId: "m-missing",
    readRecord: async () => ({
      status: "missing",
    }),
    resolveBbAccessKey: async () => "secret",
    upsertMatchBoxscore: async () => undefined,
    userId: "user-1",
  });

  assert.equal(normalized, null);
  assert.equal(repaired, false);
});
