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
  return {
    endAwayScore: args.endAwayScore,
    endClock: args.endClock,
    endMarginFromTeamPerspective:
      args.teamSide === "home"
        ? args.endHomeScore - args.endAwayScore
        : args.endAwayScore - args.endHomeScore,
    endedBy: "game_end" as const,
    endHomeScore: args.endHomeScore,
    endQuarter: args.endQuarter,
    marginSwing:
      (args.teamSide === "home"
        ? args.endHomeScore - args.endAwayScore
        : args.endAwayScore - args.endHomeScore) -
      (args.teamSide === "home"
        ? args.startHomeScore - args.startAwayScore
        : args.startAwayScore - args.startHomeScore),
    netMargin: args.teamPoints - args.opponentPoints,
    opponentPoints: args.opponentPoints,
    runType: args.runType,
    startAwayScore: args.startAwayScore,
    startClock: args.startClock,
    startMarginFromTeamPerspective:
      args.teamSide === "home"
        ? args.startHomeScore - args.startAwayScore
        : args.startAwayScore - args.startHomeScore,
    startHomeScore: args.startHomeScore,
    startQuarter: args.startQuarter,
    teamName: args.teamName,
    teamPoints: args.teamPoints,
    teamSide: args.teamSide,
  };
}

function createEmptyRunFact(runType: "swing" | "unanswered") {
  return {
    endAwayScore: 0,
    endClock: null,
    endMarginFromTeamPerspective: 0,
    endedBy: null,
    endHomeScore: 0,
    endQuarter: null,
    marginSwing: 0,
    netMargin: 0,
    opponentPoints: 0,
    runType,
    startAwayScore: 0,
    startClock: null,
    startMarginFromTeamPerspective: 0,
    startHomeScore: 0,
    startQuarter: null,
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

function isStylePolishPayloadForTest(
  payload: unknown,
): payload is {
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

function isPostgameInterviewPayloadForTest(
  payload: unknown,
): payload is {
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

function isMainRecapWriterPayloadForTest(
  payload: unknown,
): payload is {
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
  if (candidate.statLine.points > 0) {
    parts.push(`${candidate.statLine.points} points`);
  }
  if (candidate.statLine.rebounds > 0) {
    parts.push(`${candidate.statLine.rebounds} rebounds`);
  }
  if (candidate.statLine.assists > 0) {
    parts.push(`${candidate.statLine.assists} assists`);
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

function maybeHandleAuxiliaryWriterPayloadForTest(
  payload: unknown,
): {
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
            question: "What was working for you tonight?",
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

  const sentenceMetadata = (
    response as Record<PropertyKey, unknown>
  )[JUDGE_TEST_SENTENCE_METADATA] as
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

  assert.equal(payload.factStore.request.generationApproach, "FACT_LIBRARY_FIRST");
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
  assert.equal(interviewCandidate.playerName, "Hal Home");
  assert.equal(interviewCandidate.teamName, "Alpha");
  assert.equal(interviewCandidate.teamSide, "home");
  assert.ok(interviewCandidate.supportedFacts.length >= 1);
  assert.ok(factStoreGame.teams.home.rawRatings);
  assert.equal("rawRatings" in writerGame.teams.home, false);
  assert.equal(writerGame.teams.home.name, factStoreGame.teams.home.name);
  assert.equal(writerGame.teams.home.record, factStoreGame.teams.home.record);
  assert.deepStrictEqual(writerGame.playByPlayFacts, factStoreGame.playByPlayFacts);
  assert.equal(
    factsLibrary.winner.finalScoreFromWinnerPerspective,
    factStoreGame.winner.finalScoreWinnerFacing,
  );
  assert.equal(
    expectPresent(
      factsLibrary.periodStates.throughThreeQuarters,
      "expected facts-library through-three state",
    ).scoreFromLeaderPerspective,
    throughThreeState.scoreFromLeaderPerspective,
  );
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
  assert.equal(finalsPromptGame.seriesContext.summaryLine, "Alpha leads the series 1-0.");
  assert.equal(finalsPromptGame.factsLibrary.openingCandidates[0], "Alpha leads the series 1-0.");
  assert.match(
    finalsPromptGame.factsLibrary.headlineCandidates[0] ?? "",
    /takes Game 1, leads series 1-0/i,
  );
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

test("prose recap request normalization defaults to fact-library-first while key builders preserve legacy compatibility", () => {
  assert.equal(
    __testing.normalizeGameDayRecapRequest({
      gameDate: "2026-03-15",
      leagueId: "100",
    }).approach,
    "FACT_LIBRARY_FIRST",
  );
  assert.equal(
    __testing.buildGameDayRecapTargetKey("100", "2026-03-15"),
    "100#2026-03-15",
  );
  assert.equal(
    __testing.buildLeagueGameDayRecapTargetKey(
      "100",
      3,
      71,
      "FACT_LIBRARY_FIRST",
    ),
    "100#71#gameday-3#fact-library-first",
  );
  assert.equal(
    __testing.buildSingleGameSummaryTargetKey(
      "137828772",
      "FACT_LIBRARY_FIRST",
    ),
    "137828772#fact-library-first",
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
  assert.equal(
    rerunMessage.targetKey,
    "100#2026-03-15#fact-library-first",
  );
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
  assert.equal(
    premiumMessage.targetKey,
    "100#2026-03-15#fact-library-first",
  );
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

test("submitSingleGameSummary persists the routed modelId on the record and queue message", async () => {
  let queuedMessage: {
    modelId?: string;
    qualityTier?: string;
    requestedAt: string;
    targetKey: string;
    userId: string;
  } | null = null;
  let savedModelId: string | null = null;
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                    writeup: `${game.teams.home.name} had enough to close out ${game.teams.away.name}. ${game.playByPlaySummaryLines.find((line) => /\brun\b/i.test(line)) ?? ""}`.trim(),
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
      createProvider: ({ stage }) =>
        stage === "judge"
          ? createPassingJudgeProvider()
          : {
              generate: async (payload) => {
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
    (
      finalUpdate.resultJson as {
        games: Array<{ matchId: string }>;
        summary: { headline: string; lede: string };
      }
    ).games.map((game) => game.matchId),
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
  const capturedErrors: Array<[unknown, unknown]> = [];
  const originalError = console.error;
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

  console.error = ((message?: unknown, details?: unknown) => {
    capturedErrors.push([message, details]);
  }) as typeof console.error;

  try {
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
                          lede: "The remaining contradiction lived in the headline, so the worker should only fail after it has no valid game recap left to keep.",
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
        ),
      /could not be safely repaired/i,
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(providerCalls, 2);
  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.match(
    String(updates.at(-1)?.error ?? ""),
    /could not be safely repaired/i,
  );
  const processFailedLog = capturedErrors.find(
    ([message]) =>
      typeof message === "string" &&
      message.includes("[game-day-recap] process.failed"),
  );
  assert.ok(
    processFailedLog,
    "expected process.failed to include contradiction details",
  );
  assert.ok(
    Number(
      (
        processFailedLog[1] as {
          deterministicIssueCount?: unknown;
        }
      ).deterministicIssueCount,
    ) >= 1,
  );
  assert.equal(
    (
      processFailedLog[1] as {
        judgeIssueCount?: unknown;
      }
    ).judgeIssueCount,
    0,
  );
  const validationFeedbackLines = (
    processFailedLog[1] as {
      validationFeedbackLines?: unknown;
    }
  ).validationFeedbackLines;
  assert.ok(Array.isArray(validationFeedbackLines));
  assert.ok(validationFeedbackLines.length >= 1);
  assert.ok(
    validationFeedbackLines.some((line) => /3rd quarter/i.test(String(line))),
  );
  assert.ok(
    validationFeedbackLines.some((line) => /tied 24-24/i.test(String(line))),
  );
  assert.ok(
    validationFeedbackLines.some((line) =>
      /do not say either team/i.test(String(line)),
    ),
  );

  const deterministicIssues = (
    processFailedLog[1] as {
      deterministicIssues?: unknown;
    }
  ).deterministicIssues;
  assert.ok(Array.isArray(deterministicIssues));
  assert.ok(deterministicIssues.length >= 1);
  const tiedQuarterIssue = deterministicIssues.find(
    (issue) =>
      issue &&
      typeof issue === "object" &&
      (issue as { kind?: unknown }).kind === "tied_quarter_claim",
  );
  assert.deepStrictEqual(tiedQuarterIssue, {
    actualValue: "24-24",
    field: "headline",
    kind: "tied_quarter_claim",
    matchId: "m-1",
    period: 3,
    reason: "3rd quarter was tied 24-24, so no team outscored the other.",
    sentence: "Alpha won the third quarter 24-24",
    sentenceIndex: 0,
  });
  assert.ok(
    Number(
      (
        processFailedLog[1] as {
          postPatchDeterministicIssueCount?: unknown;
        }
      ).postPatchDeterministicIssueCount,
    ) >= 1,
  );
  assert.equal(
    (
      processFailedLog[1] as {
        postPatchJudgeIssueCount?: unknown;
      }
    ).postPatchJudgeIssueCount,
    0,
  );
  assert.equal(
    (
      processFailedLog[1] as {
        postTrimDeterministicIssueCount?: unknown;
      }
    ).postTrimDeterministicIssueCount,
    0,
  );
  assert.equal(
    (
      processFailedLog[1] as {
        postTrimJudgeIssueCount?: unknown;
      }
    ).postTrimJudgeIssueCount,
    0,
  );
  const repairActions = (
    processFailedLog[1] as {
      repairActions?: unknown;
    }
  ).repairActions;
  assert.ok(Array.isArray(repairActions));
  if (repairActions.length > 0) {
    assert.equal(
      (repairActions[0] as { matchId?: unknown }).matchId,
      "m-1",
    );
  }
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
    !capturedLeagueGameDayPayload?.games[0]?.playByPlaySummaryLines.some((line) =>
      /\b6-2 run\b/i.test(line),
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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

  await processSingleGameSummary(
    {
      env: createRecapEnv(),
      messageBody: JSON.stringify({
        kind: "SINGLE_GAME",
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
          ? createPassingJudgeProvider()
          : createUsageAwareProvider({
              generate: async (payload) => {
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
                    headline: "Delta 9 evens the finals",
                    matchId: game.matchId,
                    writeup: `The series is tied 1-1. ${game.teams.away.name} steadied late and never let ${game.teams.home.name} retake control after the margin flipped.`,
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
                const auxiliary = maybeHandleAuxiliaryWriterPayloadForTest(
                  payload,
                );
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
  assert.match(
    systemText,
    /Only mention lead-change counts, rapid bursts, or comeback-to-the-lead claims/i,
  );
  assert.match(
    systemText,
    /In playoff games, do not mention regular-season records or any winning or losing streaks/i,
  );
  assert.match(userText, /"endingFacts"/);
  assert.match(userText, /"buzzerbeater"/);
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

test("buildGameDayRecapBedrockRequest keeps postgame interview questions in sportswriter tone and answers in player voice", () => {
  const payload = createSingleGameRecapPayload("m-1");
  const gameFacts = payload.factStore.games[0]!;
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

  assert.match(systemText, /questions in professional sportswriter tone/i);
  assert.match(
    systemText,
    /personality guidance only for the player's answers/i,
  );
  assert.match(
    systemText,
    /do not let the player's personality bleed into the title or reporter questions/i,
  );
  assert.match(
    userText,
    /Write the title and every question in polished professional sportswriter tone/i,
  );
  assert.match(
    userText,
    /Let the supplied personality type shape only the player's answers/i,
  );
  assert.match(userText, /dry and understated/i);
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
  assert.equal(
    parsedSchema.properties.slotVerdicts.properties.slot0.properties.notes.type,
    "string",
  );
  assert.equal(
    parsedSchema.properties.slotVerdicts.properties.slot0.properties.sourceField.type,
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
  assert.match(issue.feedback, /factStore\.games\[0\]\.winner\.finalScoreHomeAway/i);
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

test("validateGameDayRecapResult allows the exact series line in sentence 1 and the decisive ending in sentence 2", () => {
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
        headline: "Stark Contrast wins it on a buzzerbeater",
        matchId: "m-1",
        writeup:
          "Stark Contrast leads the series 1-0. Adrian Diaz buried the buzzerbeater at the horn to lift Stark Contrast past LionPride.",
      },
    ],
    summary: {
      headline: "League roundup",
      lede: "The standardized series line should be allowed in sentence 1 when the decisive ending follows immediately after it.",
    },
  };

  const validated = __testing.validateGameDayRecapResult(result, [expectedGame]);
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
  expectedGame.playByPlaySummaryLines = expectedGame.playByPlayFacts.summaryLines;
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
      writeupSourceField: "factStore.games[0].playByPlayFacts.bestCompetitiveSwingRun",
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
  assert.match(blockingIssue.sourceField ?? "", /playByPlayFacts\.bestCompetitiveSwingRun/i);
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
  expectedGame.playByPlaySummaryLines = expectedGame.playByPlayFacts.summaryLines;

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
    /timing anchors|08:00/i,
  );
});

test("judgeGameDayRecapResult flags unsupported lead-change counts", async () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.playByPlayFacts = createBackAndForthPlayByPlayFacts();
  expectedGame.playByPlayFacts.primaryRun = null;
  expectedGame.playByPlaySummaryLines = expectedGame.playByPlayFacts.summaryLines;
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
  assert.match(blockingIssue.sourceField ?? "", /playByPlayFacts\.leadChangeFacts/i);
});

test("judgeGameDayRecapResult flags unsupported comeback-to-the-lead claims", async () => {
  const expectedGame = createExpectedPromptGame("m-1");
  expectedGame.playByPlayFacts = createBackAndForthPlayByPlayFacts();
  expectedGame.playByPlayFacts.primaryRun = null;
  expectedGame.playByPlaySummaryLines = expectedGame.playByPlayFacts.summaryLines;
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
          (error as {
            issues: Array<{ kind?: unknown }>;
          }).issues.some(
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

test("validateGameDayRecapResult requires the standardized series line in the opener", () => {
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
            lede: "Best-of-three finals recaps should always state the new series score in the opening two sentences.",
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
              headline: "Alpha closes the book",
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

test("removeInvalidWriteupSentences ignores opener-structure-only issues", () => {
  const originalGame = {
    evidenceTags: ["recent_form"] as const,
    headline: "Home wins",
    matchId: "m-1",
    writeup:
      "Home leads the series 1-0. The opener should still be rebuilt instead of trimmed.",
  };

  const trimmedGame = __testing.removeInvalidWriteupSentences(originalGame, [
    {
      feedback: "restore the exact series line in the opener",
      field: "writeup",
      kind: "missing_series_summary_line",
      matchId: "m-1",
      reason: "series line missing from the opener",
      salvage: "patch_or_remove",
      sentence: "Home leads the series 1-0.",
      sentenceIndex: 0,
    },
    {
      feedback: "restore the decisive ending in the opener",
      field: "writeup",
      kind: "missing_decisive_ending_emphasis",
      matchId: "m-1",
      reason: "decisive ending missing from the opener",
      salvage: "patch_or_remove",
      sentence: "Home leads the series 1-0.",
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
      "qa must contain 1 or 2 exchanges, received 3.",
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

  const result = await __testing.generateResolvedGameDayRecap({
    judgeProvider: createPassingJudgeProvider(),
    payload,
    qualityTier: "standard",
    retryProvider: null,
    writerProvider: {
      generate: async (payload) => {
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
  assert.equal(interview.qa.length, 1);
  assert.match(
    interview.qa[0]?.answer ?? "",
    /tried to keep Home steady/i,
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
  assert.equal(interview.qa.length, 1);
  const fallbackExchange = interview.qa[0]!;
  assert.equal(
    fallbackExchange.question,
    "You finished with 24 points, 8 rebounds, and 4 assists. What was working for you out there tonight?",
  );
  assert.match(fallbackExchange.answer, /^I stayed aggressive/i);
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
          throw new Error("interview generation should be skipped on low budget");
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
    laxAssessment.issues.some(
      (issue) => issue.kind === "banned_style_phrase",
    ),
    false,
  );
  assert.equal(
    strictAssessment.issues.some(
      (issue) => issue.kind === "banned_style_phrase",
    ),
    true,
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
        headline: "Stark Contrast escapes late",
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
  const deterministic =
    __testing.assessGameDayRecapDeterministicPayload(invalidResult, [
      expectedGame,
    ]);

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
    /^Stark Contrast leads the series 1-0\. Stark Contrast won it on a buzzerbeater, going ahead 88-86 at the horn\./,
  );
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
          if (
            !threwGrammarFailure &&
            judgePayload.sentenceChunk.length === 6
          ) {
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
        throw new Error("retry provider should not be used for grammar fallback test");
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
  assert.deepStrictEqual(chunkSizes, [6, 1, 1, 1, 1, 1, 1, 4]);
});

test("premium recap selection keeps the same winner after chunked factuality and separate interestingness judging", async () => {
  const payload = createSingleGameRecapPayload();
  const writerProvider = {
    generate: async (_payload: unknown, options?: { candidateIndex?: number }) => {
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
        throw new Error("retry provider should not be used for judge fallback test");
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
                  notes:
                    "The headline credits the wrong side with the result.",
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

test("premium recap fallback drops only the contradicted game when the retry headline is still wrong", async () => {
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

  assert.deepStrictEqual(result.coverageIssues, [
    {
      awayTeamName: "Delta",
      homeTeamName: "Gamma",
      matchId: "m-2",
      reason: "removed after factual validation could not be safely repaired",
    },
  ]);
  assert.deepStrictEqual(
    result.result.games.map((game) => game.matchId),
    ["m-1"],
  );
  assert.equal(result.result.summary.headline, "Elite League partial roundup");
});

test("premium recap fallback still fails when every game must be dropped", async () => {
  const payload = createSingleGameRecapPayload();
  const invalidHeadlineCandidate = createRecapCandidateResult({
    headline: "Away beats Home 81-85",
    writeup:
      "Home actually won the game, so this headline contradiction should force a drop during the deterministic fallback.",
  });

  await assert.rejects(
    () =>
      __testing.generateResolvedGameDayRecap({
        judgeProvider: createPassingJudgeProvider({
          generate: async (judgePayload) => {
            const supported =
              createSupportedJudgeResponseFromPayload(judgePayload);
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
      }),
    /could not be safely repaired/i,
  );
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
