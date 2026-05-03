import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  assertSupportedBedrockRecapModel,
  processGameDayRecap,
  processLeagueGameDayPerformances,
  processLeagueGameDayRecap,
  processSingleGameSummary,
  submitGameDayRecap,
  submitLeagueGameDayPerformances,
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

const DEFAULT_RECAP_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const PREMIUM_RECAP_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const DEFAULT_RECAP_RETRY_MODEL_ID =
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const PREMIUM_RECAP_RETRY_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const DEFAULT_RECAP_JUDGE_MODEL_ID =
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const PREMIUM_RECAP_JUDGE_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

function createRecapEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    AWS_REGION: "us-east-1",
    GAME_DAY_RECAP_JUDGE_MODEL_ID: DEFAULT_RECAP_JUDGE_MODEL_ID,
    GAME_DAY_RECAP_JUDGE_MODEL_ID_PREMIUM: PREMIUM_RECAP_JUDGE_MODEL_ID,
    GAME_DAY_RECAP_MODEL_ID: DEFAULT_RECAP_MODEL_ID,
    GAME_DAY_RECAP_RETRY_MODEL_ID: DEFAULT_RECAP_RETRY_MODEL_ID,
    GAME_DAY_RECAP_RETRY_MODEL_ID_PREMIUM: PREMIUM_RECAP_RETRY_MODEL_ID,
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

function createStandings(
  season = 64,
  leagueId = "100",
  brackets: BBApiStandings["brackets"] = [],
): BBApiStandings {
  return {
    brackets,
    conferences: [
      {
        index: 0,
        teams: [
          createStandingTeam({
            id: "A",
            losses: 4,
            teamName: "Alpha",
            wins: 12,
          }),
          createStandingTeam({
            id: "B",
            losses: 5,
            teamName: "Beta",
            wins: 11,
          }),
        ],
      },
      {
        index: 1,
        teams: [
          createStandingTeam({
            id: "C",
            losses: 6,
            teamName: "Gamma",
            wins: 10,
          }),
          createStandingTeam({
            id: "D",
            losses: 7,
            teamName: "Delta",
            wins: 9,
          }),
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
    NonNullable<
      BBApiBoxScore["awayTeam"]
    >["players"][number]["performanceStats"]
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
    NonNullable<
      BBApiBoxScore["awayTeam"]
    >["players"][number]["performanceStats"]
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
  endTime?: string;
  homeScore: number;
  homeTeamId: string;
  homeTeamName: string;
  matchId: string;
  startTime?: string;
  type?: string;
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
    endTime: args.endTime ?? "2026-03-15T21:00:00Z",
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
    startTime: args.startTime ?? "2026-03-15T19:00:00Z",
    type: args.type ?? "League",
    version: "1",
  };
}

function createPublicPlayByPlay(args: {
  events?: Array<Record<string, unknown>>;
  matchId: string;
}) {
  const numericMatchId = Number.parseInt(args.matchId.replace(/\D/g, ""), 10);
  return {
    events: args.events ?? [
      {
        awayScore: 0,
        homeScore: 0,
        id: -1,
        isScoringPlay: false,
        quarter: 1,
        type: "QUARTER_HEADER",
        wallClock: 0,
      },
      {
        awayScore: 2,
        clock: "11:40",
        eventText: "Beta opened the scoring.",
        homeScore: 0,
        id: 1,
        isScoringPlay: true,
        quarter: 1,
        type: "WING",
        wallClock: 10,
      },
      {
        awayScore: 2,
        clock: "11:05",
        eventText: "Alpha answered to tie it.",
        homeScore: 2,
        id: 2,
        isScoringPlay: true,
        quarter: 1,
        type: "STRONG",
        wallClock: 20,
      },
      {
        awayScore: 4,
        clock: "08:10",
        eventText: "Beta nudged back in front.",
        homeScore: 2,
        id: 3,
        isScoringPlay: true,
        quarter: 2,
        type: "WING",
        wallClock: 30,
      },
      {
        awayScore: 4,
        clock: "00:30",
        eventText: "Alpha tied it late.",
        homeScore: 4,
        id: 4,
        isScoringPlay: true,
        quarter: 4,
        type: "WING",
        wallClock: 40,
      },
      {
        awayScore: 4,
        clock: "00:10",
        eventText: "Alpha answered for the lead.",
        homeScore: 6,
        id: 5,
        isScoringPlay: true,
        quarter: 4,
        type: "STRONG",
        wallClock: 50,
      },
    ],
    matchId: Number.isFinite(numericMatchId) ? numericMatchId : 1,
  };
}

function createExpectedPromptGame(matchId: string) {
  return {
    effortDelta: 0,
    effortSummary: null,
    gameDayPrepSummaries: [],
    requiredContextSentences: [],
    rotationSummaries: [],
    evidenceSignals: [],
    finalMargin: 4,
    gameScoringContext: null,
    matchId,
    neutral: false,
    playByPlayFacts: null,
    playByPlaySummaryLines: [],
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
    seriesContext: undefined,
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
        ratingValues: createCompleteTeamRatings(12.2),
        recentAverageMargin: 5,
        recentSignalFlags: [],
        record: "10-6",
        recordEnteringGame: "10-5",
        score: 81,
        streak: "L1",
        streakEnteringGame: "W2",
        turnovers: 13,
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
        ratingValues: createCompleteTeamRatings(11.4),
        recentAverageMargin: 7,
        recentSignalFlags: [],
        record: "13-3",
        recordEnteringGame: "12-3",
        score: 85,
        streak: "W4",
        streakEnteringGame: "W3",
        turnovers: 9,
        topPlayers: [],
      },
    },
    type: "League",
  };
}

function createRecapBoxScoreStats(
  overrides: Partial<{
    assists: number | null;
    fieldGoalsAttempted: number | null;
    fieldGoalsMade: number | null;
    freeThrowsAttempted: number | null;
    freeThrowsMade: number | null;
    offensiveRebounds: number | null;
    personalFouls: number | null;
    rebounds: number | null;
    threePointersAttempted: number | null;
    threePointersMade: number | null;
  }> = {},
) {
  return {
    assists: null,
    fieldGoalsAttempted: null,
    fieldGoalsMade: null,
    freeThrowsAttempted: null,
    freeThrowsMade: null,
    offensiveRebounds: null,
    personalFouls: null,
    rebounds: null,
    threePointersAttempted: null,
    threePointersMade: null,
    ...overrides,
  };
}

function createPlayoffSeriesMatch(args: {
  awayId: string;
  awayName: string;
  awayScore: number | null;
  homeId: string;
  homeName: string;
  homeScore: number | null;
  id: string;
  startTime: string;
  type: string;
}) {
  return {
    awayTeam: {
      id: args.awayId,
      score: args.awayScore,
      teamName: args.awayName,
    },
    homeTeam: {
      id: args.homeId,
      score: args.homeScore,
      teamName: args.homeName,
    },
    id: args.id,
    startTime: args.startTime,
    type: args.type,
  };
}

function createSingleGameRecapPayload(matchId = "m-1") {
  const games = [createExpectedPromptGame(matchId)];
  const request = {
    gameDate: "2026-03-15",
    gameDayNumber: null,
    generationApproach: "FACT_LIBRARY_FIRST" as const,
    interviewIntensity: "pg13" as const,
    kind: "SINGLE_GAME" as const,
    label: `Match ${matchId}`,
    leagueId: "100",
    leagueName: "Elite League",
    matchId,
    season: 64,
    timeZone: "America/New_York",
  };

  return {
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: games,
      request,
    }),
    games,
    request,
  };
}

function refreshPayloadFactStore(
  payload: ReturnType<typeof createSingleGameRecapPayload>,
) {
  payload.factStore = __testing.buildGameDayRecapJudgeFactStore({
    expectedGames: payload.games,
    request: payload.request,
  });
  return payload;
}

function createBuzzerBeaterPlayByPlayFacts(args?: {
  awayScore?: number;
  awayTeamName?: string;
  homeScore?: number;
  homeTeamName?: string;
}) {
  const awayScore = args?.awayScore ?? 86;
  const awayTeamName = args?.awayTeamName ?? "Away";
  const homeScore = args?.homeScore ?? 88;
  const homeTeamName = args?.homeTeamName ?? "Home";

  return {
    bestCompetitiveSwingRun: {
      endAwayScore: 0,
      endClock: null,
      endMarginFromTeamPerspective: 0,
      endedBy: null,
      endHomeScore: 0,
      endQuarter: null,
      marginSwing: 0,
      netMargin: 0,
      opponentPoints: 0,
      runType: "swing" as const,
      startAwayScore: 0,
      startClock: null,
      startMarginFromTeamPerspective: 0,
      startHomeScore: 0,
      startQuarter: null,
      teamName: null,
      teamPoints: 0,
      teamSide: null,
    },
    endingFacts: {
      decisiveScore: {
        awayScore,
        clock: "00:00",
        createdWinningMargin: true,
        eventText: `${homeTeamName} wins it at the horn.`,
        explicitBuzzerBeater: true,
        homeScore,
        isBuzzerBeater: true,
        isWalkOff: true,
        momentType: "go_ahead" as const,
        points: 2,
        quarter: 4,
        scoringTeamName: homeTeamName,
        scoringTeamSide: "home" as const,
      },
      opponentLastChance: null,
    },
    lateGameMoments: [
      {
        awayScore,
        clock: "00:16",
        eventText: `${homeTeamName} ties it.`,
        homeScore: awayScore,
        momentType: "tie" as const,
        quarter: 4,
        scoringTeamName: homeTeamName,
        scoringTeamSide: "home" as const,
      },
      {
        awayScore,
        clock: "00:00",
        eventText: `${homeTeamName} wins it at the horn.`,
        homeScore,
        momentType: "go_ahead" as const,
        quarter: 4,
        scoringTeamName: homeTeamName,
        scoringTeamSide: "home" as const,
      },
    ],
    largestLead: {
      points: 8,
      teamName: awayTeamName,
      teamSide: "away" as const,
    },
    leadChangeCount: 3,
    leadChangeFacts: {
      bigComebackLeadChange: null,
      highVolumeLeadChangeGame: {
        leadChangeCount: 3,
        qualifies: false,
      },
      rapidLeadChangeBurst: null,
    },
    longestUnansweredRun: {
      endAwayScore: awayScore,
      endClock: "00:00",
      endMarginFromTeamPerspective: homeScore - awayScore,
      endedBy: "game_end" as const,
      endHomeScore: homeScore,
      endQuarter: 4,
      marginSwing: 9,
      netMargin: 9,
      opponentPoints: 0,
      runType: "unanswered" as const,
      startAwayScore: awayScore,
      startClock: "01:10",
      startMarginFromTeamPerspective: homeScore - awayScore - 9,
      startHomeScore: homeScore - 9,
      startQuarter: 4,
      teamName: homeTeamName,
      teamPoints: 9,
      teamSide: "home" as const,
    },
    primaryRun: null,
    secondaryRun: null,
    summaryLines: [
      `${homeTeamName} won it on a buzzerbeater, going ahead ${homeScore}-${awayScore} at the buzzer in the 4th quarter.`,
    ],
    winnerComebackDeficit: 8,
  };
}

function createRunFact(args: {
  endAwayScore: number;
  endClock: string;
  endHomeScore: number;
  endQuarter: number;
  opponentPoints: number;
  runType: "swing" | "unanswered";
  startAwayScore: number;
  startClock: string;
  startHomeScore: number;
  startQuarter: number;
  teamName: string;
  teamPoints: number;
  teamSide: "away" | "home";
}) {
  const startGameSeconds = gameSecondsForTestClock(
    args.startQuarter,
    args.startClock,
  );
  const endGameSeconds = gameSecondsForTestClock(args.endQuarter, args.endClock);
  const elapsedSeconds = Math.max(0, endGameSeconds - startGameSeconds);
  const startTeamScore =
    args.teamSide === "home" ? args.startHomeScore : args.startAwayScore;
  const startOpponentScore =
    args.teamSide === "home" ? args.startAwayScore : args.startHomeScore;
  const endTeamScore =
    args.teamSide === "home" ? args.endHomeScore : args.endAwayScore;
  const endOpponentScore =
    args.teamSide === "home" ? args.endAwayScore : args.endHomeScore;
  return {
    endAwayScore: args.endAwayScore,
    endClock: args.endClock,
    endGameSeconds,
    endMarginFromTeamPerspective:
      args.teamSide === "home"
        ? args.endHomeScore - args.endAwayScore
        : args.endAwayScore - args.endHomeScore,
    endedBy: "game_end" as const,
    endHomeScore: args.endHomeScore,
    endQuarter: args.endQuarter,
    endScore: {
      away: args.endAwayScore,
      home: args.endHomeScore,
      opponent: endOpponentScore,
      team: endTeamScore,
    },
    elapsedMinutesFloor: Math.floor(elapsedSeconds / 60),
    elapsedSeconds,
    marginSwing:
      (args.teamSide === "home"
        ? args.endHomeScore - args.endAwayScore
        : args.endAwayScore - args.endHomeScore) -
      (args.teamSide === "home"
        ? args.startHomeScore - args.startAwayScore
        : args.startAwayScore - args.startHomeScore),
    netMargin: args.teamPoints - args.opponentPoints,
    opponentPoints: args.opponentPoints,
    periodSpan: {
      endQuarter: args.endQuarter,
      quarterCount: Math.abs(args.endQuarter - args.startQuarter) + 1,
      spansMultiplePeriods: args.endQuarter !== args.startQuarter,
      startQuarter: args.startQuarter,
    },
    runType: args.runType,
    startAwayScore: args.startAwayScore,
    startClock: args.startClock,
    startGameSeconds,
    startMarginFromTeamPerspective:
      args.teamSide === "home"
        ? args.startHomeScore - args.startAwayScore
        : args.startAwayScore - args.startHomeScore,
    startHomeScore: args.startHomeScore,
    startQuarter: args.startQuarter,
    startScore: {
      away: args.startAwayScore,
      home: args.startHomeScore,
      opponent: startOpponentScore,
      team: startTeamScore,
    },
    teamName: args.teamName,
    teamPoints: args.teamPoints,
    teamSide: args.teamSide,
  };
}

function gameSecondsForTestClock(quarter: number, clock: string): number {
  const [minutesText, secondsText] = clock.split(":");
  const periodSeconds = quarter <= 4 ? 12 * 60 : 5 * 60;
  const periodOffset =
    quarter <= 4
      ? (quarter - 1) * 12 * 60
      : 4 * 12 * 60 + (quarter - 5) * 5 * 60;
  const remainingSeconds =
    Number.parseInt(minutesText ?? "0", 10) * 60 +
    Number.parseInt(secondsText ?? "0", 10);
  return periodOffset + Math.max(0, periodSeconds - remainingSeconds);
}

function createEmptyRunFact(runType: "swing" | "unanswered") {
  return {
    endAwayScore: 0,
    endClock: null,
    endGameSeconds: null,
    endMarginFromTeamPerspective: 0,
    endedBy: null,
    endHomeScore: 0,
    endQuarter: null,
    endScore: {
      away: 0,
      home: 0,
      opponent: null,
      team: null,
    },
    elapsedMinutesFloor: null,
    elapsedSeconds: null,
    marginSwing: 0,
    netMargin: 0,
    opponentPoints: 0,
    periodSpan: {
      endQuarter: null,
      quarterCount: null,
      spansMultiplePeriods: false,
      startQuarter: null,
    },
    runType,
    startAwayScore: 0,
    startClock: null,
    startGameSeconds: null,
    startMarginFromTeamPerspective: 0,
    startHomeScore: 0,
    startQuarter: null,
    startScore: {
      away: 0,
      home: 0,
      opponent: null,
      team: null,
    },
    teamName: null,
    teamPoints: 0,
    teamSide: null,
  };
}

function createBackAndForthPlayByPlayFacts() {
  return {
    bestCompetitiveSwingRun: createEmptyRunFact("swing"),
    endingFacts: {
      decisiveScore: null,
      opponentLastChance: null,
    },
    lateGameMoments: [],
    largestLead: {
      points: 6,
      teamName: "Away",
      teamSide: "away" as const,
    },
    leadChangeCount: 10,
    leadChangeFacts: {
      bigComebackLeadChange: null,
      highVolumeLeadChangeGame: {
        leadChangeCount: 10,
        qualifies: true,
      },
      rapidLeadChangeBurst: {
        endClock: "00:55",
        endQuarter: 4,
        leadChangeCount: 4,
        startClock: "01:50",
        startQuarter: 4,
      },
    },
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    primaryRun: null,
    secondaryRun: null,
    summaryLines: [
      "The lead changed hands 4 times from 01:50 left in the 4th quarter to 00:55 left in the 4th quarter.",
      "The game featured 10 lead changes.",
    ],
    winnerComebackDeficit: null,
  };
}

function createRecapCandidateResult(args: {
  headline: string;
  matchId?: string;
  writeup: string;
}) {
  return {
    games: [
      {
        evidenceTags: ["recent_form"],
        headline: args.headline,
        matchId: args.matchId ?? "m-1",
        writeup: args.writeup,
      },
    ],
    summary: {
      headline: "Elite League roundup",
      lede: "A single-game candidate keeps the test surface focused on factuality and selection behavior.",
    },
  };
}

function isStylePolishPayloadForTest(payload: unknown): payload is {
  recapGame: {
    writeup: string;
  };
  task: "style_polish";
} {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    "task" in payload &&
    (payload as { task?: unknown }).task === "style_polish",
  );
}

function isPostgameInterviewPayloadForTest(payload: unknown): payload is {
  candidate: {
    playerName: string;
    statLine: {
      assists: number;
      points: number;
      rebounds: number;
    };
    teamName: string;
    teamSide: "away" | "home";
  };
  task: "postgame_interview";
} {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    "task" in payload &&
    (payload as { task?: unknown }).task === "postgame_interview",
  );
}

function isMainRecapWriterPayloadForTest(payload: unknown): payload is {
  games: Array<{
    matchId: string;
    playByPlayFacts?: unknown;
    playByPlaySummaryLines: string[];
    teams: {
      away: { name: string };
      home: { name: string };
    };
  }>;
} {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    "games" in payload &&
    Array.isArray((payload as { games?: unknown }).games),
  );
}

function buildTestInterviewStatSummary(candidate: {
  statLine: {
    assists: number;
    points: number;
    rebounds: number;
  };
}): string {
  const parts: string[] = [];
  if (candidate.statLine.points >= 16) {
    parts.push("steady scoring pressure");
  }
  if (candidate.statLine.rebounds >= 6) {
    parts.push("work on the glass");
  }
  if (candidate.statLine.assists >= 4) {
    parts.push("useful creation");
  }

  if (parts.length === 0) {
    return "energy on both ends";
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  if (parts.length === 2) {
    return `${parts[0]!} and ${parts[1]!}`;
  }

  return `${parts[0]!}, ${parts[1]!}, and ${parts[2]!}`;
}

function maybeHandleAuxiliaryWriterPayloadForTest(payload: unknown): {
  handled: true;
  response: unknown;
} | null {
  if (isStylePolishPayloadForTest(payload)) {
    return {
      handled: true,
      response: {
        writeup: payload.recapGame.writeup,
      },
    };
  }

  if (isPostgameInterviewPayloadForTest(payload)) {
    return {
      handled: true,
      response: {
        playerName: payload.candidate.playerName,
        qa: [
          {
            answer: `I just tried to keep ${payload.candidate.teamName} steady with ${buildTestInterviewStatSummary(payload.candidate)} and make the right simple play.`,
            question: "What did the game feel like once it started opening up?",
          },
          {
            answer:
              "If momentum had paperwork, I think we stamped it with a smile and kept moving.",
            question:
              "If tonight's momentum had to file paperwork, what would it list as its occupation?",
          },
        ],
        teamName: payload.candidate.teamName,
        teamSide: payload.candidate.teamSide,
        title: `${payload.candidate.playerName} on ${payload.candidate.teamName}'s win`,
      },
    };
  }

  return null;
}

function createJudgeCandidateAssessment(args: {
  candidateIndex: number;
  headline: string;
  headlineContainsOutcomeClaim?: boolean;
  headlineContradictionType?:
    | "ending"
    | "final_score"
    | "lead_change"
    | "none"
    | "other"
    | "overtime"
    | "quarter_outcome"
    | "record"
    | "run"
    | "series_state"
    | "winner";
  headlineNotes?: string | null;
  headlineSourceField?: string | null;
  headlineVerdict?: "supported" | "style_only" | "uncertain" | "unsupported";
  interestingnessScore?: number;
  matchId?: string;
  writeup: string;
  writeupContainsOutcomeClaim?: boolean;
  writeupContradictionType?:
    | "ending"
    | "final_score"
    | "lead_change"
    | "none"
    | "other"
    | "overtime"
    | "quarter_outcome"
    | "record"
    | "run"
    | "series_state"
    | "winner";
  writeupNotes?: string | null;
  writeupSourceField?: string | null;
  writeupVerdict?: "supported" | "style_only" | "uncertain" | "unsupported";
}) {
  const matchId = args.matchId ?? "m-1";
  const writeupSentences = splitJudgeTestSentences(args.writeup);
  return {
    candidateIndex: args.candidateIndex,
    interestingnessScore: args.interestingnessScore ?? 5,
    sentenceVerdicts: Object.fromEntries([
      [
        buildJudgeSentenceKeyForTest({
          field: "headline",
          matchId,
          sentenceIndex: 0,
        }),
        {
          containsOutcomeClaim: args.headlineContainsOutcomeClaim ?? true,
          contradictionType: args.headlineContradictionType ?? "none",
          notes: args.headlineNotes ?? "",
          sourceField: args.headlineSourceField ?? "teams.home.score",
          verdict: args.headlineVerdict ?? "supported",
        },
      ],
      ...writeupSentences.map((_sentence, sentenceIndex) => [
        buildJudgeSentenceKeyForTest({
          field: "writeup",
          matchId,
          sentenceIndex,
        }),
        {
          containsOutcomeClaim: args.writeupContainsOutcomeClaim ?? false,
          contradictionType: args.writeupContradictionType ?? "none",
          notes: args.writeupNotes ?? "",
          sourceField:
            args.writeupSourceField ?? "quarterFacts.fourthQuarterOutcome",
          verdict: args.writeupVerdict ?? "supported",
        },
      ]),
    ]),
  };
}

function splitJudgeTestSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildJudgeSentenceKeyForTest(args: {
  field: "headline" | "postgameInterview" | "writeup";
  matchId: string;
  sentenceIndex: number;
}) {
  return `${args.matchId}:${args.field}:${args.sentenceIndex}`;
}

function createSupportedJudgeVerdictRecord(args?: {
  containsOutcomeClaim?: boolean;
  contradictionType?:
    | "ending"
    | "final_score"
    | "lead_change"
    | "none"
    | "other"
    | "overtime"
    | "quarter_outcome"
    | "record"
    | "run"
    | "series_state"
    | "winner";
  notes?: string | null;
  sourceField?: string | null;
  verdict?: "supported" | "style_only" | "uncertain" | "unsupported";
}) {
  return {
    containsOutcomeClaim: args?.containsOutcomeClaim ?? false,
    contradictionType: args?.contradictionType ?? "none",
    notes: args?.notes ?? "",
    sourceField: args?.sourceField ?? "factStore.games[0]",
    verdict: args?.verdict ?? "supported",
  };
}

const JUDGE_TEST_SENTENCE_METADATA = Symbol("judgeTestSentenceMetadata");

function createSupportedJudgeResponseFromPayload(payload: {
  candidateIndex?: number;
  gameFacts?: {
    matchId: string;
  };
  games?: unknown;
  judgeKind: "candidate_interestingness" | "sentence_factuality";
  result?: unknown;
  sentenceChunk?: Array<{
    field: "headline" | "postgameInterview" | "writeup";
    sentence: string;
    sentenceIndex: number;
    slotId: string;
  }>;
}) {
  if (payload.judgeKind === "candidate_interestingness") {
    return {
      candidateIndex: payload.candidateIndex ?? 0,
      interestingnessScore: 5,
    };
  }

  const matchId = payload.gameFacts?.matchId ?? "m-1";
  const sentenceMetadata = Object.fromEntries(
    (payload.sentenceChunk ?? []).map((entry) => [
      entry.slotId,
      {
        candidateIndex: payload.candidateIndex ?? 0,
        sentenceKey: buildJudgeSentenceKeyForTest({
          field: entry.field,
          matchId,
          sentenceIndex: entry.sentenceIndex,
        }),
      },
    ]),
  );
  const response = {
    slotVerdicts: Object.fromEntries(
      (payload.sentenceChunk ?? []).map((entry) => [
        entry.slotId,
        createSupportedJudgeVerdictRecord({
          sourceField:
            entry.field === "postgameInterview"
              ? "gameFacts.postgameInterviewCandidate"
              : "gameFacts",
        }),
      ]),
    ),
  };
  Object.defineProperty(response, JUDGE_TEST_SENTENCE_METADATA, {
    enumerable: false,
    value: sentenceMetadata,
  });
  return response;
}

function createInterestingnessJudgeResponseFromPayload(args: {
  candidateIndex?: number;
  interestingnessScore: number;
}) {
  return {
    candidateIndex: args.candidateIndex ?? 0,
    interestingnessScore: args.interestingnessScore,
  };
}

function mapJudgeResponseSentenceVerdicts(
  response: ReturnType<typeof createSupportedJudgeResponseFromPayload>,
  mapper: (args: {
    candidateIndex: number;
    sentenceKey: string;
    verdict: {
      containsOutcomeClaim: boolean;
      contradictionType:
        | "ending"
        | "final_score"
        | "lead_change"
        | "none"
        | "other"
        | "overtime"
        | "quarter_outcome"
        | "record"
        | "run"
        | "series_state"
        | "winner";
      notes: string | null;
      sourceField: string | null;
      verdict: "supported" | "style_only" | "uncertain" | "unsupported";
    };
  }) => {
    containsOutcomeClaim: boolean;
    contradictionType:
      | "ending"
      | "final_score"
      | "lead_change"
      | "none"
      | "other"
      | "overtime"
      | "quarter_outcome"
      | "record"
      | "run"
      | "series_state"
      | "winner";
    notes: string | null;
    sourceField: string | null;
    verdict: "supported" | "style_only" | "uncertain" | "unsupported";
  },
) {
  if (!("slotVerdicts" in response)) {
    return response;
  }

  const sentenceMetadata = (response as Record<PropertyKey, unknown>)[
    JUDGE_TEST_SENTENCE_METADATA
  ] as
    | Record<string, { candidateIndex: number; sentenceKey: string }>
    | undefined;
  const mappedResponse = {
    slotVerdicts: Object.fromEntries(
      Object.entries(response.slotVerdicts).map(([slotId, verdict]) => [
        slotId,
        mapper({
          candidateIndex: sentenceMetadata?.[slotId]?.candidateIndex ?? 0,
          sentenceKey: sentenceMetadata?.[slotId]?.sentenceKey ?? slotId,
          verdict,
        }),
      ]),
    ),
  };
  Object.defineProperty(mappedResponse, JUDGE_TEST_SENTENCE_METADATA, {
    enumerable: false,
    value: sentenceMetadata ?? {},
  });
  return mappedResponse;
}

function createPassingJudgeProvider(args?: {
  generate?: (payload: {
    candidateIndex?: number;
    gameFacts?: {
      matchId: string;
    };
    games?: unknown;
    judgeKind: "candidate_interestingness" | "sentence_factuality";
    result?: unknown;
    sentenceChunk?: Array<{
      field: "headline" | "postgameInterview" | "writeup";
      sentence: string;
      sentenceIndex: number;
      slotId: string;
    }>;
  }) => unknown | Promise<unknown>;
}) {
  return {
    generate: async (payload: {
      candidateIndex?: number;
      gameFacts?: {
        matchId: string;
      };
      games?: unknown;
      judgeKind: "candidate_interestingness" | "sentence_factuality";
      result?: unknown;
      sentenceChunk?: Array<{
        field: "headline" | "postgameInterview" | "writeup";
        sentence: string;
        sentenceIndex: number;
        slotId: string;
      }>;
    }) =>
      args?.generate
        ? args.generate(payload)
        : createSupportedJudgeResponseFromPayload(payload),
    modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
    providerName: "bedrock" as const,
    stage: "judge" as const,
  };
}

function createUsageAwareProvider(args: {
  generate?: (payload: unknown) => unknown | Promise<unknown>;
  modelId: string;
  stage: "judge" | "retry_writer" | "writer";
  usage: {
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
    inputTokens: number;
    outputTokens: number;
    requestCount: number;
    totalTokens: number;
  };
}) {
  return {
    generate: async (payload: unknown) => {
      if (args.generate) {
        return args.generate(payload);
      }

      throw new Error("unexpected generate call");
    },
    getUsageSummary: () => ({
      cacheReadInputTokens: args.usage.cacheReadInputTokens ?? 0,
      cacheWriteInputTokens: args.usage.cacheWriteInputTokens ?? 0,
      inputTokens: args.usage.inputTokens,
      modelId: args.modelId,
      outputTokens: args.usage.outputTokens,
      providerName: "bedrock" as const,
      requestCount: args.usage.requestCount,
      stage: args.stage,
      totalTokens: args.usage.totalTokens,
    }),
    modelId: args.modelId,
    providerName: "bedrock" as const,
    stage: args.stage,
  };
}

async function judgeSingleGameResult(args: {
  assessment: ReturnType<typeof createJudgeCandidateAssessment>;
  expectedGame?: ReturnType<typeof createExpectedPromptGame>;
  result: ReturnType<typeof createRecapCandidateResult>;
}) {
  const expectedGame = args.expectedGame ?? createExpectedPromptGame("m-1");
  const request = createSingleGameRecapPayload(expectedGame.matchId).request;
  return __testing.judgeGameDayRecapResult({
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [expectedGame],
      request,
    }),
    provider: {
      generate: async (payload) => {
        if (payload.judgeKind === "candidate_interestingness") {
          return {
            candidateIndex: 0,
            interestingnessScore: args.assessment.interestingnessScore,
          };
        }

        const matchId = payload.gameFacts.matchId;
        return {
          slotVerdicts: Object.fromEntries(
            payload.sentenceChunk.map((entry) => [
              entry.slotId,
              args.assessment.sentenceVerdicts[
                buildJudgeSentenceKeyForTest({
                  field: entry.field,
                  matchId,
                  sentenceIndex: entry.sentenceIndex,
                })
              ] ?? createSupportedJudgeVerdictRecord(),
            ]),
          ),
        };
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    result: __testing.validateGameDayRecapResult(args.result, [expectedGame]),
    stage: "writer",
  });
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

  assert.deepStrictEqual(
    __testing.summarizeSeasonDiagnostics(seasons, "2026-03-15"),
    [
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
    ],
  );
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
      createSchedule(
        "A",
        [
          {
            awayTeam: { id: "B", score: 98, teamName: "Beta" },
            homeTeam: { id: "A", score: 114, teamName: "Alpha" },
            id: "137828772",
            startTime: "2026-03-04T01:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
    [
      "B",
      createSchedule(
        "B",
        [
          {
            awayTeam: { id: "B", score: 98, teamName: "Beta" },
            homeTeam: { id: "A", score: 114, teamName: "Alpha" },
            id: "137828772",
            startTime: "2026-03-04T01:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
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

  assert.deepStrictEqual(
    slate.map((game) => game.matchId),
    ["137828772"],
  );
});

test("resolveLeagueGameDaySlate selects the requested regular-season game day", async () => {
  const standings = createStandings(71);
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule(
        "A",
        [
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
        ],
        71,
      ),
    ],
    [
      "B",
      createSchedule(
        "B",
        [
          {
            awayTeam: { id: "B", score: 80, teamName: "Beta" },
            homeTeam: { id: "A", score: 90, teamName: "Alpha" },
            id: "g1",
            startTime: "2026-02-10T00:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
    [
      "C",
      createSchedule(
        "C",
        [
          {
            awayTeam: { id: "A", score: 88, teamName: "Alpha" },
            homeTeam: { id: "C", score: 92, teamName: "Gamma" },
            id: "g2",
            startTime: "2026-02-17T00:00:00Z",
            type: "League",
          },
        ],
        71,
      ),
    ],
    [
      "D",
      createSchedule(
        "D",
        [
          {
            awayTeam: { id: "D", score: 84, teamName: "Delta" },
            homeTeam: { id: "A", score: 102, teamName: "Alpha" },
            id: "g3",
            startTime: "2026-02-24T00:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
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

  assert.deepStrictEqual(
    slate.map((game) => game.matchId),
    ["g3"],
  );
});

test("resolvePlayoffSeriesContext builds the finals opener line from brackets", () => {
  const boxScore = createBoxScore({
    awayScore: 81,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 85,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "f-1",
    startTime: "2026-04-01T19:00:00Z",
    type: "league.final",
  });

  const seriesContext = __testing.resolvePlayoffSeriesContext({
    boxScore,
    requestedGame: {
      awayTeamId: "B",
      awayTeamName: "Beta",
      homeTeamId: "A",
      homeTeamName: "Alpha",
      isScheduleFinal: true,
      matchId: "f-1",
      scheduledAwayScore: 81,
      scheduledHomeScore: 85,
      startTime: "2026-04-01T19:00:00Z",
      type: "league.final",
    },
    standings: createStandings(64, "100", [
      {
        matches: [
          createPlayoffSeriesMatch({
            awayId: "B",
            awayName: "Beta",
            awayScore: 81,
            homeId: "A",
            homeName: "Alpha",
            homeScore: 85,
            id: "f-1",
            startTime: "2026-04-01T19:00:00Z",
            type: "league.final",
          }),
          createPlayoffSeriesMatch({
            awayId: "A",
            awayName: "Alpha",
            awayScore: null,
            homeId: "B",
            homeName: "Beta",
            homeScore: null,
            id: "f-2",
            startTime: "2026-04-05T19:00:00Z",
            type: "league.final",
          }),
        ],
        name: "finals",
      },
    ]),
  });

  assert.ok(seriesContext);
  assert.equal(seriesContext.stageKey, "finals");
  assert.deepStrictEqual(seriesContext.postgameWins, {
    away: 0,
    home: 1,
  });
  assert.equal(seriesContext.isTerminal, false);
  assert.equal(seriesContext.summaryLine, "Alpha leads the series 1-0.");
});

test("resolvePlayoffSeriesContext builds the tied finals line from brackets", () => {
  const boxScore = createBoxScore({
    awayScore: 84,
    awayTeamId: "A",
    awayTeamName: "Alpha",
    homeScore: 90,
    homeTeamId: "B",
    homeTeamName: "Beta",
    matchId: "f-2",
    startTime: "2026-04-05T19:00:00Z",
    type: "league.final",
  });

  const seriesContext = __testing.resolvePlayoffSeriesContext({
    boxScore,
    requestedGame: {
      awayTeamId: "A",
      awayTeamName: "Alpha",
      homeTeamId: "B",
      homeTeamName: "Beta",
      isScheduleFinal: true,
      matchId: "f-2",
      scheduledAwayScore: 90,
      scheduledHomeScore: 84,
      startTime: "2026-04-05T19:00:00Z",
      type: "league.final",
    },
    standings: createStandings(64, "100", [
      {
        matches: [
          createPlayoffSeriesMatch({
            awayId: "B",
            awayName: "Beta",
            awayScore: 81,
            homeId: "A",
            homeName: "Alpha",
            homeScore: 85,
            id: "f-1",
            startTime: "2026-04-01T19:00:00Z",
            type: "league.final",
          }),
          createPlayoffSeriesMatch({
            awayId: "A",
            awayName: "Alpha",
            awayScore: 84,
            homeId: "B",
            homeName: "Beta",
            homeScore: 90,
            id: "f-2",
            startTime: "2026-04-05T19:00:00Z",
            type: "league.final",
          }),
        ],
        name: "finals",
      },
    ]),
  });

  assert.ok(seriesContext);
  assert.deepStrictEqual(seriesContext.postgameWins, {
    away: 1,
    home: 1,
  });
  assert.equal(seriesContext.summaryLine, "The series is tied 1-1.");
  assert.equal(seriesContext.isTerminal, false);
});

test("resolvePlayoffSeriesContext handles finals clinchers and schedule fallback", () => {
  const finalsGameThree = createBoxScore({
    awayScore: 88,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 93,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "f-3",
    startTime: "2026-04-08T19:00:00Z",
    type: "league.final",
  });
  const finalsSeriesContext = __testing.resolvePlayoffSeriesContext({
    boxScore: finalsGameThree,
    requestedGame: {
      awayTeamId: "B",
      awayTeamName: "Beta",
      homeTeamId: "A",
      homeTeamName: "Alpha",
      isScheduleFinal: true,
      matchId: "f-3",
      scheduledAwayScore: 88,
      scheduledHomeScore: 93,
      startTime: "2026-04-08T19:00:00Z",
      type: "league.final",
    },
    standings: createStandings(64, "100", [
      {
        matches: [
          createPlayoffSeriesMatch({
            awayId: "B",
            awayName: "Beta",
            awayScore: 81,
            homeId: "A",
            homeName: "Alpha",
            homeScore: 85,
            id: "f-1",
            startTime: "2026-04-01T19:00:00Z",
            type: "league.final",
          }),
          createPlayoffSeriesMatch({
            awayId: "A",
            awayName: "Alpha",
            awayScore: 84,
            homeId: "B",
            homeName: "Beta",
            homeScore: 90,
            id: "f-2",
            startTime: "2026-04-05T19:00:00Z",
            type: "league.final",
          }),
          createPlayoffSeriesMatch({
            awayId: "B",
            awayName: "Beta",
            awayScore: 88,
            homeId: "A",
            homeName: "Alpha",
            homeScore: 93,
            id: "f-3",
            startTime: "2026-04-08T19:00:00Z",
            type: "league.final",
          }),
        ],
        name: "finals",
      },
    ]),
  });
  assert.ok(finalsSeriesContext);
  assert.equal(finalsSeriesContext.summaryLine, "Alpha wins the series 2-1.");
  assert.equal(finalsSeriesContext.isTerminal, true);

  const finalsSweep = createBoxScore({
    awayScore: 84,
    awayTeamId: "B",
    awayTeamName: "Beta",
    homeScore: 91,
    homeTeamId: "A",
    homeTeamName: "Alpha",
    matchId: "f-2",
    startTime: "2026-04-05T19:00:00Z",
    type: "league.final",
  });
  const scheduleSeriesContext = __testing.resolvePlayoffSeriesContext({
    awaySchedule: createSchedule("B", [
      createPlayoffSeriesMatch({
        awayId: "B",
        awayName: "Beta",
        awayScore: 81,
        homeId: "A",
        homeName: "Alpha",
        homeScore: 85,
        id: "f-1",
        startTime: "2026-04-01T19:00:00Z",
        type: "league.final",
      }),
      createPlayoffSeriesMatch({
        awayId: "B",
        awayName: "Beta",
        awayScore: 84,
        homeId: "A",
        homeName: "Alpha",
        homeScore: 91,
        id: "f-2",
        startTime: "2026-04-05T19:00:00Z",
        type: "league.final",
      }),
    ]),
    boxScore: finalsSweep,
    homeSchedule: createSchedule("A", [
      createPlayoffSeriesMatch({
        awayId: "B",
        awayName: "Beta",
        awayScore: 81,
        homeId: "A",
        homeName: "Alpha",
        homeScore: 85,
        id: "f-1",
        startTime: "2026-04-01T19:00:00Z",
        type: "league.final",
      }),
      createPlayoffSeriesMatch({
        awayId: "B",
        awayName: "Beta",
        awayScore: 84,
        homeId: "A",
        homeName: "Alpha",
        homeScore: 91,
        id: "f-2",
        startTime: "2026-04-05T19:00:00Z",
        type: "league.final",
      }),
    ]),
    requestedGame: {
      awayTeamId: "B",
      awayTeamName: "Beta",
      homeTeamId: "A",
      homeTeamName: "Alpha",
      isScheduleFinal: true,
      matchId: "f-2",
      scheduledAwayScore: 84,
      scheduledHomeScore: 91,
      startTime: "2026-04-05T19:00:00Z",
      type: "league.final",
    },
    standings: createStandings(64, "100", [
      {
        matches: [
          createPlayoffSeriesMatch({
            awayId: "B",
            awayName: "Beta",
            awayScore: 81,
            homeId: "A",
            homeName: "Alpha",
            homeScore: 85,
            id: "f-1",
            startTime: "2026-04-01T19:00:00Z",
            type: "league.final",
          }),
        ],
        name: "finals",
      },
    ]),
  });

  assert.ok(scheduleSeriesContext);
  assert.equal(scheduleSeriesContext.summaryLine, "Alpha wins the series 2-0.");
  assert.equal(scheduleSeriesContext.isTerminal, true);
});

test("resolvePlayoffSeriesContext handles relegation series and omits one-off rounds", () => {
  const relegationGame = createBoxScore({
    awayScore: 87,
    awayTeamId: "D",
    awayTeamName: "Delta",
    homeScore: 82,
    homeTeamId: "C",
    homeTeamName: "Gamma",
    matchId: "r-2",
    startTime: "2026-04-06T19:00:00Z",
    type: "league.relegationseries",
  });
  const relegationSeriesContext = __testing.resolvePlayoffSeriesContext({
    boxScore: relegationGame,
    requestedGame: {
      awayTeamId: "D",
      awayTeamName: "Delta",
      homeTeamId: "C",
      homeTeamName: "Gamma",
      isScheduleFinal: true,
      matchId: "r-2",
      scheduledAwayScore: 87,
      scheduledHomeScore: 82,
      startTime: "2026-04-06T19:00:00Z",
      type: "league.relegationseries",
    },
    standings: createStandings(64, "100", [
      {
        matches: [
          createPlayoffSeriesMatch({
            awayId: "C",
            awayName: "Gamma",
            awayScore: 79,
            homeId: "D",
            homeName: "Delta",
            homeScore: 88,
            id: "r-1",
            startTime: "2026-04-02T19:00:00Z",
            type: "league.relegationseries",
          }),
          createPlayoffSeriesMatch({
            awayId: "D",
            awayName: "Delta",
            awayScore: 87,
            homeId: "C",
            homeName: "Gamma",
            homeScore: 82,
            id: "r-2",
            startTime: "2026-04-06T19:00:00Z",
            type: "league.relegationseries",
          }),
        ],
        name: "relegation",
      },
    ]),
  });
  assert.equal(
    relegationSeriesContext?.summaryLine,
    "Delta wins the series 2-0.",
  );

  const quarterfinalContext = __testing.resolvePlayoffSeriesContext({
    boxScore: createBoxScore({
      awayScore: 78,
      awayTeamId: "B",
      awayTeamName: "Beta",
      homeScore: 92,
      homeTeamId: "A",
      homeTeamName: "Alpha",
      matchId: "qf-1",
      startTime: "2026-03-20T19:00:00Z",
      type: "league.quarterfinal",
    }),
    requestedGame: {
      awayTeamId: "B",
      awayTeamName: "Beta",
      homeTeamId: "A",
      homeTeamName: "Alpha",
      isScheduleFinal: true,
      matchId: "qf-1",
      scheduledAwayScore: 78,
      scheduledHomeScore: 92,
      startTime: "2026-03-20T19:00:00Z",
      type: "league.quarterfinal",
    },
    standings: createStandings(64, "100", [
      {
        matches: [
          createPlayoffSeriesMatch({
            awayId: "B",
            awayName: "Beta",
            awayScore: 78,
            homeId: "A",
            homeName: "Alpha",
            homeScore: 92,
            id: "qf-1",
            startTime: "2026-03-20T19:00:00Z",
            type: "league.quarterfinal",
          }),
        ],
        name: "quarterfinals",
      },
    ]),
  });

  assert.equal(quarterfinalContext, null);
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
  assert.ok(
    context.recentSignalFlags.includes("possible_strategic_deemphasis"),
  );

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
  assert.ok(
    context.recentSignalFlags.includes("possible_strategic_deemphasis"),
  );
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
    fetchPublicMatchPlayByPlay: async (matchId) =>
      createPublicPlayByPlay({
        matchId: String(matchId),
      }),
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
  assert.ok(firstGame.playByPlayFacts);
  assert.equal(firstGame.playByPlayFacts.leadChangeCount, 1);
  assert.deepStrictEqual(firstGame.playByPlayFacts.endingFacts, {
    decisiveScore: {
      awayScore: 4,
      clock: "00:10",
      createdWinningMargin: true,
      eventText: "Alpha answered for the lead.",
      explicitBuzzerBeater: false,
      homeScore: 6,
      isBuzzerBeater: false,
      isWalkOff: false,
      momentType: "go_ahead",
      points: 2,
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
    opponentLastChance: null,
  });
  assert.deepStrictEqual(firstGame.playByPlayFacts.lateGameMoments, [
    {
      awayScore: 4,
      clock: "00:30",
      eventText: "Alpha tied it late.",
      homeScore: 4,
      momentType: "tie",
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
    {
      awayScore: 4,
      clock: "00:10",
      eventText: "Alpha answered for the lead.",
      homeScore: 6,
      momentType: "go_ahead",
      quarter: 4,
      scoringTeamName: "Alpha",
      scoringTeamSide: "home",
    },
  ]);
  assert.ok(
    firstGame.playByPlaySummaryLines.includes(
      "Late-game swings: Alpha tied it at 4-4 with 00:30 left in the 4th quarter; Alpha went ahead 6-4 with 00:10 left in the 4th quarter.",
    ),
  );
  assert.ok(
    !firstGame.playByPlaySummaryLines.some((line) => /\b6-2 run\b/i.test(line)),
  );
  assert.deepStrictEqual(firstGame.gameDayPrepSummaries, [
    "Alpha prepared well for Inside looks; Beta prepared well for a Balanced attack.",
    "On pace, Alpha prepared well for Fast pace; Beta prepared well for Normal pace.",
  ]);
});

test("buildGameDayRecapPromptPayload projects writer facts from one canonical factStore", async () => {
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
    fetchPublicMatchPlayByPlay: async (matchId) =>
      createPublicPlayByPlay({
        matchId: String(matchId),
      }),
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
      generationApproach: "FACT_LIBRARY_FIRST",
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

  const writerGame = expectPresent(
    payload.games[0],
    "expected writer projection game",
  );
  const factStoreGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  );
  const halftimeState = expectPresent(
    factStoreGame.periodStates.halftime,
    "expected halftime state",
  );
  const throughThreeState = expectPresent(
    factStoreGame.periodStates.throughThreeQuarters,
    "expected through-three state",
  );
  const pointsLeader = expectPresent(
    factStoreGame.playerLeaders.points,
    "expected points leader",
  );
  const reboundsLeader = expectPresent(
    factStoreGame.playerLeaders.rebounds,
    "expected rebounds leader",
  );
  const assistsLeader = expectPresent(
    factStoreGame.playerLeaders.assists,
    "expected assists leader",
  );
  const bestAllAroundLeader = expectPresent(
    factStoreGame.playerLeaders.bestAllAround,
    "expected best all-around leader",
  );
  const interviewCandidate = expectPresent(
    factStoreGame.postgameInterviewCandidate,
    "expected interview candidate",
  );
  const factsLibrary = expectPresent(
    writerGame.factsLibrary,
    "expected facts library projection",
  );

  assert.equal(
    payload.factStore.request.generationApproach,
    "FACT_LIBRARY_FIRST",
  );
  assert.equal(factStoreGame.winner.winnerName, "Alpha");
  assert.equal(factStoreGame.winner.loserName, "Beta");
  assert.equal(factStoreGame.winner.finalScoreHomeAway, "85-81");
  assert.equal(factStoreGame.winner.finalScoreWinnerFacing, "85-81");
  assert.equal(halftimeState.homeScore, 42);
  assert.equal(halftimeState.awayScore, 38);
  assert.equal(halftimeState.leaderName, "Alpha");
  assert.equal(throughThreeState.scoreFromLeaderPerspective, "62-60");
  assert.equal(pointsLeader.playerName, "Ari Away");
  assert.equal(reboundsLeader.playerName, "Hal Home");
  assert.equal(assistsLeader.playerName, "Ari Away");
  assert.equal(bestAllAroundLeader.playerName, "Ari Away");
  assert.equal(
    factStoreGame.teamRatingFacts.away.ratings.outsideScoring?.value,
    12.2,
  );
  assert.equal(
    factStoreGame.teamRatingFacts.home.ratings.outsideDefense?.value,
    10.2,
  );
  assert.equal(
    factStoreGame.teamRatingFacts.comparisons.some(
      (comparison) =>
        (comparison.left.teamName === factStoreGame.teams.away.name &&
          comparison.left.ratingKey === "outsideScoring" &&
          comparison.right.teamName === factStoreGame.teams.home.name &&
          comparison.right.ratingKey === "outsideDefense") ||
        (comparison.left.teamName === factStoreGame.teams.home.name &&
          comparison.left.ratingKey === "outsideDefense" &&
          comparison.right.teamName === factStoreGame.teams.away.name &&
          comparison.right.ratingKey === "outsideScoring"),
    ),
    true,
  );
  assert.equal(factStoreGame.teamTalent.awayTotal, 202);
  assert.equal(factStoreGame.teamTalent.homeTotal, 186);
  assert.match(
    factStoreGame.teamTalent.summary ?? "",
    new RegExp(`${factStoreGame.teams.away.name} .*team talent edge`, "i"),
  );
  assert.equal(writerGame.teamTalent.awayTotal, null);
  assert.equal(writerGame.teamTalent.homeTotal, null);
  assert.match(writerGame.teamTalent.summary ?? "", /team talent edge/i);
  assert.equal(
    writerGame.teamRatingFacts?.away.ratings.outsideScoring?.value,
    12.2,
  );
  assert.equal(interviewCandidate.playerName, "Hal Home");
  assert.equal(interviewCandidate.teamName, "Alpha");
  assert.equal(interviewCandidate.teamSide, "home");
  assert.ok(interviewCandidate.supportedFacts.length >= 1);
  assert.ok(factStoreGame.teams.home.rawRatings);
  assert.equal("rawRatings" in writerGame.teams.home, false);
  assert.equal(writerGame.teams.home.name, factStoreGame.teams.home.name);
  assert.equal(writerGame.teams.home.record, factStoreGame.teams.home.record);
  assert.deepStrictEqual(
    writerGame.playByPlayFacts,
    factStoreGame.playByPlayFacts,
  );
  assert.equal(
    factsLibrary.winner.finalScoreFromWinnerPerspective,
    factStoreGame.winner.finalScoreWinnerFacing,
  );
  assert.equal(factsLibrary.pregameBattle.teams.home.offense.strategy, "Push The Ball");
  assert.equal(
    factsLibrary.pregameBattle.teams.home.offense.displayName,
    "Push the Ball",
  );
  assert.equal(factsLibrary.pregameBattle.teams.home.offense.focus, "balanced");
  assert.equal(factsLibrary.pregameBattle.teams.home.offense.pace, "fast");
  assert.equal(factsLibrary.pregameBattle.teams.away.offense.strategy, "Motion");
  assert.equal(factsLibrary.pregameBattle.teams.away.defense.displayName, "2-3 Zone");
  assert.equal(factsLibrary.pregameBattle.teams.away.offense.focus, "outside");
  assert.equal(
    factsLibrary.pregameBattle.teams.away.defense.profileKey,
    "inside_zone",
  );
  assert.ok(
    factsLibrary.pregameBattle.summaryFacts.some((fact) =>
      /Beta paired Motion with 2-3 Zone, while Alpha answered with Push the Ball and Man-to-man/i.test(
        fact,
      ),
    ),
  );
  assert.ok(
    factsLibrary.rankedFacts.some(
      (fact) =>
        fact.claimKey === "pregame_tactics" &&
        fact.mustMention &&
        /Motion/.test(fact.text) &&
        /Push the Ball/.test(fact.text),
    ),
  );
  assert.ok(
    factsLibrary.rankedFacts.some(
      (fact) =>
        fact.claimKey === "pregame_manager_verdict" &&
        !/\b(?:held the (?:clear )?effort edge|prepared well for)\b/i.test(
          fact.text,
        ),
    ),
  );
  assert.equal(
    expectPresent(
      factsLibrary.periodStates.throughThreeQuarters,
      "expected facts-library through-three state",
    ).scoreFromLeaderPerspective,
    throughThreeState.scoreFromLeaderPerspective,
  );
  const topRankedFact = factsLibrary.rankedFacts[0];
  assert.ok(topRankedFact);
  assert.equal(topRankedFact.category, "ending");
  assert.equal(topRankedFact.impactTier, "high");
  assert.ok(
    factsLibrary.leadFacts.some((fact) => fact.claimKey === "decisive_score"),
  );
  assert.ok(
    factsLibrary.chronologicalFacts.some(
      (fact) => fact.claimKey === "took_lead_for_good",
    ),
  );
  assert.ok(
    factsLibrary.analysisFacts.some((fact) => fact.category === "player"),
  );
  assert.deepStrictEqual(factsLibrary.recapSections.sectionOrder, [
    "pregame",
    "game",
    "postgame",
  ]);
  assert.equal(factsLibrary.recapSections.visibleHeadings, false);
  assert.ok(
    factsLibrary.gameNarrativeBeats.some(
      (beat) => beat.beatType === "closingSequence",
    ),
  );
});

test("buildGameDayRecapPromptPayload surfaces matchup-relevant rating edges", async () => {
  const standings = createStandings(64, "100");
  standings.conferences[0]!.teams[0]!.teamName = "Silverbacks";
  standings.conferences[0]!.teams[1]!.teamName = "Splash Gang";
  const match = {
    awayTeam: { id: "B", score: 55, teamName: "Splash Gang" },
    homeTeam: { id: "A", score: 69, teamName: "Silverbacks" },
    id: "m-ratings",
    startTime: "2026-04-21T19:00:00Z",
    type: "league.final",
  };
  const schedules = new Map<string, BBApiSchedule>([
    ["A", createSchedule("A", [match])],
    ["B", createSchedule("B", [match])],
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);
  const boxScore = createBoxScore({
    awayScore: 55,
    awayTeamId: "B",
    awayTeamName: "Splash Gang",
    homeScore: 69,
    homeTeamId: "A",
    homeTeamName: "Silverbacks",
    matchId: "m-ratings",
    startTime: "2026-04-21T19:00:00Z",
    type: "league.final",
  });
  boxScore.awayTeam.offStrategy = "Run and Gun";
  boxScore.awayTeam.teamTotals = { pts: 55, to: 15 };
  boxScore.awayTeam.ratings = {
    ...createCompleteTeamRatings(10),
    offensiveFlow: 8.8,
    outsideScoring: 12.2,
  };
  boxScore.homeTeam.offStrategy = "Motion";
  boxScore.homeTeam.teamTotals = { pts: 69, to: 8 };
  boxScore.homeTeam.ratings = {
    ...createCompleteTeamRatings(11),
    outsideDefense: 14.2,
    outsideScoring: 13.1,
  };

  const payload = await __testing.buildGameDayRecapPromptPayload({
    bb: {
      getBoxScore: async (matchId) => {
        if (matchId !== "m-ratings") {
          throw new Error(`Unexpected box score ${matchId}`);
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
      getTeamInfo: async () => {
        throw new Error("team info should not be loaded in this test");
      },
    },
    connection: {
      bbLoginName: "coach-alpha",
      leagueId: "100",
      leagueName: "Elite League",
      leagueTimeZone: "America/New_York",
      refreshSortAt: "2026-04-21T23:10:00.000Z",
      status: "CONNECTED",
      userId: "user-1",
    },
    fetchPublicMatchPlayByPlay: async (matchId) =>
      createPublicPlayByPlay({ matchId }),
    now: new Date("2026-04-21T23:10:00Z"),
    requestedGames: [
      {
        awayTeamId: "B",
        awayTeamName: "Splash Gang",
        homeTeamId: "A",
        homeTeamName: "Silverbacks",
        isScheduleFinal: true,
        matchId: "m-ratings",
        scheduledAwayScore: 55,
        scheduledHomeScore: 69,
        startTime: "2026-04-21T19:00:00Z",
        type: "league.final",
      },
    ],
    request: {
      generationApproach: "FACT_LIBRARY_FIRST",
      gameDate: "2026-04-21",
      gameDayNumber: null,
      kind: "LEAGUE_DATE",
      label: "Elite League 2026-04-21",
      leagueId: "100",
      leagueName: "Elite League",
      matchId: null,
      season: 64,
      timeZone: "America/New_York",
    },
    season: 64,
    standings,
    targetKey: "100#2026-04-21",
    userId: "user-1",
  });

  const factsLibrary = expectPresent(
    payload.games[0]?.factsLibrary,
    "expected facts library",
  );
  const factStoreGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact store game",
  );
  assert.equal(
    factStoreGame.teamRatingFacts.home.ratings.outsideDefense?.value,
    14.2,
  );
  assert.equal(
    factStoreGame.teamRatingFacts.away.ratings.outsideScoring?.value,
    12.2,
  );
  assert.equal(
    factStoreGame.teamRatingFacts.comparisons.some(
      (comparison) =>
        comparison.left.teamName === "Silverbacks" &&
        comparison.right.teamName === "Splash Gang" &&
        comparison.relevance === "outside_defense",
    ),
    true,
  );
  assert.match(factStoreGame.teamTalent.summary ?? "", /team talent edge/i);
  assert.ok(
    factsLibrary.matchupEdgeFacts.supported.some((fact) =>
      /Silverbacks .*perimeter defense.*outside scoring from Splash Gang/i.test(
        fact,
      ),
    ),
  );
  assert.equal(
    factsLibrary.matchupEdgeFacts.supported.some((fact) =>
      /offensive flow/i.test(fact),
    ),
    false,
  );
  assert.equal(
    factsLibrary.matchupEdgeFacts.supported.some((fact) =>
      /inside (?:scoring|defense)/i.test(fact),
    ),
    false,
  );
  assert.ok(
    factsLibrary.narrativePlan.closingFacts.some((fact) =>
      /perimeter defense.*outside scoring from Splash Gang/i.test(fact),
    ),
  );
  assert.ok(
    factsLibrary.rankedFacts.some(
      (fact) =>
        fact.category === "matchup" &&
        /perimeter defense.*outside scoring from Splash Gang/i.test(fact.text),
    ),
  );
  assert.ok(Array.isArray(factsLibrary.avoidFacts));
});

test("facts library ranks slate-level closest, biggest-margin, and high-scoring facts", () => {
  const closeGame = createExpectedPromptGame("m-close");
  closeGame.finalMargin = 2;
  closeGame.teams.home.score = 83;
  closeGame.teams.away.score = 81;
  closeGame.quarterScores.home = [20, 20, 20, 23];
  closeGame.quarterScores.away = [20, 20, 20, 21];

  const bigGame = createExpectedPromptGame("m-big");
  bigGame.finalMargin = 32;
  bigGame.teams.home.score = 116;
  bigGame.teams.away.score = 84;
  bigGame.quarterScores.home = [30, 28, 29, 29];
  bigGame.quarterScores.away = [20, 20, 22, 22];
  bigGame.teams.home.topPlayers = [
    {
      assists: 7,
      blocks: 2,
      fieldGoalsAttempted: 24,
      fieldGoalsMade: 15,
      freeThrowsAttempted: 6,
      freeThrowsMade: 5,
      minutes: 36,
      name: "Slate Star",
      personalFouls: 2,
      points: 41,
      rebounds: 9,
      steals: 2,
      threePointersAttempted: 10,
      threePointersMade: 6,
      turnovers: 3,
    },
  ];

  const request = {
    gameDate: "2026-03-15",
    gameDayNumber: null,
    generationApproach: "FACT_LIBRARY_FIRST" as const,
    interviewIntensity: "pg13" as const,
    kind: "LEAGUE_DATE" as const,
    label: "Elite League 2026-03-15",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    season: 64,
    timeZone: "America/New_York",
  };
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 2,
      missingGames: [],
      partial: false,
      requestedGames: 2,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [closeGame, bigGame],
      request,
    }),
  });

  const closeFacts = expectPresent(
    writerPayload.games.find((game) => game.matchId === "m-close")
      ?.factsLibrary,
    "expected close-game facts library",
  );
  const bigFacts = expectPresent(
    writerPayload.games.find((game) => game.matchId === "m-big")
      ?.factsLibrary,
    "expected big-game facts library",
  );

  assert.ok(
    closeFacts.rankedFacts.some(
      (fact) => fact.claimKey === "slate_closest_game",
    ),
  );
  assert.ok(
    bigFacts.rankedFacts.some(
      (fact) => fact.claimKey === "slate_biggest_margin",
    ),
  );
  assert.ok(
    bigFacts.rankedFacts.some(
      (fact) => fact.claimKey === "slate_highest_scoring",
    ),
  );
  assert.ok(
    bigFacts.rankedFacts.some((fact) => fact.claimKey === "slate_high_scorer"),
  );
  assert.ok(
    bigFacts.rankedFacts.some((fact) => fact.claimKey === "slate_most_threes"),
  );
});

test("facts library ranks boxscore-derived team edges and player facts", () => {
  const game = createExpectedPromptGame("m-boxscore");
  game.finalMargin = 14;
  game.teams.home.name = "Winners";
  game.teams.home.score = 96;
  game.teams.home.boxScoreStats = createRecapBoxScoreStats({
    assists: 29,
    fieldGoalsAttempted: 70,
    fieldGoalsMade: 38,
    freeThrowsAttempted: 24,
    freeThrowsMade: 19,
    offensiveRebounds: 15,
    personalFouls: 17,
    rebounds: 51,
    threePointersAttempted: 26,
    threePointersMade: 12,
  });
  game.teams.home.scoringDistribution = {
    doubleFigureScorerCount: 5,
    lowMinuteContributorPoints: 15,
    lowMinuteContributors: [
      {
        minutes: 14,
        name: "Pop Reserve",
        points: 9,
      },
    ],
    supportingCastPoints: 38,
    topTwoPointShare: 55.2,
  };
  game.teams.home.topPlayers = [
    {
      assists: 4,
      blocks: 1,
      fieldGoalsAttempted: 16,
      fieldGoalsMade: 11,
      freeThrowsAttempted: 4,
      freeThrowsMade: 3,
      minutes: 33,
      name: "Efficient Ed",
      personalFouls: 2,
      points: 27,
      rebounds: 8,
      steals: 1,
      threePointersAttempted: 5,
      threePointersMade: 2,
      turnovers: 1,
    },
    {
      assists: 11,
      blocks: 0,
      fieldGoalsAttempted: 8,
      fieldGoalsMade: 4,
      freeThrowsAttempted: 2,
      freeThrowsMade: 2,
      minutes: 31,
      name: "Pass First",
      personalFouls: 1,
      points: 12,
      rebounds: 5,
      steals: 2,
      threePointersAttempted: 4,
      threePointersMade: 2,
      turnovers: 2,
    },
  ];
  game.teams.away.name = "Losers";
  game.teams.away.score = 82;
  game.teams.away.boxScoreStats = createRecapBoxScoreStats({
    assists: 20,
    fieldGoalsAttempted: 69,
    fieldGoalsMade: 30,
    freeThrowsAttempted: 18,
    freeThrowsMade: 11,
    offensiveRebounds: 8,
    personalFouls: 24,
    rebounds: 39,
    threePointersAttempted: 24,
    threePointersMade: 6,
  });
  game.teams.away.scoringDistribution = {
    doubleFigureScorerCount: 2,
    lowMinuteContributorPoints: 0,
    lowMinuteContributors: [],
    supportingCastPoints: 18,
    topTwoPointShare: 67.1,
  };
  game.teams.away.topPlayers = [
    {
      assists: 2,
      blocks: 1,
      fieldGoalsAttempted: 12,
      fieldGoalsMade: 5,
      freeThrowsAttempted: 4,
      freeThrowsMade: 3,
      minutes: 30,
      name: "Board Boss",
      personalFouls: 3,
      points: 13,
      rebounds: 14,
      steals: 1,
      threePointersAttempted: 2,
      threePointersMade: 0,
      turnovers: 3,
    },
  ];

  const request = createSingleGameRecapPayload("m-boxscore").request;
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [game],
      request,
    }),
  });
  const factsLibrary = expectPresent(
    writerPayload.games[0]?.factsLibrary,
    "expected facts library",
  );
  const claimKeys = new Set(
    factsLibrary.rankedFacts.map((fact) => fact.claimKey),
  );

  assert.ok(claimKeys.has("rebound_edge"));
  assert.ok(claimKeys.has("assist_edge"));
  assert.ok(claimKeys.has("three_point_edge"));
  assert.ok(claimKeys.has("free_throw_edge"));
  assert.ok(claimKeys.has("field_goal_accuracy_edge"));
  assert.ok(claimKeys.has("efficient_scorer_efficient_ed"));
  assert.ok(claimKeys.has("assists_leader"));
  assert.ok(claimKeys.has("rebounds_leader"));
  assert.ok(claimKeys.has("balanced_scoring"));
  assert.ok(claimKeys.has("supporting_cast_scoring"));
  assert.ok(claimKeys.has("low_minute_contributor_scoring"));
  assert.ok(claimKeys.has("top_two_scoring_burden_loser"));
  assert.doesNotMatch(
    factsLibrary.rankedFacts.map((fact) => fact.text).join(" "),
    /\b(?:bench|starter|points in the paint)\b/i,
  );
});

test("facts library curates a star-led game story with injury and unusual stat contrasts", () => {
  const game = createExpectedPromptGame("m-story");
  game.finalMargin = 20;
  game.teams.home.name = "Visionaries";
  game.teams.home.score = 101;
  game.teams.home.turnovers = 1;
  game.teams.home.boxScoreStats = createRecapBoxScoreStats({
    assists: 21,
    freeThrowsAttempted: 9,
    freeThrowsMade: 7,
    threePointersAttempted: 29,
    threePointersMade: 11,
  });
  game.teams.home.scoringDistribution = {
    doubleFigureScorerCount: 4,
    lowMinuteContributorPoints: 0,
    lowMinuteContributors: [],
    supportingCastPoints: 42,
    topScorer: {
      name: "Hichem Zamit",
      points: 43,
    },
    topScorerPointShare: 42.6,
    topTwoPointShare: 58.4,
    totalPoints: 101,
  };
  game.teams.home.topPlayers = [
    {
      assists: 3,
      blocks: 0,
      fieldGoalsAttempted: 26,
      fieldGoalsMade: 16,
      freeThrowsAttempted: 5,
      freeThrowsMade: 4,
      isStarter: true,
      minutes: 39,
      name: "Hichem Zamit",
      personalFouls: 2,
      playerId: "zamit",
      plusMinus: 18,
      points: 43,
      ratingValue: 16,
      rebounds: 10,
      steals: 1,
      threePointersAttempted: 9,
      threePointersMade: 5,
      turnovers: 0,
    },
    {
      assists: 2,
      blocks: 1,
      fieldGoalsAttempted: 12,
      fieldGoalsMade: 6,
      freeThrowsAttempted: 2,
      freeThrowsMade: 2,
      isStarter: true,
      minutes: 34,
      name: "Kenyon Lerat",
      personalFouls: 3,
      playerId: "lerat",
      plusMinus: 14,
      points: 16,
      ratingValue: 14,
      rebounds: 17,
      steals: 0,
      threePointersAttempted: 1,
      threePointersMade: 0,
      turnovers: 0,
    },
  ];
  game.teams.away.name = "TarTeam";
  game.teams.away.score = 81;
  game.teams.away.turnovers = 10;
  game.teams.away.boxScoreStats = createRecapBoxScoreStats({
    assists: 11,
    freeThrowsAttempted: 33,
    freeThrowsMade: 24,
    threePointersAttempted: 19,
    threePointersMade: 3,
  });
  game.teams.away.notablePlayers = [
    {
      isStarter: true,
      minutes: 23,
      name: "Finn Fisher",
      playerId: "fisher",
      plusMinus: 8,
      points: 9,
      ratingValue: 15,
    },
  ];
  game.quarterFacts.decisiveQuarter = {
    awayScore: 14,
    homeScore: 22,
    label: "3rd quarter",
    margin: 8,
    period: 3,
    winningSide: "home",
  };
  game.playByPlayFacts = {
    bestCompetitiveSwingRun: createEmptyRunFact("swing"),
    endingFacts: {
      decisiveScore: null,
      opponentLastChance: null,
    },
    explicitEventFacts: [
      {
        awayScore: 58,
        clock: "07:42",
        eventTeamScore: 58,
        eventText: "Finn Fisher left the game injured.",
        eventType: "injury",
        homeScore: 61,
        leaderSide: "home",
        margin: 3,
        opponentScore: 61,
        playerName: "Finn Fisher",
        quarter: 3,
        scoreRelation: "trailing",
        teamName: "TarTeam",
        teamSide: "away",
      },
    ],
    lateGameMoments: [],
    largestLead: {
      points: 20,
      teamName: "Visionaries",
      teamSide: "home",
    },
    leadChangeCount: 3,
    leadChangeFacts: {
      bigComebackLeadChange: null,
      highVolumeLeadChangeGame: {
        leadChangeCount: 3,
        qualifies: false,
      },
      rapidLeadChangeBurst: null,
    },
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    playerScoringSpurts: [
      {
        endAwayScore: 7,
        endClock: "08:58",
        endHomeScore: 9,
        endQuarter: 1,
        eventCount: 4,
        playerName: "Hichem Zamit",
        points: 9,
        startAwayScore: 0,
        startClock: "11:18",
        startHomeScore: 0,
        startQuarter: 1,
        teamName: "Visionaries",
        teamSide: "home",
      },
    ],
    primaryRun: createRunFact({
      endAwayScore: 68,
      endClock: "07:04",
      endHomeScore: 84,
      endQuarter: 4,
      opponentPoints: 10,
      runType: "swing",
      startAwayScore: 58,
      startClock: "04:45",
      startHomeScore: 60,
      startQuarter: 3,
      teamName: "Visionaries",
      teamPoints: 24,
      teamSide: "home",
    }),
    secondaryRun: null,
    summaryLines: [
      "Visionaries used a 24-10 run from 4:45 left in the 3rd quarter to 7:04 left in the 4th quarter to seize control.",
    ],
    tookLeadForGood: {
      awayScore: 58,
      clock: "04:45",
      deficitErased: 10,
      eventText: "Visionaries took the lead for good.",
      homeScore: 60,
      previousLeaderSide: "away",
      quarter: 3,
      scoringTeamName: "Visionaries",
      scoringTeamSide: "home",
    },
    winnerComebackDeficit: 10,
  };
  game.playByPlaySummaryLines = game.playByPlayFacts.summaryLines;

  const request = createSingleGameRecapPayload("m-story").request;
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [game],
      request,
    }),
  });
  const factsLibrary = expectPresent(
    writerPayload.games[0]?.factsLibrary,
    "expected facts library",
  );
  const claimKeys = new Set(
    factsLibrary.rankedFacts.map((fact) => fact.claimKey),
  );

  const mainCharacter = expectPresent(
    factsLibrary.gameStory.mainCharacter,
    "expected game story main character",
  );
  assert.equal(mainCharacter.playerName, "Hichem Zamit");
  assert.match(mainCharacter.supportingText, /carried/i);
  assert.match(factsLibrary.gameStory.injurySwing?.text ?? "", /Finn Fisher.*starter.*left injured.*\+8/i);
  assert.deepEqual(factsLibrary.gameStory.injurySwing?.explicitEventContext, {
    awayScore: 58,
    clock: "07:42",
    eventTeamScore: 58,
    eventType: "injury",
    homeScore: 61,
    leaderSide: "home",
    margin: 3,
    opponentScore: 61,
    playerName: "Finn Fisher",
    quarter: 3,
    scoreRelation: "trailing",
    teamName: "TarTeam",
    teamSide: "away",
  });
  const takeoverRunContext = expectPresent(
    factsLibrary.gameStory.takeoverStretch?.runContext,
    "expected takeover run context",
  );
  assert.equal(takeoverRunContext.elapsedMinutesFloor, 9);
  assert.deepEqual(takeoverRunContext.periodSpan, {
    endQuarter: 4,
    quarterCount: 2,
    spansMultiplePeriods: true,
    startQuarter: 3,
  });
  assert.ok(factsLibrary.gameStory.selectedBeats.length <= 5);
  assert.ok(
    factsLibrary.gameStory.selectedBeats.some((beat) =>
      /primary_run/.test(beat.factId),
    ),
  );
  assert.equal(
    factsLibrary.gameStory.selectedBeats.some((beat) =>
      /took_lead_for_good/.test(beat.factId),
    ),
    false,
  );
  const selectedChronology = factsLibrary.gameStory.selectedBeats
    .map((beat) => beat.timeSort)
    .filter((timeSort): timeSort is number => timeSort !== null);
  assert.deepEqual(selectedChronology, [...selectedChronology].sort((left, right) => left - right));
  assert.ok(factsLibrary.gameStory.suppressedFactIds.some((factId) => /decisive_quarter/.test(factId)));
  assert.equal(claimKeys.has("balanced_scoring"), false);
  assert.ok(claimKeys.has("star_led_scoring_distribution"));
  assert.ok(claimKeys.has("very_low_turnover_win"));
  assert.ok(claimKeys.has("won_despite_free_throw_attempt_gap"));

  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game",
  );
  const assessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Visionaries beat TarTeam 101-81",
      matchId: "m-story",
      writeup:
        "TarTeam paired Motion with 2-3 Zone, while Visionaries answered with Push the Ball and Man-to-man.\n\nHichem Zamit scored 9 straight with 11:18 left in the 1st quarter, TarTeam led 52-49 at halftime, TarTeam's last lead came with 9:31 left in the 3rd quarter, Visionaries took the lead for good with 4:45 left in the 3rd quarter, and Visionaries used a 24-10 run from 4:45 left in the 3rd quarter to 7:04 left in the 4th quarter.\n\nVisionaries's balanced attack featured four players in double figures, and Visionaries committed just one turnover while winning despite TarTeam's 33 free-throw attempts.",
    }),
    [expectedGame],
  );
  const issueKinds = new Set(assessment.issues.map((issue) => issue.kind));
  assert.ok(issueKinds.has("game_flow_time_clutter"));
  assert.ok(issueKinds.has("missing_game_story_beat"));
  assert.ok(issueKinds.has("unsupported_balanced_attack"));
	  const supportedInjuryAssessment = __testing.assessGameDayRecapDeterministicPayload(
	    createRecapCandidateResult({
	      headline: "Visionaries beat TarTeam 101-81",
	      matchId: "m-story",
	      writeup:
	        "TarTeam paired Motion with 2-3 Zone, while Visionaries answered with Push the Ball and Man-to-man.\n\nHichem Zamit scored 9 straight early, Finn Fisher, a starter for TarTeam, left injured in the third quarter while TarTeam was down 58-61, and Visionaries used a 24-10 run across 9 minutes in the 3rd and 4th quarters to take control.\n\nHichem Zamit carried Visionaries with 43 points while three teammates reached double figures, and Visionaries committed just one turnover while winning despite TarTeam's 33 free-throw attempts.",
	    }),
	    [expectedGame],
	  );
	  assert.equal(
	    supportedInjuryAssessment.issues.some(
	      (issue) => issue.kind === "missing_game_story_beat",
	    ),
	    false,
	  );
	  assert.equal(
	    supportedInjuryAssessment.issues.some(
	      (issue) => issue.kind === "missing_run_timing",
	    ),
	    false,
	  );
	  assert.equal(
	    supportedInjuryAssessment.issues.some(
	      (issue) => issue.kind === "missing_explicit_event_score_state",
	    ),
	    false,
	  );
	  assert.equal(
	    supportedInjuryAssessment.issues.some(
	      (issue) => issue.kind === "choppy_fact_stack",
	    ),
	    false,
	  );
	  const ambiguousScoreStateAssessment =
	    __testing.assessGameDayRecapDeterministicPayload(
	      createRecapCandidateResult({
	        headline: "Visionaries beat TarTeam 101-81",
	        matchId: "m-story",
	        writeup:
	          "TarTeam paired Motion with 2-3 Zone, while Visionaries answered with Push the Ball and Man-to-man.\n\nHichem Zamit scored 9 straight early, Finn Fisher, a starter for TarTeam, left injured in the third quarter at 58-61, and Visionaries used a 24-10 run across 9 minutes in the 3rd and 4th quarters to take control.\n\nHichem Zamit carried Visionaries with 43 points while three teammates reached double figures, and Visionaries committed just one turnover while winning despite TarTeam's 33 free-throw attempts.",
	      }),
	      [expectedGame],
	    );
	  assert.ok(
	    ambiguousScoreStateAssessment.issues.some(
	      (issue) => issue.kind === "missing_explicit_event_score_state",
	    ),
	  );
	  const bareInjuryAssessment = __testing.assessGameDayRecapDeterministicPayload(
	    createRecapCandidateResult({
	      headline: "Visionaries beat TarTeam 101-81",
	      matchId: "m-story",
	      writeup:
	        "TarTeam paired Motion with 2-3 Zone, while Visionaries answered with Push the Ball and Man-to-man.\n\nHichem Zamit scored 9 straight early, Finn Fisher, a starter for TarTeam, left injured in the third quarter, and Visionaries used a 24-10 run across 9 minutes in the 3rd and 4th quarters to take control.\n\nHichem Zamit carried Visionaries with 43 points while three teammates reached double figures, and Visionaries committed just one turnover while winning despite TarTeam's 33 free-throw attempts.",
	    }),
	    [expectedGame],
	  );
	  assert.ok(
	    bareInjuryAssessment.issues.some(
	      (issue) => issue.kind === "missing_explicit_event_score_state",
	    ),
	  );
	  const omittedInjuryAssessment = __testing.assessGameDayRecapDeterministicPayload(
	    createRecapCandidateResult({
	      headline: "Visionaries beat TarTeam 101-81",
	      matchId: "m-story",
	      writeup:
	        "TarTeam paired Motion with 2-3 Zone, while Visionaries answered with Push the Ball and Man-to-man.\n\nHichem Zamit scored 9 straight early, and Visionaries used a 24-10 run across 9 minutes in the 3rd and 4th quarters to take control.\n\nHichem Zamit carried Visionaries with 43 points while three teammates reached double figures, and Visionaries committed just one turnover while winning despite TarTeam's 33 free-throw attempts.",
	    }),
	    [expectedGame],
	  );
	  assert.ok(
	    omittedInjuryAssessment.issues.some(
	      (issue) =>
	        issue.kind === "missing_game_story_beat" &&
	        /Finn Fisher/i.test(issue.actualValue ?? ""),
	    ),
	  );
	});

test("facts library suppresses separated last-lead and lead-for-good ledger facts in writer story", () => {
  const game = createExpectedPromptGame("m-separated-leads");
  game.finalMargin = 16;
  game.teams.away.name = "Splash Gang";
  game.teams.away.offStrategy = "RunAndGun";
  game.teams.away.defStrategy = "32Zone";
  game.teams.away.score = 97;
  game.teams.home.name = "LA Lions";
  game.teams.home.offStrategy = "LookInside";
  game.teams.home.defStrategy = "131Zone";
  game.teams.home.score = 81;
  game.quarterScores = {
    away: [18, 22, 24, 33],
    home: [20, 21, 18, 22],
  };
  game.quarterFacts.periods = [
    {
      awayScore: 18,
      homeScore: 20,
      label: "1st quarter",
      margin: 2,
      period: 1,
      winningSide: "home",
    },
    {
      awayScore: 22,
      homeScore: 21,
      label: "2nd quarter",
      margin: 1,
      period: 2,
      winningSide: "away",
    },
    {
      awayScore: 24,
      homeScore: 18,
      label: "3rd quarter",
      margin: 6,
      period: 3,
      winningSide: "away",
    },
    {
      awayScore: 33,
      homeScore: 22,
      label: "4th quarter",
      margin: 11,
      period: 4,
      winningSide: "away",
    },
  ];
  game.quarterFacts.fourthQuarterOutcome = game.quarterFacts.periods[3]!;
  game.playByPlayFacts = {
    bestCompetitiveSwingRun: createEmptyRunFact("swing"),
    endingFacts: {
      decisiveScore: null,
      opponentLastChance: null,
    },
    explicitEventFacts: [],
    lateGameMoments: [],
    largestLead: {
      points: 16,
      teamName: "Splash Gang",
      teamSide: "away",
    },
    leadChangeCount: 4,
    leadChangeFacts: {
      bigComebackLeadChange: {
        awayScore: 46,
        beforeAwayScore: 44,
        beforeHomeScore: 45,
        clock: "10:38",
        deficitBeforeLeadChange: 1,
        deficitErased: 9,
        eventText: "Splash Gang noses ahead.",
        homeScore: 45,
        previousLeaderSide: "home",
        quarter: 3,
        scoringTeamName: "Splash Gang",
        scoringTeamSide: "away",
      },
      highVolumeLeadChangeGame: {
        leadChangeCount: 4,
        qualifies: false,
      },
      rapidLeadChangeBurst: null,
    },
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    primaryRun: createRunFact({
      endAwayScore: 91,
      endClock: "02:10",
      endHomeScore: 73,
      endQuarter: 4,
      opponentPoints: 10,
      runType: "swing",
      startAwayScore: 63,
      startClock: "09:20",
      startHomeScore: 63,
      startQuarter: 4,
      teamName: "Splash Gang",
      teamPoints: 28,
      teamSide: "away",
    }),
    secondaryRun: null,
    summaryLines: [
      "Splash Gang went ahead 46-45 with 10:38 left in the 3rd quarter after earlier trailing by as many as 9.",
      "Splash Gang used a 28-10 run from 9:20 left in the 4th quarter to 2:10 left in the 4th quarter to seize control.",
    ],
    tookLeadForGood: {
      awayScore: 61,
      clock: "00:04",
      deficitErased: 9,
      eventText: "Splash Gang took the lead for good.",
      homeScore: 59,
      previousLeaderSide: "tie",
      quarter: 3,
      scoringTeamName: "Splash Gang",
      scoringTeamSide: "away",
    },
    lastLeadByLoser: {
      awayScore: 44,
      clock: "10:59",
      homeScore: 45,
      leadingTeamName: "LA Lions",
      leadingTeamSide: "home",
      quarter: 3,
      trailingTeamName: "Splash Gang",
      trailingTeamSide: "away",
    },
    winnerComebackDeficit: 9,
  };
  game.playByPlaySummaryLines = game.playByPlayFacts.summaryLines;

  const request = createSingleGameRecapPayload("m-separated-leads").request;
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [game],
      request,
    }),
  });
  const factsLibrary = expectPresent(
    writerPayload.games[0]?.factsLibrary,
    "expected facts library",
  );
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game",
  );
  const selectedClaimText = factsLibrary.gameStory.selectedBeats
    .map((beat) => beat.factId)
    .join(" ");

  assert.doesNotMatch(
    selectedClaimText,
    /lead_change|last_loser_lead|took_lead_for_good/,
  );
  assert.match(selectedClaimText, /primary_run/);
  assert.equal(factsLibrary.gameFlow.lastLeadByLoser, null);
  assert.equal(factsLibrary.gameFlow.tookLeadForGood, null);
  assert.deepEqual(factsLibrary.gameFlow.highlightLeadChanges, []);
  assert.doesNotMatch(
    factsLibrary.chronologicalFacts.map((fact) => fact.text).join(" "),
    /\blast lead|lead for good/i,
  );
  assert.ok(
    factsLibrary.avoidFacts.some((fact) =>
      /Do not pair the losing team's last lead/i.test(fact),
    ),
  );

  const cleaned = __testing.cleanupFactLibraryWriteup(
    createRecapCandidateResult({
      headline: "Splash Gang beat LA Lions 97-81",
      matchId: "m-separated-leads",
      writeup:
        "Splash Gang paired Run and Gun with 3-2 Zone, while LA Lions answered with Look Inside and 1-3-1 Zone.\n\nSplash Gang erased a 9-point deficit to win, with Roscoe Anderson leading the way. LA Lions led 41-40 at halftime. Splash Gang used a 28-10 run during a 7-minute surge in the 4th quarter to seize control.\n\nSplash Gang dominated the glass.",
    }).games[0]!,
    expectedGame,
  );
  const cleanedGameParagraph = cleaned.writeup.split(/\n{2,}/)[1] ?? "";
  assert.match(
    cleanedGameParagraph,
    /^LA Lions led 41-40 at halftime\. Splash Gang erased a 9-point deficit to win/i,
  );
  assert.match(
    cleanedGameParagraph,
    /deficit to win[^.]+\. Splash Gang used a 28-10 run/i,
  );

  const normalizedHalftimeComeback = __testing.cleanupFactLibraryWriteup(
    createRecapCandidateResult({
      headline: "Splash Gang beat LA Lions 97-81",
      matchId: "m-separated-leads",
      writeup:
        "Splash Gang paired Run and Gun with 3-2 Zone, while LA Lions answered with Look Inside and 1-3-1 Zone.\n\nLA Lions led 41-40 at halftime, but Splash Gang erased a 9-point deficit to win. Splash Gang used a 28-10 run during a 7-minute surge in the 4th quarter to seize control.\n\nSplash Gang dominated the glass.",
    }).games[0]!,
    expectedGame,
  );
  assert.match(
    normalizedHalftimeComeback.writeup,
    /LA Lions led 41-40 at halftime after Splash Gang had trailed by as many as 9\./i,
  );
  assert.doesNotMatch(
    normalizedHalftimeComeback.writeup,
    /halftime, but Splash Gang erased a 9-point deficit/i,
  );

  const normalizedControlComeback = __testing.cleanupFactLibraryWriteup(
    createRecapCandidateResult({
      headline: "Splash Gang beat LA Lions 97-81",
      matchId: "m-separated-leads",
      writeup:
        "Splash Gang paired Run and Gun with 3-2 Zone, while LA Lions answered with Look Inside and 1-3-1 Zone.\n\nLA Lions led 41-40 at halftime, but Splash Gang erased a 9-point deficit to seize control down the stretch. Splash Gang used a 28-10 run during a 7-minute surge in the 4th quarter to seize control.\n\nSplash Gang dominated the glass.",
    }).games[0]!,
    expectedGame,
  );
  assert.match(
    normalizedControlComeback.writeup,
    /LA Lions led 41-40 at halftime after Splash Gang had trailed by as many as 9\./i,
  );
});

test("dominant scorer facts use true scoring leaders instead of performance-ranked topPlayers", () => {
  const game = createExpectedPromptGame("m-true-second-scorer");
  game.finalMargin = 16;
  game.teams.home.name = "Philadelphia Cheesesteaks";
  game.teams.home.score = 97;
  game.teams.away.name = "ElectricTriangles";
  game.teams.away.score = 81;
  game.teams.home.scoringDistribution = {
    doubleFigureScorerCount: 4,
    lowMinuteContributorPoints: 0,
    lowMinuteContributors: [],
    scoringLeaders: [
      { name: "Ng Kung On", points: 33 },
      { name: "Second Scorer", points: 20 },
      { name: "Third Scorer", points: 15 },
      { name: "Fourth Scorer", points: 14 },
      { name: "Fifth Scorer", points: 6 },
    ],
    secondScorer: {
      name: "Second Scorer",
      points: 20,
    },
    supportingCastPoints: 44,
    topScorer: {
      name: "Ng Kung On",
      points: 33,
    },
    topScorerPointShare: 34,
    topTwoPointShare: 54.6,
    totalPoints: 97,
  };
  game.teams.home.topPlayers = [
    {
      assists: 1,
      blocks: 0,
      fieldGoalsAttempted: 22,
      fieldGoalsMade: 12,
      freeThrowsAttempted: 8,
      freeThrowsMade: 7,
      minutes: 36,
      name: "Ng Kung On",
      personalFouls: 2,
      points: 33,
      rebounds: 6,
      steals: 1,
      threePointersAttempted: 6,
      threePointersMade: 2,
      turnovers: 2,
    },
    {
      assists: 10,
      blocks: 1,
      fieldGoalsAttempted: 4,
      fieldGoalsMade: 2,
      freeThrowsAttempted: 2,
      freeThrowsMade: 2,
      minutes: 34,
      name: "Top Rated Low Scorer",
      personalFouls: 1,
      points: 6,
      rebounds: 12,
      steals: 3,
      threePointersAttempted: 1,
      threePointersMade: 0,
      turnovers: 0,
    },
  ];

  const request = createSingleGameRecapPayload("m-true-second-scorer").request;
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [game],
      request,
    }),
  });
  const factsLibrary = expectPresent(
    writerPayload.games[0]?.factsLibrary,
    "expected facts library",
  );
  const dominantFact = expectPresent(
    factsLibrary.rankedFacts.find((fact) =>
      fact.claimKey.startsWith("dominant_scorer_ng_kung_on"),
    ),
    "expected dominant scorer fact",
  );

  assert.doesNotMatch(dominantFact.text, /next .* at 6\b/i);
  assert.match(dominantFact.text, /3 teammates also reached double figures|20/);
});

test("deterministic recap review distinguishes live lead scores from quarter results", () => {
  const game = createExpectedPromptGame("m-live-lead");
  game.teams.home.name = "Philadelphia Cheesesteaks";
  game.teams.away.name = "ElectricTriangles";
  game.teams.home.score = 97;
  game.teams.away.score = 81;
  game.finalMargin = 16;

  const liveLeadAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Philadelphia Cheesesteaks beat ElectricTriangles 97-81",
      matchId: "m-live-lead",
      writeup:
        "Philadelphia Cheesesteaks erased an 8-point deficit and took the lead 35-33 with 0:56 left in the 2nd quarter.",
    }),
    [game],
  );
  assert.equal(
    liveLeadAssessment.issues.some(
      (issue) => issue.kind === "quarter_score_mismatch",
    ),
    false,
  );

  const quarterResultAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Philadelphia Cheesesteaks beat ElectricTriangles 97-81",
      matchId: "m-live-lead",
      writeup: "Philadelphia Cheesesteaks won the 2nd quarter 35-33.",
    }),
    [game],
  );
  assert.ok(
    quarterResultAssessment.issues.some(
      (issue) => issue.kind === "quarter_score_mismatch",
    ),
  );
});

test("deterministic recap review accepts equivalent selected-run timing anchors", () => {
  const game = createExpectedPromptGame("m-run-timing");
  game.teams.home.name = "Philadelphia Cheesesteaks";
  game.teams.away.name = "ElectricTriangles";
  const primaryRun = createRunFact({
    endAwayScore: 70,
    endClock: "10:46",
    endHomeScore: 76,
    endQuarter: 4,
    opponentPoints: 12,
    runType: "swing",
    startAwayScore: 58,
    startClock: "08:19",
    startHomeScore: 49,
    startQuarter: 3,
    teamName: "Philadelphia Cheesesteaks",
    teamPoints: 27,
    teamSide: "home",
  });
  game.playByPlayFacts = {
    ...createBackAndForthPlayByPlayFacts(),
    primaryRun,
    summaryLines: [
      "Philadelphia Cheesesteaks mounted a 27-12 run from 8:19 left in the 3rd quarter to 10:46 left in the 4th quarter.",
    ],
  };

  const assessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Philadelphia Cheesesteaks beat ElectricTriangles 97-81",
      matchId: "m-run-timing",
      writeup:
        "The game remained competitive until Philadelphia Cheesesteaks mounted a 27-12 run from 8:19 in the third quarter to 10:46 in the fourth to seize control.",
    }),
    [game],
  );

  assert.equal(
    assessment.issues.some((issue) => issue.kind === "missing_run_timing"),
    false,
  );

  const broadAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Philadelphia Cheesesteaks beat ElectricTriangles 97-81",
      matchId: "m-run-timing",
      writeup:
        "Philadelphia Cheesesteaks used a 27-12 run across 9 minutes in the third and fourth quarters to seize control.",
    }),
    [game],
  );

  assert.equal(
    broadAssessment.issues.some((issue) => issue.kind === "missing_run_timing"),
    false,
  );

  const timedOutscoreAssessment =
    __testing.assessGameDayRecapDeterministicPayload(
      createRecapCandidateResult({
        headline: "Philadelphia Cheesesteaks beat ElectricTriangles 97-81",
        matchId: "m-run-timing",
        writeup:
          "Over roughly nine minutes in the third and fourth quarters, Philadelphia Cheesesteaks outscored ElectricTriangles 27-12 to seize control.",
      }),
      [game],
    );
  assert.equal(
    timedOutscoreAssessment.issues.some(
      (issue) =>
        issue.kind === "quarter_score_mismatch" ||
        issue.kind === "choppy_fact_stack" ||
        issue.kind === "missing_primary_run_mention",
    ),
    false,
  );
});

test("primary run omissions are draft quality only when gameStory did not select the run", () => {
  const game = createExpectedPromptGame("m-run-not-selected");
  game.playByPlayFacts = {
    ...createBackAndForthPlayByPlayFacts(),
    primaryRun: createRunFact({
      endAwayScore: 70,
      endClock: "10:46",
      endHomeScore: 76,
      endQuarter: 4,
      opponentPoints: 12,
      runType: "swing",
      startAwayScore: 58,
      startClock: "08:19",
      startHomeScore: 49,
      startQuarter: 3,
      teamName: "Home",
      teamPoints: 27,
      teamSide: "home",
    }),
  };
  const request = createSingleGameRecapPayload("m-run-not-selected").request;
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [game],
      request,
    }),
  });
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game",
  );
  const factsLibrary = expectPresent(
    expectedGame.factsLibrary,
    "expected facts library",
  );
  factsLibrary.gameStory = {
    ...factsLibrary.gameStory,
    requiredFactIds: factsLibrary.gameStory.requiredFactIds.filter(
      (factId) => !/primary_run/.test(factId),
    ),
    selectedBeats: factsLibrary.gameStory.selectedBeats.filter(
      (beat) => !/primary_run/.test(beat.factId),
    ),
  };

  const assessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beat Away 85-81",
      matchId: "m-run-not-selected",
      writeup:
        "Away paired Motion with 2-3 Zone, while Home answered with Push the Ball and Man-to-man.\n\nHome took control after halftime and kept the game clean from there.\n\nHome protected the ball and finished the job.",
    }),
    [expectedGame],
  );

  assert.equal(
    assessment.issues.some(
      (issue) => issue.kind === "missing_primary_run_mention",
    ),
    false,
  );
});

test("selected primary run omissions are repaired even when the run is not hard-required", () => {
  const game = createExpectedPromptGame("m-run-selected");
  game.playByPlayFacts = {
    ...createBackAndForthPlayByPlayFacts(),
    primaryRun: createRunFact({
      endAwayScore: 70,
      endClock: "10:46",
      endHomeScore: 76,
      endQuarter: 4,
      opponentPoints: 12,
      runType: "swing",
      startAwayScore: 58,
      startClock: "08:19",
      startHomeScore: 49,
      startQuarter: 3,
      teamName: "Home",
      teamPoints: 27,
      teamSide: "home",
    }),
  };
  const request = createSingleGameRecapPayload("m-run-selected").request;
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [game],
      request,
    }),
  });
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game",
  );
  const factsLibrary = expectPresent(
    expectedGame.factsLibrary,
    "expected facts library",
  );
  assert.ok(
    factsLibrary.gameStory.selectedBeats.some((beat) =>
      /primary_run/.test(beat.factId),
    ),
    "expected primary run to be selected",
  );
  factsLibrary.gameStory = {
    ...factsLibrary.gameStory,
    requiredFactIds: factsLibrary.gameStory.requiredFactIds.filter(
      (factId) => !/primary_run/.test(factId),
    ),
  };

  const assessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beat Away 85-81",
      matchId: "m-run-selected",
      writeup:
        "Away paired Motion with 2-3 Zone, while Home answered with Push the Ball and Man-to-man.\n\nHome took control after halftime and kept the game clean from there.\n\nHome protected the ball and finished the job.",
    }),
    [expectedGame],
  );

  assert.ok(
    assessment.issues.some(
      (issue) => issue.kind === "missing_primary_run_mention",
    ),
  );
});

test("saved validation payload reports draft-quality issues as valid but keeps hard fact issues", () => {
  const game = createExpectedPromptGame("m-validation-status");
  game.teams.home.name = "Home";
  game.teams.away.name = "Away";

  const assessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beat Away 85-81",
      matchId: "m-validation-status",
      writeup:
        "Home beat Away 85-81. Home beat Away 85-81. Home protected the ball. Home shot better.",
    }),
    [game],
  );
  const draftIssues = assessment.issues.filter((issue) =>
    ["duplicate_outcome_restatement", "repetitive_sentence_start"].includes(
      issue.kind,
    ),
  );
  assert.ok(draftIssues.length > 0);
  const draftValidation = __testing.buildGameValidationPayload({
    deterministicIssues: draftIssues,
    judgeIssues: [],
  });
  assert.equal(draftValidation.status, "VALID");
  assert.equal(draftValidation.issueCount, 0);

  const hardIssue = expectPresent(
    __testing
      .assessGameDayRecapDeterministicPayload(
        createRecapCandidateResult({
          headline: "Home beat Away 85-81",
          matchId: "m-validation-status",
          writeup: "Away won the 2nd quarter 35-33.",
        }),
        [game],
      )
      .issues.find((issue) => issue.kind === "quarter_score_mismatch"),
    "expected hard quarter-score issue",
  );
  const hardValidation = __testing.buildGameValidationPayload({
    deterministicIssues: [hardIssue],
    judgeIssues: [],
  });
  assert.equal(hardValidation.status, "SUSPECT");
  assert.equal(hardValidation.issueCount, 1);
});

test("duplicate outcome detection catches winner-only final-score restatements", () => {
  const game = createExpectedPromptGame("m-duplicate-winner-only");
  game.teams.home.name = "Home";
  game.teams.away.name = "Away";

  const assessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beat Away 85-81",
      matchId: "m-duplicate-winner-only",
      writeup:
        "Home controlled the second half. Home pulled away from there, winning 85-81.",
    }),
    [game],
  );

  assert.ok(
    assessment.issues.some(
      (issue) => issue.kind === "duplicate_outcome_restatement",
    ),
  );
});

test("rating validation rejects irrelevant outside scoring claims for inside tactics", () => {
  const game = createExpectedPromptGame("m-rating-tactic-relevance");
  game.teams.away.name = "Splash Gang";
  game.teams.away.score = 95;
  game.teams.away.defStrategy = "32Zone";
  game.teams.home.name = "The LA Lions";
  game.teams.home.score = 75;
  game.teams.home.offStrategy = "LookInside";
  game.finalMargin = 20;

  const assessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Splash Gang beat The LA Lions 95-75",
      matchId: "m-rating-tactic-relevance",
      writeup:
        "Splash Gang paired Run and Gun with 3-2 Zone, while The LA Lions answered with Look Inside and 1-3-1 Zone.\n\nSplash Gang took control in the fourth quarter.\n\nSplash Gang's sensational perimeter defense proved effective against The LA Lions' average outside scoring.",
    }),
    [game],
  );

  assert.ok(
    assessment.issues.some(
      (issue) => issue.kind === "unsupported_scoring_context",
    ),
  );

  const stifledAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Splash Gang beat The LA Lions 95-75",
      matchId: "m-rating-tactic-relevance",
      writeup:
        "Splash Gang won the rebounding battle with a sensational perimeter defense that stifled The LA Lions' average outside scoring.",
    }),
    [game],
  );

  assert.ok(
    stifledAssessment.issues.some(
      (issue) => issue.kind === "unsupported_scoring_context",
    ),
  );

  const ratingCausalityAssessment =
    __testing.assessGameDayRecapDeterministicPayload(
      createRecapCandidateResult({
        headline: "Splash Gang beat The LA Lions 95-75",
        matchId: "m-rating-tactic-relevance",
        writeup:
          "Splash Gang paired Run and Gun with 3-2 Zone, while The LA Lions answered with Look Inside and 1-3-1 Zone.\n\nSplash Gang took control in the fourth quarter.\n\nDespite The LA Lions holding the team talent edge, Splash Gang's sensational perimeter defense and stronger rebounding rating proved decisive in the 95-75 victory.",
      }),
      [game],
    );
  assert.ok(
    ratingCausalityAssessment.issues.some(
      (issue) => issue.kind === "unsupported_scoring_context",
    ),
  );
});

test("fact-library headline cleanup fixes plural team verb agreement", () => {
  const game = createExpectedPromptGame("m-plural-headline");
  game.teams.home.name = "Visionaries";
  game.teams.away.name = "TarTeam";

  assert.equal(
    __testing.normalizeFactLibraryHeadline(
      "Visionaries erases 10-point deficit to beat TarTeam 101-81",
      game,
    ),
    "Visionaries erase 10-point deficit to beat TarTeam 101-81",
  );
});

test("salvageGameDayRecapResult removes duplicate final-score restatements", async () => {
  const expectedGame = createExpectedPromptGame("m-duplicate-cleanup");
  expectedGame.teams.home.name = "Visionaries";
  expectedGame.teams.away.name = "TarTeam";
  expectedGame.teams.home.score = 101;
  expectedGame.teams.away.score = 81;
  expectedGame.finalMargin = 20;

  const invalidResult = createRecapCandidateResult({
    headline: "Visionaries beat TarTeam 101-81",
    matchId: "m-duplicate-cleanup",
    writeup:
      "Visionaries beat TarTeam 101-81. Visionaries beat TarTeam 101-81. Visionaries controlled the fourth quarter.",
  });
  const deterministic = __testing.assessGameDayRecapDeterministicPayload(
    invalidResult,
    [expectedGame],
  );

  const repaired = await __testing.salvageGameDayRecapResult({
    deterministicIssues: deterministic.issues,
    expectedGames: [expectedGame],
    judgeIssues: [],
    judgeProvider: createPassingJudgeProvider(),
    request: createSingleGameRecapPayload("m-duplicate-cleanup").request,
    result: invalidResult,
  });
  const writeup = repaired.result.games[0]?.writeup ?? "";

  assert.equal(
    (writeup.match(/Visionaries beat TarTeam 101-81/g) ?? []).length,
    1,
  );
  assert.match(writeup, /controlled the fourth quarter/i);
});

test("salvageGameDayRecapResult restores missing fact-library manager setup and selected run", async () => {
  const game = createExpectedPromptGame("m-structure-repair");
  game.teams.home.name = "Visionaries";
  game.teams.away.name = "TarTeam";
  game.teams.home.score = 101;
  game.teams.away.score = 81;
  game.finalMargin = 20;
  game.playByPlayFacts = {
    ...createBackAndForthPlayByPlayFacts(),
    primaryRun: createRunFact({
      endAwayScore: 70,
      endClock: "07:04",
      endHomeScore: 84,
      endQuarter: 4,
      opponentPoints: 10,
      runType: "swing",
      startAwayScore: 60,
      startClock: "04:45",
      startHomeScore: 60,
      startQuarter: 3,
      teamName: "Visionaries",
      teamPoints: 24,
      teamSide: "home",
    }),
  };
  const request = createSingleGameRecapPayload("m-structure-repair").request;
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [game],
      request,
    }),
  });
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game",
  );
  const invalidResult = createRecapCandidateResult({
    headline: "Visionaries beat TarTeam 101-81",
    matchId: "m-structure-repair",
    writeup:
      "The game stayed tight into halftime.\n\nVisionaries found separation after the break.\n\nVisionaries protected the ball and finished the job.",
  });
  const deterministic = __testing.assessGameDayRecapDeterministicPayload(
    invalidResult,
    [expectedGame],
  );
  assert.ok(
    deterministic.issues.some(
      (issue) => issue.kind === "missing_pregame_tactical_setup",
    ),
  );
  assert.ok(
    deterministic.issues.some(
      (issue) => issue.kind === "missing_primary_run_mention",
    ),
  );

  const repaired = await __testing.salvageGameDayRecapResult({
    deterministicIssues: deterministic.issues,
    expectedGames: [expectedGame],
    judgeIssues: [],
    judgeProvider: createPassingJudgeProvider(),
    request,
    result: invalidResult,
  });
  const writeup = repaired.result.games[0]?.writeup ?? "";
  const paragraphs = writeup.split(/\n{2,}/).filter(Boolean);

  assert.match(writeup, /TarTeam paired Motion with 2-3 Zone/i);
  assert.match(writeup, /Visionaries answered with Push the Ball and Man-to-man/i);
  assert.match(writeup, /24-10 run/i);
  assert.match(writeup, /\b(?:across 9 minutes|9-minute push|9-minute surge)\b/i);
  assert.equal(paragraphs.length, 3);
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
  assert.equal(firstGame.seriesContext, undefined);
});

test("buildGameDayRecapPromptPayload adds series context for league-date finals", async () => {
  const standings = createStandings(64, "100", [
    {
      matches: [
        createPlayoffSeriesMatch({
          awayId: "B",
          awayName: "Beta",
          awayScore: 81,
          homeId: "A",
          homeName: "Alpha",
          homeScore: 85,
          id: "f-1",
          startTime: "2026-04-01T19:00:00Z",
          type: "league.final",
        }),
      ],
      name: "finals",
    },
  ]);
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule("A", [
        createPlayoffSeriesMatch({
          awayId: "B",
          awayName: "Beta",
          awayScore: 81,
          homeId: "A",
          homeName: "Alpha",
          homeScore: 85,
          id: "f-1",
          startTime: "2026-04-01T19:00:00Z",
          type: "league.final",
        }),
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        createPlayoffSeriesMatch({
          awayId: "B",
          awayName: "Beta",
          awayScore: 81,
          homeId: "A",
          homeName: "Alpha",
          homeScore: 85,
          id: "f-1",
          startTime: "2026-04-01T19:00:00Z",
          type: "league.final",
        }),
      ]),
    ],
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);

  const payload = await __testing.buildGameDayRecapPromptPayload({
    bb: {
      getBoxScore: async (matchId) => {
        if (matchId !== "f-1") {
          throw new Error(`Unexpected box score ${matchId}`);
        }
        return createBoxScore({
          awayScore: 81,
          awayTeamId: "B",
          awayTeamName: "Beta",
          homeScore: 85,
          homeTeamId: "A",
          homeTeamName: "Alpha",
          matchId: "f-1",
          startTime: "2026-04-01T19:00:00Z",
          type: "league.final",
        });
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
      refreshSortAt: "2026-04-01T23:10:00.000Z",
      status: "CONNECTED",
      userId: "user-1",
    },
    now: new Date("2026-04-01T23:10:00Z"),
    requestedGames: [
      {
        awayTeamId: "B",
        awayTeamName: "Beta",
        homeTeamId: "A",
        homeTeamName: "Alpha",
        isScheduleFinal: true,
        matchId: "f-1",
        scheduledAwayScore: 81,
        scheduledHomeScore: 85,
        startTime: "2026-04-01T19:00:00Z",
        type: "league.final",
      },
    ],
    request: {
      generationApproach: "FACT_LIBRARY_FIRST",
      gameDate: "2026-04-01",
      gameDayNumber: null,
      kind: "LEAGUE_DATE",
      label: "Elite League 2026-04-01",
      leagueId: "100",
      leagueName: "Elite League",
      matchId: null,
      season: 64,
      timeZone: "America/New_York",
    },
    season: 64,
    standings,
    targetKey: "100#2026-04-01",
    userId: "user-1",
  });

  const finalsPromptGame = payload.games[0];
  assert.ok(finalsPromptGame);
  assert.ok(finalsPromptGame.seriesContext);
  assert.ok(finalsPromptGame.factsLibrary);
  assert.equal(
    finalsPromptGame.seriesContext.summaryLine,
    "Alpha leads the series 1-0.",
  );
  assert.notEqual(
    finalsPromptGame.factsLibrary.openingCandidates[0],
    "Alpha leads the series 1-0.",
  );
  assert.match(
    finalsPromptGame.factsLibrary.headlineCandidates[0] ?? "",
    /takes Game 1, leads series 1-0/i,
  );
  assert.match(
    finalsPromptGame.factsLibrary.storySignals.join(" "),
    /series state belongs in the headline/i,
  );
  assert.equal(
    finalsPromptGame.factsLibrary.rankedFacts.some((fact) =>
      fact.claimKey.startsWith("streak_"),
    ),
    false,
  );
  assert.deepStrictEqual(
    finalsPromptGame.factsLibrary.narrativePlan.paragraphOrder,
    [
      "Paragraph 1: manager-battle setup in 1-2 sentences using pregameBattle, both teams' tactics, GDP/prep reads, effort posture, and rotation context when useful.",
      "Paragraph 2: game flow in 3-5 connected cause-and-effect sentences using gameStory.selectedBeats, not a quarter-by-quarter checklist.",
      "Paragraph 3, or paragraphs 3-4 when gameStory.paragraphPlan.targetParagraphs is 4: postgame explanation with player, team edge, slate, series, or unusual stat facts.",
    ],
  );
  assert.deepStrictEqual(finalsPromptGame.factsLibrary.recapSections.sectionOrder, [
    "pregame",
    "game",
    "postgame",
  ]);
  assert.equal(finalsPromptGame.factsLibrary.recapSections.visibleHeadings, false);
});

test("buildGameDayRecapPromptPayload omits series context for league-date semifinals", async () => {
  const standings = createStandings(64, "100", [
    {
      matches: [
        createPlayoffSeriesMatch({
          awayId: "B",
          awayName: "Beta",
          awayScore: 81,
          homeId: "A",
          homeName: "Alpha",
          homeScore: 85,
          id: "sf-1",
          startTime: "2026-03-28T19:00:00Z",
          type: "league.semifinal",
        }),
      ],
      name: "semifinals",
    },
  ]);
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A",
      createSchedule("A", [
        createPlayoffSeriesMatch({
          awayId: "B",
          awayName: "Beta",
          awayScore: 81,
          homeId: "A",
          homeName: "Alpha",
          homeScore: 85,
          id: "sf-1",
          startTime: "2026-03-28T19:00:00Z",
          type: "league.semifinal",
        }),
      ]),
    ],
    [
      "B",
      createSchedule("B", [
        createPlayoffSeriesMatch({
          awayId: "B",
          awayName: "Beta",
          awayScore: 81,
          homeId: "A",
          homeName: "Alpha",
          homeScore: 85,
          id: "sf-1",
          startTime: "2026-03-28T19:00:00Z",
          type: "league.semifinal",
        }),
      ]),
    ],
    ["C", createSchedule("C", [])],
    ["D", createSchedule("D", [])],
  ]);

  const payload = await __testing.buildGameDayRecapPromptPayload({
    bb: {
      getBoxScore: async (matchId) => {
        if (matchId !== "sf-1") {
          throw new Error(`Unexpected box score ${matchId}`);
        }
        return createBoxScore({
          awayScore: 81,
          awayTeamId: "B",
          awayTeamName: "Beta",
          homeScore: 85,
          homeTeamId: "A",
          homeTeamName: "Alpha",
          matchId: "sf-1",
          startTime: "2026-03-28T19:00:00Z",
          type: "league.semifinal",
        });
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
      refreshSortAt: "2026-03-28T23:10:00.000Z",
      status: "CONNECTED",
      userId: "user-1",
    },
    now: new Date("2026-03-28T23:10:00Z"),
    requestedGames: [
      {
        awayTeamId: "B",
        awayTeamName: "Beta",
        homeTeamId: "A",
        homeTeamName: "Alpha",
        isScheduleFinal: true,
        matchId: "sf-1",
        scheduledAwayScore: 81,
        scheduledHomeScore: 85,
        startTime: "2026-03-28T19:00:00Z",
        type: "league.semifinal",
      },
    ],
    request: {
      generationApproach: "FACT_LIBRARY_FIRST",
      gameDate: "2026-03-28",
      gameDayNumber: null,
      kind: "LEAGUE_DATE",
      label: "Elite League 2026-03-28",
      leagueId: "100",
      leagueName: "Elite League",
      matchId: null,
      season: 64,
      timeZone: "America/New_York",
    },
    season: 64,
    standings,
    targetKey: "100#2026-03-28",
    userId: "user-1",
  });

  const semifinalPromptGame = payload.games[0];
  assert.ok(semifinalPromptGame);
  assert.equal(semifinalPromptGame.seriesContext, undefined);
  assert.ok(semifinalPromptGame.factsLibrary);
});

test("prose recap request normalization defaults to fact-library-first and pg13 intensity while key builders preserve legacy compatibility", () => {
  const normalizedRequest = __testing.normalizeGameDayRecapRequest({
    gameDate: "2026-03-15",
    leagueId: "100",
  });
  assert.equal(
    normalizedRequest.approach,
    "FACT_LIBRARY_FIRST",
  );
  assert.equal(normalizedRequest.interviewIntensity, "pg13");
  assert.equal(normalizedRequest.modelJudgeEnabled, false);
  assert.equal(
    __testing.buildGameDayRecapTargetKey("100", "2026-03-15"),
    "100#2026-03-15",
  );
  assert.equal(
    __testing.buildGameDayRecapTargetKey(
      "100",
      "2026-03-15",
      "FACT_LIBRARY_FIRST",
      "standard",
      true,
      "pg13",
    ),
    "100#2026-03-15#fact-library-first#quality-standard#model-judge",
  );
  assert.equal(
    __testing.buildLeagueGameDayRecapTargetKey(
      "100",
      3,
      71,
      "FACT_LIBRARY_FIRST",
      null,
      true,
      "pg13",
    ),
    "100#71#gameday-3#fact-library-first#model-judge",
  );
  assert.equal(
    __testing.buildSingleGameSummaryTargetKey(
      "137828772",
      "FACT_LIBRARY_FIRST",
      "premium",
      true,
      "pg13",
      null,
      null,
    ),
    "137828772#fact-library-first#quality-premium#model-judge",
  );
  assert.deepStrictEqual(
    __testing.normalizeSingleGameSummaryRequest({
      loserInterviewPersonalityType: "curt",
      matchId: "137828772",
      winnerInterviewPersonalityType: "deadpan",
    }),
    {
      approach: "FACT_LIBRARY_FIRST",
      interviewIntensity: "pg13",
      loserInterviewPersonalityType: "curt",
      matchId: "137828772",
      modelJudgeEnabled: false,
      winnerInterviewPersonalityType: "deadpan",
    },
  );
  assert.equal(
    __testing.buildSingleGameSummaryTargetKey(
      "137828772",
      "FACT_LIBRARY_FIRST",
      "premium",
      true,
      "pg13",
      "deadpan",
      "curt",
    ),
    "137828772#fact-library-first#quality-premium#winner-voice-deadpan#loser-voice-curt#model-judge",
  );
  assert.equal(
    __testing.buildGameDayRecapTargetKey(
      "100",
      "2026-03-15",
      "FACT_LIBRARY_FIRST",
      "standard",
      true,
      "full_heat",
    ),
    "100#2026-03-15#fact-library-first#quality-standard#intensity-full-heat#model-judge",
  );
  assert.equal(
    __testing.buildLeagueGameDayRecapTargetKey(
      "100",
      3,
      71,
      "FACT_LIBRARY_FIRST",
      null,
      false,
      "clean",
    ),
    "100#71#gameday-3#fact-library-first#intensity-clean",
  );
  assert.equal(
    __testing.normalizeGameDayRecapRequest({
      gameDate: "2026-03-15",
      interviewIntensity: "full_heat",
      leagueId: "100",
      modelJudgeEnabled: true,
    }).interviewIntensity,
    "full_heat",
  );
  assert.equal(
    __testing.normalizeGameDayRecapRequest({
      gameDate: "2026-03-15",
      interviewIntensity: "full_heat",
      leagueId: "100",
      modelJudgeEnabled: true,
    }).modelJudgeEnabled,
    true,
  );
  assert.equal(
    __testing.normalizeGameDayRecapRequest({
      gameDate: "2026-03-15",
      leagueId: "100",
      qualityTier: "standard",
    }).qualityTier,
    "standard",
  );
  assert.equal(
    __testing.buildGameDayRecapTargetKey(
      "100",
      "2026-03-15",
      "FACT_LIBRARY_FIRST",
      "standard",
    ),
    "100#2026-03-15#fact-library-first#quality-standard",
  );
  assert.equal(
    __testing.buildLeagueGameDayRecapTargetKey(
      "100",
      3,
      71,
      "FACT_LIBRARY_FIRST",
      "premium",
    ),
    "100#71#gameday-3#fact-library-first#quality-premium",
  );
  assert.equal(
    __testing.parseGameDayRecapQueueMessage(
      JSON.stringify({
        kind: "SINGLE_GAME",
        qualityTier: "standard",
        requestedAt: "2026-03-15T22:30:00.000Z",
        targetKey: "137828772#fact-library-first",
        userId: "user-1",
      }),
    ).interviewIntensity,
    "pg13",
  );
  assert.equal(
    __testing.parseGameDayRecapQueueMessage(
      JSON.stringify({
        interviewIntensity: "clean",
        kind: "SINGLE_GAME",
        qualityTier: "standard",
        requestedAt: "2026-03-15T22:30:00.000Z",
        targetKey: "137828772#fact-library-first#intensity-clean",
        userId: "user-1",
      }),
    ).modelJudgeEnabled,
    false,
  );
  assert.equal(
    __testing.parseGameDayRecapQueueMessage(
      JSON.stringify({
        interviewIntensity: "clean",
        kind: "SINGLE_GAME",
        qualityTier: "standard",
        requestedAt: "2026-03-15T22:30:00.000Z",
        targetKey: "137828772#fact-library-first#intensity-clean",
        userId: "user-1",
      }),
    ).interviewIntensity,
    "clean",
  );

  const factLibraryPayload = createSingleGameRecapPayload("legacy-check");
  const legacyWriterPayload =
    __testing.buildGameDayRecapWriterPayloadFromFactStore({
      coverage: factLibraryPayload.coverage,
      factStore: {
        ...factLibraryPayload.factStore,
        request: {
          ...factLibraryPayload.factStore.request,
          generationApproach: "LEGACY",
        },
      },
    });
  assert.equal("factsLibrary" in legacyWriterPayload.games[0]!, false);
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
    targetKey: "100#2026-03-15#fact-library-first",
  });
  assert.equal(upserted, false);
  assert.equal(started, false);
});

test("submitGameDayRecap reruns terminal jobs in place", async () => {
  let queuedMessage: {
    kind: string;
    modelId?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
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
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
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
  const rerunMessage = expectPresent<{
    kind: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  }>(queuedMessage, "startWorkflowExecution did not receive a rerun message");
  assert.equal(rerunMessage.kind, "LEAGUE_DATE");
  assert.equal(rerunMessage.targetKey, "100#2026-03-15#fact-library-first");
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
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:premium";
      },
      getGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: (args) =>
        requireFeatureAccess(args, {
          createPortalSession: async () => ({
            url: "https://example.com/portal",
          }),
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
    targetKey: "100#2026-03-15#fact-library-first",
  });
  const premiumMessage = expectPresent<{
    kind: string;
    modelId?: string;
    qualityTier: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  }>(queuedMessage, "startWorkflowExecution did not receive a premium message");
  assert.equal(premiumMessage.kind, "LEAGUE_DATE");
  assert.equal(premiumMessage.modelId, DEFAULT_RECAP_MODEL_ID);
  assert.equal(premiumMessage.qualityTier, "premium");
  assert.equal(premiumMessage.targetKey, "100#2026-03-15#fact-library-first");
});

test("submitGameDayRecap routes premium quality when commercial mode disables billing gates", async () => {
  let queuedMessage: {
    modelId?: string;
    qualityTier?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;
  let savedQualityTier: string | null = null;

  const result = await submitGameDayRecap(
    {
      env: createRecapEnv({
        COMMERCIAL_MODE_ENABLED: "false",
        GAME_DAY_RECAP_MODEL_ID_PREMIUM: PREMIUM_RECAP_MODEL_ID,
      }),
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      getGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: (args) =>
        requireFeatureAccess(args, {
          createPortalSession: async () => ({
            url: "https://example.com/portal",
          }),
          createSubscriptionCheckoutSession: async () => ({
            url: "https://example.com/checkout",
          }),
          getBillingAccount: async () => null,
          getStripeSubscription: async () => ({
            id: "sub_123",
          }),
          upsertBillingAccount: async () => {},
        }),
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-date";
      },
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async (_env, record: any) => {
        savedModelId = record.modelId ?? null;
        savedQualityTier = record.requestJson?.qualityTier ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-date",
    targetKey: "100#2026-03-15#fact-library-first",
  });
  assert.equal(savedModelId, PREMIUM_RECAP_MODEL_ID);
  assert.equal(savedQualityTier, "premium");
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    PREMIUM_RECAP_MODEL_ID,
  );
  assert.equal(
    (queuedMessage as { qualityTier?: string } | null)?.qualityTier,
    "premium",
  );
});

test("submitGameDayRecap honors an explicit standard qualityTier override", async () => {
  let queuedMessage: {
    modelId?: string;
    qualityTier?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;
  let savedQualityTier: string | null = null;

  const result = await submitGameDayRecap(
    {
      env: createRecapEnv({
        COMMERCIAL_MODE_ENABLED: "false",
        GAME_DAY_RECAP_MODEL_ID_PREMIUM: PREMIUM_RECAP_MODEL_ID,
      }),
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      qualityTier: "standard",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      getGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:standard-debug";
      },
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async (_env, record: any) => {
        savedModelId = record.modelId ?? null;
        savedQualityTier = record.requestJson?.qualityTier ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:standard-debug",
    targetKey: "100#2026-03-15#fact-library-first#quality-standard",
  });
  assert.equal(savedModelId, DEFAULT_RECAP_MODEL_ID);
  assert.equal(savedQualityTier, "standard");
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    DEFAULT_RECAP_MODEL_ID,
  );
  assert.equal(
    (queuedMessage as { qualityTier?: string } | null)?.qualityTier,
    "standard",
  );
});

test("submitGameDayRecap persists modelJudgeEnabled and target-key suffix when enabled", async () => {
  let queuedMessage: {
    modelJudgeEnabled?: boolean;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelJudgeEnabled: boolean | null = null;

  const result = await submitGameDayRecap(
    {
      env: createRecapEnv(),
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      leagueId: "100",
      modelJudgeEnabled: true,
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      getGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:model-judge";
      },
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async (_env, record: any) => {
        savedModelJudgeEnabled = record.requestJson?.modelJudgeEnabled ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:model-judge",
    targetKey: "100#2026-03-15#fact-library-first#model-judge",
  });
  assert.equal(savedModelJudgeEnabled, true);
  assert.equal(
    (queuedMessage as { modelJudgeEnabled?: boolean } | null)
      ?.modelJudgeEnabled,
    true,
  );
});

test("submitGameDayRecap persists interviewIntensity on the stored request and queue payload", async () => {
  let queuedMessage: {
    interviewIntensity?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedInterviewIntensity: string | null = null;

  const result = await submitGameDayRecap(
    {
      env: createRecapEnv(),
      gameDate: "2026-03-15",
      identity: { sub: "user-1" },
      interviewIntensity: "full_heat",
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      getGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message as typeof queuedMessage;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:intensity";
      },
      updateGameDayRecap: async () => {},
      upsertGameDayRecap: async (_env, record: any) => {
        savedInterviewIntensity = record.requestJson?.interviewIntensity ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:intensity",
    targetKey: "100#2026-03-15#fact-library-first#intensity-full-heat",
  });
  assert.equal(savedInterviewIntensity, "full_heat");
  assert.equal(
    (queuedMessage as { interviewIntensity?: string } | null)
      ?.interviewIntensity,
    "full_heat",
  );
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

test("resolveRecapQualityTier maps billing plans to explicit recap tiers", () => {
  assert.equal(__testing.resolveRecapQualityTier("free"), "standard");
  assert.equal(__testing.resolveRecapQualityTier("premium"), "premium");
});

test("resolveConfiguredRecapStageModelIds falls back to the premium writer model for missing premium judge and retry stages", () => {
  const stageModels = __testing.resolveConfiguredRecapStageModelIds(
    createRecapEnv({
      GAME_DAY_RECAP_JUDGE_MODEL_ID: undefined,
      GAME_DAY_RECAP_JUDGE_MODEL_ID_PREMIUM: undefined,
      GAME_DAY_RECAP_MODEL_ID_PREMIUM: PREMIUM_RECAP_MODEL_ID,
      GAME_DAY_RECAP_RETRY_MODEL_ID: undefined,
      GAME_DAY_RECAP_RETRY_MODEL_ID_PREMIUM: undefined,
    }),
    "premium",
  );

  assert.deepStrictEqual(stageModels, {
    judgeModelId: PREMIUM_RECAP_MODEL_ID,
    retryModelId: PREMIUM_RECAP_MODEL_ID,
    writerModelId: PREMIUM_RECAP_MODEL_ID,
  });
});

test("resolveGameDayRecapRuntimeConfig applies full-slate concurrency defaults and overrides", () => {
  const defaults = __testing.resolveGameDayRecapRuntimeConfig({});

  assert.equal(defaults.contextConcurrency, 4);
  assert.equal(defaults.judgeConcurrency, 4);
  assert.equal(defaults.polishConcurrency, 2);
  assert.equal(defaults.interviewConcurrency, 2);
  assert.equal(defaults.fullSlatePolishMode, "auto");

  const configured = __testing.resolveGameDayRecapRuntimeConfig({
    GAME_DAY_RECAP_CONTEXT_CONCURRENCY: "3",
    GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE: "always",
    GAME_DAY_RECAP_INTERVIEW_CONCURRENCY: "1",
    GAME_DAY_RECAP_JUDGE_CONCURRENCY: "6",
    GAME_DAY_RECAP_POLISH_CONCURRENCY: "0",
  });

  assert.equal(configured.contextConcurrency, 3);
  assert.equal(configured.judgeConcurrency, 6);
  assert.equal(configured.polishConcurrency, 2);
  assert.equal(configured.interviewConcurrency, 1);
  assert.equal(configured.fullSlatePolishMode, "always");
});

test("submitLeagueGameDayRecap routes premium quality when commercial mode disables billing gates", async () => {
  let queuedMessage: {
    modelId?: string;
    qualityTier?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;
  let savedQualityTier: string | null = null;

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
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-day";
      },
      getLeagueGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: (args) =>
        requireFeatureAccess(args, {
          createPortalSession: async () => ({
            url: "https://example.com/portal",
          }),
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
        savedQualityTier = record.requestJson?.qualityTier ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-day",
    targetKey: "100#71#gameday-3#fact-library-first",
  });
  assert.equal(savedModelId, PREMIUM_RECAP_MODEL_ID);
  assert.equal(savedQualityTier, "premium");
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    PREMIUM_RECAP_MODEL_ID,
  );
  assert.equal(
    (queuedMessage as { qualityTier?: string } | null)?.qualityTier,
    "premium",
  );
});

test("submitLeagueGameDayPerformances queues a deterministic league game-day report without premium gating", async () => {
  let queuedMessage: {
    kind?: string;
    qualityTier?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedRecord: Record<string, unknown> | null = null;

  const result = await submitLeagueGameDayPerformances(
    {
      env: createRecapEnv(),
      gameDayNumber: 3,
      identity: { sub: "user-1" },
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
      season: 71,
    },
    {
      assertMaintenanceInactive: async () => {},
      getLeagueGameDayPerformances: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => {
        throw new Error(
          "premium gating should not run for league game day performances",
        );
      },
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:performances";
      },
      updateLeagueGameDayPerformances: async () => {},
      upsertLeagueGameDayPerformances: async (_env, record: any) => {
        savedRecord = record;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:performances",
    targetKey: "100#71#gameday-3",
  });
  assert.ok(savedRecord);
  assert.equal(savedRecord["modelProvider"], "deterministic");
  assert.equal(savedRecord["modelId"], null);
  assert.equal(savedRecord["promptVersion"], null);
  const savedRequestJson = savedRecord["requestJson"] as { mode?: string };
  assert.equal(savedRequestJson.mode, "LEAGUE_GAME_DAY_PERFORMANCES");
  assert.equal(
    (queuedMessage as { kind?: string } | null)?.kind,
    "LEAGUE_GAME_DAY_PERFORMANCES",
  );
  assert.equal(
    (queuedMessage as { qualityTier?: string } | null)?.qualityTier,
    "standard",
  );
});

test("resolveQueuedRecapModelId prefers the model on the queue message", () => {
  const modelId = __testing.resolveQueuedRecapModelId(
    {
      kind: "LEAGUE_DATE",
      modelId: PREMIUM_RECAP_MODEL_ID,
      qualityTier: "premium",
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
      qualityTier: "standard",
      requestedAt: "2026-03-15T22:30:00Z",
      targetKey: "100#2026-03-15",
      userId: "user-1",
    },
    DEFAULT_RECAP_MODEL_ID,
  );

  assert.equal(modelId, DEFAULT_RECAP_MODEL_ID);
});

test("resolveQueuedRecapStageModelIds reuses the standard writer model as the judge fallback", () => {
  const stageModels = __testing.resolveQueuedRecapStageModelIds({
    env: createRecapEnv({
      GAME_DAY_RECAP_JUDGE_MODEL_ID: undefined,
    }),
    fallbackModelId: DEFAULT_RECAP_MODEL_ID,
    message: {
      kind: "LEAGUE_DATE",
      qualityTier: "standard",
      requestedAt: "2026-03-15T22:30:00.000Z",
      targetKey: "100#2026-03-15#fact-library-first",
      userId: "user-1",
    },
  });

  assert.deepStrictEqual(stageModels, {
    judgeModelId: DEFAULT_RECAP_MODEL_ID,
    retryModelId: null,
    writerModelId: DEFAULT_RECAP_MODEL_ID,
  });
});

test("resolveQueuedRecapStageModelIds falls back to the premium writer model for missing premium judge and retry stages", () => {
  const stageModels = __testing.resolveQueuedRecapStageModelIds({
    env: createRecapEnv({
      GAME_DAY_RECAP_JUDGE_MODEL_ID: undefined,
      GAME_DAY_RECAP_JUDGE_MODEL_ID_PREMIUM: undefined,
      GAME_DAY_RECAP_MODEL_ID_PREMIUM: PREMIUM_RECAP_MODEL_ID,
      GAME_DAY_RECAP_RETRY_MODEL_ID: undefined,
      GAME_DAY_RECAP_RETRY_MODEL_ID_PREMIUM: undefined,
    }),
    fallbackModelId: DEFAULT_RECAP_MODEL_ID,
    message: {
      kind: "LEAGUE_DATE",
      modelId: PREMIUM_RECAP_MODEL_ID,
      qualityTier: "premium",
      requestedAt: "2026-03-15T22:30:00.000Z",
      targetKey: "100#2026-03-15#fact-library-first",
      userId: "user-1",
    },
  });

  assert.deepStrictEqual(stageModels, {
    judgeModelId: PREMIUM_RECAP_MODEL_ID,
    retryModelId: PREMIUM_RECAP_MODEL_ID,
    writerModelId: PREMIUM_RECAP_MODEL_ID,
  });
});

test("submitLeagueGameDayRecap persists the routed modelId on the record and queue message", async () => {
  let queuedMessage: {
    modelId?: string;
    modelJudgeEnabled?: boolean;
    qualityTier?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;
  let savedModelJudgeEnabled: boolean | null = null;
  let savedQualityTier: string | null = null;

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
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-day";
      },
      getLeagueGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      updateLeagueGameDayRecap: async () => {},
      upsertLeagueGameDayRecap: async (_env, record: any) => {
        savedModelId = record.modelId ?? null;
        savedModelJudgeEnabled = record.requestJson?.modelJudgeEnabled ?? null;
        savedQualityTier = record.requestJson?.qualityTier ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-day",
    targetKey: "100#71#gameday-3#fact-library-first",
  });
  assert.equal(savedModelId, PREMIUM_RECAP_MODEL_ID);
  assert.equal(savedModelJudgeEnabled, false);
  assert.equal(savedQualityTier, "premium");
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    PREMIUM_RECAP_MODEL_ID,
  );
  assert.equal(
    (queuedMessage as { modelJudgeEnabled?: boolean } | null)
      ?.modelJudgeEnabled,
    false,
  );
  assert.equal(
    (queuedMessage as { qualityTier?: string } | null)?.qualityTier,
    "premium",
  );
});

test("submitLeagueGameDayRecap distinguishes explicit interview intensity in the target key and queue payload", async () => {
  let queuedMessage: {
    interviewIntensity?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedInterviewIntensity: string | null = null;

  const result = await submitLeagueGameDayRecap(
    {
      env: createRecapEnv(),
      gameDayNumber: 3,
      identity: { sub: "user-1" },
      interviewIntensity: "clean",
      leagueId: "100",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
      season: 71,
    },
    {
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message as typeof queuedMessage;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-clean";
      },
      getLeagueGameDayRecap: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      updateLeagueGameDayRecap: async () => {},
      upsertLeagueGameDayRecap: async (_env, record: any) => {
        savedInterviewIntensity = record.requestJson?.interviewIntensity ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:league-clean",
    targetKey: "100#71#gameday-3#fact-library-first#intensity-clean",
  });
  assert.equal(savedInterviewIntensity, "clean");
  assert.equal(
    (queuedMessage as { interviewIntensity?: string } | null)
      ?.interviewIntensity,
    "clean",
  );
});

test("submitSingleGameSummary persists the routed modelId on the record and queue message", async () => {
  let queuedMessage: {
    modelId?: string;
    modelJudgeEnabled?: boolean;
    qualityTier?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;
  let savedModelJudgeEnabled: boolean | null = null;
  let savedQualityTier: string | null = null;

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
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:single";
      },
      getSingleGameSummary: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      updateSingleGameSummary: async () => {},
      upsertSingleGameSummary: async (_env, record: any) => {
        savedModelId = record.modelId ?? null;
        savedModelJudgeEnabled = record.requestJson?.modelJudgeEnabled ?? null;
        savedQualityTier = record.requestJson?.qualityTier ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:single",
    targetKey: "137828772#fact-library-first",
  });
  assert.equal(savedModelId, PREMIUM_RECAP_MODEL_ID);
  assert.equal(savedModelJudgeEnabled, false);
  assert.equal(savedQualityTier, "premium");
  assert.equal(
    (queuedMessage as { modelId?: string } | null)?.modelId,
    PREMIUM_RECAP_MODEL_ID,
  );
  assert.equal(
    (queuedMessage as { modelJudgeEnabled?: boolean } | null)
      ?.modelJudgeEnabled,
    false,
  );
  assert.equal(
    (queuedMessage as { qualityTier?: string } | null)?.qualityTier,
    "premium",
  );
});

test("submitSingleGameSummary distinguishes explicit interview intensity in the target key and queue payload", async () => {
  let queuedMessage: {
    interviewIntensity?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedInterviewIntensity: string | null = null;

  const result = await submitSingleGameSummary(
    {
      env: createRecapEnv(),
      identity: { sub: "user-1" },
      interviewIntensity: "full_heat",
      matchId: "137828772",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:gameday-recap",
    },
    {
      startWorkflowExecution: async (
        _stateMachineArn,
        _executionName,
        message,
      ) => {
        queuedMessage = message as typeof queuedMessage;
        return "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:single-heat";
      },
      getSingleGameSummary: async () => null,
      now: () => new Date("2026-03-15T22:30:00Z"),
      requireFeatureAccess: async () => "premium",
      updateSingleGameSummary: async () => {},
      upsertSingleGameSummary: async (_env, record: any) => {
        savedInterviewIntensity = record.requestJson?.interviewIntensity ?? null;
      },
    },
  );

  assert.deepStrictEqual(result, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:single-heat",
    targetKey: "137828772#fact-library-first#intensity-full-heat",
  });
  assert.equal(savedInterviewIntensity, "full_heat");
  assert.equal(
    (queuedMessage as { interviewIntensity?: string } | null)
      ?.interviewIntensity,
    "full_heat",
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
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
              stage,
            },
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
  assert.equal(providerCalls, 2);
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

test("processGameDayRecap keeps running when one game's play-by-play fetch fails", async () => {
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
          awayTeam: { id: "D", score: 90, teamName: "Delta" },
          homeTeam: { id: "C", score: 94, teamName: "Gamma" },
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
          awayTeam: { id: "D", score: 90, teamName: "Delta" },
          homeTeam: { id: "C", score: 94, teamName: "Gamma" },
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
    [
      "m-2",
      createBoxScore({
        awayScore: 90,
        awayTeamId: "D",
        awayTeamName: "Delta",
        homeScore: 94,
        homeTeamId: "C",
        homeTeamName: "Gamma",
        matchId: "m-2",
      }),
    ],
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let capturedPayload: {
    games: Array<{
      matchId: string;
      playByPlayFacts: unknown;
      playByPlaySummaryLines: string[];
    }>;
  } | null = null;

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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                capturedPayload = payload;
                return {
                  games: payload.games.map((game) => ({
                    evidenceTags: ["recent_form"],
                    headline: `Recap for ${game.matchId}`,
                    matchId: game.matchId,
                    writeup:
                      `${game.teams.home.name} had enough to close out ${game.teams.away.name}. ${game.playByPlaySummaryLines.find((line) => /\brun\b/i.test(line)) ?? ""}`.trim(),
                  })),
                  summary: {
                    headline: "Elite League roundup",
                    lede: "The recap kept moving even though one game's public play-by-play could not be loaded.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
      fetchPublicMatchPlayByPlay: async (matchId) => {
        if (String(matchId) === "m-2") {
          throw new Error("temporary play-by-play outage");
        }
        return createPublicPlayByPlay({
          matchId: String(matchId),
        });
      },
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

  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  const payload = expectPresent(capturedPayload, "missing captured payload");
  assert.equal(payload.games.length, 2);
  assert.ok(
    payload.games[0]?.playByPlaySummaryLines.includes(
      "Late-game swings: Alpha tied it at 4-4 with 00:30 left in the 4th quarter; Alpha went ahead 6-4 with 00:10 left in the 4th quarter.",
    ),
  );
  assert.ok(
    !payload.games[0]?.playByPlaySummaryLines.some((line) =>
      /\b6-2 run\b/i.test(line),
    ),
  );
  assert.deepStrictEqual(payload.games[1]?.playByPlaySummaryLines, []);
  assert.equal(payload.games[1]?.playByPlayFacts, null);
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload, options) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
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
                      lede: "The first draft needed one repair after a tied quarter was described as if one side had won it outright.",
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
                    lede: "A repaired recap kept the tied third quarter accurate and shifted the emphasis to the fourth-quarter push that actually settled the result.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
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
  assert.ok(
    providerCalls[1]?.some((feedback) => feedback.includes("tied 24-24")),
  );
  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
});

test("processGameDayRecap retries after remaining hard validation failures", async () => {
  const recapRecord = {
    gameDate: "2026-03-15",
    leagueId: "100",
    requestJson: {
      gameDate: "2026-03-15",
      leagueId: "100",
    },
    requestedAt: "2026-03-16T00:15:00Z",
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
            homeScore: 92,
            homeTeamId: "A",
            homeTeamName: "Alpha",
            matchId: "m-1",
          }),
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload, options) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                providerCalls.push(options?.validationFeedback);
                if (!options?.validationFeedback?.length) {
                  return {
                    games: payload.games.map((game) => ({
                      evidenceTags: ["recent_form"],
                      headline: `Recap for ${game.matchId}`,
                      matchId: game.matchId,
                      writeup:
                        "Alpha controlled the fourth quarter and closed the game. Alpha beat Beta 92-81. The answer came at a key juncture. The win snapped a one-game losing streak.",
                    })),
                    summary: {
                      headline: "Elite League roundup",
                      lede: "The retry path should kick in when a draft is factual enough but still breaks the style rules.",
                    },
                  };
                }

                return {
                  games: payload.games.map((game) => ({
                    evidenceTags: ["recent_form"],
                    headline: `Recap for ${game.matchId}`,
                    matchId: game.matchId,
                    writeup:
                      "Alpha controlled the fourth quarter and closed without letting Beta make the final margin interesting.",
                  })),
                  summary: {
                    headline: "Elite League roundup",
                    lede: "The corrected draft removed the duplicate score sentence, dropped the filler, and stayed away from fake one-game streak language.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-18T00:15:00.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getGameDayRecap: async () => recapRecord,
      now: () => new Date("2026-03-18T00:15:00Z"),
      resolveBbAccessKey: async () => "secret",
      updateGameDayRecap: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(providerCalls.length, 2);
  assert.equal(providerCalls[0], undefined);
  assert.ok(
    providerCalls[1]?.some((feedback) =>
      feedback.includes("throwaway sentence"),
    ),
  );
  assert.ok(
    providerCalls[1]?.some((feedback) =>
      feedback.includes("one-game win or loss as a streak"),
    ),
  );
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
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
                    lede: "The bad quarter claim persisted across both attempts, so the worker had to repair the contradiction before saving the recap.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
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
    (finalUpdate.resultJson as { games: Array<{ writeup: string }> }).games[0]
      ?.writeup ?? "",
    "The 3rd quarter ended tied at 24-24. Alpha prepared well for Inside looks; Beta prepared well for a Balanced attack. On pace, Alpha prepared well for Fast pace; Beta prepared well for Normal pace.",
  );
});

test("processGameDayRecap keeps invalid generated games and marks validation warnings", async () => {
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
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
                    lede: "Both finals were summarized at first, but one game recap kept a contradiction in the headline that could not be safely repaired.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
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
    availableGames: 2,
    missingGames: [],
    partial: false,
    requestedGames: 2,
  });
  assert.deepStrictEqual(
    (
      finalUpdate.resultJson as {
        games: Array<{
          matchId: string;
          validation?: { issueCount: number; status: string };
        }>;
        summary: { headline: string; lede: string };
      }
    ).games.map((game) => game.matchId),
    ["m-1", "m-2"],
  );
  assert.equal(
    (finalUpdate.resultJson as { summary: { headline: string } }).summary
      .headline,
    "Elite League roundup",
  );
  const failedGame = (
    finalUpdate.resultJson as {
      games: Array<{
        matchId: string;
        validation?: { issueCount: number; status: string };
      }>;
    }
  ).games.find((game) => game.matchId === "m-2");
  const failedGameValidation = expectPresent(
    expectPresent(failedGame, "missing failed game").validation,
    "missing failed game validation",
  );
  assert.equal(failedGameValidation.status, "UNSAFE");
  assert.ok(failedGameValidation.issueCount >= 1);
});

test("processGameDayRecap saves a structured suspect result when every game has validation issues", async () => {
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
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
                    lede: "The remaining contradiction lived in the headline, so the worker should save the generated story with validation warnings.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
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
  assert.equal(finalUpdate.error, null);
  const resultJson = finalUpdate.resultJson as {
    games: Array<{
      validation?: {
        issueCount: number;
        issues: Array<{ kind: string; reason: string }>;
        status: string;
      };
    }>;
  };
  assert.equal(resultJson.games.length, 1);
  const suspectGameValidation = expectPresent(
    expectPresent(resultJson.games[0], "missing suspect game").validation,
    "missing suspect game validation",
  );
  assert.equal(suspectGameValidation.status, "UNSAFE");
  assert.ok(suspectGameValidation.issueCount >= 1);
  assert.ok(
    suspectGameValidation.issues.some(
      (issue) => issue.kind === "tied_quarter_claim",
    ),
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
  const scheduleCalls: Array<{
    season: number | undefined;
    teamId: string | undefined;
  }> = [];
  let seasonsFetched = 0;
  const updates: Array<Record<string, unknown>> = [];
  const currentStandings = createStandings(71);
  const schedules = new Map<string, BBApiSchedule>([
    [
      "A:71",
      createSchedule(
        "A",
        [
          {
            awayTeam: { id: "B", score: 81, teamName: "Beta" },
            homeTeam: { id: "A", score: 85, teamName: "Alpha" },
            id: "m-1",
            startTime: "2026-03-10T19:00:00Z",
            type: "League",
          },
        ],
        71,
      ),
    ],
    [
      "B:71",
      createSchedule(
        "B",
        [
          {
            awayTeam: { id: "B", score: 81, teamName: "Beta" },
            homeTeam: { id: "A", score: 85, teamName: "Alpha" },
            id: "m-1",
            startTime: "2026-03-10T19:00:00Z",
            type: "League",
          },
        ],
        71,
      ),
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
          const schedule = schedules.get(
            `${teamId ?? ""}:${season ?? "current"}`,
          );
          if (!schedule) {
            throw new Error(
              `Missing schedule for ${teamId} in season ${String(season)}`,
            );
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                return {
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
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
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
      createSchedule(
        "A",
        [
          {
            awayTeam: { id: "B", score: 81, teamName: "Beta" },
            homeTeam: { id: "A", score: 85, teamName: "Alpha" },
            id: "m-1",
            startTime: "2026-01-10T19:00:00Z",
            type: "League",
          },
        ],
        70,
      ),
    ],
    [
      "B:70",
      createSchedule(
        "B",
        [
          {
            awayTeam: { id: "B", score: 81, teamName: "Beta" },
            homeTeam: { id: "A", score: 85, teamName: "Alpha" },
            id: "m-1",
            startTime: "2026-01-10T19:00:00Z",
            type: "League",
          },
        ],
        70,
      ),
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
          const schedule = schedules.get(
            `${teamId ?? ""}:${season ?? "current"}`,
          );
          if (!schedule) {
            throw new Error(
              `Missing schedule for ${teamId} in season ${String(season)}`,
            );
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                return {
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
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
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
          getStandings: async (_leagueId, season) =>
            createStandings(season ?? 71),
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
      createSchedule(
        "A",
        [
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
        ],
        71,
      ),
    ],
    [
      "B",
      createSchedule(
        "B",
        [
          {
            awayTeam: { id: "B", score: 82, teamName: "Beta" },
            homeTeam: { id: "A", score: 95, teamName: "Alpha" },
            id: "g1",
            startTime: "2026-02-10T00:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
    [
      "C",
      createSchedule(
        "C",
        [
          {
            awayTeam: { id: "A", score: 87, teamName: "Alpha" },
            homeTeam: { id: "C", score: 91, teamName: "Gamma" },
            id: "g2",
            startTime: "2026-02-17T00:00:00Z",
            type: "League",
          },
        ],
        71,
      ),
    ],
    [
      "D",
      createSchedule(
        "D",
        [
          {
            awayTeam: { id: "D", score: 98, teamName: "Delta" },
            homeTeam: { id: "A", score: 114, teamName: "Alpha" },
            id: "137828772",
            startTime: "2026-03-04T01:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
  ]);
  let capturedLeagueGameDayPayload: {
    games: Array<{ playByPlaySummaryLines: string[] }>;
  } | null = null;

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
          throw new Error(
            "league game-day recaps should not fetch seasons when season is explicit",
          );
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                capturedLeagueGameDayPayload = payload;
                return {
                  games: payload.games.map((game) => ({
                    evidenceTags: ["recent_form"],
                    headline: `Recap for ${game.matchId}`,
                    matchId: game.matchId,
                    writeup:
                      game.playByPlaySummaryLines.find((line) =>
                        /\b6-2 run\b/i.test(line),
                      ) ?? `${game.teams.home.name} won comfortably.`,
                  })),
                  summary: {
                    headline: "NBBA game day roundup",
                    lede: "The requested regular-season game day resolved from ordered league schedules without any calendar-date filtering.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
      fetchPublicMatchPlayByPlay: async (matchId) =>
        createPublicPlayByPlay({
          matchId: String(matchId),
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
  assert.equal(
    updates.at(-1)?.promptVersion,
    __testing.GAME_DAY_RECAP_PROMPT_VERSION,
  );
  assert.ok(
    capturedLeagueGameDayPayload?.games[0]?.playByPlaySummaryLines.includes(
      "Late-game swings: Alpha tied it at 4-4 with 00:30 left in the 4th quarter; Alpha went ahead 6-4 with 00:10 left in the 4th quarter.",
    ),
  );
  assert.ok(
    !capturedLeagueGameDayPayload?.games[0]?.playByPlaySummaryLines.some(
      (line) => /\b6-2 run\b/i.test(line),
    ),
  );
});

test("processLeagueGameDayPerformances reuses the league game-day slate resolution and never invokes writer stages", async () => {
  const performancesRecord = {
    gameDayNumber: 3,
    leagueId: "1",
    requestJson: {
      gameDayNumber: 3,
      leagueId: "1",
      mode: "LEAGUE_GAME_DAY_PERFORMANCES",
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
      createSchedule(
        "A",
        [
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
            awayTeam: { id: "A", score: 87, teamName: "Alpha" },
            homeTeam: { id: "C", score: 91, teamName: "Gamma" },
            id: "g2",
            startTime: "2026-02-17T00:00:00Z",
            type: "League",
          },
          {
            awayTeam: { id: "D", score: 98, teamName: "Delta" },
            homeTeam: { id: "A", score: 114, teamName: "Visionaries" },
            id: "137828772",
            startTime: "2026-03-04T01:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
    [
      "B",
      createSchedule(
        "B",
        [
          {
            awayTeam: { id: "B", score: 82, teamName: "Beta" },
            homeTeam: { id: "A", score: 95, teamName: "Alpha" },
            id: "g1",
            startTime: "2026-02-10T00:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
    [
      "C",
      createSchedule(
        "C",
        [
          {
            awayTeam: { id: "A", score: 87, teamName: "Alpha" },
            homeTeam: { id: "C", score: 91, teamName: "Gamma" },
            id: "g2",
            startTime: "2026-02-17T00:00:00Z",
            type: "League",
          },
        ],
        71,
      ),
    ],
    [
      "D",
      createSchedule(
        "D",
        [
          {
            awayTeam: { id: "D", score: 98, teamName: "Delta" },
            homeTeam: { id: "A", score: 114, teamName: "Visionaries" },
            id: "137828772",
            startTime: "2026-03-04T01:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
  ]);
  let providerCalls = 0;

  await processLeagueGameDayPerformances(
    {
      env: {},
      messageBody: JSON.stringify({
        kind: "LEAGUE_GAME_DAY_PERFORMANCES",
        qualityTier: "standard",
        requestedAt: performancesRecord.requestedAt,
        targetKey: performancesRecord.targetKey,
        userId: performancesRecord.userId,
      }),
      region: "us-east-1",
    },
    {
      assertMaintenanceInactive: async () => {},
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
          throw new Error(
            "league game-day performances should not fetch seasons when season is explicit",
          );
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
      createProvider: () => {
        providerCalls += 1;
        throw new Error("performances jobs should never build AI providers");
      },
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueId: "1",
        leagueName: "NBBA",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-03-17T10:49:23.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getLeagueGameDayPerformances: async () => performancesRecord,
      now: () => new Date("2026-03-17T10:49:23.000Z"),
      resolveBbAccessKey: async () => "secret",
      updateLeagueGameDayPerformances: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(providerCalls, 0);
  const latestUpdate = updates.at(-1);
  assert.ok(latestUpdate);
  assert.equal(latestUpdate.status, "SUCCEEDED");
  assert.equal(latestUpdate.modelProvider, "deterministic");
  assert.equal(latestUpdate.modelId, null);
  assert.equal(latestUpdate.promptVersion, null);
  const latestResultJson = latestUpdate.resultJson as {
    gameDayNumber?: number;
    games?: Array<unknown>;
  };
  assert.equal(latestResultJson.gameDayNumber, 3);
  assert.equal((latestResultJson.games ?? []).length, 1);
});

test("processLeagueGameDayPerformances fails cleanly when a required final box score is missing", async () => {
  const performancesRecord = {
    gameDayNumber: 3,
    leagueId: "1",
    requestJson: {
      gameDayNumber: 3,
      leagueId: "1",
      mode: "LEAGUE_GAME_DAY_PERFORMANCES",
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
      createSchedule(
        "A",
        [
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
            homeTeam: { id: "A", score: 114, teamName: "Visionaries" },
            id: "137828772",
            startTime: "2026-03-04T01:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
    [
      "B",
      createSchedule(
        "B",
        [
          {
            awayTeam: { id: "B", score: 82, teamName: "Beta" },
            homeTeam: { id: "A", score: 95, teamName: "Alpha" },
            id: "g1",
            startTime: "2026-02-10T00:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
    [
      "C",
      createSchedule(
        "C",
        [
          {
            awayTeam: { id: "A", score: 87, teamName: "Alpha" },
            homeTeam: { id: "C", score: 91, teamName: "Gamma" },
            id: "g2",
            startTime: "2026-02-17T00:00:00Z",
            type: "League",
          },
        ],
        71,
      ),
    ],
    [
      "D",
      createSchedule(
        "D",
        [
          {
            awayTeam: { id: "D", score: 98, teamName: "Delta" },
            homeTeam: { id: "A", score: 114, teamName: "Visionaries" },
            id: "137828772",
            startTime: "2026-03-04T01:00:00Z",
            type: "league.rs",
          },
        ],
        71,
      ),
    ],
  ]);

  await assert.rejects(
    () =>
      processLeagueGameDayPerformances(
        {
          env: {},
          messageBody: JSON.stringify({
            kind: "LEAGUE_GAME_DAY_PERFORMANCES",
            qualityTier: "standard",
            requestedAt: performancesRecord.requestedAt,
            targetKey: performancesRecord.targetKey,
            userId: performancesRecord.userId,
          }),
          region: "us-east-1",
        },
        {
          assertMaintenanceInactive: async () => {},
          createBbClient: () => ({
            getBoxScore: async (matchId) => {
              if (matchId === "137828772") {
                throw new BBXmlApiError(
                  "BB box score fetch failed",
                  "boxscore.aspx",
                  503,
                );
              }

              return createBoxScore({
                awayScore: 82,
                awayTeamId: "B",
                awayTeamName: "Beta",
                homeScore: 95,
                homeTeamId: "A",
                homeTeamName: "Alpha",
                matchId: matchId ?? "g1",
              });
            },
            getSchedule: async (teamId) => {
              const schedule = schedules.get(teamId ?? "");
              if (!schedule) {
                throw new Error(`Missing schedule for ${teamId}`);
              }
              return schedule;
            },
            getSeasons: async () => {
              throw new Error(
                "league game-day performances should not fetch seasons when season is explicit",
              );
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
          createProvider: () => {
            throw new Error(
              "performances jobs should never build AI providers",
            );
          },
          getBbConnection: async () => ({
            bbLoginName: "coach-alpha",
            leagueId: "1",
            leagueName: "NBBA",
            leagueTimeZone: "America/New_York",
            refreshSortAt: "2026-03-17T10:49:23.000Z",
            status: "CONNECTED",
            userId: "user-1",
          }),
          getLeagueGameDayPerformances: async () => performancesRecord,
          now: () => new Date("2026-03-17T10:49:23.000Z"),
          resolveBbAccessKey: async () => "secret",
          updateLeagueGameDayPerformances: async (_env, input) => {
            updates.push(input);
          },
        },
      ),
    /require a complete final slate/i,
  );

  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.deepStrictEqual(updates.at(-1)?.coverageJson, {
    availableGames: 0,
    missingGames: [
      {
        awayTeamName: "Delta",
        homeTeamName: "Visionaries",
        matchId: "137828772",
        reason: "final box score was unavailable",
      },
    ],
    partial: true,
    requestedGames: 1,
  });
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
  let capturedSingleGamePayload: {
    games: Array<{ playByPlaySummaryLines: string[] }>;
  } | null = null;

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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                capturedSingleGamePayload = payload;
                return {
                  games: payload.games.map((game) => ({
                    evidenceTags: ["top_performance"],
                    headline: "Visionaries pull away late",
                    matchId: game.matchId,
                    writeup:
                      game.playByPlaySummaryLines.find((line) =>
                        /\b6-2 run\b/i.test(line),
                      ) ?? `${game.teams.home.name} won comfortably.`,
                  })),
                  summary: {
                    headline: "Visionaries handle Delta 9",
                    lede: "A direct match-id request can produce a finished-game summary without any league-day or season lookup.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
      fetchPublicMatchPlayByPlay: async (matchId) =>
        createPublicPlayByPlay({
          matchId: String(matchId),
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
  assert.ok(
    capturedSingleGamePayload?.games[0]?.playByPlaySummaryLines.includes(
      "Late-game swings: Visionaries tied it at 4-4 with 00:30 left in the 4th quarter; Visionaries went ahead 6-4 with 00:10 left in the 4th quarter.",
    ),
  );
  assert.ok(
    !capturedSingleGamePayload?.games[0]?.playByPlaySummaryLines.some((line) =>
      /\b6-2 run\b/i.test(line),
    ),
  );
});

test("processSingleGameSummary keeps full-heat request overrides through fallback interviews", async () => {
  const summaryRecord = {
    matchId: "137828772",
    requestJson: {
      approach: "FACT_LIBRARY_FIRST",
      interviewIntensity: "full_heat",
      loserInterviewPersonalityType: "rambling",
      matchId: "137828772",
      modelJudgeEnabled: false,
      mode: "SINGLE_GAME",
      qualityTier: "standard",
      winnerInterviewPersonalityType: "reflective",
    },
    requestedAt: "2026-03-17T10:49:14.585Z",
    status: "QUEUED" as const,
    targetKey:
      "137828772#fact-library-first#intensity-full-heat#winner-voice-reflective#loser-voice-rambling",
    userId: "user-1",
  };
  const updates: Array<Record<string, unknown>> = [];

  await processSingleGameSummary(
    {
      env: {},
      messageBody: JSON.stringify({
        kind: "SINGLE_GAME",
        modelJudgeEnabled: false,
        qualityTier: "standard",
        requestedAt: summaryRecord.requestedAt,
        targetKey: summaryRecord.targetKey,
        userId: summaryRecord.userId,
      }),
      modelId: DEFAULT_RECAP_MODEL_ID,
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
      createProvider: ({ stage }) => ({
        generate: async (payload) => {
          if (isStylePolishPayloadForTest(payload)) {
            return {
              writeup: payload.recapGame.writeup,
            };
          }
          if (isPostgameInterviewPayloadForTest(payload)) {
            return {
              title: "",
            };
          }
          if (!isMainRecapWriterPayloadForTest(payload)) {
            throw new Error("expected main recap writer payload");
          }

          return createRecapCandidateResult({
            headline: "Visionaries pull away late",
            matchId: "137828772",
            writeup:
              "Visionaries built the margin in the closing possessions and kept Delta 9 from finding another answer.",
          });
        },
        modelId: DEFAULT_RECAP_MODEL_ID,
        providerName: "bedrock",
        stage,
      }),
      fetchPublicMatchPlayByPlay: async (matchId) =>
        createPublicPlayByPlay({
          matchId: String(matchId),
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

  const finalUpdate = expectPresent(
    updates.at(-1),
    "expected a persisted single-game summary update",
  ) as {
    resultJson?: {
      games?: Array<{
        postgameInterview?: {
          personalitySource?: string;
          personalityType?: string;
        } | null;
        postgameInterviews?: Array<{
          personalitySource?: string;
          personalityType?: string;
          qa?: Array<{ answer?: string | null }>;
          teamSide?: "away" | "home";
        }>;
      }>;
    };
    status?: string;
  };
  assert.equal(finalUpdate.status, "SUCCEEDED");
  const game = expectPresent(
    finalUpdate.resultJson?.games?.[0],
    "expected a generated single-game recap",
  );
  const interviews = expectPresent(
    game.postgameInterviews,
    "expected persisted postgame interviews",
  );
  const winnerInterview = expectPresent(
    interviews.find((interview) => interview.teamSide === "home"),
    "expected winner interview",
  );
  const loserInterview = expectPresent(
    interviews.find((interview) => interview.teamSide === "away"),
    "expected loser interview",
  );

  assert.equal(winnerInterview.personalityType, "reflective");
  assert.equal(winnerInterview.personalitySource, "request_override");
  assert.match(
    winnerInterview.qa?.[0]?.answer ?? "",
    /Heraclitus said everything flows/i,
  );
  assert.equal(loserInterview.personalityType, "rambling");
  assert.equal(loserInterview.personalitySource, "request_override");
  assert.match(
    loserInterview.qa?.[0]?.answer ?? "",
    /door kept swinging open just wide enough/i,
  );
  assert.equal(game.postgameInterview?.personalityType, "reflective");
  assert.equal(game.postgameInterview.personalitySource, "request_override");
});

test("processSingleGameSummary persists estimated cost tracking for the generated summary", async () => {
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
  let judgeProviderCreated = false;

  await processSingleGameSummary(
    {
      env: createRecapEnv(),
      messageBody: JSON.stringify({
        kind: "SINGLE_GAME",
        modelJudgeEnabled: false,
        qualityTier: "standard",
        requestedAt: summaryRecord.requestedAt,
        targetKey: summaryRecord.targetKey,
        userId: summaryRecord.userId,
      }),
      modelId: DEFAULT_RECAP_MODEL_ID,
      region: "us-east-1",
    },
    {
      assertMaintenanceInactive: async () => {},
      createBbClient: () => ({
        getBoxScore: async () =>
          createBoxScore({
            awayScore: 98,
            awayTeamId: "D",
            awayTeamName: "Delta 9",
            homeScore: 114,
            homeTeamId: "A",
            homeTeamName: "Visionaries",
            matchId: "137828772",
            startTime: "2026-03-15T01:00:00Z",
            type: "league.rs",
          }),
        getSchedule: async () => {
          throw new Error("single-game summary should not fetch schedules");
        },
        getSeasons: async () => ({
          seasons: [{ finish: "2026-05-01", id: 71, start: "2026-02-02" }],
          version: "1",
        }),
        getStandings: async () => createStandings(71, "1"),
        getTeamInfo: async () => ({
          country: { id: "1", name: "USA" },
          fields: {},
          isBot: false,
          league: { id: "1", name: "NBBA" },
          ownerName: "Owner",
          retrievedAt: "2026-03-17T10:49:23.000Z",
          rival: null,
          shortName: "VIS",
          teamId: "A",
          teamName: "Visionaries",
          version: "1",
        }),
      }),
      createProvider: ({ stage }) =>
        stage === "judge"
          ? (() => {
              judgeProviderCreated = true;
              return createPassingJudgeProvider();
            })()
          : createUsageAwareProvider({
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }

                return createRecapCandidateResult({
                  headline: "Visionaries pull away late",
                  matchId: "137828772",
                  writeup:
                    "Visionaries built separation in the second half and kept Delta 9 from making the margin uncomfortable again.",
                });
              },
              modelId: DEFAULT_RECAP_MODEL_ID,
              stage,
              usage: {
                inputTokens: 2_000,
                outputTokens: 400,
                requestCount: 1,
                totalTokens: 2_400,
              },
            }),
      fetchPublicMatchPlayByPlay: async (matchId) =>
        createPublicPlayByPlay({
          matchId: String(matchId),
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

  const finalUpdate = expectPresent(
    updates.at(-1),
    "expected a persisted single-game summary update",
  );
  assert.equal(judgeProviderCreated, false);
  assert.equal(finalUpdate.status, "SUCCEEDED");
  assert.deepStrictEqual(finalUpdate.costJson, {
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    currency: "USD",
    estimatedPerGameCostUsd: 0.004,
    estimatedTotalCostUsd: 0.004,
    generatedGameCount: 1,
    inputTokens: 2_000,
    outputTokens: 400,
    pricingStatus: "estimated",
    requestCount: 1,
    stages: [
      {
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        estimatedCostUsd: 0.004,
        inputTokens: 2_000,
        modelId: DEFAULT_RECAP_MODEL_ID,
        outputTokens: 400,
        providerName: "bedrock",
        requestCount: 1,
        stage: "writer",
        totalTokens: 2_400,
      },
    ],
    totalTokens: 2_400,
  });
});

test("processSingleGameSummary adds series context for eligible playoff finals", async () => {
  const summaryRecord = {
    matchId: "137828773",
    requestJson: {
      matchId: "137828773",
      mode: "SINGLE_GAME",
    },
    requestedAt: "2026-04-05T10:49:14.585Z",
    status: "QUEUED" as const,
    targetKey: "137828773",
    userId: "user-1",
  };
  const updates: Array<Record<string, unknown>> = [];
  let capturedSingleGamePayload: {
    games: Array<{ seriesContext?: { summaryLine: string } }>;
    request: { season: number | null };
  } | null = null;

  const seasons: BBApiSeasons = {
    seasons: [
      {
        finish: "2025-12-31",
        id: 70,
        start: "2025-10-01",
      },
      {
        finish: "2026-12-31",
        id: 71,
        start: "2026-01-01",
      },
    ],
    version: "1",
  };

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
            awayScore: 90,
            awayTeamId: "28479",
            awayTeamName: "Delta 9",
            homeScore: 84,
            homeTeamId: "29656",
            homeTeamName: "Visionaries",
            matchId: "137828773",
            startTime: "2026-04-05T19:00:00Z",
            type: "league.final",
          }),
        getSchedule: async () => {
          throw new Error(
            "playoff single-game summary should use brackets before schedules",
          );
        },
        getSeasons: async () => seasons,
        getStandings: async () =>
          createStandings(71, "1", [
            {
              matches: [
                createPlayoffSeriesMatch({
                  awayId: "28479",
                  awayName: "Delta 9",
                  awayScore: 81,
                  homeId: "29656",
                  homeName: "Visionaries",
                  homeScore: 85,
                  id: "137828772",
                  startTime: "2026-04-01T19:00:00Z",
                  type: "league.final",
                }),
                createPlayoffSeriesMatch({
                  awayId: "28479",
                  awayName: "Delta 9",
                  awayScore: 90,
                  homeId: "29656",
                  homeName: "Visionaries",
                  homeScore: 84,
                  id: "137828773",
                  startTime: "2026-04-05T19:00:00Z",
                  type: "league.final",
                }),
              ],
              name: "finals",
            },
          ]),
        getTeamInfo: async () => {
          throw new Error("team info should not be loaded in this test");
        },
      }),
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                capturedSingleGamePayload = payload;
                return {
                  games: payload.games.map((game) => ({
                    evidenceTags: ["close_finish"],
                    headline: "Delta 9 evens series 1-1",
                    matchId: game.matchId,
                    writeup: `${game.requiredContextSentences.join(" ")}\n\n${game.teams.away.name} steadied late and never let ${game.teams.home.name} retake control after the margin flipped.`,
                  })),
                  summary: {
                    headline: "Finals split the first two",
                    lede: "The connected league context can enrich a single-game playoff summary with the current series state.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueId: "1",
        leagueName: "NBBA",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-04-05T10:49:23.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getSingleGameSummary: async () => summaryRecord,
      now: () => new Date("2026-04-05T10:49:23.000Z"),
      resolveBbAccessKey: async () => "secret",
      updateSingleGameSummary: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  assert.equal(updates.at(-1)?.season, 71);
  const resolvedSingleGamePayload = expectPresent(
    capturedSingleGamePayload,
    "single-game payload was not captured",
  );
  assert.equal(resolvedSingleGamePayload.request.season, 71);
  assert.equal(
    resolvedSingleGamePayload.games[0]?.seriesContext?.summaryLine,
    "The series is tied 1-1.",
  );
});

test("processSingleGameSummary keeps playoff series context optional when it cannot be reconstructed", async () => {
  const summaryRecord = {
    matchId: "137828774",
    requestJson: {
      matchId: "137828774",
      mode: "SINGLE_GAME",
    },
    requestedAt: "2026-04-08T10:49:14.585Z",
    status: "QUEUED" as const,
    targetKey: "137828774",
    userId: "user-1",
  };
  const updates: Array<Record<string, unknown>> = [];
  let capturedSingleGamePayload: {
    games: Array<{ seriesContext?: { summaryLine: string } }>;
    request: { season: number | null };
  } | null = null;

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
            awayScore: 88,
            awayTeamId: "28479",
            awayTeamName: "Delta 9",
            homeScore: 93,
            homeTeamId: "29656",
            homeTeamName: "Visionaries",
            matchId: "137828774",
            startTime: "2026-04-08T19:00:00Z",
            type: "league.final",
          }),
        getSchedule: async (teamId) => createSchedule(teamId ?? "missing", []),
        getSeasons: async () => ({
          seasons: [
            {
              finish: "2026-12-31",
              id: 71,
              start: "2026-01-01",
            },
          ],
          version: "1",
        }),
        getStandings: async () => createStandings(71, "1"),
        getTeamInfo: async () => {
          throw new Error("team info should not be loaded in this test");
        },
      }),
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary =
                  maybeHandleAuxiliaryWriterPayloadForTest(payload);
                if (auxiliary) {
                  return auxiliary.response;
                }
                if (!isMainRecapWriterPayloadForTest(payload)) {
                  throw new Error("expected main recap writer payload");
                }
                capturedSingleGamePayload = payload;
                return {
                  games: payload.games.map((game) => ({
                    evidenceTags: ["top_performance"],
                    headline: "Visionaries close the door",
                    matchId: game.matchId,
                    writeup: `${game.teams.home.name} pushed ahead for good in the second half and never let ${game.teams.away.name} get back within a single possession late.`,
                  })),
                  summary: {
                    headline: "Visionaries finish strong",
                    lede: "The recap still succeeds when a playoff series state cannot be reconstructed confidently.",
                  },
                };
              },
              modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
              providerName: "bedrock",
              stage,
            },
      getBbConnection: async () => ({
        bbLoginName: "coach-alpha",
        leagueId: "1",
        leagueName: "NBBA",
        leagueTimeZone: "America/New_York",
        refreshSortAt: "2026-04-08T10:49:23.000Z",
        status: "CONNECTED",
        userId: "user-1",
      }),
      getSingleGameSummary: async () => summaryRecord,
      now: () => new Date("2026-04-08T10:49:23.000Z"),
      resolveBbAccessKey: async () => "secret",
      updateSingleGameSummary: async (_env, input) => {
        updates.push(input);
      },
    },
  );

  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  assert.equal(updates.at(-1)?.season, 71);
  const unresolvedSeriesPayload = expectPresent(
    capturedSingleGamePayload,
    "single-game payload was not captured",
  );
  assert.equal(unresolvedSeriesPayload.request.season, 71);
  assert.equal(unresolvedSeriesPayload.games[0]?.seriesContext, undefined);
});

test("buildGameDayRecapBedrockRequest attaches a structured output schema", () => {
  const promptGame = createExpectedPromptGame("m-1");
  promptGame.finalMargin = 2;
  promptGame.playByPlayFacts = createBuzzerBeaterPlayByPlayFacts();
  promptGame.playByPlaySummaryLines = promptGame.playByPlayFacts.summaryLines;

  const request = __testing.buildGameDayRecapBedrockRequest({
    modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    payload: {
      coverage: {
        availableGames: 1,
        missingGames: [],
        partial: false,
        requestedGames: 1,
      },
      games: [promptGame],
      request: {
        gameDate: "2026-03-15",
        gameDayNumber: null,
        generationApproach: "FACT_LIBRARY_FIRST",
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
  assert.match(schema, /"summary"/);
  assert.match(schema, /"games"/);
  assert.doesNotMatch(schema, /"maxItems"\s*:/);
  assert.doesNotMatch(schema, /"minItems"\s*:/);
  assert.doesNotMatch(schema, /"minimum"\s*:/);
  assert.doesNotMatch(schema, /"maximum"\s*:/);
  assert.doesNotMatch(schema, /"minLength"\s*:/);
  assert.doesNotMatch(schema, /"maxLength"\s*:/);

  const systemText = request.system[0]?.text ?? "";
  const userText = request.messages[0]?.content[0]?.text ?? "";
  assert.match(systemText, /never cite the raw effortDelta value/i);
  assert.match(systemText, /raw GDP codes/i);
  assert.match(systemText, /factsLibrary\.pregameBattle/i);
  assert.match(systemText, /manager-battle setup/i);
  assert.match(systemText, /metaphor-only manager color/i);
  assert.match(systemText, /held the effort edge/i);
  assert.match(systemText, /not a checklist of facts/i);
  assert.match(
    systemText,
    /do not invent reasons such as injuries, load management, or discipline/i,
  );
  assert.match(systemText, /playByPlaySummaryLines are present/i);
  assert.match(systemText, /unsupplied play-by-play details/i);
  assert.match(
    systemText,
    /do not restate the exact same winner-and-score outcome in a later sentence/i,
  );
  assert.match(
    systemText,
    /Prefer concrete basketball detail over filler such as 'at a key juncture' or 'proved decisive'/i,
  );
  assert.match(systemText, /Never call a one-game win or loss a streak/i);
  assert.match(
    systemText,
    /do not invent a last shot, last miss, or last turnover/i,
  );
  assert.match(
    systemText,
    /Only mention runs when the supplied play-by-play facts support them/i,
  );
  assert.match(systemText, /overlapping run windows/i);
  assert.match(
    systemText,
    /hidden pregame, game, and postgame paragraphs separated by blank lines/i,
  );
  assert.match(
    systemText,
    /Only mention lead-change counts, rapid bursts, or comeback-to-the-lead claims/i,
  );
  assert.match(systemText, /keep the game flow in time order after the opener/i);
  assert.match(systemText, /use comeback phrasing for a run only when that team actually started the run trailing/i);
  assert.match(systemText, /same-family pairings such as Motion and Princeton contrasting/i);
  assert.match(systemText, /same sequence, summarize them as one closing possession/i);
  assert.match(
    systemText,
    /In playoff games, do not mention regular-season records or any winning or losing streaks/i,
  );
  assert.match(userText, /"endingFacts"/);
  assert.match(userText, /"buzzerbeater"/);
});

test("buildGameDayRecapBedrockRequest compacts fact-library-first full-slate writer prompts", () => {
  const requestFacts = {
    gameDate: "2026-03-15",
    gameDayNumber: null,
    generationApproach: "FACT_LIBRARY_FIRST" as const,
    interviewIntensity: "pg13" as const,
    kind: "LEAGUE_DATE" as const,
    label: "Elite League 2026-03-15",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    season: 64,
    timeZone: "America/New_York",
  };
  const expectedGames = Array.from({ length: 12 }, (_value, index) => {
    const game = createExpectedPromptGame(`m-${index + 1}`);
    game.teams.home.name = `Home ${index + 1}`;
    game.teams.away.name = `Away ${index + 1}`;
    game.teams.home.gdp = {
      focusGuess: "outside",
      paceGuess: "fast",
      rawCode: `home-gdp-${index}`.repeat(20),
    };
    game.teams.away.gdp = {
      focusGuess: "inside",
      paceGuess: "slow",
      rawCode: `away-gdp-${index}`.repeat(20),
    };
    game.playByPlayFacts = createBackAndForthPlayByPlayFacts();
    game.playByPlaySummaryLines = Array.from(
      { length: 20 },
      (_line, lineIndex) =>
        `Synthetic play-by-play summary ${lineIndex} for game ${index}.`.repeat(
          5,
        ),
    );
    return game;
  });
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: expectedGames.length,
      missingGames: [],
      partial: false,
      requestedGames: expectedGames.length,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames,
      request: requestFacts,
    }),
  });

  for (const game of writerPayload.games) {
    for (const side of ["away", "home"] as const) {
      game.teams[side].notablePlayers = Array.from(
        { length: 30 },
        (_player, playerIndex) => ({
          isStarter: playerIndex < 5,
          minutes: 48 - playerIndex,
          name: `${game.teams[side].name} Rotation Player ${playerIndex}`.repeat(
            3,
          ),
          playerId: `${game.matchId}-${side}-${playerIndex}`,
          plusMinus: playerIndex,
          points: 20 - playerIndex,
          ratingValue: 12 - playerIndex / 10,
        }),
      );
      game.teams[side].topPlayers = Array.from(
        { length: 12 },
        (_player, playerIndex) => ({
          assists: playerIndex,
          blocks: 0,
          fieldGoalsAttempted: 20,
          fieldGoalsMade: 10,
          freeThrowsAttempted: 8,
          freeThrowsMade: 6,
          isStarter: playerIndex < 5,
          minutes: 48 - playerIndex,
          name: `${game.teams[side].name} Top Player ${playerIndex}`.repeat(3),
          personalFouls: 2,
          playerId: `${game.matchId}-${side}-top-${playerIndex}`,
          plusMinus: playerIndex,
          points: 25 - playerIndex,
          ratingValue: 15 - playerIndex / 10,
          rebounds: 10,
          steals: 1,
          threePointersAttempted: 7,
          threePointersMade: 4,
          turnovers: 1,
        }),
      );
    }

    const factsLibrary = expectPresent(
      game.factsLibrary,
      "expected facts library for compact prompt test",
    );
    const baseFact = expectPresent(
      factsLibrary.rankedFacts[0],
      "expected ranked fact for compact prompt test",
    );
    const bulkyFacts = Array.from({ length: 90 }, (_fact, factIndex) => ({
      ...baseFact,
      claimKey: `synthetic_bulk_${factIndex}`,
      id: `${game.matchId}-synthetic-bulk-${factIndex}`,
      impactScore: Math.max(1, baseFact.impactScore - factIndex),
      mustMention: false,
      preferredPlacement: "body" as const,
      sourceFields: Array.from(
        { length: 12 },
        (_source, sourceIndex) =>
          `factStore.games[${game.matchId}].synthetic.${factIndex}.${sourceIndex}`,
      ),
      text: `Synthetic long fact ${factIndex} for ${game.matchId}: `.repeat(18),
    }));
    factsLibrary.rankedFacts = [...factsLibrary.rankedFacts, ...bulkyFacts];
    factsLibrary.analysisFacts = [...factsLibrary.analysisFacts, ...bulkyFacts];
    factsLibrary.chronologicalFacts = [
      ...factsLibrary.chronologicalFacts,
      ...bulkyFacts,
    ];
    factsLibrary.summaryFacts = Array.from(
      { length: 90 },
      (_fact, factIndex) =>
        `Synthetic summary fact ${factIndex} for ${game.matchId}.`.repeat(15),
    );
    factsLibrary.storySignals = Array.from(
      { length: 90 },
      (_fact, factIndex) =>
        `Synthetic story signal ${factIndex} for ${game.matchId}.`.repeat(15),
    );
  }

  const rawPayloadText = JSON.stringify(writerPayload);
  const request = __testing.buildGameDayRecapBedrockRequest({
    modelId: DEFAULT_RECAP_MODEL_ID,
    payload: writerPayload,
  });
  const userText = request.messages[0]?.content[0]?.text ?? "";
  const parsed = JSON.parse(userText) as {
    recapContext: {
      games: Array<{
        effortDelta: number | null;
        factsLibrary: {
          rankedFacts: unknown[];
          storySignals: unknown[];
          summaryFacts: unknown[];
        };
        postgameInterviewCandidates?: unknown;
        teams: {
          away: {
            gdp: Record<string, unknown>;
            notablePlayers?: unknown;
            topPlayers: unknown[];
          };
          home: {
            gdp: Record<string, unknown>;
            notablePlayers?: unknown;
            topPlayers: unknown[];
          };
        };
      }>;
    };
  };
  const compactGame = parsed.recapContext.games[0]!;

  assert.equal(parsed.recapContext.games.length, expectedGames.length);
  assert.equal(compactGame.effortDelta, null);
  assert.deepStrictEqual(compactGame.teams.home.gdp, {});
  assert.deepStrictEqual(compactGame.teams.away.gdp, {});
  assert.equal(compactGame.teams.home.notablePlayers, undefined);
  assert.equal(compactGame.postgameInterviewCandidates, undefined);
  assert.ok(compactGame.teams.home.topPlayers.length <= 3);
  assert.ok(compactGame.factsLibrary.rankedFacts.length <= 16);
  assert.ok(compactGame.factsLibrary.summaryFacts.length <= 8);
  assert.ok(compactGame.factsLibrary.storySignals.length <= 8);
  assert.ok(userText.length < rawPayloadText.length * 0.45);
});

test("buildGameDayRecapBedrockRequest sanitizes playoff records from the writer payload and exposes back-and-forth evidence tags", () => {
  const promptGame = createExpectedPromptGame("m-1");
  promptGame.type = "league.finals";
  promptGame.seriesContext = {
    isTerminal: false,
    postgameWins: {
      away: 0,
      home: 1,
    },
    stageKey: "finals",
    summaryLine: "Home leads the series 1-0.",
  };
  promptGame.playByPlayFacts = createBackAndForthPlayByPlayFacts();
  promptGame.playByPlaySummaryLines = promptGame.playByPlayFacts.summaryLines;

  const request = __testing.buildGameDayRecapBedrockRequest({
    modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    payload: {
      coverage: {
        availableGames: 1,
        missingGames: [],
        partial: false,
        requestedGames: 1,
      },
      games: [promptGame],
      request: {
        gameDate: "2026-03-15",
        gameDayNumber: null,
        kind: "SINGLE_GAME",
        label: "Finals Game 1",
        leagueId: "100",
        leagueName: "Elite League",
        matchId: "m-1",
        season: 64,
        timeZone: "America/New_York",
      },
    },
  });

  const systemText = request.system[0]?.text ?? "";
  const userText = request.messages[0]?.content[0]?.text ?? "";

  assert.match(userText, /"back_and_forth"/);
  assert.match(userText, /"record": null/);
  assert.doesNotMatch(userText, /"record": "13-3"/);
  assert.doesNotMatch(userText, /"recordEnteringGame": "12-3"/);
  assert.match(userText, /"streak": null/);
  assert.doesNotMatch(userText, /"streak": "W4"/);
  assert.doesNotMatch(userText, /"streakEnteringGame": "W3"/);
  assert.match(systemText, /lead-change counts, rapid bursts/i);
  assert.match(
    systemText,
    /do not mention regular-season records or any winning or losing streaks/i,
  );
});

test("buildGameDayRecapBedrockRequest pushes playful postgame questions and loud PG-13 player voice", () => {
  const payload = createSingleGameRecapPayload("m-1");
  payload.request.interviewIntensity = "pg13";
  refreshPayloadFactStore(payload);
  const gameFacts = payload.factStore.games[0]!;
  const interviewFacts = {
    absurdQuestionGuidance:
      "Absurd questions must be impossible enough to read as jokes.",
    bannedMechanicsTerms: ["outside defense", "offensive flow", "GDP"],
    outcome: "Home beat Away 85-81.",
    perspective: "winner" as const,
    playerAngle: "Home Hero can talk about scoring pressure without numbers.",
    playerRoleFacts: ["finding offense without forcing the interview into numbers"],
    questionPlan: {
      absurd: [
        "If tonight's momentum had to file paperwork, what would it list as its occupation?",
      ],
      emotional: ["What did the game feel like once your group had control?"],
      gameFlow: ["What changed when the game turned toward your group?"],
      loserResponse: ["What do you want the group to carry into the next one?"],
    },
    safeContext: [],
    statUsageGuidance:
      "Use stats as private grounding; do not quote the stat bundle.",
    storyBeats: [
      "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
    ],
  };
  const request = __testing.buildGameDayRecapBedrockRequest({
    modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    payload: {
      candidate: {
        playerName: "Home Hero",
        selectionReason: "top scorer for the winning team",
        statLine: {
          assists: 4,
          blocks: 1,
          minutes: 39,
          points: 24,
          rebounds: 8,
          steals: 2,
          turnovers: 3,
        },
        supportedFacts: ["Home Hero led the winners with 24 points."],
        teamName: "Home",
        teamSide: "home",
        personalityType: "deadpan",
        personalitySource: "user_override",
      },
      gameFacts,
      interviewFacts,
      recapGame: {
        headline: "Home beats Away 85-81",
        matchId: "m-1",
        writeup:
          "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
      },
      request: payload.factStore.request,
      task: "postgame_interview",
    },
  });

  const systemText = request.system[0]?.text ?? "";
  const userText = request.messages[0]?.content[0]?.text ?? "";

  assert.match(systemText, /questions in playful reporter tone/i);
  assert.match(
    systemText,
    /PG-13 should be just as entertaining as full heat/i,
  );
  assert.match(
    systemText,
    /Do not recite stat bundles or use internal game-mechanics language/i,
  );
  assert.match(
    userText,
    /Use two or three short Q&A exchanges/i,
  );
  assert.match(
    userText,
    /let the reporter questions be playful, varied, and occasionally strange/i,
  );
  assert.match(
    userText,
    /Make the selected personality unmistakable in every player answer/i,
  );
  assert.match(userText, /Honor the requested interviewIntensity of pg13/i);
  assert.match(
    userText,
    /Do not lead questions with raw stat lines/i,
  );
  assert.match(
    userText,
    /Do not use game-mechanics language/i,
  );
  assert.match(userText, /Absurd questions must be obviously impossible or surreal/i);
  assert.match(userText, /"interviewIntensity": "pg13"/);
  assert.match(userText, /"interviewFacts"/);
  assert.match(userText, /"questionPlan"/);
  assert.match(userText, /dry and understated/i);
  assert.match(userText, /Example answer flavor:/i);
  assert.match(
    userText,
    /They kept giving me space\. I assumed it was a cry for help, so I answered it\./i,
  );
});

test("fallback postgame interviews change voice with interview intensity", () => {
  const payload = createSingleGameRecapPayload("m-1");
  const expectedGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  );
  const candidate = {
    personalityType: "braggart" as const,
    perspective: "winner" as const,
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home" as const,
  };

  const cleanInterview = __testing.buildFallbackPostgameInterview({
    candidate,
    expectedGame,
    interviewIntensity: "clean",
  });
  const fullHeatInterview = __testing.buildFallbackPostgameInterview({
    candidate,
    expectedGame,
    interviewIntensity: "full_heat",
  });

  assert.notEqual(cleanInterview.qa[0]?.answer, fullHeatInterview.qa[0]?.answer);
  assert.match(cleanInterview.qa[0]?.answer ?? "", /best option on the floor/i);
  assert.match(
    fullHeatInterview.qa[0]?.answer ?? "",
    /best player in the building by a disrespectful margin/i,
  );
  assert.equal(fullHeatInterview.personalityType, "braggart");
  assert.equal(fullHeatInterview.personalitySource, "auto");
});

test("generateResolvedGameDayRecap lets request overrides beat stored interview personalities", async () => {
  const payload = createSingleGameRecapPayload("m-1");
  payload.request.winnerInterviewPersonalityType = "deadpan";
  refreshPayloadFactStore(payload);
  const factStoreGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  );
  factStoreGame.postgameInterviewCandidate = {
    playerName: "Home Hero",
    personalitySource: "user_override",
    personalityType: "curt",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };

  let capturedCandidate:
    | {
        personalitySource?: string | null;
        personalityType?: string | null;
      }
    | undefined;

  await __testing.generateResolvedGameDayRecap({
    judgeProvider: null,
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (providerPayload) => {
        if (isPostgameInterviewPayloadForTest(providerPayload)) {
          capturedCandidate = providerPayload.candidate;
          return {
            playerName: providerPayload.candidate.playerName,
            qa: [
              {
                answer: "I kept the game calm.",
                question: "What was working for you tonight?",
              },
            ],
            teamName: providerPayload.candidate.teamName,
            teamSide: providerPayload.candidate.teamSide,
            title: `${providerPayload.candidate.playerName} on ${providerPayload.candidate.teamName}'s win`,
          };
        }
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(providerPayload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(providerPayload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.ok(capturedCandidate);
  assert.equal(capturedCandidate.personalityType, "deadpan");
  assert.equal(capturedCandidate.personalitySource, "request_override");
});

test("generateResolvedGameDayRecap applies a one-sided loser override to a synthesized losing-side candidate", async () => {
  const payload = createSingleGameRecapPayload();
  payload.request.loserInterviewPersonalityType = "curt";
  refreshPayloadFactStore(payload);
  const factStoreGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  );
  factStoreGame.postgameInterviewCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };
  factStoreGame.teams.away.topPlayers = [
    {
      assists: 6,
      blocks: 0,
      minutes: 38,
      name: "Away Voice",
      points: 19,
      rebounds: 11,
      steals: 1,
      turnovers: 2,
    },
  ];

  const capturedCandidates = new Map<
    string,
    {
      personalitySource?: string | null;
      personalityType?: string | null;
    }
  >();

  await __testing.generateResolvedGameDayRecap({
    judgeProvider: null,
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (providerPayload) => {
        if (isPostgameInterviewPayloadForTest(providerPayload)) {
          capturedCandidates.set(
            providerPayload.candidate.playerName,
            providerPayload.candidate,
          );
          return {
            playerName: providerPayload.candidate.playerName,
            qa: [
              {
                answer: "We have to clean it up.",
                question: "Where did the game turn?",
              },
            ],
            teamName: providerPayload.candidate.teamName,
            teamSide: providerPayload.candidate.teamSide,
            title: `${providerPayload.candidate.playerName} on ${providerPayload.candidate.teamName}'s finish`,
          };
        }
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(providerPayload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(providerPayload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(
    capturedCandidates.get("Away Voice")?.personalityType,
    "curt",
  );
  assert.equal(
    capturedCandidates.get("Away Voice")?.personalitySource,
    "request_override",
  );
  assert.notEqual(
    capturedCandidates.get("Home Hero")?.personalitySource,
    "request_override",
  );
});

test("buildGameDayRecapBedrockRequest steers rating prose toward team talent and away from BBStats wording", () => {
  const payload = createSingleGameRecapPayload("m-1");
  const request = __testing.buildGameDayRecapBedrockRequest({
    modelId: DEFAULT_RECAP_MODEL_ID,
    payload,
  });

  const systemText = request.system[0]?.text ?? "";
  const userText = request.messages[0]?.content[0]?.text ?? "";

  assert.match(systemText, /team talent/i);
  assert.match(userText, /team talent/i);
  assert.match(
    systemText,
    /never write raw ratings, BBStats, or numeric rating totals/i,
  );
  assert.match(
    userText,
    /never write raw ratings, BBStats, or numeric rating totals/i,
  );
});

test("buildGameDayRecapJudgeBedrockRequest uses fixed-slot sentence chunks without Bedrock-hostile schema keywords", () => {
  const payload = createSingleGameRecapPayload("m-1");
  const request = __testing.buildGameDayRecapJudgeBedrockRequest({
    modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
    payload: {
      candidateIndex: 0,
      chunkCount: 1,
      chunkIndex: 0,
      gameFacts: payload.factStore.games[0]!,
      judgeKind: "sentence_factuality",
      request: payload.factStore.request,
      sentenceChunk: [
        {
          field: "headline",
          sentence: "Home closes the final minute",
          sentenceIndex: 0,
          slotId: "slot0",
        },
        {
          field: "writeup",
          sentence:
            "Home stayed in front over the last few possessions and finished the game cleanly.",
          sentenceIndex: 0,
          slotId: "slot1",
        },
      ],
    },
  });

  const userText = request.messages[0]?.content[0]?.text ?? "";
  const parsed = JSON.parse(userText) as {
    candidateIndex: number;
    chunkCount: number;
    chunkIndex: number;
    gameFacts: unknown;
    sentenceChunk: Array<{
      field: string;
      sentence: string;
      sentenceIndex: number;
      slotId: string;
    }>;
  };
  const schema = request.outputConfig.textFormat.structure.jsonSchema.schema;
  const parsedSchema = JSON.parse(schema) as {
    properties: {
      slotVerdicts: {
        properties: {
          slot0: {
            properties: {
              notes: {
                type: string;
              };
              sourceField: {
                type: string;
              };
            };
          };
        };
      };
    };
  };

  assert.deepStrictEqual(parsed.gameFacts, payload.factStore.games[0]);
  assert.equal(
    (parsed.gameFacts as { teamTalent?: { awayTotal: number | null } })
      .teamTalent?.awayTotal,
    202,
  );
  assert.equal(
    (
      parsed.gameFacts as {
        teamRatingFacts?: {
          away: {
            ratings?: {
              outsideScoring?: { value: number };
            };
          };
        };
      }
    ).teamRatingFacts?.away.ratings?.outsideScoring?.value,
    12.2,
  );
  assert.equal(parsed.candidateIndex, 0);
  assert.equal(parsed.chunkCount, 1);
  assert.equal(parsed.chunkIndex, 0);
  assert.deepStrictEqual(parsed.sentenceChunk, [
    {
      field: "headline",
      sentence: "Home closes the final minute",
      sentenceIndex: 0,
      slotId: "slot0",
    },
    {
      field: "writeup",
      sentence:
        "Home stayed in front over the last few possessions and finished the game cleanly.",
      sentenceIndex: 0,
      slotId: "slot1",
    },
  ]);
  assert.doesNotMatch(schema, /"maxItems"\s*:/);
  assert.doesNotMatch(schema, /"minItems"\s*:/);
  assert.doesNotMatch(schema, /"minimum"\s*:/);
  assert.doesNotMatch(schema, /"maximum"\s*:/);
  assert.doesNotMatch(schema, /"minLength"\s*:/);
  assert.doesNotMatch(schema, /"maxLength"\s*:/);
  assert.doesNotMatch(schema, /"type"\s*:\s*\[/);
  assert.doesNotMatch(schema, /"anyOf"\s*:/);
  assert.match(
    userText,
    /gameFacts\.teamRatingFacts and gameFacts\.teamTalent/i,
  );
  assert.match(
    userText,
    /Reject rating or team-talent claims when no matching gameFacts\.teamRatingFacts or gameFacts\.teamTalent support exists/i,
  );
  assert.match(
    userText,
    /Treat game-high as supported only when the named player is the global leader/i,
  );
  assert.match(
    userText,
    /Team-high or led \[team] may be supported by teams\[\]\.topPlayers/i,
  );
  assert.match(
    userText,
    /matching interview candidate for that side and its supported facts/i,
  );
  assert.equal(
    parsedSchema.properties.slotVerdicts.properties.slot0.properties.notes.type,
    "string",
  );
  assert.equal(
    parsedSchema.properties.slotVerdicts.properties.slot0.properties.sourceField
      .type,
    "string",
  );
});

test("describeEffortDeltaForRecap uses natural language for nonzero effort deltas", () => {
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: 1,
      homeTeamName: "Alpha",
    }),
    "Alpha held the effort edge over Beta.",
  );
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: 2,
      homeTeamName: "Alpha",
    }),
    "Alpha held the clear effort edge over Beta.",
  );
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: -1,
      homeTeamName: "Alpha",
    }),
    "Beta held the effort edge over Alpha.",
  );
  assert.equal(
    __testing.describeEffortDeltaForRecap({
      awayTeamName: "Beta",
      effortDelta: -2,
      homeTeamName: "Alpha",
    }),
    "Beta held the clear effort edge over Alpha.",
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

test("pregame tactic taxonomy maps manual offense and defense families", () => {
  assert.deepStrictEqual(
    __testing.resolveOffenseTaxonomy("Princeton"),
    {
      displayName: "Princeton",
      focus: "outside",
      gdpFocus: "outside",
      pace: "slow",
      scorerTarget: null,
      strategy: "Princeton",
      strategyKey: "princeton",
    },
  );
  assert.deepStrictEqual(
    __testing.resolveOffenseTaxonomy("Inside Isolation"),
    {
      displayName: "Inside Isolation",
      focus: "balanced",
      gdpFocus: "balanced",
      pace: "normal",
      scorerTarget: "best_inside_scorer",
      strategy: "Inside Isolation",
      strategyKey: "inside isolation",
    },
  );
  assert.deepStrictEqual(
    __testing.resolveOffenseTaxonomy("OutsideIsolation"),
    {
      displayName: "Outside Isolation",
      focus: "balanced",
      gdpFocus: "balanced",
      pace: "normal",
      scorerTarget: "best_outside_scorer",
      strategy: "OutsideIsolation",
      strategyKey: "outside isolation",
    },
  );
  assert.equal(
    __testing.resolveDefenseTaxonomy("32Zone").displayName,
    "3-2 Zone",
  );
  assert.equal(
    __testing.resolveDefenseTaxonomy("2-3 Zone").profileKey,
    "inside_zone",
  );
  assert.equal(
    __testing.resolveDefenseTaxonomy("3-2 Zone").profileKey,
    "perimeter_zone",
  );
  assert.equal(
    __testing.resolveDefenseTaxonomy("1-3-1 Zone").profileKey,
    "perimeter_gamble",
  );
  assert.equal(
    __testing.resolveDefenseTaxonomy("Full Court Press").profileKey,
    "press",
  );
  assert.equal(
    __testing.resolveDefenseTaxonomy("Inside Box-and-One").targetScorer,
    "best_inside_scorer",
  );
  assert.equal(
    __testing.resolveDefenseTaxonomy("Outside Box-and-One").targetScorer,
    "best_outside_scorer",
  );
});

test("describeGameDayPrepFocusForRecap uses natural language for GDP focus hits and misses", () => {
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "outside.hit",
      teamName: "LA Lions",
    }),
    "LA Lions prepared well for Outside looks.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "outside.miss",
      teamName: "LA Lions",
    }),
    "LA Lions missed on the Outside focus read.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "Inside.hit",
      teamName: "LA Lions",
    }),
    "LA Lions prepared well for Inside looks.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "Balanced.miss",
      teamName: "LA Lions",
    }),
    "LA Lions missed on the Balanced focus read.",
  );
  assert.equal(
    __testing.describeGameDayPrepFocusForRecap({
      focus: "N/A",
      teamName: "LA Lions",
    }),
    null,
  );
});

test("buildGameDayPrepSummariesForRecap composes focus and pace hits and misses", () => {
  const boxScore = createBoxScore({
    awayScore: 55,
    awayTeamId: "SG",
    awayTeamName: "Splash Gang",
    homeScore: 69,
    homeTeamId: "SB",
    homeTeamName: "Silverbacks",
    matchId: "m-1",
  });
  boxScore.homeTeam.offStrategy = "Motion";
  boxScore.awayTeam.offStrategy = "Run and Gun";
  boxScore.homeTeam.gdp = { focus: "Outside.hit", pace: "N/A" };
  boxScore.awayTeam.gdp = { focus: "Outside.hit", pace: "Fast.miss" };

  assert.deepStrictEqual(
    __testing.buildGameDayPrepSummariesForRecap({
      awayTeam: boxScore.awayTeam,
      homeTeam: boxScore.homeTeam,
    }),
    [
      "Both teams prepared well for Outside looks.",
      "On pace, Splash Gang prepared for Fast pace, but Silverbacks played Motion.",
    ],
  );

  boxScore.homeTeam.gdp = { focus: "Inside.hit", pace: "Slow.hit" };
  boxScore.awayTeam.gdp = { focus: "Balanced.miss", pace: "Fast.miss" };

  assert.deepStrictEqual(
    __testing.buildGameDayPrepSummariesForRecap({
      awayTeam: boxScore.awayTeam,
      homeTeam: boxScore.homeTeam,
    }),
    [
      "Silverbacks prepared well for Inside looks; Splash Gang missed on the Balanced focus read.",
      "On pace, Silverbacks prepared well for Slow pace; Splash Gang prepared for Fast pace, but Silverbacks played Motion.",
    ],
  );

  boxScore.homeTeam.gdp = { focus: "Inside.miss", pace: "Normal.hit" };
  boxScore.awayTeam.gdp = { focus: "Balanced.miss", pace: "Normal.hit" };

  assert.deepStrictEqual(
    __testing.buildGameDayPrepSummariesForRecap({
      awayTeam: boxScore.awayTeam,
      homeTeam: boxScore.homeTeam,
    }),
    [
      "Silverbacks missed on the Inside focus read; Splash Gang missed on the Balanced focus read.",
      "On pace, both teams prepared well for Normal pace.",
    ],
  );

  boxScore.homeTeam.gdp = { focus: "N/A", pace: "Fast.miss" };
  boxScore.awayTeam.gdp = { focus: "N/A", pace: "Fast.miss" };

  assert.deepStrictEqual(
    __testing.buildGameDayPrepSummariesForRecap({
      awayTeam: boxScore.awayTeam,
      homeTeam: boxScore.homeTeam,
    }),
    [
      "On pace, Silverbacks prepared for Fast pace, but Splash Gang played Run and Gun; Splash Gang prepared for Fast pace, but Silverbacks played Motion.",
    ],
  );

  boxScore.homeTeam.gdp = { focus: "N/A", pace: "--" };
  boxScore.awayTeam.gdp = { focus: null, pace: "" };

  assert.deepStrictEqual(
    __testing.buildGameDayPrepSummariesForRecap({
      awayTeam: boxScore.awayTeam,
      homeTeam: boxScore.homeTeam,
    }),
    [],
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

  assert.deepStrictEqual(
    __testing.buildRotationSummariesForRecap(boxScore.homeTeam),
    [
      "LA Lions came in without Leo Star, leaving them short-handed.",
      "Mason Key spent much of the night in foul trouble and played only 22 minutes.",
    ],
  );
});

test("assertSupportedBedrockRecapModel fails fast for unsupported configuration", () => {
  assert.throws(
    () =>
      assertSupportedBedrockRecapModel("anthropic.claude-v2:1", "us-east-1"),
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
        lede: "One game stayed competitive until the last few possessions while the other tilted sharply before the break and never really swung back.",
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
  assert.ok(
    (firstGame.surpriseFactor ?? 0) > (secondGame.surpriseFactor ?? 10),
  );
  assert.ok((firstGame.surpriseFactor ?? 0) >= 9);
  assert.ok((secondGame.surpriseFactor ?? 10) <= 1.5);
});

test("validateGameDayRecapResult gates high- and low-scoring framing on scoring context", () => {
  const shootout = createExpectedPromptGame("m-high");
  shootout.gameScoringContext = "high_scoring_shootout";
  shootout.teams.away.score = 108;
  shootout.teams.home.score = 112;
  assert.doesNotThrow(() =>
    __testing.validateGameDayRecapResult(
      {
        games: [
          {
            evidenceTags: ["top_performance"],
            headline: "Home wins a high-scoring shootout",
            matchId: "m-high",
            writeup:
              "Home beat Away 112-108 in a high-scoring shootout where both teams topped 100 points.",
          },
        ],
        summary: {
          headline: "High-scoring night",
          lede: "Home had enough late offense.",
        },
      },
      [shootout],
    ),
  );

  const grind = createExpectedPromptGame("m-low");
  grind.gameScoringContext = "low_scoring_grind";
  grind.teams.away.score = 72;
  grind.teams.home.score = 76;
  assert.doesNotThrow(() =>
    __testing.validateGameDayRecapResult(
      {
        games: [
          {
            evidenceTags: ["top_performance"],
            headline: "Home survives low-scoring grind",
            matchId: "m-low",
            writeup:
              "Home beat Away 76-72 in a low-scoring defensive grind with both teams below 80 points.",
          },
        ],
        summary: {
          headline: "Low-scoring night",
          lede: "Home had enough defense.",
        },
      },
      [grind],
    ),
  );

  const ordinary = createExpectedPromptGame("m-normal");
  ordinary.teams.away.score = 88;
  ordinary.teams.home.score = 92;
  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["top_performance"],
              headline: "Home wins a high-scoring shootout",
              matchId: "m-normal",
              writeup: "Home beat Away 92-88 in a high-scoring shootout.",
            },
          ],
          summary: {
            headline: "Normal night",
            lede: "Home had enough offense.",
          },
        },
        [ordinary],
      ),
    /high-scoring framing/i,
  );
});

test("validateGameDayRecapResult does not treat losing-effort phrasing as a winner contradiction", () => {
  const result = createRecapCandidateResult({
    headline: "Home steadies late",
    writeup:
      "For Away, Norbert Ament scored 20 points and Ruslan Kozin pulled down 19 rebounds in a losing effort.",
  });

  const validated = __testing.validateGameDayRecapResult(result, [
    createExpectedPromptGame("m-1"),
  ]);
  assert.equal(validated.games[0]?.writeup, result.games[0]?.writeup);
  assert.equal(validated.summary.gameOfTheDayMatchId, "m-1");
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

test("judgeGameDayRecapResult flags a wrong winner in the headline", async () => {
  const result = createRecapCandidateResult({
    headline: "Away beats Home late",
    writeup:
      "Home still controlled enough of the closing stretch to keep the game from turning back into a full-possession scramble once the lead settled in.",
  });
  const evaluation = await judgeSingleGameResult({
    assessment: createJudgeCandidateAssessment({
      candidateIndex: 0,
      headline: result.games[0]!.headline,
      headlineContradictionType: "winner",
      headlineNotes: "Home won 85-81 in the structured fact store.",
      headlineSourceField: "factStore.games[0].winner.winnerName",
      headlineVerdict: "unsupported",
      writeup: result.games[0]!.writeup,
    }),
    result,
  });

  assert.equal(evaluation.blockingIssues.length, 1);
  const issue = expectPresent(
    evaluation.blockingIssues[0],
    "missing blocking headline issue",
  );
  assert.equal(issue.contradictionType, "winner");
  assert.equal(issue.field, "headline");
  assert.match(issue.feedback, /judged unsupported for winner/i);
});

test("judgeGameDayRecapResult flags a wrong winner in the writeup", async () => {
  const result = createRecapCandidateResult({
    headline: "Home closes steadily",
    writeup:
      "Away beat Home 81-85 in the closing stretch, turning the final possessions into a comeback that never actually happened in the supplied box score.",
  });
  const evaluation = await judgeSingleGameResult({
    assessment: createJudgeCandidateAssessment({
      candidateIndex: 0,
      headline: result.games[0]!.headline,
      writeup: result.games[0]!.writeup,
      writeupContainsOutcomeClaim: true,
      writeupContradictionType: "winner",
      writeupNotes: "Home was the winner in the fact store.",
      writeupSourceField: "factStore.games[0].winner",
      writeupVerdict: "unsupported",
    }),
    result,
  });

  assert.equal(evaluation.blockingIssues.length, 1);
  const issue = expectPresent(
    evaluation.blockingIssues[0],
    "missing blocking writeup issue",
  );
  assert.equal(issue.contradictionType, "winner");
  assert.equal(issue.field, "writeup");
});

test("judgeGameDayRecapResult flags a wrong final score", async () => {
  const result = createRecapCandidateResult({
    headline: "Home edges Away",
    writeup:
      "Home beat Away 86-81 after the final two possessions calmed down, but that score does not match the supplied final line.",
  });
  const evaluation = await judgeSingleGameResult({
    assessment: createJudgeCandidateAssessment({
      candidateIndex: 0,
      headline: result.games[0]!.headline,
      writeup: result.games[0]!.writeup,
      writeupContainsOutcomeClaim: true,
      writeupContradictionType: "final_score",
      writeupNotes: "The final score in the fact store is 85-81.",
      writeupSourceField: "factStore.games[0].winner.finalScoreHomeAway",
      writeupVerdict: "unsupported",
    }),
    result,
  });

  assert.equal(evaluation.blockingIssues.length, 1);
  const issue = expectPresent(
    evaluation.blockingIssues[0],
    "missing blocking final-score issue",
  );
  assert.equal(issue.contradictionType, "final_score");
  assert.match(
    issue.feedback,
    /factStore\.games\[0\]\.winner\.finalScoreHomeAway/i,
  );
});

test("judgeGameDayRecapResult flags a false overtime claim", async () => {
  const result = createRecapCandidateResult({
    headline: "Home survives in overtime",
    writeup:
      "Home escaped in overtime after Away pushed the finish tight, but the supplied quarter facts show the game ended in regulation.",
  });
  const evaluation = await judgeSingleGameResult({
    assessment: createJudgeCandidateAssessment({
      candidateIndex: 0,
      headline: result.games[0]!.headline,
      headlineContradictionType: "overtime",
      headlineNotes: "The fact store shows regulation only.",
      headlineSourceField: "factStore.games[0].overtime",
      headlineVerdict: "unsupported",
      writeup: result.games[0]!.writeup,
      writeupContainsOutcomeClaim: true,
      writeupContradictionType: "overtime",
      writeupNotes: "The game ended in regulation.",
      writeupSourceField: "factStore.games[0].overtime",
      writeupVerdict: "unsupported",
    }),
    result,
  });

  assert.equal(evaluation.blockingIssues.length, 2);
  assert.ok(
    evaluation.blockingIssues.every(
      (issue) => issue.contradictionType === "overtime",
    ),
  );
});

test("judgeGameDayRecapResult retries once when the judge returns incomplete slot coverage", async () => {
  const result = createRecapCandidateResult({
    headline: "Home edges Away",
    writeup:
      "Home controlled the last stretch. Away never found the basket that would have flipped the ending.",
  });
  let judgeCalls = 0;

  const evaluation = await __testing.judgeGameDayRecapResult({
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: [createExpectedPromptGame("m-1")],
      request: createSingleGameRecapPayload().request,
    }),
    provider: {
      generate: async (payload) => {
        judgeCalls += 1;
        if (judgeCalls === 1) {
          return {
            slotVerdicts: {
              slot0: createSupportedJudgeVerdictRecord({
                containsOutcomeClaim: true,
                sourceField: "factStore.games[0].winner",
              }),
            },
          };
        }

        return createSupportedJudgeResponseFromPayload(payload);
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    result,
    stage: "writer",
  });

  assert.equal(judgeCalls, 2);
  assert.equal(evaluation.blockingIssues.length, 0);
  assert.equal(evaluation.retryableIssues.length, 0);
});

test("judgeGameDayRecapResult fails after retry when the judge keeps returning unexpected keyed coverage", async () => {
  const result = createRecapCandidateResult({
    headline: "Home edges Away",
    writeup:
      "Home controlled the last stretch. Away never found the basket that would have flipped the ending.",
  });
  let judgeCalls = 0;

  await assert.rejects(
    () =>
      __testing.judgeGameDayRecapResult({
        factStore: __testing.buildGameDayRecapJudgeFactStore({
          expectedGames: [createExpectedPromptGame("m-1")],
          request: createSingleGameRecapPayload().request,
        }),
        provider: {
          generate: async (payload) => {
            judgeCalls += 1;
            const supported = createSupportedJudgeResponseFromPayload(payload);
            return {
              slotVerdicts: {
                ...("slotVerdicts" in supported ? supported.slotVerdicts : {}),
                slot99: createSupportedJudgeVerdictRecord({
                  sourceField: "factStore.games[0].playByPlayFacts",
                }),
              },
            };
          },
          modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
          providerName: "bedrock",
          stage: "judge",
        },
        result,
        stage: "writer",
      }),
    /expected sentence coverage contract/i,
  );

  assert.equal(judgeCalls, 2);
});

test("validateGameDayRecapResult allows the series state in the headline and the decisive ending in the opener", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.finalMargin = 2;
  expectedGame.type = "league.finals";
  expectedGame.teams.home.name = "Stark Contrast";
  expectedGame.teams.home.score = 88;
  expectedGame.teams.away.name = "LionPride";
  expectedGame.teams.away.score = 86;
  expectedGame.seriesContext = {
    isTerminal: false,
    postgameWins: {
      away: 0,
      home: 1,
    },
    stageKey: "finals",
    summaryLine: "Stark Contrast leads the series 1-0.",
  };
  expectedGame.playByPlayFacts = createBuzzerBeaterPlayByPlayFacts({
    awayScore: 86,
    awayTeamName: "LionPride",
    homeScore: 88,
    homeTeamName: "Stark Contrast",
  });
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;

  const result = {
    games: [
      {
        evidenceTags: ["buzzerbeater", "close_finish", "one_possession_finish"],
        headline: "Stark Contrast takes Game 1, leads series 1-0",
        matchId: "m-1",
        writeup:
          "Adrian Diaz buried the buzzerbeater at the horn to lift Stark Contrast past LionPride.",
      },
    ],
    summary: {
      headline: "League roundup",
      lede: "The series state belongs in the headline while the decisive ending anchors the writeup.",
    },
  };

  const validated = __testing.validateGameDayRecapResult(result, [
    expectedGame,
  ]);
  assert.equal(validated.games[0]?.writeup, result.games[0]?.writeup);
  assert.equal(validated.summary.gameOfTheDayMatchId, "m-1");
});

test("validateGameDayRecapResult rejects tied quarters described as controlled or dominated", () => {
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
              headline: "LA keeps control late",
              matchId: "m-1",
              writeup:
                "LA dominated the third quarter before the closing minutes finally broke the game open, even though the supplied period score was actually tied.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Tied quarters should never be described as if one side controlled or dominated them.",
          },
        },
        [expectedGame],
      ),
    /tied 24-24|tied 3rd quarter/i,
  );
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
            lede: "A single game delivered enough swing to create a full recap while the late push finally settled matters for the home side.",
          },
        },
        [expectedGame],
      ),
    /tied 24-24/i,
  );
});

test("validateGameDayRecapResult validates run sentences through run facts instead of quarter scores", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.playByPlayFacts = {
    ...createBackAndForthPlayByPlayFacts(),
    primaryRun: createRunFact({
      endAwayScore: 22,
      endClock: "10:30",
      endHomeScore: 26,
      endQuarter: 3,
      opponentPoints: 4,
      startAwayScore: 18,
      startClock: "05:49",
      startHomeScore: 16,
      startQuarter: 2,
      teamPoints: 10,
    }),
    summaryLines: [
      "Home used a 10-4 run from 05:49 left in the 2nd quarter to 10:30 left in the 3rd quarter to take control.",
    ],
  };

  assert.doesNotThrow(() =>
    __testing.validateGameDayRecapResult(
      {
        games: [
          {
            evidenceTags: ["recent_form"],
            headline: "Home takes control after halftime",
            matchId: "m-1",
            writeup:
              "Home used a 10-4 run from 05:49 left in the 2nd quarter to 10:30 left in the 3rd quarter to take control before the game settled into the final stretch.",
          },
        ],
        summary: {
          headline: "League roundup",
          lede: "The turning point came in a cross-quarter run rather than in any one quarter score.",
        },
      },
      [expectedGame],
    ),
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
            lede: "One matchup turned on the middle stretch before the winner still found a way to control the late possessions and finish the job.",
          },
        },
        [createExpectedPromptGame("m-1")],
      ),
    /actually won it/i,
  );
});

test("validateGameDayRecapResult leaves postgame record and streak mismatches to the judge", () => {
  assert.doesNotThrow(() =>
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
          lede: "A composed closing stretch protected the lead and preserved the control the eventual winner built over the course of the night.",
        },
      },
      [createExpectedPromptGame("m-1")],
    ),
  );
});

test("validateGameDayRecapResult leaves explicit streak-length mismatches to the judge", () => {
  assert.doesNotThrow(() =>
    __testing.validateGameDayRecapResult(
      {
        games: [
          {
            evidenceTags: ["winning_streak"],
            headline: "Home extends winning streak to eight",
            matchId: "m-1",
            writeup:
              "Home won its eighth straight and kept Away from ever fully flipping the late margin.",
          },
        ],
        summary: {
          headline: "League roundup",
          lede: "Explicit streak counts should now be handled by the fact-store judge rather than deterministic regex validation.",
        },
      },
      [createExpectedPromptGame("m-1")],
    ),
  );
});

test("validateGameDayRecapResult leaves through-three-quarters factuality to the judge", () => {
  assert.doesNotThrow(() =>
    __testing.validateGameDayRecapResult(
      {
        games: [
          {
            evidenceTags: ["recent_form"],
            headline: "Home finishes after steady control",
            matchId: "m-1",
            writeup:
              "Home led 60-58 through three quarters before finishing the game cleanly in the fourth.",
          },
        ],
        summary: {
          headline: "League roundup",
          lede: "Through-three-quarter state should now be judged against the canonical fact store rather than deterministic regex parsing.",
        },
      },
      [createExpectedPromptGame("m-1")],
    ),
  );
});

test("validateGameDayRecapResult rejects duplicate late outcome restatements", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.teams.home.name = "Stark Contrast";
  expectedGame.teams.home.score = 88;
  expectedGame.teams.away.name = "LionPride";
  expectedGame.teams.away.score = 86;

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["close_finish"],
              headline: "Stark Contrast steals it late",
              matchId: "m-1",
              writeup:
                "Stark Contrast closed the last push with one more answer after LionPride drew even in the final minute. Stark Contrast beat LionPride 88-86.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "A one-game slate should reject recaps that tack on a second sentence just to restate the winner and score.",
          },
        },
        [expectedGame],
      ),
    /throwaway sentence|repeated the outcome/i,
  );
});

test("validateGameDayRecapResult accepts composed game-day prep context sentences", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.requiredContextSentences = [
    "Both teams prepared well for Outside looks.",
    "On pace, Away prepared for Fast pace, but Home played Motion.",
  ];

  const result = __testing.validateGameDayRecapResult(
    {
      games: [
        {
          evidenceTags: ["recent_form"],
          headline: "Home beats Away 85-81",
          matchId: "m-1",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin. Both teams prepared well for Outside looks. On pace, Away prepared for Fast pace, but Home played Motion.",
        },
      ],
      summary: {
        headline: "League roundup",
        lede: "The preparation context should read naturally while staying deterministic.",
      },
    },
    [expectedGame],
  );

  assert.equal(result.games[0]?.writeup.includes("Both teams"), true);
});

test("validateGameDayRecapResult removes duplicated game-day prep paraphrases", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.requiredContextSentences = [
    "Both teams prepared well for Outside looks.",
    "On pace, Away prepared for Fast pace, but Home played Motion.",
  ];

  const result = __testing.validateGameDayRecapResult(
    {
      games: [
        {
          evidenceTags: ["recent_form"],
          headline: "Home beats Away 85-81",
          matchId: "m-1",
          writeup:
            "Away came to play on outside looks, and both teams prepared well for that emphasis. On pace, Away had readied for a fast tempo, but Home dictated the game through Motion instead. Both teams prepared well for Outside looks. On pace, Away prepared for Fast pace, but Home played Motion. Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        },
      ],
      summary: {
        headline: "League roundup",
        lede: "Duplicate preparation paraphrases should be removed once the exact grounded sentences are present.",
      },
    },
    [expectedGame],
  );

  const writeup = result.games[0]?.writeup ?? "";
  assert.doesNotMatch(writeup, /came to play on outside looks/i);
  assert.doesNotMatch(writeup, /had readied for a fast tempo/i);
  assert.match(writeup, /Both teams prepared well for Outside looks\./);
  assert.match(
    writeup,
    /On pace, Away prepared for Fast pace, but Home played Motion\./,
  );
});

test("validateGameDayRecapResult lets fact-library pregameBattle replace legacy required prep sentences", () => {
  const payload = createSingleGameRecapPayload("m-1");
  payload.games[0]!.requiredContextSentences = [
    "Home held the effort edge over Away.",
    "Home prepared well for Inside looks.",
  ];
  refreshPayloadFactStore(payload);
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: payload.coverage,
    factStore: payload.factStore,
  });
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game with pregameBattle",
  );

  const result = __testing.validateGameDayRecapResult(
    createRecapCandidateResult({
      headline: "Home beats Away 85-81",
      writeup:
        "Away paired Motion with 2-3 Zone, while Home answered with Push the Ball and Man-to-man, leaving the manager card mostly even.\n\nHome moved ahead after halftime and kept the game flow pointed toward the final margin.\n\nHome finished the 85-81 win with cleaner closing possessions.",
    }),
    [expectedGame],
  );

  assert.doesNotMatch(result.games[0]?.writeup ?? "", /held the effort edge/i);
});

test("assessGameDayRecapDeterministicPayload rejects raw or clunky pregame mechanics in fact-library recaps", () => {
  const payload = createSingleGameRecapPayload("m-1");
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: payload.coverage,
    factStore: payload.factStore,
  });
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game with pregameBattle",
  );
  const baseWriteup =
    "Away paired Motion with 2-3 Zone, while Home answered with Push the Ball and Man-to-man";

  const rawAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beats Away 85-81",
      writeup: `${baseWriteup}, and Home had GDP inside.hit on the board.\n\nHome moved ahead after halftime.\n\nHome finished the 85-81 win.`,
    }),
    [expectedGame],
  );
  assert.ok(
    rawAssessment.issues.some(
      (issue) => issue.kind === "raw_pregame_mechanics_language",
    ),
  );

  const rawTacticAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beats Away 85-81",
      writeup:
        "Away paired Motion with 23Zone, while Home answered with PushTheBall and ManToMan.\n\nHome moved ahead after halftime.\n\nHome finished the 85-81 win.",
    }),
    [expectedGame],
  );
  assert.ok(
    rawTacticAssessment.issues.some(
      (issue) => issue.kind === "raw_pregame_mechanics_language",
    ),
  );

  const clunkyAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beats Away 85-81",
      writeup: `${baseWriteup}, and Home held the effort edge over Away.\n\nHome moved ahead after halftime.\n\nHome finished the 85-81 win.`,
    }),
    [expectedGame],
  );
  assert.ok(
    clunkyAssessment.issues.some(
      (issue) => issue.kind === "clunky_pregame_mechanics_phrase",
    ),
  );
});

test("assessGameDayRecapDeterministicPayload rejects unsupported pregame color and missing tactics", () => {
  const payload = createSingleGameRecapPayload("m-1");
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: payload.coverage,
    factStore: payload.factStore,
  });
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game with pregameBattle",
  );

  const colorAssessment = __testing.assessGameDayRecapDeterministicPayload(
    createRecapCandidateResult({
      headline: "Home beats Away 85-81",
      writeup:
        "Away paired Motion with 2-3 Zone, while Home answered with Push the Ball and Man-to-man after the coach told them this was personal.\n\nHome moved ahead after halftime.\n\nHome finished the 85-81 win.",
    }),
    [expectedGame],
  );
  assert.ok(
    colorAssessment.issues.some(
      (issue) => issue.kind === "unsupported_pregame_color",
    ),
  );

  const missingTacticsAssessment =
    __testing.assessGameDayRecapDeterministicPayload(
      createRecapCandidateResult({
        headline: "Home beats Away 85-81",
        writeup:
          "Home had the cleaner manager card.\n\nHome moved ahead after halftime.\n\nHome finished the 85-81 win.",
      }),
      [expectedGame],
    );
  assert.ok(
    missingTacticsAssessment.issues.some(
      (issue) => issue.kind === "missing_pregame_tactical_setup",
    ),
  );
});

test("strict filler validation remains available for QA mode", () => {
  const assessed = __testing.assessGameDayRecapDeterministicPayload(
    {
      games: [
        {
          evidenceTags: ["close_finish"],
          headline: "Home survives the late push",
          matchId: "m-1",
          writeup:
            "Home found one more basket at a key juncture and kept Away from flipping the last few possessions.",
        },
      ],
      summary: {
        headline: "League roundup",
        lede: "Strict QA mode can still flag filler when explicitly enabled.",
      },
    },
    [createExpectedPromptGame("m-1")],
    {
      enforceBannedStylePhrases: true,
    },
  );

  assert.equal(
    assessed.issues.some((issue) => issue.kind === "banned_style_phrase"),
    true,
  );
});

test("judgeGameDayRecapResult flags unsupported run claims", async () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.playByPlayFacts = {
    ...createBuzzerBeaterPlayByPlayFacts(),
    bestCompetitiveSwingRun: createRunFact({
      endAwayScore: 75,
      endClock: "04:35",
      endHomeScore: 86,
      endQuarter: 3,
      opponentPoints: 3,
      runType: "swing",
      startAwayScore: 72,
      startClock: "08:00",
      startHomeScore: 72,
      startQuarter: 3,
      teamName: "Home",
      teamPoints: 14,
      teamSide: "home",
    }),
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    summaryLines: [
      "Home answered with a 14-3 run from 08:00 left in the 3rd quarter to 04:35 left in the 3rd quarter.",
    ],
  };
  expectedGame.playByPlayFacts.endingFacts.decisiveScore.isBuzzerBeater = false;
  expectedGame.playByPlayFacts.primaryRun = null;
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;
  const result = createRecapCandidateResult({
    headline: "Home finds the separation",
    writeup:
      "Home ripped off a 10-0 run to break the game open before the fourth quarter even started.",
  });

  const judged = await judgeSingleGameResult({
    assessment: createJudgeCandidateAssessment({
      candidateIndex: 0,
      headline: result.games[0]!.headline,
      writeup: result.games[0]!.writeup,
      writeupContradictionType: "run",
      writeupNotes:
        "The run claim does not match any supported play-by-play run in the fact store.",
      writeupSourceField:
        "factStore.games[0].playByPlayFacts.bestCompetitiveSwingRun",
      writeupVerdict: "unsupported",
    }),
    expectedGame,
    result,
  });
  const blockingIssue = expectPresent(
    judged.blockingIssues[0],
    "missing blocking run issue",
  );

  assert.equal(blockingIssue.contradictionType, "run");
  assert.match(
    blockingIssue.sourceField ?? "",
    /playByPlayFacts\.bestCompetitiveSwingRun/i,
  );
});

test("validateGameDayRecapResult rejects run mentions without timing anchors", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.playByPlayFacts = {
    ...createBuzzerBeaterPlayByPlayFacts(),
    bestCompetitiveSwingRun: createRunFact({
      endAwayScore: 75,
      endClock: "04:35",
      endHomeScore: 86,
      endQuarter: 3,
      opponentPoints: 3,
      runType: "swing",
      startAwayScore: 72,
      startClock: "08:00",
      startHomeScore: 72,
      startQuarter: 3,
      teamName: "Home",
      teamPoints: 14,
      teamSide: "home",
    }),
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    summaryLines: [
      "Home answered with a 14-3 run from 08:00 left in the 3rd quarter to 04:35 left in the 3rd quarter.",
    ],
  };
  expectedGame.playByPlayFacts.endingFacts.decisiveScore.isBuzzerBeater = false;
  expectedGame.playByPlayFacts.primaryRun =
    expectedGame.playByPlayFacts.bestCompetitiveSwingRun;
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Home turns the middle stretch",
              matchId: "m-1",
              writeup:
                "Home answered with a 14-3 run to swing the game before halftime.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Supported runs should still include their anchored timing instead of vague momentum phrasing.",
          },
        },
        [expectedGame],
      ),
    /broad elapsed|timing anchors|08:00/i,
  );
});

test("validateGameDayRecapResult rejects run mentions with stale first-basket start times", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.teams.away.name = "Splash Gang";
  expectedGame.teams.home.name = "Silverbacks";
  const comebackRun = createRunFact({
    endAwayScore: 55,
    endClock: "0:23",
    endHomeScore: 66,
    endQuarter: 4,
    opponentPoints: 2,
    runType: "swing",
    startAwayScore: 45,
    startClock: "1:52",
    startHomeScore: 64,
    startQuarter: 4,
    teamName: "Splash Gang",
    teamPoints: 10,
    teamSide: "away",
  });
  expectedGame.playByPlayFacts = {
    ...createBuzzerBeaterPlayByPlayFacts(),
    bestCompetitiveSwingRun: comebackRun,
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    primaryRun: comebackRun,
    summaryLines: [
      "Splash Gang showed signs of life with a 10-2 run from 1:52 left in the 4th quarter to 0:23 left in the 4th quarter, but it was not enough.",
    ],
  };
  expectedGame.playByPlayFacts.endingFacts.decisiveScore.isBuzzerBeater = false;
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Silverbacks hold off Splash Gang",
              matchId: "m-1",
              writeup:
                "Splash Gang showed signs of life with a 10-2 run from 1:46 left in the 4th quarter to 0:23 left in the 4th quarter, but it was not enough.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Supported runs should use the score-baseline start time.",
          },
        },
        [expectedGame],
      ),
    /broad elapsed|90 seconds|1:52 left in the 4th quarter/i,
  );
});

test("validateGameDayRecapResult rejects overlapping run mentions", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  const primaryRun = createRunFact({
    endAwayScore: 45,
    endClock: "06:25",
    endHomeScore: 60,
    endQuarter: 4,
    opponentPoints: 4,
    runType: "swing",
    startAwayScore: 41,
    startClock: "11:04",
    startHomeScore: 45,
    startQuarter: 4,
    teamName: "Home",
    teamPoints: 15,
    teamSide: "home",
  });
  const overlappingRun = createRunFact({
    endAwayScore: 41,
    endClock: "09:09",
    endHomeScore: 56,
    endQuarter: 4,
    opponentPoints: 2,
    runType: "swing",
    startAwayScore: 39,
    startClock: "02:52",
    startHomeScore: 43,
    startQuarter: 3,
    teamName: "Home",
    teamPoints: 13,
    teamSide: "home",
  });
  expectedGame.playByPlayFacts = {
    ...createBuzzerBeaterPlayByPlayFacts(),
    bestCompetitiveSwingRun: overlappingRun,
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    primaryRun,
    secondaryRun: overlappingRun,
    summaryLines: [
      "Home used a 15-4 run from 11:04 left in the 4th quarter to 06:25 left in the 4th quarter to put the game away.",
      "Home used a 13-2 run from 02:52 left in the 3rd quarter to 09:09 left in the 4th quarter to seize control.",
    ],
  };
  expectedGame.playByPlayFacts.endingFacts.decisiveScore.isBuzzerBeater = false;
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Home turns the game late",
              matchId: "m-1",
              writeup:
                "Home used a 15-4 run from 11:04 left in the 4th quarter to 06:25 left in the 4th quarter to put the game away. Home then cited a 13-2 run from 02:52 left in the 3rd quarter to 09:09 left in the 4th quarter as another separate swing.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Overlapping run windows should not be stacked as separate story beats.",
          },
        },
        [expectedGame],
      ),
    /overlapping run windows/i,
  );
});

test("validateGameDayRecapResult rejects comeback phrasing for a run that started tied", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  const tiedStartRun = createRunFact({
    endAwayScore: 22,
    endClock: "04:35",
    endHomeScore: 28,
    endQuarter: 3,
    opponentPoints: 2,
    runType: "swing",
    startAwayScore: 20,
    startClock: "08:40",
    startHomeScore: 20,
    startQuarter: 3,
    teamName: "Home",
    teamPoints: 8,
    teamSide: "home",
  });
  expectedGame.playByPlayFacts = {
    ...createBuzzerBeaterPlayByPlayFacts(),
    bestCompetitiveSwingRun: tiedStartRun,
    longestUnansweredRun: createEmptyRunFact("unanswered"),
    primaryRun: tiedStartRun,
    summaryLines: [
      "Home used an 8-2 run from 08:40 left in the 3rd quarter to 04:35 left in the 3rd quarter to open the lead.",
    ],
  };
  expectedGame.playByPlayFacts.endingFacts.decisiveScore.isBuzzerBeater = false;
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Home steadies late",
              matchId: "m-1",
              writeup:
                "Home showed signs of life with an 8-2 run from 08:40 left in the 3rd quarter to 04:35 left in the 3rd quarter.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Run language should match whether the team was actually climbing back or already level.",
          },
        },
        [expectedGame],
      ),
    /comeback phrasing|started that 8-2 run tied/i,
  );
});

test("validateGameDayRecapResult rejects contrasting wording for same-family offenses", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.teams.away.name = "Flashover";
  expectedGame.teams.away.offStrategy = "Motion";
  expectedGame.teams.home.name = "Mos Eisley Imperials";
  expectedGame.teams.home.offStrategy = "Princeton";

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Mos Eisley Imperials close strong",
              matchId: "m-1",
              writeup:
                "The two teams employed contrasting offensive systems as Flashover ran Motion while Mos Eisley Imperials worked from Princeton.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Same-family outside offenses should not be framed as opposites.",
          },
        },
        [expectedGame],
      ),
    /Motion and Princeton were described as contrasting offenses/i,
  );
});

test("judgeGameDayRecapResult flags unsupported lead-change counts", async () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.playByPlayFacts = createBackAndForthPlayByPlayFacts();
  expectedGame.playByPlayFacts.primaryRun = null;
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;
  const result = createRecapCandidateResult({
    headline: "Home survives the chaos",
    writeup:
      "The lead changed hands six times in the final two minutes before Home finally steadied the game.",
  });

  const judged = await judgeSingleGameResult({
    assessment: createJudgeCandidateAssessment({
      candidateIndex: 0,
      headline: result.games[0]!.headline,
      writeup: result.games[0]!.writeup,
      writeupContradictionType: "lead_change",
      writeupNotes:
        "The lead-change count does not match the supported rapid-burst or full-game fact-store counts.",
      writeupSourceField: "factStore.games[0].playByPlayFacts.leadChangeFacts",
      writeupVerdict: "unsupported",
    }),
    expectedGame,
    result,
  });
  const blockingIssue = expectPresent(
    judged.blockingIssues[0],
    "missing blocking lead-change count issue",
  );

  assert.equal(blockingIssue.contradictionType, "lead_change");
  assert.match(
    blockingIssue.sourceField ?? "",
    /playByPlayFacts\.leadChangeFacts/i,
  );
});

test("judgeGameDayRecapResult flags unsupported comeback-to-the-lead claims", async () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.playByPlayFacts = createBackAndForthPlayByPlayFacts();
  expectedGame.playByPlayFacts.primaryRun = null;
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;
  const result = createRecapCandidateResult({
    headline: "Home rallies all the way back",
    writeup:
      "Home erased a 10-point deficit and took the lead in the final minute before one more answer settled the game.",
  });

  const judged = await judgeSingleGameResult({
    assessment: createJudgeCandidateAssessment({
      candidateIndex: 0,
      headline: result.games[0]!.headline,
      writeup: result.games[0]!.writeup,
      writeupContradictionType: "lead_change",
      writeupNotes:
        "The comeback-to-the-lead claim is not supported by the structured lead-change facts.",
      writeupSourceField:
        "factStore.games[0].playByPlayFacts.leadChangeFacts.bigComebackLeadChange",
      writeupVerdict: "unsupported",
    }),
    expectedGame,
    result,
  });
  const blockingIssue = expectPresent(
    judged.blockingIssues[0],
    "missing blocking comeback lead-change issue",
  );

  assert.equal(blockingIssue.contradictionType, "lead_change");
  assert.match(blockingIssue.sourceField ?? "", /bigComebackLeadChange/i);
});

test("validateGameDayRecapResult rejects one-game streak language", () => {
  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Home closes late",
              matchId: "m-1",
              writeup:
                "Home snapped a one-game losing streak and kept Away from turning the closing stretch into a full comeback.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "One-game results should never be framed as streaks in the generated recap.",
          },
        },
        [createExpectedPromptGame("m-1")],
      ),
    /one-game result a streak/i,
  );
});

test("validateGameDayRecapResult rejects playoff regular-season record language", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.type = "league.finals";
  expectedGame.seriesContext = {
    isTerminal: false,
    postgameWins: {
      away: 0,
      home: 1,
    },
    stageKey: "finals",
    summaryLine: "Home leads the series 1-0.",
  };

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["close_finish"],
              headline: "Home takes Game 1",
              matchId: "m-1",
              writeup:
                "Home leads the series 1-0. Home improved to 13-3 on the season with a composed finish in the closing possessions.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Playoff recaps should never drift back into regular-season record framing.",
          },
        },
        [expectedGame],
      ),
    /do not mention regular-season records/i,
  );
});

test("validateGameDayRecapResult rejects playoff streak language", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.type = "league.finals";
  expectedGame.seriesContext = {
    isTerminal: false,
    postgameWins: {
      away: 0,
      home: 1,
    },
    stageKey: "finals",
    summaryLine: "Home leads the series 1-0.",
  };

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["close_finish"],
              headline: "Home takes Game 1",
              matchId: "m-1",
              writeup:
                "Home leads the series 1-0. Home won its fourth straight by controlling the last few possessions.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Playoff recaps should use the series score instead of streak framing.",
          },
        },
        [expectedGame],
      ),
    /winning or losing streaks in a playoff recap/i,
  );
});

test("validateGameDayRecapResult rejects missing required effort or prep context sentences", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.requiredContextSentences = [
    "Home held the effort edge over Away.",
  ];

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Home beats Away 85-81",
              matchId: "m-1",
              writeup:
                "Home handled the closing possessions without letting Away steal the result.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Required effort and preparation context should be enforced deterministically.",
          },
        },
        [expectedGame],
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "GameDayRecapSemanticValidationError");
      assert.ok(
        "issues" in error &&
          Array.isArray((error as { issues?: unknown }).issues) &&
          (
            error as {
              issues: Array<{ kind?: unknown }>;
            }
          ).issues.some(
            (issue) => issue.kind === "missing_required_context_sentence",
          ),
      );
      return true;
    },
  );
});

test("validateGameDayRecapResult requires supplied buzzerbeaters to be foregrounded", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.finalMargin = 2;
  expectedGame.teams.home.name = "Stark Contrast";
  expectedGame.teams.home.score = 88;
  expectedGame.teams.away.name = "LionPride";
  expectedGame.teams.away.score = 86;
  expectedGame.playByPlayFacts = createBuzzerBeaterPlayByPlayFacts({
    awayScore: 86,
    awayTeamName: "LionPride",
    homeScore: 88,
    homeTeamName: "Stark Contrast",
  });
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["close_finish", "one_possession_finish"],
              headline: "Stark Contrast rallies past LionPride",
              matchId: "m-1",
              writeup:
                "Adrian Diaz tied the game at 86-86 with 0:16 remaining before Stark Contrast scored the go-ahead basket with no time left on the clock.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "A supplied buzzerbeater should be named directly instead of being buried in generic late-game language.",
          },
        },
        [expectedGame],
      ),
    /buzzerbeater/i,
  );
});

test("validateGameDayRecapResult requires the standardized series state in the headline", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.teams.home.name = "Alpha";
  expectedGame.teams.away.name = "Beta";
  expectedGame.seriesContext = {
    isTerminal: false,
    postgameWins: {
      away: 0,
      home: 1,
    },
    stageKey: "finals",
    summaryLine: "Alpha leads the series 1-0.",
  };

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["close_finish"],
              headline: "Alpha finds the late answers",
              matchId: "m-1",
              writeup:
                "Alpha closed the final stretch with one more push and never let Beta draw even once the margin turned. The home side controlled the last few possessions cleanly.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "Best-of-three finals recaps should always state the new series score in the headline.",
          },
        },
        [expectedGame],
      ),
    /Alpha leads the series 1-0/i,
  );
});

test("validateGameDayRecapResult rejects conflicting series lines", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.teams.home.name = "Alpha";
  expectedGame.teams.away.name = "Beta";
  expectedGame.seriesContext = {
    isTerminal: true,
    postgameWins: {
      away: 1,
      home: 2,
    },
    stageKey: "finals",
    summaryLine: "Alpha wins the series 2-1.",
  };

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["close_finish"],
              headline: "Alpha wins series 2-1",
              matchId: "m-1",
              writeup:
                "Alpha wins the series 2-1. Alpha stayed composed in the closing possessions and held Beta off after the lead changed hands in the fourth. Beta wins the series 2-0.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "A conflicting series sentence later in the writeup should fail validation.",
          },
        },
        [expectedGame],
      ),
    /Alpha wins the series 2-1|Beta wins the series 2-0/i,
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
        feedback:
          "For match m-1, Home's postgame record is 13-3. Do not use 12-3.",
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

test("removeInvalidWriteupSentences ignores decisive-ending opener-structure-only issues", () => {
  const originalGame = {
    evidenceTags: ["recent_form"] as const,
    headline: "Home wins",
    matchId: "m-1",
    writeup:
      "The opener should still be rebuilt instead of trimmed. Home kept enough control to finish the win.",
  };

  const trimmedGame = __testing.removeInvalidWriteupSentences(originalGame, [
    {
      feedback: "restore the decisive ending in the opener",
      field: "writeup",
      kind: "missing_decisive_ending_emphasis",
      matchId: "m-1",
      reason: "decisive ending missing from the opener",
      salvage: "patch_or_remove",
      sentence: "The opener should still be rebuilt instead of trimmed.",
      sentenceIndex: 0,
      teamSide: "home",
    },
  ]);

  assert.deepStrictEqual(trimmedGame, originalGame);
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
        lede: "The winner had strong pregame form, but the recap still centered on a late stretch that kept the result under control to the horn.",
      },
    },
    [createExpectedPromptGame("m-1")],
  );

  assert.equal(result.games[0]?.matchId, "m-1");
});

test("generateResolvedGameDayRecap drops an invalid postgameInterview and logs the reason", async () => {
  const payload = createSingleGameRecapPayload();
  const capturedWarns: Array<[unknown, unknown]> = [];
  const originalWarn = console.warn;

  console.warn = ((message?: unknown, details?: unknown) => {
    capturedWarns.push([message, details]);
  }) as typeof console.warn;

  try {
    const result = await __testing.generateResolvedGameDayRecap({
      judgeProvider: createPassingJudgeProvider(),
      payload,
      qualityTier: "standard",
      retryProvider: null,
      targetKey: "100#2026-03-15#fact-library-first",
      userId: "user-1",
      writerProvider: {
        generate: async () => ({
          games: [
            {
              evidenceTags: ["recent_form"],
              headline: "Home beats Away 85-81",
              matchId: "m-1",
              postgameInterview: {
                playerName: "Home Hero",
                qa: [
                  {
                    answer:
                      "We kept the pace where we wanted it and trusted the next pass.",
                    question: "What settled the group late?",
                  },
                  {
                    answer:
                      "Everybody stayed connected, especially once the defense tightened up.",
                    question: "How did the defense change in the second half?",
                  },
                  {
                    answer: "We just kept competing.",
                    question: "Any final thought before the next game?",
                  },
                  {
                    answer: "We are already thinking about the next one.",
                    question: "What comes next?",
                  },
                ],
                teamName: "Home",
                teamSide: "winner",
                title: "",
              },
              writeup:
                "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
            },
          ],
          summary: {
            headline: "League roundup",
            lede: "A clean late finish carried the home side over the line.",
          },
        }),
        modelId: DEFAULT_RECAP_MODEL_ID,
        providerName: "bedrock",
        stage: "writer",
      },
    });

    const game = expectPresent(
      result.result.games[0],
      "missing generated recap game",
    );
    assert.equal(game.postgameInterview, undefined);
    assert.equal(
      game.writeup,
      "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
    );
  } finally {
    console.warn = originalWarn;
  }

  const warningLog = capturedWarns.find(
    ([message]) =>
      typeof message === "string" &&
      message.includes("process.postgame_interview_dropped"),
  );
  assert.ok(warningLog, "expected a dropped postgame interview warning");
  assert.deepStrictEqual(warningLog[1], {
    candidateIndex: null,
    details: [
      'teamSide must be "away" or "home".',
      "title was missing or empty.",
      "qa must contain 1 to 3 exchanges, received 4.",
    ],
    matchId: "m-1",
    reason: 'teamSide must be "away" or "home".',
    stage: "writer_initial",
    targetKey: "100#2026-03-15#fact-library-first",
    userId: "user-1",
  });
});

test("generateResolvedGameDayRecap adds a guaranteed postgameInterview when a candidate exists", async () => {
  const payload = createSingleGameRecapPayload();
  expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  ).postgameInterviewCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };
  let capturedInterviewPayload: unknown = null;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (payload) => {
        if (isPostgameInterviewPayloadForTest(payload)) {
          capturedInterviewPayload = payload;
        }
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(payload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(payload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  const interview = expectPresent(
    result.result.games[0]?.postgameInterview,
    "expected the guaranteed postgame interview to be attached",
  );
  assert.equal(interview.teamSide, "home");
  assert.equal(interview.teamName, "Home");
  assert.match(interview.title, /on Home's win/);
  assert.equal(interview.qa.length, 2);
  assert.match(
    interview.qa[0]?.question ?? "",
    /started opening up/i,
  );
  assert.match(interview.qa[0]?.answer ?? "", /steady scoring pressure/i);
  assert.match(interview.qa[1]?.question ?? "", /file paperwork/i);
  assert.ok(
    capturedInterviewPayload &&
      typeof capturedInterviewPayload === "object" &&
      "interviewFacts" in capturedInterviewPayload,
    "expected generated interview request to include interview-safe facts",
  );
  const interviewFacts = (
    capturedInterviewPayload as {
      interviewFacts: {
        safeContext: string[];
        statUsageGuidance: string;
        storyBeats: string[];
      };
    }
  ).interviewFacts;
  assert.match(interviewFacts.statUsageGuidance, /Do not quote a bundle/i);
  assert.doesNotMatch(
    [...interviewFacts.safeContext, ...interviewFacts.storyBeats].join(" "),
    /\b(?:GDP|team talent|rating|inside looks|outside looks|normal pace|fast pace|slow pace)\b/i,
  );
});

test("generateResolvedGameDayRecap retries from deterministic validation even when model judging is disabled", async () => {
  const payload = createSingleGameRecapPayload();
  let providerCalls = 0;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: null,
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (...providerArgs: any[]) => {
        const [providerPayload] = providerArgs;
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(providerPayload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(providerPayload)) {
          throw new Error("expected main recap writer payload");
        }

        providerCalls += 1;
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            providerCalls === 1
              ? "Home won the third quarter 22-20 before finally finishing the job in the fourth."
              : "Away won the third quarter 22-20, but Home steadied itself in the fourth quarter and closed out an 85-81 win.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(providerCalls, 2);
  const game = expectPresent(
    result.result.games[0],
    "expected a generated recap game after deterministic retry",
  );
  const validation = expectPresent(game.validation, "expected recap validation");
  assert.equal(validation.status, "VALID");
  assert.equal(
    validation.issues.every((issue) => issue.source === "deterministic"),
    true,
  );
  assert.match(game.writeup, /Away won the third quarter 22-20/i);
});

test("generateResolvedGameDayRecap attaches winner and loser postgame interviews for single-game recaps even on standard tier", async () => {
  const payload = createSingleGameRecapPayload();
  const factStoreGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  ) as typeof payload.factStore.games[number] & {
    postgameInterviewCandidates?: Array<{
      playerName: string;
      selectionReason: string;
      statLine: {
        assists: number;
        blocks: number;
        minutes: number;
        points: number;
        rebounds: number;
        steals: number;
        turnovers: number;
      };
      supportedFacts: string[];
      teamName: string;
      teamSide: "away" | "home";
      perspective?: "loser" | "winner";
    }>;
  };
  const winnerCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home" as const,
    perspective: "winner" as const,
  };
  const loserCandidate = {
    playerName: "Away Voice",
    selectionReason: "best losing-side line in a close finish",
    statLine: {
      assists: 6,
      blocks: 0,
      minutes: 38,
      points: 19,
      rebounds: 11,
      steals: 1,
      turnovers: 2,
    },
    supportedFacts: ["Away Voice paced Away with 19 points and 11 rebounds."],
    teamName: "Away",
    teamSide: "away" as const,
    perspective: "loser" as const,
  };
  factStoreGame.postgameInterviewCandidate = winnerCandidate;
  factStoreGame.postgameInterviewCandidates = [winnerCandidate, loserCandidate];

  const writerProvider = {
    generate: async (providerPayload: unknown) => {
      const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(providerPayload);
      if (auxiliary) {
        return auxiliary.response;
      }
      if (!isMainRecapWriterPayloadForTest(providerPayload)) {
        throw new Error("expected main recap writer payload");
      }
      return createRecapCandidateResult({
        headline: "Home beats Away 85-81",
        writeup:
          "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
      });
    },
    modelId: DEFAULT_RECAP_MODEL_ID,
    providerName: "bedrock" as const,
    stage: "writer" as const,
  };

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: null,
    payload,
    qualityTier: "standard",
    retryProvider: {
      ...writerProvider,
      stage: "retry_writer" as const,
    },
    writerProvider,
  });

  const game = expectPresent(
    result.result.games[0],
    "expected a generated premium recap game",
  );
  const interviews = expectPresent(
    game.postgameInterviews,
    "expected premium winner and loser interviews",
  );
  assert.deepStrictEqual(
    interviews.map((interview) => interview.playerName),
    ["Home Hero", "Away Voice"],
  );
  assert.equal(game.postgameInterview?.playerName, "Home Hero");
  assert.deepStrictEqual(
    game.postgameInterviewDiagnostics?.map(
      (diagnostic) => `${diagnostic.side}:${diagnostic.status}`,
    ),
    ["winner:generated", "loser:generated"],
  );
});

test("generateResolvedGameDayRecap synthesizes a missing losing-side interview candidate for single-game recaps", async () => {
  const payload = createSingleGameRecapPayload();
  const factStoreGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  );
  factStoreGame.postgameInterviewCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };
  factStoreGame.teams.away.topPlayers = [
    {
      assists: 6,
      blocks: 0,
      minutes: 38,
      name: "Away Voice",
      points: 19,
      rebounds: 11,
      steals: 1,
      turnovers: 2,
    },
  ];

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: null,
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (providerPayload) => {
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(providerPayload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(providerPayload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  const game = expectPresent(
    result.result.games[0],
    "expected a generated single-game recap",
  );
  assert.deepStrictEqual(
    game.postgameInterviews?.map((interview) => interview.playerName),
    ["Home Hero", "Away Voice"],
  );
  assert.deepStrictEqual(
    game.postgameInterviewDiagnostics?.map(
      (diagnostic) => `${diagnostic.side}:${diagnostic.status}`,
    ),
    ["winner:generated", "loser:generated"],
  );
});

test("generateResolvedGameDayRecap keeps suspect winner and loser interviews for single-game recaps", async () => {
  const payload = createSingleGameRecapPayload();
  const factStoreGame = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  ) as typeof payload.factStore.games[number] & {
    postgameInterviewCandidates?: Array<{
      playerName: string;
      selectionReason: string;
      statLine: {
        assists: number;
        blocks: number;
        minutes: number;
        points: number;
        rebounds: number;
        steals: number;
        turnovers: number;
      };
      supportedFacts: string[];
      teamName: string;
      teamSide: "away" | "home";
      perspective?: "loser" | "winner";
    }>;
  };
  factStoreGame.postgameInterviewCandidates = [
    {
      playerName: "Home Hero",
      selectionReason: "top scorer for the winning team",
      statLine: {
        assists: 4,
        blocks: 1,
        minutes: 39,
        points: 24,
        rebounds: 8,
        steals: 2,
        turnovers: 3,
      },
      supportedFacts: ["Home Hero led the winners with 24 points."],
      teamName: "Home",
      teamSide: "home",
      perspective: "winner",
    },
    {
      playerName: "Away Voice",
      selectionReason: "best losing-side line in a close finish",
      statLine: {
        assists: 6,
        blocks: 0,
        minutes: 38,
        points: 19,
        rebounds: 11,
        steals: 1,
        turnovers: 2,
      },
      supportedFacts: ["Away Voice paced Away with 19 points and 11 rebounds."],
      teamName: "Away",
      teamSide: "away",
      perspective: "loser",
    },
  ];

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider({
      generate: (judgePayload) => {
        if (judgePayload.judgeKind === "candidate_interestingness") {
          return createInterestingnessJudgeResponseFromPayload({
            candidateIndex: judgePayload.candidateIndex,
            interestingnessScore: 5,
          });
        }

        return mapJudgeResponseSentenceVerdicts(
          createSupportedJudgeResponseFromPayload(judgePayload),
          ({ sentenceKey, verdict }) =>
            sentenceKey.includes(":postgameInterview:")
              ? {
                  ...verdict,
                  contradictionType: "other",
                  notes:
                    "This interview line could not be fully grounded against the supported facts.",
                  sourceField: "postgameInterviewCandidates",
                  verdict: "unsupported",
                }
              : verdict,
        );
      },
    }),
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (providerPayload) => {
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(providerPayload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(providerPayload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  const game = expectPresent(
    result.result.games[0],
    "expected a generated single-game recap",
  );
  assert.deepStrictEqual(
    game.postgameInterviews?.map((interview) => interview.playerName),
    ["Home Hero", "Away Voice"],
  );
  const diagnostics = expectPresent(
    game.postgameInterviewDiagnostics,
    "expected suspect interview diagnostics",
  );
  assert.deepStrictEqual(
    diagnostics.map(
      (diagnostic) => `${diagnostic.side}:${diagnostic.status}`,
    ),
    ["winner:suspect", "loser:suspect"],
  );
  assert.equal(
    diagnostics.every(
      (diagnostic) =>
        diagnostic.reason ===
        "Interview was kept despite validation warnings.",
    ),
    true,
  );
  assert.equal(
    diagnostics.every((diagnostic) =>
      diagnostic.details.some((detail) =>
        detail.includes("Judge check: This interview line could not be fully grounded"),
      ),
    ),
    true,
  );
});

test("generateResolvedGameDayRecap falls back to a deterministic interview when generation stays invalid", async () => {
  const payload = createSingleGameRecapPayload();
  expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  ).postgameInterviewCandidate = {
    playerName: "Home Hero",
    personalitySource: "user_override",
    personalityType: "curt",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (payload) => {
        if (isPostgameInterviewPayloadForTest(payload)) {
          return {
            playerName: payload.candidate.playerName,
            qa: [],
            teamName: payload.candidate.teamName,
            teamSide: "winner",
            title: "",
          };
        }
        if (isStylePolishPayloadForTest(payload)) {
          return {
            writeup: payload.recapGame.writeup,
          };
        }
        if (!isMainRecapWriterPayloadForTest(payload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  const game = expectPresent(
    result.result.games[0],
    "missing generated recap game",
  );
  assert.equal(
    game.writeup,
    "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
  );
  const interview = expectPresent(
    game.postgameInterview,
    "expected fallback interview to keep the recap result intact",
  );
  assert.equal(interview.teamSide, "home");
  assert.equal(interview.teamName, "Home");
  assert.equal(interview.qa.length, 2);
  const fallbackExchange = interview.qa[0]!;
  assert.equal(
    fallbackExchange.question,
    "What did the game feel like once it started opening up for you?",
  );
  assert.match(fallbackExchange.answer, /^Best player on the floor\./i);
  assert.doesNotMatch(fallbackExchange.answer, /\b24 points\b/i);
  assert.match(interview.qa[1]?.question ?? "", /file paperwork/i);
});

test("generateResolvedGameDayRecap skips polish and interview generation when remaining time is low", async () => {
  const payload = createSingleGameRecapPayload();
  expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  ).postgameInterviewCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };

  let interviewCalls = 0;
  let stylePolishCalls = 0;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "standard",
    remainingTimeInMillis: () => 20_000,
    retryProvider: null,
    writerProvider: {
      generate: async (payload) => {
        if (isPostgameInterviewPayloadForTest(payload)) {
          interviewCalls += 1;
          throw new Error(
            "interview generation should be skipped on low budget",
          );
        }
        if (isStylePolishPayloadForTest(payload)) {
          stylePolishCalls += 1;
          return {
            writeup: payload.recapGame.writeup,
          };
        }
        if (!isMainRecapWriterPayloadForTest(payload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(stylePolishCalls, 0);
  assert.equal(interviewCalls, 0);
  assert.equal(result.result.games[0]?.postgameInterview?.teamSide, "home");
});

test("generateResolvedGameDayRecap completes an eight-game premium slate with optional finishing passes bounded by budget", async () => {
  const games = Array.from({ length: 8 }, (_, index) => ({
    ...createExpectedPromptGame(`m-${index + 1}`),
    postgameInterviewCandidate: {
      playerName: `Home Hero ${index + 1}`,
      selectionReason: "top scorer for the winning team",
      statLine: {
        assists: 4,
        blocks: 1,
        minutes: 39,
        points: 24,
        rebounds: 8,
        steals: 2,
        turnovers: 3,
      },
      supportedFacts: ["Home Hero led the winners with 24 points."],
      teamName: "Home",
      teamSide: "home" as const,
    },
  }));
  const request = {
    gameDate: "2026-03-15",
    gameDayNumber: null,
    generationApproach: "FACT_LIBRARY_FIRST" as const,
    kind: "LEAGUE_DATE" as const,
    label: "Elite League 2026-03-15",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: null,
    season: 64,
    timeZone: "America/New_York",
  };
  const payload = {
    coverage: {
      availableGames: games.length,
      missingGames: [],
      partial: false,
      requestedGames: games.length,
    },
    factStore: __testing.buildGameDayRecapJudgeFactStore({
      expectedGames: games,
      request,
    }),
    games,
    request,
  };
  const premiumCandidate = {
    games: games.map((game, index) => ({
      evidenceTags: ["recent_form"] as const,
      headline: `Home beats Away 85-81 in Game ${index + 1}`,
      matchId: game.matchId,
      writeup:
        "Home stayed organized late and closed the game without letting Away erase the final margin.",
    })),
    summary: {
      gameOfTheDayMatchId: "m-1",
      gameOfTheDaySurpriseFactor: 1,
      headline: "Elite League roundup",
      lede: "Home handled a full slate with composed late-game execution.",
    },
  };
  let interviewCalls = 0;
  let retryCalls = 0;
  let stylePolishCalls = 0;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "premium",
    remainingTimeInMillis: () => 20_000,
    retryProvider: {
      generate: async (payload) => {
        retryCalls += 1;
        if (isStylePolishPayloadForTest(payload)) {
          stylePolishCalls += 1;
        }
        if (isPostgameInterviewPayloadForTest(payload)) {
          interviewCalls += 1;
        }
        throw new Error(
          "optional retry provider should be skipped on low budget",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    runtimeConfig: __testing.resolveGameDayRecapRuntimeConfig({
      GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE: "auto",
      GAME_DAY_RECAP_INTERVIEW_CONCURRENCY: "2",
      GAME_DAY_RECAP_POLISH_CONCURRENCY: "2",
    }),
    writerProvider: {
      generate: async () => premiumCandidate,
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.coverageIssues.length, 0);
  assert.equal(result.result.games.length, 8);
  assert.equal(stylePolishCalls, 0);
  assert.equal(interviewCalls, 0);
  assert.equal(retryCalls, 0);
  assert.deepStrictEqual(
    result.result.games.map((game) => game.postgameInterview?.teamSide),
    Array.from({ length: 8 }, () => "home"),
  );
});

test("validateGameDayRecapResult allows interviews to mention runs without timing anchors", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.postgameInterviewCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };

  const validated = __testing.validateGameDayRecapResult(
    {
      games: [
        {
          evidenceTags: ["late_game_swing"],
          headline: "Home beats Away 85-81",
          matchId: "m-1",
          postgameInterview: {
            playerName: "Home Hero",
            qa: [
              {
                answer: "That 15-4 run in the fourth gave us breathing room.",
                question: "What changed in the fourth quarter?",
              },
            ],
            teamName: "Home",
            teamSide: "home",
            title: "Home Hero on Home's win",
          },
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        },
      ],
      summary: {
        headline: "Home beats Away 85-81",
        lede: "Home held off a late push and finished the night cleanly.",
      },
    },
    [expectedGame],
  );

  assert.equal(
    validated.games[0]?.postgameInterview?.qa[0]?.answer,
    "That 15-4 run in the fourth gave us breathing room.",
  );
});

test("validateGameDayRecapResult rejects interview mechanics language and stat dumps", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.postgameInterviewCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["late_game_swing"],
              headline: "Home beats Away 85-81",
              matchId: "m-1",
              postgameInterview: {
                playerName: "Home Hero",
                qa: [
                  {
                    answer:
                      "Our outside defense and offensive flow finally did the job.",
                    question: "How did this matchup feel?",
                  },
                ],
                teamName: "Home",
                teamSide: "home",
                title: "Home Hero on Home's win",
              },
              writeup:
                "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
            },
          ],
          summary: {
            headline: "Home beats Away 85-81",
            lede: "Home held off a late push and finished the night cleanly.",
          },
        },
        [expectedGame],
      ),
    /internal game-mechanics language/i,
  );

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: ["late_game_swing"],
              headline: "Home beats Away 85-81",
              matchId: "m-1",
              postgameInterview: {
                playerName: "Home Hero",
                qa: [
                  {
                    answer:
                      "I had 24 points and 8 rebounds, so I felt pretty useful.",
                    question: "How did this matchup feel?",
                  },
                ],
                teamName: "Home",
                teamSide: "home",
                title: "Home Hero on Home's win",
              },
              writeup:
                "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
            },
          ],
          summary: {
            headline: "Home beats Away 85-81",
            lede: "Home held off a late push and finished the night cleanly.",
          },
        },
        [expectedGame],
      ),
    /raw player stat line/i,
  );
});

test("validateGameDayRecapResult allows surreal interview bits but rejects plausible fake events", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.postgameInterviewCandidate = {
    playerName: "Home Hero",
    selectionReason: "top scorer for the winning team",
    statLine: {
      assists: 4,
      blocks: 1,
      minutes: 39,
      points: 24,
      rebounds: 8,
      steals: 2,
      turnovers: 3,
    },
    supportedFacts: ["Home Hero led the winners with 24 points."],
    teamName: "Home",
    teamSide: "home",
  };

  const baseGame = {
    evidenceTags: ["late_game_swing"],
    headline: "Home beats Away 85-81",
    matchId: "m-1",
    teamName: "Home",
    teamSide: "home",
    title: "Home Hero on Home's win",
    writeup:
      "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
  } as const;

  const surrealValidated = __testing.validateGameDayRecapResult(
    {
      games: [
        {
          evidenceTags: baseGame.evidenceTags,
          headline: baseGame.headline,
          matchId: baseGame.matchId,
          postgameInterview: {
            playerName: "Home Hero",
            qa: [
              {
                answer:
                  "I would ask the judge to strike the part where the scoreboard wore a wig.",
                question:
                  "If the scoreboard briefly turned into a courtroom, what evidence would you want thrown out?",
              },
            ],
            teamName: baseGame.teamName,
            teamSide: baseGame.teamSide,
            title: baseGame.title,
          },
          writeup: baseGame.writeup,
        },
      ],
      summary: {
        headline: "Home beats Away 85-81",
        lede: "Home held off a late push and finished the night cleanly.",
      },
    },
    [expectedGame],
  );
  assert.equal(
    surrealValidated.games[0]?.postgameInterview?.qa[0]?.question,
    "If the scoreboard briefly turned into a courtroom, what evidence would you want thrown out?",
  );

  assert.throws(
    () =>
      __testing.validateGameDayRecapResult(
        {
          games: [
            {
              evidenceTags: baseGame.evidenceTags,
              headline: baseGame.headline,
              matchId: baseGame.matchId,
              postgameInterview: {
                playerName: "Home Hero",
                qa: [
                  {
                    answer:
                      "It got weird for a second, but we stayed locked in.",
                    question:
                      "When the streaker ran onto the court, did that disrupt your rhythm?",
                  },
                ],
                teamName: baseGame.teamName,
                teamSide: baseGame.teamSide,
                title: baseGame.title,
              },
              writeup: baseGame.writeup,
            },
          ],
          summary: {
            headline: "Home beats Away 85-81",
            lede: "Home held off a late push and finished the night cleanly.",
          },
        },
        [expectedGame],
      ),
    /plausible event/i,
  );
});

test("buildGameDayRecapCostPayload aggregates provider usage into total and per-game estimates", () => {
  const cost = __testing.buildGameDayRecapCostPayload({
    providers: [
      createUsageAwareProvider({
        modelId: PREMIUM_RECAP_MODEL_ID,
        stage: "writer",
        usage: {
          inputTokens: 2_000,
          outputTokens: 500,
          requestCount: 1,
          totalTokens: 2_500,
        },
      }),
      createUsageAwareProvider({
        modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
        stage: "judge",
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          requestCount: 1,
          totalTokens: 1_200,
        },
      }),
    ],
    result: {
      games: [
        {
          evidenceTags: [],
          headline: "Game one",
          matchId: "m-1",
          writeup: "Summary one.",
        },
        {
          evidenceTags: [],
          headline: "Game two",
          matchId: "m-2",
          writeup: "Summary two.",
        },
      ],
      summary: {
        headline: "League roundup",
        lede: "Two grounded summaries were generated.",
      },
    },
  });

  assert.deepStrictEqual(cost, {
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    currency: "USD",
    estimatedPerGameCostUsd: 0.00775,
    estimatedTotalCostUsd: 0.0155,
    generatedGameCount: 2,
    inputTokens: 3_000,
    outputTokens: 700,
    pricingStatus: "estimated",
    requestCount: 2,
    stages: [
      {
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        estimatedCostUsd: 0.0135,
        inputTokens: 2_000,
        modelId: PREMIUM_RECAP_MODEL_ID,
        outputTokens: 500,
        providerName: "bedrock",
        requestCount: 1,
        stage: "writer",
        totalTokens: 2_500,
      },
      {
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        estimatedCostUsd: 0.002,
        inputTokens: 1_000,
        modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
        outputTokens: 200,
        providerName: "bedrock",
        requestCount: 1,
        stage: "judge",
        totalTokens: 1_200,
      },
    ],
    totalTokens: 3_700,
  });
});

test("assessGameDayRecapDeterministicPayload treats filler phrases as soft guidance unless strict mode is enabled", () => {
  const expectedGame = createExpectedPromptGame("m-1");
  const result = {
    games: [
      {
        evidenceTags: ["quarter_turn"],
        headline: "Home beats Away 85-81",
        matchId: "m-1",
        writeup:
          "Home built a 42-38 halftime lead and the fourth quarter proved decisive in the 85-81 win over Away.",
      },
    ],
    summary: {
      headline: "Home beats Away 85-81",
      lede: "Home used a steady second-half edge to close the game out.",
    },
  };

  const laxAssessment = __testing.assessGameDayRecapDeterministicPayload(
    result,
    [expectedGame],
    {
      enforceBannedStylePhrases: false,
    },
  );
  const strictAssessment = __testing.assessGameDayRecapDeterministicPayload(
    result,
    [expectedGame],
    {
      enforceBannedStylePhrases: true,
    },
  );

  assert.equal(
    laxAssessment.issues.some((issue) => issue.kind === "banned_style_phrase"),
    false,
  );
  assert.equal(
    strictAssessment.issues.some(
      (issue) => issue.kind === "banned_style_phrase",
    ),
    true,
  );
});

test("assessGameDayRecapDeterministicPayload rejects visible recap section headings when factsLibrary sections are present", () => {
  const payload = createSingleGameRecapPayload("m-1");
  const writerPayload = __testing.buildGameDayRecapWriterPayloadFromFactStore({
    coverage: payload.coverage,
    factStore: payload.factStore,
  });
  const expectedGame = expectPresent(
    writerPayload.games[0],
    "expected writer game with facts library",
  );
  const result = createRecapCandidateResult({
    headline: "Home beats Away 85-81",
    writeup:
      "Pregame: Home had the setup edge before tipoff.\n\nGame: Home moved through the middle quarters and held the lead late.\n\nPostgame: Home finished the 85-81 win with the cleaner closing stretch.",
  });

  const assessment = __testing.assessGameDayRecapDeterministicPayload(result, [
    expectedGame,
  ]);

  assert.ok(
    assessment.issues.some((issue) => issue.kind === "visible_section_heading"),
  );
});

test("generateResolvedGameDayRecap omits interviews when no candidate exists in the fact store", async () => {
  const payload = createSingleGameRecapPayload();
  const gameFacts = expectPresent(
    payload.factStore.games[0],
    "expected canonical fact-store game",
  );
  gameFacts.postgameInterviewCandidate = null;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (payload) => {
        if (isStylePolishPayloadForTest(payload)) {
          return {
            writeup: payload.recapGame.writeup,
          };
        }
        if (!isMainRecapWriterPayloadForTest(payload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.result.games[0]?.postgameInterview, undefined);
});

test("generateResolvedGameDayRecap keeps the validated draft when the style polish pass regresses", async () => {
  const payload = createSingleGameRecapPayload();
  payload.games[0]!.requiredContextSentences = [
    "Home held the effort edge over Away.",
  ];
  refreshPayloadFactStore(payload);

  const validatedWriteup =
    "Home stayed organized over the closing possessions and kept Away from erasing the final margin. Home held the effort edge over Away.";

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (payload) => {
        if (isStylePolishPayloadForTest(payload)) {
          return {
            writeup:
              "Home stayed organized over the closing possessions and kept Away from erasing the final margin.",
          };
        }
        if (isPostgameInterviewPayloadForTest(payload)) {
          return {
            playerName: payload.candidate.playerName,
            qa: [
              {
                answer:
                  "I just tried to settle us down and make the simple play when the game tightened up.",
                question: "What was working for you tonight?",
              },
            ],
            teamName: payload.candidate.teamName,
            teamSide: payload.candidate.teamSide,
            title: `${payload.candidate.playerName} on ${payload.candidate.teamName}'s win`,
          };
        }
        if (!isMainRecapWriterPayloadForTest(payload)) {
          throw new Error("expected main recap writer payload");
        }
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup: validatedWriteup,
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.result.games[0]?.writeup, validatedWriteup);
});

test("salvageGameDayRecapResult rebuilds a playoff opener after sentence repairs instead of trimming it away", async () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.type = "league.finals";
  expectedGame.teams.home.name = "Stark Contrast";
  expectedGame.teams.away.name = "LionPride";
  expectedGame.teams.home.score = 88;
  expectedGame.teams.away.score = 86;
  expectedGame.finalMargin = 2;
  expectedGame.seriesContext = {
    isTerminal: false,
    postgameWins: {
      away: 0,
      home: 1,
    },
    stageKey: "finals",
    summaryLine: "Stark Contrast leads the series 1-0.",
  };
  expectedGame.playByPlayFacts = createBuzzerBeaterPlayByPlayFacts({
    awayScore: 86,
    awayTeamName: "LionPride",
    homeScore: 88,
    homeTeamName: "Stark Contrast",
  });
  expectedGame.playByPlaySummaryLines =
    expectedGame.playByPlayFacts.summaryLines;

  const invalidResult = {
    games: [
      {
        evidenceTags: ["buzzerbeater", "close_finish", "one_possession_finish"],
        headline: "Stark Contrast takes Game 1, leads series 1-0",
        matchId: "m-1",
        writeup:
          "Stark Contrast leads the series 1-0. Stark Contrast won the 2nd quarter 19-18.",
      },
    ],
    summary: {
      headline: "Finals roundup",
      lede: "The repair path should preserve the series line and rebuild the opener around the real ending.",
    },
  };
  const deterministic = __testing.assessGameDayRecapDeterministicPayload(
    invalidResult,
    [expectedGame],
  );

  const repaired = await __testing.salvageGameDayRecapResult({
    deterministicIssues: deterministic.issues,
    expectedGames: [expectedGame],
    judgeIssues: [],
    judgeProvider: createPassingJudgeProvider(),
    request: createSingleGameRecapPayload("m-1").request,
    result: invalidResult,
  });

  const repairedWriteup = expectPresent(
    repaired.result.games[0],
    "missing repaired playoff writeup",
  ).writeup;
  assert.match(
    repairedWriteup,
    /^Stark Contrast won it on a buzzerbeater, going ahead 88-86 at the horn\./,
  );
  assert.doesNotMatch(repairedWriteup, /leads the series 1-0/i);
  assert.ok(
    repairedWriteup.includes("Stark Contrast won the 2nd quarter 24-18."),
  );
  assert.doesNotMatch(repairedWriteup, /proved decisive/i);
});

test("premium recap selection keeps the one fully valid candidate when the others hard-fail", async () => {
  const payload = createSingleGameRecapPayload();
  const validCandidate = createRecapCandidateResult({
    headline: "Home beats Away 85-81",
    writeup:
      "Home kept the closing possessions clean and never let Away erase the final margin.",
  });

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: {
      generate: async (judgePayload) =>
        mapJudgeResponseSentenceVerdicts(
          createSupportedJudgeResponseFromPayload(judgePayload),
          ({ candidateIndex, sentenceKey, verdict }) => {
            if (candidateIndex === 0) {
              return {
                ...verdict,
                sourceField: "factStore.games[0].winner",
              };
            }
            if (sentenceKey.endsWith(":headline:0")) {
              return {
                ...verdict,
                contradictionType: candidateIndex === 1 ? "winner" : "overtime",
                notes:
                  candidateIndex === 1
                    ? "The supplied fact store credits Home with the win."
                    : "The supplied fact store shows regulation only.",
                sourceField:
                  candidateIndex === 1
                    ? "factStore.games[0].winner"
                    : "factStore.games[0].overtime",
                verdict: "unsupported",
              };
            }
            return verdict;
          },
        ),
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not be used when a valid candidate survives",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async (
        _payload: unknown,
        options?: { candidateIndex?: number },
      ) => {
        switch (options?.candidateIndex ?? 0) {
          case 0:
            return validCandidate;
          case 1:
            return createRecapCandidateResult({
              headline: "Away beats Home 81-85",
              writeup:
                "Away stole the finish, even though that winner claim contradicts the supplied result.",
            });
          default:
            return createRecapCandidateResult({
              headline: "Home survives in overtime 85-81",
              writeup:
                "Home needed overtime to finish the job, even though the supplied period facts never reached an extra session.",
            });
        }
      },
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.coverageIssues.length, 0);
  assert.equal(result.result.games[0]?.headline, "Home beats Away 85-81");
});

test("generateResolvedGameDayRecap chunks a 16-sentence candidate into 6/6/4 factuality passes", async () => {
  const payload = createSingleGameRecapPayload();
  const chunkSizes: number[] = [];
  const longWriteup = [
    "Home settled in after the opening stretch.",
    "Away stayed close through the middle quarters.",
    "Home found one more answer in the closing possessions.",
    "That final push kept the result from flipping late.",
    "Away still made the margin work for a while.",
    "Home then slowed the tempo and kept control.",
    "The defense never fully loosened up afterward.",
    "Away had one more push but not the finish.",
    "Home answered with patient half-court offense.",
    "The glass also tilted in Home's favor.",
    "Away chased the game into the closing minute.",
    "Home closed every remaining gap cleanly.",
    "The lead never fully disappeared after that.",
    "Away could not turn the last pressure into a tie.",
    "Home finally walked it over the line.",
  ].join(" ");

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: {
      generate: async (judgePayload) => {
        if (judgePayload.judgeKind === "sentence_factuality") {
          chunkSizes.push(judgePayload.sentenceChunk.length);
        }
        return createSupportedJudgeResponseFromPayload(judgePayload);
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    payload,
    qualityTier: "standard",
    retryProvider: {
      generate: async () => {
        throw new Error("retry provider should not be used for chunking test");
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async (
        _payload: unknown,
        _options?: { candidateIndex?: number },
      ) =>
        createRecapCandidateResult({
          headline: "Home beats Away 85-81 after the late push",
          writeup: longWriteup,
        }),
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.coverageIssues.length, 0);
  assert.deepStrictEqual(chunkSizes, [6, 6, 4]);
});

test("generateResolvedGameDayRecap runs judge sentence chunks concurrently within the configured limit", async () => {
  const payload = createSingleGameRecapPayload();
  const longWriteup = [
    "Home settled in after the opening stretch.",
    "Away stayed close through the middle quarters.",
    "Home found one more answer in the closing possessions.",
    "That final push kept the result from flipping late.",
    "Away still made the margin work for a while.",
    "Home then slowed the tempo and kept control.",
    "The defense never fully loosened up afterward.",
    "Away had one more push but not the finish.",
    "Home answered with patient half-court offense.",
    "The glass also tilted in Home's favor.",
    "Away chased the game into the closing minute.",
    "Home closed every remaining gap cleanly.",
    "The lead never fully disappeared after that.",
    "Away could not turn the last pressure into a tie.",
    "Home finally walked it over the line.",
  ].join(" ");
  let activeSentenceJudges = 0;
  let maxActiveSentenceJudges = 0;
  let sentenceJudgeCalls = 0;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider({
      generate: async (judgePayload) => {
        if (judgePayload.judgeKind === "sentence_factuality") {
          sentenceJudgeCalls += 1;
          activeSentenceJudges += 1;
          maxActiveSentenceJudges = Math.max(
            maxActiveSentenceJudges,
            activeSentenceJudges,
          );
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeSentenceJudges -= 1;
        }

        return createSupportedJudgeResponseFromPayload(judgePayload);
      },
    }),
    payload,
    qualityTier: "standard",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not be used for concurrency test",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    runtimeConfig: __testing.resolveGameDayRecapRuntimeConfig({
      GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE: "off",
      GAME_DAY_RECAP_JUDGE_CONCURRENCY: "2",
    }),
    writerProvider: {
      generate: async () =>
        createRecapCandidateResult({
          headline: "Home beats Away 85-81 after the late push",
          writeup: longWriteup,
        }),
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.coverageIssues.length, 0);
  assert.equal(sentenceJudgeCalls, 3);
  assert.equal(maxActiveSentenceJudges, 2);
});

test("generateResolvedGameDayRecap retries a grammar-failed chunk as single-sentence judge calls", async () => {
  const payload = createSingleGameRecapPayload();
  const chunkSizes: number[] = [];
  let threwGrammarFailure = false;
  const fallbackWriteup = [
    "Home settled in after the opening stretch.",
    "Away stayed close through the middle quarters.",
    "Home found one more answer in the closing possessions.",
    "That final push kept the result from flipping late.",
    "Away still made the margin work for a while.",
    "Home then slowed the tempo and kept control.",
    "The defense never fully loosened up afterward.",
    "Away had one more push but not the finish.",
    "Home answered with patient half-court offense.",
  ].join(" ");

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: {
      generate: async (judgePayload) => {
        if (judgePayload.judgeKind === "sentence_factuality") {
          chunkSizes.push(judgePayload.sentenceChunk.length);
          if (!threwGrammarFailure && judgePayload.sentenceChunk.length === 6) {
            threwGrammarFailure = true;
            const schemaError = new Error(
              "The model returned the following errors: The compiled grammar is too large, which would cause performance issues.",
            ) as Error & { name: string };
            schemaError.name = "ValidationException";
            throw schemaError;
          }
        }

        return createSupportedJudgeResponseFromPayload(judgePayload);
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    payload,
    qualityTier: "standard",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not be used for grammar fallback test",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async () =>
        createRecapCandidateResult({
          headline: "Home beats Away 85-81 after the late push",
          writeup: fallbackWriteup,
        }),
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.coverageIssues.length, 0);
  assert.equal(threwGrammarFailure, true);
  assert.deepStrictEqual(
    [...chunkSizes].sort((left, right) => left - right),
    [1, 1, 1, 1, 1, 1, 4, 6],
  );
});

test("premium recap selection keeps the same winner after chunked factuality and separate interestingness judging", async () => {
  const payload = createSingleGameRecapPayload();
  const writerProvider = {
    generate: async (
      _payload: unknown,
      options?: { candidateIndex?: number },
    ) => {
      switch (options?.candidateIndex ?? 0) {
        case 0:
          return createRecapCandidateResult({
            headline: "Home beats Away 85-81",
            writeup:
              "Home handled the closing possessions without giving the lead away.",
          });
        case 1:
          return createRecapCandidateResult({
            headline: "Home beats Away 85-81 with the late answer",
            writeup:
              "Home handled the closing possessions without giving the lead away.",
          });
        default:
          return createRecapCandidateResult({
            headline: "Home escapes Away 85-81",
            writeup:
              "Home handled the closing possessions without giving the lead away.",
          });
      }
    },
    modelId: DEFAULT_RECAP_MODEL_ID,
    providerName: "bedrock" as const,
    stage: "writer" as const,
  };
  const chunkedResult = await __testing.generateResolvedGameDayRecap({
    judgeProvider: {
      generate: async (judgePayload) => {
        if (judgePayload.judgeKind === "candidate_interestingness") {
          return createInterestingnessJudgeResponseFromPayload({
            candidateIndex: judgePayload.candidateIndex,
            interestingnessScore:
              judgePayload.candidateIndex === 1
                ? 9
                : judgePayload.candidateIndex === 0
                  ? 4
                  : 1,
          });
        }

        return createSupportedJudgeResponseFromPayload(judgePayload);
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not be used for judge fallback test",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider,
  });

  assert.equal(chunkedResult.coverageIssues.length, 0);
  assert.equal(
    chunkedResult.result.games[0]?.headline,
    "Home beats Away 85-81 with the late answer",
  );
});

test("premium recap selection breaks factual ties with judge interestingness", async () => {
  const payload = createSingleGameRecapPayload();
  const steadyCandidate = createRecapCandidateResult({
    headline: "Home beats Away 85-81",
    writeup:
      "Home stayed steady through the final possessions and closed the game without giving the lead away.",
  });
  const vividCandidate = createRecapCandidateResult({
    headline: "Home beats Away 85-81 after the late push",
    writeup:
      "Home answered the last real threat with one more composed stretch and kept Away from flipping the finish.",
  });

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: {
      generate: async (judgePayload) => {
        if (judgePayload.judgeKind === "candidate_interestingness") {
          return createInterestingnessJudgeResponseFromPayload({
            candidateIndex: judgePayload.candidateIndex,
            interestingnessScore:
              judgePayload.candidateIndex === 0
                ? 4
                : judgePayload.candidateIndex === 1
                  ? 9
                  : 1,
          });
        }

        return mapJudgeResponseSentenceVerdicts(
          createSupportedJudgeResponseFromPayload(judgePayload),
          ({ candidateIndex, sentenceKey, verdict }) =>
            candidateIndex === 2 && sentenceKey.endsWith(":headline:0")
              ? {
                  ...verdict,
                  contradictionType: "winner",
                  notes: "The supplied fact store credits Home with the win.",
                  sourceField: "factStore.games[0].winner",
                  verdict: "unsupported",
                }
              : verdict,
        );
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not run when factual candidates already pass",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async (
        _payload: unknown,
        options?: { candidateIndex?: number },
      ) => {
        switch (options?.candidateIndex ?? 0) {
          case 0:
            return steadyCandidate;
          case 1:
            return vividCandidate;
          default:
            return createRecapCandidateResult({
              headline: "Away beats Home 81-85",
              writeup:
                "Away was wrongly credited with the win, so this candidate should be discarded before judging decides anything.",
            });
        }
      },
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(
    result.result.games[0]?.headline,
    "Home beats Away 85-81 after the late push",
  );
});

test("premium recap selection rejects a candidate whose headline judge verdict is unsupported", async () => {
  const payload = createSingleGameRecapPayload();
  const riskyHeadlineCandidate = createRecapCandidateResult({
    headline: "Away steals the game late",
    writeup:
      "Home actually controlled the last stretch, so the candidate headline should be rejected even though the writeup sentence is otherwise fine.",
  });
  const safeCandidate = createRecapCandidateResult({
    headline: "Home beats Away 85-81",
    writeup:
      "Home kept the last few possessions organized and made sure the comeback never fully materialized.",
  });

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: {
      generate: async (judgePayload) => {
        if (judgePayload.judgeKind === "candidate_interestingness") {
          return createInterestingnessJudgeResponseFromPayload({
            candidateIndex: judgePayload.candidateIndex,
            interestingnessScore:
              judgePayload.candidateIndex === 0
                ? 10
                : judgePayload.candidateIndex === 1
                  ? 5
                  : 1,
          });
        }

        return mapJudgeResponseSentenceVerdicts(
          createSupportedJudgeResponseFromPayload(judgePayload),
          ({ candidateIndex, sentenceKey, verdict }) =>
            (candidateIndex === 0 || candidateIndex === 2) &&
            sentenceKey.endsWith(":headline:0")
              ? {
                  ...verdict,
                  contradictionType: "winner",
                  notes: "The headline credits the wrong side with the result.",
                  sourceField: "teams.home.score",
                  verdict: "unsupported",
                }
              : verdict,
        );
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not be used when a supported candidate exists",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async (
        _payload: unknown,
        options?: { candidateIndex?: number },
      ) => {
        switch (options?.candidateIndex ?? 0) {
          case 0:
            return riskyHeadlineCandidate;
          case 1:
            return safeCandidate;
          default:
            return createRecapCandidateResult({
              headline: "Home closes it out",
              writeup:
                "Home stayed calm through the last push and kept the margin from vanishing altogether.",
            });
        }
      },
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.result.games[0]?.headline, "Home beats Away 85-81");
});

test("premium recap selection retries once when no initial candidate clears the factual bar", async () => {
  const payload = createSingleGameRecapPayload();
  const shakyCandidate = createRecapCandidateResult({
    headline: "Home beats Away 85-81",
    writeup:
      "Home won with a wire-to-wire effort, a claim the judge should mark as unsupported because the supplied facts do not show that full-game shape.",
  });
  const retryCandidate = createRecapCandidateResult({
    headline: "Home beats Away 85-81",
    writeup:
      "Home finished the game with a composed closing stretch and held Away off over the final possessions.",
  });
  let judgeCalls = 0;
  let sentenceJudgeCalls = 0;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: {
      generate: async (judgePayload) => {
        judgeCalls += 1;
        if (judgePayload.judgeKind === "sentence_factuality") {
          sentenceJudgeCalls += 1;
          return mapJudgeResponseSentenceVerdicts(
            createSupportedJudgeResponseFromPayload(judgePayload),
            ({ candidateIndex, sentenceKey, verdict }) =>
              candidateIndex !== 0 &&
              candidateIndex !== 3 &&
              sentenceKey.endsWith(":headline:0")
                ? {
                    ...verdict,
                    containsOutcomeClaim: true,
                    contradictionType: "winner",
                    notes:
                      "The payload credits the wrong side with the result.",
                    sourceField: "factStore.games[0].winner",
                    verdict: "unsupported",
                  }
                : sentenceJudgeCalls === 1 && sentenceKey.endsWith(":writeup:0")
                  ? {
                      ...verdict,
                      contradictionType: "other",
                      notes:
                        candidateIndex === 0
                          ? "The payload does not support a full wire-to-wire claim."
                          : "This candidate should not clear the factual bar before retry.",
                      sourceField: "quarterFacts.periods",
                      verdict: "unsupported",
                    }
                  : verdict,
          );
        }

        if (judgePayload.judgeKind === "candidate_interestingness") {
          return createInterestingnessJudgeResponseFromPayload({
            candidateIndex: judgePayload.candidateIndex,
            interestingnessScore: 7,
          });
        }

        return createSupportedJudgeResponseFromPayload(judgePayload);
      },
      modelId: DEFAULT_RECAP_JUDGE_MODEL_ID,
      providerName: "bedrock",
      stage: "judge",
    },
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => retryCandidate,
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async (
        _payload: unknown,
        options?: { candidateIndex?: number },
      ) => {
        if ((options?.candidateIndex ?? 0) === 0) {
          return shakyCandidate;
        }
        return createRecapCandidateResult({
          headline: "Away beats Home 81-85",
          writeup:
            "Away was wrongly credited with the win, so this candidate should hard-fail before judging.",
        });
      },
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(
    result.result.games[0]?.writeup,
    "Home finished the game with a composed closing stretch and held Away off over the final possessions.",
  );
  assert.equal(judgeCalls, 8);
});

test("premium recap fallback can still deterministically repair a bad retry writeup", async () => {
  const payload = createSingleGameRecapPayload();
  payload.games[0]!.quarterFacts.periods[2] = {
    awayScore: 24,
    homeScore: 24,
    label: "3rd quarter",
    margin: 0,
    period: 3,
    winningSide: "tie",
  };
  payload.games[0]!.quarterScores.away[2] = 24;
  payload.games[0]!.quarterScores.home[2] = 24;
  refreshPayloadFactStore(payload);

  const invalidCandidate = createRecapCandidateResult({
    headline: "Home beats Away 85-81",
    writeup:
      "Home won the third quarter 24-24 before the closing stretch finally settled the game.",
  });

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => invalidCandidate,
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async () => invalidCandidate,
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(
    result.result.games[0]?.writeup,
    "The 3rd quarter ended tied at 24-24.",
  );
});

test("premium recap fallback can foreground a supplied buzzerbeater", async () => {
  const payload = createSingleGameRecapPayload();
  payload.games[0]!.finalMargin = 2;
  payload.games[0]!.teams.home.name = "Stark Contrast";
  payload.games[0]!.teams.home.score = 88;
  payload.games[0]!.teams.away.name = "LionPride";
  payload.games[0]!.teams.away.score = 86;
  payload.games[0]!.playByPlayFacts = createBuzzerBeaterPlayByPlayFacts({
    awayScore: 86,
    awayTeamName: "LionPride",
    homeScore: 88,
    homeTeamName: "Stark Contrast",
  });
  payload.games[0]!.playByPlaySummaryLines =
    payload.games[0]!.playByPlayFacts.summaryLines;
  refreshPayloadFactStore(payload);

  const invalidCandidate = createRecapCandidateResult({
    headline: "Stark Contrast rallies late",
    writeup:
      "Adrian Diaz tied the game at 86-86 with 0:16 remaining before Stark Contrast scored the go-ahead basket with no time left on the clock.",
  });

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => invalidCandidate,
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async () => invalidCandidate,
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  const repairedWriteup = expectPresent(
    result.result.games[0],
    "missing repaired buzzerbeater writeup",
  ).writeup;
  assert.equal(
    repairedWriteup.startsWith(
      "Stark Contrast won it on a buzzerbeater, going ahead 88-86 at the horn.",
    ),
    true,
  );
});

test("premium recap fallback keeps the contradicted game with validation warnings", async () => {
  const payload = {
    coverage: {
      availableGames: 2,
      missingGames: [],
      partial: false,
      requestedGames: 2,
    },
    games: [createExpectedPromptGame("m-1"), createExpectedPromptGame("m-2")],
    request: {
      gameDate: "2026-03-15",
      gameDayNumber: null,
      kind: "LEAGUE_DATE" as const,
      label: "Elite League 2026-03-15",
      leagueId: "100",
      leagueName: "Elite League",
      matchId: null,
      season: 64,
      timeZone: "America/New_York",
    },
  };
  payload.games[1]!.teams.home.name = "Gamma";
  payload.games[1]!.teams.away.name = "Delta";

  const mixedCandidate = {
    games: [
      {
        evidenceTags: ["recent_form"],
        headline: "Home beats Away 85-81",
        matchId: "m-1",
        writeup:
          "Home stayed organized late and closed the game without letting Away erase the final margin.",
      },
      {
        evidenceTags: ["recent_form"],
        headline: "Delta beats Gamma 81-85",
        matchId: "m-2",
        writeup:
          "Gamma actually won the game, so this headline contradiction should force only this matchup to drop.",
      },
    ],
    summary: {
      headline: "Elite League roundup",
      lede: "A mixed slate candidate should salvage the valid game and drop only the one with an unrepaired headline contradiction.",
    },
  };

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider({
      generate: async (judgePayload) => {
        const supported = createSupportedJudgeResponseFromPayload(judgePayload);
        return mapJudgeResponseSentenceVerdicts(
          supported,
          ({ sentenceKey, verdict }) =>
            sentenceKey === "m-2:headline:0"
              ? {
                  ...verdict,
                  contradictionType: "winner",
                  notes: "Gamma won in the supplied fact store.",
                  sourceField: "factStore.games[1].winner",
                  verdict: "unsupported",
                }
              : verdict,
        );
      },
    }),
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => mixedCandidate,
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async () => mixedCandidate,
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.deepStrictEqual(result.coverageIssues, []);
  assert.deepStrictEqual(
    result.result.games.map((game) => game.matchId),
    ["m-1", "m-2"],
  );
  assert.equal(result.result.summary.headline, "Elite League roundup");
  const validGame = expectPresent(result.result.games[0], "missing valid game");
  const unsafeGame = expectPresent(
    result.result.games[1],
    "missing unsafe game",
  );
  assert.equal(validGame.validation?.status, "VALID");
  const unsafeValidation = expectPresent(
    unsafeGame.validation,
    "missing unsafe game validation",
  );
  assert.equal(unsafeValidation.status, "UNSAFE");
  assert.match(
    expectPresent(unsafeValidation.issues[0], "missing unsafe game issue")
      .reason,
    /headline contradiction|Gamma won|winner/i,
  );
});

test("premium recap fallback keeps all games in a large slate and marks only factual risks", async () => {
  const games = Array.from({ length: 8 }, (_, index) =>
    createExpectedPromptGame(`m-${index + 1}`),
  );
  const payload = {
    coverage: {
      availableGames: games.length,
      missingGames: [],
      partial: false,
      requestedGames: games.length,
    },
    games,
    request: {
      gameDate: "2026-03-15",
      gameDayNumber: null,
      kind: "LEAGUE_DATE" as const,
      label: "Elite League 2026-03-15",
      leagueId: "100",
      leagueName: "Elite League",
      matchId: null,
      season: 64,
      timeZone: "America/New_York",
    },
  };
  const largeSlateCandidate = {
    games: games.map((game, index) => ({
      evidenceTags: ["recent_form"] as const,
      headline:
        index === 7
          ? "Away beats Home 81-85"
          : `Home beats Away 85-81 in Game ${index + 1}`,
      matchId: game.matchId,
      writeup:
        index === 7
          ? "Away was incorrectly credited with the win, so this game should be kept with a warning instead of making the whole slate fail."
          : "Home stayed organized late and closed the game without letting Away erase the final margin.",
    })),
    summary: {
      headline: "Elite League roundup",
      lede: "A large slate should preserve every generated game while flagging only the questionable one.",
    },
  };

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider({
      generate: async (judgePayload) => {
        const supported = createSupportedJudgeResponseFromPayload(judgePayload);
        return mapJudgeResponseSentenceVerdicts(
          supported,
          ({ sentenceKey, verdict }) =>
            sentenceKey === "m-8:headline:0"
              ? {
                  ...verdict,
                  contradictionType: "winner",
                  notes: "Home won in the supplied fact store.",
                  sourceField: "factStore.games[7].winner",
                  verdict: "unsupported",
                }
              : verdict,
        );
      },
    }),
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => largeSlateCandidate,
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async () => largeSlateCandidate,
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(result.result.games.length, 8);
  assert.deepStrictEqual(
    result.result.games.map((game) => game.matchId),
    games.map((game) => game.matchId),
  );
  assert.deepStrictEqual(
    result.result.games.map((game) => game.validation?.status),
    ["VALID", "VALID", "VALID", "VALID", "VALID", "VALID", "VALID", "UNSAFE"],
  );
  const largeSlateUnsafeGame = expectPresent(
    result.result.games[7],
    "missing large-slate unsafe game",
  );
  assert.match(
    expectPresent(
      largeSlateUnsafeGame.validation?.issues[0],
      "missing large-slate unsafe issue",
    ).reason,
    /headline contradiction|winner|Home won|Away/i,
  );
});

test("premium recap fallback saves a fully suspect structured result instead of failing", async () => {
  const payload = createSingleGameRecapPayload();
  const invalidHeadlineCandidate = createRecapCandidateResult({
    headline: "Away beats Home 81-85",
    writeup:
      "Home actually won the game, so this headline contradiction should force a drop during the deterministic fallback.",
  });

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider({
      generate: async (judgePayload) => {
        const supported = createSupportedJudgeResponseFromPayload(judgePayload);
        return mapJudgeResponseSentenceVerdicts(
          supported,
          ({ sentenceKey, verdict }) =>
            sentenceKey.endsWith(":headline:0")
              ? {
                  ...verdict,
                  contradictionType: "winner",
                  notes: "Home won in the supplied fact store.",
                  sourceField: "factStore.games[0].winner",
                  verdict: "unsupported",
                }
              : verdict,
        );
      },
    }),
    payload,
    qualityTier: "premium",
    retryProvider: {
      generate: async () => invalidHeadlineCandidate,
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async () => invalidHeadlineCandidate,
      modelId: PREMIUM_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.deepStrictEqual(result.coverageIssues, []);
  assert.equal(result.result.games.length, 1);
  const fullySuspectValidation = expectPresent(
    expectPresent(result.result.games[0], "missing fully suspect game")
      .validation,
    "missing fully suspect validation",
  );
  assert.equal(fullySuspectValidation.status, "UNSAFE");
  assert.ok(fullySuspectValidation.issueCount >= 1);
});

test("standard recap generation runs judge validation and keeps the single-candidate path", async () => {
  const payload = createSingleGameRecapPayload();
  let judgeCalls = 0;
  let writerCalls = 0;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider({
      generate: async (judgePayload) => {
        judgeCalls += 1;
        return createSupportedJudgeResponseFromPayload(judgePayload);
      },
    }),
    payload,
    qualityTier: "standard",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not be used for standard recaps",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async (payload) => {
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(payload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(payload)) {
          throw new Error("expected main recap writer payload");
        }
        writerCalls += 1;
        return createRecapCandidateResult({
          headline: "Home beats Away 85-81",
          writeup:
            "Home kept the last stretch organized and made sure the lead survived the final push.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(judgeCalls, 1);
  assert.equal(writerCalls, 1);
  assert.equal(result.result.games[0]?.headline, "Home beats Away 85-81");
});

test("standard recap generation retries after a judge contradiction and succeeds on the rewrite", async () => {
  const payload = createSingleGameRecapPayload();
  let judgeCalls = 0;
  let writerCalls = 0;

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider({
      generate: async (judgePayload) => {
        judgeCalls += 1;
        if (judgeCalls === 1) {
          return mapJudgeResponseSentenceVerdicts(
            createSupportedJudgeResponseFromPayload(judgePayload),
            ({ sentenceKey, verdict }) =>
              sentenceKey.endsWith(":writeup:0")
                ? {
                    ...verdict,
                    containsOutcomeClaim: true,
                    contradictionType: "winner",
                    notes:
                      "The fact store says Home won 85-81, so do not credit Away with the win.",
                    sourceField: "factStore.games[0].winner",
                    verdict: "unsupported",
                  }
                : verdict,
          );
        }
        return createSupportedJudgeResponseFromPayload(judgePayload);
      },
    }),
    payload,
    qualityTier: "standard",
    retryProvider: {
      generate: async () => {
        throw new Error(
          "retry provider should not be used for standard recaps",
        );
      },
      modelId: DEFAULT_RECAP_RETRY_MODEL_ID,
      providerName: "bedrock",
      stage: "retry_writer",
    },
    writerProvider: {
      generate: async (payload, options) => {
        const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(payload);
        if (auxiliary) {
          return auxiliary.response;
        }
        if (!isMainRecapWriterPayloadForTest(payload)) {
          throw new Error("expected main recap writer payload");
        }
        writerCalls += 1;
        if (!options?.validationFeedback?.length) {
          return createRecapCandidateResult({
            headline: "Home survives the push",
            writeup:
              "Away beat Home 81-85 in the final minute, turning the closing stretch into a comeback that never happened.",
          });
        }

        assert.ok(
          options.validationFeedback.some((feedback) =>
            feedback.includes("judged unsupported for winner"),
          ),
        );
        return createRecapCandidateResult({
          headline: "Home survives the push",
          writeup:
            "Home absorbed the final push and closed the game without letting Away steal the result.",
        });
      },
      modelId: DEFAULT_RECAP_MODEL_ID,
      providerName: "bedrock",
      stage: "writer",
    },
  });

  assert.equal(judgeCalls, 2);
  assert.equal(writerCalls, 2);
  assert.equal(
    result.result.games[0]?.writeup,
    "Home absorbed the final push and closed the game without letting Away steal the result.",
  );
});
