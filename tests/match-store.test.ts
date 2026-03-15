import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as matchStoreTesting,
  getMatchBoxscoreDetails,
  listAccessibleMatches,
  type MatchCatalogRecord,
} from "../amplify/data/_backend/match-store";

function createDependencies(overrides: Partial<any> = {}): any {
  return {
    listBbConnections: async () => [],
    listTrackedTeams: async () => [],
    getBbConnection: async () => null,
    getLegacyMatchBoxscore: async () => null,
    resolveBbAccessKey: async () => "secret",
    createBbClient: () => ({
      getSeasons: async () => ({ seasons: [{ id: 72 }] }),
      getSchedule: async () => ({ matches: [] }),
      getBoxScore: async () => ({
        matchId: "m1",
        homeTeam: { id: "T1", teamName: "Home", score: 80 },
        awayTeam: { id: "T2", teamName: "Away", score: 70 },
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
          ratings: { outsideScoring: 9.1 },
          efficiency: { pp100: 101.2 },
        },
        awayTeam: {
          id: "T2",
          teamName: "Away",
          offStrategy: "Push",
          defStrategy: "23Zone",
          ratings: { outsideScoring: 8.4 },
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
      listTrackedTeams: async () => [
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
  assert.equal(typedPayload.items[0].matchId, "m1");
  assert.equal(typedPayload.items[1].matchId, "m2");
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
      listTrackedTeams: async () => [{ teamId: "T1" }],
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
            ratings: { outsideScoring: 9.1 },
            efficiency: { pp100: 101.2 },
          },
          awayTeam: {
            id: "T2",
            teamName: "Away",
            offStrategy: "Push",
            defStrategy: "23Zone",
            ratings: { outsideScoring: 8.4 },
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
    source: string;
    offStrategy: string | null;
    opponentTeamName: string | null;
  };
  assert.equal(typedPayload.source, "CANONICAL_MATCH_STORE");
  assert.equal(typedPayload.offStrategy, "Base");
  assert.equal(typedPayload.opponentTeamName, "Away");
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
  assert.equal(projections[0].matchId, "m1");
});
