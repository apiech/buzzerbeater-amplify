import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  assertSupportedBedrockRecapModel,
  processGameDayRecap,
  processLeagueGameDayRecap,
  processSingleGameSummary,
  submitGameDayRecap,
  submitLeagueGameDayRecap,
  submitSingleGameSummary,
} from "../amplify/data/_backend/game-day-recap";
import { requireFeatureAccess } from "../amplify/data/_backend/billing";
import type {
  BBApiBoxScore,
  BBApiSchedule,
  BBApiSeasons,
  BBApiStandings,
} from "../lib/bbapi/types";

function expectPresent<T>(value: T | null | undefined, message: string): T {
  assert.ok(value, message);
  return value;
}

const DEFAULT_RECAP_MODEL_ID =
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const PREMIUM_RECAP_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

function createRecapEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    AWS_REGION: "us-east-1",
    GAME_DAY_RECAP_MODEL_ID: DEFAULT_RECAP_MODEL_ID,
    ...overrides,
  };
}

function createSchedule(
  teamId: string,
  matches: BBApiSchedule["matches"],
  season = 64,
): BBApiSchedule {
  return {
    matches,
    retrievedAt: "2026-03-15T00:00:00Z",
    season,
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

function createStandings(season = 64, leagueId = "100"): BBApiStandings {
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
      id: leagueId,
      name: "Elite League",
    },
    retrievedAt: "2026-03-15T00:00:00Z",
    season,
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

test("resolveSeasonForDate treats the latest season with no finish as open-ended", () => {
  const seasons: BBApiSeasons = {
    seasons: [
      {
        finish: "2026-01-20T14:23:23Z",
        id: 70,
        start: "2025-10-14T10:05:35Z",
      },
      { finish: null, id: 71, start: "2026-01-20T14:23:23Z" },
    ],
    version: "1",
  };

  assert.equal(__testing.resolveSeasonForDate(seasons, "2026-03-10"), 71);
});

test("resolveSeasonForDate still resolves historical dates before the current open season", () => {
  const seasons: BBApiSeasons = {
    seasons: [
      {
        finish: "2026-01-20T14:23:23Z",
        id: 70,
        start: "2025-10-14T10:05:35Z",
      },
      { finish: null, id: 71, start: "2026-01-20T14:23:23Z" },
    ],
    version: "1",
  };

  assert.equal(__testing.resolveSeasonForDate(seasons, "2026-01-10"), 70);
});

test("resolveSeasonForDate uses the next season start as the boundary", () => {
  const seasons: BBApiSeasons = {
    seasons: [
      {
        finish: "2026-01-20T14:23:23Z",
        id: 70,
        start: "2025-10-14T10:05:35Z",
      },
      { finish: null, id: 71, start: "2026-01-20T14:23:23Z" },
    ],
    version: "1",
  };

  assert.equal(__testing.resolveSeasonForDate(seasons, "2026-01-20"), 71);
});

test("summarizeSeasonDiagnostics marks the latest open season as usable", () => {
  const seasons: BBApiSeasons = {
    seasons: [
      {
        finish: "2026-01-20T14:23:23Z",
        id: 70,
        start: "2025-10-14T10:05:35Z",
      },
      { finish: null, id: 71, start: "2026-01-20T14:23:23Z" },
    ],
    version: "1",
  };

  assert.deepStrictEqual(__testing.summarizeSeasonDiagnostics(seasons, "2026-03-15"), [
    {
      finish: "2026-01-20T14:23:23Z",
      finishTimestamp: Date.parse("2026-01-20T00:00:00Z"),
      hasUsableBounds: true,
      id: 70,
      invalidBounds: false,
      matchesGameDate: false,
      normalizedFinish: "2026-01-20",
      normalizedStart: "2025-10-14",
      start: "2025-10-14T10:05:35Z",
      startTimestamp: Date.parse("2025-10-14T00:00:00Z"),
    },
    {
      finish: null,
      finishTimestamp: null,
      hasUsableBounds: true,
      id: 71,
      invalidBounds: false,
      matchesGameDate: true,
      normalizedFinish: null,
      normalizedStart: "2026-01-20",
      start: "2026-01-20T14:23:23Z",
      startTimestamp: Date.parse("2026-01-20T00:00:00Z"),
    },
  ]);
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

test("resolveLeagueDaySlate matches the league local date instead of the UTC date", async () => {
  const standings = {
    ...createStandings(71),
    country: { id: "1", name: "USA" },
  };
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule("A", [
        {
          awayTeam: { id: "B", score: 98, teamName: "Beta" },
          homeTeam: { id: "A", score: 114, teamName: "Alpha" },
          id: "137828772",
          startTime: "2026-03-04T01:00:00Z",
          type: "league.rs",
        },
      ], 71),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 98, teamName: "Beta" },
          homeTeam: { id: "A", score: 114, teamName: "Alpha" },
          id: "137828772",
          startTime: "2026-03-04T01:00:00Z",
          type: "league.rs",
        },
      ], 71),
    ],
    ["C", createSchedule("C", [], 71)],
    ["D", createSchedule("D", [], 71)],
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
    gameDate: "2026-03-03",
    standings,
    timeZone: "America/New_York",
  });

  assert.deepStrictEqual(slate.map((game) => game.matchId), ["137828772"]);
});

test("resolveLeagueGameDaySlate selects the requested regular-season game day", async () => {
  const standings = createStandings(71);
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule("A", [
        {
          awayTeam: { id: "B", score: 80, teamName: "Beta" },
          homeTeam: { id: "A", score: 90, teamName: "Alpha" },
          id: "g1",
          startTime: "2026-02-10T00:00:00Z",
          type: "league.rs",
        },
        {
          awayTeam: { id: "A", score: 88, teamName: "Alpha" },
          homeTeam: { id: "C", score: 92, teamName: "Gamma" },
          id: "g2",
          startTime: "2026-02-17T00:00:00Z",
          type: "League",
        },
        {
          awayTeam: { id: "D", score: 84, teamName: "Delta" },
          homeTeam: { id: "A", score: 102, teamName: "Alpha" },
          id: "g3",
          startTime: "2026-02-24T00:00:00Z",
          type: "league.rs",
        },
        {
          awayTeam: { id: "X", score: 81, teamName: "Cup Opponent" },
          homeTeam: { id: "A", score: 95, teamName: "Alpha" },
          id: "cup-1",
          startTime: "2026-02-12T00:00:00Z",
          type: "Cup",
        },
      ], 71),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 80, teamName: "Beta" },
          homeTeam: { id: "A", score: 90, teamName: "Alpha" },
          id: "g1",
          startTime: "2026-02-10T00:00:00Z",
          type: "league.rs",
        },
      ], 71),
    ],
    [
      "C",
      createSchedule("C", [
        {
          awayTeam: { id: "A", score: 88, teamName: "Alpha" },
          homeTeam: { id: "C", score: 92, teamName: "Gamma" },
          id: "g2",
          startTime: "2026-02-17T00:00:00Z",
          type: "League",
        },
      ], 71),
    ],
    [
      "D",
      createSchedule("D", [
        {
          awayTeam: { id: "D", score: 84, teamName: "Delta" },
          homeTeam: { id: "A", score: 102, teamName: "Alpha" },
          id: "g3",
          startTime: "2026-02-24T00:00:00Z",
          type: "league.rs",
        },
      ], 71),
    ],
  ]);

  const slate = await __testing.resolveLeagueGameDaySlate({
    bb: {
      getSchedule: async (teamId) => {
        const schedule = schedules.get(teamId ?? "");
        if (!schedule) {
          throw new Error(`Missing schedule for ${teamId}`);
        }
        return schedule;
      },
    },
    gameDayNumber: 3,
    standings,
  });

  assert.deepStrictEqual(slate.map((game) => game.matchId), ["g3"]);
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
  let started = false;

  const result = await submitGameDayRecap(
    {
      env: {},
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      startWorkflowExecution: async () => {
        started = true;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:active";
      },
      getGameDayRecap: async () => ({
        executionArn:
          "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:active",
        gameDate: "2026-03-15",
        leagueId: "100",
        requestJson: {},
        requestedAt: "2026-03-15T22:00:00Z",
        status: "QUEUED",
        targetKey: "100#2026-03-15",
        userId: "user-1",
      }),
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async () => {
        upserted = true;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:active",
    targetKey: "100#2026-03-15",
  });
  assert.equal(upserted, false);
  assert.equal(started, false);
});

test("submitGameDayRecap reruns terminal jobs in place", async () => {
  let queuedMessage:
    | {
        kind: string;
        modelId?: string;
        requestedAt: string;
        targetKey: string;
        userId: string;
      }
    | null = null;
  let savedStatus = "";

  await submitGameDayRecap(
    {
      env: createRecapEnv(),
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      startWorkflowExecution: async (_stateMachineArn, _executionName, message) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:rerun";
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
      requireFeatureAccess: async () => "premium",
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async (env, record) => {
        void env;
        savedStatus = record.status;
      },
    },
  );

  assert.equal(savedStatus, "QUEUED");
  const rerunMessage = expectPresent<
    { kind: string; requestedAt: string; targetKey: string; userId: string }
  >(queuedMessage, "startWorkflowExecution did not receive a rerun message");
  assert.equal(rerunMessage.kind, "LEAGUE_DATE");
  assert.equal(rerunMessage.targetKey, "100#2026-03-15");
});

test("submitGameDayRecap allows access when premium is granted by the environment default", async () => {
  let queuedMessage: {
    modelId?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;

  const result = await submitGameDayRecap(
    {
      env: createRecapEnv({
        BILLING_DEFAULT_PLAN: "premium",
      }),
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      startWorkflowExecution: async (_stateMachineArn, _executionName, message) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:premium";
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

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:premium",
    targetKey: "100#2026-03-15",
  });
  const premiumMessage = expectPresent<
    {
      kind: string;
      modelId?: string;
      requestedAt: string;
      targetKey: string;
      userId: string;
    }
  >(queuedMessage, "startWorkflowExecution did not receive a premium message");
  assert.equal(premiumMessage.kind, "LEAGUE_DATE");
  assert.equal(premiumMessage.modelId, DEFAULT_RECAP_MODEL_ID);
  assert.equal(premiumMessage.targetKey, "100#2026-03-15");
});

test("resolveConfiguredRecapModelId prefers the premium override for premium access", () => {
  const modelId = __testing.resolveConfiguredRecapModelId(
    createRecapEnv({
      GAME_DAY_RECAP_MODEL_ID_PREMIUM: PREMIUM_RECAP_MODEL_ID,
    }),
    "premium",
  );

  assert.equal(modelId, PREMIUM_RECAP_MODEL_ID);
});

test("resolveConfiguredRecapModelId falls back to the default model when no premium override exists", () => {
  const modelId = __testing.resolveConfiguredRecapModelId(
    createRecapEnv(),
    "premium",
  );

  assert.equal(modelId, DEFAULT_RECAP_MODEL_ID);
});

test("resolveQueuedRecapModelId prefers the model on the queue message", () => {
  const modelId = __testing.resolveQueuedRecapModelId(
    {
      kind: "LEAGUE_DATE",
      modelId: PREMIUM_RECAP_MODEL_ID,
      requestedAt: "2026-03-15T22:30:00Z",
      targetKey: "100#2026-03-15",
      userId: "user-1",
    },
    DEFAULT_RECAP_MODEL_ID,
  );

  assert.equal(modelId, PREMIUM_RECAP_MODEL_ID);
});

test("resolveQueuedRecapModelId falls back to the legacy worker model when the queue message omits one", () => {
  const modelId = __testing.resolveQueuedRecapModelId(
    {
      kind: "LEAGUE_DATE",
      requestedAt: "2026-03-15T22:30:00Z",
      targetKey: "100#2026-03-15",
      userId: "user-1",
    },
    DEFAULT_RECAP_MODEL_ID,
  );

  assert.equal(modelId, DEFAULT_RECAP_MODEL_ID);
});

test("submitLeagueGameDayRecap persists the routed modelId on the record and queue message", async () => {
  let queuedMessage: {
    modelId?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;

  const result = await submitLeagueGameDayRecap(
    {
      env: createRecapEnv({
        GAME_DAY_RECAP_MODEL_ID_PREMIUM: PREMIUM_RECAP_MODEL_ID,
      }),
      gameDayNumber: 3,
      identity: { sub: "user-1" },
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
      season: 71,
    },
    {
      startWorkflowExecution: async (_stateMachineArn, _executionName, message) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-day";
      },
      getLeagueGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      updateLeagueGameDayRecap: async () => {},
      upsertLeagueGameDayRecap: async (_env, record: any) => {
        savedModelId = record.modelId ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-day",
    targetKey: "100#71#gameday-3",
  });
  assert.equal(savedModelId, PREMIUM_RECAP_MODEL_ID);
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    PREMIUM_RECAP_MODEL_ID,
  );
});

test("submitSingleGameSummary persists the routed modelId on the record and queue message", async () => {
  let queuedMessage: {
    modelId?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;

  const result = await submitSingleGameSummary(
    {
      env: createRecapEnv({
        GAME_DAY_RECAP_MODEL_ID_PREMIUM: PREMIUM_RECAP_MODEL_ID,
      }),
      identity: { sub: "user-1" },
      matchId: "137828772",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      startWorkflowExecution: async (_stateMachineArn, _executionName, message) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:single";
      },
      getSingleGameSummary: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      updateSingleGameSummary: async () => {},
      upsertSingleGameSummary: async (_env, record: any) => {
        savedModelId = record.modelId ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:single",
    targetKey: "137828772",
  });
  assert.equal(savedModelId, PREMIUM_RECAP_MODEL_ID);
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    PREMIUM_RECAP_MODEL_ID,
  );
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
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-15T23:10:00.000Z",
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

test("processGameDayRecap resolves the current open season before fetching seasons", async () => {
  const recapRecord = {
    gameDate: "2026-03-10",
    leagueId: "100",
    requestJson: {
      gameDate: "2026-03-10",
      leagueId: "100",
    },
    requestedAt: "2026-03-17T07:03:49.610Z",
    status: "QUEUED" as const,
    targetKey: "100#2026-03-10",
    userId: "user-1",
  };
  const standingsCalls: Array<number | undefined> = [];
  const scheduleCalls: Array<{ season: number | undefined; teamId: string | undefined }> = [];
  let seasonsFetched = 0;
  const updates: Array<Record<string, unknown>> = [];
  const currentStandings = createStandings(71);
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A:71",
      createSchedule("A", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-10T19:00:00Z",
          type: "League",
        },
      ], 71),
    ],
    [
      "B:71",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-10T19:00:00Z",
          type: "League",
        },
      ], 71),
    ],
    ["C:71", createSchedule("C", [], 71)],
    ["D:71", createSchedule("D", [], 71)],
  ]);

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
        getBoxScore: async () =>
          createBoxScore({
            awayScore: 81,
            awayTeamId: "B",
            awayTeamName: "Beta",
            homeScore: 85,
            homeTeamId: "A",
            homeTeamName: "Alpha",
            matchId: "m-1",
          }),
        getSchedule: async (teamId, season) => {
          scheduleCalls.push({ season, teamId });
          const schedule = schedules.get(`${teamId ?? ""}:${season ?? "current"}`);
          if (!schedule) {
            throw new Error(`Missing schedule for ${teamId} in season ${String(season)}`);
          }
          return schedule;
        },
        getSeasons: async () => {
          seasonsFetched += 1;
          return {
            seasons: [{ finish: null, id: 71, start: "2026-01-20T14:23:23Z" }],
            version: "1",
          };
        },
        getStandings: async (_leagueId, season) => {
          standingsCalls.push(season);
          return currentStandings;
        },
        getTeamInfo: async () => ({
          country: null,
          fields: {},
          isBot: false,
          league: { id: "100", name: "Elite League" },
          ownerName: "Owner",
          retrievedAt: "2026-03-10T00:00:00Z",
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
            writeup: `${game.teams.home.name} controlled the night from the middle quarters onward and kept ${game.teams.away.name} from making the final minutes dramatic enough to flip the result.`,
          })),
          summary: {
            headline: "Elite League roundup",
            lede: "The current-season slate resolved directly from the live league standings and schedules without any historical fallback.",
          },
        }),
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T07:03:52.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-17T07:03:52.000Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.deepStrictEqual(standingsCalls, [undefined]);
  assert.equal(seasonsFetched, 0);
  assert.equal(scheduleCalls[0]?.season, 71);
  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
});

test("processGameDayRecap falls back to historical season candidates when current schedules miss the day", async () => {
  const recapRecord = {
    gameDate: "2026-01-10",
    leagueId: "100",
    requestJson: {
      gameDate: "2026-01-10",
      leagueId: "100",
    },
    requestedAt: "2026-03-17T07:03:49.610Z",
    status: "QUEUED" as const,
    targetKey: "100#2026-01-10",
    userId: "user-1",
  };
  const standingsCalls: Array<number | undefined> = [];
  const historicalStandings = createStandings(70);
  const schedules = new Map<string, BBApiSchedule>([
    ["A:71", createSchedule("A", [], 71)],
    ["B:71", createSchedule("B", [], 71)],
    ["C:71", createSchedule("C", [], 71)],
    ["D:71", createSchedule("D", [], 71)],
    [
      "A:70",
      createSchedule("A", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-01-10T19:00:00Z",
          type: "League",
        },
      ], 70),
    ],
    [
      "B:70",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 85, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-01-10T19:00:00Z",
          type: "League",
        },
      ], 70),
    ],
    ["C:70", createSchedule("C", [], 70)],
    ["D:70", createSchedule("D", [], 70)],
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
        getBoxScore: async () =>
          createBoxScore({
            awayScore: 81,
            awayTeamId: "B",
            awayTeamName: "Beta",
            homeScore: 85,
            homeTeamId: "A",
            homeTeamName: "Alpha",
            matchId: "m-1",
          }),
        getSchedule: async (teamId, season) => {
          const schedule = schedules.get(`${teamId ?? ""}:${season ?? "current"}`);
          if (!schedule) {
            throw new Error(`Missing schedule for ${teamId} in season ${String(season)}`);
          }
          return schedule;
        },
        getSeasons: async () => ({
          seasons: [
            {
              finish: "2026-01-20T14:23:23Z",
              id: 70,
              start: "2025-10-14T10:05:35Z",
            },
            { finish: null, id: 71, start: "2026-01-20T14:23:23Z" },
          ],
          version: "1",
        }),
        getStandings: async (_leagueId, season) => {
          standingsCalls.push(season);
          return season === 70 ? historicalStandings : createStandings(71);
        },
        getTeamInfo: async () => ({
          country: null,
          fields: {},
          isBot: false,
          league: { id: "100", name: "Elite League" },
          ownerName: "Owner",
          retrievedAt: "2026-01-10T00:00:00Z",
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
            writeup: `${game.teams.home.name} handled ${game.teams.away.name} for most of the night, turning a solid first half into a result that never really felt in doubt by the final possessions.`,
          })),
          summary: {
            headline: "Elite League roundup",
            lede: "The worker checked the current season first, then found the requested date by probing the historical season that actually contained games.",
          },
        }),
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T07:03:52.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-17T07:03:52.000Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.deepStrictEqual(standingsCalls, [undefined, 70]);
  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  assert.equal(updates.at(-1)?.season, 70);
});

test("processGameDayRecap fails with a slate-specific error when no candidate season yields games", async () => {
  const recapRecord = {
    gameDate: "2026-01-10",
    leagueId: "100",
    requestJson: {
      gameDate: "2026-01-10",
      leagueId: "100",
    },
    requestedAt: "2026-03-17T07:03:49.610Z",
    status: "QUEUED" as const,
    targetKey: "100#2026-01-10",
    userId: "user-1",
  };
  const updates: Array<Record<string, unknown>> = [];

  await assert.rejects(
    processGameDayRecap(
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
          getBoxScore: async () => {
            throw new Error("box scores should not be fetched without a slate");
          },
          getSchedule: async (teamId, season) =>
            createSchedule(teamId ?? "missing", [], season ?? 71),
          getSeasons: async () => ({
            seasons: [
              {
                finish: "2026-01-20T14:23:23Z",
                id: 70,
                start: "2025-10-14T10:05:35Z",
              },
              { finish: null, id: 71, start: "2026-01-20T14:23:23Z" },
            ],
            version: "1",
          }),
          getStandings: async (_leagueId, season) => createStandings(season ?? 71),
          getTeamInfo: async () => ({
            country: null,
            fields: {},
            isBot: false,
            league: { id: "100", name: "Elite League" },
            ownerName: "Owner",
            retrievedAt: "2026-01-10T00:00:00Z",
            rival: null,
            shortName: "ALP",
            teamId: "A",
            teamName: "Alpha",
            version: "1",
          }),
        }),
        createProvider: () => ({
          generate: async () => {
            throw new Error("provider should not be invoked without a slate");
          },
          modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
          providerName: "bedrock",
        }),
        getBbConnection: async () => ({
          bbLoginName: "coach-alpha",
          leagueTimeZone: "America/New_York",
          refreshSortAt: "2026-03-17T07:03:52.000Z",
          status: "CONNECTED",
          userId: "user-1",
        }),
        getGameDayRecap: async () => recapRecord,
        now: () => new Date("2026-03-17T07:03:52.000Z"),
        resolveBbAccessKey: async () => "secret",
        updateGameDayRecap: async (_env, input) => {
          updates.push(input);
        },
      },
    ),
    /No league games were found for league 100 on 2026-01-10\./i,
  );

  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.equal(
    updates.at(-1)?.error,
    "No league games were found for league 100 on 2026-01-10.",
  );
});

test("processLeagueGameDayRecap resolves a full regular-season slate by ordinal game day", async () => {
  const recapRecord = {
    gameDayNumber: 3,
    leagueId: "1",
    requestJson: {
      gameDayNumber: 3,
      leagueId: "1",
      mode: "LEAGUE_GAME_DAY",
      season: 71,
    },
    requestedAt: "2026-03-17T10:49:14.585Z",
    season: 71,
    status: "QUEUED" as const,
    targetKey: "1#71#gameday-3",
    userId: "user-1",
  };
  const updates: Array<Record<string, unknown>> = [];
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule("A", [
        {
          awayTeam: { id: "B", score: 82, teamName: "Beta" },
          homeTeam: { id: "A", score: 95, teamName: "Alpha" },
          id: "g1",
          startTime: "2026-02-10T00:00:00Z",
          type: "league.rs",
        },
        {
          awayTeam: { id: "A", score: 87, teamName: "Alpha" },
          homeTeam: { id: "C", score: 91, teamName: "Gamma" },
          id: "g2",
          startTime: "2026-02-17T00:00:00Z",
          type: "League",
        },
        {
          awayTeam: { id: "D", score: 98, teamName: "Delta" },
          homeTeam: { id: "A", score: 114, teamName: "Alpha" },
          id: "137828772",
          startTime: "2026-03-04T01:00:00Z",
          type: "league.rs",
        },
      ], 71),
    ],
    ["B", createSchedule("B", [{ awayTeam: { id: "B", score: 82, teamName: "Beta" }, homeTeam: { id: "A", score: 95, teamName: "Alpha" }, id: "g1", startTime: "2026-02-10T00:00:00Z", type: "league.rs" }], 71)],
    ["C", createSchedule("C", [{ awayTeam: { id: "A", score: 87, teamName: "Alpha" }, homeTeam: { id: "C", score: 91, teamName: "Gamma" }, id: "g2", startTime: "2026-02-17T00:00:00Z", type: "League" }], 71)],
    ["D", createSchedule("D", [{ awayTeam: { id: "D", score: 98, teamName: "Delta" }, homeTeam: { id: "A", score: 114, teamName: "Alpha" }, id: "137828772", startTime: "2026-03-04T01:00:00Z", type: "league.rs" }], 71)],
  ]);

  await processLeagueGameDayRecap(
    {
      env: {},
      messageBody: JSON.stringify({
        kind: "LEAGUE_GAME_DAY",
        requestedAt: recapRecord.requestedAt,
        targetKey: recapRecord.targetKey,
        userId: recapRecord.userId,
      }),
      modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      region: "us-east-1",
    },
    {
      createBbClient: () => ({
        getBoxScore: async (matchId) =>
          createBoxScore({
            awayScore: 98,
            awayTeamId: "D",
            awayTeamName: "Delta",
            homeScore: 114,
            homeTeamId: "A",
            homeTeamName: "Visionaries",
            matchId: matchId ?? "137828772",
          }),
        getSchedule: async (teamId) => {
          const schedule = schedules.get(teamId ?? "");
          if (!schedule) {
            throw new Error(`Missing schedule for ${teamId}`);
          }
          return schedule;
        },
        getSeasons: async () => {
          throw new Error("league game-day recaps should not fetch seasons when season is explicit");
        },
        getStandings: async () => createStandings(71, "1"),
        getTeamInfo: async () => ({
          country: { id: "1", name: "USA" },
          fields: {},
          isBot: false,
          league: { id: "1", name: "NBBA" },
          ownerName: "Owner",
          retrievedAt: "2026-03-03T00:00:00Z",
          rival: null,
          shortName: "VIS",
          teamId: "A",
          teamName: "Visionaries",
          version: "1",
        }),
      }),
      createProvider: () => ({
        generate: async (payload) => ({
          games: payload.games.map((game) => ({
            evidenceTags: ["recent_form"],
            headline: `Recap for ${game.matchId}`,
            matchId: game.matchId,
            writeup: `${game.teams.home.name} kept control of the game-day slate and handled ${game.teams.away.name} without giving up the fourth quarter.`,
          })),
          summary: {
            headline: "NBBA game day roundup",
            lede: "The requested regular-season game day resolved from ordered league schedules without any calendar-date filtering.",
          },
        }),
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueId: "1",
        leagueName: "NBBA",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T10:49:23.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getLeagueGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-17T10:49:23.000Z"),
      resolveBbAccessKey: async () => "secret",
      updateLeagueGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  assert.equal(updates.at(-1)?.season, 71);
});

test("processSingleGameSummary summarizes one finished match without standings or schedules", async () => {
  const summaryRecord = {
    matchId: "137828772",
    requestJson: {
      matchId: "137828772",
      mode: "SINGLE_GAME",
    },
    requestedAt: "2026-03-17T10:49:14.585Z",
    status: "QUEUED" as const,
    targetKey: "137828772",
    userId: "user-1",
  };
  const updates: Array<Record<string, unknown>> = [];

  await processSingleGameSummary(
    {
      env: {},
      messageBody: JSON.stringify({
        kind: "SINGLE_GAME",
        requestedAt: summaryRecord.requestedAt,
        targetKey: summaryRecord.targetKey,
        userId: summaryRecord.userId,
      }),
      modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      region: "us-east-1",
    },
    {
      createBbClient: () => ({
        getBoxScore: async () =>
          createBoxScore({
            awayScore: 98,
            awayTeamId: "28479",
            awayTeamName: "Delta 9",
            homeScore: 114,
            homeTeamId: "29656",
            homeTeamName: "Visionaries",
            matchId: "137828772",
          }),
        getSchedule: async () => {
          throw new Error("single-game summaries should not load schedules");
        },
        getSeasons: async () => {
          throw new Error("single-game summaries should not load seasons");
        },
        getStandings: async () => {
          throw new Error("single-game summaries should not load standings");
        },
        getTeamInfo: async () => {
          throw new Error("single-game summaries should not load team info");
        },
      }),
      createProvider: () => ({
        generate: async (payload) => ({
          games: payload.games.map((game) => ({
            evidenceTags: ["top_performance"],
            headline: "Visionaries pull away late",
            matchId: game.matchId,
            writeup: `${game.teams.home.name} turned a steady performance into a decisive finish and never let ${game.teams.away.name} recover once the margin widened.`,
          })),
          summary: {
            headline: "Visionaries handle Delta 9",
            lede: "A direct match-id request can produce a finished-game summary without any league-day or season lookup.",
          },
        }),
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueId: "1",
        leagueName: "NBBA",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T10:49:23.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getSingleGameSummary: async () => summaryRecord,
      now: () => new Date("2026-03-17T10:49:23.000Z"),
      resolveBbAccessKey: async () => "secret",
      updateSingleGameSummary: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  assert.equal(updates.at(-1)?.leagueId, "1");
  assert.equal(updates.at(-1)?.gameDate, "2026-03-15");
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
      request: {
        gameDate: "2026-03-15",
        gameDayNumber: null,
        kind: "LEAGUE_DATE",
        label: "Elite League 2026-03-15",
        leagueId: "100",
        leagueName: "Elite League",
        matchId: null,
        season: 64,
        timeZone: "America/New_York",
      },
    },
  });

  const schema = request.outputConfig.textFormat.structure.jsonSchema.schema;

  assert.equal(request.outputConfig.textFormat.type, "json_schema");
  assert.match(
    schema,
    /"summary"/,
  );
  assert.match(
    schema,
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
