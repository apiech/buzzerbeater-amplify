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
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();
import { RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME } from "../amplify/_shared/game-day-recap-errors";
import { requireFeatureAccess } from "../amplify/data/_backend/billing";
import { BBXmlApiError, BBXmlApiParseError } from "../lib/bbapi";
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

function createCompleteTeamRatings(base: number) {
  return {
    outsideScoring: base,
    insideScoring: base - 0.8,
    outsideDefense: base - 1.2,
    insideDefense: base - 0.6,
    rebounding: base - 1.7,
    offensiveFlow: base - 2,
  };
}

function createBoxScorePerformanceStats(
  overrides: Partial<
    NonNullable<BBApiBoxScore["awayTeam"]>["players"][number]["performanceStats"]
  > = {},
) {
  return {
    ast: 0,
    blk: 0,
    fga: 0,
    fgm: 0,
    fta: 0,
    ftm: 0,
    oreb: 0,
    pf: 0,
    pts: 0,
    reb: 0,
    stl: 0,
    to: 0,
    tpa: 0,
    tpm: 0,
    ...overrides,
  };
}

function createBoxScorePlayer(args: {
  didNotPlay?: boolean;
  firstName: string;
  id: string;
  lastName: string;
  minutesByPosition: Record<string, number>;
  performanceStats?: Partial<
    NonNullable<BBApiBoxScore["awayTeam"]>["players"][number]["performanceStats"]
  >;
  ratingRaw: string;
  ratingValue: number | null;
}) {
  const firstName = args.firstName;
  const lastName = args.lastName;
  return {
    didNotPlay: args.didNotPlay ?? false,
    details: {},
    firstName,
    fullName: `${firstName} ${lastName}`,
    id: args.id,
    lastName,
    minutesByPosition: args.minutesByPosition,
    performanceStats: createBoxScorePerformanceStats(args.performanceStats),
    ratingRaw: args.ratingRaw,
    ratingValue: args.ratingValue,
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
        createBoxScorePlayer({
          firstName: "Ari",
          id: "p-away",
          lastName: "Away",
          minutesByPosition: { C: 0, PF: 0, PG: 30, SF: 0, SG: 8 },
          performanceStats: {
            ast: 7,
            blk: 0,
            pts: 24,
            reb: 6,
            stl: 2,
            to: 3,
          },
          ratingRaw: "16",
          ratingValue: 16,
        }),
      ],
      ratings: createCompleteTeamRatings(12.2),
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
        createBoxScorePlayer({
          firstName: "Hal",
          id: "p-home",
          lastName: "Home",
          minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 30, SG: 10 },
          performanceStats: {
            ast: 5,
            blk: 1,
            pts: 21,
            reb: 9,
            stl: 1,
            to: 1,
          },
          ratingRaw: "15",
          ratingValue: 15,
        }),
      ],
      ratings: createCompleteTeamRatings(11.4),
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
    effortSummary: null,
    gameDayPrepSummaries: [],
    rotationSummaries: [],
    evidenceSignals: [],
    finalMargin: 4,
    matchId,
    neutral: false,
    quarterFacts: {
      decisiveQuarter: null,
      fourthQuarterOutcome: {
        awayScore: 24,
        homeScore: 26,
        label: "4th quarter",
        margin: 2,
        period: 4,
        winningSide: "home",
      },
      periods: [
        {
          awayScore: 20,
          homeScore: 18,
          label: "1st quarter",
          margin: 2,
          period: 1,
          winningSide: "away",
        },
        {
          awayScore: 18,
          homeScore: 24,
          label: "2nd quarter",
          margin: 6,
          period: 2,
          winningSide: "home",
        },
        {
          awayScore: 22,
          homeScore: 20,
          label: "3rd quarter",
          margin: 2,
          period: 3,
          winningSide: "away",
        },
        {
          awayScore: 24,
          homeScore: 26,
          label: "4th quarter",
          margin: 2,
          period: 4,
          winningSide: "home",
        },
      ],
    },
    quarterScores: {
      away: [20, 18, 22, 24],
      home: [18, 24, 20, 26],
    },
    standingsContext: [],
    teams: {
      away: {
        conferenceIndex: 2,
        conferencePosition: 1,
        defStrategy: "23 Zone",
        efficiency: {},
        foulTroubleLimitationCount: 0,
        gdp: {},
        lastFive: "3-2",
        lastFiveEnteringGame: "4-1",
        keyAbsenceCount: 0,
        name: "Away",
        offStrategy: "Motion",
        ratingLabels: {},
        ratingTotal: 66.9,
        recentAverageMargin: 5,
        recentSignalFlags: [],
        record: "10-6",
        recordEnteringGame: "10-5",
        score: 81,
        streak: "L1",
        streakEnteringGame: "W2",
        topPlayers: [],
      },
      home: {
        conferenceIndex: 1,
        conferencePosition: 1,
        defStrategy: "Man To Man",
        efficiency: {},
        foulTroubleLimitationCount: 0,
        gdp: {},
        lastFive: "5-0",
        lastFiveEnteringGame: "5-0",
        keyAbsenceCount: 0,
        name: "Home",
        offStrategy: "Push",
        ratingLabels: {},
        ratingTotal: 62.1,
        recentAverageMargin: 7,
        recentSignalFlags: [],
        record: "13-3",
        recordEnteringGame: "12-3",
        score: 85,
        streak: "W4",
        streakEnteringGame: "W3",
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
  assert.equal(context.wins, 3);
  assert.equal(context.losses, 2);
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

test("team form helpers can scope recap context to regular-season and TV games only", () => {
  const standing = __testing.extractStandingTeams(createStandings()).get("A");
  assert.ok(standing);

  const schedule = createSchedule("A", [
    {
      awayTeam: { id: "B", score: 80, teamName: "Beta" },
      homeTeam: { id: "A", score: 92, teamName: "Alpha" },
      id: "league-rs-1",
      startTime: "2026-03-14T19:00:00Z",
      type: "league.rs",
    },
    {
      awayTeam: { id: "A", score: 84, teamName: "Alpha" },
      homeTeam: { id: "C", score: 90, teamName: "Gamma" },
      id: "league-tv-1",
      startTime: "2026-03-13T19:00:00Z",
      type: "LEAGUE.RS.TV",
    },
    {
      awayTeam: { id: "A", score: 61, teamName: "Alpha" },
      homeTeam: { id: "D", score: 95, teamName: "Delta" },
      id: "cup-1",
      startTime: "2026-03-12T19:00:00Z",
      type: "cup.round1",
    },
    {
      awayTeam: { id: "E", score: 72, teamName: "Epsilon" },
      homeTeam: { id: "A", score: 83, teamName: "Alpha" },
      id: "friendly-1",
      startTime: "2026-03-11T19:00:00Z",
      type: "friendly",
    },
    {
      awayTeam: { id: "F", score: 88, teamName: "Zeta" },
      homeTeam: { id: "A", score: 91, teamName: "Alpha" },
      id: "private-1",
      startTime: "2026-03-10T19:00:00Z",
      type: "private.round1",
    },
    {
      awayTeam: { id: "A", score: 76, teamName: "Alpha" },
      homeTeam: { id: "G", score: 99, teamName: "Eta" },
      id: "bbb-1",
      startTime: "2026-03-09T19:00:00Z",
      type: "bbb.round2",
    },
    {
      awayTeam: { id: "H", score: 90, teamName: "Theta" },
      homeTeam: { id: "A", score: 97, teamName: "Alpha" },
      id: "bbm-1",
      startTime: "2026-03-08T19:00:00Z",
      type: "bbm.round1",
    },
  ]);

  const context = __testing.buildTeamSeasonContext({
    boxScores: [],
    gameStartTime: "2026-03-15T19:00:00Z",
    includeMatch: __testing.isRegularSeasonLeagueContextMatch,
    schedule,
    standing,
  });

  assert.equal(context.currentStreak, "W1");
  assert.equal(context.lastFive, "1-1");
  assert.equal(context.wins, 1);
  assert.equal(context.losses, 1);
  assert.equal(context.recentAverageMargin, 3);
  assert.deepStrictEqual(context.recentSignalFlags, []);
});

test("derivePostgameTeamSeasonContext extends a losing streak after another loss", () => {
  const enteringGameContext = {
    conferenceIndex: 0,
    conferencePosition: 1,
    currentStreak: "L13",
    lastFive: "0-5",
    losses: 13,
    recentAverageMargin: -11.6,
    recentBoxScoreCoverage: 3,
    recentMargins: [-12, -9, -15, -20, -2],
    recentSignalFlags: [
      "possible_strategic_deemphasis",
      "recent_slide",
      "cold_streak",
    ],
    teamId: "A",
    teamName: "Alpha",
    wins: 8,
  };
  const priorBoxScores = [
    createBoxScore({
      awayScore: 81,
      awayTeamId: "B",
      awayTeamName: "Beta",
      homeScore: 60,
      homeTeamId: "A",
      homeTeamName: "Alpha",
      matchId: "prev-1",
    }),
    createBoxScore({
      awayScore: 92,
      awayTeamId: "C",
      awayTeamName: "Gamma",
      homeScore: 68,
      homeTeamId: "A",
      homeTeamName: "Alpha",
      matchId: "prev-2",
    }),
  ];
  const currentLoss = createBoxScore({
    awayScore: 90,
    awayTeamId: "D",
    awayTeamName: "Delta",
    homeScore: 78,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-loss",
  });

  const context = __testing.derivePostgameTeamSeasonContext({
    boxScore: currentLoss,
    enteringGameContext,
    priorBoxScores,
  });

  assert.equal(context.currentStreak, "L14");
  assert.equal(context.wins, 8);
  assert.equal(context.losses, 14);
  assert.equal(context.lastFive, "0-5");
  assert.deepStrictEqual(context.recentMargins, [-12, -12, -9, -15, -20]);
  assert.equal(context.recentAverageMargin, -13.6);
  assert.ok(context.recentSignalFlags.includes("possible_strategic_deemphasis"));
  assert.ok(context.recentSignalFlags.includes("recent_slide"));
  assert.ok(context.recentSignalFlags.includes("cold_streak"));
});

test("derivePostgameTeamSeasonContext resets a losing streak after a win", () => {
  const enteringGameContext = {
    conferenceIndex: 0,
    conferencePosition: 1,
    currentStreak: "L13",
    lastFive: "0-5",
    losses: 13,
    recentAverageMargin: -11.6,
    recentBoxScoreCoverage: 2,
    recentMargins: [-12, -9, -15, -20, -2],
    recentSignalFlags: ["recent_slide", "cold_streak"],
    teamId: "A",
    teamName: "Alpha",
    wins: 8,
  };
  const currentWin = createBoxScore({
    awayScore: 84,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 95,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-win",
  });

  const context = __testing.derivePostgameTeamSeasonContext({
    boxScore: currentWin,
    enteringGameContext,
    priorBoxScores: [],
  });

  assert.equal(context.currentStreak, "W1");
  assert.equal(context.wins, 9);
  assert.equal(context.losses, 13);
  assert.equal(context.lastFive, "1-4");
  assert.deepStrictEqual(context.recentMargins, [11, -12, -9, -15, -20]);
  assert.equal(context.recentAverageMargin, -9);
  assert.ok(!context.recentSignalFlags.includes("recent_slide"));
  assert.ok(!context.recentSignalFlags.includes("cold_streak"));
});

test("derivePostgameTeamSeasonContext extends winning streaks and drops the oldest recent game", () => {
  const enteringGameContext = {
    conferenceIndex: 0,
    conferencePosition: 1,
    currentStreak: "W2",
    lastFive: "4-1",
    losses: 5,
    recentAverageMargin: 2,
    recentBoxScoreCoverage: 1,
    recentMargins: [6, 4, -3, 8, -5],
    recentSignalFlags: [],
    teamId: "A",
    teamName: "Alpha",
    wins: 12,
  };
  const currentWin = createBoxScore({
    awayScore: 88,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 98,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-win-2",
  });

  const context = __testing.derivePostgameTeamSeasonContext({
    boxScore: currentWin,
    enteringGameContext,
    priorBoxScores: [],
  });

  assert.equal(context.currentStreak, "W3");
  assert.equal(context.wins, 13);
  assert.equal(context.losses, 5);
  assert.equal(context.lastFive, "4-1");
  assert.deepStrictEqual(context.recentMargins, [10, 6, 4, -3, 8]);
  assert.equal(context.recentAverageMargin, 5);
  assert.ok(context.recentSignalFlags.includes("hot_streak"));
});

test("buildQuarterFacts captures ties, decisive quarters, and fourth-quarter outcomes", () => {
  const boxScore = createBoxScore({
    awayScore: 92,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 84,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-quarter-facts",
  });
  boxScore.awayTeam.partialScores = [20, 18, 24, 30];
  boxScore.homeTeam.partialScores = [18, 20, 24, 22];

  const quarterFacts = __testing.buildQuarterFacts(boxScore);

  assert.deepStrictEqual(quarterFacts.periods[2], {
    awayScore: 24,
    homeScore: 24,
    label: "3rd quarter",
    margin: 0,
    period: 3,
    winningSide: "tie",
  });
  assert.deepStrictEqual(quarterFacts.decisiveQuarter, {
    awayScore: 30,
    homeScore: 22,
    label: "4th quarter",
    margin: 8,
    period: 4,
    winningSide: "away",
  });
  assert.equal(quarterFacts.fourthQuarterOutcome?.winningSide, "away");
});

test("buildGameDayRecapPromptPayload uses postgame-first records and retains entering-game context", async () => {
  const standings = createStandings(64, "100");
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
        {
          awayTeam: { id: "D", score: 66, teamName: "Delta" },
          homeTeam: { id: "B", score: 70, teamName: "Beta" },
          id: "prev-b",
          startTime: "2026-03-08T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "C",
      createSchedule("C", [
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
      "D",
      createSchedule("D", [
        {
          awayTeam: { id: "D", score: 66, teamName: "Delta" },
          homeTeam: { id: "B", score: 70, teamName: "Beta" },
          id: "prev-b",
          startTime: "2026-03-08T19:00:00Z",
          type: "League",
        },
      ]),
    ],
  ]);

  const payload = await __testing.buildGameDayRecapPromptPayload({
    bb: {
      getBoxScore: async (matchId) => {
        switch (matchId) {
          case "m-1":
            return createBoxScore({
              awayScore: 81,
              awayTeamId: "B",
              awayTeamName: "Beta",
              homeScore: 85,
              homeTeamId: "A",
              homeTeamName: "Alpha",
              matchId: "m-1",
            });
          case "prev-a":
            return createBoxScore({
              awayScore: 79,
              awayTeamId: "A",
              awayTeamName: "Alpha",
              homeScore: 72,
              homeTeamId: "C",
              homeTeamName: "Gamma",
              matchId: "prev-a",
            });
          case "prev-b":
            return createBoxScore({
              awayScore: 66,
              awayTeamId: "D",
              awayTeamName: "Delta",
              homeScore: 70,
              homeTeamId: "B",
              homeTeamName: "Beta",
              matchId: "prev-b",
            });
          case undefined:
            throw new Error("Unexpected missing box score id");
          default:
            throw new Error(`Unexpected box score ${matchId}`);
        }
      },
      getSchedule: async (teamId) => {
        const schedule = schedules.get(teamId ?? "");
        if (!schedule) {
          throw new Error(`Missing schedule for ${teamId}`);
        }
        return schedule;
      },
      getTeamInfo: async () => {
        throw new Error("team info should not be loaded in this test");
      },
    },
    connection: {
      bbLoginName: "coach-alpha",
      leagueId: "100",
      leagueName: "Elite League",
      leagueTimeZone: "America/New_York",
      refreshSortAt: "2026-03-15T23:10:00.000Z",
      status: "CONNECTED",
      userId: "user-1",
    },
    now: new Date("2026-03-15T23:10:00Z"),
    requestedGames: [
      {
        awayTeamId: "B",
        awayTeamName: "Beta",
        homeTeamId: "A",
        homeTeamName: "Alpha",
        isScheduleFinal: true,
        matchId: "m-1",
        scheduledAwayScore: 81,
        scheduledHomeScore: 85,
        startTime: "2026-03-15T19:00:00Z",
        type: "League",
      },
    ],
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
    season: 64,
    standings,
    targetKey: "100#2026-03-15",
    userId: "user-1",
  });

  const firstGame = payload.games[0];
  assert.ok(firstGame);
  assert.equal(firstGame.teams.home.record, "2-0");
  assert.equal(firstGame.teams.home.streak, "W2");
  assert.equal(firstGame.teams.home.lastFive, "2-0");
  assert.equal(firstGame.teams.home.recordEnteringGame, "1-0");
  assert.equal(firstGame.teams.home.streakEnteringGame, "W1");
  assert.equal(firstGame.teams.away.record, "1-1");
  assert.equal(firstGame.teams.away.streak, "L1");
  assert.equal(firstGame.teams.away.lastFive, "1-1");
  assert.equal(firstGame.teams.away.recordEnteringGame, "1-0");
  assert.equal(firstGame.teams.away.streakEnteringGame, "W1");
  assert.equal(firstGame.teams.home.ratingLabels.outsideDefense, "prominent");
  assert.equal(firstGame.teams.home.ratingTotal, 62.1);
  assert.equal(firstGame.teams.away.ratingLabels.outsideScoring, "sensational");
  assert.equal(firstGame.teams.away.ratingTotal, 66.9);
  assert.deepStrictEqual(firstGame.gameDayPrepSummaries, [
    "Alpha came out well prepared to protect the paint.",
    "Beta looked well prepared for a balanced attack.",
  ]);
});

test("buildGameDayRecapPromptPayload ignores non-regular-season competitions in league context", async () => {
  const standings = createStandings(64, "100");
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
          awayTeam: { id: "A", score: 93, teamName: "Alpha" },
          homeTeam: { id: "C", score: 86, teamName: "Gamma" },
          id: "a-rs",
          startTime: "2026-03-14T19:00:00Z",
          type: "league.rs",
        },
        {
          awayTeam: { id: "D", score: 90, teamName: "Delta" },
          homeTeam: { id: "A", score: 84, teamName: "Alpha" },
          id: "a-tv",
          startTime: "2026-03-13T19:00:00Z",
          type: "LEAGUE.RS.TV",
        },
        {
          awayTeam: { id: "A", score: 68, teamName: "Alpha" },
          homeTeam: { id: "E", score: 109, teamName: "Epsilon" },
          id: "a-cup",
          startTime: "2026-03-12T19:00:00Z",
          type: "cup.round1",
        },
        {
          awayTeam: { id: "F", score: 101, teamName: "Zeta" },
          homeTeam: { id: "A", score: 65, teamName: "Alpha" },
          id: "a-friendly",
          startTime: "2026-03-11T19:00:00Z",
          type: "friendly",
        },
        {
          awayTeam: { id: "G", score: 88, teamName: "Eta" },
          homeTeam: { id: "A", score: 91, teamName: "Alpha" },
          id: "a-private",
          startTime: "2026-03-10T19:00:00Z",
          type: "private.round1",
        },
        {
          awayTeam: { id: "A", score: 71, teamName: "Alpha" },
          homeTeam: { id: "H", score: 96, teamName: "Theta" },
          id: "a-bbb",
          startTime: "2026-03-09T19:00:00Z",
          type: "bbb.round2",
        },
        {
          awayTeam: { id: "I", score: 92, teamName: "Iota" },
          homeTeam: { id: "A", score: 97, teamName: "Alpha" },
          id: "a-bbm",
          startTime: "2026-03-08T19:00:00Z",
          type: "bbm.round1",
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
        {
          awayTeam: { id: "C", score: 80, teamName: "Gamma" },
          homeTeam: { id: "B", score: 88, teamName: "Beta" },
          id: "b-tv",
          startTime: "2026-03-14T19:00:00Z",
          type: "league.rs.tv",
        },
        {
          awayTeam: { id: "B", score: 76, teamName: "Beta" },
          homeTeam: { id: "D", score: 92, teamName: "Delta" },
          id: "b-cup",
          startTime: "2026-03-13T19:00:00Z",
          type: "cup.round1",
        },
      ]),
    ],
    [
      "C",
      createSchedule("C", [
        {
          awayTeam: { id: "A", score: 93, teamName: "Alpha" },
          homeTeam: { id: "C", score: 86, teamName: "Gamma" },
          id: "a-rs",
          startTime: "2026-03-14T19:00:00Z",
          type: "league.rs",
        },
        {
          awayTeam: { id: "C", score: 80, teamName: "Gamma" },
          homeTeam: { id: "B", score: 88, teamName: "Beta" },
          id: "b-tv",
          startTime: "2026-03-14T19:00:00Z",
          type: "league.rs.tv",
        },
      ]),
    ],
    [
      "D",
      createSchedule("D", [
        {
          awayTeam: { id: "D", score: 90, teamName: "Delta" },
          homeTeam: { id: "A", score: 84, teamName: "Alpha" },
          id: "a-tv",
          startTime: "2026-03-13T19:00:00Z",
          type: "LEAGUE.RS.TV",
        },
      ]),
    ],
  ]);
  const boxScoreCalls: string[] = [];

  const payload = await __testing.buildGameDayRecapPromptPayload({
    bb: {
      getBoxScore: async (matchId) => {
        boxScoreCalls.push(matchId ?? "missing");
        switch (matchId) {
          case "m-1":
            return createBoxScore({
              awayScore: 81,
              awayTeamId: "B",
              awayTeamName: "Beta",
              homeScore: 85,
              homeTeamId: "A",
              homeTeamName: "Alpha",
              matchId: "m-1",
            });
          case "a-rs":
            return createBoxScore({
              awayScore: 93,
              awayTeamId: "A",
              awayTeamName: "Alpha",
              homeScore: 86,
              homeTeamId: "C",
              homeTeamName: "Gamma",
              matchId: "a-rs",
            });
          case "a-tv":
            return createBoxScore({
              awayScore: 90,
              awayTeamId: "D",
              awayTeamName: "Delta",
              homeScore: 84,
              homeTeamId: "A",
              homeTeamName: "Alpha",
              matchId: "a-tv",
            });
          case "b-tv":
            return createBoxScore({
              awayScore: 80,
              awayTeamId: "C",
              awayTeamName: "Gamma",
              homeScore: 88,
              homeTeamId: "B",
              homeTeamName: "Beta",
              matchId: "b-tv",
            });
          case undefined:
            throw new Error("Unexpected missing box score id");
          default:
            throw new Error(`Unexpected box score ${matchId}`);
        }
      },
      getSchedule: async (teamId) => {
        const schedule = schedules.get(teamId ?? "");
        if (!schedule) {
          throw new Error(`Missing schedule for ${teamId}`);
        }
        return schedule;
      },
      getTeamInfo: async () => {
        throw new Error("team info should not be loaded in this test");
      },
    },
    connection: {
      bbLoginName: "coach-alpha",
      leagueId: "100",
      leagueName: "Elite League",
      leagueTimeZone: "America/New_York",
      refreshSortAt: "2026-03-15T23:10:00.000Z",
      status: "CONNECTED",
      userId: "user-1",
    },
    now: new Date("2026-03-15T23:10:00Z"),
    requestedGames: [
      {
        awayTeamId: "B",
        awayTeamName: "Beta",
        homeTeamId: "A",
        homeTeamName: "Alpha",
        isScheduleFinal: true,
        matchId: "m-1",
        scheduledAwayScore: 81,
        scheduledHomeScore: 85,
        startTime: "2026-03-15T19:00:00Z",
        type: "League",
      },
    ],
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
    season: 64,
    standings,
    targetKey: "100#2026-03-15",
    userId: "user-1",
  });

  const firstGame = payload.games[0];
  assert.ok(firstGame);
  assert.equal(firstGame.teams.home.record, "2-1");
  assert.equal(firstGame.teams.home.lastFive, "2-1");
  assert.equal(firstGame.teams.home.streak, "W2");
  assert.equal(firstGame.teams.home.recordEnteringGame, "1-1");
  assert.equal(firstGame.teams.home.lastFiveEnteringGame, "1-1");
  assert.equal(firstGame.teams.home.streakEnteringGame, "W1");
  assert.equal(firstGame.teams.home.recentAverageMargin, 1.7);
  assert.deepStrictEqual(firstGame.teams.home.recentSignalFlags, []);
  assert.equal(firstGame.teams.away.record, "1-1");
  assert.equal(firstGame.teams.away.lastFive, "1-1");
  assert.equal(firstGame.teams.away.streak, "L1");
  assert.equal(firstGame.teams.away.recordEnteringGame, "1-0");
  assert.equal(firstGame.teams.away.lastFiveEnteringGame, "1-0");
  assert.equal(firstGame.teams.away.streakEnteringGame, "W1");
  assert.equal(firstGame.teams.away.recentAverageMargin, 2);
  assert.match(
    firstGame.standingsContext[0] ?? "",
    /Alpha was 1st in conference 1 entering the game\./,
  );
  assert.match(
    firstGame.standingsContext[1] ?? "",
    /Beta was 2nd in conference 1 entering the game\./,
  );
  assert.deepStrictEqual(boxScoreCalls.sort(), ["a-rs", "a-tv", "b-tv", "m-1"]);
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

test("submitLeagueGameDayRecap uses the default model when commercial mode disables premium gating", async () => {
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
        COMMERCIAL_MODE_ENABLED: "false",
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
  assert.equal(savedModelId, DEFAULT_RECAP_MODEL_ID);
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    DEFAULT_RECAP_MODEL_ID,
  );
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

test("processGameDayRecap fails with a retryable coverage error when a past final box score fetch fails", async () => {
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
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let providerCalls = 0;

  await assert.rejects(
    () =>
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
            getBoxScore: async (matchId) => {
              if (matchId === "m-2") {
                throw new BBXmlApiError(
                  "BB box score fetch failed",
                  "boxscore.aspx",
                  503,
                );
              }
              const boxScore = boxScores.get(matchId ?? "");
              if (!boxScore) {
                throw new Error(`Missing box score for ${matchId}`);
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
            generate: async () => {
              providerCalls += 1;
              throw new Error(
                "provider should not be invoked when final slate coverage is incomplete",
              );
            },
            modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            providerName: "bedrock",
          }),
          getBbConnection: async () => ({
            bbLoginName: "coach-alpha",
            leagueTimeZone: "America/New_York",
            refreshSortAt: "2026-03-17T23:10:00.000Z",
            status: "CONNECTED",
            userId: "user-1",
          }),
          getGameDayRecap: async () => recapRecord,
          now: () => new Date("2026-03-17T23:10:00Z"),
          resolveBbAccessKey: async () => "secret",
          updateGameDayRecap: async (_env, input) => {
            updates.push(input);
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME);
      return true;
    },
  );

  const finalUpdate = updates.at(-1);
  assert.ok(finalUpdate);
  assert.equal(providerCalls, 0);
  assert.equal(finalUpdate.status, "FAILED");
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

test("processGameDayRecap still allows partial coverage for same-day games that are not clearly final", async () => {
  const recapRecord = {
    gameDate: "2026-03-15",
    leagueId: "100",
    requestJson: {
      gameDate: "2026-03-15",
      leagueId: "100",
    },
    requestedAt: "2026-03-15T19:30:00Z",
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
          awayTeam: { id: "D", score: null, teamName: "Delta" },
          homeTeam: { id: "C", score: null, teamName: "Gamma" },
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
          awayTeam: { id: "D", score: null, teamName: "Delta" },
          homeTeam: { id: "C", score: null, teamName: "Gamma" },
          id: "m-2",
          startTime: "2026-03-15T21:00:00Z",
          type: "League",
        },
      ]),
    ],
  ]);
  const boxScores = new Map<string, BBApiBoxScore>([
    [
      "m-1",
      createBoxScore({
        awayScore: 81,
        awayTeamId: "B",
        awayTeamName: "Beta",
        homeScore: 85,
        homeTeamId: "A",
        homeTeamName: "Alpha",
        matchId: "m-1",
      }),
    ],
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let providerCalls = 0;

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
          if (matchId === "m-2") {
            throw new BBXmlApiError(
              "BB box score fetch failed",
              "boxscore.aspx",
              503,
            );
          }
          const boxScore = boxScores.get(matchId ?? "");
          if (!boxScore) {
            throw new Error(`Missing box score for ${matchId}`);
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
        generate: async (payload) => {
          providerCalls += 1;
          return {
            games: payload.games.map((game) => ({
              evidenceTags: ["recent_form"],
              headline: `Recap for ${game.matchId}`,
              matchId: game.matchId,
              writeup: `${game.teams.home.name} did enough to beat ${game.teams.away.name} while the later matchup remained unfinished.`,
            })),
            summary: {
              headline: "Elite League roundup",
              lede: "Completed finals were summarized while one same-day game still lacked final coverage.",
            },
          };
        },
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-15T19:45:00.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-15T19:45:00Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  const finalUpdate = updates.at(-1);
  assert.ok(finalUpdate);
  assert.equal(providerCalls, 1);
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

test("processGameDayRecap retries once after semantic validation fails", async () => {
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
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);
  const updates: Array<Record<string, unknown>> = [];
  const providerCalls: Array<string[] | undefined> = [];
  const boxScore = createBoxScore({
    awayScore: 81,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 92,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-1",
  });
  boxScore.awayTeam.partialScores = [20, 18, 24, 19];
  boxScore.homeTeam.partialScores = [18, 24, 24, 26];

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
        getBoxScore: async () => boxScore,
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
        generate: async (payload, options) => {
          providerCalls.push(options?.validationFeedback);
          if (!options?.validationFeedback?.length) {
            return {
              games: payload.games.map((game) => ({
                evidenceTags: ["recent_form"],
                headline: `Recap for ${game.matchId}`,
                matchId: game.matchId,
                writeup:
                  "The decisive third quarter saw Alpha outscore Beta 24-24 before pulling away for good once the closing possessions slowed down.",
              })),
              summary: {
                headline: "Elite League roundup",
                lede:
                  "The first draft needed one repair after a tied quarter was described as if one side had won it outright.",
              },
            };
          }

          return {
            games: payload.games.map((game) => ({
              evidenceTags: ["recent_form"],
              headline: `Recap for ${game.matchId}`,
              matchId: game.matchId,
              writeup:
                "The third quarter finished even at 24-24, but Alpha created real separation in the fourth and kept Beta from turning the final minutes into a late swing.",
            })),
            summary: {
              headline: "Elite League roundup",
              lede:
                "A repaired recap kept the tied third quarter accurate and shifted the emphasis to the fourth-quarter push that actually settled the result.",
            },
          };
        },
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T23:10:00.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-17T23:10:00Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(providerCalls.length, 2);
  assert.equal(providerCalls[0], undefined);
  assert.ok(providerCalls[1]?.some((feedback) => feedback.includes("tied 24-24")));
  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
});

test("processGameDayRecap patches repeated semantic contradictions after the retry", async () => {
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
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  const boxScore = createBoxScore({
    awayScore: 81,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 92,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-1",
  });
  boxScore.awayTeam.partialScores = [20, 18, 24, 19];
  boxScore.homeTeam.partialScores = [18, 24, 24, 26];

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
        getBoxScore: async () => boxScore,
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
        generate: async (payload) => {
          providerCalls += 1;
          return {
            games: payload.games.map((game) => ({
              evidenceTags: ["recent_form"],
              headline: `Recap for ${game.matchId}`,
              matchId: game.matchId,
              writeup:
                "The decisive third quarter saw Alpha outscore Beta 24-24 before pulling away for good once the closing possessions slowed down.",
            })),
            summary: {
              headline: "Elite League roundup",
              lede:
                "The bad quarter claim persisted across both attempts, so the worker had to repair the contradiction before saving the recap.",
            },
          };
        },
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T23:10:00.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-17T23:10:00Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(providerCalls, 2);
  const finalUpdate = expectPresent(updates.at(-1), "missing final update");
  assert.equal(finalUpdate.status, "SUCCEEDED");
  assert.deepStrictEqual(finalUpdate.coverageJson, {
    availableGames: 1,
    missingGames: [],
    partial: false,
    requestedGames: 1,
  });
  assert.equal(
    ((finalUpdate.resultJson as { games: Array<{ writeup: string }> }).games[0]
      ?.writeup ??
      ""),
    "The 3rd quarter ended tied at 24-24.",
  );
});

test("processGameDayRecap drops one invalid game and saves a partial result", async () => {
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
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
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
          awayTeam: { id: "D", score: 84, teamName: "Delta" },
          homeTeam: { id: "C", score: 88, teamName: "Gamma" },
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
          awayTeam: { id: "D", score: 84, teamName: "Delta" },
          homeTeam: { id: "C", score: 88, teamName: "Gamma" },
          id: "m-2",
          startTime: "2026-03-15T21:00:00Z",
          type: "League",
        },
      ]),
    ],
  ]);
  const boxScores = new Map<string, BBApiBoxScore>([
    [
      "m-1",
      createBoxScore({
        awayScore: 81,
        awayTeamId: "B",
        awayTeamName: "Beta",
        homeScore: 92,
        homeTeamId: "A",
        homeTeamName: "Alpha",
        matchId: "m-1",
      }),
    ],
    [
      "m-2",
      createBoxScore({
        awayScore: 84,
        awayTeamId: "D",
        awayTeamName: "Delta",
        homeScore: 88,
        homeTeamId: "C",
        homeTeamName: "Gamma",
        matchId: "m-2",
      }),
    ],
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let providerCalls = 0;

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
          const boxScore = boxScores.get(matchId);
          if (!boxScore) {
            throw new Error(`Missing box score for ${matchId}`);
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
        generate: async (payload) => {
          providerCalls += 1;
          return {
            games: payload.games.map((game) =>
              game.matchId === "m-1"
                ? {
                    evidenceTags: ["recent_form"],
                    headline: "Alpha closes cleanly",
                    matchId: game.matchId,
                    writeup:
                      "Alpha stayed steady in the closing possessions and never let Beta turn the finish into a real swing once the lead settled in.",
                  }
                : {
                    evidenceTags: ["recent_form"],
                    headline: "Gamma won the third quarter 22-20",
                    matchId: game.matchId,
                    writeup:
                      "Gamma still had enough late poise to finish the win even after a few empty trips tightened the margin for a stretch.",
                  },
            ),
            summary: {
              headline: "Elite League roundup",
              lede:
                "Both finals were summarized at first, but one game recap kept a contradiction in the headline that could not be safely repaired.",
            },
          };
        },
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        providerName: "bedrock",
      }),
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T23:10:00.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-17T23:10:00Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(providerCalls, 2);
  const finalUpdate = expectPresent(updates.at(-1), "missing final update");
  assert.equal(finalUpdate.status, "SUCCEEDED");
  assert.deepStrictEqual(finalUpdate.coverageJson, {
    availableGames: 1,
    missingGames: [
      {
        awayTeamName: "Delta",
        homeTeamName: "Gamma",
        matchId: "m-2",
        reason: "removed after factual validation could not be safely repaired",
      },
    ],
    partial: true,
    requestedGames: 2,
  });
  assert.deepStrictEqual(
    (finalUpdate.resultJson as {
      games: Array<{ matchId: string }>;
      summary: { headline: string; lede: string };
    }).games.map((game) => game.matchId),
    ["m-1"],
  );
  assert.equal(
    (finalUpdate.resultJson as { summary: { headline: string } }).summary
      .headline,
    "Elite League partial roundup",
  );
  assert.match(
    (finalUpdate.resultJson as { summary: { lede: string } }).summary.lede,
    /1 validated game/i,
  );
});

test("processGameDayRecap still fails when every invalid game must be dropped", async () => {
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
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        {
          awayTeam: { id: "B", score: 81, teamName: "Beta" },
          homeTeam: { id: "A", score: 92, teamName: "Alpha" },
          id: "m-1",
          startTime: "2026-03-15T19:00:00Z",
          type: "League",
        },
      ]),
    ],
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  const boxScore = createBoxScore({
    awayScore: 81,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 92,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-1",
  });
  boxScore.awayTeam.partialScores = [20, 18, 24, 19];
  boxScore.homeTeam.partialScores = [18, 24, 24, 26];

  await assert.rejects(
    () =>
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
            getBoxScore: async () => boxScore,
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
            generate: async (payload) => {
              providerCalls += 1;
              return {
                games: payload.games.map((game) => ({
                  evidenceTags: ["recent_form"],
                  headline: "Alpha won the third quarter 24-24",
                  matchId: game.matchId,
                  writeup:
                    "Alpha eventually finished the job, but the contradictory headline remained in both attempts.",
                })),
                summary: {
                  headline: "Elite League roundup",
                  lede:
                    "The remaining contradiction lived in the headline, so the worker should only fail after it has no valid game recap left to keep.",
                },
              };
            },
            modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            providerName: "bedrock",
          }),
          getBbConnection: async () => ({
            bbLoginName: "coach-alpha",
            leagueTimeZone: "America/New_York",
            refreshSortAt: "2026-03-17T23:10:00.000Z",
            status: "CONNECTED",
            userId: "user-1",
          }),
          getGameDayRecap: async () => recapRecord,
          now: () => new Date("2026-03-17T23:10:00Z"),
          resolveBbAccessKey: async () => "secret",
          updateGameDayRecap: async (_env, input) => {
            updates.push(input);
          },
        },
      ),
    /could not be safely repaired/i,
  );

  assert.equal(providerCalls, 2);
  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.match(
    String(updates.at(-1)?.error ?? ""),
    /could not be safely repaired/i,
  );
});

test("buildGameDayRecapPromptPayload logs BBXmlApiError details for failed box score fetches", async () => {
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
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);
  const capturedWarns: Array<[unknown, unknown]> = [];
  const originalWarn = console.warn;

  console.warn = ((message?: unknown, details?: unknown) => {
    capturedWarns.push([message, details]);
  }) as typeof console.warn;

  try {
    await assert.rejects(
      () =>
        __testing.buildGameDayRecapPromptPayload({
          bb: {
            getBoxScore: async () => {
              throw new BBXmlApiError(
                "BB API request failed for boxscore.aspx: 503 Service Unavailable",
                "boxscore.aspx",
                503,
              );
            },
            getSchedule: async (teamId) => {
              const schedule = schedules.get(teamId ?? "");
              if (!schedule) {
                throw new Error(`Missing schedule for ${teamId}`);
              }
              return schedule;
            },
            getTeamInfo: async () => {
              throw new Error("team info should not be loaded in this test");
            },
          },
          connection: {
            bbLoginName: "coach-alpha",
            leagueId: "100",
            leagueName: "Elite League",
            leagueTimeZone: "America/New_York",
            refreshSortAt: "2026-03-17T23:10:00.000Z",
            status: "CONNECTED",
            userId: "user-1",
          },
          enforceCompletedSlateCoverage: true,
          now: new Date("2026-03-17T23:10:00Z"),
          requestedGames: [
            {
              awayTeamId: "B",
              awayTeamName: "Beta",
              homeTeamId: "A",
              homeTeamName: "Alpha",
              isScheduleFinal: true,
              matchId: "m-1",
              scheduledAwayScore: 81,
              scheduledHomeScore: 85,
              startTime: "2026-03-15T19:00:00Z",
              type: "League",
            },
          ],
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
          season: 64,
          standings,
          targetKey: "100#2026-03-15",
          userId: "user-1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME);
        return true;
      },
    );
  } finally {
    console.warn = originalWarn;
  }

  const fetchFailureLog = capturedWarns.find(
    ([message]) =>
      typeof message === "string" &&
      message.includes("process.box_score_fetch_failed"),
  );
  assert.ok(fetchFailureLog, "expected a box score fetch failure warning");
  assert.deepStrictEqual(fetchFailureLog[1], {
    endpoint: "boxscore.aspx",
    errorMessage:
      "BB API request failed for boxscore.aspx: 503 Service Unavailable",
    errorName: "BBXmlApiError",
    expectedFinal: true,
    matchId: "m-1",
    scheduleFinal: true,
    scheduledAwayScore: 81,
    scheduledHomeScore: 85,
    status: 503,
    targetKey: "100#2026-03-15",
    userId: "user-1",
  });
});

test("buildGameDayRecapPromptPayload accepts completed boxscores with live rating and dnp shapes", async () => {
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
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);
  const boxScore = createBoxScore({
    awayScore: 81,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 85,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "m-1",
  });
  boxScore.awayTeam.players.push(
    createBoxScorePlayer({
      didNotPlay: false,
      firstName: "Erwin",
      id: "p-away-na",
      lastName: "Silver",
      minutesByPosition: { C: 0, PF: 0, PG: 5, SF: 0, SG: 0 },
      performanceStats: { reb: 1 },
      ratingRaw: "N/A",
      ratingValue: null,
    }),
  );
  boxScore.homeTeam.players.push(
    createBoxScorePlayer({
      didNotPlay: true,
      firstName: "Blake",
      id: "p-home-dnp-na",
      lastName: "Burrows",
      minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 0, SG: 0 },
      ratingRaw: "N/A",
      ratingValue: null,
    }),
    createBoxScorePlayer({
      didNotPlay: true,
      firstName: "Neil",
      id: "p-home-dnp-sentinel",
      lastName: "Gardeck",
      minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 0, SG: 0 },
      ratingRaw: "-100000",
      ratingValue: null,
    }),
  );

  const payload = await __testing.buildGameDayRecapPromptPayload({
    bb: {
      getBoxScore: async () => boxScore,
      getSchedule: async (teamId) => {
        const schedule = schedules.get(teamId ?? "");
        if (!schedule) {
          throw new Error(`Missing schedule for ${teamId}`);
        }
        return schedule;
      },
      getTeamInfo: async () => {
        throw new Error("team info should not be loaded in this test");
      },
    },
    connection: {
      bbLoginName: "coach-alpha",
      leagueId: "100",
      leagueName: "Elite League",
      leagueTimeZone: "America/New_York",
      refreshSortAt: "2026-03-17T23:10:00.000Z",
      status: "CONNECTED",
      userId: "user-1",
    },
    enforceCompletedSlateCoverage: true,
    now: new Date("2026-03-17T23:10:00Z"),
    requestedGames: [
      {
        awayTeamId: "B",
        awayTeamName: "Beta",
        homeTeamId: "A",
        homeTeamName: "Alpha",
        isScheduleFinal: true,
        matchId: "m-1",
        scheduledAwayScore: 81,
        scheduledHomeScore: 85,
        startTime: "2026-03-15T19:00:00Z",
        type: "League",
      },
    ],
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
    season: 64,
    standings,
    targetKey: "100#2026-03-15",
    userId: "user-1",
  });

  assert.deepStrictEqual(payload.coverage, {
    availableGames: 1,
    missingGames: [],
    partial: false,
    requestedGames: 1,
  });
  assert.equal(payload.games.length, 1);
  assert.equal(payload.games[0]?.teams.away.topPlayers[0]?.name, "Ari Away");
});

test("buildGameDayRecapPromptPayload logs parse error details separately from fetch failures", async () => {
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
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);
  const capturedWarns: Array<[unknown, unknown]> = [];
  const originalWarn = console.warn;

  console.warn = ((message?: unknown, details?: unknown) => {
    capturedWarns.push([message, details]);
  }) as typeof console.warn;

  try {
    await assert.rejects(
      () =>
        __testing.buildGameDayRecapPromptPayload({
          bb: {
            getBoxScore: async () => {
              throw new BBXmlApiParseError(
                "Failed to parse BB API response for boxscore.aspx: Unexpected boxscore player performance.rating value: mystery.",
                "boxscore.aspx",
                "<bbapi version='1'><match id='m-1' /></bbapi>",
              );
            },
            getSchedule: async (teamId) => {
              const schedule = schedules.get(teamId ?? "");
              if (!schedule) {
                throw new Error(`Missing schedule for ${teamId}`);
              }
              return schedule;
            },
            getTeamInfo: async () => {
              throw new Error("team info should not be loaded in this test");
            },
          },
          connection: {
            bbLoginName: "coach-alpha",
            leagueId: "100",
            leagueName: "Elite League",
            leagueTimeZone: "America/New_York",
            refreshSortAt: "2026-03-17T23:10:00.000Z",
            status: "CONNECTED",
            userId: "user-1",
          },
          enforceCompletedSlateCoverage: true,
          now: new Date("2026-03-17T23:10:00Z"),
          requestedGames: [
            {
              awayTeamId: "B",
              awayTeamName: "Beta",
              homeTeamId: "A",
              homeTeamName: "Alpha",
              isScheduleFinal: true,
              matchId: "m-1",
              scheduledAwayScore: 81,
              scheduledHomeScore: 85,
              startTime: "2026-03-15T19:00:00Z",
              type: "League",
            },
          ],
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
          season: 64,
          standings,
          targetKey: "100#2026-03-15",
          userId: "user-1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME);
        return true;
      },
    );
  } finally {
    console.warn = originalWarn;
  }

  const parseFailureLog = capturedWarns.find(
    ([message]) =>
      typeof message === "string" &&
      message.includes("process.box_score_parse_failed"),
  );
  assert.ok(parseFailureLog, "expected a box score parse failure warning");
  assert.deepStrictEqual(parseFailureLog[1], {
    bodyPreview: "<bbapi version='1'><match id='m-1' /></bbapi>",
    endpoint: "boxscore.aspx",
    errorMessage:
      "Failed to parse BB API response for boxscore.aspx: Unexpected boxscore player performance.rating value: mystery.",
    errorName: "BBXmlApiParseError",
    expectedFinal: true,
    matchId: "m-1",
    scheduleFinal: true,
    scheduledAwayScore: 81,
    scheduledHomeScore: 85,
    targetKey: "100#2026-03-15",
    userId: "user-1",
  });
});

test("game day recap info logging keeps only coarse milestones with compact coverage", () => {
  assert.equal(
    __testing.buildGameDayRecapInfoLogEntry("resolveSeasonForDate.evaluate", {
      gameDate: "2026-03-15",
      seasons: [{ id: 64 }],
      userId: "user-1",
    }),
    null,
  );

  assert.deepStrictEqual(
    __testing.buildGameDayRecapInfoLogEntry("process.completed", {
      coverage: {
        availableGames: 1,
        missingGames: [{ matchId: "m-2" }],
        partial: true,
        requestedGames: 2,
      },
      finalStatus: "SUCCEEDED",
      season: 64,
      targetKey: "100#2026-03-15",
      userId: "user-1",
    }),
    {
      details: {
        coverage: {
          availableGames: 1,
          missingGameCount: 1,
          partial: true,
          requestedGames: 2,
        },
        finalStatus: "SUCCEEDED",
        season: 64,
        targetKey: "100#2026-03-15",
        userId: "user-1",
      },
      event: "process.completed",
    },
  );

  assert.equal(
    __testing.buildGameDayRecapInfoLogEntry("process.completed", {
      coverage: {
        availableGames: 1,
        missingGames: [],
        partial: false,
        requestedGames: 1,
      },
      finalStatus: "SUCCEEDED",
      season: 64,
      targetKey: "100#2026-03-15",
      userId: "user-1",
    }),
    null,
  );
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

  const systemText = request.system[0]?.text ?? "";
  assert.match(systemText, /never cite the raw effortDelta value/i);
  assert.match(systemText, /never cite raw GDP focus codes/i);
  assert.match(systemText, /not a checklist of facts/i);
  assert.match(systemText, /do not invent reasons such as injuries, load management, or discipline/i);
});

test("describeEffortDeltaForRecap uses natural language for nonzero effort deltas", () => {
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: 1,
      homeTeamName: "Alpha",
    }),
    "Alpha appeared to be trying a bit harder than Beta.",
  );
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: 2,
      homeTeamName: "Alpha",
    }),
    "Alpha appeared to be trying a lot harder than Beta.",
  );
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: -1,
      homeTeamName: "Alpha",
    }),
    "Beta appeared to be trying a bit harder than Alpha.",
  );
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: -2,
      homeTeamName: "Alpha",
    }),
    "Beta appeared to be trying a lot harder than Alpha.",
  );
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: 0,
      homeTeamName: "Alpha",
    }),
    null,
  );
});

test("describeGameDayPrepFocusForRecap uses natural language for GDP focus hits and misses", () => {
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "outside.hit",
      teamName: "LA Lions",
    }),
    "LA Lions came out well prepared to guard the perimeter.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "outside.miss",
      teamName: "LA Lions",
    }),
    "LA Lions looked surprised and disorganized on the defensive perimeter.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "Inside.hit",
      teamName: "LA Lions",
    }),
    "LA Lions came out well prepared to protect the paint.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "Balanced.miss",
      teamName: "LA Lions",
    }),
    "LA Lions looked a step behind against a more balanced attack.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "N/A",
      teamName: "LA Lions",
    }),
    null,
  );
});

test("buildRotationSummariesForRecap flags key absences and foul trouble without guessing causes", () => {
  const boxScore = createBoxScore({
    awayScore: 81,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 85,
    homeTeamId: "A",
    homeTeamName: "LA Lions",
    matchId: "m-1",
  });
  boxScore.homeTeam.players = [
    createBoxScorePlayer({
      didNotPlay: true,
      firstName: "Leo",
      id: "p-home-dnp-star",
      lastName: "Star",
      minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 0, SG: 0 },
      ratingRaw: "16",
      ratingValue: 16,
    }),
    createBoxScorePlayer({
      firstName: "Mason",
      id: "p-home-foul",
      lastName: "Key",
      minutesByPosition: { C: 0, PF: 0, PG: 22, SF: 0, SG: 0 },
      performanceStats: { pf: 5, pts: 12 },
      ratingRaw: "15",
      ratingValue: 15,
    }),
    createBoxScorePlayer({
      firstName: "Rico",
      id: "p-home-steady",
      lastName: "Wing",
      minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 36, SG: 0 },
      performanceStats: { pf: 2, pts: 15 },
      ratingRaw: "12",
      ratingValue: 12,
    }),
  ];

  assert.deepStrictEqual(__testing.buildRotationSummariesForRecap(boxScore.homeTeam), [
    "LA Lions came in without Leo Star, leaving them short-handed.",
    "Mason Key spent much of the night in foul trouble and played only 22 minutes.",
  ]);
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
  const upset = createExpectedPromptGame("m-1");
  upset.finalMargin = 2;
  upset.neutral = false;
  upset.quarterFacts.periods.push({
    awayScore: 9,
    homeScore: 7,
    label: "overtime",
    margin: 2,
    period: 5,
    winningSide: "away",
  });
  upset.teams.away.conferencePosition = 6;
  upset.teams.away.gdp = {
    focus: "Outside.hit",
    pace: "Fast.hit",
  };
  upset.teams.away.name = "Road Dogs";
  upset.teams.away.ratingTotal = 60.4;
  upset.teams.away.recordEnteringGame = "8-7";
  upset.teams.away.score = 96;
  upset.teams.home.conferencePosition = 1;
  upset.teams.home.gdp = {
    focus: "Outside.miss",
  };
  upset.teams.home.name = "Favorites";
  upset.teams.home.ratingTotal = 67.8;
  upset.teams.home.recordEnteringGame = "13-2";
  upset.teams.home.score = 94;

  const dud = createExpectedPromptGame("m-2");
  dud.finalMargin = 21;
  dud.teams.away.conferencePosition = 8;
  dud.teams.away.foulTroubleLimitationCount = 1;
  dud.teams.away.keyAbsenceCount = 2;
  dud.teams.away.name = "Short Bench";
  dud.teams.away.ratingTotal = 59.8;
  dud.teams.away.recentSignalFlags = ["possible_strategic_deemphasis"];
  dud.teams.away.recordEnteringGame = "4-11";
  dud.teams.away.score = 80;
  dud.teams.home.conferencePosition = 1;
  dud.teams.home.gdp = {
    focus: "Balanced.hit",
  };
  dud.teams.home.name = "Top Seed";
  dud.teams.home.ratingTotal = 68.1;
  dud.teams.home.recordEnteringGame = "14-1";
  dud.teams.home.score = 101;

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
    [upset, dud],
  );

  assert.equal(result.games.length, 2);
  const firstGame = result.games[0];
  const secondGame = result.games[1];
  assert.ok(firstGame);
  assert.ok(secondGame);
  assert.equal(firstGame.matchId, "m-1");
  assert.equal(result.summary.gameOfTheDayMatchId, "m-1");
  assert.equal(
    result.summary.gameOfTheDaySurpriseFactor,
    firstGame.surpriseFactor,
  );
  assert.equal(result.summary.headline, "Elite League delivers a split slate");
  assert.ok((firstGame.surpriseFactor ?? 0) > (secondGame.surpriseFactor ?? 10));
  assert.ok((firstGame.surpriseFactor ?? 0) >= 9);
  assert.ok((secondGame.surpriseFactor ?? 10) <= 1.5);
});

test("computeSurpriseFactorForGame rewards road upsets and punishes short-handed mismatches", () => {
  const upset = createExpectedPromptGame("m-1");
  upset.finalMargin = 2;
  upset.neutral = false;
  upset.quarterFacts.periods.push({
    awayScore: 11,
    homeScore: 8,
    label: "overtime",
    margin: 3,
    period: 5,
    winningSide: "away",
  });
  upset.teams.away.conferencePosition = 7;
  upset.teams.away.gdp = {
    focus: "Inside.hit",
  };
  upset.teams.away.ratingTotal = 59.9;
  upset.teams.away.recordEnteringGame = "7-8";
  upset.teams.away.score = 93;
  upset.teams.home.conferencePosition = 1;
  upset.teams.home.gdp = {
    focus: "Inside.miss",
  };
  upset.teams.home.ratingTotal = 68.4;
  upset.teams.home.recordEnteringGame = "14-1";
  upset.teams.home.score = 90;

  const dud = createExpectedPromptGame("m-2");
  dud.finalMargin = 24;
  dud.teams.away.conferencePosition = 8;
  dud.teams.away.foulTroubleLimitationCount = 1;
  dud.teams.away.keyAbsenceCount = 2;
  dud.teams.away.ratingTotal = 59.1;
  dud.teams.away.recentSignalFlags = ["possible_strategic_deemphasis"];
  dud.teams.away.recordEnteringGame = "3-12";
  dud.teams.away.score = 74;
  dud.teams.home.conferencePosition = 1;
  dud.teams.home.gdp = {
    focus: "Balanced.hit",
  };
  dud.teams.home.ratingTotal = 67.5;
  dud.teams.home.recordEnteringGame = "14-1";
  dud.teams.home.score = 98;

  const upsetScore = __testing.computeSurpriseFactorForGame(upset);
  const dudScore = __testing.computeSurpriseFactorForGame(dud);

  assert.ok(upsetScore > dudScore);
  assert.ok(upsetScore >= 8.5);
  assert.ok(dudScore <= 1);
});

test("validateGameDayRecapResult rejects tied-quarter outscore claims", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.teams.home.name = "LA";
  expectedGame.teams.away.name = "Stark Contrast";
  expectedGame.quarterFacts.periods[2] = {
    awayScore: 24,
    homeScore: 24,
    label: "3rd quarter",
    margin: 0,
    period: 3,
    winningSide: "tie",
  };

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "LA finds the late answers",
              matchId: "m-1",
              writeup:
                "The decisive third quarter saw LA outscore Stark Contrast 24-24 before pulling away in the fourth as the game finally tilted for good in the closing minutes.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede:
              "A single game delivered enough swing to create a full recap while the late push finally settled matters for the home side.",
          },
        },
        [expectedGame],
      ),
    /tied 24-24/i,
  );
});

test("validateGameDayRecapResult rejects wrong-team quarter winners", () => {
  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Home loses control of the middle stretch",
              matchId: "m-1",
              writeup:
                "Home won the third quarter 22-20 and briefly looked ready to flip the night, but Away kept the finish calm enough to close out the result anyway.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede:
              "One matchup turned on the middle stretch before the winner still found a way to control the late possessions and finish the job.",
          },
        },
        [createExpectedPromptGame("m-1")],
      ),
    /actually won it/i,
  );
});

test("validateGameDayRecapResult rejects postgame record and streak mismatches", () => {
  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["winning_streak"],
              headline: "Home keeps the run going",
              matchId: "m-1",
              writeup:
                "Home (12-3) moved to W3 with a composed finish, keeping Away at arm's length in the closing minutes and never letting the margin fully evaporate once the lead settled in.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede:
              "A composed closing stretch protected the lead and preserved the control the eventual winner built over the course of the night.",
          },
        },
        [createExpectedPromptGame("m-1")],
      ),
    /12-3|W3/i,
  );
});

test("removeInvalidWriteupSentences drops only the contradicted sentence", () => {
  const trimmedGame = __testing.removeInvalidWriteupSentences(
    {
      evidenceTags: ["recent_form"],
      headline: "Home stays in charge",
      matchId: "m-1",
      writeup:
        "Home finished the game at 12-3. Away still pushed late, but Home kept enough control to finish the win without giving the lead away.",
    },
    [
      {
        feedback: "For match m-1, Home's postgame record is 13-3. Do not use 12-3.",
        field: "writeup",
        kind: "record_mismatch",
        matchId: "m-1",
        reason: "Home was said to be 12-3 instead of 13-3.",
        salvage: "patch_or_remove",
        sentence: "Home finished the game at 12-3.",
        sentenceIndex: 0,
        teamSide: "home",
      },
    ],
  );

  assert.equal(
    trimmedGame?.writeup,
    "Away still pushed late, but Home kept enough control to finish the win without giving the lead away.",
  );
});

test("validateGameDayRecapResult allows explicit entering-game trivia", () => {
  const result = __testing.validateGameDayRecapResult(
    {
      games: [
        {
          evidenceTags: ["winning_streak"],
          headline: "Home stays in charge",
          matchId: "m-1",
          writeup:
            "Home entered the game at 12-3 on W3, then finished with enough late composure to keep Away from turning the final possessions into a real swing.",
        },
      ],
      summary: {
        headline: "League roundup",
        lede:
          "The winner had strong pregame form, but the recap still centered on a late stretch that kept the result under control to the horn.",
      },
    },
    [createExpectedPromptGame("m-1")],
  );

  assert.equal(result.games[0]?.matchId, "m-1");
});
