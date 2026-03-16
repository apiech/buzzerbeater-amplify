export const POSITION_SEQUENCE = ["PG", "SG", "SF", "PF", "C"] as const;
export const RATING_SEQUENCE = [
  "outsideScoring",
  "insideScoring",
  "outsideDefense",
  "insideDefense",
  "rebounding",
  "offensiveFlow",
] as const;
export const SKILL_SEQUENCE = ["JS", "JR", "OD", "HA", "DR", "PA", "IS", "ID", "RB", "SB"] as const;

export type Position = (typeof POSITION_SEQUENCE)[number];
export type Rating = (typeof RATING_SEQUENCE)[number];
export type SkillKey = (typeof SKILL_SEQUENCE)[number];

export type CoachParrotContext = {
  offense: string;
  defense: string;
  enthusiasm: number;
  homeCourt: string;
};

export type RawPlayerSkills = {
  playerId: string;
  name: string;
  js: number;
  jr: number;
  od: number;
  ha: number;
  dr: number;
  pa: number;
  is: number;
  id: number;
  rb: number;
  sb: number;
  st: number;
  ft: number;
  ex: number;
  gs: number;
  age?: number | null;
  salary?: number | null;
  metadata?: Record<string, unknown>;
};

export type CoachParrotRoster = {
  players: RawPlayerSkills[];
};

export type LineupAssignment = {
  position: Position;
  playerId: string;
  minutes: number;
};

export type RankingEntry = {
  playerId: string;
  name: string;
  output: number;
};

export type CoachParrotEvaluation = {
  version: string;
  context: CoachParrotContext;
  rawRatings: Record<Rating, number>;
  roundedRatings: Record<Rating, number>;
  ratingLabels: Record<Rating, string>;
  outputBandLabels: Record<Rating, string>;
  totalOutput: number;
  perPositionContributions: Record<Rating, Record<Position, number>>;
  playerPositionOutputs: Record<string, Record<Position, number>>;
  chosenLineup: LineupAssignment[];
  warnings: string[];
  rankings: Record<Position, RankingEntry[]>;
};

export type CoachParrotSample = {
  context: {
    offense: string;
    defense: string;
    enthusiasm: number;
    home_court: string;
  };
  players: Array<{
    player_id: string;
    name: string;
    skills: Record<SkillKey, number>;
    st: number;
    ft: number;
    ex: number;
    gs: number;
    position_outputs: Record<Position, number>;
  }>;
  lineup: Array<{
    position: Position;
    player_id: string;
    minutes: number;
  }>;
  ratings: Record<
    Rating,
    {
      raw: number;
      rounded: number;
      label: string;
      band: string;
    }
  >;
  position_outputs: Record<string, Record<Position, number>>;
};

export type CoachParrotArtifacts = {
  version: string;
  extracted_from: string;
  dictionary: Record<string, string>;
  rating_word_labels: Record<string, string>;
  fractional_band_labels: Record<string, string>;
  gs_slopes: Record<Rating, number>;
  default_minutes: number;
  coefficients: Record<Position, Record<Rating, Record<SkillKey, number>>>;
  tactic_energy: Record<string, Record<Rating, { exponent: number; base: number }>>;
  sample: CoachParrotSample;
};

