import type {
  BBApiArena,
  BBApiRosterPlayer,
  BBApiTeamStats,
} from "../../../lib/bbapi";
import type { Schema } from "../resource";

type LeagueComparisonMetricTriplet =
  Schema["LeagueComparisonMetricTriplet"]["type"];
type LeagueComparisonsResult = Schema["LeagueComparisons"]["type"];
type LeagueOffenseRow = Schema["LeagueOffenseRow"]["type"];
type LeagueDefenseRow = Schema["LeagueDefenseRow"]["type"];
type LeaguePayrollRow = Schema["LeaguePayrollRow"]["type"];
type LeagueArenaRow = Schema["LeagueArenaRow"]["type"];

type LeagueComparisonMetricKind = "number" | "percentage";

type LeagueComparisonMetricDefinition = {
  key: string;
  kind: LeagueComparisonMetricKind;
  aliases: {
    diff: readonly string[];
    opponent: readonly string[];
    team: readonly string[];
  };
};

export type LeagueComparisonTeamSnapshot = {
  arena: BBApiArena | null;
  conferenceIndex: number;
  incomplete: boolean;
  losses: number | null;
  rosterPlayers: BBApiRosterPlayer[] | null;
  standingsIndex: number;
  teamId: string | null;
  teamName: string | null;
  teamStats: BBApiTeamStats | null;
  wins: number | null;
};

const offenseMetricDefinitions = [
  {
    key: "points",
    kind: "number",
    aliases: {
      team: ["points.team", "ppg.team", "scoring.team", "totals.pts", "pts"],
      opponent: [
        "points.opp",
        "ppg.opp",
        "scoring.opp",
        "points.allowed",
        "points.against",
        "papg",
      ],
      diff: ["points.diff", "ppg.diff", "scoring.diff"],
    },
  },
  {
    key: "fgPct",
    kind: "percentage",
    aliases: {
      team: [
        "fgPct.team",
        "fieldGoalPct.team",
        "fieldGoalPercentage.team",
        "shooting.fgPct",
        "shooting.fieldGoalPct",
        "fgPct",
        "fieldGoalPct",
      ],
      opponent: [
        "fgPct.opp",
        "fieldGoalPct.opp",
        "fieldGoalPercentage.opp",
        "oppFgPct",
        "opponentFgPct",
      ],
      diff: ["fgPct.diff", "fieldGoalPct.diff", "fieldGoalPercentage.diff"],
    },
  },
  {
    key: "threePtPct",
    kind: "percentage",
    aliases: {
      team: [
        "threePtPct.team",
        "threePointPct.team",
        "threePointPercentage.team",
        "3fgPct.team",
        "3ptPct.team",
        "threePtPct",
        "threePointPct",
        "3fgPct",
      ],
      opponent: [
        "threePtPct.opp",
        "threePointPct.opp",
        "threePointPercentage.opp",
        "3fgPct.opp",
        "3ptPct.opp",
        "oppThreePtPct",
      ],
      diff: [
        "threePtPct.diff",
        "threePointPct.diff",
        "threePointPercentage.diff",
        "3fgPct.diff",
        "3ptPct.diff",
      ],
    },
  },
  {
    key: "ftPct",
    kind: "percentage",
    aliases: {
      team: [
        "ftPct.team",
        "freeThrowPct.team",
        "freeThrowPercentage.team",
        "shooting.ftPct",
        "ftPct",
        "freeThrowPct",
      ],
      opponent: [
        "ftPct.opp",
        "freeThrowPct.opp",
        "freeThrowPercentage.opp",
        "oppFtPct",
      ],
      diff: ["ftPct.diff", "freeThrowPct.diff", "freeThrowPercentage.diff"],
    },
  },
  {
    key: "assists",
    kind: "number",
    aliases: {
      team: ["assists.team", "apg.team", "ast.team", "totals.ast", "ast"],
      opponent: [
        "assists.opp",
        "apg.opp",
        "ast.opp",
        "oppAst",
        "assists.allowed",
      ],
      diff: ["assists.diff", "apg.diff", "ast.diff"],
    },
  },
  {
    key: "offensiveRebounds",
    kind: "number",
    aliases: {
      team: [
        "offensiveRebounds.team",
        "orpg.team",
        "oreb.team",
        "totals.oreb",
        "oreb",
      ],
      opponent: [
        "offensiveRebounds.opp",
        "orpg.opp",
        "oreb.opp",
        "oppOreb",
      ],
      diff: ["offensiveRebounds.diff", "orpg.diff", "oreb.diff"],
    },
  },
  {
    key: "effectiveFgPct",
    kind: "percentage",
    aliases: {
      team: [
        "effectiveFgPct.team",
        "effectiveFieldGoalPct.team",
        "efg.team",
        "effg.team",
        "effectiveFgPct",
        "efg",
        "effg",
      ],
      opponent: [
        "effectiveFgPct.opp",
        "effectiveFieldGoalPct.opp",
        "efg.opp",
        "effg.opp",
        "oppEfg",
      ],
      diff: [
        "effectiveFgPct.diff",
        "effectiveFieldGoalPct.diff",
        "efg.diff",
        "effg.diff",
      ],
    },
  },
] as const satisfies readonly LeagueComparisonMetricDefinition[];

const defenseMetricDefinitions = [
  {
    key: "totalRebounds",
    kind: "number",
    aliases: {
      team: ["totalRebounds.team", "rpg.team", "reb.team", "totals.reb", "reb"],
      opponent: [
        "totalRebounds.opp",
        "rpg.opp",
        "reb.opp",
        "oppReb",
        "rebounds.allowed",
      ],
      diff: ["totalRebounds.diff", "rpg.diff", "reb.diff"],
    },
  },
  {
    key: "blocks",
    kind: "number",
    aliases: {
      team: ["blocks.team", "bpg.team", "blk.team", "totals.blk", "blk"],
      opponent: ["blocks.opp", "bpg.opp", "blk.opp", "oppBlk"],
      diff: ["blocks.diff", "bpg.diff", "blk.diff"],
    },
  },
  {
    key: "steals",
    kind: "number",
    aliases: {
      team: ["steals.team", "spg.team", "stl.team", "totals.stl", "stl"],
      opponent: ["steals.opp", "spg.opp", "stl.opp", "oppStl"],
      diff: ["steals.diff", "spg.diff", "stl.diff"],
    },
  },
  {
    key: "turnovers",
    kind: "number",
    aliases: {
      team: ["turnovers.team", "topg.team", "to.team", "totals.to", "to"],
      opponent: ["turnovers.opp", "topg.opp", "to.opp", "oppTo"],
      diff: ["turnovers.diff", "topg.diff", "to.diff"],
    },
  },
  {
    key: "fouls",
    kind: "number",
    aliases: {
      team: ["fouls.team", "pfpg.team", "pf.team", "totals.pf", "pf"],
      opponent: ["fouls.opp", "pfpg.opp", "pf.opp", "oppPf"],
      diff: ["fouls.diff", "pfpg.diff", "pf.diff"],
    },
  },
] as const satisfies readonly LeagueComparisonMetricDefinition[];

export function buildLeagueComparisons(args: {
  builtAt: string;
  teamSnapshots: readonly LeagueComparisonTeamSnapshot[];
}): LeagueComparisonsResult {
  const offense = args.teamSnapshots
    .map((snapshot) => buildOffenseRow(snapshot))
    .sort(compareLeagueRowsByStandingsIndex);
  const defense = args.teamSnapshots
    .map((snapshot) => buildDefenseRow(snapshot))
    .sort(compareLeagueRowsByStandingsIndex);
  const payroll = args.teamSnapshots
    .map((snapshot) => buildPayrollRow(snapshot))
    .sort(compareLeagueRowsByStandingsIndex);
  const arena = args.teamSnapshots
    .map((snapshot) => buildArenaRow(snapshot))
    .sort(compareLeagueRowsByStandingsIndex);

  return {
    arena,
    builtAt: args.builtAt,
    defense,
    incompleteTeamCount: args.teamSnapshots.filter((snapshot) => snapshot.incomplete)
      .length,
    offense,
    payroll,
    season: findComparisonSeason(args.teamSnapshots),
  } satisfies LeagueComparisonsResult;
}

function buildOffenseRow(
  snapshot: LeagueComparisonTeamSnapshot,
): LeagueOffenseRow {
  return {
    ...buildLeagueRowBase(snapshot),
    assists: buildMetricTriplet(snapshot.teamStats, offenseMetricDefinitions[4]),
    effectiveFgPct: buildMetricTriplet(
      snapshot.teamStats,
      offenseMetricDefinitions[6],
    ),
    fgPct: buildMetricTriplet(snapshot.teamStats, offenseMetricDefinitions[1]),
    ftPct: buildMetricTriplet(snapshot.teamStats, offenseMetricDefinitions[3]),
    gamesPlayed: buildGamesPlayed(snapshot),
    offensiveRebounds: buildMetricTriplet(
      snapshot.teamStats,
      offenseMetricDefinitions[5],
    ),
    points: buildMetricTriplet(snapshot.teamStats, offenseMetricDefinitions[0]),
    threePtPct: buildMetricTriplet(
      snapshot.teamStats,
      offenseMetricDefinitions[2],
    ),
  } satisfies LeagueOffenseRow;
}

function buildDefenseRow(
  snapshot: LeagueComparisonTeamSnapshot,
): LeagueDefenseRow {
  return {
    ...buildLeagueRowBase(snapshot),
    blocks: buildMetricTriplet(snapshot.teamStats, defenseMetricDefinitions[1]),
    fouls: buildMetricTriplet(snapshot.teamStats, defenseMetricDefinitions[4]),
    gamesPlayed: buildGamesPlayed(snapshot),
    steals: buildMetricTriplet(snapshot.teamStats, defenseMetricDefinitions[2]),
    totalRebounds: buildMetricTriplet(
      snapshot.teamStats,
      defenseMetricDefinitions[0],
    ),
    turnovers: buildMetricTriplet(
      snapshot.teamStats,
      defenseMetricDefinitions[3],
    ),
  } satisfies LeagueDefenseRow;
}

function buildPayrollRow(
  snapshot: LeagueComparisonTeamSnapshot,
): LeaguePayrollRow {
  const summary = buildPayrollSummary(snapshot.rosterPlayers);

  return {
    ...buildLeagueRowBase(snapshot),
    averageSalary: summary.averageSalary,
    payrollRanks6To10: summary.payrollRanks6To10,
    playerCount: summary.playerCount,
    standardDeviation: summary.standardDeviation,
    top10Payroll: summary.top10Payroll,
    top5Payroll: summary.top5Payroll,
    top8Payroll: summary.top8Payroll,
    totalPayroll: summary.totalPayroll,
  } satisfies LeaguePayrollRow;
}

function buildArenaRow(snapshot: LeagueComparisonTeamSnapshot): LeagueArenaRow {
  const bleachers = readArenaCapacity(snapshot.arena, "bleachers");
  const lowerTier = readArenaCapacity(snapshot.arena, "lowerTier");
  const courtside = readArenaCapacity(snapshot.arena, "courtside");
  const luxuryBoxes = readArenaCapacity(snapshot.arena, "luxury");
  const capacities = [bleachers, lowerTier, courtside, luxuryBoxes].filter(
    (value): value is number => value !== null,
  );

  return {
    ...buildLeagueRowBase(snapshot),
    bleachers,
    courtside,
    lowerTier,
    luxuryBoxes,
    totalCapacity: capacities.length
      ? capacities.reduce((total, capacity) => total + capacity, 0)
      : null,
  } satisfies LeagueArenaRow;
}

function buildMetricTriplet(
  teamStats: BBApiTeamStats | null,
  metric: LeagueComparisonMetricDefinition,
): LeagueComparisonMetricTriplet | null {
  const diff = readMetricValue(teamStats, metric.aliases.diff, metric.kind);
  const opponent = readMetricValue(
    teamStats,
    metric.aliases.opponent,
    metric.kind,
  );
  const team = readMetricValue(teamStats, metric.aliases.team, metric.kind);

  if (team === null && opponent === null && diff === null) {
    return null;
  }

  return {
    diff,
    opponent,
    team,
  } satisfies LeagueComparisonMetricTriplet;
}

function buildLeagueRowBase(snapshot: LeagueComparisonTeamSnapshot) {
  return {
    conferenceIndex: snapshot.conferenceIndex,
    standingsIndex: snapshot.standingsIndex,
    teamId: snapshot.teamId,
    teamName: snapshot.teamName,
  };
}

function buildGamesPlayed(snapshot: LeagueComparisonTeamSnapshot): number | null {
  if (
    typeof snapshot.wins !== "number" ||
    typeof snapshot.losses !== "number"
  ) {
    return null;
  }

  return snapshot.wins + snapshot.losses;
}

function buildPayrollSummary(
  rosterPlayers: readonly BBApiRosterPlayer[] | null,
): {
  averageSalary: number | null;
  payrollRanks6To10: number | null;
  playerCount: number | null;
  standardDeviation: number | null;
  top10Payroll: number | null;
  top5Payroll: number | null;
  top8Payroll: number | null;
  totalPayroll: number | null;
} {
  if (!rosterPlayers) {
    return {
      averageSalary: null,
      payrollRanks6To10: null,
      playerCount: null,
      standardDeviation: null,
      top10Payroll: null,
      top5Payroll: null,
      top8Payroll: null,
      totalPayroll: null,
    };
  }

  const salaries = rosterPlayers
    .map((player) => asFiniteNumber(player.salary))
    .filter((salary): salary is number => salary !== null)
    .sort((left, right) => right - left);

  if (!salaries.length) {
    return {
      averageSalary: null,
      payrollRanks6To10: 0,
      playerCount: rosterPlayers.length,
      standardDeviation: null,
      top10Payroll: 0,
      top5Payroll: 0,
      top8Payroll: 0,
      totalPayroll: 0,
    };
  }

  const totalPayroll = sumValues(salaries);
  const averageSalary = totalPayroll / salaries.length;

  return {
    averageSalary: roundToInteger(averageSalary),
    payrollRanks6To10: sumSlice(salaries, 5, 10),
    playerCount: rosterPlayers.length,
    standardDeviation: roundToInteger(calculatePopulationStandardDeviation(salaries)),
    top10Payroll: sumSlice(salaries, 0, 10),
    top5Payroll: sumSlice(salaries, 0, 5),
    top8Payroll: sumSlice(salaries, 0, 8),
    totalPayroll: roundToInteger(totalPayroll),
  };
}

function calculatePopulationStandardDeviation(values: readonly number[]): number {
  if (!values.length) {
    return 0;
  }

  const mean = sumValues(values) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
}

function compareLeagueRowsByStandingsIndex(
  left:
    | LeagueArenaRow
    | LeagueDefenseRow
    | LeagueOffenseRow
    | LeaguePayrollRow,
  right:
    | LeagueArenaRow
    | LeagueDefenseRow
    | LeagueOffenseRow
    | LeaguePayrollRow,
): number {
  return left.standingsIndex - right.standingsIndex;
}

function findComparisonSeason(
  teamSnapshots: readonly LeagueComparisonTeamSnapshot[],
): number | null {
  for (const snapshot of teamSnapshots) {
    const season = asFiniteNumber(snapshot.teamStats?.season);
    if (season !== null) {
      return season;
    }
  }

  return null;
}

function readArenaCapacity(
  arena: BBApiArena | null,
  section: "bleachers" | "courtside" | "lowerTier" | "luxury",
): number | null {
  return asFiniteNumber(arena?.seats?.[section]?.capacity);
}

function readMetricValue(
  teamStats: BBApiTeamStats | null,
  aliases: readonly string[],
  kind: LeagueComparisonMetricKind,
): number | null {
  for (const alias of aliases) {
    const value = readNumericStat(teamStats, alias);
    if (value !== null) {
      return normalizeMetricValue(value, kind);
    }
  }

  return null;
}

function normalizeMetricValue(
  value: number,
  kind: LeagueComparisonMetricKind,
): number {
  const normalized =
    kind === "percentage" && Math.abs(value) <= 1 ? value * 100 : value;
  return roundToOneDecimal(normalized);
}

function readNumericStat(
  teamStats: BBApiTeamStats | null,
  alias: string,
): number | null {
  if (!teamStats) {
    return null;
  }

  const segments = alias.split(".");
  if (segments.length === 1) {
    const fieldKey = segments[0] as string;
    return (
      asFiniteNumber(teamStats.fields[fieldKey]) ??
      asFiniteNumber(teamStats.categories[fieldKey]?.value) ??
      asFiniteNumber(teamStats.categories[fieldKey]?.team)
    );
  }

  if (segments.length !== 2) {
    return null;
  }

  const categoryKey = segments[0] as string;
  const valueKey = segments[1] as string;
  if (categoryKey === "fields") {
    return asFiniteNumber(teamStats.fields[valueKey]);
  }

  return asFiniteNumber(teamStats.categories[categoryKey]?.[valueKey]);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function roundToInteger(value: number): number {
  return Math.round(value);
}

function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function sumSlice(
  values: readonly number[],
  startIndex: number,
  endIndex: number,
): number {
  return roundToInteger(sumValues(values.slice(startIndex, endIndex)));
}

function sumValues(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export const __testing = {
  buildLeagueComparisons,
  buildMetricTriplet,
  buildPayrollSummary,
  normalizeMetricValue,
  readNumericStat,
};
