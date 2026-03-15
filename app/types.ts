import type { Schema } from "@/amplify/data/resource";

export type JsonRecord = Record<string, unknown>;

export type BbConnectionRecord = Schema["BbConnection"]["type"];
export type ConnectionStatus = BbConnectionRecord["status"];
export type PredictionJobRecord = Schema["PredictionJob"]["type"];
export type PredictionJobStatus = PredictionJobRecord["status"];
export type SyncRunRecord = Schema["SyncRun"]["type"];
export type SavedLineupScenarioRecord = Schema["SavedLineupScenario"]["type"];
export type SharedPlayerCardRecord = Schema["SharedPlayerCard"]["type"];

export type ConnectBbAccountInput = {
  bbLoginName: string;
  accessKey: string;
};

export type ConnectBbAccountResult = NonNullable<
  Schema["connectBbAccount"]["returnType"]
>;

export type DisconnectBbAccountResult = NonNullable<
  Schema["disconnectBbAccount"]["returnType"]
>;
export type SubmitPredictionJobResult = NonNullable<
  Schema["submitPredictionJob"]["returnType"]
>;
export type SharedPlayerCardResult = NonNullable<
  Schema["generateSharedPlayerCard"]["returnType"]
>;
export type LineupPlan = NonNullable<Schema["getLineupPlan"]["returnType"]>;
export type LineupScenario = NonNullable<
  Schema["saveLineupScenario"]["returnType"]
>;
export type SalaryProjection = NonNullable<
  Schema["getSalaryProjection"]["returnType"]
>;

export type WorkspaceResponse = NonNullable<Schema["getHomeWorkspace"]["returnType"]>;
export type JsonLookupResponse = NonNullable<
  Schema["getPlayerTrend"]["returnType"]
>;

export type TeamRecordSummary = {
  wins: number | null;
  losses: number | null;
};

export type InjurySummary = {
  playerId: string | null;
  fullName: string;
  injuryWeeks: number | null;
};

export type PlayerSummary = {
  playerId: string | null;
  fullName: string;
  bestPosition: string | null;
  salary: number | null;
  age?: number | null;
  gameShape?: string | null;
  dmi?: number | null;
  injuryWeeks?: number | null;
  projectedStarterCount?: number | null;
  stats?: JsonRecord | null;
};

export type TendenciesSummary = {
  offense: Record<string, number>;
  defense: Record<string, number>;
};

export type MatchSummary = {
  matchId: string | null;
  startTime: string | null;
  type: string | null;
  opponentTeamName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  outcome: string | null;
  hasBoxscore?: boolean | null;
};

export type OpponentSummary = {
  teamId: string | null;
  teamName: string | null;
  wins: number | null;
  losses: number | null;
  pointMargin: number | null;
};

export type LeagueIntelPayload = {
  league: {
    id?: string | null;
    name?: string | null;
  } | null;
  standings: Array<{
    index: number;
    teams: Array<{
      teamId: string | null;
      teamName: string | null;
      wins: number | null;
      losses: number | null;
      pointMargin: number | null;
    }>;
  }>;
};

export type HomeWorkspacePayload = {
  connection: BbConnectionRecord;
  team: {
    teamId: string | null;
    teamName: string | null;
    shortName: string | null;
    record: TeamRecordSummary | null;
    injuries: InjurySummary[];
    topPlayers: PlayerSummary[];
  };
  nextMatch: {
    matchId: string | null;
    startTime: string | null;
    type: string | null;
    opponentTeamId: string | null;
    opponentTeamName: string | null;
    isHome: boolean | null;
  } | null;
  nextOpponent: {
    teamId: string | null;
    teamName: string | null;
    record: TeamRecordSummary | null;
    injuries: InjurySummary[];
    tendencies: TendenciesSummary;
  } | null;
  recentMatches: MatchSummary[];
  league: LeagueIntelPayload;
};

export type TeamHubPayload = {
  team: JsonRecord;
  roster: PlayerSummary[];
};

export type ScoutWorkspacePayload = {
  teamId: string | null;
  availableOpponents: OpponentSummary[];
  recentMatchups: MatchSummary[];
  summary: {
    teamName: string | null;
    nextMatch: JsonRecord | null;
    record: TeamRecordSummary | null;
    matchupPerspective: {
      ourTeamId: string | null;
      opponentTeamId: string | null;
    };
    tendencies: TendenciesSummary;
    topPlayers: PlayerSummary[];
    recentGames: MatchSummary[];
  } | null;
  message?: string | null;
  requestedTeamId?: string | null;
};

export type PlayerLabPayload = {
  players: PlayerSummary[];
};

export type PlayerTrendPoint = {
  weekKey: string | null;
  fetchedAt: string | null;
  salary: number | null;
  dmi: number | null;
  injuryWeeks: number | null;
  gameShape: string | null;
};

export type PlayerTrendPayload = {
  player: JsonRecord;
  history: PlayerTrendPoint[];
};

export type MatchBoxscorePayload = {
  matchId: string;
  opponentTeamName: string | null;
  offStrategy: string | null;
  defStrategy: string | null;
  opponentOffStrategy: string | null;
  opponentDefStrategy: string | null;
  teamRatings: JsonRecord | null;
  opponentRatings: JsonRecord | null;
  teamEfficiency: JsonRecord | null;
  opponentEfficiency: JsonRecord | null;
  boxscore: JsonRecord | null;
};

export type SharedPlayerCardLookupPayload = {
  shareToken: string;
  shareUrl: string;
  title: string | null;
  note: string | null;
  expiresAt: string | null;
  revokedAt?: string | null;
  payload: JsonRecord;
};

export type DashboardWorkspace = {
  home: HomeWorkspacePayload;
  teamHub: TeamHubPayload;
  scout: ScoutWorkspacePayload;
  leagueIntel: LeagueIntelPayload;
  playerLab: PlayerLabPayload;
  syncedAt: string | null;
};

export type ManualPredictionInput = {
  home_outsideScoring: number;
  home_insideScoring: number;
  home_outsideDefense: number;
  home_insideDefense: number;
  home_rebounding: number;
  home_offensiveFlow: number;
  away_outsideScoring: number;
  away_insideScoring: number;
  away_outsideDefense: number;
  away_insideDefense: number;
  away_rebounding: number;
  away_offensiveFlow: number;
  home_offStrategy: string;
  home_defStrategy: string;
  away_offStrategy: string;
  away_defStrategy: string;
  neutral: string;
  effortDelta: number;
  home_gdp_focus: string;
  home_gdp_pace: string;
  away_gdp_focus: string;
  away_gdp_pace: string;
};

export type ConnectedPredictionInput = {
  homeSourceMatchId?: string;
  awaySourceMatchId?: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  home_offStrategy?: string;
  home_defStrategy?: string;
  away_offStrategy?: string;
  away_defStrategy?: string;
  neutral?: string;
  effortDelta?: number;
  home_gdp_focus?: string;
  home_gdp_pace?: string;
  away_gdp_focus?: string;
  away_gdp_pace?: string;
  manualFallback?: ManualPredictionInput;
};

export type PredictionSubmissionRequest =
  | {
      mode: "MANUAL";
      manualInput: ManualPredictionInput;
    }
  | {
      mode: "CONNECTED";
      connectedInput: ConnectedPredictionInput;
    };

export type PredictionResult = {
  homeScore: number;
  awayScore: number;
  pointDiff: number;
  modelVersion: string;
};
