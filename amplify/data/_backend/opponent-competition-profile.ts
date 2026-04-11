import type {
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiBoxScoreTeam,
  BBApiScheduleMatch,
} from "../../../lib/bbapi";

import { TEAM_RATING_KEYS, type TeamRatings } from "../../../lib/buzzerbeater/team-ratings";
import {
  classifyCompetition,
  isStrategicDeemphasisLoss,
  matchIncludesTeam,
  normalizeScheduleType,
} from "./match-importance";

export type SeriousnessLabel = "MAYBE" | "NO" | "YES";
export type ScheduleVenue = "HOME" | "NEUTRAL" | "ROAD";

export type OpponentScheduleCompetitionOption = {
  count: number;
  key: string;
  label: string;
  selectedByDefault: boolean;
};

export type OpponentScheduleRow = {
  competitionKey: string;
  competitionLabel: string;
  hasBoxscore: boolean;
  isTvGame: boolean;
  matchId: string | null;
  opponentBbStatsTotal: number | null;
  opponentDefense: string | null;
  opponentOffense: string | null;
  opponentScore: number | null;
  opponentTeamId: string | null;
  opponentTeamName: string | null;
  outcome: string | null;
  season: number;
  seriousness: SeriousnessLabel | null;
  seriousnessReason: string | null;
  seriousnessScore: number | null;
  stageLabel: string | null;
  startTime: string | null;
  teamBbStatsTotal: number | null;
  teamDefense: string | null;
  teamOffense: string | null;
  teamScore: number | null;
  venue: ScheduleVenue | null;
};

export type OpponentScheduleSummary = {
  completedGames: number;
  missingBoxscores: number;
  seriousGames: number;
  totalGames: number;
  upcomingGames: number;
};

export type ForecastSampleGame = {
  boxScore: BBApiBoxScore;
  forecastEffortDelta: number | null;
  row: OpponentScheduleRow;
  seriousness: SeriousnessLabel;
  seriousnessReason: string;
  seriousnessScore: number;
  season: number;
};

export type ForecastSampleSelection = {
  games: ForecastSampleGame[];
  sampleStrategy: string;
  seriousGamesConsidered: number;
  supportingGamesConsidered: number;
};

export type OpponentCompetitionProfile = {
  availableSeasons: number[];
  competitionOptions: OpponentScheduleCompetitionOption[];
  forecastSample: ForecastSampleSelection;
  rows: OpponentScheduleRow[];
  selectedCompetitionKeys: string[];
  selectedSeason: number | null;
  summary: OpponentScheduleSummary;
};

type SeasonInput = {
  boxScores: BBApiBoxScore[];
  matches: BBApiScheduleMatch[];
  season: number;
};

type SeasonGameAnalysis = {
  boxScore: BBApiBoxScore | null;
  competitionKey: string;
  forecastEffortDelta: number | null;
  match: BBApiScheduleMatch;
  row: OpponentScheduleRow;
  seriousness: SeriousnessLabel | null;
  seriousnessReason: string | null;
  seriousnessScore: number | null;
};

type SeasonCoreProfile = {
  corePlayerIds: Set<string>;
  primaryStarterIds: Set<string>;
};

export const __testing = {
  buildForecastSample,
  buildBbstatsTotal,
  buildOpponentCompetitionProfile,
  computeSeriousnessForGame,
  computeTeamEffortAdvantage,
};

export function buildOpponentCompetitionProfile(args: {
  availableSeasons: number[];
  competitionKeys?: string[] | null;
  seasons: SeasonInput[];
  selectedSeason: number | null;
  teamId: string | null;
}): OpponentCompetitionProfile {
  const normalizedSeasons = dedupeSeasonInputs(args.seasons);
  const availableSeasons = [...args.availableSeasons]
    .filter((season): season is number => Number.isInteger(season))
    .sort((left, right) => right - left);
  const defaultSeason = availableSeasons[0] ?? normalizedSeasons[0]?.season ?? null;
  const selectedSeason = resolveSelectedSeason(
    availableSeasons,
    normalizedSeasons,
    args.selectedSeason,
    defaultSeason,
  );
  const selectedSeasonInput =
    normalizedSeasons.find((season) => season.season === selectedSeason) ?? null;
  const analyzedSeasons = normalizedSeasons.map((season) =>
    analyzeSeason({
      boxScores: season.boxScores,
      matches: season.matches,
      season: season.season,
      teamId: args.teamId,
    }),
  );
  const selectedSeasonAnalysis =
    analyzedSeasons.find((season) => season.season === selectedSeason) ?? null;
  const competitionOptions = buildCompetitionOptions(
    selectedSeasonAnalysis?.games ?? [],
  );
  const selectedCompetitionKeys = resolveSelectedCompetitionKeys({
    availableOptions: competitionOptions,
    requestedKeys: args.competitionKeys ?? null,
  });
  const rows = (selectedSeasonAnalysis?.games ?? [])
    .filter((game) => selectedCompetitionKeys.includes(game.competitionKey))
    .map((game) => game.row);
  const summary = buildScheduleSummary(rows);
  const forecastSample = buildForecastSample(analyzedSeasons);

  return {
    availableSeasons,
    competitionOptions,
    forecastSample,
    rows,
    selectedCompetitionKeys,
    selectedSeason: selectedSeasonInput?.season ?? selectedSeason ?? null,
    summary,
  };
}

function dedupeSeasonInputs(seasons: SeasonInput[]): SeasonInput[] {
  const bySeason = new Map<number, SeasonInput>();
  for (const season of seasons) {
    if (!Number.isInteger(season.season)) {
      continue;
    }
    bySeason.set(season.season, season);
  }
  return Array.from(bySeason.values()).sort((left, right) => right.season - left.season);
}

function resolveSelectedSeason(
  availableSeasons: number[],
  seasons: SeasonInput[],
  requestedSeason: number | null,
  fallbackSeason: number | null,
): number | null {
  if (
    requestedSeason !== null &&
    (availableSeasons.includes(requestedSeason) ||
      seasons.some((season) => season.season === requestedSeason))
  ) {
    return requestedSeason;
  }
  return fallbackSeason;
}

function analyzeSeason(args: {
  boxScores: BBApiBoxScore[];
  matches: BBApiScheduleMatch[];
  season: number;
  teamId: string | null;
}): { games: SeasonGameAnalysis[]; season: number } {
  const relevantMatches = [...args.matches]
    .filter((match) => isClubMatchForTeam(match, args.teamId))
    .sort(byStartTimeAscending);
  const boxScoreByMatchId = new Map(
    args.boxScores
      .filter((boxScore) => Boolean(boxScore.matchId))
      .map((boxScore) => [boxScore.matchId as string, boxScore]),
  );
  const coreProfile = buildSeasonCoreProfile({
    boxScores: args.boxScores,
    teamId: args.teamId,
  });

  return {
    season: args.season,
    games: relevantMatches.map((match) =>
      analyzeGame({
        boxScore: match.id ? (boxScoreByMatchId.get(match.id) ?? null) : null,
        coreProfile,
        match,
        season: args.season,
        teamId: args.teamId,
      }),
    ),
  };
}

function analyzeGame(args: {
  boxScore: BBApiBoxScore | null;
  coreProfile: SeasonCoreProfile;
  match: BBApiScheduleMatch;
  season: number;
  teamId: string | null;
}): SeasonGameAnalysis {
  const competition = classifyCompetition(args.match.type);
  const perspective = args.boxScore
    ? resolveBoxScorePerspective(args.boxScore, args.teamId)
    : null;
  const seriousness = computeSeriousnessForGame({
    boxScore: args.boxScore,
    competitionKey: competition.competitionKey,
    coreProfile: args.coreProfile,
    isTvGame: competition.isTvGame,
    match: args.match,
    teamId: args.teamId,
  });

  return {
    boxScore: args.boxScore,
    competitionKey: competition.competitionKey,
    forecastEffortDelta:
      seriousness.teamEffortAdvantage === null
        ? null
        : -seriousness.teamEffortAdvantage,
    match: args.match,
    seriousness: seriousness.label,
    seriousnessReason: seriousness.reason,
    seriousnessScore: seriousness.score,
    row: {
      competitionKey: competition.competitionKey,
      competitionLabel: competition.competitionLabel,
      hasBoxscore: Boolean(args.boxScore),
      isTvGame: competition.isTvGame,
      matchId: args.match.id,
      opponentBbStatsTotal: perspective?.opponent
        ? buildBbstatsTotal(perspective.opponent.ratings)
        : null,
      opponentDefense: perspective?.opponent?.defStrategy ?? null,
      opponentOffense: perspective?.opponent?.offStrategy ?? null,
      opponentScore: deriveOpponentScore(args.match, args.teamId),
      opponentTeamId: deriveOpponentTeamId(args.match, args.teamId),
      opponentTeamName: deriveOpponentTeamName(args.match, args.teamId),
      outcome: deriveOutcome(args.match, args.teamId),
      season: args.season,
      seriousness: seriousness.label,
      seriousnessReason: seriousness.reason,
      seriousnessScore: seriousness.score,
      stageLabel: competition.stageLabel,
      startTime: args.match.startTime,
      teamBbStatsTotal: perspective?.team
        ? buildBbstatsTotal(perspective.team.ratings)
        : null,
      teamDefense: perspective?.team?.defStrategy ?? null,
      teamOffense: perspective?.team?.offStrategy ?? null,
      teamScore: deriveTeamScore(args.match, args.teamId),
      venue: resolveVenue(args.match, args.teamId, args.boxScore),
    },
  };
}

function buildCompetitionOptions(
  games: readonly SeasonGameAnalysis[],
): OpponentScheduleCompetitionOption[] {
  const counts = new Map<string, { count: number; label: string; selectedByDefault: boolean }>();
  for (const game of games) {
    const current = counts.get(game.competitionKey) ?? {
      count: 0,
      label: game.row.competitionLabel,
      selectedByDefault: game.competitionKey !== "SCRIMMAGE",
    };
    current.count += 1;
    current.label = game.row.competitionLabel;
    current.selectedByDefault = current.selectedByDefault && game.competitionKey !== "SCRIMMAGE";
    counts.set(game.competitionKey, current);
  }

  return Array.from(counts.entries())
    .map(([key, value]) => ({
      count: value.count,
      key,
      label: value.label,
      selectedByDefault: value.selectedByDefault,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function resolveSelectedCompetitionKeys(args: {
  availableOptions: OpponentScheduleCompetitionOption[];
  requestedKeys: string[] | null;
}): string[] {
  const availableKeys = new Set(args.availableOptions.map((option) => option.key));
  if (args.requestedKeys) {
    return Array.from(
      new Set(
        args.requestedKeys.filter((key) => availableKeys.has(key)),
      ),
    );
  }
  return args.availableOptions
    .filter((option) => option.selectedByDefault)
    .map((option) => option.key);
}

function buildScheduleSummary(rows: OpponentScheduleRow[]): OpponentScheduleSummary {
  const completedGames = rows.filter((row) => row.outcome && row.outcome !== "PENDING").length;
  const upcomingGames = rows.filter((row) => row.outcome === "PENDING").length;
  const missingBoxscores = rows.filter(
    (row) => row.outcome && row.outcome !== "PENDING" && !row.hasBoxscore,
  ).length;
  const seriousGames = rows.filter((row) => row.seriousness === "YES").length;
  return {
    completedGames,
    missingBoxscores,
    seriousGames,
    totalGames: rows.length,
    upcomingGames,
  };
}

function buildForecastSample(
  seasons: Array<{ games: SeasonGameAnalysis[]; season: number }>,
): ForecastSampleSelection {
  const currentSeason = seasons[0];
  const previousSeason = seasons[1];
  const currentSerious = extractForecastCandidates(currentSeason?.games ?? [], [
    "YES",
  ]);
  const currentSupporting = extractForecastCandidates(currentSeason?.games ?? [], [
    "MAYBE",
  ]);
  const previousSerious = extractForecastCandidates(previousSeason?.games ?? [], [
    "YES",
    "MAYBE",
  ]);

  let selectedGames = [...currentSerious];
  let sampleStrategy = "CURRENT_SEASON_SERIOUS";

  if (selectedGames.length === 0 && currentSupporting.length > 0) {
    selectedGames = [...currentSupporting];
    sampleStrategy = "CURRENT_SEASON_SUPPORTING_ONLY";
  } else if (selectedGames.length > 0 && currentSupporting.length > 0) {
    selectedGames = [...selectedGames, ...currentSupporting];
    sampleStrategy = "CURRENT_SEASON_SERIOUS_PLUS_SUPPORTING";
  }

  if (selectedGames.length === 0 && previousSerious.length > 0) {
    selectedGames = [...previousSerious];
    sampleStrategy = "CROSS_SEASON_SERIOUS_FALLBACK";
  } else if (selectedGames.length < 5 && previousSerious.length > 0) {
    selectedGames = [...selectedGames, ...previousSerious];
    sampleStrategy = "CROSS_SEASON_SERIOUS_FALLBACK";
  }

  if (selectedGames.length === 0) {
    selectedGames = [
      ...extractForecastCandidates(currentSeason?.games ?? [], ["NO"]),
      ...extractForecastCandidates(previousSeason?.games ?? [], ["NO"]),
    ];
    sampleStrategy = selectedGames.length
      ? "LAST_RESORT_WEAK_GAMES"
      : "NO_COMPLETED_GAMES";
  }

  const games = selectedGames.slice(0, 5);
  return {
    games,
    sampleStrategy,
    seriousGamesConsidered: games.filter((game) => game.seriousness === "YES").length,
    supportingGamesConsidered: games.filter((game) => game.seriousness !== "YES").length,
  };
}

function extractForecastCandidates(
  games: readonly SeasonGameAnalysis[],
  seriousnessLabels: SeriousnessLabel[],
): ForecastSampleGame[] {
  return games
    .filter((game) => Boolean(game.boxScore))
    .filter((game) => Boolean(game.row.matchId))
    .filter(
      (game): game is SeasonGameAnalysis & {
        boxScore: BBApiBoxScore;
        seriousness: SeriousnessLabel;
        seriousnessReason: string;
        seriousnessScore: number;
      } =>
        Boolean(
          game.boxScore &&
            game.seriousness &&
            seriousnessLabels.includes(game.seriousness) &&
            game.seriousnessReason &&
            game.seriousnessScore !== null,
        ),
    )
    .sort((left, right) => compareTimestamps(right.row.startTime, left.row.startTime))
    .map((game) => ({
      boxScore: game.boxScore,
      forecastEffortDelta: game.forecastEffortDelta,
      row: game.row,
      seriousness: game.seriousness,
      seriousnessReason: game.seriousnessReason,
      seriousnessScore: game.seriousnessScore,
      season: game.row.season,
    }));
}

function buildSeasonCoreProfile(args: {
  boxScores: BBApiBoxScore[];
  teamId: string | null;
}): SeasonCoreProfile {
  const playerUsage = new Map<
    string,
    {
      activityScore: number;
      fullName: string;
      minutes: number;
      startCount: number;
    }
  >();

  for (const boxScore of args.boxScores) {
    const team = resolveTeamForBoxScore(boxScore, args.teamId);
    if (!team) {
      continue;
    }
    for (const player of team.players) {
      const playerKey = resolvePlayerKey(player);
      if (!playerKey) {
        continue;
      }
      const current = playerUsage.get(playerKey) ?? {
        activityScore: 0,
        fullName: player.fullName,
        minutes: 0,
        startCount: 0,
      };
      current.activityScore += calculateActivityScore(player);
      current.minutes += totalMinutesPlayed(player);
      current.startCount += isStarter(player) ? 1 : 0;
      current.fullName = player.fullName || current.fullName;
      playerUsage.set(playerKey, current);
    }
  }

  const rankedPlayers = Array.from(playerUsage.entries()).sort((left, right) => {
    const [, leftUsage] = left;
    const [, rightUsage] = right;
    return (
      rightUsage.startCount - leftUsage.startCount ||
      rightUsage.minutes - leftUsage.minutes ||
      rightUsage.activityScore - leftUsage.activityScore ||
      leftUsage.fullName.localeCompare(rightUsage.fullName)
    );
  });

  return {
    corePlayerIds: new Set(rankedPlayers.slice(0, 7).map(([playerId]) => playerId)),
    primaryStarterIds: new Set(
      rankedPlayers.slice(0, 5).map(([playerId]) => playerId),
    ),
  };
}

export function computeSeriousnessForGame(args: {
  boxScore: BBApiBoxScore | null;
  competitionKey: string;
  coreProfile: SeasonCoreProfile;
  isTvGame: boolean;
  match: BBApiScheduleMatch;
  teamId: string | null;
}): {
  label: SeriousnessLabel | null;
  reason: string | null;
  score: number | null;
  teamEffortAdvantage: number | null;
} {
  if (!isCompletedMatch(args.match, args.teamId)) {
    return {
      label: null,
      reason: null,
      score: null,
      teamEffortAdvantage: null,
    };
  }

  if (!args.boxScore) {
    return {
      label: null,
      reason: null,
      score: null,
      teamEffortAdvantage: null,
    };
  }

  if (args.competitionKey === "SCRIMMAGE") {
    return {
      label: "NO",
      reason: "Scrimmage-like game",
      score: 0,
      teamEffortAdvantage: computeTeamEffortAdvantage(args.boxScore, args.teamId),
    };
  }

  if (isStrategicDeemphasisLoss(args.match, args.teamId)) {
    return {
      label: "NO",
      reason: "Strategic deemphasis signal",
      score: 0,
      teamEffortAdvantage: computeTeamEffortAdvantage(args.boxScore, args.teamId),
    };
  }

  const team = resolveTeamForBoxScore(args.boxScore, args.teamId);
  const teamEffortAdvantage = computeTeamEffortAdvantage(args.boxScore, args.teamId);
  if (!team) {
    return {
      label: null,
      reason: null,
      score: null,
      teamEffortAdvantage,
    };
  }

  const coreUsage = summarizeCoreUsage(team, args.coreProfile);
  if (
    teamEffortAdvantage !== null &&
    teamEffortAdvantage < 0 &&
    coreUsage.weakCoreUsage
  ) {
    return {
      label: "NO",
      reason: "Negative effort and weak core usage",
      score: 0,
      teamEffortAdvantage,
    };
  }

  if (coreUsage.obviousBadLineup) {
    return {
      label: "NO",
      reason: "Bad lineup or throw pattern",
      score: 0,
      teamEffortAdvantage,
    };
  }

  let score = 0.35;
  if (teamEffortAdvantage !== null) {
    if (teamEffortAdvantage > 0) {
      score += 0.4;
    } else if (teamEffortAdvantage < 0) {
      score -= 0.4;
    }
  }
  if (coreUsage.strongCoreUsage) {
    score += 0.3;
  } else if (coreUsage.weakCoreUsage) {
    score -= 0.3;
  }
  if (HIGH_STAKES_COMPETITIONS.has(args.competitionKey)) {
    score += 0.15;
  }
  if (args.isTvGame) {
    score += 0.1;
  }
  const normalizedScore = clamp(score, 0, 1);
  const label =
    normalizedScore >= 0.65 ? "YES" : normalizedScore >= 0.4 ? "MAYBE" : "NO";

  return {
    label,
    reason: selectSeriousnessReason({
      competitionKey: args.competitionKey,
      coreUsage,
      isTvGame: args.isTvGame,
      label,
      teamEffortAdvantage,
    }),
    score: Number(normalizedScore.toFixed(2)),
    teamEffortAdvantage,
  };
}

export function computeTeamEffortAdvantage(
  boxScore: BBApiBoxScore,
  teamId: string | null,
): number | null {
  if (boxScore.effortDelta === null || boxScore.effortDelta === undefined) {
    return null;
  }
  const rawEffortDelta = Number(boxScore.effortDelta);
  if (!Number.isFinite(rawEffortDelta) || !teamId) {
    return null;
  }
  if (boxScore.homeTeam.id === teamId) {
    return rawEffortDelta;
  }
  if (boxScore.awayTeam.id === teamId) {
    return -rawEffortDelta;
  }
  return null;
}

export function buildBbstatsTotal(
  ratings: TeamRatings | null | undefined,
): number | null {
  if (!ratings) {
    return null;
  }
  const values = TEAM_RATING_KEYS.map((key) => ratings[key]).filter(
    (value): value is number => Number.isFinite(value),
  );
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + Math.round(value * 3), 0);
}

function summarizeCoreUsage(
  team: BBApiBoxScoreTeam,
  coreProfile: SeasonCoreProfile,
): {
  coreMinuteShare: number;
  obviousBadLineup: boolean;
  starterOverlap: number;
  strongCoreUsage: boolean;
  weakCoreUsage: boolean;
} {
  const totalTeamMinutes =
    team.players.reduce((sum, player) => sum + totalMinutesPlayed(player), 0) || 1;
  let coreMinutes = 0;
  let starterOverlap = 0;

  for (const player of team.players) {
    const playerKey = resolvePlayerKey(player);
    if (!playerKey) {
      continue;
    }
    const minutes = totalMinutesPlayed(player);
    if (coreProfile.corePlayerIds.has(playerKey)) {
      coreMinutes += minutes;
    }
    if (isStarter(player) && coreProfile.primaryStarterIds.has(playerKey)) {
      starterOverlap += 1;
    }
  }

  const coreMinuteShare = coreMinutes / totalTeamMinutes;
  const strongCoreUsage = starterOverlap >= 4 || coreMinuteShare >= 0.78;
  const weakCoreUsage = starterOverlap <= 2 && coreMinuteShare < 0.68;
  const obviousBadLineup = starterOverlap <= 1 && coreMinuteShare < 0.58;

  return {
    coreMinuteShare,
    obviousBadLineup,
    starterOverlap,
    strongCoreUsage,
    weakCoreUsage,
  };
}

function selectSeriousnessReason(args: {
  competitionKey: string;
  coreUsage: {
    coreMinuteShare: number;
    starterOverlap: number;
    strongCoreUsage: boolean;
    weakCoreUsage: boolean;
  };
  isTvGame: boolean;
  label: SeriousnessLabel;
  teamEffortAdvantage: number | null;
}): string {
  if (args.teamEffortAdvantage !== null && args.teamEffortAdvantage > 0) {
    if (args.coreUsage.strongCoreUsage) {
      return "Higher effort + full core";
    }
    return "Higher effort with mixed lineup signals";
  }
  if (args.teamEffortAdvantage !== null && args.teamEffortAdvantage < 0) {
    if (args.coreUsage.weakCoreUsage) {
      return "Negative effort and weak core usage";
    }
    return "Lower effort with mixed lineup signals";
  }
  if (HIGH_STAKES_COMPETITIONS.has(args.competitionKey)) {
    return args.label === "YES"
      ? "High-stakes game with corroborating signals"
      : "High-stakes context but mixed lineup signals";
  }
  if (args.isTvGame) {
    return "TV game context";
  }
  if (args.coreUsage.strongCoreUsage) {
    return "Full core rotation";
  }
  return "Mixed seriousness signals";
}

function resolveBoxScorePerspective(
  boxScore: BBApiBoxScore,
  teamId: string | null,
): { opponent: BBApiBoxScoreTeam; team: BBApiBoxScoreTeam } | null {
  const team = resolveTeamForBoxScore(boxScore, teamId);
  const opponent = resolveOpponentForBoxScore(boxScore, teamId);
  return team && opponent ? { opponent, team } : null;
}

function resolveTeamForBoxScore(
  boxScore: BBApiBoxScore,
  teamId: string | null,
): BBApiBoxScoreTeam | null {
  if (!teamId) {
    return null;
  }
  if (boxScore.homeTeam.id === teamId) {
    return boxScore.homeTeam;
  }
  if (boxScore.awayTeam.id === teamId) {
    return boxScore.awayTeam;
  }
  return null;
}

function resolveOpponentForBoxScore(
  boxScore: BBApiBoxScore,
  teamId: string | null,
): BBApiBoxScoreTeam | null {
  if (!teamId) {
    return null;
  }
  if (boxScore.homeTeam.id === teamId) {
    return boxScore.awayTeam;
  }
  if (boxScore.awayTeam.id === teamId) {
    return boxScore.homeTeam;
  }
  return null;
}

function deriveOpponentTeamId(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }
  return match.homeTeam.id === teamId ? match.awayTeam.id : match.homeTeam.id;
}

function deriveOpponentTeamName(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }
  return match.homeTeam.id === teamId
    ? match.awayTeam.teamName
    : match.homeTeam.teamName;
}

function deriveTeamScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }
  return match.homeTeam.id === teamId
    ? match.homeTeam.score
    : match.awayTeam.score;
}

function deriveOpponentScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }
  return match.homeTeam.id === teamId
    ? match.awayTeam.score
    : match.homeTeam.score;
}

function deriveOutcome(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  const teamScore = deriveTeamScore(match, teamId);
  const opponentScore = deriveOpponentScore(match, teamId);
  if (teamScore === null || opponentScore === null) {
    return "PENDING";
  }
  return teamScore > opponentScore ? "WIN" : "LOSS";
}

function resolveVenue(
  match: BBApiScheduleMatch,
  teamId: string | null,
  boxScore: BBApiBoxScore | null,
): ScheduleVenue | null {
  if (boxScore?.neutral) {
    return "NEUTRAL";
  }
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }
  return match.homeTeam.id === teamId ? "HOME" : "ROAD";
}

function isClubMatchForTeam(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean {
  return matchIncludesTeam(match, teamId) && !isNonClubScheduleType(match.type);
}

function isNonClubScheduleType(type: string | null | undefined): boolean {
  const normalized = normalizeScheduleType(type);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("allstar") ||
    normalized.includes("all-star") ||
    normalized.startsWith("nationalteam") ||
    normalized.startsWith("nt.")
  );
}

function isCompletedMatch(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean {
  return (
    deriveTeamScore(match, teamId) !== null &&
    deriveOpponentScore(match, teamId) !== null
  );
}

function resolvePlayerKey(player: BBApiBoxScorePlayer): string | null {
  return player.id?.trim() || player.fullName?.trim() || null;
}

function isStarter(player: BBApiBoxScorePlayer): boolean {
  return toRecord(player.details)?.isStarter === true;
}

function totalMinutesPlayed(player: BBApiBoxScorePlayer): number {
  let total = 0;
  for (const minutes of Object.values(toRecord(player.minutesByPosition) ?? {})) {
    if (typeof minutes === "number" && Number.isFinite(minutes)) {
      total += minutes;
    }
  }
  return total;
}

function calculateActivityScore(player: BBApiBoxScorePlayer): number {
  const performanceStats = player.performanceStats ?? {};
  const pts = asNumber(performanceStats.pts) ?? 0;
  const reb = asNumber(performanceStats.reb) ?? 0;
  const ast = asNumber(performanceStats.ast) ?? 0;
  const stl = asNumber(performanceStats.stl) ?? 0;
  const blk = asNumber(performanceStats.blk) ?? 0;
  const turnovers = asNumber(performanceStats.to) ?? 0;

  return pts + 0.7 * reb + 0.7 * ast + 1.5 * (stl + blk) - turnovers;
}

function byStartTimeAscending(
  left: BBApiScheduleMatch,
  right: BBApiScheduleMatch,
): number {
  return compareTimestamps(left.startTime, right.startTime);
}

function compareTimestamps(
  left: string | null,
  right: string | null,
): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return leftTime - rightTime;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const HIGH_STAKES_COMPETITIONS = new Set([
  "BUZZERBEATER_BEST",
  "BUZZERBEATER_MADNESS",
  "CUP",
  "PLAYOFFS",
]);
