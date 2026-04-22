import {
  BBPublicPlayByPlayFetchError,
  BBPublicPlayByPlayParseError,
  fetchPublicMatchPlayByPlay,
  type PublicMatchPlayByPlay,
  type PublicMatchPlayByPlayEvent,
} from "../../../lib/bbapi";

const COMEBACK_SUMMARY_THRESHOLD = 8;
const SURFACED_UNANSWERED_RUN_MIN_POINTS = 6;
const SWING_RUN_MAX_ELAPSED_SECONDS = 360;
const SWING_RUN_MAX_COMBINED_POINTS = 40;
const SWING_RUN_TEAM_POINTS_THRESHOLD = 10;
const SWING_RUN_NET_MARGIN_THRESHOLD = 8;
const COMPETITIVE_RUN_START_MARGIN_THRESHOLD = 6;
const SECONDARY_RUN_MARGIN_SWING_THRESHOLD = 8;
const SECONDARY_RUN_CLOSE_GAP_THRESHOLD = 2;
const SECONDARY_RUN_MIN_SECONDS_APART = 90;
const BIG_COMEBACK_LEAD_CHANGE_THRESHOLD = 8;
const RAPID_LEAD_CHANGE_BURST_MIN_COUNT = 4;
const RAPID_LEAD_CHANGE_WINDOW_SECONDS = 120;
const HIGH_VOLUME_LEAD_CHANGE_THRESHOLD = 10;
const LATE_GAME_WINDOW_SECONDS = 120;
const DECISIVE_LEAD_EXTENSION_MAX_SECONDS_REMAINING = 60;
const DECISIVE_LEAD_EXTENSION_MAX_MARGIN = 3;
const EXPLICIT_BUZZERBEATER_PATTERN = /\bbuzzerbeater\b/i;
const THREE_POINT_ATTEMPT_PATTERN =
  /\b(?:three|3-point|three-point|three pointer|three-pointer|downtown|behind the arc|long-range|half-court|from deep)\b/i;
const MISSED_FREE_THROW_PATTERN =
  /\b(?:free throw missed|free throw|brick from the line|misses the free throw|free throw attempt.*(?:missed|no good))\b/i;
const MISSED_SHOT_PATTERN =
  /\b(?:shot missed|shot blocked|missed|misses|no good|off the rim|off the iron)\b/i;
const TURNOVER_PATTERN =
  /\b(?:threw the ball away|turnover|traveled|traveling violation|three[- ]second violation|shot clock violation|out of bounds|offensive foul|intercepted|stole the ball|ball stolen|lost the handle)\b/i;

type TeamSide = "away" | "home";
type RunType = "swing" | "unanswered";
type RunEndedBy = "game_end" | "opponent_answer" | "unknown";

export type GameDayRecapPlayByPlayLoadErrorDetails = {
  bodyPreview?: string;
  endpoint?: string;
  errorMessage: string;
  errorName?: string;
  status?: number;
};

export type GameDayRecapPlayByPlayLoadError = {
  details: GameDayRecapPlayByPlayLoadErrorDetails;
  kind: "fetch_failed" | "parse_failed";
};

export type GameDayRecapPlayByPlayLargestLead = {
  points: number;
  teamName: string | null;
  teamSide: TeamSide | null;
};

export type GameDayRecapPlayByPlayRun = {
  endAwayScore: number;
  endClock: string | null;
  endMarginFromTeamPerspective: number;
  endedBy: RunEndedBy | null;
  endHomeScore: number;
  endQuarter: number | null;
  marginSwing: number;
  netMargin: number;
  opponentPoints: number;
  runType: RunType;
  startAwayScore: number;
  startClock: string | null;
  startMarginFromTeamPerspective: number;
  startHomeScore: number;
  startQuarter: number | null;
  teamName: string | null;
  teamPoints: number;
  teamSide: TeamSide | null;
};

export type GameDayRecapPlayByPlayLeadChange = {
  awayScore: number;
  clock: string | null;
  deficitErased: number;
  eventText: string | null;
  homeScore: number;
  previousLeaderSide: TeamSide;
  quarter: number;
  scoringTeamName: string | null;
  scoringTeamSide: TeamSide;
};

export type GameDayRecapPlayByPlayRapidLeadChangeBurst = {
  endClock: string | null;
  endQuarter: number | null;
  leadChangeCount: number;
  startClock: string | null;
  startQuarter: number | null;
};

export type GameDayRecapPlayByPlayLeadChangeFacts = {
  bigComebackLeadChange: GameDayRecapPlayByPlayLeadChange | null;
  highVolumeLeadChangeGame: {
    leadChangeCount: number;
    qualifies: boolean;
  };
  rapidLeadChangeBurst: GameDayRecapPlayByPlayRapidLeadChangeBurst | null;
};

export type GameDayRecapLateGameMoment = {
  clock: string | null;
  eventText: string | null;
  homeScore: number;
  momentType: "go_ahead" | "tie";
  awayScore: number;
  quarter: number;
  scoringTeamName: string | null;
  scoringTeamSide: TeamSide;
};

export type GameDayRecapPlayByPlayDecisiveScore = {
  awayScore: number;
  clock: string | null;
  createdWinningMargin: boolean;
  eventText: string | null;
  explicitBuzzerBeater: boolean;
  homeScore: number;
  isBuzzerBeater: boolean;
  isWalkOff: boolean;
  momentType: "go_ahead" | "lead_extension";
  points: number;
  quarter: number;
  scoringTeamName: string | null;
  scoringTeamSide: TeamSide;
};

export type GameDayRecapPlayByPlayLastChance = {
  awayScore: number;
  chanceType: "go_ahead" | "tie" | "tie_or_go_ahead";
  clock: string | null;
  eventText: string | null;
  homeScore: number;
  outcomeType: "missed_free_throw" | "missed_shot" | "turnover";
  quarter: number;
  teamName: string | null;
  teamSide: TeamSide;
};

export type GameDayRecapPlayByPlayEndingFacts = {
  decisiveScore: GameDayRecapPlayByPlayDecisiveScore | null;
  opponentLastChance: GameDayRecapPlayByPlayLastChance | null;
};

export type GameDayRecapPlayByPlayFacts = {
  bestCompetitiveSwingRun: GameDayRecapPlayByPlayRun;
  endingFacts: GameDayRecapPlayByPlayEndingFacts;
  lateGameMoments: GameDayRecapLateGameMoment[];
  largestLead: GameDayRecapPlayByPlayLargestLead;
  leadChangeCount: number;
  leadChangeFacts: GameDayRecapPlayByPlayLeadChangeFacts;
  longestUnansweredRun: GameDayRecapPlayByPlayRun;
  primaryRun: GameDayRecapPlayByPlayRun | null;
  secondaryRun: GameDayRecapPlayByPlayRun | null;
  summaryLines: string[];
  winnerComebackDeficit: number | null;
};

export type GameDayRecapPlayByPlayLoadResult = {
  debug: {
    decisiveEndingClock: string | null;
    decisiveEndingEventText: string | null;
    decisiveEndingQualificationReason:
      | "buzzerbeater_or_walkoff"
      | "late_one_possession_score"
      | "opponent_last_chance"
      | null;
    decisiveEndingQuarter: number | null;
  } | null;
  error: GameDayRecapPlayByPlayLoadError | null;
  facts: GameDayRecapPlayByPlayFacts | null;
};

type TeamNameContext = {
  awayTeamName?: string | null;
  homeTeamName?: string | null;
};

type EventContext = {
  actingTeamSide: TeamSide | null;
  afterAwayScore: number;
  afterHomeScore: number;
  beforeAwayScore: number;
  beforeHomeScore: number;
  clock: string | null;
  eventText: string | null;
  eventType: string | null;
  gameSecondsElapsed: number | null;
  points: number;
  quarter: number;
  rawIndex: number;
  scoringTeamSide: TeamSide | null;
  wallClock: number;
};

type LeadChangeEvent = GameDayRecapPlayByPlayLeadChange & {
  gameSecondsElapsed: number | null;
  rawIndex: number;
};

type ResolvedImpactfulRuns = {
  primaryRun: GameDayRecapPlayByPlayRun | null;
  secondaryRun: GameDayRecapPlayByPlayRun | null;
};

type InternalDecisiveEndingQualificationReason =
  | "buzzerbeater_or_walkoff"
  | "late_one_possession_score"
  | "opponent_last_chance";

type ResolvedDecisiveEnding = {
  opponentLastChance: GameDayRecapPlayByPlayLastChance | null;
  qualificationReason: InternalDecisiveEndingQualificationReason;
  scoringEvent: EventContext & { scoringTeamSide: TeamSide };
};

export async function loadGameDayRecapPlayByPlayFacts(args: {
  awayTeamName?: string | null;
  fetchPublicMatchPlayByPlay?: typeof fetchPublicMatchPlayByPlay;
  homeTeamName?: string | null;
  matchId: string;
}): Promise<GameDayRecapPlayByPlayLoadResult> {
  const fetcher = args.fetchPublicMatchPlayByPlay ?? fetchPublicMatchPlayByPlay;

  try {
    const playByPlay = await fetcher(args.matchId);
    const detailedFacts = buildGameDayRecapPlayByPlayFactsDetailed(playByPlay, {
      awayTeamName: args.awayTeamName,
      homeTeamName: args.homeTeamName,
    });
    return {
      debug: detailedFacts.debug,
      error: null,
      facts: detailedFacts.facts,
    };
  } catch (error) {
    if (error instanceof BBPublicPlayByPlayFetchError) {
      return {
        debug: null,
        error: {
          details: {
            bodyPreview: error.bodyPreview,
            endpoint: error.endpoint,
            errorMessage: error.message,
            errorName: error.name,
            status: error.status,
          },
          kind: "fetch_failed",
        },
        facts: null,
      };
    }

    if (error instanceof BBPublicPlayByPlayParseError) {
      return {
        debug: null,
        error: {
          details: {
            bodyPreview: error.bodyPreview,
            endpoint: error.endpoint,
            errorMessage: error.message,
            errorName: error.name,
          },
          kind: "parse_failed",
        },
        facts: null,
      };
    }

    return {
      debug: null,
      error: {
        details: {
          errorMessage: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : undefined,
        },
        kind: "fetch_failed",
      },
      facts: null,
    };
  }
}

export function buildGameDayRecapPlayByPlayFacts(
  playByPlay: PublicMatchPlayByPlay,
  teamNames: TeamNameContext = {},
): GameDayRecapPlayByPlayFacts {
  return buildGameDayRecapPlayByPlayFactsDetailed(playByPlay, teamNames).facts;
}

function buildGameDayRecapPlayByPlayFactsDetailed(
  playByPlay: PublicMatchPlayByPlay,
  teamNames: TeamNameContext = {},
): {
  debug: GameDayRecapPlayByPlayLoadResult["debug"];
  facts: GameDayRecapPlayByPlayFacts;
} {
  const scoreTimeline = buildScoreTimeline(playByPlay.events);
  const scoringEvents = scoreTimeline.filter(isScoringEvent);
  const finalLeader = resolveLeader(
    resolveFinalHomeScore(scoreTimeline),
    resolveFinalAwayScore(scoreTimeline),
  );
  const winnerComebackDeficit =
    finalLeader === "tie"
      ? null
      : resolveWinnerComebackDeficit(scoringEvents, finalLeader);
  const leadChanges = resolveLeadChanges(scoringEvents, teamNames);
  const leadChangeCount = leadChanges.length;
  const leadChangeFacts = resolveLeadChangeFacts(leadChanges);
  const largestLead = resolveLargestLead(scoringEvents, teamNames);
  const longestUnansweredRun = resolveLongestUnansweredRun(
    scoringEvents,
    teamNames,
  );
  const bestCompetitiveSwingRun = resolveBestCompetitiveSwingRun(
    scoringEvents,
    teamNames,
  );
  const { primaryRun, secondaryRun } = resolveImpactfulRuns(
    scoringEvents,
    teamNames,
  );
  const lateGameMoments = resolveLateGameMoments(scoringEvents, teamNames);
  const { debug, endingFacts } = resolveEndingFactsWithDebug(
    scoreTimeline,
    teamNames,
    finalLeader === "tie" ? null : finalLeader,
  );
  const summaryLines = buildSummaryLines({
    bestCompetitiveSwingRun,
    awayTeamName: teamNames.awayTeamName,
    endingFacts,
    leadChangeFacts,
    homeTeamName: teamNames.homeTeamName,
    lateGameMoments,
    longestUnansweredRun,
    primaryRun,
    secondaryRun,
    winnerComebackDeficit,
    winnerSide: finalLeader === "tie" ? null : finalLeader,
  });

  return {
    debug,
    facts: {
      bestCompetitiveSwingRun,
      endingFacts,
      lateGameMoments,
      largestLead,
      leadChangeCount,
      leadChangeFacts,
      longestUnansweredRun,
      primaryRun,
      secondaryRun,
      summaryLines,
      winnerComebackDeficit,
    },
  };
}

function buildScoreTimeline(
  events: PublicMatchPlayByPlayEvent[],
): EventContext[] {
  let previousHomeScore = 0;
  let previousAwayScore = 0;

  return events.map((event, rawIndex) => {
    const beforeHomeScore = previousHomeScore;
    const beforeAwayScore = previousAwayScore;
    const afterHomeScore = event.homeScore;
    const afterAwayScore = event.awayScore;
    const homeDelta = afterHomeScore - beforeHomeScore;
    const awayDelta = afterAwayScore - beforeAwayScore;
    const scoringTeamSide =
      homeDelta > 0 && awayDelta <= 0
        ? "home"
        : awayDelta > 0 && homeDelta <= 0
          ? "away"
          : null;
    const points =
      scoringTeamSide === "home"
        ? homeDelta
        : scoringTeamSide === "away"
          ? awayDelta
          : 0;
    const actingTeamSide =
      scoringTeamSide ?? resolvePossessionTeamSide(event) ?? null;

    previousHomeScore = afterHomeScore;
    previousAwayScore = afterAwayScore;

    return {
      actingTeamSide,
      afterAwayScore,
      afterHomeScore,
      beforeAwayScore,
      beforeHomeScore,
      clock: event.clock ?? null,
      eventText: event.eventText ?? null,
      eventType: event.type ?? null,
      gameSecondsElapsed: resolveGameSecondsElapsed(event),
      points,
      quarter: event.quarter,
      rawIndex,
      scoringTeamSide,
      wallClock: event.wallClock,
    };
  });
}

function resolvePossessionTeamSide(
  event: PublicMatchPlayByPlayEvent,
): TeamSide | null {
  const isHomePossession = (event as { isHomePossession?: unknown })
    .isHomePossession;
  if (typeof isHomePossession !== "boolean") {
    return null;
  }

  return isHomePossession ? "home" : "away";
}

function isScoringEvent(
  event: EventContext,
): event is EventContext & { scoringTeamSide: TeamSide } {
  return event.scoringTeamSide === "home" || event.scoringTeamSide === "away";
}

function resolveLeadChanges(
  scoringEvents: Array<
    EventContext & {
      scoringTeamSide: TeamSide;
    }
  >,
  teamNames: TeamNameContext,
): LeadChangeEvent[] {
  let lastNonTieLeader: TeamSide | null = null;
  const largestDeficitBySide: Record<TeamSide, number> = {
    away: 0,
    home: 0,
  };
  const leadChanges: LeadChangeEvent[] = [];

  for (const scoringEvent of scoringEvents) {
    largestDeficitBySide.home = Math.max(
      largestDeficitBySide.home,
      Math.max(
        0,
        scoringEvent.beforeAwayScore - scoringEvent.beforeHomeScore,
      ),
    );
    largestDeficitBySide.away = Math.max(
      largestDeficitBySide.away,
      Math.max(
        0,
        scoringEvent.beforeHomeScore - scoringEvent.beforeAwayScore,
      ),
    );

    const leader = resolveLeader(
      scoringEvent.afterHomeScore,
      scoringEvent.afterAwayScore,
    );
    if (leader === "tie") {
      continue;
    }
    if (lastNonTieLeader && leader !== lastNonTieLeader) {
      leadChanges.push({
        awayScore: scoringEvent.afterAwayScore,
        clock: scoringEvent.clock,
        deficitErased: largestDeficitBySide[leader],
        eventText: scoringEvent.eventText,
        gameSecondsElapsed: scoringEvent.gameSecondsElapsed,
        homeScore: scoringEvent.afterHomeScore,
        previousLeaderSide: lastNonTieLeader,
        quarter: scoringEvent.quarter,
        rawIndex: scoringEvent.rawIndex,
        scoringTeamName: resolveTeamName(leader, teamNames),
        scoringTeamSide: leader,
      });
    }
    lastNonTieLeader = leader;
  }

  return leadChanges;
}

function resolveLargestLead(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayLargestLead {
  const largestLead: GameDayRecapPlayByPlayLargestLead = {
    points: 0,
    teamName: null,
    teamSide: null,
  };

  for (const scoringEvent of scoringEvents) {
    const homeMargin =
      scoringEvent.afterHomeScore - scoringEvent.afterAwayScore;
    const leadSize = Math.abs(homeMargin);
    if (leadSize <= largestLead.points || leadSize === 0) {
      continue;
    }

    const teamSide: TeamSide = homeMargin > 0 ? "home" : "away";
    largestLead.points = leadSize;
    largestLead.teamSide = teamSide;
    largestLead.teamName = resolveTeamName(teamSide, teamNames);
  }

  return largestLead;
}

function resolveWinnerComebackDeficit(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  winnerSide: TeamSide,
): number {
  let largestDeficit = 0;

  for (const scoringEvent of scoringEvents) {
    const deficit =
      winnerSide === "home"
        ? Math.max(
            0,
            scoringEvent.beforeAwayScore - scoringEvent.beforeHomeScore,
          )
        : Math.max(
            0,
            scoringEvent.beforeHomeScore - scoringEvent.beforeAwayScore,
          );
    if (deficit > largestDeficit) {
      largestDeficit = deficit;
    }
  }

  return largestDeficit;
}

function resolveLongestUnansweredRun(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayRun {
  let currentRunStartIndex = 0;
  let currentRunSide: TeamSide | null = null;
  let currentRunPoints = 0;
  let longestRun = createEmptyRunFact("unanswered");

  for (let index = 0; index < scoringEvents.length; index += 1) {
    const scoringEvent = scoringEvents[index]!;
    if (currentRunSide === scoringEvent.scoringTeamSide) {
      currentRunPoints += scoringEvent.points;
    } else {
      currentRunSide = scoringEvent.scoringTeamSide;
      currentRunPoints = scoringEvent.points;
      currentRunStartIndex = index;
    }

    if (!currentRunSide) {
      continue;
    }

    const candidate = buildRunFact({
      endEvent: scoringEvent,
      endedBy:
        index === scoringEvents.length - 1 ? "game_end" : "opponent_answer",
      opponentPoints: 0,
      runType: "unanswered",
      startEvent: scoringEvents[currentRunStartIndex]!,
      teamNames,
      teamPoints: currentRunPoints,
      teamSide: currentRunSide,
    });
    if (isBetterRunCandidate(candidate, longestRun)) {
      longestRun = candidate;
    }
  }

  return longestRun;
}

function resolveBestCompetitiveSwingRun(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayRun {
  let bestRun = createEmptyRunFact("swing");

  const candidates = collectSwingRunCandidates(scoringEvents, teamNames, {
    requireCompetitiveStart: true,
  });
  for (const candidate of candidates) {
    if (!isQualifiedSwingRun(candidate)) {
      continue;
    }
    if (isBetterRunCandidate(candidate, bestRun)) {
      bestRun = candidate;
    }
  }

  return bestRun;
}

function resolveImpactfulRuns(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): ResolvedImpactfulRuns {
  const candidates = [
    ...collectCompletedUnansweredRuns(scoringEvents, teamNames),
    ...collectSwingRunCandidates(scoringEvents, teamNames),
  ].filter(isQualifiedImpactfulRun);

  const rankedRuns = [...candidates].sort(compareImpactfulRuns);
  const primaryRun = rankedRuns[0] ?? null;
  if (!primaryRun) {
    return {
      primaryRun: null,
      secondaryRun: null,
    };
  }

  const secondaryRun =
    rankedRuns.find((candidate) =>
      isSupportedSecondaryRunCandidate(candidate, primaryRun),
    ) ?? null;

  return {
    primaryRun,
    secondaryRun,
  };
}

function createEmptyRunFact(runType: RunType): GameDayRecapPlayByPlayRun {
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

function collectCompletedUnansweredRuns(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayRun[] {
  const runs: GameDayRecapPlayByPlayRun[] = [];
  let currentRunStartIndex = 0;
  let currentRunSide: TeamSide | null = null;
  let currentRunPoints = 0;

  for (let index = 0; index < scoringEvents.length; index += 1) {
    const scoringEvent = scoringEvents[index]!;
    if (currentRunSide === scoringEvent.scoringTeamSide) {
      currentRunPoints += scoringEvent.points;
    } else {
      currentRunSide = scoringEvent.scoringTeamSide;
      currentRunPoints = scoringEvent.points;
      currentRunStartIndex = index;
    }

    const nextScoringEvent = scoringEvents[index + 1] ?? null;
    if (nextScoringEvent?.scoringTeamSide === currentRunSide) {
      continue;
    }
    if (!currentRunSide) {
      continue;
    }

    runs.push(
      buildRunFact({
        endEvent: scoringEvent,
        endedBy: nextScoringEvent ? "opponent_answer" : "game_end",
        opponentPoints: 0,
        runType: "unanswered",
        startEvent: scoringEvents[currentRunStartIndex]!,
        teamNames,
        teamPoints: currentRunPoints,
        teamSide: currentRunSide,
      }),
    );
  }

  return runs;
}

function collectSwingRunCandidates(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
  options?: {
    requireCompetitiveStart?: boolean;
  },
): GameDayRecapPlayByPlayRun[] {
  const candidates: GameDayRecapPlayByPlayRun[] = [];

  for (let startIndex = 0; startIndex < scoringEvents.length; startIndex += 1) {
    const startEvent = scoringEvents[startIndex]!;
    const startMargin = Math.abs(
      startEvent.beforeHomeScore - startEvent.beforeAwayScore,
    );
    if (
      options?.requireCompetitiveStart &&
      startMargin > COMPETITIVE_RUN_START_MARGIN_THRESHOLD
    ) {
      continue;
    }

    const teamSide = startEvent.scoringTeamSide;
    let teamPoints = 0;
    let opponentPoints = 0;

    for (let endIndex = startIndex; endIndex < scoringEvents.length; endIndex += 1) {
      const endEvent = scoringEvents[endIndex]!;
      const nextTeamPoints =
        teamPoints + (endEvent.scoringTeamSide === teamSide ? endEvent.points : 0);
      const nextOpponentPoints =
        opponentPoints +
        (endEvent.scoringTeamSide === teamSide ? 0 : endEvent.points);
      const combinedPoints = nextTeamPoints + nextOpponentPoints;
      const elapsedSeconds = resolveRunElapsedSeconds(startEvent, endEvent);
      if (
        combinedPoints > SWING_RUN_MAX_COMBINED_POINTS ||
        (elapsedSeconds !== null && elapsedSeconds > SWING_RUN_MAX_ELAPSED_SECONDS)
      ) {
        break;
      }

      teamPoints = nextTeamPoints;
      opponentPoints = nextOpponentPoints;
      if (opponentPoints === 0) {
        continue;
      }

      const nextScoringEvent = scoringEvents[endIndex + 1] ?? null;
      candidates.push(
        buildRunFact({
          endEvent,
          endedBy: !nextScoringEvent
            ? "game_end"
            : nextScoringEvent.scoringTeamSide !== teamSide
              ? "opponent_answer"
              : "unknown",
          opponentPoints,
          runType: "swing",
          startEvent,
          teamNames,
          teamPoints,
          teamSide,
        }),
      );
    }
  }

  return candidates;
}

function resolveRunElapsedSeconds(
  startEvent: EventContext,
  endEvent: EventContext,
): number | null {
  const startSeconds =
    startEvent.gameSecondsElapsed ??
    (startEvent.quarter > 0 ? resolveAnchorOrdering(startEvent.quarter, startEvent.clock) : null);
  const endSeconds =
    endEvent.gameSecondsElapsed ??
    (endEvent.quarter > 0 ? resolveAnchorOrdering(endEvent.quarter, endEvent.clock) : null);
  if (startSeconds === null || endSeconds === null) {
    return null;
  }

  return Math.max(0, endSeconds - startSeconds);
}

function buildRunFact(args: {
  endEvent: EventContext;
  endedBy: RunEndedBy;
  opponentPoints: number;
  runType: RunType;
  startEvent: EventContext;
  teamNames: TeamNameContext;
  teamPoints: number;
  teamSide: TeamSide;
}): GameDayRecapPlayByPlayRun {
  const startMarginFromTeamPerspective =
    args.teamSide === "home"
      ? args.startEvent.beforeHomeScore - args.startEvent.beforeAwayScore
      : args.startEvent.beforeAwayScore - args.startEvent.beforeHomeScore;
  const endMarginFromTeamPerspective =
    args.teamSide === "home"
      ? args.endEvent.afterHomeScore - args.endEvent.afterAwayScore
      : args.endEvent.afterAwayScore - args.endEvent.afterHomeScore;

  return {
    endAwayScore: args.endEvent.afterAwayScore,
    endClock: args.endEvent.clock,
    endMarginFromTeamPerspective,
    endedBy: args.endedBy,
    endHomeScore: args.endEvent.afterHomeScore,
    endQuarter: args.endEvent.quarter,
    marginSwing: endMarginFromTeamPerspective - startMarginFromTeamPerspective,
    netMargin: args.teamPoints - args.opponentPoints,
    opponentPoints: args.opponentPoints,
    runType: args.runType,
    startAwayScore: args.startEvent.beforeAwayScore,
    startClock: args.startEvent.clock,
    startMarginFromTeamPerspective,
    startHomeScore: args.startEvent.beforeHomeScore,
    startQuarter: args.startEvent.quarter,
    teamName: resolveTeamName(args.teamSide, args.teamNames),
    teamPoints: args.teamPoints,
    teamSide: args.teamSide,
  };
}

function isBetterRunCandidate(
  candidate: GameDayRecapPlayByPlayRun,
  currentBest: GameDayRecapPlayByPlayRun,
): boolean {
  if (!candidate.teamSide) {
    return false;
  }
  if (!currentBest.teamSide) {
    return true;
  }
  if (candidate.netMargin !== currentBest.netMargin) {
    return candidate.netMargin > currentBest.netMargin;
  }
  if (candidate.teamPoints !== currentBest.teamPoints) {
    return candidate.teamPoints > currentBest.teamPoints;
  }
  if (candidate.opponentPoints !== currentBest.opponentPoints) {
    return candidate.opponentPoints < currentBest.opponentPoints;
  }

  const candidateOrdering =
    candidate.endQuarter !== null
      ? resolveAnchorOrdering(candidate.endQuarter, candidate.endClock)
      : Number.NEGATIVE_INFINITY;
  const currentOrdering =
    currentBest.endQuarter !== null
      ? resolveAnchorOrdering(currentBest.endQuarter, currentBest.endClock)
      : Number.NEGATIVE_INFINITY;
  if (candidateOrdering !== currentOrdering) {
    return candidateOrdering > currentOrdering;
  }

  return false;
}

function compareImpactfulRuns(
  left: GameDayRecapPlayByPlayRun,
  right: GameDayRecapPlayByPlayRun,
): number {
  if (right.marginSwing !== left.marginSwing) {
    return right.marginSwing - left.marginSwing;
  }
  if (right.netMargin !== left.netMargin) {
    return right.netMargin - left.netMargin;
  }
  if (right.teamPoints !== left.teamPoints) {
    return right.teamPoints - left.teamPoints;
  }

  const rightOrdering =
    right.endQuarter !== null
      ? resolveAnchorOrdering(right.endQuarter, right.endClock)
      : Number.NEGATIVE_INFINITY;
  const leftOrdering =
    left.endQuarter !== null
      ? resolveAnchorOrdering(left.endQuarter, left.endClock)
      : Number.NEGATIVE_INFINITY;
  return rightOrdering - leftOrdering;
}

function isQualifiedImpactfulRun(run: GameDayRecapPlayByPlayRun): boolean {
  if (!run.teamSide) {
    return false;
  }

  if (run.runType === "unanswered") {
    return run.teamPoints >= SURFACED_UNANSWERED_RUN_MIN_POINTS;
  }

  return isQualifiedSwingRun(run);
}

function isQualifiedSwingRun(run: GameDayRecapPlayByPlayRun): boolean {
  return Boolean(
    run.teamSide &&
      run.opponentPoints > 0 &&
      run.teamPoints >= SWING_RUN_TEAM_POINTS_THRESHOLD &&
      (run.netMargin >= SWING_RUN_NET_MARGIN_THRESHOLD ||
        run.teamPoints >= run.opponentPoints * 2),
  );
}

function isSupportedSecondaryRunCandidate(
  candidate: GameDayRecapPlayByPlayRun,
  primaryRun: GameDayRecapPlayByPlayRun,
): boolean {
  if (!candidate.teamSide || !primaryRun.teamSide) {
    return false;
  }
  if (
    candidate.teamSide === primaryRun.teamSide &&
    candidate.startQuarter === primaryRun.startQuarter &&
    candidate.startClock === primaryRun.startClock &&
    candidate.endQuarter === primaryRun.endQuarter &&
    candidate.endClock === primaryRun.endClock &&
    candidate.teamPoints === primaryRun.teamPoints &&
    candidate.opponentPoints === primaryRun.opponentPoints
  ) {
    return false;
  }

  const candidateEndOrdering =
    candidate.endQuarter !== null
      ? resolveAnchorOrdering(candidate.endQuarter, candidate.endClock)
      : Number.NEGATIVE_INFINITY;
  const primaryEndOrdering =
    primaryRun.endQuarter !== null
      ? resolveAnchorOrdering(primaryRun.endQuarter, primaryRun.endClock)
      : Number.NEGATIVE_INFINITY;
  const separatedInTime =
    Number.isFinite(candidateEndOrdering) &&
    Number.isFinite(primaryEndOrdering) &&
    Math.abs(candidateEndOrdering - primaryEndOrdering) >=
      SECONDARY_RUN_MIN_SECONDS_APART;
  const materiallyStrong =
    candidate.marginSwing >= SECONDARY_RUN_MARGIN_SWING_THRESHOLD ||
    candidate.marginSwing >=
      primaryRun.marginSwing - SECONDARY_RUN_CLOSE_GAP_THRESHOLD;

  return materiallyStrong && (candidate.teamSide !== primaryRun.teamSide || separatedInTime);
}

function resolveLeadChangeFacts(
  leadChanges: LeadChangeEvent[],
): GameDayRecapPlayByPlayLeadChangeFacts {
  const internalBigComebackLeadChange = [...leadChanges]
    .filter(
      (leadChange) =>
        leadChange.deficitErased >= BIG_COMEBACK_LEAD_CHANGE_THRESHOLD,
    )
    .sort((left, right) => {
      if (right.deficitErased !== left.deficitErased) {
        return right.deficitErased - left.deficitErased;
      }
      const rightOrdering = resolveAnchorOrdering(right.quarter, right.clock);
      const leftOrdering = resolveAnchorOrdering(left.quarter, left.clock);
      if (rightOrdering !== leftOrdering) {
        return rightOrdering - leftOrdering;
      }
      return right.rawIndex - left.rawIndex;
    })[0] ?? null;
  const rapidLeadChangeBurst = resolveRapidLeadChangeBurst(leadChanges);

  return {
    bigComebackLeadChange: internalBigComebackLeadChange
      ? {
          awayScore: internalBigComebackLeadChange.awayScore,
          clock: internalBigComebackLeadChange.clock,
          deficitErased: internalBigComebackLeadChange.deficitErased,
          eventText: internalBigComebackLeadChange.eventText,
          homeScore: internalBigComebackLeadChange.homeScore,
          previousLeaderSide: internalBigComebackLeadChange.previousLeaderSide,
          quarter: internalBigComebackLeadChange.quarter,
          scoringTeamName: internalBigComebackLeadChange.scoringTeamName,
          scoringTeamSide: internalBigComebackLeadChange.scoringTeamSide,
        }
      : null,
    highVolumeLeadChangeGame: {
      leadChangeCount: leadChanges.length,
      qualifies: leadChanges.length >= HIGH_VOLUME_LEAD_CHANGE_THRESHOLD,
    },
    rapidLeadChangeBurst,
  };
}

function resolveRapidLeadChangeBurst(
  leadChanges: LeadChangeEvent[],
): GameDayRecapPlayByPlayRapidLeadChangeBurst | null {
  const timedLeadChanges = leadChanges.filter(
    (leadChange) => leadChange.gameSecondsElapsed !== null,
  );
  let bestBurst: {
    durationSeconds: number;
    end: LeadChangeEvent;
    leadChangeCount: number;
    start: LeadChangeEvent;
  } | null = null;

  for (let startIndex = 0; startIndex < timedLeadChanges.length; startIndex += 1) {
    const start = timedLeadChanges[startIndex]!;
    for (
      let endIndex = startIndex;
      endIndex < timedLeadChanges.length;
      endIndex += 1
    ) {
      const end = timedLeadChanges[endIndex]!;
      const durationSeconds =
        (end.gameSecondsElapsed ?? 0) - (start.gameSecondsElapsed ?? 0);
      if (durationSeconds > RAPID_LEAD_CHANGE_WINDOW_SECONDS) {
        break;
      }

      const leadChangeCount = endIndex - startIndex + 1;
      if (leadChangeCount < RAPID_LEAD_CHANGE_BURST_MIN_COUNT) {
        continue;
      }

      if (
        !bestBurst ||
        leadChangeCount > bestBurst.leadChangeCount ||
        (leadChangeCount === bestBurst.leadChangeCount &&
          durationSeconds < bestBurst.durationSeconds) ||
        (leadChangeCount === bestBurst.leadChangeCount &&
          durationSeconds === bestBurst.durationSeconds &&
          resolveAnchorOrdering(end.quarter, end.clock) >
            resolveAnchorOrdering(bestBurst.end.quarter, bestBurst.end.clock))
      ) {
        bestBurst = {
          durationSeconds,
          end,
          leadChangeCount,
          start,
        };
      }
    }
  }

  if (!bestBurst) {
    return null;
  }

  return {
    endClock: bestBurst.end.clock,
    endQuarter: bestBurst.end.quarter,
    leadChangeCount: bestBurst.leadChangeCount,
    startClock: bestBurst.start.clock,
    startQuarter: bestBurst.start.quarter,
  };
}

function resolveLateGameMoments(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapLateGameMoment[] {
  const lateMoments: GameDayRecapLateGameMoment[] = [];

  for (const scoringEvent of scoringEvents) {
    if (!isLateGameEvent(scoringEvent)) {
      continue;
    }

    const beforeLeader = resolveLeader(
      scoringEvent.beforeHomeScore,
      scoringEvent.beforeAwayScore,
    );
    const afterLeader = resolveLeader(
      scoringEvent.afterHomeScore,
      scoringEvent.afterAwayScore,
    );

    let momentType: GameDayRecapLateGameMoment["momentType"] | null = null;
    if (afterLeader === "tie" && beforeLeader !== "tie") {
      momentType = "tie";
    } else if (
      afterLeader === scoringEvent.scoringTeamSide &&
      beforeLeader !== scoringEvent.scoringTeamSide
    ) {
      momentType = "go_ahead";
    }

    if (!momentType) {
      continue;
    }

    lateMoments.push({
      clock: scoringEvent.clock,
      eventText: scoringEvent.eventText,
      homeScore: scoringEvent.afterHomeScore,
      momentType,
      awayScore: scoringEvent.afterAwayScore,
      quarter: scoringEvent.quarter,
      scoringTeamName: resolveTeamName(scoringEvent.scoringTeamSide, teamNames),
      scoringTeamSide: scoringEvent.scoringTeamSide,
    });
  }

  return lateMoments;
}

function isLateGameEvent(event: EventContext): boolean {
  if (event.quarter < 4) {
    return false;
  }

  const secondsRemaining = parseClockToRemainingSeconds(event.clock);
  return (
    secondsRemaining !== null && secondsRemaining <= LATE_GAME_WINDOW_SECONDS
  );
}

function resolveEndingFactsWithDebug(
  eventContexts: EventContext[],
  teamNames: TeamNameContext,
  winnerSide: TeamSide | null,
): {
  debug: GameDayRecapPlayByPlayLoadResult["debug"];
  endingFacts: GameDayRecapPlayByPlayEndingFacts;
} {
  if (!winnerSide) {
    return {
      debug: null,
      endingFacts: {
        decisiveScore: null,
        opponentLastChance: null,
      },
    };
  }

  const resolvedDecisiveEnding = resolveDecisiveEnding(
    eventContexts,
    winnerSide,
    teamNames,
  );
  const decisiveScore = resolvedDecisiveEnding
    ? buildDecisiveScore(
        resolvedDecisiveEnding.scoringEvent,
        eventContexts,
        teamNames,
        winnerSide,
      )
    : null;
  const opponentLastChance = resolvedDecisiveEnding?.opponentLastChance ?? null;

  return {
    debug: resolvedDecisiveEnding
      ? {
          decisiveEndingClock: resolvedDecisiveEnding.scoringEvent.clock,
          decisiveEndingEventText:
            resolvedDecisiveEnding.scoringEvent.eventText ?? null,
          decisiveEndingQualificationReason:
            resolvedDecisiveEnding.qualificationReason,
          decisiveEndingQuarter: resolvedDecisiveEnding.scoringEvent.quarter,
        }
      : null,
    endingFacts: {
      decisiveScore,
      opponentLastChance,
    },
  };
}

function resolveDecisiveEnding(
  eventContexts: EventContext[],
  winnerSide: TeamSide,
  teamNames: TeamNameContext,
): ResolvedDecisiveEnding | null {
  const scoringEvents = eventContexts.filter(isScoringEvent);

  for (let index = scoringEvents.length - 1; index >= 0; index -= 1) {
    const scoringEvent = scoringEvents[index]!;
    if (scoringEvent.scoringTeamSide !== winnerSide) {
      continue;
    }
    if (
      resolveLeader(
        scoringEvent.afterHomeScore,
        scoringEvent.afterAwayScore,
      ) !== winnerSide
    ) {
      continue;
    }
    const leadHeld = scoringEvents
      .slice(index + 1)
      .every(
        (laterEvent) =>
          resolveLeader(
            laterEvent.afterHomeScore,
            laterEvent.afterAwayScore,
          ) === winnerSide,
      );
    if (!leadHeld) {
      continue;
    }

    const opponentLastChance = resolveOpponentLastChance(
      eventContexts,
      scoringEvent,
      winnerSide,
      teamNames,
    );
    const qualificationReason = resolveDecisiveEndingQualificationReason(
      scoringEvent,
      eventContexts,
      winnerSide,
      opponentLastChance,
    );
    if (qualificationReason) {
      return {
        opponentLastChance,
        qualificationReason,
        scoringEvent,
      };
    }
  }

  return null;
}

function resolveDecisiveEndingQualificationReason(
  scoringEvent: EventContext & { scoringTeamSide: TeamSide },
  eventContexts: EventContext[],
  winnerSide: TeamSide,
  opponentLastChance: GameDayRecapPlayByPlayLastChance | null,
): InternalDecisiveEndingQualificationReason | null {
  const beforeLeader = resolveLeader(
    scoringEvent.beforeHomeScore,
    scoringEvent.beforeAwayScore,
  );
  const explicitBuzzerBeater = hasExplicitBuzzerbeaterComment(
    eventContexts,
    scoringEvent,
  );
  const laterScoringExists = eventContexts
    .slice(scoringEvent.rawIndex + 1)
    .some(isScoringEvent);
  const isWalkOffGoAhead =
    beforeLeader !== winnerSide &&
    !laterScoringExists &&
    parseClockToRemainingSeconds(scoringEvent.clock) === 0;
  if (explicitBuzzerBeater || isWalkOffGoAhead) {
    return "buzzerbeater_or_walkoff";
  }

  if (
    opponentLastChance &&
    scoringEvent.quarter >= 4 &&
    isLateGameEvent(scoringEvent)
  ) {
    return "opponent_last_chance";
  }

  const secondsRemaining = parseClockToRemainingSeconds(scoringEvent.clock);
  if (
    scoringEvent.quarter < 4 ||
    secondsRemaining === null ||
    secondsRemaining > DECISIVE_LEAD_EXTENSION_MAX_SECONDS_REMAINING
  ) {
    return null;
  }

  const margin =
    winnerSide === "home"
      ? scoringEvent.afterHomeScore - scoringEvent.afterAwayScore
      : scoringEvent.afterAwayScore - scoringEvent.afterHomeScore;
  return margin <= DECISIVE_LEAD_EXTENSION_MAX_MARGIN
    ? "late_one_possession_score"
    : null;
}

function buildDecisiveScore(
  scoringEvent: EventContext & { scoringTeamSide: TeamSide },
  eventContexts: EventContext[],
  teamNames: TeamNameContext,
  winnerSide: TeamSide,
): GameDayRecapPlayByPlayDecisiveScore {
  const beforeLeader = resolveLeader(
    scoringEvent.beforeHomeScore,
    scoringEvent.beforeAwayScore,
  );
  const laterScoringExists = eventContexts
    .slice(scoringEvent.rawIndex + 1)
    .some(isScoringEvent);
  const explicitBuzzerBeater = hasExplicitBuzzerbeaterComment(
    eventContexts,
    scoringEvent,
  );
  const isWalkOff =
    !laterScoringExists &&
    parseClockToRemainingSeconds(scoringEvent.clock) === 0;
  const momentType =
    beforeLeader !== winnerSide ? "go_ahead" : "lead_extension";

  return {
    awayScore: scoringEvent.afterAwayScore,
    clock: scoringEvent.clock,
    createdWinningMargin: true,
    eventText: scoringEvent.eventText,
    explicitBuzzerBeater,
    homeScore: scoringEvent.afterHomeScore,
    isBuzzerBeater:
      explicitBuzzerBeater || (isWalkOff && momentType === "go_ahead"),
    isWalkOff,
    momentType,
    points: scoringEvent.points,
    quarter: scoringEvent.quarter,
    scoringTeamName: resolveTeamName(scoringEvent.scoringTeamSide, teamNames),
    scoringTeamSide: scoringEvent.scoringTeamSide,
  };
}

function hasExplicitBuzzerbeaterComment(
  eventContexts: EventContext[],
  decisiveScoreEvent: EventContext,
): boolean {
  return eventContexts.some((event) => {
    if (
      Math.abs(event.rawIndex - decisiveScoreEvent.rawIndex) > 2 ||
      event.quarter !== decisiveScoreEvent.quarter ||
      event.clock !== decisiveScoreEvent.clock
    ) {
      return false;
    }

    return EXPLICIT_BUZZERBEATER_PATTERN.test(event.eventText ?? "");
  });
}

function resolveOpponentLastChance(
  eventContexts: EventContext[],
  decisiveScoreEvent: EventContext,
  winnerSide: TeamSide,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayLastChance | null {
  const losingSide: TeamSide = winnerSide === "home" ? "away" : "home";

  for (
    let index = eventContexts.length - 1;
    index > decisiveScoreEvent.rawIndex;
    index -= 1
  ) {
    const event = eventContexts[index]!;
    if (event.actingTeamSide !== losingSide) {
      continue;
    }
    if (event.quarter < 4 || !isLateGameEvent(event)) {
      continue;
    }

    const outcomeType = resolveLastChanceOutcomeType(event);
    if (!outcomeType) {
      continue;
    }

    const winnerScore =
      winnerSide === "home" ? event.beforeHomeScore : event.beforeAwayScore;
    const loserScore =
      winnerSide === "home" ? event.beforeAwayScore : event.beforeHomeScore;
    const deficit = winnerScore - loserScore;
    if (deficit <= 0 || deficit > 3) {
      continue;
    }

    const chanceType = resolveLastChanceType(deficit, event, outcomeType);
    if (!chanceType) {
      continue;
    }

    return {
      awayScore: event.beforeAwayScore,
      chanceType,
      clock: event.clock,
      eventText: event.eventText,
      homeScore: event.beforeHomeScore,
      outcomeType,
      quarter: event.quarter,
      teamName: resolveTeamName(losingSide, teamNames),
      teamSide: losingSide,
    };
  }

  return null;
}

function resolveLastChanceOutcomeType(
  event: EventContext,
): GameDayRecapPlayByPlayLastChance["outcomeType"] | null {
  const eventText = event.eventText ?? "";
  const eventType = event.eventType ?? "";

  if (
    eventType === "FREE_THROW_MISSED" ||
    MISSED_FREE_THROW_PATTERN.test(eventText)
  ) {
    return "missed_free_throw";
  }
  if (
    TURNOVER_PATTERN.test(eventText) ||
    /\b(?:turnover|violation|steal|offensive_foul)\b/i.test(eventType)
  ) {
    return "turnover";
  }
  if (MISSED_SHOT_PATTERN.test(eventText)) {
    return "missed_shot";
  }

  return null;
}

function resolveLastChanceType(
  deficit: number,
  event: EventContext,
  outcomeType: GameDayRecapPlayByPlayLastChance["outcomeType"],
): GameDayRecapPlayByPlayLastChance["chanceType"] | null {
  if (outcomeType === "turnover") {
    if (deficit === 1) {
      return "go_ahead";
    }
    if (deficit === 2) {
      return "tie_or_go_ahead";
    }
    if (deficit === 3) {
      return "tie";
    }
    return null;
  }

  const attemptPoints = resolvePotentialAttemptPoints(event, outcomeType);
  if (attemptPoints === null || deficit > attemptPoints) {
    return null;
  }

  if (deficit === attemptPoints) {
    return "tie";
  }

  return "go_ahead";
}

function resolvePotentialAttemptPoints(
  event: EventContext,
  outcomeType: GameDayRecapPlayByPlayLastChance["outcomeType"],
): number | null {
  if (outcomeType === "missed_free_throw") {
    return 1;
  }

  const eventText = event.eventText ?? "";
  const eventType = event.eventType ?? "";
  if (
    THREE_POINT_ATTEMPT_PATTERN.test(eventText) ||
    /\b(?:three|3pt|3_point|half_court)\b/i.test(eventType)
  ) {
    return 3;
  }

  if (outcomeType === "missed_shot") {
    return 2;
  }

  return null;
}

function buildSummaryLines(args: {
  bestCompetitiveSwingRun: GameDayRecapPlayByPlayRun;
  awayTeamName?: string | null;
  endingFacts: GameDayRecapPlayByPlayEndingFacts;
  leadChangeFacts: GameDayRecapPlayByPlayLeadChangeFacts;
  homeTeamName?: string | null;
  lateGameMoments: GameDayRecapLateGameMoment[];
  longestUnansweredRun: GameDayRecapPlayByPlayRun;
  primaryRun: GameDayRecapPlayByPlayRun | null;
  secondaryRun: GameDayRecapPlayByPlayRun | null;
  winnerComebackDeficit: number | null;
  winnerSide: TeamSide | null;
}): string[] {
  const lines: string[] = [];
  const endingSummary = summarizeEndingFacts(args.endingFacts);
  if (endingSummary) {
    lines.push(endingSummary);
  }

  if (
    args.winnerSide &&
    args.winnerComebackDeficit !== null &&
    args.winnerComebackDeficit >= COMEBACK_SUMMARY_THRESHOLD
  ) {
    lines.push(
      `${resolveTeamName(args.winnerSide, args) ?? resolveTeamLabel(args.winnerSide)} erased a ${args.winnerComebackDeficit}-point deficit to win.`,
    );
  }

  const leadChangeSummary = summarizeLeadChangeFacts(args.leadChangeFacts);
  if (leadChangeSummary) {
    lines.push(leadChangeSummary);
  }

  const lateGameSummary =
    !endingSummary && !leadChangeSummary
      ? summarizeLateGameMoments(args.lateGameMoments)
      : null;
  if (lateGameSummary) {
    lines.push(lateGameSummary);
  }

  const primaryRunSummary = summarizeRun(args.primaryRun, args.winnerSide);
  if (primaryRunSummary) {
    lines.push(primaryRunSummary);
  }

  const secondaryRunSummary = summarizeRun(args.secondaryRun, args.winnerSide);
  if (secondaryRunSummary) {
    lines.push(secondaryRunSummary);
  }

  return uniqueSummaryLines(lines).slice(0, 5);
}

function summarizeEndingFacts(
  endingFacts: GameDayRecapPlayByPlayEndingFacts,
): string | null {
  const decisiveScore = endingFacts.decisiveScore;
  const opponentLastChance = endingFacts.opponentLastChance;

  if (!decisiveScore) {
    return opponentLastChance
      ? `Closing sequence: ${describeOpponentLastChance(opponentLastChance)}.`
      : null;
  }

  if (decisiveScore.isBuzzerBeater) {
    return `${describeDecisiveScore(decisiveScore)}.`;
  }

  if (opponentLastChance) {
    return `Closing sequence: ${describeDecisiveScore(decisiveScore)}; ${describeOpponentLastChance(opponentLastChance)}.`;
  }

  if (decisiveScore.isWalkOff) {
    return `${describeDecisiveScore(decisiveScore)}.`;
  }

  return null;
}

function describeDecisiveScore(
  decisiveScore: GameDayRecapPlayByPlayDecisiveScore,
): string {
  const teamName =
    decisiveScore.scoringTeamName ??
    resolveTeamLabel(decisiveScore.scoringTeamSide);
  const score =
    decisiveScore.scoringTeamSide === "home"
      ? `${decisiveScore.homeScore}-${decisiveScore.awayScore}`
      : `${decisiveScore.awayScore}-${decisiveScore.homeScore}`;
  const periodLabel = formatPeriodLabel(decisiveScore.quarter);

  if (decisiveScore.isBuzzerBeater) {
    return `${teamName} won it on a buzzerbeater, going ahead ${score} at the buzzer in ${periodLabel}`;
  }

  if (decisiveScore.momentType === "go_ahead") {
    return `${teamName} went ahead ${score} ${formatClockContext(
      decisiveScore.clock,
      periodLabel,
    )}`;
  }

  return `${teamName} pushed the lead to ${score} ${formatClockContext(
    decisiveScore.clock,
    periodLabel,
  )}`;
}

function describeOpponentLastChance(
  lastChance: GameDayRecapPlayByPlayLastChance,
): string {
  const teamName = lastChance.teamName ?? resolveTeamLabel(lastChance.teamSide);
  const periodLabel = formatPeriodLabel(lastChance.quarter);
  const timePhrase = formatLastChanceTimePhrase(lastChance.clock, periodLabel);

  switch (lastChance.outcomeType) {
    case "missed_free_throw":
      switch (lastChance.chanceType) {
        case "go_ahead":
          return `${teamName} missed a go-ahead free throw ${timePhrase}`;
        case "tie":
          return `${teamName} missed a free throw that would have tied it ${timePhrase}`;
        case "tie_or_go_ahead":
          return `${teamName} missed a free throw on its last chance to tie or go ahead ${timePhrase}`;
      }
    case "missed_shot":
      switch (lastChance.chanceType) {
        case "go_ahead":
          return `${teamName} missed a go-ahead shot ${timePhrase}`;
        case "tie":
          return `${teamName} missed a tying shot ${timePhrase}`;
        case "tie_or_go_ahead":
          return `${teamName} missed its last chance to tie or go ahead ${timePhrase}`;
      }
    case "turnover":
      switch (lastChance.chanceType) {
        case "go_ahead":
          return `${teamName} turned it over on its last chance to go ahead ${timePhrase}`;
        case "tie":
          return `${teamName} turned it over on its last chance to tie ${timePhrase}`;
        case "tie_or_go_ahead":
          return `${teamName} turned it over on its last chance to tie or go ahead ${timePhrase}`;
      }
  }

  return `${teamName} could not convert its last chance ${timePhrase}`;
}

function formatClockContext(clock: string | null, periodLabel: string): string {
  if (clock === "00:00") {
    return `with no time left in ${periodLabel}`;
  }

  return clock
    ? `with ${clock} left in ${periodLabel}`
    : `late in ${periodLabel}`;
}

function formatLastChanceTimePhrase(
  clock: string | null,
  periodLabel: string,
): string {
  if (clock === "00:00") {
    return "at the horn";
  }

  return clock
    ? `with ${clock} left in ${periodLabel}`
    : `late in ${periodLabel}`;
}

function summarizeLateGameMoments(
  lateGameMoments: GameDayRecapLateGameMoment[],
): string | null {
  if (!lateGameMoments.length) {
    return null;
  }

  const momentsToDescribe = lateGameMoments.slice(-2);
  if (momentsToDescribe.length === 1) {
    return `Late-game swing: ${describeLateGameMoment(momentsToDescribe[0]!)}.`;
  }

  return `Late-game swings: ${momentsToDescribe
    .map((moment) => describeLateGameMoment(moment))
    .join("; ")}.`;
}

function describeLateGameMoment(moment: GameDayRecapLateGameMoment): string {
  const teamName =
    moment.scoringTeamName ?? resolveTeamLabel(moment.scoringTeamSide);
  const periodLabel = formatPeriodLabel(moment.quarter);
  const score =
    moment.scoringTeamSide === "home"
      ? `${moment.homeScore}-${moment.awayScore}`
      : `${moment.awayScore}-${moment.homeScore}`;
  const timePhrase = moment.clock
    ? `with ${moment.clock} left in ${periodLabel}`
    : `late in ${periodLabel}`;

  if (moment.momentType === "tie") {
    return `${teamName} tied it at ${score} ${timePhrase}`;
  }

  return `${teamName} went ahead ${score} ${timePhrase}`;
}

function summarizeLeadChangeFacts(
  leadChangeFacts: GameDayRecapPlayByPlayLeadChangeFacts,
): string | null {
  if (leadChangeFacts.bigComebackLeadChange) {
    return describeBigComebackLeadChange(leadChangeFacts.bigComebackLeadChange);
  }
  if (leadChangeFacts.rapidLeadChangeBurst) {
    return describeRapidLeadChangeBurst(leadChangeFacts.rapidLeadChangeBurst);
  }
  if (leadChangeFacts.highVolumeLeadChangeGame.qualifies) {
    return `The game featured ${leadChangeFacts.highVolumeLeadChangeGame.leadChangeCount} lead changes.`;
  }
  return null;
}

function describeBigComebackLeadChange(
  leadChange: GameDayRecapPlayByPlayLeadChange,
): string {
  const teamName =
    leadChange.scoringTeamName ?? resolveTeamLabel(leadChange.scoringTeamSide);
  const score = formatScoreFromTeamPerspective(
    leadChange.scoringTeamSide,
    leadChange.homeScore,
    leadChange.awayScore,
  );
  return `${teamName} erased a ${leadChange.deficitErased}-point deficit and took the lead ${score} ${formatClockContext(
    leadChange.clock,
    formatPeriodLabel(leadChange.quarter),
  )}.`;
}

function describeRapidLeadChangeBurst(
  rapidBurst: GameDayRecapPlayByPlayRapidLeadChangeBurst,
): string {
  if (
    rapidBurst.startQuarter !== null &&
    rapidBurst.endQuarter !== null &&
    rapidBurst.startClock &&
    rapidBurst.endClock
  ) {
    return `The lead changed hands ${rapidBurst.leadChangeCount} times from ${formatAnchorLabel(
      rapidBurst.startQuarter,
      rapidBurst.startClock,
    )} to ${formatAnchorLabel(rapidBurst.endQuarter, rapidBurst.endClock)}.`;
  }

  return `The lead changed hands ${rapidBurst.leadChangeCount} times in a two-minute burst.`;
}

function summarizeRun(
  run: GameDayRecapPlayByPlayRun | null,
  winnerSide: TeamSide | null,
): string | null {
  if (!run?.teamSide) {
    return null;
  }

  const teamName = run.teamName ?? resolveTeamLabel(run.teamSide);
  const runScore = `${run.teamPoints}-${run.opponentPoints}`;
  const timeRange = formatRunTimeRange(run);

  if (!timeRange) {
    return null;
  }

  const isWinnerRun = winnerSide !== null && run.teamSide === winnerSide;
  const article = selectRunArticle(run.teamPoints);
  const briefRunPhrase = `${article} brief ${runScore} run`;
  const standardRunPhrase = `${article} ${runScore} run`;

  if (isWinnerRun) {
    if (
      run.marginSwing >= 12 ||
      run.endMarginFromTeamPerspective >= 10 ||
      run.netMargin >= 10
    ) {
      return `${teamName} used ${standardRunPhrase} ${timeRange} to put the game away.`;
    }
    if (run.marginSwing >= 8 || run.endMarginFromTeamPerspective >= 6) {
      return `${teamName} used ${standardRunPhrase} ${timeRange} to seize control.`;
    }
    if (run.marginSwing >= 4) {
      return `${teamName} used ${standardRunPhrase} ${timeRange} to swing momentum.`;
    }

    return `${teamName} pieced together ${briefRunPhrase} ${timeRange}.`;
  }

  if (run.marginSwing >= 10) {
    return `${teamName} mounted ${standardRunPhrase} ${timeRange}, but it was not enough.`;
  }
  if (run.marginSwing >= 6) {
    return `${teamName} showed signs of life with ${standardRunPhrase} ${timeRange}, but it was not enough.`;
  }

  return `${teamName} made ${briefRunPhrase} ${timeRange}, but it was not enough.`;
}

function formatRunTimeRange(run: GameDayRecapPlayByPlayRun): string | null {
  if (run.startQuarter === null || !run.startClock) {
    return null;
  }
  const startLabel = formatAnchorLabel(run.startQuarter, run.startClock);
  if (
    run.endQuarter !== null &&
    run.endClock &&
    (run.endQuarter !== run.startQuarter || run.endClock !== run.startClock)
  ) {
    return `from ${startLabel} to ${formatAnchorLabel(run.endQuarter, run.endClock)}`;
  }
  return `starting at ${startLabel}`;
}

function formatAnchorLabel(quarter: number, clock: string): string {
  return `${clock} left in ${formatPeriodLabel(quarter)}`;
}

function resolveFinalHomeScore(events: EventContext[]): number {
  return events.at(-1)?.afterHomeScore ?? 0;
}

function resolveFinalAwayScore(events: EventContext[]): number {
  return events.at(-1)?.afterAwayScore ?? 0;
}

function resolveLeader(homeScore: number, awayScore: number): TeamSide | "tie" {
  if (homeScore === awayScore) {
    return "tie";
  }
  return homeScore > awayScore ? "home" : "away";
}

function resolveTeamName(
  teamSide: TeamSide,
  teamNames: TeamNameContext,
): string | null {
  return teamSide === "home"
    ? (teamNames.homeTeamName ?? null)
    : (teamNames.awayTeamName ?? null);
}

function resolveTeamLabel(teamSide: TeamSide): string {
  return teamSide === "home" ? "The home team" : "The away team";
}

function formatScoreFromTeamPerspective(
  teamSide: TeamSide,
  homeScore: number,
  awayScore: number,
): string {
  return teamSide === "home"
    ? `${homeScore}-${awayScore}`
    : `${awayScore}-${homeScore}`;
}

function parseClockToRemainingSeconds(clock: string | null): number | null {
  if (!clock) {
    return null;
  }
  const match = clock.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) {
    return null;
  }
  return minutes * 60 + seconds;
}

function resolveGameSecondsElapsed(
  event: PublicMatchPlayByPlayEvent,
): number | null {
  const remainingSeconds = parseClockToRemainingSeconds(event.clock ?? null);
  if (remainingSeconds === null) {
    return Number.isFinite(event.wallClock) ? event.wallClock : null;
  }

  if (event.quarter <= 4) {
    return (event.quarter - 1) * 12 * 60 + (12 * 60 - remainingSeconds);
  }

  return 4 * 12 * 60 + (event.quarter - 5) * 5 * 60 + (5 * 60 - remainingSeconds);
}

function resolveAnchorOrdering(quarter: number, clock: string | null): number {
  const gameSecondsElapsed =
    quarter <= 4
      ? (quarter - 1) * 12 * 60
      : 4 * 12 * 60 + (quarter - 5) * 5 * 60;
  const remainingSeconds = parseClockToRemainingSeconds(clock);
  if (remainingSeconds === null) {
    return gameSecondsElapsed;
  }

  const elapsedInPeriod =
    quarter <= 4 ? 12 * 60 - remainingSeconds : 5 * 60 - remainingSeconds;
  return gameSecondsElapsed + elapsedInPeriod;
}

function uniqueSummaryLines(lines: string[]): string[] {
  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
}

function selectRunArticle(teamPoints: number): "a" | "an" {
  return teamPoints === 8 || teamPoints === 11 || teamPoints === 18 ? "an" : "a";
}

function formatPeriodLabel(quarter: number): string {
  switch (quarter) {
    case 1:
      return "the 1st quarter";
    case 2:
      return "the 2nd quarter";
    case 3:
      return "the 3rd quarter";
    case 4:
      return "the 4th quarter";
    case 5:
      return "overtime";
    default:
      return `${quarter - 4}OT`;
  }
}

export const __testing = {
  buildGameDayRecapPlayByPlayFacts,
  describeLateGameMoment,
  describeOpponentLastChance,
  summarizeEndingFacts,
  summarizeLateGameMoments,
};
