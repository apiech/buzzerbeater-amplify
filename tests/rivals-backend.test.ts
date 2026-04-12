import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  getRivalsWorkspace,
  processRivalsBackfill,
  submitRivalsBackfill,
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

test("buildRivalryMatch shapes a completed head-to-head result", () => {
  const match = __testing.buildRivalryMatch({
    match: {
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
    },
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
  const match = __testing.buildRivalryMatch({
    match: {
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
    },
    season: 61,
    teamId: "999",
  });

  assert.equal(
    __testing.matchIncludesTeam(
      {
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
      },
      "999",
    ),
    false,
  );
  assert.equal(match, null);
});

test("getRivalsWorkspace serves cached data without a live schedule scan", async () => {
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
        matchesJson: [
          {
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
            rawType: "LEAGUE.RS",
            season: 71,
            stageKey: "REGULAR_SEASON",
            stageLabel: "Regular season",
            startTime: "2026-04-01T19:00:00Z",
            teamId: "10",
            teamScore: 95,
            venue: "HOME",
          },
        ],
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
      now: () => new Date("2026-04-11T15:06:00Z"),
    },
  );

  assert.equal(result.summary.totalCompletedGames, 1);
  assert.equal(result.matches[0]?.opponentTeamName, "Beta");
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

test("processRivalsBackfill persists a cached rivals dataset and terminal success status", async () => {
  const upsertedStatuses: Array<Record<string, unknown>> = [];
  const upsertedCaches: Array<Record<string, unknown>> = [];

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
                  {
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
                  },
                ]
              : [],
        }),
        getSeasons: async () => ({
          seasons: [{ id: 71 }],
        }),
        login: async () => {},
      }),
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
      now: (() => {
        let offset = 0;
        return () => new Date(Date.parse("2026-04-11T15:00:00Z") + offset++ * 1000);
      })(),
      resolveBbAccessKey: async () => "secret",
      upsertRivalsBackfill: async (_env, input) => {
        upsertedStatuses.push(input as Record<string, unknown>);
      },
      upsertRivalsWorkspaceCache: async (_env, input) => {
        upsertedCaches.push(input as Record<string, unknown>);
      },
    },
  );

  assert.equal(upsertedCaches.length, 1);
  assert.equal(
    (upsertedCaches[0]?.teamName as string | undefined) ?? null,
    "Alpha",
  );
  assert.equal(
    Array.isArray(upsertedCaches[0]?.matchesJson),
    true,
  );
  assert.equal(
    upsertedStatuses.at(-1)?.status,
    "SUCCEEDED",
  );
  assert.equal(
    upsertedStatuses.at(-1)?.totalCompletedGames,
    1,
  );
});
