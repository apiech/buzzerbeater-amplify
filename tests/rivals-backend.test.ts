import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  getRivalsWorkspace,
  processRivalsBackfill,
  submitRivalsBackfill,
  syncRivalryMatchFactsFromSchedule,
} from "../amplify/data/_backend/rivals";

test("classifyScheduleMatchType maps league TV games to regular season", () => {
  const result = __testing.classifyScheduleMatchType("LEAGUE.RS.TV");

  assert.equal(result.competitionKey, "LEAGUE_REGULAR_SEASON");
  assert.equal(result.competitionLabel, "League regular season");
  assert.equal(result.isTvGame, true);
  assert.equal(result.stageLabel, "Regular season");
});

test("classifyScheduleMatchType maps league semifinal to playoffs", () => {
  const result = __testing.classifyScheduleMatchType("LEAGUE.SEMIFINAL");

  assert.equal(result.competitionKey, "PLAYOFFS");
  assert.equal(result.competitionLabel, "Playoffs");
  assert.equal(result.isTvGame, false);
  assert.equal(result.stageLabel, "Semifinal");
});

test("classifyScheduleMatchType maps cup round labels", () => {
  const result = __testing.classifyScheduleMatchType("CUP.ROUND4");

  assert.equal(result.competitionKey, "CUP");
  assert.equal(result.stageLabel, "Round 4");
});

test("classifyScheduleMatchType keeps the expected labels for non-league competition families", () => {
  const cases = [
    {
      expectedKey: "SCRIMMAGE",
      expectedLabel: "Scrimmage",
      rawType: "SCRIMMAGE",
    },
    {
      expectedKey: "PRIVATE_LEAGUE",
      expectedLabel: "Private league",
      rawType: "PRIVATELEAGUE.FINAL",
    },
    {
      expectedKey: "BUZZERBEATER_BEST",
      expectedLabel: "BuzzerBeater's Best",
      rawType: "BBB.ROUND4",
    },
    {
      expectedKey: "BUZZERBEATER_MADNESS",
      expectedLabel: "BuzzerBeater Madness",
      rawType: "BBM.ROUND4",
    },
    {
      expectedKey: "OTHER",
      expectedLabel: "Other",
      rawType: "FRIENDLY",
    },
  ] as const;

  for (const { expectedKey, expectedLabel, rawType } of cases) {
    const result = __testing.classifyScheduleMatchType(rawType);

    assert.equal(result.competitionKey, expectedKey);
    assert.equal(result.competitionLabel, expectedLabel);
  }
});

test("normalizeSeasonBound rejects missing values and clamps out-of-range filters", () => {
  assert.equal(__testing.normalizeSeasonBound(undefined, [69, 70, 71]), null);
  assert.equal(__testing.normalizeSeasonBound(null, [69, 70, 71]), null);
  assert.equal(__testing.normalizeSeasonBound(70, [69, 70, 71]), 70);
  assert.equal(__testing.normalizeSeasonBound(68, [69, 70, 71]), 69);
  assert.equal(__testing.normalizeSeasonBound(72, [69, 70, 71]), 71);
});

test("handler filter compaction drops null GraphQL entries without changing omitted filters", () => {
  assert.deepStrictEqual(
    __testing.compactNullableStringArray(["CUP", null, "PLAYOFFS"]),
    ["CUP", "PLAYOFFS"],
  );
  assert.deepStrictEqual(__testing.compactNullableStringArray([null]), []);
  assert.equal(__testing.compactNullableStringArray(undefined), undefined);
});

test("buildRivalryMatch shapes a completed head-to-head result", () => {
  const match = __testing.buildRivalryMatch({
    match: createScheduleMatch({
      awayTeam: {
        id: "2",
        score: 88,
        teamName: "Road Testers",
      },
      homeTeam: {
        id: "1",
        score: 96,
        teamName: "Home Club",
      },
      id: "match-1",
      startTime: "2026-03-01T19:00:00Z",
      type: "LEAGUE.RS.TV",
    }),
    season: 61,
    teamId: "1",
  });

  assert.ok(match);
  assert.equal(match.matchId, "match-1");
  assert.equal(match.competitionKey, "LEAGUE_REGULAR_SEASON");
  assert.equal(match.gameDate, "2026-03-01");
  assert.equal(match.isHome, true);
  assert.equal(match.isTvGame, true);
  assert.equal(match.margin, 8);
  assert.equal(match.opponentTeamId, "2");
  assert.equal(match.opponentTeamName, "Road Testers");
  assert.equal(match.outcome, "WIN");
  assert.equal(match.season, 61);
  assert.equal(match.teamScore, 96);
  assert.equal(match.opponentScore, 88);
  assert.equal(match.venue, "HOME");
});

test("buildRivalryMatch skips completed games that do not include the active team", () => {
  const outsiderMatch = createScheduleMatch({
    awayTeam: {
      id: "2",
      score: 101,
      teamName: "Great 8",
    },
    homeTeam: {
      id: "1",
      score: 99,
      teamName: "Team 1",
    },
    id: "all-star-like",
    startTime: "2026-03-02T19:00:00Z",
    type: "league.allstar",
  });

  const match = __testing.buildRivalryMatch({
    match: outsiderMatch,
    season: 61,
    teamId: "999",
  });

  assert.equal(__testing.matchIncludesTeam(outsiderMatch, "999"), false);
  assert.equal(match, null);
});

test("compressed rivals cache round-trips without changing the workspace payload", () => {
  const matches = [createRivalryMatchRecord({ matchId: "m-1" })];

  const encoded = __testing.encodeCachedRivalryMatches(matches);
  const decoded = __testing.decodeCachedRivalryMatches(encoded);

  assert.deepStrictEqual(decoded, matches);
});

test("getRivalsWorkspace serves rivalry facts, applies filters server-side, and keeps summary cards whole-dataset", async () => {
  const result = await getRivalsWorkspace(
    {
      competitionKeys: ["CUP", "PLAYOFFS"],
      endSeason: 71,
      env: {},
      identity: { sub: "user-1" },
      outcomes: ["WIN"],
      startSeason: 71,
      tvScopes: ["NON_TV"],
      venues: ["ROAD"],
    },
    {
      assertMaintenanceInactive: async () => {},
      getBbConnection: async () => ({
        bbLoginName: "coach",
        lastSyncAt: "2026-04-11T15:02:00Z",
        shortName: "ALP",
        status: "CONNECTED",
        teamId: "10",
        teamName: "Alpha",
        userId: "user-1",
      }),
      getRivalsBackfill: async () => ({
        failedSeasons: [69],
        generatedAt: "2026-04-11T15:04:00Z",
        requestedAt: "2026-04-11T15:00:00Z",
        seasonsScanned: 3,
        status: "SUCCEEDED",
        teamId: "10",
        teamName: "Alpha",
        totalCompletedGames: 3,
        totalOpponents: 2,
        updatedAt: "2026-04-11T15:05:00Z",
        userId: "user-1",
      }),
      getRivalsWorkspaceCache: async () => null,
      listRivalryMatchFactsByUserAndTeamId: async () => [
        createFactRecord({
          competitionKey: "LEAGUE_REGULAR_SEASON",
          competitionLabel: "League regular season",
          gameDate: "2026-03-01",
          isTvGame: false,
          margin: 5,
          matchId: "m-1",
          opponentScore: 85,
          opponentTeamId: "opp-1",
          opponentTeamName: "Beta",
          outcome: "WIN",
          season: 70,
          startTime: "2026-03-01T19:00:00Z",
          teamScore: 90,
          venue: "ROAD",
        }),
        createFactRecord({
          competitionKey: "PLAYOFFS",
          competitionLabel: "Playoffs",
          gameDate: "2026-04-01",
          isTvGame: true,
          margin: -6,
          matchId: "m-2",
          opponentScore: 93,
          opponentTeamId: "opp-1",
          opponentTeamName: "Beta",
          outcome: "LOSS",
          season: 71,
          stageKey: "semifinal",
          stageLabel: "Semifinal",
          startTime: "2026-04-01T19:00:00Z",
          teamScore: 87,
          venue: "HOME",
        }),
        createFactRecord({
          competitionKey: "CUP",
          competitionLabel: "Cup",
          gameDate: "2026-04-04",
          isTvGame: false,
          margin: 4,
          matchId: "m-3",
          opponentScore: 81,
          opponentTeamId: "opp-2",
          opponentTeamName: "Gamma",
          outcome: "WIN",
          season: 71,
          stageKey: "round4",
          stageLabel: "Round 4",
          startTime: "2026-04-04T19:00:00Z",
          teamScore: 85,
          venue: "ROAD",
        }),
      ],
      now: () => new Date("2026-04-11T15:06:00Z"),
    },
  );

  assert.equal(result.summary.totalCompletedGames, 3);
  assert.equal(result.summary.totalOpponents, 2);
  assert.equal(result.summary.seasonsScanned, 3);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.opponentTeamId, "opp-2");
  assert.equal(result.selectedOpponentId, "opp-2");
  assert.ok(result.selectedRivalry);
  assert.equal(result.selectedRivalry.matches[0]?.matchId, "m-3");
  assert.equal(result.selectedRivalry.competitionBreakdown[0].competitionKey, "CUP");
  assert.equal(result.selectedRivalry.seasonBreakdown[0].season, 71);
  assert.equal(result.warning, "Live history is partial. The schedule scan failed for season 69.");
  assert.equal(result.team.teamId, "10");
  assert.equal(result.syncedAt, "2026-04-11T15:02:00Z");
});

test("getRivalsWorkspace falls back to legacy cache when no rivalry facts exist yet", async () => {
  const cachedMatches = [createRivalryMatchRecord({ matchId: "m-1" })];

  const result = await getRivalsWorkspace(
    {
      env: {},
      identity: { sub: "user-1" },
    },
    {
      assertMaintenanceInactive: async () => {},
      getBbConnection: async () => ({
        bbLoginName: "coach",
        status: "CONNECTED",
        teamId: "10",
        teamName: "Alpha",
        userId: "user-1",
      }),
      getRivalsBackfill: async () => ({
        requestedAt: "2026-04-11T15:00:00Z",
        status: "SUCCEEDED",
        teamId: "10",
        teamName: "Alpha",
        updatedAt: "2026-04-11T15:05:00Z",
        userId: "user-1",
      }),
      getRivalsWorkspaceCache: async () => ({
        generatedAt: "2026-04-11T15:04:00Z",
        matchesJson: __testing.encodeCachedRivalryMatches(cachedMatches),
        shortName: "ALP",
        summaryJson: {
          failedSeasonCount: 0,
          failedSeasons: [],
          firstSeason: 71,
          lastSeason: 71,
          losses: 0,
          seasonsScanned: 1,
          seasonsWithGames: 1,
          totalCompletedGames: 1,
          totalOpponents: 1,
          tvGames: 0,
          wins: 1,
        },
        syncedAt: "2026-04-11T15:02:00Z",
        teamId: "10",
        teamName: "Alpha",
        userId: "user-1",
        warning: null,
      }),
      listRivalryMatchFactsByUserAndTeamId: async () => [],
      now: () => new Date("2026-04-11T15:06:00Z"),
    },
  );

  assert.equal(result.summary.totalCompletedGames, 1);
  assert.equal(result.rows[0]?.opponentTeamName, "Beta");
  assert.equal(result.selectedRivalry?.matches[0]?.matchId, "m-1");
  assert.equal(result.status?.status, "SUCCEEDED");
  assert.equal(result.team.teamId, "10");
});

test("submitRivalsBackfill reuses an active backfill instead of starting a duplicate", async () => {
  let started = false;

  const result = await submitRivalsBackfill(
    {
      env: {},
      identity: { sub: "user-1" },
      stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:rivals",
    },
    {
      assertMaintenanceInactive: async () => {},
      getBbConnection: async () => ({
        bbLoginName: "coach",
        status: "CONNECTED",
        teamId: "10",
        teamName: "Alpha",
        userId: "user-1",
      }),
      getRivalsBackfill: async () => ({
        requestedAt: "2026-04-11T15:00:00Z",
        status: "FETCHING_SCHEDULES",
        teamId: "10",
        teamName: "Alpha",
        updatedAt: "2026-04-11T15:01:00Z",
        userId: "user-1",
      }),
      now: () => new Date("2026-04-11T15:02:00Z"),
      startWorkflowExecution: async () => {
        started = true;
        return "unexpected";
      },
      upsertRivalsBackfill: async () => {},
    },
  );

  assert.equal(result.queued, false);
  assert.equal(result.status, "FETCHING_SCHEDULES");
  assert.equal(started, false);
});

test("submitRivalsBackfill queues a fresh backfill with typed failed season arrays", async () => {
  const upsertedStatuses: Array<Record<string, unknown>> = [];

  const result = await submitRivalsBackfill(
    {
      env: {},
      identity: { sub: "user-1" },
      stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:rivals",
    },
    {
      assertMaintenanceInactive: async () => {},
      getBbConnection: async () => ({
        bbLoginName: "coach",
        status: "CONNECTED",
        teamId: "10",
        teamName: "Alpha",
        userId: "user-1",
      }),
      getRivalsBackfill: async () => null,
      now: (() => {
        let offset = 0;
        return () =>
          new Date(Date.parse("2026-04-11T15:02:00Z") + offset++ * 1000);
      })(),
      startWorkflowExecution: async () => "arn:aws:states:...:execution:rivals",
      upsertRivalsBackfill: async (_env, input) => {
        upsertedStatuses.push(input as Record<string, unknown>);
      },
    },
  );

  assert.equal(result.queued, true);
  assert.equal(result.status, "QUEUED");
  assert.deepStrictEqual(upsertedStatuses[0]?.failedSeasons, []);
  assert.deepStrictEqual(upsertedStatuses[1]?.failedSeasons, []);
  assert.equal(upsertedStatuses[1].executionArn, "arn:aws:states:...:execution:rivals");
});

test("processRivalsBackfill upserts one fact per completed game, removes stale facts, and stores terminal success", async () => {
  const upsertedStatuses: Array<Record<string, unknown>> = [];
  const upsertedFacts: Array<Record<string, unknown>> = [];
  const deletedFacts: Array<Record<string, unknown>> = [];

  await processRivalsBackfill(
    {
      env: {},
      message: {
        requestedAt: "2026-04-11T15:00:00Z",
        teamId: "10",
        userId: "user-1",
      },
    },
    {
      assertMaintenanceInactive: async () => {},
      createBbClient: () => ({
        getSchedule: async (_teamId, season) => ({
          matches:
            season === 71
              ? [
                  createScheduleMatch({
                    awayTeam: {
                      id: "20",
                      score: 82,
                      teamName: "Beta",
                    },
                    homeTeam: {
                      id: "10",
                      score: 90,
                      teamName: "Alpha",
                    },
                    id: "m-1",
                    startTime: "2026-04-01T19:00:00Z",
                    type: "LEAGUE.RS",
                  }),
                  createScheduleMatch({
                    awayTeam: {
                      id: "20",
                      score: 82,
                      teamName: "Beta",
                    },
                    homeTeam: {
                      id: "10",
                      score: 90,
                      teamName: "Alpha",
                    },
                    id: "m-1",
                    startTime: "2026-04-01T19:00:00Z",
                    type: "LEAGUE.RS",
                  }),
                  createScheduleMatch({
                    awayTeam: {
                      id: "30",
                      score: 87,
                      teamName: "Gamma",
                    },
                    homeTeam: {
                      id: "10",
                      score: 91,
                      teamName: "Alpha",
                    },
                    id: "m-2",
                    startTime: "2026-04-05T19:00:00Z",
                    type: "CUP.ROUND4",
                  }),
                ]
              : [],
        }),
        getSeasons: async () => ({
          seasons: [{ id: 71 }],
        }),
        login: async () => {},
      }),
      deleteRivalryMatchFact: async (_env, input) => {
        deletedFacts.push({ ...input });
      },
      getBbConnection: async () => ({
        bbLoginName: "coach",
        lastSyncAt: "2026-04-11T14:55:00Z",
        shortName: "ALP",
        status: "CONNECTED",
        teamId: "10",
        teamName: "Alpha",
        userId: "user-1",
      }),
      getRivalsBackfill: async () => ({
        executionArn: "arn:aws:states:...:execution:rivals",
        requestedAt: "2026-04-11T15:00:00Z",
        status: "QUEUED",
        teamId: "10",
        teamName: "Alpha",
        updatedAt: "2026-04-11T15:00:00Z",
        userId: "user-1",
      }),
      listRivalryMatchFactsByUserAndTeamId: async () => [
        createFactRecord({
          matchId: "m-stale",
          opponentTeamId: "old-opp",
          opponentTeamName: "Old Opponent",
          startTime: "2026-03-01T19:00:00Z",
        }),
      ],
      now: (() => {
        let offset = 0;
        return () =>
          new Date(Date.parse("2026-04-11T15:00:00Z") + offset++ * 1000);
      })(),
      resolveBbAccessKey: async () => "secret",
      upsertRivalryMatchFact: async (_env, input) => {
        upsertedFacts.push({ ...input });
      },
      upsertRivalsBackfill: async (_env, input) => {
        upsertedStatuses.push(input as Record<string, unknown>);
      },
    },
  );

  assert.deepStrictEqual(
    upsertedFacts.map((fact) => fact.matchId).sort(),
    ["m-1", "m-2"],
  );
  assert.deepStrictEqual(deletedFacts, [
    {
      matchId: "m-stale",
      teamId: "10",
      userId: "user-1",
    },
  ]);
  assert.equal(upsertedStatuses.at(-1)?.status, "SUCCEEDED");
  assert.equal(upsertedStatuses.at(-1)?.totalCompletedGames, 2);
  assert.equal(upsertedStatuses.at(-1)?.totalOpponents, 2);
  assert.equal(upsertedStatuses.at(-1)?.seasonsScanned, 1);
  assert.deepStrictEqual(upsertedStatuses.at(-1)?.failedSeasons, []);
  assert.deepStrictEqual(
    upsertedStatuses.map((status) => status.failedSeasons),
    [[], [], [], []],
  );
});

test("processRivalsBackfill preserves prior failed seasons when the worker fails", async () => {
  const upsertedStatuses: Array<Record<string, unknown>> = [];

  await assert.rejects(
    processRivalsBackfill(
      {
        env: {},
        message: {
          requestedAt: "2026-04-11T15:00:00Z",
          teamId: "10",
          userId: "user-1",
        },
      },
      {
        assertMaintenanceInactive: async () => {},
        createBbClient: () => ({
          getSeasons: async () => {
            throw new Error("season fetch failed");
          },
          login: async () => {},
        }),
        getBbConnection: async () => ({
          bbLoginName: "coach",
          status: "CONNECTED",
          teamId: "10",
          teamName: "Alpha",
          userId: "user-1",
        }),
        getRivalsBackfill: async () => ({
          executionArn: "arn:aws:states:...:execution:rivals",
          failedSeasons: [69],
          requestedAt: "2026-04-11T15:00:00Z",
          startedAt: "2026-04-11T15:00:00Z",
          status: "QUEUED",
          teamId: "10",
          teamName: "Alpha",
          updatedAt: "2026-04-11T15:00:00Z",
          userId: "user-1",
        }),
        now: (() => {
          let offset = 0;
          return () =>
            new Date(Date.parse("2026-04-11T15:00:00Z") + offset++ * 1000);
        })(),
        resolveBbAccessKey: async () => "secret",
        upsertRivalsBackfill: async (_env, input) => {
          upsertedStatuses.push(input as Record<string, unknown>);
        },
      },
    ),
    /season fetch failed/,
  );

  assert.deepStrictEqual(upsertedStatuses[0]?.failedSeasons, [69]);
  assert.deepStrictEqual(upsertedStatuses.at(-1)?.failedSeasons, [69]);
  assert.equal(upsertedStatuses.at(-1)?.status, "FAILED");
});

test("syncRivalryMatchFactsFromSchedule only upserts completed matches for the active team", async () => {
  const upsertedFacts: Array<Record<string, unknown>> = [];

  const factCount = await syncRivalryMatchFactsFromSchedule(
    {
      env: {},
      matches: [
        createScheduleMatch({
          awayTeam: {
            id: "20",
            score: 82,
            teamName: "Beta",
          },
          homeTeam: {
            id: "10",
            score: 90,
            teamName: "Alpha",
          },
          id: "m-1",
          startTime: "2026-04-01T19:00:00Z",
          type: "LEAGUE.RS",
        }),
        createScheduleMatch({
          awayTeam: {
            id: "20",
            score: null,
            teamName: "Beta",
          },
          homeTeam: {
            id: "10",
            score: null,
            teamName: "Alpha",
          },
          id: "future",
          startTime: "2026-04-12T19:00:00Z",
          type: "LEAGUE.RS",
        }),
        createScheduleMatch({
          awayTeam: {
            id: "30",
            score: 88,
            teamName: "Gamma",
          },
          homeTeam: {
            id: "40",
            score: 95,
            teamName: "Delta",
          },
          id: "other-team",
          startTime: "2026-04-03T19:00:00Z",
          type: "LEAGUE.RS",
        }),
      ],
      season: 71,
      teamId: "10",
      userId: "user-1",
    },
    {
      upsertRivalryMatchFact: async (_env, input) => {
        upsertedFacts.push({ ...input });
      },
    },
  );

  assert.equal(factCount, 1);
  assert.deepStrictEqual(
    upsertedFacts.map((fact) => fact.matchId),
    ["m-1"],
  );
});

test("syncRivalryMatchFactsFromSchedule no-ops when season is missing", async () => {
  let upserted = false;

  const factCount = await syncRivalryMatchFactsFromSchedule(
    {
      env: {},
      matches: [
        createScheduleMatch({
          awayTeam: {
            id: "20",
            score: 82,
            teamName: "Beta",
          },
          homeTeam: {
            id: "10",
            score: 90,
            teamName: "Alpha",
          },
          id: "m-1",
          startTime: "2026-04-01T19:00:00Z",
          type: "LEAGUE.RS",
        }),
      ],
      season: undefined,
      teamId: "10",
      userId: "user-1",
    },
    {
      upsertRivalryMatchFact: async () => {
        upserted = true;
      },
    },
  );

  assert.equal(factCount, 0);
  assert.equal(upserted, false);
});

function createRivalryMatchRecord(
  overrides: Partial<ReturnType<typeof createFactRecord>> = {},
) {
  return {
    competitionKey: "LEAGUE_REGULAR_SEASON",
    competitionLabel: "League regular season",
    gameDate: "2026-04-01",
    isHome: true,
    isTvGame: false,
    margin: 7,
    matchId: "m-1",
    opponentScore: 88,
    opponentTeamId: "77",
    opponentTeamName: "Beta",
    outcome: "WIN",
    rawType: "league.rs",
    season: 71,
    stageKey: "regular_season",
    stageLabel: "Regular season",
    startTime: "2026-04-01T19:00:00Z",
    teamScore: 95,
    venue: "HOME",
    ...overrides,
  };
}

function createFactRecord(
  overrides: Partial<{
    competitionKey: string;
    competitionLabel: string;
    gameDate: string | null;
    isHome: boolean;
    isTvGame: boolean;
    margin: number;
    matchId: string;
    opponentScore: number;
    opponentTeamId: string;
    opponentTeamName: string;
    outcome: "WIN" | "LOSS";
    rawType: string | null;
    season: number;
    stageKey: string | null;
    stageLabel: string | null;
    startTime: string;
    teamId: string;
    teamScore: number;
    userId: string;
    venue: "HOME" | "ROAD";
  }> = {},
) {
  return {
    competitionKey: "LEAGUE_REGULAR_SEASON",
    competitionLabel: "League regular season",
    gameDate: "2026-04-01",
    isHome: true,
    isTvGame: false,
    margin: 7,
    matchId: "m-1",
    opponentScore: 88,
    opponentTeamId: "77",
    opponentTeamName: "Beta",
    outcome: "WIN" as const,
    rawType: "league.rs",
    season: 71,
    stageKey: "regular_season",
    stageLabel: "Regular season",
    startTime: "2026-04-01T19:00:00Z",
    teamId: "10",
    teamScore: 95,
    userId: "user-1",
    venue: "HOME" as const,
    ...overrides,
  };
}

function createScheduleMatch(
  overrides: Partial<{
    awayTeam: {
      id: string | null;
      score: number | null;
      teamName: string | null;
    };
    homeTeam: {
      id: string | null;
      score: number | null;
      teamName: string | null;
    };
    id: string | null;
    startTime: string | null;
    type: string | null;
  }> = {},
) {
  return {
    awayTeam: {
      id: "20",
      score: 88,
      teamName: "Road Team",
    },
    homeTeam: {
      id: "10",
      score: 96,
      teamName: "Home Club",
    },
    id: "match-1",
    startTime: "2026-03-01T19:00:00Z",
    type: "LEAGUE.RS",
    ...overrides,
  };
}
