import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  getLeagueHistory,
  getLeagueHistoryAudit,
  processLeagueHistoryBackfill,
  submitLeagueHistoryBackfill,
} from "../amplify/data/_backend/league-history";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();
import type {
  LeagueHistoryBackfillRecord,
  LeagueHistoryStandingCacheRecord,
} from "../amplify/data/_backend/repository";

test("aggregateLeagueHistoryRows keeps separate rows for same team ID across name eras", () => {
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
      teamName: "Apex",
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
  const alpha = rows.find(
    (row) => row.teamId === "A" && row.teamName === "Alpha",
  );
  const apex = rows.find(
    (row) => row.teamId === "A" && row.teamName === "Apex",
  );

  assert.ok(alpha);
  assert.ok(apex);
  assert.equal(alpha.seasons, 2);
  assert.equal(alpha.games, 26);
  assert.equal(alpha.wins, 18);
  assert.equal(alpha.losses, 8);
  assert.equal(alpha.pf, 1980);
  assert.equal(alpha.pa, 1850);
  assert.equal(alpha.pointMargin, 130);
  assert.equal(Number(alpha.winPct.toFixed(4)), 0.6923);
  assert.equal(apex.seasons, 1);
  assert.equal(apex.games, 5);
  assert.equal(apex.wins, 4);
  assert.equal(apex.losses, 1);
});

test("aggregateLeagueHistoryRows matches the Burlington split totals", () => {
  const rows = __testing.aggregateLeagueHistoryRows([
    ...createNameEraRows({
      losses: 175,
      pa: 29585,
      pf: 31611,
      seasons: [
        5, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      ],
      teamId: "22864",
      teamName: "Burlington Mountain Goats",
      wins: 199,
    }),
    ...createNameEraRows({
      losses: 62,
      pa: 9715,
      pf: 9716,
      seasons: [46, 47, 49, 50, 51],
      teamId: "22864",
      teamName: "Streetlight Nightmare",
      wins: 48,
    }),
  ]);

  const burlington = rows.find(
    (row) =>
      row.teamId === "22864" && row.teamName === "Burlington Mountain Goats",
  );
  const streetlight = rows.find(
    (row) => row.teamId === "22864" && row.teamName === "Streetlight Nightmare",
  );

  assert.ok(burlington);
  assert.ok(streetlight);
  assert.equal(burlington.seasons, 17);
  assert.equal(burlington.wins, 199);
  assert.equal(burlington.losses, 175);
  assert.equal(burlington.pf, 31611);
  assert.equal(burlington.pa, 29585);
  assert.equal(streetlight.seasons, 5);
  assert.equal(streetlight.wins, 48);
  assert.equal(streetlight.losses, 62);
  assert.equal(streetlight.pf, 9716);
  assert.equal(streetlight.pa, 9715);
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
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:league-history",
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
      startWorkflowExecution: async () => {
        queueCalls += 1;
        return "should-not-run";
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

test("submitLeagueHistoryBackfill queues a full refresh even when all seasons are already cached", async () => {
  let workflowCalls = 0;

  const result = await submitLeagueHistoryBackfill(
    {
      env: {} as any,
      identity: { sub: "user-1" },
      refreshMode: "REFRESH_ALL_HISTORICAL",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:league-history",
    },
    {
      createBbClient: () =>
        ({
          getSeasons: async () => ({
            seasons: [{ id: 70 }, { id: 71 }],
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
      getLeagueHistoryBackfill: async () => null,
      listLeagueHistoryStandingCachesByLeagueId: async () => ({
        nextToken: null,
        records: [
          createStandingCache({
            season: 70,
            teamId: "A",
          }),
        ],
      }),
      now: () => new Date("2026-03-19T12:05:00.000Z"),
      resolveBbAccessKey: async () => "secret",
      startWorkflowExecution: async () => {
        workflowCalls += 1;
        return "arn:aws:states:execution:league-history:run-1";
      },
      upsertLeagueHistoryBackfill: async () => {},
    },
  );

  assert.equal(result.leagueId, "L1");
  assert.equal(result.queued, true);
  assert.equal(result.status, "QUEUED");
  assert.equal(workflowCalls, 1);
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
                    teamName: "Apex",
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
  assert.equal(payload.summary.totalTeams, 2);
  assert.deepStrictEqual(
    payload.rows.map((row) => `${row.teamId}:${row.teamName}:${row.wins}`),
    ["A:Alpha:8", "A:Apex:4"],
  );
  assert.match(payload.warning ?? "", /split into separate rows/i);
});

test("getLeagueHistoryAudit flags mixed-name team IDs and cached-vs-live mismatches", async () => {
  const payload = await getLeagueHistoryAudit(
    {
      env: {} as any,
      identity: { sub: "user-1" },
      includeLiveComparison: true,
      leagueId: "L2",
    },
    {
      createBbClient: () =>
        ({
          getSeasons: async () => ({
            seasons: [{ id: 70 }, { id: 71 }],
          }),
          getStandings: async (_leagueId?: string, season?: number) => ({
            conferences: [
              {
                index: 0,
                teams: [
                  {
                    id: "A",
                    losses: season === 70 ? 10 : 9,
                    pa: season === 70 ? 1500 : 1480,
                    pf: season === 70 ? 1520 : 1495,
                    teamName:
                      season === 70
                        ? "Live Burlington"
                        : "Streetlight Nightmare",
                    wins: season === 70 ? 12 : 13,
                  },
                ],
              },
            ],
            league: { id: "L2", name: "Override League" },
            season: season ?? 71,
          }),
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
        records: [
          createStandingCache({
            leagueId: "L2",
            season: 70,
            teamId: "A",
            teamName: "Burlington Mountain Goats",
          }),
          createStandingCache({
            leagueId: "L2",
            season: 71,
            teamId: "A",
            teamName: "Streetlight Nightmare",
          }),
        ],
      }),
      resolveBbAccessKey: async () => "secret",
    },
  );

  assert.equal(payload.liveComparisonIncluded, true);
  assert.deepStrictEqual(payload.mixedNameTeams[0]?.teamNames, [
    "Burlington Mountain Goats",
    "Streetlight Nightmare",
  ]);
  assert.deepStrictEqual(payload.nameMismatches, [
    {
      cachedTeamName: "Burlington Mountain Goats",
      liveTeamName: "Live Burlington",
      season: 70,
      teamId: "A",
    },
  ]);
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

test("processLeagueHistoryBackfill refetches all historical seasons during a full refresh", async () => {
  const getStandingsCalls: number[] = [];
  const persistedRows: LeagueHistoryStandingCacheRecord[] = [];

  await processLeagueHistoryBackfill(
    {
      env: {} as any,
      messageBody: JSON.stringify({
        leagueId: "L1",
        refreshMode: "REFRESH_ALL_HISTORICAL",
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
                      teamName: season === 70 ? "Alpha" : "Apex",
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
        records: [
          createStandingCache({
            season: 70,
            teamId: "A",
            teamName: "Alpha",
            wins: 10,
          }),
        ],
      }),
      now: () => new Date("2026-03-19T12:00:00.000Z"),
      resolveBbAccessKey: async () => "secret",
      upsertLeagueHistoryBackfill: async () => {},
      upsertLeagueHistoryStandingCache: async (_env, input) => {
        persistedRows.push(input);
      },
    },
  );

  assert.deepStrictEqual(getStandingsCalls, [70, 71]);
  assert.equal(persistedRows.length, 2);
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

function createNameEraRows(args: {
  losses: number;
  pa: number;
  pf: number;
  seasons: number[];
  teamId: string;
  teamName: string;
  wins: number;
}): LeagueHistoryStandingCacheRecord[] {
  return args.seasons.map((season, index) =>
    createStandingCache({
      losses: index === 0 ? args.losses : 0,
      pa: index === 0 ? args.pa : 0,
      pf: index === 0 ? args.pf : 0,
      season,
      teamId: args.teamId,
      teamName: args.teamName,
      wins: index === 0 ? args.wins : 0,
    }),
  );
}
