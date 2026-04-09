export const TEAM_RATING_KEYS = [
  "outsideScoring",
  "insideScoring",
  "outsideDefense",
  "insideDefense",
  "rebounding",
  "offensiveFlow",
] as const;

export type TeamRatingKey = (typeof TEAM_RATING_KEYS)[number];

export type TeamRatings = Record<TeamRatingKey, number>;
