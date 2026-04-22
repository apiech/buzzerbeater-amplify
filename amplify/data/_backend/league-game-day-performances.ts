import type { BBApiBoxScore, BBApiBoxScorePlayer, BBApiBoxScoreTeam } from "../../../lib/bbapi/types";
import type { Schema } from "../resource";

export type LeagueGameDayPerformancesResultPayload = NonNullable<
  Schema["LeagueGameDayPerformances"]["type"]["resultJson"]
>;

type LeagueGameDayPerformancesPlayerEntry =
  LeagueGameDayPerformancesResultPayload["playerLeaders"][number]["leaders"][number];
type LeagueGameDayPerformancesTeamEntry =
  LeagueGameDayPerformancesResultPayload["teamLeaders"][number]["leaders"][number];
type LeagueGameDayPerformancesPlayerLeaderboard =
  LeagueGameDayPerformancesResultPayload["playerLeaders"][number];
type LeagueGameDayPerformancesTeamLeaderboard =
  LeagueGameDayPerformancesResultPayload["teamLeaders"][number];
type LeagueGameDayPerformancesPositionLeaderboard =
  LeagueGameDayPerformancesResultPayload["topFive"][number];

const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"] as const;

const POSITION_LABELS: Record<(typeof POSITION_ORDER)[number], string> = {
  C: "Center",
  PF: "Power Forward",
  PG: "Point Guard",
  SF: "Small Forward",
  SG: "Shooting Guard",
};

type SourceGame = {
  boxScore: BBApiBoxScore;
  requestedGame: {
    awayTeamName: string;
    homeTeamName: string;
    matchId: string;
  };
};

type BuildLeagueGameDayPerformancesResultArgs = {
  gameDate: string | null;
  gameDayNumber: number;
  games: SourceGame[];
  leagueId: string;
  leagueName: string | null;
  season: number | null;
};

type InternalPlayerRow = {
  assists: number;
  blocks: number;
  defensiveRebounds: number;
  efficiency: number;
  fieldGoalsMade: number;
  freeThrowsMade: number;
  hasRecordedContribution: boolean;
  leadersEntry: LeagueGameDayPerformancesPlayerEntry;
  minutes: number;
  offensiveRebounds: number;
  points: number;
  rating: number | null;
  rebounds: number;
  steals: number;
  teamSortKey: string;
  threePointsMade: number;
  turnovers: number;
};

type InternalTeamRow = {
  assists: number;
  blocks: number;
  defensiveRebounds: number;
  defense: number;
  efficiency: number;
  fieldGoalPct: number;
  fieldGoalsMade: number;
  freeThrowPct: number;
  freeThrowsMade: number;
  leadersEntry: LeagueGameDayPerformancesTeamEntry;
  offensiveRebounds: number;
  offense: number;
  rating: number;
  rebounds: number;
  steals: number;
  teamSortKey: string;
  threePointPct: number;
  threePointsMade: number;
  turnovers: number;
};

export function buildLeagueGameDayPerformancesResult(
  args: BuildLeagueGameDayPerformancesResultArgs,
): LeagueGameDayPerformancesResultPayload {
  const playerRows: InternalPlayerRow[] = [];
  const teamRows: InternalTeamRow[] = [];
  const games = args.games.map((game) => {
    const awayTeam = buildInternalTeamRow(game.boxScore.awayTeam, game.boxScore.homeTeam);
    const homeTeam = buildInternalTeamRow(game.boxScore.homeTeam, game.boxScore.awayTeam);
    teamRows.push(awayTeam, homeTeam);
    playerRows.push(
      ...game.boxScore.awayTeam.players.map((player) =>
        buildInternalPlayerRow(player, game.boxScore.awayTeam),
      ),
      ...game.boxScore.homeTeam.players.map((player) =>
        buildInternalPlayerRow(player, game.boxScore.homeTeam),
      ),
    );

    return {
      awayScore: game.boxScore.awayTeam.score ?? 0,
      awayTeamName:
        game.boxScore.awayTeam.teamName ?? game.requestedGame.awayTeamName,
      homeScore: game.boxScore.homeTeam.score ?? 0,
      homeTeamName:
        game.boxScore.homeTeam.teamName ?? game.requestedGame.homeTeamName,
      matchId: game.requestedGame.matchId,
    };
  });

  const eligiblePlayers = playerRows.filter((player) => player.hasRecordedContribution);
  const playersWithRatings = eligiblePlayers.filter((player) => player.rating !== null);

  return {
    badPerformance: buildPlayerLeaderboard({
      compare: "min",
      key: "bad-performance",
      label: "Bad performance",
      rows: eligiblePlayers,
      selectValue: (player) => player.efficiency,
    }),
    gameDate: args.gameDate,
    gameDayNumber: args.gameDayNumber,
    games,
    leagueId: args.leagueId,
    leagueName: args.leagueName,
    mvp: buildPlayerLeaderboard({
      compare: "max",
      key: "mvp",
      label: "MVP",
      rows: eligiblePlayers,
      selectValue: (player) => player.efficiency,
    }),
    playerLeaders: [
      buildPlayerLeaderboard({
        compare: "max",
        key: "points",
        label: "Points",
        rows: eligiblePlayers,
        selectValue: (player) => player.points,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "field-goals-made",
        label: "Field goals made",
        rows: eligiblePlayers,
        selectValue: (player) => player.fieldGoalsMade,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "three-pointers-made",
        label: "3-pointers made",
        rows: eligiblePlayers,
        selectValue: (player) => player.threePointsMade,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "free-throws-made",
        label: "Free throws made",
        rows: eligiblePlayers,
        selectValue: (player) => player.freeThrowsMade,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "offensive-rebounds",
        label: "Offensive rebounds",
        rows: eligiblePlayers,
        selectValue: (player) => player.offensiveRebounds,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "defensive-rebounds",
        label: "Defensive rebounds",
        rows: eligiblePlayers,
        selectValue: (player) => player.defensiveRebounds,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "rebounds",
        label: "Rebounds",
        rows: eligiblePlayers,
        selectValue: (player) => player.rebounds,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "assists",
        label: "Assists",
        rows: eligiblePlayers,
        selectValue: (player) => player.assists,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "steals",
        label: "Steals",
        rows: eligiblePlayers,
        selectValue: (player) => player.steals,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "blocks",
        label: "Blocks",
        rows: eligiblePlayers,
        selectValue: (player) => player.blocks,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "turnovers",
        label: "Turnovers",
        rows: eligiblePlayers,
        selectValue: (player) => player.turnovers,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "rating",
        label: "Rating",
        rows: playersWithRatings,
        selectValue: (player) => player.rating,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "efficiency",
        label: "Efficiency",
        rows: eligiblePlayers,
        selectValue: (player) => player.efficiency,
      }),
    ],
    season: args.season,
    statCallouts: [
      buildPlayerLeaderboard({
        compare: "max",
        key: "turnovers",
        label: "Most turnovers",
        rows: eligiblePlayers,
        selectValue: (player) => player.turnovers,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "personal-fouls",
        label: "Most personal fouls",
        rows: eligiblePlayers,
        selectValue: (player) => player.leadersEntry.personalFouls,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "minutes",
        label: "Most minutes",
        rows: eligiblePlayers,
        selectValue: (player) => player.minutes,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "three-pointers-made",
        label: "Most 3-pointers made",
        rows: eligiblePlayers,
        selectValue: (player) => player.threePointsMade,
      }),
      buildPlayerLeaderboard({
        compare: "max",
        key: "best-rating",
        label: "Best rating",
        rows: playersWithRatings,
        selectValue: (player) => player.rating,
      }),
      buildPlayerLeaderboard({
        compare: "min",
        key: "worst-rating",
        label: "Worst rating",
        rows: playersWithRatings,
        selectValue: (player) => player.rating,
      }),
    ],
    teamLeaders: [
      buildTeamLeaderboard({
        compare: "max",
        key: "offense",
        label: "Offense",
        rows: teamRows,
        selectValue: (team) => team.offense,
      }),
      buildTeamLeaderboard({
        compare: "min",
        key: "defense",
        label: "Defense",
        rows: teamRows,
        selectValue: (team) => team.defense,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "field-goals-made",
        label: "Field goals made",
        rows: teamRows,
        selectValue: (team) => team.fieldGoalsMade,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "field-goal-percentage",
        label: "Field-goal percentage",
        rows: teamRows,
        selectValue: (team) => team.fieldGoalPct,
        unit: "%",
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "three-pointers-made",
        label: "3-pointers made",
        rows: teamRows,
        selectValue: (team) => team.threePointsMade,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "three-point-percentage",
        label: "3-point percentage",
        rows: teamRows,
        selectValue: (team) => team.threePointPct,
        unit: "%",
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "free-throws-made",
        label: "Free throws made",
        rows: teamRows,
        selectValue: (team) => team.freeThrowsMade,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "free-throw-percentage",
        label: "Free-throw percentage",
        rows: teamRows,
        selectValue: (team) => team.freeThrowPct,
        unit: "%",
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "offensive-rebounds",
        label: "Offensive rebounds",
        rows: teamRows,
        selectValue: (team) => team.offensiveRebounds,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "defensive-rebounds",
        label: "Defensive rebounds",
        rows: teamRows,
        selectValue: (team) => team.defensiveRebounds,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "rebounds",
        label: "Rebounds",
        rows: teamRows,
        selectValue: (team) => team.rebounds,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "assists",
        label: "Assists",
        rows: teamRows,
        selectValue: (team) => team.assists,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "steals",
        label: "Steals",
        rows: teamRows,
        selectValue: (team) => team.steals,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "blocks",
        label: "Blocks",
        rows: teamRows,
        selectValue: (team) => team.blocks,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "turnovers",
        label: "Turnovers",
        rows: teamRows,
        selectValue: (team) => team.turnovers,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "rating",
        label: "Rating",
        rows: teamRows,
        selectValue: (team) => team.rating,
      }),
      buildTeamLeaderboard({
        compare: "max",
        key: "efficiency",
        label: "Efficiency",
        rows: teamRows,
        selectValue: (team) => team.efficiency,
      }),
    ],
    topFive: POSITION_ORDER.map((position) =>
      buildTopFivePositionLeaderboard(position, eligiblePlayers),
    ),
    tripleDoubles: eligiblePlayers
      .filter((player) => countDoubleDigitStatCategories(player) >= 3)
      .sort(comparePlayerRows)
      .map((player) => player.leadersEntry),
  };
}

function buildInternalPlayerRow(
  player: BBApiBoxScorePlayer,
  team: BBApiBoxScoreTeam,
): InternalPlayerRow {
  const points = readNumber(player.performanceStats.pts);
  const rebounds = readNumber(player.performanceStats.reb);
  const assists = readNumber(player.performanceStats.ast);
  const steals = readNumber(player.performanceStats.stl);
  const blocks = readNumber(player.performanceStats.blk);
  const turnovers = readNumber(player.performanceStats.to);
  const fieldGoalsMade = readNumber(player.performanceStats.fgm);
  const fieldGoalAttempts = readNumber(player.performanceStats.fga);
  const freeThrowsMade = readNumber(player.performanceStats.ftm);
  const freeThrowAttempts = readNumber(player.performanceStats.fta);
  const offensiveRebounds = readNumber(player.performanceStats.oreb);
  const defensiveRebounds = Math.max(0, rebounds - offensiveRebounds);
  const threePointsMade = readNumber(player.performanceStats.tpm);
  const minutes = resolvePlayerMinutes(player);
  const efficiency =
    points +
    rebounds +
    assists +
    steals +
    blocks -
    (fieldGoalAttempts - fieldGoalsMade) -
    (freeThrowAttempts - freeThrowsMade) -
    turnovers;
  const personalFouls = readNumber(player.performanceStats.pf);
  const rating = typeof player.ratingValue === "number"
    ? roundToOneDecimal(player.ratingValue)
    : null;

  return {
    assists,
    blocks,
    defensiveRebounds,
    efficiency,
    fieldGoalsMade,
    freeThrowsMade,
    hasRecordedContribution:
      rating !== null ||
      minutes > 0 ||
      Object.values(player.performanceStats).some((value) => value > 0),
    leadersEntry: {
      efficiency,
      minutes,
      personalFouls,
      playerId: player.id,
      playerName: player.fullName || "Unknown player",
      position: resolvePrimaryPosition(player),
      rating,
      statLine: {
        assists,
        blocks,
        points,
        rebounds,
        steals,
      },
      teamId: team.id,
      teamName: team.teamName ?? "Unknown team",
      turnovers,
    },
    minutes,
    offensiveRebounds,
    points,
    rating,
    rebounds,
    steals,
    teamSortKey: `${team.teamName ?? ""}\u0000${team.id ?? ""}`,
    threePointsMade,
    turnovers,
  };
}

function buildInternalTeamRow(
  team: BBApiBoxScoreTeam,
  opponent: BBApiBoxScoreTeam,
): InternalTeamRow {
  const offensiveRebounds = readTeamTotal(team, "orb");
  const reboundsTotal =
    readOptionalTeamTotal(team, "reb") ??
    (offensiveRebounds + (readOptionalTeamTotal(team, "drb") ?? 0));
  const defensiveRebounds = readOptionalTeamTotal(team, "drb") ??
    Math.max(0, reboundsTotal - offensiveRebounds);
  const fieldGoalsMade = readTeamTotal(team, "fg");
  const fieldGoalAttempts = readTeamTotal(team, "fga");
  const threePointsMade = readTeamTotal(team, "3fg");
  const threePointAttempts = readTeamTotal(team, "3fga");
  const freeThrowsMade = readTeamTotal(team, "ft");
  const freeThrowAttempts = readTeamTotal(team, "fta");
  const rating = roundToOneDecimal(
    team.players.reduce((sum, player) => sum + (player.ratingValue ?? 0), 0),
  );
  const efficiency = team.players.reduce(
    (sum, player) => sum + buildInternalPlayerRow(player, team).efficiency,
    0,
  );

  return {
    assists: readTeamTotal(team, "ast"),
    blocks: readTeamTotal(team, "blk"),
    defensiveRebounds,
    defense: opponent.score ?? 0,
    efficiency,
    fieldGoalPct: percentage(fieldGoalsMade, fieldGoalAttempts),
    fieldGoalsMade,
    freeThrowPct: percentage(freeThrowsMade, freeThrowAttempts),
    freeThrowsMade,
    leadersEntry: {
      teamId: team.id,
      teamName: team.teamName ?? "Unknown team",
    },
    offensiveRebounds,
    offense: team.score ?? 0,
    rating,
    rebounds: reboundsTotal,
    steals: readTeamTotal(team, "stl"),
    teamSortKey: `${team.teamName ?? ""}\u0000${team.id ?? ""}`,
    threePointPct: percentage(threePointsMade, threePointAttempts),
    threePointsMade,
    turnovers: readTeamTotal(team, "to"),
  };
}

function buildPlayerLeaderboard(args: {
  compare: "max" | "min";
  key: string;
  label: string;
  rows: InternalPlayerRow[];
  selectValue: (row: InternalPlayerRow) => number | null;
  unit?: string;
}): LeagueGameDayPerformancesPlayerLeaderboard {
  const resolved = resolveLeaderboardSelection(
    args.rows,
    args.selectValue,
    args.compare,
    comparePlayerRows,
  );

  return {
    key: args.key,
    label: args.label,
    leaders: resolved.leaders.map((leader) => leader.leadersEntry),
    ...(args.unit ? { unit: args.unit } : {}),
    value: resolved.value,
  };
}

function buildTeamLeaderboard(args: {
  compare: "max" | "min";
  key: string;
  label: string;
  rows: InternalTeamRow[];
  selectValue: (row: InternalTeamRow) => number | null;
  unit?: string;
}): LeagueGameDayPerformancesTeamLeaderboard {
  const resolved = resolveLeaderboardSelection(
    args.rows,
    args.selectValue,
    args.compare,
    compareTeamRows,
  );

  return {
    key: args.key,
    label: args.label,
    leaders: resolved.leaders.map((leader) => leader.leadersEntry),
    ...(args.unit ? { unit: args.unit } : {}),
    value: resolved.value,
  };
}

function buildTopFivePositionLeaderboard(
  position: (typeof POSITION_ORDER)[number],
  rows: InternalPlayerRow[],
): LeagueGameDayPerformancesPositionLeaderboard {
  const positionRows = rows.filter(
    (row) => row.leadersEntry.position === position,
  );
  const resolved = resolveLeaderboardSelection(
    positionRows,
    (row) => row.efficiency,
    "max",
    comparePlayerRows,
  );

  return {
    key: position.toLowerCase(),
    label: POSITION_LABELS[position],
    leaders: resolved.leaders.map((leader) => leader.leadersEntry),
    position,
    value: resolved.value,
  };
}

function resolveLeaderboardSelection<TItem>(
  rows: TItem[],
  selectValue: (row: TItem) => number | null,
  compare: "max" | "min",
  tieBreaker: (left: TItem, right: TItem) => number,
): {
  leaders: TItem[];
  value: number;
} {
  const valuedRows = rows.flatMap((row) => {
    const value = selectValue(row);
    return value === null ? [] : [{ row, value }];
  });
  if (!valuedRows.length) {
    return {
      leaders: [],
      value: 0,
    };
  }

  const targetValue =
    compare === "max"
      ? valuedRows.reduce((best, current) => Math.max(best, current.value), -Infinity)
      : valuedRows.reduce((best, current) => Math.min(best, current.value), Infinity);

  return {
    leaders: valuedRows
      .filter((entry) => entry.value === targetValue)
      .map((entry) => entry.row)
      .sort(tieBreaker),
    value: targetValue,
  };
}

function resolvePrimaryPosition(
  player: BBApiBoxScorePlayer,
): (typeof POSITION_ORDER)[number] {
  let bestPosition: (typeof POSITION_ORDER)[number] = POSITION_ORDER[0];
  let bestMinutes = Number.NEGATIVE_INFINITY;

  for (const position of POSITION_ORDER) {
    const minutes = readNumber(player.minutesByPosition[position] ?? 0);
    if (minutes > bestMinutes) {
      bestPosition = position;
      bestMinutes = minutes;
    }
  }

  return bestPosition;
}

function resolvePlayerMinutes(player: BBApiBoxScorePlayer): number {
  return POSITION_ORDER.reduce(
    (sum, position) => sum + readNumber(player.minutesByPosition[position] ?? 0),
    0,
  );
}

function countDoubleDigitStatCategories(player: InternalPlayerRow): number {
  const categories = [
    player.points,
    player.rebounds,
    player.assists,
    player.steals,
    player.blocks,
  ];
  return categories.filter((value) => value >= 10).length;
}

function comparePlayerRows(left: InternalPlayerRow, right: InternalPlayerRow): number {
  const byName = left.leadersEntry.playerName.localeCompare(
    right.leadersEntry.playerName,
  );
  if (byName !== 0) {
    return byName;
  }

  const byTeam = left.teamSortKey.localeCompare(right.teamSortKey);
  if (byTeam !== 0) {
    return byTeam;
  }

  const byPosition =
    POSITION_ORDER.indexOf(left.leadersEntry.position as (typeof POSITION_ORDER)[number]) -
    POSITION_ORDER.indexOf(right.leadersEntry.position as (typeof POSITION_ORDER)[number]);
  if (byPosition !== 0) {
    return byPosition;
  }

  return (left.leadersEntry.playerId ?? "").localeCompare(
    right.leadersEntry.playerId ?? "",
  );
}

function compareTeamRows(left: InternalTeamRow, right: InternalTeamRow): number {
  return left.teamSortKey.localeCompare(right.teamSortKey);
}

function readTeamTotal(team: BBApiBoxScoreTeam, key: string): number {
  return readOptionalTeamTotal(team, key) ?? 0;
}

function readOptionalTeamTotal(
  team: BBApiBoxScoreTeam,
  key: string,
): number | null {
  const value = team.teamTotals[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : 0;
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return roundToOneDecimal((numerator / denominator) * 100);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export const __testing = {
  buildLeagueGameDayPerformancesResult,
  resolvePrimaryPosition,
};
