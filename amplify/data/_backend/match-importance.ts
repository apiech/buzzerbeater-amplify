import type {
  BBApiBoxScore,
  BBApiScheduleMatch,
} from "../../../lib/bbapi";

export type CompetitionClassification = {
  competitionKey:
    | "LEAGUE_REGULAR_SEASON"
    | "PLAYOFFS"
    | "SCRIMMAGE"
    | "PRIVATE_LEAGUE"
    | "CUP"
    | "BUZZERBEATER_BEST"
    | "BUZZERBEATER_MADNESS"
    | "OTHER";
  competitionLabel: string;
  isTvGame: boolean;
  stageKey: string | null;
  stageLabel: string | null;
};

export type CompetitiveSampleExclusionReason =
  | "SCRIMMAGE_LIKE"
  | "STRATEGIC_DEEMPHASIS_LOSS"
  | "MISSING_BOXSCORE";

export type CompetitiveSampleIncludedGame = {
  match: BBApiScheduleMatch;
  boxScore: BBApiBoxScore;
  margin: number | null;
  competition: CompetitionClassification;
};

export type CompetitiveSampleExcludedGame = {
  match: BBApiScheduleMatch;
  boxScore: BBApiBoxScore | null;
  margin: number | null;
  competition: CompetitionClassification;
  reason: CompetitiveSampleExclusionReason;
};

export type CompetitiveRecentSample = {
  rawMatchesConsidered: number;
  includedGames: CompetitiveSampleIncludedGame[];
  excludedGames: CompetitiveSampleExcludedGame[];
};

export function normalizeScheduleType(
  type: string | null | undefined,
): string | null {
  const normalized = type?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function classifyCompetition(
  type: string | null | undefined,
): CompetitionClassification {
  const normalizedType = normalizeScheduleType(type);
  const segments = normalizedType
    ? normalizedType.split(".").filter(Boolean)
    : [];
  const nonTvSegments = segments.filter((segment) => segment !== "tv");
  const isTvGame = segments.includes("tv");

  if (
    nonTvSegments[0] === "league" &&
    (!nonTvSegments[1] ||
      nonTvSegments[1] === "rs" ||
      nonTvSegments[1] === "regularseason")
  ) {
    return {
      competitionKey: "LEAGUE_REGULAR_SEASON",
      competitionLabel: "League regular season",
      isTvGame,
      stageKey: "REGULAR_SEASON",
      stageLabel: "Regular season",
    };
  }

  if (nonTvSegments[0] === "league") {
    const stageKey = normalizeStageKey(nonTvSegments[1] ?? null);
    return {
      competitionKey: "PLAYOFFS",
      competitionLabel: "Playoffs",
      isTvGame,
      stageKey,
      stageLabel: formatStageToken(stageKey),
    };
  }

  if (nonTvSegments[0] === "friendly" || nonTvSegments[0] === "scrimmage") {
    return {
      competitionKey: "SCRIMMAGE",
      competitionLabel: "Scrimmage",
      isTvGame,
      stageKey: null,
      stageLabel: null,
    };
  }

  if (
    nonTvSegments.some(
      (segment) => segment === "private" || segment.startsWith("private"),
    )
  ) {
    return {
      competitionKey: "PRIVATE_LEAGUE",
      competitionLabel: "Private league",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  if (nonTvSegments[0] === "cup") {
    const stageKey = normalizeStageKey(nonTvSegments[1] ?? null);
    return {
      competitionKey: "CUP",
      competitionLabel: "Cup",
      isTvGame,
      stageKey,
      stageLabel: formatStageToken(stageKey),
    };
  }

  if (
    nonTvSegments[0] === "bbb" ||
    normalizedType?.includes("buzzerbeatersbest") ||
    normalizedType?.includes("buzzer-beaters-best")
  ) {
    return {
      competitionKey: "BUZZERBEATER_BEST",
      competitionLabel: "BuzzerBeater's Best",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  if (
    nonTvSegments[0] === "bbm" ||
    normalizedType?.includes("buzzerbeatersmadness") ||
    normalizedType?.includes("buzzer-beaters-madness") ||
    normalizedType?.includes("madness")
  ) {
    return {
      competitionKey: "BUZZERBEATER_MADNESS",
      competitionLabel: "BuzzerBeater Madness",
      isTvGame,
      stageKey: normalizeStageKey(nonTvSegments[1] ?? null),
      stageLabel: formatStageToken(normalizeStageKey(nonTvSegments[1] ?? null)),
    };
  }

  return {
    competitionKey: "OTHER",
    competitionLabel: "Other",
    isTvGame,
    stageKey: normalizeStageKey(nonTvSegments[1] ?? nonTvSegments[0] ?? null),
    stageLabel: formatStageToken(
      normalizeStageKey(nonTvSegments[1] ?? nonTvSegments[0] ?? null),
    ),
  };
}

export function getMatchMarginForTeam(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }

  const teamScore =
    match.homeTeam.id === teamId ? match.homeTeam.score : match.awayTeam.score;
  const opponentScore =
    match.homeTeam.id === teamId ? match.awayTeam.score : match.homeTeam.score;

  return teamScore !== null && opponentScore !== null
    ? teamScore - opponentScore
    : null;
}

export function isScrimmageLike(
  type: string | null | undefined,
): boolean {
  return classifyCompetition(type).competitionKey === "SCRIMMAGE";
}

export function matchIncludesTeam(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean {
  return Boolean(
    teamId &&
      (match.homeTeam.id === teamId || match.awayTeam.id === teamId),
  );
}

export function isStrategicDeemphasisLoss(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean {
  const margin = getMatchMarginForTeam(match, teamId);
  return margin !== null && margin < -20;
}

export function buildCompetitiveRecentSample(args: {
  matches: BBApiScheduleMatch[];
  boxScores: BBApiBoxScore[];
  teamId: string | null;
  rawLookback: number;
  maxIncludedGames: number;
}): CompetitiveRecentSample {
  const selectedMatches = args.matches
    .filter((match) => getMatchMarginForTeam(match, args.teamId) !== null)
    .sort(byStartTimeDescending)
    .slice(0, args.rawLookback);
  const boxScoreByMatchId = new Map(
    args.boxScores
      .filter((boxScore) => Boolean(boxScore.matchId))
      .map((boxScore) => [boxScore.matchId as string, boxScore]),
  );

  const includedGames: CompetitiveSampleIncludedGame[] = [];
  const excludedGames: CompetitiveSampleExcludedGame[] = [];

  for (const match of selectedMatches) {
    const competition = classifyCompetition(match.type);
    const margin = getMatchMarginForTeam(match, args.teamId);
    const boxScore = match.id ? (boxScoreByMatchId.get(match.id) ?? null) : null;

    if (isScrimmageLike(match.type)) {
      excludedGames.push({
        match,
        boxScore,
        margin,
        competition,
        reason: "SCRIMMAGE_LIKE",
      });
      continue;
    }

    if (isStrategicDeemphasisLoss(match, args.teamId)) {
      excludedGames.push({
        match,
        boxScore,
        margin,
        competition,
        reason: "STRATEGIC_DEEMPHASIS_LOSS",
      });
      continue;
    }

    if (!boxScore) {
      excludedGames.push({
        match,
        boxScore: null,
        margin,
        competition,
        reason: "MISSING_BOXSCORE",
      });
      continue;
    }

    if (includedGames.length < args.maxIncludedGames) {
      includedGames.push({
        match,
        boxScore,
        margin,
        competition,
      });
    }
  }

  return {
    rawMatchesConsidered: selectedMatches.length,
    includedGames,
    excludedGames,
  };
}

function normalizeStageKey(value: string | null): string | null {
  return value ? value.replace(/[^a-z0-9]+/g, "_") : null;
}

function formatStageToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/_/g, "");
  const mappedLabel = STAGE_LABELS[normalized];
  if (mappedLabel) {
    return mappedLabel;
  }

  const roundMatch = /^round(\d+)$/.exec(normalized);
  if (roundMatch) {
    return `Round ${roundMatch[1]}`;
  }

  return value
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function byStartTimeDescending(
  left: BBApiScheduleMatch,
  right: BBApiScheduleMatch,
): number {
  return compareTimestamps(right.startTime, left.startTime);
}

function compareTimestamps(
  left: string | null,
  right: string | null,
): number {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

const STAGE_LABELS: Record<string, string> = {
  bronze: "Bronze game",
  final: "Final",
  finals: "Final",
  playin: "Play-in",
  quarterfinal: "Quarterfinal",
  quarterfinals: "Quarterfinal",
  relegation: "Relegation",
  relegationseries: "Relegation",
  semifinal: "Semifinal",
  semifinals: "Semifinal",
  wildcard: "Wildcard",
};
