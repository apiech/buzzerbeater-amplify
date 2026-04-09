import type { Schema } from "@/amplify/data/resource";
import type { PlanId } from "@/lib/billing/plans";
import type {
  CurrentPredictionForecastContextShape,
  CurrentPredictionPreviewShape,
  PredictionEndpointTacticsGrid,
  PredictionGridCellShape,
} from "@/lib/prediction/contracts";

export type JsonRecord = Record<string, unknown>;

export type BillingAccountRecord = Schema["BillingAccount"]["type"];
export type BillingSummary = NonNullable<
  Schema["getBillingSummary"]["returnType"]
>;
export type BillingPaymentEntry = NonNullable<
  NonNullable<Schema["listMyBillingPayments"]["returnType"]>["items"]
>[number];
export type BillingPaymentsPage = NonNullable<
  Schema["listMyBillingPayments"]["returnType"]
>;
export type BillingSessionResult = NonNullable<
  Schema["createBillingCheckoutSession"]["returnType"]
>;
export type BbConnectionRecord = Schema["BbConnection"]["type"];
export type ConnectionStatus = BbConnectionRecord["status"];
export type GameDayRecapRecord = Schema["GameDayRecap"]["type"];
export type GameDayRecapStatus = GameDayRecapRecord["status"];
export type LeagueGameDayRecapRecord = Schema["LeagueGameDayRecap"]["type"];
export type OpponentForecastJobRecord = Schema["OpponentForecastJob"]["type"];
export type PredictionJobRecord = Schema["PredictionJob"]["type"];
export type PredictionJobStatus = PredictionJobRecord["status"];
export type SyncRunRecord = Schema["SyncRun"]["type"];
export type SingleGameSummaryRecord = Schema["SingleGameSummary"]["type"];
export type SharedPlayerCardRecord = Schema["SharedPlayerCard"]["type"];
export type UserPreferenceRecord = Schema["UserPreference"]["type"];

export type OperationsActivity = {
  gameDayRecaps: GameDayRecapRecord[];
  leagueGameDayRecaps: LeagueGameDayRecapRecord[];
  currentPrediction: CurrentPredictionPreview | null;
  singleGameSummaries: SingleGameSummaryRecord[];
  syncRuns: SyncRunRecord[];
};

export type PaginatedResult<TItem> = {
  items: TItem[];
  nextToken: string | null;
};

export type RecapHistoryKind =
  | "LEAGUE_DATE"
  | "LEAGUE_GAME_DAY"
  | "SINGLE_GAME";

export type RecapHistoryRecord = {
  completedAt: string | null;
  coverageJson: unknown;
  error: string | null;
  gameDate: string | null;
  gameDayNumber: number | null;
  kind: RecapHistoryKind;
  leagueId: string | null;
  leagueName: string | null;
  matchId: string | null;
  requestJson: unknown;
  requestedAt: string;
  resultJson: unknown;
  selectionKey: string;
  season: number | null;
  status: string | null;
  targetKey: string;
  updatedAt: string;
};

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
export type SubmitGameDayRecapResult = NonNullable<
  Schema["submitGameDayRecap"]["returnType"]
>;
export type SubmitLeagueHistoryBackfillResult = NonNullable<
  Schema["submitLeagueHistoryBackfill"]["returnType"]
>;
export type SubmitLeagueGameDayRecapResult = NonNullable<
  Schema["submitLeagueGameDayRecap"]["returnType"]
>;
export type SubmitSingleGameSummaryResult = NonNullable<
  Schema["submitSingleGameSummary"]["returnType"]
>;
export type SubmitOpponentForecastJobResult = NonNullable<
  Schema["submitOpponentForecastJob"]["returnType"]
>;
export type SubmitPredictionJobResult = NonNullable<
  Schema["submitPredictionJob"]["returnType"]
>;
export type SubmitMyTeamHighlightsScanResult = NonNullable<
  Schema["submitMyTeamHighlightsScan"]["returnType"]
>;
export type SharedPlayerCardResult = NonNullable<
  Schema["generateSharedPlayerCard"]["returnType"]
>;
export type LineupHelperWorkspaceRecord = NonNullable<
  Schema["getLineupHelperWorkspace"]["returnType"]
>;
export type LineupHelperEvaluationRecord = NonNullable<
  Schema["evaluateLineupHelper"]["returnType"]
>;
export type SalaryProjection = NonNullable<
  Schema["getSalaryProjection"]["returnType"]
>;
export type HomeWorkspacePayload = NonNullable<
  Schema["getHomeWorkspace"]["returnType"]
>;
export type TeamHubPayload = NonNullable<Schema["getTeamHub"]["returnType"]>;
export type ScoutWorkspacePayload = NonNullable<
  Schema["getScoutWorkspace"]["returnType"]
>;
export type LeagueIntelPayload = NonNullable<
  Schema["getLeagueIntel"]["returnType"]
>;
export type LeagueHistoryPayload = NonNullable<
  Schema["getLeagueHistory"]["returnType"]
>;
export type OpponentForecastSnapshot = NonNullable<
  Schema["getLatestOpponentForecast"]["returnType"]
>;
export type PlayerLabPayload = NonNullable<
  Schema["getPlayerLab"]["returnType"]
>;
export type RivalsWorkspacePayload = NonNullable<
  Schema["getRivalsWorkspace"]["returnType"]
>;
export type PlayerTrendPayload = NonNullable<
  Schema["getPlayerTrend"]["returnType"]
>;
export type MatchBoxscorePayload = NonNullable<
  Schema["getMatchBoxscoreDetails"]["returnType"]
>;
export type TeamHighlightsPayload = NonNullable<
  Schema["getMyTeamHighlights"]["returnType"]
>;
export type SharedPlayerCardLookupPayload = NonNullable<
  Schema["lookupSharedPlayerCard"]["returnType"]
>;
export type AppPlanId = PlanId;
export type TeamRecordSummary = NonNullable<
  HomeWorkspacePayload["team"]["record"]
>;
export type InjurySummary = HomeWorkspacePayload["team"]["injuries"][number];
export type PlayerSummary = TeamHubPayload["roster"][number];
export type TrendCountEntry = NonNullable<
  NonNullable<HomeWorkspacePayload["nextOpponent"]>["tendencies"]
>["offense"][number];
export type TendenciesSummary = NonNullable<
  NonNullable<HomeWorkspacePayload["nextOpponent"]>["tendencies"]
>;

export type PositionCode = "PG" | "SG" | "SF" | "PF" | "C";

export type LineupHelperContext = {
  offense: string;
  defense: string;
  enthusiasm: number;
  homeCourt: string;
};

export type LineupHelperAssignment = {
  playerId: string;
  position: PositionCode;
  minutes: number;
};

export type LineupHelperRankingEntry = {
  playerId: string;
  name: string;
  output: number;
};

export type LineupHelperSkillRatings = {
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
};

export type LineupHelperRosterPlayer = {
  playerId: string;
  fullName: string;
  bestPosition: string | null;
  salary: number | null;
  age: number | null;
  gameShape: string | null;
  dmi: number | null;
  injuryWeeks: number | null;
  snapshotWeekKey: string | null;
  snapshotCapturedAt: string | null;
  available: boolean;
  snapshotWarning: string | null;
  skills: LineupHelperSkillRatings;
};

export type LineupHelperEvaluation = {
  context: LineupHelperContext;
  normalizedLineup: LineupHelperAssignment[];
  rawRatings: Record<string, number>;
  roundedRatings: Record<string, number>;
  ratingLabels: Record<string, string>;
  outputBandLabels: Record<string, string>;
  warnings: string[];
  rankings: Record<PositionCode, LineupHelperRankingEntry[]>;
  playerPositionOutputs: Record<string, Record<PositionCode, number>>;
  perPositionContributions: Record<string, Record<PositionCode, number>>;
  totalOutput: number;
};

export type DecodedLineupHelperWorkspace = {
  generatedAt: string;
  syncedAt: string | null;
  roster: LineupHelperRosterPlayer[];
  defaultContext: LineupHelperContext;
  defaultAssignments: LineupHelperAssignment[];
  evaluation: LineupHelperEvaluation | null;
  snapshotWarnings: Array<{
    playerId: string;
    fullName: string;
    warning: string;
  }>;
  availableOffenses: string[];
  availableDefenses: string[];
  availableLocations: string[];
};
export type MatchSummary = HomeWorkspacePayload["recentMatches"][number];
export type OpponentSummary =
  ScoutWorkspacePayload["availableOpponents"][number];
export type OpponentForecastResult = NonNullable<
  OpponentForecastSnapshot["result"]
>;
export type OpponentForecastScenario =
  OpponentForecastResult["topScenarios"][number];
export type OpponentForecastPlayerProjection =
  OpponentForecastScenario["starters"][number];
export type OpponentForecastAnalogGame =
  OpponentForecastResult["analogGames"][number];
export type OpponentForecastSignal =
  OpponentForecastResult["featureSignals"][number];
export type PlayerTrendPoint = PlayerTrendPayload["history"][number];
export type MatchBoxscoreTeam = NonNullable<MatchBoxscorePayload["homeTeam"]>;
export type MatchMetricEntry = MatchBoxscoreTeam["teamTotals"][number];
export type MatchBoxscoreTeamRatings = NonNullable<MatchBoxscoreTeam["ratings"]>;
export type MatchBoxscorePlayerLine = MatchBoxscoreTeam["players"][number];

export type GameDayRecapCoveragePayload = {
  availableGames: number;
  missingGames: Array<{
    awayTeamName: string;
    homeTeamName: string;
    matchId: string;
    reason: string;
  }>;
  partial: boolean;
  requestedGames: number;
};

export type GameDayRecapResultPayload = {
  games: Array<{
    evidenceTags: string[];
    headline: string;
    matchId: string;
    writeup: string;
  }>;
  summary: {
    headline: string;
    lede: string;
  };
};
export type TeamHighlightsScanStatus = NonNullable<
  TeamHighlightsPayload["scanStatus"]
>;
export type TeamHighlightsMoment = TeamHighlightsPayload["items"][number];
export type LeagueHistoryBackfillStatus = NonNullable<
  LeagueHistoryPayload["status"]
>;
export type LeagueHistoryRow = LeagueHistoryPayload["rows"][number];

export type DashboardWorkspace = {
  home: HomeWorkspacePayload;
  lineupHelper: LineupHelperWorkspaceRecord;
  scout: ScoutWorkspacePayload;
  leagueIntel: LeagueIntelPayload;
  playerLab: PlayerLabPayload;
  syncedAt: string | null;
};

export type PredictionInput = {
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
  home_gdp_focus: string;
  home_gdp_pace: string;
  away_gdp_focus: string;
  away_gdp_pace: string;
  neutral: string;
  effortDelta: number;
};

export type PredictionForecastContext = {
  forecastJobId: string;
  forecastModelVersion: string;
  forecastGeneratedAt: string;
  scenarioId: string;
  scenarioLabel: string;
  scenarioProbability: number;
  enthusiasmBand?: string | null;
  evidence: string[];
  sourceTeamId: string;
};

export type PredictionSourceSelection = {
  homeSourceMatchId: string;
  awaySourceMatchId: string;
};

export type PredictionForecastAppliedValues = {
  effortDelta: number;
};

export type PredictionSubmissionRequest = {
  input: PredictionInput;
  forecastContext?: PredictionForecastContext;
};

export type PredictionForecastPrefill = {
  context: PredictionForecastContext;
  appliedValues: PredictionForecastAppliedValues;
  previousValues: PredictionForecastAppliedValues;
};

export type PredictionDraftState = {
  input: PredictionInput;
  forecastPrefill: PredictionForecastPrefill | null;
  sourceSelection: PredictionSourceSelection;
};

export type LegacyConnectedPredictionInput = {
  homeSourceMatchId?: string;
  awaySourceMatchId?: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  home_offStrategy?: string;
  home_defStrategy?: string;
  away_offStrategy?: string;
  away_defStrategy?: string;
  home_gdp_focus?: string;
  home_gdp_pace?: string;
  away_gdp_focus?: string;
  away_gdp_pace?: string;
  neutral?: string;
  effortDelta?: number;
  forecastContext?: PredictionForecastContext;
  manualFallback?: PredictionInput;
};

export type PredictionGridCell = PredictionGridCellShape;

export type PredictionTacticsGrid = PredictionEndpointTacticsGrid;

export type PredictionResult = {
  homeScore: number;
  awayScore: number;
  pointDiff: number;
  modelVersion: string;
  tacticsGrid?: PredictionTacticsGrid;
};

export type CurrentPredictionForecastContext =
  CurrentPredictionForecastContextShape;

export type CurrentPredictionPreview = CurrentPredictionPreviewShape;
