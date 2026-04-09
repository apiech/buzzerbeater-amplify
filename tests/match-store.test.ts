import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as matchStoreTesting,
  getMatchBoxscoreDetails,
  listAccessibleMatches,
  type MatchCatalogRecord,
} from "../amplify/data/_backend/match-store";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

function createCompletePredictionRatings(base: number) {
  return {
    outsideScoring: base,
    insideScoring: base - 0.5,
    outsideDefense: base - 1,
    insideDefense: base - 1.5,
    rebounding: base - 2,
    offensiveFlow: base - 2.5,
  };
}

function createDependencies(overrides: Partial<any> = {}): any {
  return {
    listTrackedTeamsForUser: async () => [],
    getBbConnection: async () => null,
    getLegacyMatchBoxscore: async () => null,
    resolveBbAccessKey: async () => "secret",
    createBbClient: () => ({
      getSeasons: async () => ({ seasons: [{ id: 72 }] }),
      getSchedule: async () => ({ matches: [] }),
      getBoxScore: async () => ({
        matchId: "m1",
        homeTeam: {
          id: "T1",
          teamName: "Home",
          score: 80,
          ratings: createCompletePredictionRatings(9.5),
        },
        awayTeam: {
          id: "T2",
          teamName: "Away",
          score: 70,
          ratings: createCompletePredictionRatings(8.5),
        },
      }),
      getBoxScoreXml: async () => "<boxscore />",
    }),
    fetchMatchReport: async () => "<report />",
    getCatalog: async () => null,
    putCatalog: async () => undefined,
    queryTeamProjections: async () => [],
    putTeamProjection: async () => undefined,
    putTextObject: async () => undefined,
    putJsonObject: async () => undefined,
    getJsonObject: async () => ({}),
    sendIngestMessage: async () => undefined,
    sendMaterializeMessage: async () => undefined,
    buildMatchPackage: async () => ({
      matchId: "m1",
      parserVersion: "v1",
      contentHash: "sha256:abc",
      summary: {
        homeTeam: { id: "T1", teamName: "Home", score: 80 },
        awayTeam: { id: "T2", teamName: "Away", score: 70 },
        startTime: "2026-03-15T20:00:00.000Z",
        eventCount: 3,
      },
      boxscore: {
        homeTeam: {
          id: "T1",
          teamName: "Home",
          offStrategy: "Base",
          defStrategy: "ManToMan",
          ratings: createCompletePredictionRatings(9.1),
          efficiency: { pp100: 101.2 },
        },
        awayTeam: {
          id: "T2",
          teamName: "Away",
          offStrategy: "Push",
          defStrategy: "23Zone",
          ratings: createCompletePredictionRatings(8.4),
          efficiency: { pp100: 95.3 },
        },
      },
      playByPlay: { events: [] },
    }),
    materializeMatchPackage: async () => ({
      manifest: { version: 1, datasets: {} },
      workingDir: "/tmp/match-store-test",
      outDir: "/tmp/match-store-test",
    }),
    updateCatalogMaterialization: async () => undefined,
    ...overrides,
  };
}

test("listAccessibleMatches deduplicates matches across accessible teams", async () => {
  const payload = await listAccessibleMatches(
    {
      env: {
        MATCH_STORE_BUCKET_NAME: "bucket",
        MATCH_CATALOG_TABLE_NAME: "catalog",
        TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
        MATCH_INGEST_QUEUE_URL: "ingest",
        MATCH_MATERIALIZE_QUEUE_URL: "materialize",
      },
      identity: { sub: "user-1" },
    },
    createDependencies({
      listTrackedTeamsForUser: async () => [
        { teamId: "T1" },
        { teamId: "T2" },
      ],
      getBbConnection: async () => ({ teamId: "T1" }),
      queryTeamProjections: async (_env: unknown, teamId: string) =>
        teamId === "T1"
          ? [
              {
                teamId: "T1",
                seasonStartMatchKey: "72#2026-03-15T20:00:00.000Z#m1",
                startTime: "2026-03-15T20:00:00.000Z",
                matchId: "m1",
                season: 72,
                opponentTeamId: "T2",
                opponentTeamName: "Away",
                ingestStatus: "SUCCEEDED",
              },
            ]
          : [
              {
                teamId: "T2",
                seasonStartMatchKey: "72#2026-03-15T20:00:00.000Z#m1",
                startTime: "2026-03-15T20:00:00.000Z",
                matchId: "m1",
                season: 72,
                opponentTeamId: "T1",
                opponentTeamName: "Home",
                ingestStatus: "SUCCEEDED",
              },
              {
                teamId: "T2",
                seasonStartMatchKey: "72#2026-03-14T20:00:00.000Z#m2",
                startTime: "2026-03-14T20:00:00.000Z",
                matchId: "m2",
                season: 72,
                opponentTeamId: "T3",
                opponentTeamName: "Third",
                ingestStatus: "SUCCEEDED",
              },
            ],
    }),
  );

  const typedPayload = payload as { items: Array<{ matchId: string }> };
  assert.equal(Array.isArray(typedPayload.items), true);
  assert.equal(typedPayload.items.length, 2);
  const firstItem = typedPayload.items[0];
  const secondItem = typedPayload.items[1];
  assert.ok(firstItem);
  assert.ok(secondItem);
  assert.equal(firstItem.matchId, "m1");
  assert.equal(secondItem.matchId, "m2");
});

test("getMatchBoxscoreDetails prefers canonical match-store payloads", async () => {
  const catalog: MatchCatalogRecord = {
    matchId: "m1",
    homeTeamId: "T1",
    awayTeamId: "T2",
    ingestStatus: "SUCCEEDED",
    canonicalKey: "canonical/m1.json",
  };

  const payload = await getMatchBoxscoreDetails(
    {
      env: {
        MATCH_STORE_BUCKET_NAME: "bucket",
        MATCH_CATALOG_TABLE_NAME: "catalog",
        TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
        MATCH_INGEST_QUEUE_URL: "ingest",
        MATCH_MATERIALIZE_QUEUE_URL: "materialize",
      },
      identity: { sub: "user-1" },
      matchId: "m1",
    },
    createDependencies({
      listTrackedTeamsForUser: async () => [{ teamId: "T1" }],
      getBbConnection: async () => ({ teamId: "T1" }),
      getCatalog: async () => catalog,
      getJsonObject: async () => ({
        matchId: "m1",
        boxscore: {
          homeTeam: {
            id: "T1",
            teamName: "Home",
            offStrategy: "Base",
            defStrategy: "ManToMan",
            ratings: createCompletePredictionRatings(9.1),
            efficiency: { pp100: 101.2 },
          },
          awayTeam: {
            id: "T2",
            teamName: "Away",
            offStrategy: "Push",
            defStrategy: "23Zone",
            ratings: createCompletePredictionRatings(8.4),
            efficiency: { pp100: 95.3 },
          },
        },
      }),
      getLegacyMatchBoxscore: async () => {
        throw new Error("legacy path should not be used");
      },
    }),
  );

  const typedPayload = payload as {
    awayTeam: { teamName: string | null } | null;
    homeTeam: { teamName: string | null } | null;
    source: string;
  };
  assert.equal(typedPayload.source, "CANONICAL_MATCH_STORE");
  assert.equal(typedPayload.homeTeam?.teamName, "Home");
  assert.equal(typedPayload.awayTeam?.teamName, "Away");
});

test("getMatchBoxscoreDetails falls back to neutral per-user cache for unrelated matches", async () => {
  const payload = await getMatchBoxscoreDetails(
    {
      env: {
        MATCH_STORE_BUCKET_NAME: "bucket",
        MATCH_CATALOG_TABLE_NAME: "catalog",
        TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
        MATCH_INGEST_QUEUE_URL: "ingest",
        MATCH_MATERIALIZE_QUEUE_URL: "materialize",
      },
      identity: { sub: "user-1" },
      matchId: "m9",
    },
    createDependencies({
      getCatalog: async () => null,
      getLegacyMatchBoxscore: async () => ({
        matchId: "m9",
        boxscoreJson: {
          endTime: "2026-03-10T21:55:00.000Z",
          homeTeam: {
            id: "T8",
            teamName: "Unrelated Home",
            offStrategy: "Motion",
            defStrategy: "32Zone",
            ratings: createCompletePredictionRatings(9.1),
          },
          awayTeam: {
            id: "T9",
            teamName: "Unrelated Away",
            offStrategy: "Push",
            defStrategy: "23Zone",
            ratings: createCompletePredictionRatings(8.4),
          },
          matchId: "m9",
          startTime: "2026-03-10T20:00:00.000Z",
          type: "League",
        },
      }),
      listTrackedTeamsForUser: async () => [],
      getBbConnection: async () => ({ teamId: "T1" }),
    }),
  );

  const typedPayload = payload as {
    awayTeam: { teamName: string | null } | null;
    homeTeam: { teamName: string | null } | null;
    source: string;
  };
  assert.equal(typedPayload.source, "MATCH_BOXSCORE_CACHE");
  assert.equal(typedPayload.homeTeam?.teamName, "Unrelated Home");
  assert.equal(typedPayload.awayTeam?.teamName, "Unrelated Away");
});

test("getMatchBoxscoreDetails tolerates malformed cached optional metrics and legacy team ids", async () => {
  const payload = await getMatchBoxscoreDetails(
    {
      env: {
        MATCH_STORE_BUCKET_NAME: "bucket",
        MATCH_CATALOG_TABLE_NAME: "catalog",
        TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
        MATCH_INGEST_QUEUE_URL: "ingest",
        MATCH_MATERIALIZE_QUEUE_URL: "materialize",
      },
      identity: { sub: "user-1" },
      matchId: "m10",
    },
    createDependencies({
      getCatalog: async () => null,
      getLegacyMatchBoxscore: async () => ({
        matchId: "m10",
        boxscoreJson: {
          matchId: "m10",
          homeTeam: {
            teamId: "T8",
            teamName: "Legacy Home",
            offStrategy: "Motion",
            defStrategy: "32Zone",
            ratings: createCompletePredictionRatings(9.1),
            teamTotals: {
              fg: "40",
              turnover: "N/A",
            },
            efficiency: {
              pp100: "101.2",
              ts: "bad",
            },
            players: [
              {
                id: "p1",
                fullName: "Starter One",
                performance: {
                  points: "18",
                  foulTrouble: "unknown",
                },
                minutesByPosition: {
                  PG: "24",
                  SG: "DNP",
                },
              },
            ],
          },
          awayTeam: {
            teamId: "T9",
            teamName: "Legacy Away",
            offStrategy: "Push",
            defStrategy: "23Zone",
            ratings: createCompletePredictionRatings(8.4),
          },
          startTime: "2026-03-10T20:00:00.000Z",
          type: "League",
        },
      }),
      listTrackedTeamsForUser: async () => [],
      getBbConnection: async () => ({ teamId: "T1" }),
    }),
  );

  const typedPayload = payload as {
    awayTeam: { teamId: string | null; teamName: string | null } | null;
    homeTeam: {
      teamId: string | null;
      teamName: string | null;
      teamTotals: Array<{ key: string; numberValue: number }>;
      efficiency: Array<{ key: string; numberValue: number }>;
      players: Array<{
        minutes: number | null;
        performance: Array<{ key: string; numberValue: number }>;
      }>;
    } | null;
    source: string;
  };
  assert.equal(typedPayload.source, "MATCH_BOXSCORE_CACHE");
  assert.equal(typedPayload.homeTeam?.teamId, "T8");
  assert.equal(typedPayload.awayTeam?.teamId, "T9");
  assert.deepStrictEqual(typedPayload.homeTeam?.teamTotals, [
    { key: "fg", numberValue: 40 },
  ]);
  assert.deepStrictEqual(typedPayload.homeTeam?.efficiency, [
    { key: "pp100", numberValue: 101.2 },
  ]);
  assert.deepStrictEqual(typedPayload.homeTeam?.players[0]?.performance, [
    { key: "points", numberValue: 18 },
  ]);
  assert.equal(typedPayload.homeTeam?.players[0]?.minutes, 24);
});

test("getMatchBoxscoreDetails fetches live BB data when both caches miss", async () => {
  let receivedOptions: { securityCode: string; username: string } | null = null;

  const payload = await getMatchBoxscoreDetails(
    {
      env: {
        MATCH_STORE_BUCKET_NAME: "bucket",
        MATCH_CATALOG_TABLE_NAME: "catalog",
        TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
        MATCH_INGEST_QUEUE_URL: "ingest",
        MATCH_MATERIALIZE_QUEUE_URL: "materialize",
      },
      identity: { sub: "user-1" },
      matchId: "m42",
    },
    createDependencies({
      getCatalog: async () => null,
      getLegacyMatchBoxscore: async () => null,
      getBbConnection: async () => ({
        bbLoginName: "apiuser",
        teamId: "T1",
      }),
      createBbClient: (options?: { securityCode: string; username: string }) => {
        receivedOptions = options ?? null;
        return {
          getBoxScore: async () => ({
            awayTeam: {
              id: "T3",
              teamName: "Road Club",
              offStrategy: "Push",
              defStrategy: "23Zone",
              ratings: createCompletePredictionRatings(8.7),
            },
            endTime: "2026-03-12T21:58:00.000Z",
            homeTeam: {
              id: "T2",
              teamName: "Host Club",
              offStrategy: "Motion",
              defStrategy: "ManToMan",
              ratings: createCompletePredictionRatings(9.9),
            },
            matchId: "m42",
            startTime: "2026-03-12T20:00:00.000Z",
            type: "Cup",
          }),
          getBoxScoreXml: async () => "<boxscore />",
        };
      },
      listTrackedTeamsForUser: async () => [],
      resolveBbAccessKey: async () => "secret",
    }),
  );

  const typedPayload = payload as {
    awayTeam: { teamName: string | null } | null;
    homeTeam: { teamName: string | null } | null;
    source: string;
  };
  assert.deepStrictEqual(receivedOptions, {
    username: "apiuser",
    securityCode: "secret",
  });
  assert.equal(typedPayload.source, "LIVE_BB_API");
  assert.equal(typedPayload.homeTeam?.teamName, "Host Club");
  assert.equal(typedPayload.awayTeam?.teamName, "Road Club");
});

test("getMatchBoxscoreDetails skips incomplete cached ratings and refreshes from live BB data", async () => {
  const payload = await getMatchBoxscoreDetails(
    {
      env: {
        MATCH_STORE_BUCKET_NAME: "bucket",
        MATCH_CATALOG_TABLE_NAME: "catalog",
        TEAM_MATCH_PROJECTION_TABLE_NAME: "projection",
        MATCH_INGEST_QUEUE_URL: "ingest",
        MATCH_MATERIALIZE_QUEUE_URL: "materialize",
      },
      identity: { sub: "user-1" },
      matchId: "m7",
    },
    createDependencies({
      getCatalog: async () => ({
        matchId: "m7",
        homeTeamId: "T1",
        awayTeamId: "T2",
        ingestStatus: "SUCCEEDED",
        canonicalKey: "canonical/m7.json",
      }),
      getJsonObject: async () => ({
        matchId: "m7",
        boxscore: {
          homeTeam: {
            id: "T1",
            teamName: "Stale Home",
            offStrategy: "Base",
            defStrategy: "ManToMan",
            ratings: { outsideScoring: 9.1 },
          },
          awayTeam: {
            id: "T2",
            teamName: "Stale Away",
            offStrategy: "Push",
            defStrategy: "23Zone",
            ratings: { outsideScoring: 8.4 },
          },
        },
      }),
      getBbConnection: async () => ({
        bbLoginName: "apiuser",
        teamId: "T1",
      }),
      createBbClient: () => ({
        getBoxScore: async () => ({
          matchId: "m7",
          homeTeam: {
            id: "T1",
            teamName: "Fresh Home",
            offStrategy: "Base",
            defStrategy: "ManToMan",
            ratings: createCompletePredictionRatings(9.9),
          },
          awayTeam: {
            id: "T2",
            teamName: "Fresh Away",
            offStrategy: "Push",
            defStrategy: "23Zone",
            ratings: createCompletePredictionRatings(8.8),
          },
        }),
        getBoxScoreXml: async () => "<boxscore />",
      }),
      listTrackedTeamsForUser: async () => [{ teamId: "T1" }],
    }),
  );

  const typedPayload = payload as {
    awayTeam: { teamName: string | null } | null;
    homeTeam: { teamName: string | null } | null;
    source: string;
  };
  assert.equal(typedPayload.source, "LIVE_BB_API");
  assert.equal(typedPayload.homeTeam?.teamName, "Fresh Home");
  assert.equal(typedPayload.awayTeam?.teamName, "Fresh Away");
});

test("catalog and projection builders expose the expected canonical fields", () => {
  const catalog = matchStoreTesting.buildCatalogRecordFromPackage(
    {
      matchId: "m1",
      season: 72,
      parserVersion: "v1",
      contentHash: "sha256:abc",
      summary: {
        type: "League",
        startTime: "2026-03-15T20:00:00.000Z",
        eventCount: 10,
        homeTeam: { id: "T1", teamName: "Home", score: 80 },
        awayTeam: { id: "T2", teamName: "Away", score: 70 },
      },
    },
    {
      canonicalKey: "canonical/m1.json",
      rawBoxscoreKey: "raw/m1/boxscore.xml",
      rawReportKey: "raw/m1/report.xml",
      status: "SUCCEEDED",
      lastIngestedAt: "2026-03-15T21:00:00.000Z",
    },
  );

  const projections = matchStoreTesting.buildProjectionRecords({ summary: {} }, catalog);
  assert.equal(catalog.homeTeamId, "T1");
  assert.equal(projections.length, 2);
  assert.equal(projections[0]?.matchId, "m1");
});
