import type { Schema } from "../../amplify/data/resource";

export const PREDICTION_RATING_SUFFIXES = [
  "outsideScoring",
  "insideScoring",
  "outsideDefense",
  "insideDefense",
  "rebounding",
  "offensiveFlow",
] as const;

export const PREDICTION_HOME_OFFENSE_OPTIONS = [
  "Base",
  "Push",
  "Patient",
  "Motion",
  "RunAndGun",
  "Princeton",
  "LookInside",
  "LowPost",
  "InsideIsolation",
  "OutsideIsolation",
] as const;

export const PREDICTION_AWAY_DEFENSE_OPTIONS = [
  "ManToMan",
  "23Zone",
  "32Zone",
  "131Zone",
  "InsideBoxAndOne",
  "OutsideBoxAndOne",
] as const;

export const FIXED_HOME_OFFENSE = "Base";
export const FIXED_HOME_DEFENSE = "ManToMan";
export const FIXED_AWAY_OFFENSE = "Base";
export const FIXED_AWAY_DEFENSE = "ManToMan";
export const PREDICTION_HOME_COURT_FACTOR = 1.06;

type RatingSuffix = (typeof PREDICTION_RATING_SUFFIXES)[number];
type TeamPrefix = "home" | "away";
type MatchBoxscorePayload = NonNullable<Schema["getMatchBoxscoreDetails"]["returnType"]>;
export type PredictionInputShape = Schema["PredictionManualInput"]["type"];
type TeamSide = NonNullable<MatchBoxscorePayload["homeTeam"]>;
type TeamLocation = "HOME" | "AWAY";
type TeamRatingMap = Record<RatingSuffix, number>;
type TacticCoefficients = Record<string, TeamRatingMap>;

const OFFENSE_TACTIC_COEFFICIENTS: TacticCoefficients = {
  Base: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1,
  },
  Push: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1.02,
  },
  Patient: {
    outsideScoring: 1,
    insideScoring: 1.02,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1.02,
  },
  OutsideIsolation: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1,
  },
  InsideIsolation: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1,
  },
  LookInside: {
    outsideScoring: 0.9,
    insideScoring: 1.14,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1.02,
    offensiveFlow: 1.04,
  },
  LowPost: {
    outsideScoring: 0.9,
    insideScoring: 1.16,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1.06,
    offensiveFlow: 1,
  },
  RunAndGun: {
    outsideScoring: 1.18,
    insideScoring: 0.86,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 0.9,
    offensiveFlow: 1.02,
  },
  Motion: {
    outsideScoring: 1.23,
    insideScoring: 0.86,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 0.92,
    offensiveFlow: 1.04,
  },
  Princeton: {
    outsideScoring: 1.19,
    insideScoring: 0.88,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 0.92,
    offensiveFlow: 1.06,
  },
};

const DEFENSE_TACTIC_COEFFICIENTS: TacticCoefficients = {
  ManToMan: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1,
  },
  "32Zone": {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1.1,
    insideDefense: 0.88,
    rebounding: 0.98,
    offensiveFlow: 1,
  },
  "131Zone": {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1.19,
    insideDefense: 0.81,
    rebounding: 0.84,
    offensiveFlow: 1,
  },
  "23Zone": {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 0.76,
    insideDefense: 1.14,
    rebounding: 1.14,
    offensiveFlow: 1,
  },
  InsideBoxAndOne: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1,
  },
  OutsideBoxAndOne: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 1,
    insideDefense: 1,
    rebounding: 1,
    offensiveFlow: 1,
  },
  Press: {
    outsideScoring: 1,
    insideScoring: 1,
    outsideDefense: 0.94,
    insideDefense: 0.94,
    rebounding: 0.82,
    offensiveFlow: 1,
  },
};

export function normalizePredictionRatingsFromBoxscore(args: {
  sourceTeam: TeamSide;
  teamLocation: TeamLocation;
}): TeamRatingMap {
  const rawRatings = readTeamRatings(args.sourceTeam);
  const normalized = { ...rawRatings };
  const offenseCoefficients = resolveOffenseCoefficients(
    args.sourceTeam.offStrategy,
  );
  const defenseCoefficients = resolveDefenseCoefficients(
    args.sourceTeam.defStrategy,
  );

  for (const suffix of PREDICTION_RATING_SUFFIXES) {
    normalized[suffix] = normalized[suffix] / offenseCoefficients[suffix];
    normalized[suffix] = normalized[suffix] / defenseCoefficients[suffix];
  }

  if (args.teamLocation === "HOME") {
    normalized.outsideDefense =
      normalized.outsideDefense / PREDICTION_HOME_COURT_FACTOR;
    normalized.insideDefense =
      normalized.insideDefense / PREDICTION_HOME_COURT_FACTOR;
    normalized.rebounding =
      normalized.rebounding / PREDICTION_HOME_COURT_FACTOR;
  }

  return normalized;
}

export function applyBoxscoreRatingsToPredictionInput(args: {
  input: PredictionInputShape;
  sourceTeam: TeamSide;
  side: TeamPrefix;
  teamLocation: TeamLocation;
}): PredictionInputShape {
  const normalizedRatings = normalizePredictionRatingsFromBoxscore({
    sourceTeam: args.sourceTeam,
    teamLocation: args.teamLocation,
  });
  const nextInput = { ...args.input };

  for (const suffix of PREDICTION_RATING_SUFFIXES) {
    nextInput[`${args.side}_${suffix}`] = roundPredictionValue(
      normalizedRatings[suffix],
    );
  }

  return nextInput;
}

export function buildModelInputFromPredictionInput(
  input: PredictionInputShape,
): Record<string, number | string> {
  return {
    ...input,
    home_offStrategy: FIXED_HOME_OFFENSE,
    home_defStrategy: FIXED_HOME_DEFENSE,
    away_offStrategy: FIXED_AWAY_OFFENSE,
    away_defStrategy: FIXED_AWAY_DEFENSE,
  };
}

function readTeamRatings(team: TeamSide): TeamRatingMap {
  const entries = new Map<string, number | null | undefined>(
    team.ratings.map((entry) => [entry.key, entry.numberValue]),
  );

  return Object.fromEntries(
    PREDICTION_RATING_SUFFIXES.map((suffix) => [
      suffix,
      requireFiniteNumber(entries.get(suffix), `ratings.${suffix}`),
    ]),
  ) as TeamRatingMap;
}

function requireFiniteNumber(value: number | null | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Source boxscore is missing ${label}.`);
}

function roundPredictionValue(value: number): number {
  return Number(value.toFixed(3));
}

function resolveOffenseCoefficients(strategy: string | null | undefined): TeamRatingMap {
  const fallback = OFFENSE_TACTIC_COEFFICIENTS[FIXED_HOME_OFFENSE];
  return OFFENSE_TACTIC_COEFFICIENTS[strategy ?? FIXED_HOME_OFFENSE] ?? fallback!;
}

function resolveDefenseCoefficients(strategy: string | null | undefined): TeamRatingMap {
  const fallback = DEFENSE_TACTIC_COEFFICIENTS[FIXED_HOME_DEFENSE];
  return DEFENSE_TACTIC_COEFFICIENTS[strategy ?? FIXED_HOME_DEFENSE] ?? fallback!;
}
