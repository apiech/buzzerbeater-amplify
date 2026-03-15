export type BBApiNamedReference = {
  id: string | null;
  name: string | null;
  attributes?: Record<string, string | null>;
};

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
  id: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  salary: number | null;
  bestPosition: string | null;
  age: number | null;
  height: number | null;
  dmi: number | null;
  injuryWeeks: number | null;
  nationality: BBApiNamedReference | null;
  skills: Record<string, number | string | null>;
  fields: Record<string, unknown>;
};

export type BBApiRoster = {
  version: string;
  retrievedAt: string | null;
  teamId: string | null;
  teamName: string | null;
  players: BBApiRosterPlayer[];
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

export type BBApiBoxScorePlayer = {
  id: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  performance: Record<string, number | string | null>;
  minutesByPosition: Record<string, number | null>;
  details: Record<string, unknown>;
};

export type BBApiBoxScoreTeam = {
  id: string | null;
  teamName: string | null;
  shortName: string | null;
  offStrategy: string | null;
  defStrategy: string | null;
  score: number | null;
  partialScores: number[];
  teamTotals: Record<string, number | string | null>;
  ratings: Record<string, number | string | null>;
  efficiency: Record<string, number | string | null>;
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
  roster: BBApiRoster;
  schedule: BBApiSchedule;
  standings: BBApiStandings | null;
  teamStats: BBApiTeamStats | null;
};
