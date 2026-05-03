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
const EXTENDED_PUT_AWAY_RUN_MAX_ELAPSED_SECONDS = 780;
const EXTENDED_PUT_AWAY_RUN_MIN_TEAM_POINTS = 15;
const EXTENDED_PUT_AWAY_RUN_MIN_MARGIN = 10;
const EXTENDED_PUT_AWAY_RUN_MIN_NET_MARGIN = 10;
const EXTENDED_PUT_AWAY_RUN_MIN_FOLLOW_THROUGH_MARGIN = 6;
const SECONDARY_RUN_MARGIN_SWING_THRESHOLD = 8;
const SECONDARY_RUN_CLOSE_GAP_THRESHOLD = 2;
const SECONDARY_RUN_MIN_SECONDS_APART = 90;
const BIG_COMEBACK_LEAD_CHANGE_THRESHOLD = 8;
const RAPID_LEAD_CHANGE_BURST_MIN_COUNT = 4;
const RAPID_LEAD_CHANGE_WINDOW_SECONDS = 120;
const HIGH_VOLUME_LEAD_CHANGE_THRESHOLD = 10;
const SCORING_DROUGHT_MIN_OPPONENT_POINTS = 8;
const SCORING_DROUGHT_MIN_SECONDS = 120;
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
const OFFENSIVE_REBOUND_PATTERN =
  /\b(?:offensive rebound|offensive board|second-chance rebound|rebounds? (?:his|her|their|the) own miss|grabs? .* offensive board)\b/i;
const FOUL_OUT_PATTERN = /\b(?:fouls? out|fouled out|foul out|disqualified)\b/i;
const INJURY_PATTERN =
  /\b(?:injur(?:y|ed)|hurt|limped|left .* game|helped .* off|went down)\b/i;
const TECHNICAL_PATTERN = /\btechnical(?: foul)?\b/i;
const EJECTION_PATTERN = /\b(?:eject(?:ed|ion)|tossed)\b/i;

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

export type GameDayRecapPlayByPlayLeadForGood = {
  awayScore: number;
  clock: string | null;
  deficitErased: number;
  eventText: string | null;
  homeScore: number;
  previousLeaderSide: TeamSide | "tie";
  quarter: number;
  scoringTeamName: string | null;
  scoringTeamSide: TeamSide;
};

export type GameDayRecapPlayByPlayLastLead = {
  awayScore: number;
  clock: string | null;
  homeScore: number;
  leadingTeamName: string | null;
  leadingTeamSide: TeamSide;
  quarter: number;
  trailingTeamName: string | null;
  trailingTeamSide: TeamSide;
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

export type GameDayRecapPlayByPlayScoringDrought = {
  durationSeconds: number | null;
  endAwayScore: number;
  endClock: string | null;
  endHomeScore: number;
  endQuarter: number | null;
  opponentPointsDuringDrought: number;
  scoringTeamName: string | null;
  scoringTeamSide: TeamSide;
  scorelessTeamName: string | null;
  scorelessTeamSide: TeamSide;
  startAwayScore: number;
  startClock: string | null;
  startHomeScore: number;
  startQuarter: number | null;
};

export type GameDayRecapPlayByPlayPlayerScoringSpurt = {
  endAwayScore: number;
  endClock: string | null;
  endHomeScore: number;
  endQuarter: number | null;
  eventCount: number;
  playerName: string;
  points: number;
  startAwayScore: number;
  startClock: string | null;
  startHomeScore: number;
  startQuarter: number | null;
  teamName: string | null;
  teamSide: TeamSide;
};

export type GameDayRecapPlayByPlayMadeThreeBurst = {
  endClock: string | null;
  endQuarter: number | null;
  madeThrees: number;
  startClock: string | null;
  startQuarter: number | null;
  teamName: string | null;
  teamSide: TeamSide;
};

export type GameDayRecapPlayByPlayOffensiveReboundSequence = {
  endAwayScore: number;
  endClock: string | null;
  endHomeScore: number;
  endQuarter: number | null;
  offensiveRebounds: number;
  scoringEventText: string | null;
  startClock: string | null;
  startQuarter: number | null;
  teamName: string | null;
  teamSide: TeamSide;
};

export type GameDayRecapPlayByPlayExplicitEventFact = {
  clock: string | null;
  eventText: string;
  eventType: "ejection" | "foul_out" | "injury" | "technical";
  playerName: string | null;
  quarter: number | null;
  teamName: string | null;
  teamSide: TeamSide | null;
};

export type GameDayRecapPlayByPlayFacts = {
  bestCompetitiveSwingRun: GameDayRecapPlayByPlayRun;
  endingFacts: GameDayRecapPlayByPlayEndingFacts;
  explicitEventFacts?: GameDayRecapPlayByPlayExplicitEventFact[];
  lateGameMoments: GameDayRecapLateGameMoment[];
  largestLead: GameDayRecapPlayByPlayLargestLead;
  lastLeadByLoser?: GameDayRecapPlayByPlayLastLead | null;
  leadChangeCount: number;
  leadChangeFacts: GameDayRecapPlayByPlayLeadChangeFacts;
  longestUnansweredRun: GameDayRecapPlayByPlayRun;
  madeThreeBursts?: GameDayRecapPlayByPlayMadeThreeBurst[];
  offensiveReboundSequences?: GameDayRecapPlayByPlayOffensiveReboundSequence[];
  primaryRun: GameDayRecapPlayByPlayRun | null;
  playerScoringSpurts?: GameDayRecapPlayByPlayPlayerScoringSpurt[];
  scoringDroughts?: GameDayRecapPlayByPlayScoringDrought[];
  secondaryRun: GameDayRecapPlayByPlayRun | null;
  summaryLines: string[];
  tookLeadForGood?: GameDayRecapPlayByPlayLeadForGood | null;
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
  awayPlayers?: string[];
  awayTeamName?: string | null;
  homePlayers?: string[];
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
  sourceIsScoringPlay: boolean;
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

type RunStartAnchor = {
  awayScore: number;
  clock: string | null;
  gameSecondsElapsed: number | null;
  homeScore: number;
  quarter: number | null;
};

type ExpandedSwingRunWindow = {
  endEvent: EventContext & { scoringTeamSide: TeamSide };
  endedBy: RunEndedBy;
  startAnchor: RunStartAnchor;
  teamPoints: number;
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
  awayPlayers?: string[];
  awayTeamName?: string | null;
  fetchPublicMatchPlayByPlay?: typeof fetchPublicMatchPlayByPlay;
  homePlayers?: string[];
  homeTeamName?: string | null;
  matchId: string;
}): Promise<GameDayRecapPlayByPlayLoadResult> {
  const fetcher = args.fetchPublicMatchPlayByPlay ?? fetchPublicMatchPlayByPlay;

  try {
    const playByPlay = await fetcher(args.matchId);
    const detailedFacts = buildGameDayRecapPlayByPlayFactsDetailed(playByPlay, {
      awayPlayers: args.awayPlayers,
      awayTeamName: args.awayTeamName,
      homePlayers: args.homePlayers,
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
  const leadForGoodFacts =
    finalLeader === "tie"
      ? {
          lastLeadByLoser: null,
          tookLeadForGood: null,
        }
      : resolveLeadForGoodFacts(scoringEvents, finalLeader, teamNames);
  const largestLead = resolveLargestLead(scoringEvents, teamNames);
  const longestUnansweredRun = resolveLongestUnansweredRun(
    scoringEvents,
    teamNames,
  );
  const bestCompetitiveSwingRun = resolveBestCompetitiveSwingRun(
    scoringEvents,
    teamNames,
    scoreTimeline,
  );
  const { primaryRun, secondaryRun } = resolveImpactfulRuns(
    scoringEvents,
    teamNames,
    finalLeader === "tie" ? null : finalLeader,
    scoreTimeline,
  );
  const lateGameMoments = resolveLateGameMoments(scoringEvents, teamNames);
  const scoringDroughts = resolveScoringDroughts(scoringEvents, teamNames);
  const playerScoringSpurts = resolvePlayerScoringSpurts(
    scoringEvents,
    teamNames,
  );
  const madeThreeBursts = resolveMadeThreeBursts(scoringEvents, teamNames);
  const offensiveReboundSequences = resolveOffensiveReboundSequences(
    scoreTimeline,
    teamNames,
  );
  const explicitEventFacts = resolveExplicitEventFacts(scoreTimeline, teamNames);
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
      explicitEventFacts,
      lateGameMoments,
      largestLead,
      lastLeadByLoser: leadForGoodFacts.lastLeadByLoser,
      leadChangeCount,
      leadChangeFacts,
      longestUnansweredRun,
      madeThreeBursts,
      offensiveReboundSequences,
      primaryRun,
      playerScoringSpurts,
      scoringDroughts,
      secondaryRun,
      summaryLines,
      tookLeadForGood: leadForGoodFacts.tookLeadForGood,
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
      sourceIsScoringPlay: event.isScoringPlay ?? false,
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

function resolveLeadForGoodFacts(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  winnerSide: TeamSide,
  teamNames: TeamNameContext,
): {
  lastLeadByLoser: GameDayRecapPlayByPlayLastLead | null;
  tookLeadForGood: GameDayRecapPlayByPlayLeadForGood | null;
} {
  const loserSide = oppositeTeamSide(winnerSide);
  let lastLeadByLoser: GameDayRecapPlayByPlayLastLead | null = null;
  let tookLeadForGood: GameDayRecapPlayByPlayLeadForGood | null = null;
  const largestDeficitBySide: Record<TeamSide, number> = {
    away: 0,
    home: 0,
  };

  for (let index = 0; index < scoringEvents.length; index += 1) {
    const scoringEvent = scoringEvents[index]!;
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

    const beforeLeader = resolveLeader(
      scoringEvent.beforeHomeScore,
      scoringEvent.beforeAwayScore,
    );
    const afterLeader = resolveLeader(
      scoringEvent.afterHomeScore,
      scoringEvent.afterAwayScore,
    );

    if (afterLeader === loserSide) {
      lastLeadByLoser = {
        awayScore: scoringEvent.afterAwayScore,
        clock: scoringEvent.clock,
        homeScore: scoringEvent.afterHomeScore,
        leadingTeamName: resolveTeamName(loserSide, teamNames),
        leadingTeamSide: loserSide,
        quarter: scoringEvent.quarter,
        trailingTeamName: resolveTeamName(winnerSide, teamNames),
        trailingTeamSide: winnerSide,
      };
    }

    if (
      tookLeadForGood ||
      afterLeader !== winnerSide ||
      beforeLeader === winnerSide ||
      !winnerHeldLeadForRestOfGame(scoringEvents, index, winnerSide)
    ) {
      continue;
    }

    const previousLeaderSide =
      beforeLeader === "tie" && lastLeadByLoser ? loserSide : beforeLeader;

    tookLeadForGood = {
      awayScore: scoringEvent.afterAwayScore,
      clock: scoringEvent.clock,
      deficitErased:
        previousLeaderSide === loserSide
          ? largestDeficitBySide[winnerSide]
          : 0,
      eventText: scoringEvent.eventText,
      homeScore: scoringEvent.afterHomeScore,
      previousLeaderSide,
      quarter: scoringEvent.quarter,
      scoringTeamName: resolveTeamName(winnerSide, teamNames),
      scoringTeamSide: winnerSide,
    };
  }

  return {
    lastLeadByLoser,
    tookLeadForGood,
  };
}

function winnerHeldLeadForRestOfGame(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  startIndex: number,
  winnerSide: TeamSide,
): boolean {
  for (let index = startIndex + 1; index < scoringEvents.length; index += 1) {
    const leader = resolveLeader(
      scoringEvents[index]!.afterHomeScore,
      scoringEvents[index]!.afterAwayScore,
    );
    if (leader !== winnerSide) {
      return false;
    }
  }

  return true;
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
      startAnchor: resolveRunStartAnchor(scoringEvents, currentRunStartIndex),
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
  eventContexts: EventContext[],
): GameDayRecapPlayByPlayRun {
  let bestRun = createEmptyRunFact("swing");

  const candidates = collectSwingRunCandidates(scoringEvents, teamNames, eventContexts, {
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
  winnerSide: TeamSide | null,
  eventContexts: EventContext[],
): ResolvedImpactfulRuns {
  const candidates = [
    ...collectCompletedUnansweredRuns(scoringEvents, teamNames),
    ...collectSwingRunCandidates(scoringEvents, teamNames, eventContexts),
    ...collectExtendedLeadTakingSwingRunCandidates(
      scoringEvents,
      teamNames,
      eventContexts,
      winnerSide,
    ),
    ...collectExtendedPutAwaySwingRunCandidates(
      scoringEvents,
      teamNames,
      eventContexts,
      winnerSide,
    ),
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
        startAnchor: resolveRunStartAnchor(scoringEvents, currentRunStartIndex),
        teamNames,
        teamPoints: currentRunPoints,
        teamSide: currentRunSide,
      }),
    );
  }

  return runs;
}

function resolveScoringDroughts(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayScoringDrought[] {
  return collectCompletedUnansweredRuns(scoringEvents, teamNames)
    .filter((run) => {
      if (
        !run.teamSide ||
        run.teamPoints < SCORING_DROUGHT_MIN_OPPONENT_POINTS
      ) {
        return false;
      }
      const durationSeconds = resolveRunDurationSeconds(run);
      return (
        durationSeconds === null ||
        durationSeconds >= SCORING_DROUGHT_MIN_SECONDS
      );
    })
    .sort((left, right) => {
      if (right.teamPoints !== left.teamPoints) {
        return right.teamPoints - left.teamPoints;
      }
      const leftOrdering =
        left.startQuarter !== null
          ? resolveAnchorOrdering(left.startQuarter, left.startClock)
          : Number.POSITIVE_INFINITY;
      const rightOrdering =
        right.startQuarter !== null
          ? resolveAnchorOrdering(right.startQuarter, right.startClock)
          : Number.POSITIVE_INFINITY;
      return leftOrdering - rightOrdering;
    })
    .slice(0, 2)
    .map((run) => {
      const scoringTeamSide = run.teamSide ?? "home";
      const scorelessTeamSide = oppositeTeamSide(scoringTeamSide);
      return {
        durationSeconds: resolveRunDurationSeconds(run),
        endAwayScore: run.endAwayScore,
        endClock: run.endClock,
        endHomeScore: run.endHomeScore,
        endQuarter: run.endQuarter,
        opponentPointsDuringDrought: run.teamPoints,
        scoringTeamName: run.teamName,
        scoringTeamSide,
        scorelessTeamName: resolveTeamName(scorelessTeamSide, teamNames),
        scorelessTeamSide,
        startAwayScore: run.startAwayScore,
        startClock: run.startClock,
        startHomeScore: run.startHomeScore,
        startQuarter: run.startQuarter,
      };
    });
}

function collectSwingRunCandidates(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
  eventContexts: EventContext[],
  options?: {
    maxElapsedSeconds?: number;
    requireCompetitiveStart?: boolean;
  },
): GameDayRecapPlayByPlayRun[] {
  const candidates: GameDayRecapPlayByPlayRun[] = [];
  const maxElapsedSeconds =
    options?.maxElapsedSeconds ?? SWING_RUN_MAX_ELAPSED_SECONDS;

  for (let startIndex = 0; startIndex < scoringEvents.length; startIndex += 1) {
    const startEvent = scoringEvents[startIndex]!;
    const startAnchor = resolveSwingRunStartAnchor(eventContexts, startEvent);
    const startMargin = Math.abs(
      startAnchor.homeScore - startAnchor.awayScore,
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
      const elapsedSeconds = resolveRunElapsedSeconds(startAnchor, endEvent);
      if (
        combinedPoints > SWING_RUN_MAX_COMBINED_POINTS ||
        (elapsedSeconds !== null && elapsedSeconds > maxElapsedSeconds)
      ) {
        break;
      }

      teamPoints = nextTeamPoints;
      opponentPoints = nextOpponentPoints;
      if (opponentPoints === 0) {
        continue;
      }

      const nextScoringEvent = scoringEvents[endIndex + 1] ?? null;
      const baseRun = buildRunFact({
        endEvent,
        endedBy: !nextScoringEvent
          ? "game_end"
          : nextScoringEvent.scoringTeamSide !== teamSide
            ? "opponent_answer"
            : "unknown",
        opponentPoints,
        runType: "swing",
        startAnchor,
        teamNames,
        teamPoints,
        teamSide,
      });
      if (!isQualifiedSwingRun(baseRun)) {
        candidates.push(baseRun);
        continue;
      }

      const expandedRun = expandSwingRunWindowOverAdjacentScoring({
        endIndex,
        eventContexts,
        scoringEvents,
        startIndex,
        teamPoints,
        teamSide,
      });
      candidates.push(
        buildRunFact({
          endEvent: expandedRun.endEvent,
          endedBy: expandedRun.endedBy,
          opponentPoints,
          runType: "swing",
          startAnchor: expandedRun.startAnchor,
          teamNames,
          teamPoints: expandedRun.teamPoints,
          teamSide,
        }),
      );
    }
  }

  return candidates;
}

function collectExtendedPutAwaySwingRunCandidates(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
  eventContexts: EventContext[],
  winnerSide: TeamSide | null,
): GameDayRecapPlayByPlayRun[] {
  if (!winnerSide) {
    return [];
  }

  const finalMargin = resolveFinalMarginFromTeamPerspective(scoringEvents, winnerSide);
  const extendedCandidates = collectSwingRunCandidates(
    scoringEvents,
    teamNames,
    eventContexts,
    {
      maxElapsedSeconds: EXTENDED_PUT_AWAY_RUN_MAX_ELAPSED_SECONDS,
      requireCompetitiveStart: true,
    },
  );

  return extendedCandidates.filter((candidate) =>
    isQualifiedExtendedPutAwayRun(
      candidate,
      scoringEvents,
      winnerSide,
      finalMargin,
    ),
  );
}

function collectExtendedLeadTakingSwingRunCandidates(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
  eventContexts: EventContext[],
  winnerSide: TeamSide | null,
): GameDayRecapPlayByPlayRun[] {
  if (!winnerSide) {
    return [];
  }

  const extendedCandidates = collectSwingRunCandidates(
    scoringEvents,
    teamNames,
    eventContexts,
    {
      maxElapsedSeconds: EXTENDED_PUT_AWAY_RUN_MAX_ELAPSED_SECONDS,
      requireCompetitiveStart: true,
    },
  );

  return extendedCandidates.filter((candidate) =>
    isQualifiedExtendedLeadTakingRun(candidate, winnerSide),
  );
}

function expandSwingRunWindowOverAdjacentScoring(args: {
  endIndex: number;
  eventContexts: EventContext[];
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>;
  startIndex: number;
  teamPoints: number;
  teamSide: TeamSide;
}): ExpandedSwingRunWindow {
  let expandedStartIndex = args.startIndex;
  let expandedEndIndex = args.endIndex;
  let expandedTeamPoints = args.teamPoints;

  while (expandedStartIndex > 0) {
    const previousScoringEvent = args.scoringEvents[expandedStartIndex - 1]!;
    const currentStartEvent = args.scoringEvents[expandedStartIndex]!;
    if (
      previousScoringEvent.scoringTeamSide !== args.teamSide ||
      currentStartEvent.rawIndex - previousScoringEvent.rawIndex !== 1
    ) {
      break;
    }

    expandedStartIndex -= 1;
    expandedTeamPoints += previousScoringEvent.points;
  }

  while (expandedEndIndex + 1 < args.scoringEvents.length) {
    const currentEndEvent = args.scoringEvents[expandedEndIndex]!;
    const nextScoringEvent = args.scoringEvents[expandedEndIndex + 1]!;
    if (
      nextScoringEvent.scoringTeamSide !== args.teamSide ||
      nextScoringEvent.rawIndex - currentEndEvent.rawIndex !== 1
    ) {
      break;
    }

    expandedEndIndex += 1;
    expandedTeamPoints += nextScoringEvent.points;
  }

  const nextScoringEvent = args.scoringEvents[expandedEndIndex + 1] ?? null;
  return {
    endEvent: args.scoringEvents[expandedEndIndex]!,
    endedBy: !nextScoringEvent
      ? "game_end"
      : nextScoringEvent.scoringTeamSide !== args.teamSide
        ? "opponent_answer"
        : "unknown",
    startAnchor: resolveSwingRunStartAnchor(
      args.eventContexts,
      args.scoringEvents[expandedStartIndex]!,
    ),
    teamPoints: expandedTeamPoints,
  };
}

function resolveRunStartAnchor(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  startIndex: number,
): RunStartAnchor {
  const startEvent = scoringEvents[startIndex]!;
  const previousScoringEvent = scoringEvents[startIndex - 1] ?? null;
  if (
    previousScoringEvent &&
    previousScoringEvent.afterAwayScore === startEvent.beforeAwayScore &&
    previousScoringEvent.afterHomeScore === startEvent.beforeHomeScore
  ) {
    return {
      awayScore: previousScoringEvent.afterAwayScore,
      clock: previousScoringEvent.clock,
      gameSecondsElapsed: previousScoringEvent.gameSecondsElapsed,
      homeScore: previousScoringEvent.afterHomeScore,
      quarter: previousScoringEvent.quarter,
    };
  }

  return {
    awayScore: startEvent.beforeAwayScore,
    clock: startEvent.clock,
    gameSecondsElapsed: startEvent.gameSecondsElapsed,
    homeScore: startEvent.beforeHomeScore,
    quarter: startEvent.quarter,
  };
}

function resolveSwingRunStartAnchor(
  eventContexts: EventContext[],
  startEvent: EventContext,
): RunStartAnchor {
  const previousEvent = eventContexts[startEvent.rawIndex - 1] ?? null;
  if (
    previousEvent?.sourceIsScoringPlay &&
    previousEvent.afterAwayScore === startEvent.beforeAwayScore &&
    previousEvent.afterHomeScore === startEvent.beforeHomeScore
  ) {
    return {
      awayScore: previousEvent.afterAwayScore,
      clock: previousEvent.clock,
      gameSecondsElapsed: previousEvent.gameSecondsElapsed,
      homeScore: previousEvent.afterHomeScore,
      quarter: previousEvent.quarter,
    };
  }

  return {
    awayScore: startEvent.beforeAwayScore,
    clock: startEvent.clock,
    gameSecondsElapsed: startEvent.gameSecondsElapsed,
    homeScore: startEvent.beforeHomeScore,
    quarter: startEvent.quarter,
  };
}

function resolveRunElapsedSeconds(
  startAnchor: RunStartAnchor,
  endEvent: EventContext,
): number | null {
  const startSeconds =
    startAnchor.gameSecondsElapsed ??
    (startAnchor.quarter !== null && startAnchor.quarter > 0
      ? resolveAnchorOrdering(startAnchor.quarter, startAnchor.clock)
      : null);
  const endSeconds =
    endEvent.gameSecondsElapsed ??
    (endEvent.quarter > 0 ? resolveAnchorOrdering(endEvent.quarter, endEvent.clock) : null);
  if (startSeconds === null || endSeconds === null) {
    return null;
  }

  return Math.max(0, endSeconds - startSeconds);
}

function resolveRunDurationSeconds(run: GameDayRecapPlayByPlayRun): number | null {
  const interval = resolveRunInterval(run);
  if (!interval) {
    return null;
  }

  return Math.max(0, interval.end - interval.start);
}

function buildRunFact(args: {
  endEvent: EventContext;
  endedBy: RunEndedBy;
  opponentPoints: number;
  runType: RunType;
  startAnchor: RunStartAnchor;
  teamNames: TeamNameContext;
  teamPoints: number;
  teamSide: TeamSide;
}): GameDayRecapPlayByPlayRun {
  const teamStartScore =
    args.teamSide === "home"
      ? args.startAnchor.homeScore
      : args.startAnchor.awayScore;
  const opponentStartScore =
    args.teamSide === "home"
      ? args.startAnchor.awayScore
      : args.startAnchor.homeScore;
  const teamEndScore =
    args.teamSide === "home"
      ? args.endEvent.afterHomeScore
      : args.endEvent.afterAwayScore;
  const opponentEndScore =
    args.teamSide === "home"
      ? args.endEvent.afterAwayScore
      : args.endEvent.afterHomeScore;
  const displayedTeamPoints = Math.max(0, teamEndScore - teamStartScore);
  const displayedOpponentPoints = Math.max(
    0,
    opponentEndScore - opponentStartScore,
  );
  const startMarginFromTeamPerspective =
    args.teamSide === "home"
      ? args.startAnchor.homeScore - args.startAnchor.awayScore
      : args.startAnchor.awayScore - args.startAnchor.homeScore;
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
    netMargin: displayedTeamPoints - displayedOpponentPoints,
    opponentPoints: displayedOpponentPoints,
    runType: args.runType,
    startAwayScore: args.startAnchor.awayScore,
    startClock: args.startAnchor.clock,
    startMarginFromTeamPerspective,
    startHomeScore: args.startAnchor.homeScore,
    startQuarter: args.startAnchor.quarter,
    teamName: resolveTeamName(args.teamSide, args.teamNames),
    teamPoints: displayedTeamPoints,
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

function isQualifiedExtendedPutAwayRun(
  candidate: GameDayRecapPlayByPlayRun,
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  winnerSide: TeamSide,
  finalMargin: number,
): boolean {
  if (candidate.teamSide !== winnerSide || !isQualifiedSwingRun(candidate)) {
    return false;
  }

  const durationSeconds = resolveRunDurationSeconds(candidate);
  if (
    durationSeconds === null ||
    durationSeconds <= SWING_RUN_MAX_ELAPSED_SECONDS ||
    durationSeconds > EXTENDED_PUT_AWAY_RUN_MAX_ELAPSED_SECONDS
  ) {
    return false;
  }

  if (
    candidate.endQuarter === null ||
    candidate.endQuarter < 4 ||
    candidate.teamPoints < EXTENDED_PUT_AWAY_RUN_MIN_TEAM_POINTS ||
    candidate.netMargin < EXTENDED_PUT_AWAY_RUN_MIN_NET_MARGIN ||
    candidate.endMarginFromTeamPerspective < EXTENDED_PUT_AWAY_RUN_MIN_MARGIN ||
    candidate.endMarginFromTeamPerspective < finalMargin
  ) {
    return false;
  }

  const minimumMarginAfterRun = resolveMinimumMarginAfterRun(
    candidate,
    scoringEvents,
    winnerSide,
  );
  return (
    minimumMarginAfterRun !== null &&
    minimumMarginAfterRun >= EXTENDED_PUT_AWAY_RUN_MIN_FOLLOW_THROUGH_MARGIN
  );
}

function isQualifiedExtendedLeadTakingRun(
  candidate: GameDayRecapPlayByPlayRun,
  winnerSide: TeamSide,
): boolean {
  if (candidate.teamSide !== winnerSide || !isQualifiedSwingRun(candidate)) {
    return false;
  }

  const durationSeconds = resolveRunDurationSeconds(candidate);
  if (
    durationSeconds === null ||
    durationSeconds <= SWING_RUN_MAX_ELAPSED_SECONDS ||
    durationSeconds > EXTENDED_PUT_AWAY_RUN_MAX_ELAPSED_SECONDS
  ) {
    return false;
  }

  return Boolean(
    candidate.startQuarter !== null &&
      candidate.endQuarter !== null &&
      candidate.startQuarter !== candidate.endQuarter &&
    candidate.startMarginFromTeamPerspective <= 0 &&
      candidate.endMarginFromTeamPerspective > 0 &&
      (candidate.endMarginFromTeamPerspective >= 4 || candidate.netMargin >= 6),
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
  const leadTakingSwing =
    candidate.teamSide === primaryRun.teamSide &&
    candidate.startMarginFromTeamPerspective <= 0 &&
    candidate.endMarginFromTeamPerspective > 0 &&
    (candidate.endMarginFromTeamPerspective >= 4 || candidate.netMargin >= 6);
  const materiallyStrong =
    leadTakingSwing ||
    candidate.marginSwing >= SECONDARY_RUN_MARGIN_SWING_THRESHOLD ||
    candidate.marginSwing >=
      primaryRun.marginSwing - SECONDARY_RUN_CLOSE_GAP_THRESHOLD;

  return materiallyStrong && separatedInTime && !runsOverlap(candidate, primaryRun);
}

function runsOverlap(
  left: GameDayRecapPlayByPlayRun,
  right: GameDayRecapPlayByPlayRun,
): boolean {
  const leftInterval = resolveRunInterval(left);
  const rightInterval = resolveRunInterval(right);
  if (!leftInterval || !rightInterval) {
    return false;
  }

  return leftInterval.start < rightInterval.end && rightInterval.start < leftInterval.end;
}

function resolveRunInterval(
  run: GameDayRecapPlayByPlayRun,
): { end: number; start: number } | null {
  if (
    run.startQuarter === null ||
    !run.startClock ||
    run.endQuarter === null ||
    !run.endClock
  ) {
    return null;
  }

  const start = resolveAnchorOrdering(run.startQuarter, run.startClock);
  const end = resolveAnchorOrdering(run.endQuarter, run.endClock);
  return {
    end: Math.max(start, end),
    start: Math.min(start, end),
  };
}

function resolveFinalMarginFromTeamPerspective(
  scoringEvents: EventContext[],
  teamSide: TeamSide,
): number {
  const finalEvent = scoringEvents.at(-1);
  if (!finalEvent) {
    return 0;
  }

  return teamSide === "home"
    ? finalEvent.afterHomeScore - finalEvent.afterAwayScore
    : finalEvent.afterAwayScore - finalEvent.afterHomeScore;
}

function resolveMinimumMarginAfterRun(
  run: GameDayRecapPlayByPlayRun,
  scoringEvents: EventContext[],
  teamSide: TeamSide,
): number | null {
  const runEndIndex = scoringEvents.findIndex(
    (event) =>
      event.quarter === run.endQuarter &&
      event.clock === run.endClock &&
      event.afterHomeScore === run.endHomeScore &&
      event.afterAwayScore === run.endAwayScore,
  );
  if (runEndIndex === -1) {
    return null;
  }

  let minimumMargin = run.endMarginFromTeamPerspective;
  for (let index = runEndIndex + 1; index < scoringEvents.length; index += 1) {
    const event = scoringEvents[index]!;
    const margin =
      teamSide === "home"
        ? event.afterHomeScore - event.afterAwayScore
        : event.afterAwayScore - event.afterHomeScore;
    minimumMargin = Math.min(minimumMargin, margin);
  }

  return minimumMargin;
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
    isGameEndingPeriod(scoringEvent.quarter) &&
    beforeLeader !== winnerSide &&
    !laterScoringExists &&
    parseClockToRemainingSeconds(scoringEvent.clock) === 0;
  if (
    isGameEndingPeriod(scoringEvent.quarter) &&
    (explicitBuzzerBeater || isWalkOffGoAhead)
  ) {
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

function isGameEndingPeriod(quarter: number): boolean {
  return quarter >= 4;
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
    isGameEndingPeriod(scoringEvent.quarter) &&
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
      isGameEndingPeriod(scoringEvent.quarter) &&
      (explicitBuzzerBeater || (isWalkOff && momentType === "go_ahead")),
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

function resolvePlayerScoringSpurts(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayPlayerScoringSpurt[] {
  type ActiveSpurt = {
    endEvent: EventContext & { scoringTeamSide: TeamSide };
    eventCount: number;
    playerName: string;
    points: number;
    startEvent: EventContext & { scoringTeamSide: TeamSide };
    teamSide: TeamSide;
  };

  const spurts: ActiveSpurt[] = [];
  const activeByTeam: Partial<Record<TeamSide, ActiveSpurt>> = {};
  const finalize = (teamSide: TeamSide) => {
    const active = activeByTeam[teamSide];
    if (!active) {
      return;
    }
    if (active.points >= 8 || (active.points >= 6 && active.eventCount >= 3)) {
      spurts.push(active);
    }
    delete activeByTeam[teamSide];
  };

  for (const event of scoringEvents) {
    const playerName = resolveNamedBoxScorePlayer(event, teamNames, {
      teamSide: event.scoringTeamSide,
    });
    const active = activeByTeam[event.scoringTeamSide];

    if (!playerName) {
      finalize(event.scoringTeamSide);
      continue;
    }

    if (active?.playerName === playerName) {
      active.endEvent = event;
      active.eventCount += 1;
      active.points += event.points;
      continue;
    }

    finalize(event.scoringTeamSide);
    activeByTeam[event.scoringTeamSide] = {
      endEvent: event,
      eventCount: 1,
      playerName,
      points: event.points,
      startEvent: event,
      teamSide: event.scoringTeamSide,
    };
  }

  finalize("away");
  finalize("home");

  return spurts
    .map((spurt) => ({
      endAwayScore: spurt.endEvent.afterAwayScore,
      endClock: spurt.endEvent.clock,
      endHomeScore: spurt.endEvent.afterHomeScore,
      endQuarter: spurt.endEvent.quarter,
      eventCount: spurt.eventCount,
      playerName: spurt.playerName,
      points: spurt.points,
      startAwayScore: spurt.startEvent.beforeAwayScore,
      startClock: spurt.startEvent.clock,
      startHomeScore: spurt.startEvent.beforeHomeScore,
      startQuarter: spurt.startEvent.quarter,
      teamName: resolveTeamName(spurt.teamSide, teamNames),
      teamSide: spurt.teamSide,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.eventCount - left.eventCount ||
        resolveNullableAnchorOrdering(left.startQuarter, left.startClock) -
          resolveNullableAnchorOrdering(right.startQuarter, right.startClock),
    )
    .slice(0, 3);
}

function resolveMadeThreeBursts(
  scoringEvents: Array<EventContext & { scoringTeamSide: TeamSide }>,
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayMadeThreeBurst[] {
  type ActiveBurst = {
    endEvent: EventContext & { scoringTeamSide: TeamSide };
    madeThrees: number;
    startEvent: EventContext & { scoringTeamSide: TeamSide };
    teamSide: TeamSide;
  };

  const bursts: ActiveBurst[] = [];
  const activeByTeam: Partial<Record<TeamSide, ActiveBurst>> = {};
  const finalize = (teamSide: TeamSide) => {
    const active = activeByTeam[teamSide];
    if (active && active.madeThrees >= 3) {
      bursts.push(active);
    }
    delete activeByTeam[teamSide];
  };

  for (const event of scoringEvents) {
    if (!isMadeThreeScoringEvent(event)) {
      finalize(event.scoringTeamSide);
      continue;
    }

    const active = activeByTeam[event.scoringTeamSide];
    if (active) {
      active.endEvent = event;
      active.madeThrees += 1;
      continue;
    }

    activeByTeam[event.scoringTeamSide] = {
      endEvent: event,
      madeThrees: 1,
      startEvent: event,
      teamSide: event.scoringTeamSide,
    };
  }

  finalize("away");
  finalize("home");

  return bursts
    .map((burst) => ({
      endClock: burst.endEvent.clock,
      endQuarter: burst.endEvent.quarter,
      madeThrees: burst.madeThrees,
      startClock: burst.startEvent.clock,
      startQuarter: burst.startEvent.quarter,
      teamName: resolveTeamName(burst.teamSide, teamNames),
      teamSide: burst.teamSide,
    }))
    .sort(
      (left, right) =>
        right.madeThrees - left.madeThrees ||
        resolveNullableAnchorOrdering(left.startQuarter, left.startClock) -
          resolveNullableAnchorOrdering(right.startQuarter, right.startClock),
    )
    .slice(0, 3);
}

function resolveOffensiveReboundSequences(
  eventContexts: EventContext[],
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayOffensiveReboundSequence[] {
  type ActiveSequence = {
    offensiveRebounds: number;
    startEvent: EventContext;
    teamSide: TeamSide;
  };

  const sequences: GameDayRecapPlayByPlayOffensiveReboundSequence[] = [];
  const activeByTeam: Partial<Record<TeamSide, ActiveSequence>> = {};

  for (const event of eventContexts) {
    if (isOffensiveReboundEvent(event) && event.actingTeamSide) {
      const active = activeByTeam[event.actingTeamSide];
      if (active) {
        active.offensiveRebounds += 1;
      } else {
        activeByTeam[event.actingTeamSide] = {
          offensiveRebounds: 1,
          startEvent: event,
          teamSide: event.actingTeamSide,
        };
      }
      continue;
    }

    if (isScoringEvent(event)) {
      const active = activeByTeam[event.scoringTeamSide];
      if (active && active.offensiveRebounds >= 2) {
        sequences.push({
          endAwayScore: event.afterAwayScore,
          endClock: event.clock,
          endHomeScore: event.afterHomeScore,
          endQuarter: event.quarter,
          offensiveRebounds: active.offensiveRebounds,
          scoringEventText: event.eventText,
          startClock: active.startEvent.clock,
          startQuarter: active.startEvent.quarter,
          teamName: resolveTeamName(event.scoringTeamSide, teamNames),
          teamSide: event.scoringTeamSide,
        });
      }
      delete activeByTeam.away;
      delete activeByTeam.home;
      continue;
    }

    if (event.actingTeamSide) {
      delete activeByTeam[oppositeTeamSide(event.actingTeamSide)];
    }
  }

  return sequences
    .sort(
      (left, right) =>
        right.offensiveRebounds - left.offensiveRebounds ||
        resolveNullableAnchorOrdering(left.startQuarter, left.startClock) -
          resolveNullableAnchorOrdering(right.startQuarter, right.startClock),
    )
    .slice(0, 3);
}

function resolveExplicitEventFacts(
  eventContexts: EventContext[],
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayExplicitEventFact[] {
  const facts: GameDayRecapPlayByPlayExplicitEventFact[] = [];

  for (const event of eventContexts) {
    const eventText = event.eventText?.trim();
    if (!eventText) {
      continue;
    }

    const eventType = explicitEventTypeForText(eventText, event.eventType);
    if (!eventType) {
      continue;
    }

    const teamSide = event.actingTeamSide ?? event.scoringTeamSide ?? null;
    facts.push({
      clock: event.clock,
      eventText,
      eventType,
      playerName: resolveNamedBoxScorePlayer(event, teamNames, {
        teamSide: teamSide ?? undefined,
      }),
      quarter: event.quarter,
      teamName: teamSide ? resolveTeamName(teamSide, teamNames) : null,
      teamSide,
    });
  }

  return facts.slice(0, 5);
}

function isMadeThreeScoringEvent(
  event: EventContext & { scoringTeamSide: TeamSide },
): boolean {
  const eventText = event.eventText ?? "";
  const eventType = event.eventType ?? "";
  return (
    event.points === 3 &&
    (THREE_POINT_ATTEMPT_PATTERN.test(eventText) ||
      /\b(?:three|3pt|3_point|three_pointer|made_three)\b/i.test(eventType))
  );
}

function isOffensiveReboundEvent(event: EventContext): boolean {
  return (
    OFFENSIVE_REBOUND_PATTERN.test(event.eventText ?? "") ||
    /\boffensive[_ -]?rebound\b/i.test(event.eventType ?? "")
  );
}

function explicitEventTypeForText(
  eventText: string,
  eventType: string | null,
): GameDayRecapPlayByPlayExplicitEventFact["eventType"] | null {
  const combined = `${eventText} ${eventType ?? ""}`;
  if (EJECTION_PATTERN.test(combined)) {
    return "ejection";
  }
  if (FOUL_OUT_PATTERN.test(combined)) {
    return "foul_out";
  }
  if (INJURY_PATTERN.test(combined)) {
    return "injury";
  }
  if (TECHNICAL_PATTERN.test(combined)) {
    return "technical";
  }
  return null;
}

function resolveNamedBoxScorePlayer(
  event: Pick<EventContext, "eventText">,
  teamNames: TeamNameContext,
  options: {
    teamSide?: TeamSide;
  } = {},
): string | null {
  const eventText = normalizePlayerNameForMatching(event.eventText ?? "");
  if (!eventText) {
    return null;
  }

  const sides: TeamSide[] = options.teamSide
    ? [options.teamSide]
    : ["away", "home"];
  const matches = sides.flatMap((teamSide) =>
    playerNamesForSide(teamNames, teamSide).filter((playerName) =>
      playerAliasesForMatching(playerName).some((alias) =>
        ` ${eventText} `.includes(` ${alias} `),
      ),
    ),
  );
  const uniqueMatches = Array.from(new Set(matches));
  return uniqueMatches.length === 1 ? uniqueMatches[0]! : null;
}

function playerNamesForSide(
  teamNames: TeamNameContext,
  teamSide: TeamSide,
): string[] {
  return teamSide === "home"
    ? (teamNames.homePlayers ?? [])
    : (teamNames.awayPlayers ?? []);
}

function playerAliasesForMatching(playerName: string): string[] {
  const normalized = normalizePlayerNameForMatching(playerName);
  const parts = normalized.split(" ").filter(Boolean);
  const lastName = parts.at(-1);
  const firstName = parts[0];
  return Array.from(
    new Set(
      [
        normalized,
        firstName && lastName ? `${firstName.slice(0, 1)} ${lastName}` : null,
      ].filter((alias): alias is string => Boolean(alias && alias.length >= 3)),
    ),
  );
}

function normalizePlayerNameForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveNullableAnchorOrdering(
  quarter: number | null,
  clock: string | null,
): number {
  return quarter === null
    ? Number.POSITIVE_INFINITY
    : resolveAnchorOrdering(quarter, clock);
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
  const combinedComebackEndingSummary = summarizeCombinedComebackEndingFacts({
    endingFacts: args.endingFacts,
    leadChangeFacts: args.leadChangeFacts,
  });
  const endingSummary =
    combinedComebackEndingSummary ?? summarizeEndingFacts(args.endingFacts);
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

  const leadChangeSummary = combinedComebackEndingSummary
    ? null
    : summarizeLeadChangeFacts(args.leadChangeFacts);
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

  const orderedRuns = [args.primaryRun, args.secondaryRun]
    .filter((run): run is GameDayRecapPlayByPlayRun => Boolean(run?.teamSide))
    .sort((left, right) => {
      const leftOrdering =
        left.startQuarter !== null
          ? resolveAnchorOrdering(left.startQuarter, left.startClock)
          : Number.POSITIVE_INFINITY;
      const rightOrdering =
        right.startQuarter !== null
          ? resolveAnchorOrdering(right.startQuarter, right.startClock)
          : Number.POSITIVE_INFINITY;
      return leftOrdering - rightOrdering;
    });

  for (const run of orderedRuns) {
    const runSummary = summarizeRun(run, args.winnerSide);
    if (runSummary) {
      lines.push(runSummary);
    }
  }

  return uniqueSummaryLines(lines).slice(0, 5);
}

function summarizeCombinedComebackEndingFacts(args: {
  endingFacts: GameDayRecapPlayByPlayEndingFacts;
  leadChangeFacts: GameDayRecapPlayByPlayLeadChangeFacts;
}): string | null {
  const leadChange = args.leadChangeFacts.bigComebackLeadChange;
  const decisiveScore = args.endingFacts.decisiveScore;
  if (
    !leadChange ||
    !decisiveScore ||
    decisiveScore.momentType !== "lead_extension" ||
    !isSameComebackClosingSequence(leadChange, decisiveScore)
  ) {
    return null;
  }

  const teamName =
    leadChange.scoringTeamName ?? resolveTeamLabel(leadChange.scoringTeamSide);
  const periodLabel = formatPeriodLabel(leadChange.quarter);
  const leadContext = `${teamName} erased a ${leadChange.deficitErased}-point deficit and took the lead for good ${formatClockContext(
    leadChange.clock,
    periodLabel,
  )}`;
  const opponentLastChance = args.endingFacts.opponentLastChance;
  if (opponentLastChance) {
    return `Closing sequence: ${leadContext}; ${describeOpponentLastChance(opponentLastChance)}.`;
  }

  return `Closing sequence: ${leadContext}.`;
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
  const startedTrailing = run.startMarginFromTeamPerspective < 0;
  const startedTied = run.startMarginFromTeamPerspective === 0;
  const builtLead = run.endMarginFromTeamPerspective > run.startMarginFromTeamPerspective;

  if (isWinnerRun) {
    if (
      run.endedBy === "game_end" &&
      (run.endMarginFromTeamPerspective >= 8 || run.netMargin >= 10)
    ) {
      return `${teamName} used ${standardRunPhrase} ${timeRange} to put the game away.`;
    }
    if (run.marginSwing >= 8 || run.endMarginFromTeamPerspective >= 6) {
      if (startedTrailing) {
        return `${teamName} answered with ${standardRunPhrase} ${timeRange} to swing the game.`;
      }
      return `${teamName} used ${standardRunPhrase} ${timeRange} to seize control.`;
    }
    if (run.marginSwing >= 4) {
      if (startedTrailing) {
        return `${teamName} answered with ${standardRunPhrase} ${timeRange} to swing momentum.`;
      }
      return `${teamName} used ${standardRunPhrase} ${timeRange} to swing momentum.`;
    }

    return `${teamName} pieced together ${briefRunPhrase} ${timeRange}.`;
  }

  if (startedTrailing) {
    if (run.marginSwing >= 10) {
      return `${teamName} mounted ${standardRunPhrase} ${timeRange}, but it was not enough.`;
    }
    if (run.marginSwing >= 6) {
      return `${teamName} made a push with ${standardRunPhrase} ${timeRange}, but it was not enough.`;
    }

    return `${teamName} made ${briefRunPhrase} ${timeRange}, but it was not enough.`;
  }

  if (startedTied) {
    if (builtLead) {
      return `${teamName} used ${standardRunPhrase} ${timeRange} to open the lead.`;
    }

    return `${teamName} pieced together ${briefRunPhrase} ${timeRange}.`;
  }

  if (builtLead) {
    return `${teamName} used ${standardRunPhrase} ${timeRange} to build the lead.`;
  }

  return `${teamName} pieced together ${briefRunPhrase} ${timeRange} while staying in front.`;
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

function oppositeTeamSide(teamSide: TeamSide): TeamSide {
  return teamSide === "home" ? "away" : "home";
}

function resolveTeamLabel(teamSide: TeamSide): string {
  return teamSide === "home" ? "The home team" : "The away team";
}

function isSameComebackClosingSequence(
  leadChange: GameDayRecapPlayByPlayLeadChange,
  decisiveScore: GameDayRecapPlayByPlayDecisiveScore,
): boolean {
  return (
    decisiveScore.scoringTeamSide === leadChange.scoringTeamSide &&
    decisiveScore.quarter === leadChange.quarter &&
    decisiveScore.clock === leadChange.clock
  );
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
  isSupportedSecondaryRunCandidate,
  summarizeCombinedComebackEndingFacts,
  summarizeEndingFacts,
  summarizeLateGameMoments,
  summarizeRun,
};
