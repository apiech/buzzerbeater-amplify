import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  getLeagueHistory,
  processLeagueHistoryBackfill,
  submitLeagueHistoryBackfill,
} from "../amplify/data/_backend/league-history";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();
import type {
  LeagueHistoryBackfillRecord,
  LeagueHistoryStandingCacheRecord,
} from "../amplify/data/_backend/repository";

test("aggregateLeagueHistoryRows merges cached history with live current standings", () => {
  const rows = __testing.aggregateLeagueHistoryRows([
    createStandingCache({
      season: 70,
      teamId: "A",
      teamName: "Alpha",
      wins: 10,
      losses: 2,
      pf: 1000,
      pa: 900,
    }),
    createStandingCache({
      season: 71,
      teamId: "A",
      teamName: "Alpha",
      wins: 8,
      losses: 6,
      pf: 980,
      pa: 950,
    }),
    createStandingCache({
      season: 72,
      teamId: "A",
      teamName: "Alpha",
      wins: 4,
      losses: 1,
      pf: 410,
      pa: 395,
    }),
    createStandingCache({
      season: 71,
      teamId: "B",
      teamName: "Beta",
      wins: 12,
      losses: 4,
      pf: 1010,
      pa: 970,
    }),
  ]);
  const alpha = rows.find((row) => row.teamId === "A");

  assert.ok(alpha);
  assert.equal(alpha.seasons, 3);
  assert.equal(alpha.games, 31);
  assert.equal(alpha.wins, 22);
  assert.equal(alpha.losses, 9);
  assert.equal(alpha.pf, 2390);
  assert.equal(alpha.pa, 2245);
  assert.equal(alpha.pointMargin, 145);
  assert.equal(Number(alpha.winPct.toFixed(4)), 0.7097);
});

test("determineMissingHistoricalSeasons skips cached seasons and ignores current season", () => {
  assert.deepStrictEqual(
    __testing.determineMissingHistoricalSeasons({
      cachedRows: [
        createStandingCache({
          season: 70,
          teamId: "A",
        }),
      ],
      currentSeason: 72,
      seasons: [70, 71, 72],
    }),
    [71],
  );
});

test("submitLeagueHistoryBackfill dedupes an active league job", async () => {
  let queueCalls = 0;

  const result = await submitLeagueHistoryBackfill(
    {
      env: {} as any,
      identity: { sub: "user-1" },
      queueUrl: "https://queue.example.com/league-history",
    },
    {
      createBbClient: () =>
        ({
          getSeasons: async () => ({
            seasons: [],
          }),
          getStandings: async () => {
            throw new Error("not used");
          },
        }) as any,
      getBbConnection: async () =>
        ({
          bbLoginName: "coach",
          leagueId: "L1",
          leagueName: "League One",
          userId: "user-1",
        }) as any,
      getLeagueHistoryBackfill: async () =>
        ({
          leagueId: "L1",
          requestedAt: "2026-03-19T12:00:00.000Z",
          status: "QUEUED",
          updatedAt: "2026-03-19T12:00:00.000Z",
        }) as LeagueHistoryBackfillRecord,
      listLeagueHistoryStandingCachesByLeagueId: async () => ({
        nextToken: null,
        records: [],
      }),
      now: () => new Date("2026-03-19T12:05:00.000Z"),
      resolveBbAccessKey: async () => "secret",
      sendQueueMessage: async () => {
        queueCalls += 1;
      },
      upsertLeagueHistoryBackfill: async () => {
        throw new Error("should not persist a new record");
      },
    },
  );

  assert.equal(result.leagueId, "L1");
  assert.equal(result.queued, false);
  assert.equal(result.status, "QUEUED");
  assert.equal(queueCalls, 0);
});

test("getLeagueHistory respects an explicit league override", async () => {
  const payload = await getLeagueHistory(
    {
      env: {} as any,
      identity: { sub: "user-1" },
      leagueId: "L2",
    },
    {
      createBbClient: () =>
        ({
          getSeasons: async () => ({
            seasons: [],
          }),
          getStandings: async (leagueId?: string) => ({
            conferences: [
              {
                index: 0,
                teams: [
                  {
                    id: "A",
                    losses: 1,
                    pa: 395,
                    pf: 410,
                    teamName: "Alpha",
                    wins: 4,
                  },
                ],
              },
            ],
            league: { id: leagueId ?? "L2", name: "Override League" },
            season: 72,
          }),
        }) as any,
      getBbConnection: async () =>
        ({
          bbLoginName: "coach",
          leagueId: "L1",
          leagueName: "League One",
          userId: "user-1",
        }) as any,
      getLeagueHistoryBackfill: async () =>
        ({
          historicalSeasonsExpected: 1,
          historicalSeasonsStored: 1,
          leagueId: "L2",
          leagueName: "Override League",
          requestedAt: "2026-03-19T12:00:00.000Z",
          status: "SUCCEEDED",
          updatedAt: "2026-03-19T12:10:00.000Z",
        }) as LeagueHistoryBackfillRecord,
      listLeagueHistoryStandingCachesByLeagueId: async (_env, leagueId) => ({
        nextToken: null,
        records: [
          createStandingCache({
            leagueId,
            season: 71,
            teamId: "A",
            teamName: "Alpha",
            wins: 8,
            losses: 6,
            pf: 980,
            pa: 950,
          }),
        ],
      }),
      resolveBbAccessKey: async () => "secret",
    },
  );

  assert.equal(payload.league.id, "L2");
  assert.equal(payload.league.name, "Override League");
  assert.equal(payload.summary.currentSeason, 72);
  assert.equal(payload.summary.historicalSeasonsStored, 1);
  assert.equal(payload.rows[0]?.wins, 12);
});

test("processLeagueHistoryBackfill skips stored seasons and only fetches missing historical standings", async () => {
  const getStandingsCalls: number[] = [];
  const cachedRows = [
    createStandingCache({
      season: 70,
      teamId: "A",
      wins: 10,
      losses: 2,
    }),
  ];
  const persistedRows: LeagueHistoryStandingCacheRecord[] = [];
  const persistedStatuses: LeagueHistoryBackfillRecord[] = [];

  await processLeagueHistoryBackfill(
    {
      env: {} as any,
      messageBody: JSON.stringify({
        leagueId: "L1",
        requestedAt: "2026-03-19T12:00:00.000Z",
        userId: "user-1",
      }),
    },
    {
      createBbClient: () =>
        ({
          getSeasons: async () => ({
            seasons: [{ id: 70 }, { id: 71 }, { id: 72 }],
          }),
          getStandings: async (_leagueId?: string, season?: number) => {
            getStandingsCalls.push(season ?? -1);
            return {
              conferences: [
                {
                  index: 0,
                  teams: [
                    {
                      id: "A",
                      losses: 6,
                      pa: 950,
                      pf: 980,
                      teamName: "Alpha",
                      wins: 8,
                    },
                  ],
                },
              ],
              league: { id: "L1", name: "League One" },
              retrievedAt: "2026-03-19T12:00:00.000Z",
              season: season ?? 72,
            };
          },
        }) as any,
      getBbConnection: async () =>
        ({
          bbLoginName: "coach",
          leagueId: "L1",
          leagueName: "League One",
          userId: "user-1",
        }) as any,
      getLeagueHistoryBackfill: async () => null,
      listLeagueHistoryStandingCachesByLeagueId: async () => ({
        nextToken: null,
        records: cachedRows,
      }),
      now: () => new Date("2026-03-19T12:00:00.000Z"),
      resolveBbAccessKey: async () => "secret",
      upsertLeagueHistoryBackfill: async (_env, input) => {
        persistedStatuses.push(input);
      },
      upsertLeagueHistoryStandingCache: async (_env, input) => {
        persistedRows.push(input);
      },
    },
  );

  assert.deepStrictEqual(getStandingsCalls, [71]);
  assert.equal(persistedRows.length, 1);
  assert.equal(
    persistedStatuses[persistedStatuses.length - 1]?.status,
    "SUCCEEDED",
  );
});

test("processLeagueHistoryBackfill persists a failed terminal status when standings fetch fails", async () => {
  const persistedStatuses: LeagueHistoryBackfillRecord[] = [];

  await assert.rejects(
    () =>
      processLeagueHistoryBackfill(
        {
          env: {} as any,
          messageBody: JSON.stringify({
            leagueId: "BAD",
            requestedAt: "2026-03-19T12:00:00.000Z",
            userId: "user-1",
          }),
        },
        {
          createBbClient: () =>
            ({
              getSeasons: async () => ({
                seasons: [{ id: 71 }, { id: 72 }],
              }),
              getStandings: async () => {
                throw new Error("League BAD could not be loaded.");
              },
            }) as any,
          getBbConnection: async () =>
            ({
              bbLoginName: "coach",
              leagueId: "L1",
              leagueName: "League One",
              userId: "user-1",
            }) as any,
          getLeagueHistoryBackfill: async () => null,
          listLeagueHistoryStandingCachesByLeagueId: async () => ({
            nextToken: null,
            records: [],
          }),
          now: () => new Date("2026-03-19T12:00:00.000Z"),
          resolveBbAccessKey: async () => "secret",
          upsertLeagueHistoryBackfill: async (_env, input) => {
            persistedStatuses.push(input);
          },
          upsertLeagueHistoryStandingCache: async () => {
            throw new Error("should not persist rows");
          },
        },
      ),
    /League BAD could not be loaded/i,
  );

  assert.equal(
    persistedStatuses[persistedStatuses.length - 1]?.status,
    "FAILED",
  );
  assert.match(
    persistedStatuses[persistedStatuses.length - 1]?.error ?? "",
    /league bad could not be loaded/i,
  );
});

function createStandingCache(
  overrides: Partial<LeagueHistoryStandingCacheRecord> = {},
): LeagueHistoryStandingCacheRecord {
  return {
    conferenceIndex: 0,
    fetchedAt: "2026-03-19T12:00:00.000Z",
    isBot: false,
    leagueId: "L1",
    leagueName: "League One",
    losses: 0,
    pa: 0,
    pf: 0,
    season: 71,
    teamId: "T1",
    teamName: "Team One",
    wins: 0,
    ...overrides,
  };
}
