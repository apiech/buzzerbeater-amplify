export enum PositionCode {
  PG = "PG",
  SG = "SG",
  SF = "SF",
  PF = "PF",
  C = "C",
}

export enum LineupHelperAlgorithm {
  EXACT = "EXACT",
  LEGACY_HEURISTIC = "LEGACY_HEURISTIC",
}

export enum RecapGenerationApproach {
  FACT_LIBRARY_FIRST = "FACT_LIBRARY_FIRST",
  LEGACY = "LEGACY",
  SIMPLE_FACT_LIBRARY = "SIMPLE_FACT_LIBRARY",
}

export enum RecapInterviewIntensity {
  CLEAN = "clean",
  FULL_HEAT = "full_heat",
  NONE = "none",
  PG13 = "pg13",
}

export enum TeamHighlightsPerspective {
  AGAINST = "AGAINST",
  BOTH = "BOTH",
  FOR = "FOR",
}
