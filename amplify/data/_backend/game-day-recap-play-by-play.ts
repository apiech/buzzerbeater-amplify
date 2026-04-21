import {
  BBPublicPlayByPlayFetchError,
  BBPublicPlayByPlayParseError,
  fetchPublicMatchPlayByPlay,
  type PublicMatchPlayByPlay,
  type PublicMatchPlayByPlayEvent,
} from "../../../lib/bbapi";

const COMEBACK_SUMMARY_THRESHOLD = 8;
const UNANSWERED_RUN_SUMMARY_THRESHOLD = 8;
const LATE_GAME_WINDOW_SECONDS = 120;

type TeamSide = "away" | "home";

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
  points: number;
  teamName: string | null;
  teamSide: TeamSide | null;
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

export type GameDayRecapPlayByPlayFacts = {
  lateGameMoments: GameDayRecapLateGameMoment[];
  largestLead: GameDayRecapPlayByPlayLargestLead;
  leadChangeCount: number;
  longestUnansweredRun: GameDayRecapPlayByPlayRun;
  summaryLines: string[];
  winnerComebackDeficit: number | null;
};

export type GameDayRecapPlayByPlayLoadResult = {
  error: GameDayRecapPlayByPlayLoadError | null;
  facts: GameDayRecapPlayByPlayFacts | null;
};

type TeamNameContext = {
  awayTeamName?: string | null;
  homeTeamName?: string | null;
};

type ScoringEvent = {
  afterAwayScore: number;
  afterHomeScore: number;
  beforeAwayScore: number;
  beforeHomeScore: number;
  clock: string | null;
  eventText: string | null;
  points: number;
  quarter: number;
  scoringTeamSide: TeamSide;
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
    return {
      error: null,
      facts: buildGameDayRecapPlayByPlayFacts(playByPlay, {
        awayTeamName: args.awayTeamName,
        homeTeamName: args.homeTeamName,
      }),
    };
  } catch (error) {
    if (error instanceof BBPublicPlayByPlayFetchError) {
      return {
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
  const scoringEvents = buildScoringEvents(playByPlay.events);
  const finalLeader = resolveLeader(
    resolveFinalHomeScore(playByPlay.events),
    resolveFinalAwayScore(playByPlay.events),
  );
  const winnerComebackDeficit =
    finalLeader === "tie"
      ? null
      : resolveWinnerComebackDeficit(scoringEvents, finalLeader);
  const leadChangeCount = resolveLeadChangeCount(scoringEvents);
  const largestLead = resolveLargestLead(scoringEvents, teamNames);
  const longestUnansweredRun = resolveLongestUnansweredRun(
    scoringEvents,
    teamNames,
  );
  const lateGameMoments = resolveLateGameMoments(scoringEvents, teamNames);
  const summaryLines = buildSummaryLines({
    lateGameMoments,
    longestUnansweredRun,
    winnerComebackDeficit,
    winnerSide: finalLeader === "tie" ? null : finalLeader,
    ...teamNames,
  });

  return {
    lateGameMoments,
    largestLead,
    leadChangeCount,
    longestUnansweredRun,
    summaryLines,
    winnerComebackDeficit,
  };
}

function buildScoringEvents(
  events: PublicMatchPlayByPlayEvent[],
): ScoringEvent[] {
  let previousHomeScore = 0;
  let previousAwayScore = 0;
  const scoringEvents: ScoringEvent[] = [];

  for (const event of events) {
    const beforeHomeScore = previousHomeScore;
    const beforeAwayScore = previousAwayScore;
    const afterHomeScore = event.homeScore;
    const afterAwayScore = event.awayScore;
    const homeDelta = afterHomeScore - beforeHomeScore;
    const awayDelta = afterAwayScore - beforeAwayScore;

    previousHomeScore = afterHomeScore;
    previousAwayScore = afterAwayScore;

    if (!event.isScoringPlay) {
      continue;
    }

    if (homeDelta > 0 && awayDelta <= 0) {
      scoringEvents.push({
        afterAwayScore,
        afterHomeScore,
        beforeAwayScore,
        beforeHomeScore,
        clock: event.clock ?? null,
        eventText: event.eventText ?? null,
        points: homeDelta,
        quarter: event.quarter,
        scoringTeamSide: "home",
      });
      continue;
    }

    if (awayDelta > 0 && homeDelta <= 0) {
      scoringEvents.push({
        afterAwayScore,
        afterHomeScore,
        beforeAwayScore,
        beforeHomeScore,
        clock: event.clock ?? null,
        eventText: event.eventText ?? null,
        points: awayDelta,
        quarter: event.quarter,
        scoringTeamSide: "away",
      });
    }
  }

  return scoringEvents;
}

function resolveLeadChangeCount(scoringEvents: ScoringEvent[]): number {
  let leadChangeCount = 0;
  let lastNonTieLeader: TeamSide | null = null;

  for (const scoringEvent of scoringEvents) {
    const leader = resolveLeader(
      scoringEvent.afterHomeScore,
      scoringEvent.afterAwayScore,
    );
    if (leader === "tie") {
      continue;
    }
    if (lastNonTieLeader && leader !== lastNonTieLeader) {
      leadChangeCount += 1;
    }
    lastNonTieLeader = leader;
  }

  return leadChangeCount;
}

function resolveLargestLead(
  scoringEvents: ScoringEvent[],
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
  scoringEvents: ScoringEvent[],
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
  scoringEvents: ScoringEvent[],
  teamNames: TeamNameContext,
): GameDayRecapPlayByPlayRun {
  let currentRunSide: TeamSide | null = null;
  let currentRunPoints = 0;
  const longestRun: GameDayRecapPlayByPlayRun = {
    points: 0,
    teamName: null,
    teamSide: null,
  };

  for (const scoringEvent of scoringEvents) {
    if (currentRunSide === scoringEvent.scoringTeamSide) {
      currentRunPoints += scoringEvent.points;
    } else {
      currentRunSide = scoringEvent.scoringTeamSide;
      currentRunPoints = scoringEvent.points;
    }

    if (currentRunPoints <= longestRun.points || !currentRunSide) {
      continue;
    }

    longestRun.points = currentRunPoints;
    longestRun.teamSide = currentRunSide;
    longestRun.teamName = resolveTeamName(currentRunSide, teamNames);
  }

  return longestRun;
}

function resolveLateGameMoments(
  scoringEvents: ScoringEvent[],
  teamNames: TeamNameContext,
): GameDayRecapLateGameMoment[] {
  const lateMoments: GameDayRecapLateGameMoment[] = [];

  for (const scoringEvent of scoringEvents) {
    if (scoringEvent.quarter < 4) {
      continue;
    }

    const secondsRemaining = parseClockToRemainingSeconds(scoringEvent.clock);
    if (
      secondsRemaining === null ||
      secondsRemaining > LATE_GAME_WINDOW_SECONDS
    ) {
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

function buildSummaryLines(args: {
  awayTeamName?: string | null;
  homeTeamName?: string | null;
  lateGameMoments: GameDayRecapLateGameMoment[];
  longestUnansweredRun: GameDayRecapPlayByPlayRun;
  winnerComebackDeficit: number | null;
  winnerSide: TeamSide | null;
}): string[] {
  const lines: string[] = [];

  if (
    args.winnerSide &&
    args.winnerComebackDeficit !== null &&
    args.winnerComebackDeficit >= COMEBACK_SUMMARY_THRESHOLD
  ) {
    lines.push(
      `${resolveTeamName(args.winnerSide, args) ?? resolveTeamLabel(args.winnerSide)} erased a ${args.winnerComebackDeficit}-point deficit to win.`,
    );
  }

  if (
    args.longestUnansweredRun.points >= UNANSWERED_RUN_SUMMARY_THRESHOLD &&
    args.longestUnansweredRun.teamSide
  ) {
    lines.push(
      `${args.longestUnansweredRun.teamName ?? resolveTeamLabel(args.longestUnansweredRun.teamSide)} authored the game's biggest unanswered burst with a ${args.longestUnansweredRun.points}-0 run.`,
    );
  }

  const lateGameSummary = summarizeLateGameMoments(args.lateGameMoments);
  if (lateGameSummary) {
    lines.push(lateGameSummary);
  }

  return lines.slice(0, 3);
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

function resolveFinalHomeScore(events: PublicMatchPlayByPlayEvent[]): number {
  return events.at(-1)?.homeScore ?? 0;
}

function resolveFinalAwayScore(events: PublicMatchPlayByPlayEvent[]): number {
  return events.at(-1)?.awayScore ?? 0;
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
  summarizeLateGameMoments,
};
