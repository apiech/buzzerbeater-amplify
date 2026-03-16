import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  assertSupportedBedrockRecapModel,
  processGameDayRecap,
  submitGameDayRecap,
} from "../amplify/data/_backend/game-day-recap";
import { requireFeatureAccess } from "../amplify/data/_backend/billing";
import type {
  BBApiBoxScore,
  BBApiSchedule,
  BBApiSeasons,
  BBApiStandings,
} from "../lib/bbapi/types";

function createSchedule(teamId: string, matches: BBApiSchedule["matches"]): BBApiSchedule {
  return {
    matches,
    retrievedAt: "2026-03-15T00:00:00Z",
    season: 64,
    teamId,
    version: "1",
  };
}

function createStandingTeam(args: {
  id: string;
  losses: number;
  teamName: string;
  wins: number;
}) {
  return {
    fields: {},
    forfeits: 0,
    id: args.id,
    isBot: false,
    losses: args.losses,
    pa: 400,
    pf: 420,
    teamName: args.teamName,
    wins: args.wins,
  };
}

function createStandings(): BBApiStandings {
  return {
    brackets: [],
    conferences: [
      {
        index: 0,
        teams: [
          createStandingTeam({ id: "A", losses: 4, teamName: "Alpha", wins: 12 }),
          createStandingTeam({ id: "B", losses: 5, teamName: "Beta", wins: 11 }),
        ],
      },
      {
        index: 1,
        teams: [
          createStandingTeam({ id: "C", losses: 6, teamName: "Gamma", wins: 10 }),
          createStandingTeam({ id: "D", losses: 7, teamName: "Delta", wins: 9 }),
        ],
      },
    ],
    country: null,
    league: {
      id: "100",
      name: "Elite League",
    },
    retrievedAt: "2026-03-15T00:00:00Z",
    season: 64,
    version: "1",
  };
}

function createBoxScore(args: {
  awayScore: number;
  awayTeamId: string;
  awayTeamName: string;
  effortDelta?: number | null;
  homeScore: number;
  homeTeamId: string;
  homeTeamName: string;
  matchId: string;
}): BBApiBoxScore {
  return {
    attendance: {},
    awayTeam: {
      defStrategy: "23 Zone",
      details: {},
      efficiency: { efg: 54.1 },
      gdp: { focus: "Balanced.hit", pace: "Normal.hit" },
      id: args.awayTeamId,
      offStrategy: "Motion",
      partialScores: [20, 18, 22, 24],
      players: [
        {
          details: {},
          firstName: "Ari",
          fullName: "Ari Away",
          id: "p-away",
          lastName: "Away",
          minutesByPosition: { C: 0, PF: 0, PG: 30, SF: 0, SG: 8 },
          performance: {
            ast: 7,
            blk: 0,
            pts: 24,
            reb: 6,
            stl: 2,
            to: 3,
          },
        },
      ],
      ratings: { outsideScoring: 12.2 },
      score: args.awayScore,
      shortName: null,
      teamName: args.awayTeamName,
      teamTotals: { pts: args.awayScore },
    },
    details: {},
    effortDelta: args.effortDelta ?? 0,
    endTime: "2026-03-15T21:00:00Z",
    homeTeam: {
      defStrategy: "Man To Man",
      details: {},
      efficiency: { efg: 50.8 },
      gdp: { focus: "Inside.hit", pace: "Fast.hit" },
      id: args.homeTeamId,
      offStrategy: "Push The Ball",
      partialScores: [18, 24, 20, 26],
      players: [
        {
          details: {},
          firstName: "Hal",
          fullName: "Hal Home",
          id: "p-home",
          lastName: "Home",
          minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 30, SG: 10 },
          performance: {
            ast: 5,
            blk: 1,
            pts: 21,
            reb: 9,
            stl: 1,
            to: 1,
          },
        },
      ],
      ratings: { outsideScoring: 11.4 },
      score: args.homeScore,
      shortName: null,
      teamName: args.homeTeamName,
      teamTotals: { pts: args.homeScore },
    },
    matchId: args.matchId,
    neutral: false,
    retrievedAt: "2026-03-15T21:02:00Z",
    startTime: "2026-03-15T19:00:00Z",
    type: "League",
    version: "1",
  };
}

function createExpectedPromptGame(matchId: string) {
  return {
    effortDelta: 0,
    evidenceSignals: [],
    finalMargin: 4,
    matchId,
    neutral: false,
    quarterScores: {
      away: [20, 18, 22, 24],
      home: [18, 24, 20, 26],
    },
    standingsContext: [],
    teams: {
      away: {
        conferenceIndex: 2,
        conferencePosition: 1,
        currentStreak: "W2",
        defStrategy: "23 Zone",
        efficiency: {},
        gdp: {},
        lastFive: "4-1",
        name: "Away",
        offStrategy: "Motion",
        ratingSnapshot: {},
        recentAverageMargin: 5,
        recentSignalFlags: [],
        record: "10-5",
        score: 81,
        topPlayers: [],
      },
      home: {
        conferenceIndex: 1,
        conferencePosition: 1,
        currentStreak: "W3",
        defStrategy: "Man To Man",
        efficiency: {},
        gdp: {},
        lastFive: "5-0",
        name: "Home",
        offStrategy: "Push",
        ratingSnapshot: {},
        recentAverageMargin: 7,
        recentSignalFlags: [],
        record: "12-3",
        score: 85,
        topPlayers: [],
      },
    },
    type: "League",
  };
}

test("resolveSeasonForDate picks the season whose date range covers the slate", () => {
  const seasons: BBApiSeasons = {
    seasons: [
      { finish: "2026-02-01", id: 63, start: "2025-10-01" },
      { finish: "2026-05-01", id: 64, start: "2026-02-02" },
    ],
    version: "1",
  };

  assert.equal(__testing.resolveSeasonForDate(seasons, "2026-03-15"), 64);
});

test("resolveLeagueDaySlate deduplicates games and excludes non-league opponents", async () => {
  const standings = createStandings();
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule("A", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
        {
          awayTeam: { id: "X", score: 75, teamName: "Cup Opponent" },
          homeTeam: { id: "A", score: 88, teamName: "Alpha" },
          id: "cup-1",
          startTime: "2026-03-15T13:00:00Z",
          type: "Cup",
        },
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "C",
      createSchedule("C", [
        {
          awayTeam: { id: "D", score: 77, teamName: "Delta" },
          homeTeam: { id: "C", score: 90, teamName: "Gamma" },
          id: "m-2",
          startTime: "2026-03-15T21:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "D",
      createSchedule("D", [
        {
          awayTeam: { id: "D", score: 77, teamName: "Delta" },
          homeTeam: { id: "C", score: 90, teamName: "Gamma" },
          id: "m-2",
          startTime: "2026-03-15T21:00:00Z",
          type: "League",
        },
      ]),
    ],
  ]);

  const slate = await __testing.resolveLeagueDaySlate({
    bb: {
      getSchedule: async (teamId) => {
        const schedule = schedules.get(teamId ?? "");
        if (!schedule) {
          throw new Error(`Missing schedule for ${teamId}`);
        }
        return schedule;
      },
    },
    gameDate: "2026-03-15",
    standings,
  });

  assert.deepStrictEqual(
    slate.map((game) => game.matchId),
    ["m-1", "m-2"],
  );
});

test("team form helpers compute streaks, last-five form, and top players", () => {
  const standing = __testing.extractStandingTeams(createStandings()).get("A");
  assert.ok(standing);

  const schedule = createSchedule("A", [
    {
      awayTeam: { id: "B", score: 81, teamName: "Beta" },
      homeTeam: { id: "A", score: 85, teamName: "Alpha" },
      id: "a-1",
      startTime: "2026-03-14T19:00:00Z",
      type: "League",
    },
    {
      awayTeam: { id: "A", score: 70, teamName: "Alpha" },
      homeTeam: { id: "C", score: 89, teamName: "Gamma" },
      id: "a-2",
      startTime: "2026-03-10T19:00:00Z",
      type: "League",
    },
    {
      awayTeam: { id: "D", score: 78, teamName: "Delta" },
      homeTeam: { id: "A", score: 82, teamName: "Alpha" },
      id: "a-3",
      startTime: "2026-03-08T19:00:00Z",
      type: "League",
    },
    {
      awayTeam: { id: "A", score: 61, teamName: "Alpha" },
      homeTeam: { id: "B", score: 82, teamName: "Beta" },
      id: "a-4",
      startTime: "2026-03-05T19:00:00Z",
      type: "League",
    },
    {
      awayTeam: { id: "C", score: 66, teamName: "Gamma" },
      homeTeam: { id: "A", score: 79, teamName: "Alpha" },
      id: "a-5",
      startTime: "2026-03-01T19:00:00Z",
      type: "League",
    },
  ]);

  const context = __testing.buildTeamSeasonContext({
    boxScores: [
      createBoxScore({
        awayScore: 61,
        awayTeamId: "A",
        awayTeamName: "Alpha",
        homeScore: 82,
        homeTeamId: "B",
        homeTeamName: "Beta",
        matchId: "a-4",
      }),
      createBoxScore({
        awayScore: 62,
        awayTeamId: "A",
        awayTeamName: "Alpha",
        homeScore: 84,
        homeTeamId: "C",
        homeTeamName: "Gamma",
        matchId: "a-6",
      }),
    ],
    gameStartTime: "2026-03-15T19:00:00Z",
    schedule,
    standing,
  });

  assert.equal(context.currentStreak, "W1");
  assert.equal(context.lastFive, "3-2");
  assert.ok(context.recentSignalFlags.includes("possible_strategic_deemphasis"));

  const topPlayers = __testing.extractTopPlayers(
    createBoxScore({
      awayScore: 81,
      awayTeamId: "B",
      awayTeamName: "Beta",
      homeScore: 85,
      homeTeamId: "A",
      homeTeamName: "Alpha",
      matchId: "m-1",
    }).awayTeam.players,
  );
  assert.equal(topPlayers[0]?.name, "Ari Away");
});

test("submitGameDayRecap is idempotent while a recap is already active", async () => {
  let upserted = false;
  let enqueued = false;

  const result = await submitGameDayRecap(
    {
      env: {},
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      queueUrl: "queue-url",
    },
    {
      enqueueRecapJob: async () => {
        enqueued = true;
      },
      getGameDayRecap: async () => ({
        gameDate: "2026-03-15",
        leagueId: "100",
        requestJson: {},
        requestedAt: "2026-03-15T22:00:00Z",
        status: "QUEUED",
        targetKey: "100#2026-03-15",
        userId: "user-1",
      }),
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => {},
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async () => {
        upserted = true;
      },
    },
  );

  assert.deepStrictEqual(result, { targetKey: "100#2026-03-15" });
  assert.equal(upserted, false);
  assert.equal(enqueued, false);
});

test("submitGameDayRecap reruns terminal jobs in place", async () => {
  let queuedMessage: { requestedAt: string; targetKey: string; userId: string } | null = null;
  let savedStatus = "";

  await submitGameDayRecap(
    {
      env: {},
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      queueUrl: "queue-url",
    },
    {
      enqueueRecapJob: async (_queueUrl, message) => {
        queuedMessage = message;
      },
      getGameDayRecap: async () => ({
        completedAt: "2026-03-15T22:00:00Z",
        gameDate: "2026-03-15",
        leagueId: "100",
        requestJson: {},
        requestedAt: "2026-03-15T21:00:00Z",
        status: "SUCCEEDED",
        targetKey: "100#2026-03-15",
        userId: "user-1",
      }),
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => {},
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async (env, record) => {
        void env;
        savedStatus = record.status;
      },
    },
  );

  assert.equal(savedStatus, "QUEUED");
  assert.equal(queuedMessage?.targetKey, "100#2026-03-15");
});

test("submitGameDayRecap allows access when premium is granted by the environment default", async () => {
  let queuedMessage: { requestedAt: string; targetKey: string; userId: string } | null = null;

  const result = await submitGameDayRecap(
    {
      env: {
        BILLING_DEFAULT_PLAN: "premium",
      },
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      queueUrl: "queue-url",
    },
    {
      enqueueRecapJob: async (_queueUrl, message) => {
        queuedMessage = message;
      },
      getGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: (args) =>
        requireFeatureAccess(args, {
          createPortalSession: async () => ({ url: "https://example.com/portal" }),
          createSubscriptionCheckoutSession: async () => ({
            url: "https://example.com/checkout",
          }),
          getBillingAccount: async () => null,
          getStripeSubscription: async () => ({
            id: "sub_123",
          }),
          upsertBillingAccount: async () => {},
        }),
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async () => {},
    },
  );

  assert.deepStrictEqual(result, { targetKey: "100#2026-03-15" });
  assert.equal(queuedMessage?.targetKey, "100#2026-03-15");
});

test("processGameDayRecap succeeds with partial coverage when one box score is missing", async () => {
  const recapRecord = {
    gameDate: "2026-03-15",
    leagueId: "100",
    requestJson: {
      gameDate: "2026-03-15",
      leagueId: "100",
    },
    requestedAt: "2026-03-15T23:00:00Z",
    status: "QUEUED" as const,
    targetKey: "100#2026-03-15",
    userId: "user-1",
  };
  const standings = createStandings();
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule("A", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
        {
          awayTeam: { id: "A", score: 79, teamName: "Alpha" },
          homeTeam: { id: "C", score: 72, teamName: "Gamma" },
          id: "prev-a",
          startTime: "2026-03-10T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "C",
      createSchedule("C", [
        {
          awayTeam: { id: "D", score: 68, teamName: "Delta" },
          homeTeam: { id: "C", score: 77, teamName: "Gamma" },
          id: "m-2",
          startTime: "2026-03-15T21:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "D",
      createSchedule("D", [
        {
          awayTeam: { id: "D", score: 68, teamName: "Delta" },
          homeTeam: { id: "C", score: 77, teamName: "Gamma" },
          id: "m-2",
          startTime: "2026-03-15T21:00:00Z",
          type: "League",
        },
      ]),
    ],
  ]);
  const boxScores = new Map<string, BBApiBoxScore | null>([
    [
      "m-1",
      createBoxScore({
        awayScore: 81,
        awayTeamId: "B",
        awayTeamName: "Beta",
        effortDelta: 2,
        homeScore: 85,
        homeTeamId: "A",
        homeTeamName: "Alpha",
        matchId: "m-1",
      }),
    ],
    [
      "prev-a",
      createBoxScore({
        awayScore: 79,
        awayTeamId: "A",
        awayTeamName: "Alpha",
        homeScore: 72,
        homeTeamId: "C",
        homeTeamName: "Gamma",
        matchId: "prev-a",
      }),
    ],
    ["m-2", null],
  ]);
  const updates: Array<Record<string, unknown>> = [];

  await processGameDayRecap(
    {
      env: {},
      messageBody: JSON.stringify({
        requestedAt: recapRecord.requestedAt,
        targetKey: recapRecord.targetKey,
        userId: recapRecord.userId,
      }),
      modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      region: "us-east-1",
    },
    {
      createBbClient: () => ({
        getBoxScore: async (matchId) => {
          const boxScore = boxScores.get(matchId ?? "");
          if (boxScore === undefined) {
            throw new Error(`Missing box score for ${matchId}`);
          }
          if (boxScore === null) {
            throw new Error(`Box score unavailable for ${matchId}`);
          }
          return boxScore;
        },
        getSchedule: async (teamId) => {
          const schedule = schedules.get(teamId ?? "");
          if (!schedule) {
            throw new Error(`Missing schedule for ${teamId}`);
          }
          return schedule;
        },
        getSeasons: async () => ({
          seasons: [{ finish: "2026-05-01", id: 64, start: "2026-02-02" }],
          version: "1",
        }),
        getStandings: async () => standings,
        getTeamInfo: async () => ({
          country: null,
          fields: {},
          isBot: false,
          league: { id: "100", name: "Elite League" },
          ownerName: "Owner",
          retrievedAt: "2026-03-15T00:00:00Z",
          rival: null,
          shortName: "ALP",
          teamId: "A",
          teamName: "Alpha",
          version: "1",
        }),
      }),
      createProvider: () => ({
        generate: async (payload) => ({
          games: payload.games.map((game) => ({
            evidenceTags: ["recent_form"],
            headline: `Recap for ${game.matchId}`,
            matchId: game.matchId,
            writeup: `${game.teams.home.name} handled ${game.teams.away.name} with a balanced night and enough late execution to close it out cleanly.`,
          })),
          summary: {
            headline: "Elite League roundup",
            lede: "One final box score was enough to produce a partial slate recap while the remaining game stayed unavailable.",
          },
        }),
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-15T23:10:00Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  const finalUpdate = updates.at(-1);
  assert.ok(finalUpdate);
  assert.equal(finalUpdate.status, "SUCCEEDED");
  assert.deepStrictEqual(finalUpdate.coverageJson, {
    availableGames: 1,
    missingGames: [
      {
        awayTeamName: "Delta",
        homeTeamName: "Gamma",
        matchId: "m-2",
        reason: "final box score was unavailable",
      },
    ],
    partial: true,
    requestedGames: 2,
  });
});

test("buildGameDayRecapBedrockRequest attaches a structured output schema", () => {
  const request = __testing.buildGameDayRecapBedrockRequest({
    modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    payload: {
      coverage: {
        availableGames: 1,
        missingGames: [],
        partial: false,
        requestedGames: 1,
      },
      games: [createExpectedPromptGame("m-1")],
      league: {
        gameDate: "2026-03-15",
        leagueId: "100",
        leagueName: "Elite League",
        season: 64,
      },
    },
  });

  assert.equal(request.outputConfig?.textFormat?.type, "json_schema");
  assert.match(
    request.outputConfig?.textFormat?.structure?.jsonSchema?.schema ?? "",
    /"summary"/,
  );
  assert.match(
    request.outputConfig?.textFormat?.structure?.jsonSchema?.schema ?? "",
    /"games"/,
  );
});

test("assertSupportedBedrockRecapModel fails fast for unsupported configuration", () => {
  assert.throws(
    () =>
      assertSupportedBedrockRecapModel(
        "anthropic.claude-v2:1",
        "us-east-1",
      ),
    /verified structured-output allowlist/i,
  );

  assert.throws(
    () =>
      assertSupportedBedrockRecapModel(
        "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "us-gov-west-1",
      ),
    /supported commercial Bedrock region/i,
  );
});

test("validateGameDayRecapResult accepts valid structured output for the expected slate", () => {
  const result = __testing.validateGameDayRecapResult(
    {
      games: [
        {
          evidenceTags: ["recent_form", "top_performance"],
          headline: "Alpha grinds out the opener",
          matchId: "m-1",
          writeup:
            "Alpha kept control in the fourth quarter, leaned on a strong two-way effort from its lead scorer, and finished the job without letting the margin fully disappear.",
        },
        {
          evidenceTags: ["blowout"],
          headline: "Gamma buries Delta early",
          matchId: "m-2",
          writeup:
            "Gamma built separation before halftime, carried that advantage through the second half, and never let Delta create real pressure once the margin stretched into double digits.",
        },
      ],
      summary: {
        headline: "Elite League delivers a split slate",
        lede:
          "One game stayed competitive until the last few possessions while the other tilted sharply before the break and never really swung back.",
      },
    },
    [createExpectedPromptGame("m-1"), createExpectedPromptGame("m-2")],
  );

  assert.equal(result.games.length, 2);
  assert.equal(result.games[0]?.matchId, "m-1");
  assert.equal(result.summary.headline, "Elite League delivers a split slate");
});
