import type { TeamRatings } from "../buzzerbeater/team-ratings";

export type BBApiNamedReference = {
  id: string | null;
  name: string | null;
  attributes?: Record<string, string | null>;
};

export type BBApiRequiredNamedReference = {
  id: string;
  name: string;
  attributes?: Record<string, string | null>;
};

export const PUBLIC_ROSTER_SKILL_KEYS = [
  "gameShape",
  "potential",
] as const;

export const OWNED_ROSTER_SKILL_KEYS = [
  "gameShape",
  "potential",
  "jumpShot",
  "range",
  "outsideDef",
  "handling",
  "driving",
  "passing",
  "insideShot",
  "insideDef",
  "rebound",
  "block",
  "stamina",
  "freeThrow",
  "experience",
] as const;

export type BBApiPublicRosterPlayerSkills = Record<
  (typeof PUBLIC_ROSTER_SKILL_KEYS)[number],
  number
>;

export type BBApiOwnedRosterPlayerSkills = Record<
  (typeof OWNED_ROSTER_SKILL_KEYS)[number],
  number
>;

export type BBApiRosterPlayerSkills =
  | BBApiPublicRosterPlayerSkills
  | BBApiOwnedRosterPlayerSkills;

export type BBApiTeamInfo = {
  version: string;
  retrievedAt: string | null;
  teamId: string | null;
  teamName: string | null;
  shortName: string | null;
  ownerName: string | null;
  isBot: boolean;
  league: BBApiNamedReference | null;
  country: BBApiNamedReference | null;
  rival: BBApiNamedReference | null;
  fields: Record<string, unknown>;
};

export type BBApiRosterPlayer = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  salary: number;
  bestPosition: string;
  age: number;
  height: number;
  dmi: number;
  injuryWeeks: number;
  nationality: BBApiRequiredNamedReference;
  skills: BBApiRosterPlayerSkills;
};

export type BBApiRoster = {
  version: string;
  retrievedAt: string;
  teamId: string;
  players: BBApiRosterPlayer[];
};

export type BBApiOwnedRosterPlayer = Omit<BBApiRosterPlayer, "skills"> & {
  skills: BBApiOwnedRosterPlayerSkills;
};

export type BBApiOwnedRoster = Omit<BBApiRoster, "players"> & {
  players: BBApiOwnedRosterPlayer[];
};

export type BBApiPlayer = {
  version: string;
  retrievedAt: string | null;
  playerId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  salary: number | null;
  bestPosition: string | null;
  age: number | null;
  fields: Record<string, unknown>;
};

export type BBApiScheduleMatchSide = {
  id: string | null;
  teamName: string | null;
  score: number | null;
};

export type BBApiScheduleMatch = {
  id: string | null;
  startTime: string | null;
  type: string | null;
  awayTeam: BBApiScheduleMatchSide;
  homeTeam: BBApiScheduleMatchSide;
};

export type BBApiSchedule = {
  version: string;
  retrievedAt: string | null;
  teamId: string | null;
  season: number | null;
  matches: BBApiScheduleMatch[];
};

export type BBApiSeason = {
  id: number | null;
  start: string | null;
  finish: string | null;
};

export type BBApiSeasons = {
  version: string;
  seasons: BBApiSeason[];
};

export type BBApiConferenceTeam = {
  id: string | null;
  teamName: string | null;
  wins: number | null;
  losses: number | null;
  pf: number | null;
  pa: number | null;
  isBot: boolean | null;
  forfeits: number | null;
  fields: Record<string, unknown>;
};

export type BBApiConferenceStandings = {
  index: number;
  teams: BBApiConferenceTeam[];
};

export type BBApiBracketSection = {
  name: string;
  matches: BBApiScheduleMatch[];
};

export type BBApiStandings = {
  version: string;
  retrievedAt: string | null;
  season: number | null;
  league: BBApiNamedReference | null;
  country: BBApiNamedReference | null;
  conferences: BBApiConferenceStandings[];
  brackets: BBApiBracketSection[];
};

export const BOX_SCORE_PLAYER_PERFORMANCE_STAT_KEYS = [
  "fgm",
  "fga",
  "tpm",
  "tpa",
  "ftm",
  "fta",
  "oreb",
  "reb",
  "ast",
  "to",
  "stl",
  "blk",
  "pf",
  "pts",
] as const;

export type BBApiBoxScorePlayerPerformanceStatKey =
  (typeof BOX_SCORE_PLAYER_PERFORMANCE_STAT_KEYS)[number];

export type BBApiBoxScorePlayerPerformanceStats = Record<
  BBApiBoxScorePlayerPerformanceStatKey,
  number
>;

export type BBApiBoxScorePlayer = {
  id: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  didNotPlay: boolean;
  minutesByPosition: Record<string, number>;
  performanceStats: BBApiBoxScorePlayerPerformanceStats;
  ratingRaw: string | null;
  ratingValue: number | null;
  details: Record<string, unknown>;
};

export type BBApiBoxScoreTeamRatings = TeamRatings;

export type BBApiBoxScoreTeam = {
  id: string | null;
  teamName: string | null;
  shortName: string | null;
  offStrategy: string | null;
  defStrategy: string | null;
  score: number | null;
  partialScores: number[];
  teamTotals: Record<string, number>;
  ratings: BBApiBoxScoreTeamRatings | null;
  efficiency: Record<string, number>;
  gdp: Record<string, number | string | null>;
  players: BBApiBoxScorePlayer[];
  details: Record<string, unknown>;
};

export type BBApiBoxScore = {
  version: string;
  retrievedAt: string | null;
  matchId: string | null;
  type: string | null;
  startTime: string | null;
  endTime: string | null;
  neutral: boolean | null;
  effortDelta: number | null;
  attendance: Record<string, number | null>;
  awayTeam: BBApiBoxScoreTeam;
  homeTeam: BBApiBoxScoreTeam;
  details: Record<string, unknown>;
};

export type BBApiArenaSeat = {
  section: string;
  capacity: number | null;
  price: number | null;
  nextPrice: number | null;
};

export type BBApiArena = {
  version: string;
  retrievedAt: string | null;
  teamId: string | null;
  name: string | null;
  seats: Record<string, BBApiArenaSeat>;
  expansion: {
    daysLeft: number | null;
    sections: Record<string, number | null>;
  } | null;
};

export type BBApiEconomyTransaction = {
  kind: string | null;
  amount: number | string | null;
  date: string | null;
  attributes: Record<string, string | null>;
  fields: Record<string, unknown>;
};

export type BBApiEconomy = {
  version: string;
  retrievedAt: string | null;
  fields: Record<string, unknown>;
  transactions: BBApiEconomyTransaction[];
};

export type BBApiTeamStats = {
  version: string;
  retrievedAt: string | null;
  teamId: string | null;
  season: number | null;
  mode: string | null;
  fields: Record<string, unknown>;
  categories: Record<string, Record<string, number | string | null>>;
  players: Array<{
    id: string | null;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    stats: Record<string, number | string | null>;
  }>;
};

export type BBApiLeague = {
  id: string | null;
  name: string | null;
  level: number | null;
  attributes: Record<string, string | null>;
};

export type BBApiLeagues = {
  version: string;
  retrievedAt: string | null;
  country: BBApiNamedReference | null;
  level: number | null;
  leagues: BBApiLeague[];
};

export type BBApiCurrentWorkspace = {
  teamInfo: BBApiTeamInfo;
  roster: BBApiOwnedRoster;
  schedule: BBApiSchedule;
  standings: BBApiStandings | null;
  teamStats: BBApiTeamStats | null;
  arena: BBApiArena;
  economy: BBApiEconomy;
};
