import {
  a,
  defineData,
  defineFunction,
  secret,
  type ClientSchema,
} from "@aws-amplify/backend";

import {
  LineupHelperAlgorithm,
  PositionCode,
  RecapGenerationApproach,
  RecapInterviewIntensity,
  TeamHighlightsPerspective,
} from "./schema-enums";
import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";
import { getAccessibleMatch } from "../get-accessible-match/resource";
import { getAccessiblePlayByPlay } from "../get-accessible-play-by-play/resource";
import { getMatchBoxscoreDetails } from "../get-match-boxscore-details/resource";
import { billingAdminOverride } from "../billing-admin-override/resource";
import { billingWebhook } from "../billing-webhook/resource";
import { evaluatePredictionMatrix } from "../evaluate-prediction-matrix/resource";
import { gameDayRecapFailureFinalizer } from "../game-day-recap-failure-finalizer/resource";
import { gameDayRecapSubmit } from "../game-day-recap-submit/resource";
import { gameDayRecapWorker } from "../game-day-recap-worker/resource";
import { listAccessibleMatches } from "../list-accessible-matches/resource";
import { leagueSeasonSimulationFailureFinalizer } from "../league-season-simulation-failure-finalizer/resource";
import { leagueSeasonSimulationSubmit } from "../league-season-simulation-submit/resource";
import { leagueSeasonSimulationWorker } from "../league-season-simulation-worker/resource";
import { nextGameRecommendationSubmit } from "../next-game-recommendation-submit/resource";
import { nextGameRecommendationWorker } from "../next-game-recommendation-worker/resource";
import { opponentForecastSubmit } from "../opponent-forecast-submit/resource";
import { opponentForecastWorker } from "../opponent-forecast-worker/resource";
import { predictionSubmit } from "../prediction-submit/resource";
import { predictionWorker } from "../prediction-worker/resource";
import { resolveBillingConfig } from "../_shared/synth-env";

const secureFunctionEnvironment = buildBbConnectionSecretFunctionEnvironment();

const stripeSecretFunctionEnvironment = {
  STRIPE_SECRET_KEY: secret("STRIPE_SECRET_KEY"),
};

const billingSynthConfig = resolveBillingConfig();
const billingOfferFunctionEnvironment = {
  COMMERCIAL_MODE_ENABLED: String(billingSynthConfig.commercialModeEnabled),
  BILLING_ENABLE_LIFETIME_PURCHASE: String(
    billingSynthConfig.lifetimePurchaseOfferEnabled,
  ),
  BILLING_ENABLE_PREMIUM_SUBSCRIPTION: String(
    billingSynthConfig.premiumSubscriptionOfferEnabled,
  ),
};
const billingPortalFunctionEnvironment = {
  ...stripeSecretFunctionEnvironment,
  ...billingOfferFunctionEnvironment,
  APP_BASE_URL: billingSynthConfig.appBaseUrl,
};
const billingCheckoutFunctionEnvironment = {
  ...billingPortalFunctionEnvironment,
  ...(billingSynthConfig.premiumPriceId
    ? {
        STRIPE_PREMIUM_PRICE_ID: billingSynthConfig.premiumPriceId,
      }
    : {}),
};
const billingLifetimeCheckoutFunctionEnvironment = {
  ...billingPortalFunctionEnvironment,
  ...(billingSynthConfig.lifetimePriceId
    ? {
        STRIPE_LIFETIME_PRICE_ID: billingSynthConfig.lifetimePriceId,
      }
    : {}),
};

export const connectBbAccount = defineFunction({
  resourceGroupName: "data",
  name: "connect-bb-account",
  entry: "./connect-bb-account/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const disconnectBbAccount = defineFunction({
  resourceGroupName: "data",
  name: "disconnect-bb-account",
  entry: "./disconnect-bb-account/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const refreshWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "refresh-workspace",
  entry: "./refresh-workspace/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getHomeWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-home-workspace",
  entry: "./get-home-workspace/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getScoutTeamSummary = defineFunction({
  resourceGroupName: "data",
  name: "get-scout-team-summary",
  entry: "./get-scout-team-summary/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getScoutSchedule = defineFunction({
  resourceGroupName: "data",
  name: "get-scout-schedule",
  entry: "./get-scout-schedule/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getLatestOpponentForecast = defineFunction({
  resourceGroupName: "data",
  name: "get-latest-opponent-forecast",
  entry: "./get-latest-opponent-forecast/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getLatestNextGameRecommendation = defineFunction({
  resourceGroupName: "data",
  name: "get-latest-next-game-recommendation",
  entry: "./get-latest-next-game-recommendation/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getLatestLeagueSeasonSimulation = defineFunction({
  resourceGroupName: "data",
  name: "get-latest-league-season-simulation",
  entry: "./get-latest-league-season-simulation/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getNextGamePlannerDetail = defineFunction({
  resourceGroupName: "data",
  name: "get-next-game-planner-detail",
  entry: "./get-next-game-planner-detail/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const getLeagueIntel = defineFunction({
  resourceGroupName: "data",
  name: "get-league-intel",
  entry: "./get-league-intel/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getLeagueHistory = defineFunction({
  resourceGroupName: "data",
  name: "get-league-history",
  entry: "./get-league-history/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getLeagueHistoryAudit = defineFunction({
  resourceGroupName: "data",
  name: "get-league-history-audit",
  entry: "./get-league-history-audit/handler.ts",
  timeoutSeconds: 300,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getPlayerLab = defineFunction({
  resourceGroupName: "data",
  name: "get-player-lab",
  entry: "./get-player-lab/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getArenaWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-arena-workspace",
  entry: "./get-arena-workspace/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getRivalsWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-rivals-workspace",
  entry: "./get-rivals-workspace/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const submitRivalsBackfill = defineFunction({
  resourceGroupName: "data",
  name: "submit-rivals-backfill",
  entry: "./submit-rivals-backfill/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const rivalsWorker = defineFunction({
  resourceGroupName: "data",
  name: "rivals-worker",
  entry: "./rivals-worker/handler.ts",
  timeoutSeconds: 300,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getLineupHelperWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-lineup-helper-workspace",
  entry: "./get-lineup-helper-workspace/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const repairOwnerRosterData = defineFunction({
  resourceGroupName: "data",
  name: "repair-owner-roster-data",
  entry: "./repair-owner-roster-data/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const evaluateLineupHelper = defineFunction({
  resourceGroupName: "data",
  name: "evaluate-lineup-helper",
  entry: "./evaluate-lineup-helper/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const optimizeLineupHelper = defineFunction({
  resourceGroupName: "data",
  name: "optimize-lineup-helper",
  entry: "./optimize-lineup-helper/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const getPlayerTrend = defineFunction({
  resourceGroupName: "data",
  name: "get-player-trend",
  entry: "./get-player-trend/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const getSalaryCalculatorSeed = defineFunction({
  resourceGroupName: "data",
  name: "get-salary-calculator-seed",
  entry: "./get-salary-calculator-seed/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const getManualSalaryEstimate = defineFunction({
  resourceGroupName: "data",
  name: "get-manual-salary-estimate",
  entry: "./get-manual-salary-estimate/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const submitMyTeamHighlightsScan = defineFunction({
  resourceGroupName: "data",
  name: "submit-my-team-highlights-scan",
  entry: "./submit-my-team-highlights-scan/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const submitLeagueHistoryBackfill = defineFunction({
  resourceGroupName: "data",
  name: "submit-league-history-backfill",
  entry: "./submit-league-history-backfill/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const getMyTeamHighlights = defineFunction({
  resourceGroupName: "data",
  name: "get-my-team-highlights",
  entry: "./get-my-team-highlights/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const clearMyTeamHighlightsData = defineFunction({
  resourceGroupName: "data",
  name: "clear-my-team-highlights-data",
  entry: "./clear-my-team-highlights-data/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const leagueHistoryWorker = defineFunction({
  resourceGroupName: "data",
  name: "league-history-worker",
  entry: "./league-history-worker/handler.ts",
  timeoutSeconds: 300,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getBillingSummary = defineFunction({
  resourceGroupName: "data",
  name: "get-billing-summary",
  entry: "./get-billing-summary/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: billingOfferFunctionEnvironment,
});

export const createBillingCheckoutSession = defineFunction({
  resourceGroupName: "data",
  name: "create-billing-checkout-session",
  entry: "./create-billing-checkout-session/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: billingCheckoutFunctionEnvironment,
});

export const createBillingLifetimeCheckoutSession = defineFunction({
  resourceGroupName: "data",
  name: "create-billing-lifetime-checkout-session",
  entry: "./create-billing-lifetime-checkout-session/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: billingLifetimeCheckoutFunctionEnvironment,
});

export const createBillingPortalSession = defineFunction({
  resourceGroupName: "data",
  name: "create-billing-portal-session",
  entry: "./create-billing-portal-session/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: billingPortalFunctionEnvironment,
});

export const listMyBillingPayments = defineFunction({
  resourceGroupName: "data",
  name: "list-my-billing-payments",
  entry: "./list-my-billing-payments/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const getSalaryProjection = defineFunction({
  resourceGroupName: "data",
  name: "get-salary-projection",
  entry: "./get-salary-projection/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const submitLeagueGameDayRecap = defineFunction({
  resourceGroupName: "data",
  name: "submit-league-game-day-recap",
  entry: "./submit-league-game-day-recap/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const submitLeagueGameDayPerformances = defineFunction({
  resourceGroupName: "data",
  name: "submit-league-game-day-performances",
  entry: "./submit-league-game-day-performances/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const submitSingleGameSummary = defineFunction({
  resourceGroupName: "data",
  name: "submit-single-game-summary",
  entry: "./submit-single-game-summary/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const setBbLeagueTimeZone = defineFunction({
  resourceGroupName: "data",
  name: "set-bb-league-time-zone",
  entry: "./set-bb-league-time-zone/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const setTrackedPlayerInterviewPersonality = defineFunction({
  resourceGroupName: "data",
  name: "set-tracked-player-interview-personality",
  entry: "./set-tracked-player-interview-personality/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const submitProductFeedback = defineFunction({
  resourceGroupName: "data",
  name: "submit-product-feedback",
  entry: "./submit-product-feedback/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const generateSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "generate-shared-player-card",
  entry: "./generate-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const revokeSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "revoke-shared-player-card",
  entry: "./revoke-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const lookupSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "lookup-shared-player-card",
  entry: "./lookup-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const pruneOperationalData = defineFunction({
  resourceGroupName: "data",
  name: "prune-operational-data",
  entry: "./prune-operational-data/handler.ts",
  timeoutSeconds: 300,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const maintenanceProtectedFunctions = [
  connectBbAccount,
  disconnectBbAccount,
  refreshWorkspace,
  getHomeWorkspace,
  getScoutTeamSummary,
  getScoutSchedule,
  getLatestOpponentForecast,
  getLatestNextGameRecommendation,
  getLatestLeagueSeasonSimulation,
  getNextGamePlannerDetail,
  getLeagueIntel,
  getLeagueHistory,
  getLeagueHistoryAudit,
  getPlayerLab,
  getArenaWorkspace,
  getRivalsWorkspace,
  submitRivalsBackfill,
  getLineupHelperWorkspace,
  repairOwnerRosterData,
  evaluateLineupHelper,
  getPlayerTrend,
  getSalaryCalculatorSeed,
  getManualSalaryEstimate,
  submitMyTeamHighlightsScan,
  submitLeagueHistoryBackfill,
  getMyTeamHighlights,
  clearMyTeamHighlightsData,
  getBillingSummary,
  createBillingCheckoutSession,
  createBillingLifetimeCheckoutSession,
  createBillingPortalSession,
  listMyBillingPayments,
  getSalaryProjection,
  submitLeagueGameDayRecap,
  submitLeagueGameDayPerformances,
  submitSingleGameSummary,
  setBbLeagueTimeZone,
  setTrackedPlayerInterviewPersonality,
  submitProductFeedback,
  listAccessibleMatches,
  getAccessibleMatch,
  getAccessiblePlayByPlay,
  getMatchBoxscoreDetails,
  generateSharedPlayerCard,
  revokeSharedPlayerCard,
  lookupSharedPlayerCard,
  leagueHistoryWorker,
  rivalsWorker,
  gameDayRecapSubmit,
  gameDayRecapWorker,
  evaluatePredictionMatrix,
  leagueSeasonSimulationSubmit,
  leagueSeasonSimulationWorker,
  nextGameRecommendationSubmit,
  nextGameRecommendationWorker,
  opponentForecastSubmit,
  opponentForecastWorker,
  predictionSubmit,
  predictionWorker,
] as const;

const dataFunctions = [
  ...maintenanceProtectedFunctions,
  gameDayRecapFailureFinalizer,
  leagueSeasonSimulationFailureFinalizer,
  pruneOperationalData,
  billingWebhook,
  billingAdminOverride,
];

const schema = a
  .schema({
    ConnectionStatus: a.enum([
      "UNSET",
      "CONNECTED",
      "INVALID",
      "ERROR",
      "DISCONNECTED",
    ]),

    SyncStatus: a.enum(["IDLE", "SYNCING", "SUCCEEDED", "FAILED"]),

    PredictionJobStatus: a.enum([
      "QUEUED",
      "RESOLVING_INPUT",
      "INVOKING_MODEL",
      "SUCCEEDED",
      "FAILED",
    ]),

    OpponentForecastJobStatus: a.enum([
      "QUEUED",
      "RESOLVING_CONTEXT",
      "INVOKING_MODEL",
      "SUCCEEDED",
      "FAILED",
    ]),

    NextGameRecommendationStatus: a.enum([
      "QUEUED",
      "PREPARING_INPUTS",
      "RESOLVING_CONTEXT",
      "OPTIMIZING_LINEUPS",
      "EVALUATING_CANDIDATES",
      "SCORING_MATCHUPS",
      "BUILDING_PLANNER",
      "SUCCEEDED",
      "FAILED",
    ]),
    NextGameRecommendationProgressPhaseKey: a.enum([
      "QUEUED",
      "RESOLVING_CONTEXT",
      "OPTIMIZING_LINEUPS",
      "SCORING_MATCHUPS",
      "BUILDING_PLANNER",
      "SUCCEEDED",
      "FAILED",
    ]),

    LeagueSeasonSimulationJobStatus: a.enum([
      "QUEUED",
      "RESOLVING_CONTEXT",
      "COLLECTING_SNAPSHOTS",
      "SCORING_GAMES",
      "RUNNING_SIMULATIONS",
      "SUCCEEDED",
      "FAILED",
    ]),
    LeagueSeasonSimulationProgressPhaseKey: a.enum([
      "QUEUED",
      "RESOLVING_CONTEXT",
      "COLLECTING_SNAPSHOTS",
      "SCORING_GAMES",
      "RUNNING_SIMULATIONS",
      "SUCCEEDED",
      "FAILED",
    ]),
    LeagueSeasonSimulationSelectionStrategy: a.enum([
      "CURRENT_SEASON_15TH_PERCENTILE",
      "MULTI_SEASON_THIRD_BEST",
      "BEST_AVAILABLE",
      "LEAGUE_AVERAGE_FALLBACK",
    ]),
    LeagueIntelFreshnessStatus: a.enum(["FRESH", "UNAVAILABLE"]),

    RecommendationMode: a.enum([
      "BIGGEST_WIN",
      "BEST_EXPECTED",
      "SAFEST",
      "EFFICIENT_WIN",
    ]),
    PlannerSupportTier: a.enum(["DIRECT", "ESTIMATED"]),

    GameDayRecapStatus: a.enum([
      "QUEUED",
      "RESOLVING_SLATE",
      "BUILDING_CONTEXT",
      "INVOKING_MODEL",
      "SUCCEEDED",
      "FAILED",
    ]),

    MatchIngestStatus: a.enum(["PENDING", "PARTIAL", "SUCCEEDED", "FAILED"]),

    ThemeId: a.enum(["clubhouse", "arena", "nightfall"]),
    FeedbackSubmissionKind: a.enum(["FEEDBACK", "FEATURE_REQUEST"]),

    PositionCode: a.enum(Object.values(PositionCode)),
    LineupHelperAlgorithm: a.enum(Object.values(LineupHelperAlgorithm)),
    RecapGenerationApproach: a.enum(Object.values(RecapGenerationApproach)),
    RecapInterviewIntensity: a.enum(Object.values(RecapInterviewIntensity)),

    TeamHighlightsPerspective: a.enum(Object.values(TeamHighlightsPerspective)),
    TeamHighlightsScanState: a.enum([
      "QUEUED",
      "RESOLVING_HISTORY",
      "ENQUEUING_MATCHES",
      "WAITING_FOR_MATCH_JOBS",
      "COMPLETED_WITH_GAPS",
      "SUCCEEDED",
      "FAILED",
    ]),

    LeagueHistoryBackfillState: a.enum([
      "QUEUED",
      "RESOLVING_SEASONS",
      "FETCHING_STANDINGS",
      "SUCCEEDED",
      "FAILED",
    ]),
    LeagueHistoryBackfillRefreshMode: a.enum([
      "MISSING_ONLY",
      "REFRESH_ALL_HISTORICAL",
    ]),

    RivalsBackfillState: a.enum([
      "QUEUED",
      "FETCHING_SEASONS",
      "FETCHING_SCHEDULES",
      "BUILDING_DATASET",
      "SUCCEEDED",
      "FAILED",
    ]),

    RivalsMatchesCacheEncoding: a.enum(["BROTLI_BASE64_V1"]),

    RecapRequestMode: a.enum([
      "FULL_SLATE",
      "LEAGUE_GAME_DAY",
      "LEAGUE_GAME_DAY_PERFORMANCES",
      "SINGLE_GAME",
    ]),
    RecapQualityTier: a.enum(["standard", "premium"]),

    BillingSummary: a.customType({
      planId: a.string().required(),
      accessSource: a.string().required(),
      subscriptionStatus: a.string(),
      currentPeriodEndAt: a.datetime(),
      cancelAtPeriodEnd: a.boolean().required(),
      hasBillingCustomer: a.boolean().required(),
      hasLifetimeAccess: a.boolean().required(),
      lifetimeGrantedAt: a.datetime(),
      premiumSubscriptionOfferEnabled: a.boolean().required(),
      lifetimePurchaseOfferEnabled: a.boolean().required(),
    }),

    BillingSessionResult: a.customType({
      url: a.string().required(),
    }),

    BillingPaymentEntry: a.customType({
      providerObjectType: a.string().required(),
      providerObjectId: a.string().required(),
      userId: a.string().required(),
      paymentKind: a.string().required(),
      status: a.string().required(),
      amountTotal: a.integer(),
      currency: a.string(),
      occurredAt: a.datetime().required(),
      grantedPlanId: a.string(),
      stripeCheckoutSessionId: a.string(),
      stripeCustomerId: a.string(),
      stripeInvoiceId: a.string(),
      stripePaymentIntentId: a.string(),
      stripePriceId: a.string(),
      stripeSubscriptionId: a.string(),
    }),

    BillingPaymentsPage: a.customType({
      items: a.ref("BillingPaymentEntry").required().array().required(),
      nextToken: a.string(),
    }),

    ConnectionResult: a.customType({
      bbLoginName: a.string().required(),
      status: a.ref("ConnectionStatus").required(),
      accessKeyLast4: a.string(),
      teamId: a.string(),
      teamName: a.string(),
      leagueId: a.string(),
      leagueName: a.string(),
      countryId: a.string(),
      countryName: a.string(),
      leagueTimeZone: a.string(),
      connectedAt: a.datetime(),
      lastValidatedAt: a.datetime(),
      lastSyncAt: a.datetime(),
      lastSyncError: a.string(),
      profileJson: a.ref("StoredTeamInfo"),
      workspaceCacheJson: a.ref("WorkspaceCachePayload"),
    }),

    ProductFeedbackSubmitResult: a.customType({
      id: a.string().required(),
      submittedAt: a.datetime().required(),
      notified: a.boolean().required(),
    }),

    NamedReference: a.customType({
      id: a.string(),
      name: a.string(),
    }),

    TeamRecordSummary: a.customType({
      wins: a.integer(),
      losses: a.integer(),
    }),

    InjurySummary: a.customType({
      playerId: a.string(),
      fullName: a.string().required(),
      injuryWeeks: a.integer(),
    }),

    TrendCountEntry: a.customType({
      key: a.string().required(),
      count: a.integer().required(),
    }),

    TendenciesSummary: a.customType({
      offense: a.ref("TrendCountEntry").required().array().required(),
      defense: a.ref("TrendCountEntry").required().array().required(),
    }),

    PlayerSummary: a.customType({
      playerId: a.string(),
      fullName: a.string().required(),
      bestPosition: a.string(),
      interviewPersonalitySource: a.string(),
      interviewPersonalityType: a.string(),
      nationalityName: a.string(),
      salary: a.integer(),
      age: a.integer(),
      gameShape: a.string(),
      dmi: a.integer(),
      injuryWeeks: a.integer(),
      projectedStarterCount: a.integer(),
      ppg: a.float(),
      recentAvgMinutes: a.float(),
      recentStartCount: a.integer(),
    }),

    MatchSummary: a.customType({
      matchId: a.string(),
      startTime: a.datetime(),
      type: a.string(),
      opponentTeamName: a.string(),
      teamScore: a.integer(),
      opponentScore: a.integer(),
      outcome: a.string(),
      effortDelta: a.integer(),
      hasBoxscore: a.boolean(),
    }),

    ScoutScheduleCompetitionOption: a.customType({
      count: a.integer().required(),
      key: a.string().required(),
      label: a.string().required(),
      selectedByDefault: a.boolean().required(),
    }),

    ScoutScheduleRow: a.customType({
      matchId: a.string(),
      startTime: a.datetime(),
      season: a.integer().required(),
      competitionKey: a.string().required(),
      competitionLabel: a.string().required(),
      stageLabel: a.string(),
      isTvGame: a.boolean().required(),
      venue: a.string(),
      opponentTeamId: a.string(),
      opponentTeamName: a.string(),
      teamOffense: a.string(),
      teamDefense: a.string(),
      teamBbStatsTotal: a.integer(),
      opponentOffense: a.string(),
      opponentDefense: a.string(),
      opponentBbStatsTotal: a.integer(),
      teamScore: a.integer(),
      opponentScore: a.integer(),
      outcome: a.string(),
      hasBoxscore: a.boolean().required(),
      seriousness: a.string(),
      seriousnessScore: a.float(),
      seriousnessReason: a.string(),
    }),

    ScoutScheduleSummary: a.customType({
      totalGames: a.integer().required(),
      completedGames: a.integer().required(),
      upcomingGames: a.integer().required(),
      seriousGames: a.integer().required(),
      missingBoxscores: a.integer().required(),
    }),

    ScoutSchedule: a.customType({
      availableSeasons: a.integer().required().array().required(),
      competitionOptions: a
        .ref("ScoutScheduleCompetitionOption")
        .required()
        .array()
        .required(),
      rows: a.ref("ScoutScheduleRow").required().array().required(),
      selectedCompetitionKeys: a.string().required().array().required(),
      selectedSeason: a.integer(),
      summary: a.ref("ScoutScheduleSummary").required(),
    }),

    OpponentSummary: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      wins: a.integer(),
      losses: a.integer(),
      pointMargin: a.integer(),
    }),

    HomeNextMatch: a.customType({
      matchId: a.string(),
      startTime: a.datetime(),
      type: a.string(),
      opponentTeamId: a.string(),
      opponentTeamName: a.string(),
      isHome: a.boolean(),
    }),

    HomeWorkspaceTeam: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      shortName: a.string(),
      record: a.ref("TeamRecordSummary"),
      injuries: a.ref("InjurySummary").required().array().required(),
      topPlayers: a.ref("PlayerSummary").required().array().required(),
    }),

    HomeWorkspaceOpponent: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      record: a.ref("TeamRecordSummary"),
      injuries: a.ref("InjurySummary").required().array().required(),
      tendencies: a.ref("TendenciesSummary").required(),
    }),

    LeagueComparisonMetricTriplet: a.customType({
      team: a.float(),
      opponent: a.float(),
      diff: a.float(),
    }),

    LeagueTeamStanding: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      wins: a.integer(),
      losses: a.integer(),
      pointMargin: a.integer(),
    }),

    LeagueConferenceStanding: a.customType({
      index: a.integer().required(),
      teams: a.ref("LeagueTeamStanding").required().array().required(),
    }),

    LeagueOffenseRow: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      conferenceIndex: a.integer().required(),
      standingsIndex: a.integer().required(),
      gamesPlayed: a.integer(),
      points: a.ref("LeagueComparisonMetricTriplet"),
      fgPct: a.ref("LeagueComparisonMetricTriplet"),
      threePtPct: a.ref("LeagueComparisonMetricTriplet"),
      ftPct: a.ref("LeagueComparisonMetricTriplet"),
      assists: a.ref("LeagueComparisonMetricTriplet"),
      offensiveRebounds: a.ref("LeagueComparisonMetricTriplet"),
      effectiveFgPct: a.ref("LeagueComparisonMetricTriplet"),
    }),

    LeagueDefenseRow: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      conferenceIndex: a.integer().required(),
      standingsIndex: a.integer().required(),
      gamesPlayed: a.integer(),
      totalRebounds: a.ref("LeagueComparisonMetricTriplet"),
      blocks: a.ref("LeagueComparisonMetricTriplet"),
      steals: a.ref("LeagueComparisonMetricTriplet"),
      turnovers: a.ref("LeagueComparisonMetricTriplet"),
      fouls: a.ref("LeagueComparisonMetricTriplet"),
    }),

    LeaguePayrollRow: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      conferenceIndex: a.integer().required(),
      standingsIndex: a.integer().required(),
      playerCount: a.integer(),
      totalPayroll: a.integer(),
      averageSalary: a.integer(),
      standardDeviation: a.integer(),
      top5Payroll: a.integer(),
      top8Payroll: a.integer(),
      top10Payroll: a.integer(),
      payrollRanks6To10: a.integer(),
    }),

    LeagueArenaRow: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      conferenceIndex: a.integer().required(),
      standingsIndex: a.integer().required(),
      totalCapacity: a.integer(),
      bleachers: a.integer(),
      lowerTier: a.integer(),
      courtside: a.integer(),
      luxuryBoxes: a.integer(),
    }),

    LeagueComparisons: a.customType({
      builtAt: a.datetime().required(),
      season: a.integer(),
      incompleteTeamCount: a.integer().required(),
      offense: a.ref("LeagueOffenseRow").required().array().required(),
      defense: a.ref("LeagueDefenseRow").required().array().required(),
      payroll: a.ref("LeaguePayrollRow").required().array().required(),
      arena: a.ref("LeagueArenaRow").required().array().required(),
    }),

    LeagueIntelWorkspace: a.customType({
      freshnessMessage: a.string(),
      freshnessStatus: a.ref("LeagueIntelFreshnessStatus"),
      league: a.ref("NamedReference"),
      season: a.integer(),
      standings: a
        .ref("LeagueConferenceStanding")
        .required()
        .array()
        .required(),
      comparisons: a.ref("LeagueComparisons"),
    }),

    LeagueHistoryRow: a.customType({
      teamId: a.string().required(),
      teamName: a.string().required(),
      seasons: a.integer().required(),
      games: a.integer().required(),
      wins: a.integer().required(),
      losses: a.integer().required(),
      playoffWins: a.integer().required(),
      playoffLosses: a.integer().required(),
      championships: a.integer().required(),
      winPct: a.float().required(),
      pf: a.integer().required(),
      pa: a.integer().required(),
      pointMargin: a.integer().required(),
      averageMargin: a.float().required(),
    }),

    LeagueHistoryAuditCollision: a.customType({
      teamId: a.string().required(),
      teamNames: a.string().required().array().required(),
      firstSeason: a.integer(),
      lastSeason: a.integer(),
      rowCount: a.integer().required(),
      seasonCount: a.integer().required(),
    }),

    LeagueHistoryAuditMismatch: a.customType({
      season: a.integer().required(),
      teamId: a.string().required(),
      cachedTeamName: a.string().required(),
      liveTeamName: a.string().required(),
    }),

    LeagueHistoryBackfillStatus: a.customType({
      leagueId: a.string().required(),
      leagueName: a.string(),
      executionArn: a.string(),
      status: a.ref("LeagueHistoryBackfillState").required(),
      requestedAt: a.datetime().required(),
      startedAt: a.datetime(),
      completedAt: a.datetime(),
      error: a.string(),
      historicalSeasonsExpected: a.integer(),
      historicalSeasonsStored: a.integer(),
      lastCompletedSeason: a.integer(),
      updatedAt: a.datetime().required(),
    }),

    LeagueHistorySummary: a.customType({
      currentSeason: a.integer(),
      historicalSeasonsStored: a.integer().required(),
      totalTeams: a.integer().required(),
    }),

    LeagueHistoryBackfillSubmitResult: a.customType({
      leagueId: a.string().required(),
      leagueName: a.string(),
      queued: a.boolean().required(),
      executionArn: a.string(),
      status: a.ref("LeagueHistoryBackfillState").required(),
      requestedAt: a.datetime().required(),
    }),

    RivalsBackfillStatus: a.customType({
      userId: a.string().required(),
      teamId: a.string().required(),
      teamName: a.string(),
      executionArn: a.string(),
      status: a.ref("RivalsBackfillState").required(),
      requestedAt: a.datetime().required(),
      startedAt: a.datetime(),
      completedAt: a.datetime(),
      error: a.string(),
      generatedAt: a.datetime(),
      totalCompletedGames: a.integer(),
      totalOpponents: a.integer(),
      updatedAt: a.datetime().required(),
    }),

    RivalsBackfillSubmitResult: a.customType({
      executionArn: a.string(),
      queued: a.boolean().required(),
      requestedAt: a.datetime().required(),
      status: a.ref("RivalsBackfillState").required(),
      teamId: a.string().required(),
      teamName: a.string(),
    }),

    LeagueHistory: a.customType({
      league: a.ref("NamedReference").required(),
      requestedLeagueId: a.string(),
      summary: a.ref("LeagueHistorySummary").required(),
      rows: a.ref("LeagueHistoryRow").required().array().required(),
      status: a.ref("LeagueHistoryBackfillStatus"),
      warning: a.string(),
    }),

    LeagueHistoryAudit: a.customType({
      league: a.ref("NamedReference").required(),
      requestedLeagueId: a.string(),
      cachedRows: a.ref("LeagueHistoryRow").required().array().required(),
      liveRows: a.ref("LeagueHistoryRow").required().array().required(),
      mixedNameTeams: a
        .ref("LeagueHistoryAuditCollision")
        .required()
        .array()
        .required(),
      nameMismatches: a
        .ref("LeagueHistoryAuditMismatch")
        .required()
        .array()
        .required(),
      liveComparisonIncluded: a.boolean().required(),
      warning: a.string(),
    }),

    HomeWorkspace: a.customType({
      syncedAt: a.datetime(),
      connection: a.ref("ConnectionResult").required(),
      team: a.ref("HomeWorkspaceTeam").required(),
      nextMatch: a.ref("HomeNextMatch"),
      nextScoutMatch: a.ref("HomeNextMatch"),
      nextOpponent: a.ref("HomeWorkspaceOpponent"),
      recentMatches: a.ref("MatchSummary").required().array().required(),
      league: a.ref("LeagueIntelWorkspace").required(),
    }),

    TeamInfoSummary: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      shortName: a.string(),
      ownerName: a.string(),
      isBot: a.boolean().required(),
      league: a.ref("NamedReference"),
      country: a.ref("NamedReference"),
      rival: a.ref("NamedReference"),
    }),

    StoredTeamInfo: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      shortName: a.string(),
      ownerName: a.string(),
      isBot: a.boolean().required(),
      league: a.ref("NamedReference"),
      country: a.ref("NamedReference"),
      rival: a.ref("NamedReference"),
    }),

    StoredRequiredNamedReference: a.customType({
      id: a.string().required(),
      name: a.string().required(),
    }),

    StoredOwnedRosterPlayerSkills: a.customType({
      jumpShot: a.integer().required(),
      range: a.integer().required(),
      outsideDef: a.integer().required(),
      handling: a.integer().required(),
      driving: a.integer().required(),
      passing: a.integer().required(),
      insideShot: a.integer().required(),
      insideDef: a.integer().required(),
      rebound: a.integer().required(),
      block: a.integer().required(),
      stamina: a.integer().required(),
      freeThrow: a.integer().required(),
      experience: a.integer().required(),
      gameShape: a.integer().required(),
      potential: a.integer().required(),
    }),

    StoredOwnedRosterPlayer: a.customType({
      id: a.string().required(),
      firstName: a.string().required(),
      lastName: a.string().required(),
      fullName: a.string().required(),
      salary: a.integer().required(),
      bestPosition: a.string().required(),
      age: a.integer().required(),
      height: a.integer().required(),
      dmi: a.integer().required(),
      injuryWeeks: a.integer().required(),
      nationality: a.ref("StoredRequiredNamedReference").required(),
      skills: a.ref("StoredOwnedRosterPlayerSkills").required(),
    }),

    WorkspaceCacheConnection: a.customType({
      bbLoginName: a.string().required(),
      status: a.ref("ConnectionStatus").required(),
      accessKeyLast4: a.string(),
      teamId: a.string(),
      teamName: a.string(),
      leagueId: a.string(),
      leagueName: a.string(),
      countryId: a.string(),
      countryName: a.string(),
      leagueTimeZone: a.string(),
      connectedAt: a.datetime(),
      lastValidatedAt: a.datetime(),
      lastSyncAt: a.datetime(),
      lastSyncError: a.string(),
      profileJson: a.ref("StoredTeamInfo"),
    }),

    CachedHomeWorkspace: a.customType({
      syncedAt: a.datetime(),
      connection: a.ref("WorkspaceCacheConnection").required(),
      team: a.ref("HomeWorkspaceTeam").required(),
      nextMatch: a.ref("HomeNextMatch"),
      nextScoutMatch: a.ref("HomeNextMatch"),
      nextOpponent: a.ref("HomeWorkspaceOpponent"),
      recentMatches: a.ref("MatchSummary").required().array().required(),
      league: a.ref("LeagueIntelWorkspace").required(),
    }),

    // Persisted workspace cache payloads are append-only. New slices must stay
    // schema-optional so legacy rows can still coerce before runtime cache
    // validation decides whether to reuse or discard the cached value.
    WorkspaceCachePayload: a.customType({
      version: a.integer().required(),
      home: a.ref("CachedHomeWorkspace").required(),
      teamHub: a.ref("TeamHubWorkspace").required(),
      scout: a.ref("ScoutWorkspace").required(),
      leagueIntel: a.ref("LeagueIntelWorkspace").required(),
      playerLab: a.ref("PlayerLabWorkspace").required(),
      arena: a.ref("ArenaWorkspace"),
    }),

    TeamHubWorkspace: a.customType({
      syncedAt: a.datetime(),
      team: a.ref("TeamInfoSummary").required(),
      roster: a.ref("PlayerSummary").required().array().required(),
    }),

    ScoutMatchupPerspective: a.customType({
      ourTeamId: a.string(),
      opponentTeamId: a.string(),
    }),

    ScoutWorkspaceSummary: a.customType({
      teamName: a.string(),
      nextMatch: a.ref("MatchSummary"),
      record: a.ref("TeamRecordSummary"),
      matchupPerspective: a.ref("ScoutMatchupPerspective").required(),
      tendencies: a.ref("TendenciesSummary").required(),
      roster: a.ref("PlayerSummary").required().array().required(),
      topPlayers: a.ref("PlayerSummary").required().array().required(),
      recentGames: a.ref("MatchSummary").required().array().required(),
    }),

    ScoutWorkspace: a.customType({
      syncedAt: a.datetime(),
      teamId: a.string(),
      availableOpponents: a
        .ref("OpponentSummary")
        .required()
        .array()
        .required(),
      recentMatchups: a.ref("MatchSummary").required().array().required(),
      schedule: a.ref("ScoutSchedule"),
      summary: a.ref("ScoutWorkspaceSummary"),
      requestedTeamId: a.string(),
      message: a.string(),
    }),

    PlayerLabWorkspace: a.customType({
      syncedAt: a.datetime(),
      players: a.ref("PlayerSummary").required().array().required(),
    }),

    TrackedPlayerInterviewPersonalitySelection: a.customType({
      interviewPersonalitySource: a.string(),
      interviewPersonalityType: a.string(),
      playerId: a.string().required(),
    }),

    ArenaSectionAttendance: a.customType({
      bleachers: a.integer(),
      lowerTier: a.integer(),
      courtside: a.integer(),
      luxury: a.integer(),
    }),

    ArenaSeatState: a.customType({
      section: a.string().required(),
      capacity: a.integer(),
      price: a.integer(),
      nextPrice: a.integer(),
      minPrice: a.integer().required(),
      maxPrice: a.integer().required(),
    }),

    ArenaExpansionSection: a.customType({
      section: a.string().required(),
      capacityDelta: a.integer(),
    }),

    ArenaExpansionSummary: a.customType({
      daysLeft: a.integer(),
      sections: a.ref("ArenaExpansionSection").required().array().required(),
    }),

    ArenaEconomyTransaction: a.customType({
      kind: a.string(),
      amount: a.float(),
      date: a.datetime(),
      description: a.string(),
      rawType: a.string(),
      rawAmount: a.string(),
      rawDate: a.string(),
    }),

    ArenaEconomySummary: a.customType({
      cash: a.integer(),
      availableBalance: a.integer(),
      transactions: a
        .ref("ArenaEconomyTransaction")
        .required()
        .array()
        .required(),
    }),

    ArenaOverview: a.customType({
      name: a.string(),
      seats: a.ref("ArenaSeatState").required().array().required(),
      expansion: a.ref("ArenaExpansionSummary"),
    }),

    ArenaHomeGameSectionSample: a.customType({
      section: a.string().required(),
      attendance: a.integer(),
      capacity: a.integer(),
      price: a.integer(),
      occupancyPct: a.float(),
      realizedRevenue: a.float(),
      usedMatchedSnapshot: a.boolean().required(),
    }),

    ArenaHomeGameSample: a.customType({
      matchId: a.string().required(),
      startTime: a.datetime(),
      type: a.string(),
      opponentTeamId: a.string(),
      opponentTeamName: a.string(),
      competitionKey: a.string(),
      competitionLabel: a.string().required(),
      sections: a
        .ref("ArenaHomeGameSectionSample")
        .required()
        .array()
        .required(),
      estimatedRealizedGate: a.float(),
      matchedSnapshotCapturedAt: a.datetime(),
    }),

    ArenaPriceRecommendationSection: a.customType({
      section: a.string().required(),
      currentPrice: a.integer(),
      recommendedPrice: a.integer(),
      delta: a.integer(),
      reason: a.string().required(),
      confidence: a.float().required(),
      weightedOccupancyPct: a.float(),
      projectedAttendance: a.integer(),
      projectedRevenue: a.float(),
    }),

    ArenaPriceRecommendation: a.customType({
      overallConfidence: a.float().required(),
      heuristicDisclaimer: a.string().required(),
      projectedCurrentRevenue: a.float(),
      projectedRecommendedRevenue: a.float(),
      projectedRevenueDelta: a.float(),
      sections: a
        .ref("ArenaPriceRecommendationSection")
        .required()
        .array()
        .required(),
    }),

    ArenaWorkspaceDiagnostics: a.customType({
      comparableGameCount: a.integer().required(),
      matchedSnapshotCount: a.integer().required(),
      lowConfidenceReasons: a.string().required().array().required(),
    }),

    ArenaWorkspace: a.customType({
      syncedAt: a.datetime(),
      nextHomeMatch: a.ref("HomeNextMatch"),
      arena: a.ref("ArenaOverview"),
      economy: a.ref("ArenaEconomySummary"),
      recentHomeGames: a
        .ref("ArenaHomeGameSample")
        .required()
        .array()
        .required(),
      recommendation: a.ref("ArenaPriceRecommendation"),
      diagnostics: a.ref("ArenaWorkspaceDiagnostics").required(),
    }),

    RivalsWorkspaceTeam: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      shortName: a.string(),
    }),

    RivalsWorkspaceSummary: a.customType({
      failedSeasonCount: a.integer().required(),
      failedSeasons: a.integer().required().array().required(),
      firstSeason: a.integer(),
      lastSeason: a.integer(),
      losses: a.integer().required(),
      seasonsScanned: a.integer().required(),
      seasonsWithGames: a.integer().required(),
      totalCompletedGames: a.integer().required(),
      totalOpponents: a.integer().required(),
      tvGames: a.integer().required(),
      wins: a.integer().required(),
    }),

    RivalsMatchesCacheEnvelope: a.customType({
      encoding: a.ref("RivalsMatchesCacheEncoding").required(),
      payload: a.string().required(),
    }),

    RivalryMatch: a.customType({
      competitionKey: a.string().required(),
      competitionLabel: a.string().required(),
      gameDate: a.date(),
      isHome: a.boolean().required(),
      isTvGame: a.boolean().required(),
      margin: a.integer().required(),
      matchId: a.string().required(),
      opponentScore: a.integer().required(),
      opponentTeamId: a.string().required(),
      opponentTeamName: a.string().required(),
      outcome: a.string().required(),
      rawType: a.string(),
      season: a.integer().required(),
      stageKey: a.string(),
      stageLabel: a.string(),
      startTime: a.datetime(),
      teamScore: a.integer().required(),
      venue: a.string().required(),
    }),

    RivalsCompetitionOption: a.customType({
      count: a.integer().required(),
      key: a.string().required(),
      label: a.string().required(),
    }),

    RivalsSeasonRange: a.customType({
      availableSeasons: a.integer().required().array().required(),
      endSeason: a.integer(),
      startSeason: a.integer(),
    }),

    RivalryRow: a.customType({
      averageMargin: a.float().required(),
      currentStreak: a.string().required(),
      games: a.integer().required(),
      homeLosses: a.integer().required(),
      homeWins: a.integer().required(),
      lastMatch: a.datetime(),
      leagueLosses: a.integer().required(),
      leagueWins: a.integer().required(),
      losses: a.integer().required(),
      opponentTeamId: a.string().required(),
      opponentTeamName: a.string().required(),
      playoffLosses: a.integer().required(),
      playoffWins: a.integer().required(),
      roadLosses: a.integer().required(),
      roadWins: a.integer().required(),
      seasons: a.integer().required().array().required(),
      tvGames: a.integer().required(),
      winPct: a.float().required(),
      wins: a.integer().required(),
    }),

    RivalryCompetitionBreakdownRow: a.customType({
      averageMargin: a.float().required(),
      competitionKey: a.string().required(),
      competitionLabel: a.string().required(),
      games: a.integer().required(),
      homeLosses: a.integer().required(),
      homeWins: a.integer().required(),
      losses: a.integer().required(),
      roadLosses: a.integer().required(),
      roadWins: a.integer().required(),
      tvGames: a.integer().required(),
      wins: a.integer().required(),
    }),

    RivalrySeasonBreakdownRow: a.customType({
      averageMargin: a.float().required(),
      games: a.integer().required(),
      lastMatch: a.datetime(),
      leagueLosses: a.integer().required(),
      leagueWins: a.integer().required(),
      losses: a.integer().required(),
      season: a.integer().required(),
      tvGames: a.integer().required(),
      wins: a.integer().required(),
    }),

    RivalryDetail: a.customType({
      competitionBreakdown: a
        .ref("RivalryCompetitionBreakdownRow")
        .required()
        .array()
        .required(),
      matches: a.ref("RivalryMatch").required().array().required(),
      row: a.ref("RivalryRow").required(),
      seasonBreakdown: a
        .ref("RivalrySeasonBreakdownRow")
        .required()
        .array()
        .required(),
    }),

    RivalsWorkspace: a.customType({
      competitionOptions: a
        .ref("RivalsCompetitionOption")
        .required()
        .array()
        .required(),
      generatedAt: a.datetime().required(),
      rows: a.ref("RivalryRow").required().array().required(),
      seasonRange: a.ref("RivalsSeasonRange").required(),
      selectedOpponentId: a.string(),
      selectedRivalry: a.ref("RivalryDetail"),
      status: a.ref("RivalsBackfillStatus"),
      summary: a.ref("RivalsWorkspaceSummary").required(),
      syncedAt: a.datetime(),
      team: a.ref("RivalsWorkspaceTeam").required(),
      warning: a.string(),
    }),

    PlayerTrendPoint: a.customType({
      weekKey: a.string(),
      fetchedAt: a.datetime(),
      salary: a.integer(),
      dmi: a.integer(),
      injuryWeeks: a.integer(),
      gameShape: a.string(),
    }),

    PlayerTrend: a.customType({
      player: a.ref("PlayerSummary").required(),
      history: a.ref("PlayerTrendPoint").required().array().required(),
    }),

    MatchMetricEntry: a.customType({
      key: a.string().required(),
      numberValue: a.float().required(),
    }),

    MatchBoxscoreTeamRatings: a.customType({
      outsideScoring: a.float().required(),
      insideScoring: a.float().required(),
      outsideDefense: a.float().required(),
      insideDefense: a.float().required(),
      rebounding: a.float().required(),
      offensiveFlow: a.float().required(),
    }),

    MatchContext: a.customType({
      homeTeamName: a.string(),
      awayTeamName: a.string(),
      effortDelta: a.integer(),
      neutral: a.boolean(),
    }),

    SharedPlayerCardResult: a.customType({
      shareToken: a.string().required(),
      shareUrl: a.string(),
      title: a.string(),
      note: a.string(),
      expiresAt: a.datetime(),
      revokedAt: a.datetime(),
      payload: a.ref("SharedPlayerCardPayload"),
    }),

    PredictionJobSubmitResult: a.customType({
      jobId: a.string().required(),
      executionArn: a.string(),
    }),

    OpponentForecastSubmitResult: a.customType({
      jobId: a.string().required(),
      executionArn: a.string(),
    }),

    NextGameRecommendationSubmitResult: a.customType({
      jobId: a.string().required(),
      executionArn: a.string(),
    }),

    LeagueSeasonSimulationSubmitResult: a.customType({
      jobId: a.string().required(),
      executionArn: a.string(),
    }),

    OwnerRosterRepairResult: a.customType({
      completedAt: a.datetime().required(),
      repairedPlayerCount: a.integer().required(),
    }),

    OpponentForecastCoverage: a.customType({
      recentGamesConsidered: a.integer().required(),
      seriousGamesConsidered: a.integer().required(),
      supportingGamesConsidered: a.integer().required(),
      sampleStrategy: a.string().required(),
      headToHeadGamesConsidered: a.integer().required(),
      analogGamesConsidered: a.integer().required(),
      rosterPlayersConsidered: a.integer().required(),
    }),

    OpponentForecastSignal: a.customType({
      key: a.string().required(),
      label: a.string().required(),
      value: a.string().required(),
      strength: a.float(),
    }),

    OpponentForecastPlayerProjection: a.customType({
      playerId: a.string(),
      fullName: a.string().required(),
      bestPosition: a.string(),
      starterProbability: a.float(),
      expectedMinutes: a.integer(),
      minuteBandLow: a.integer(),
      minuteBandHigh: a.integer(),
      injuryWeeks: a.integer(),
      gameShape: a.string(),
    }),

    OpponentForecastScenario: a.customType({
      scenarioId: a.string().required(),
      label: a.string().required(),
      probability: a.float().required(),
      offense: a.string().required(),
      defense: a.string().required(),
      gdpFocus: a.string(),
      gdpPace: a.string(),
      enthusiasmBand: a.string(),
      effortChoice: a.string().required(),
      starters: a
        .ref("OpponentForecastPlayerProjection")
        .required()
        .array()
        .required(),
      rotation: a
        .ref("OpponentForecastPlayerProjection")
        .required()
        .array()
        .required(),
      evidence: a.string().required().array().required(),
    }),

    OpponentForecastAnalogGame: a.customType({
      matchId: a.string().required(),
      startTime: a.datetime(),
      season: a.integer(),
      similarity: a.float().required(),
      opponentTeamName: a.string(),
      offense: a.string(),
      defense: a.string(),
      gdpFocus: a.string(),
      gdpPace: a.string(),
      effortDelta: a.integer(),
      teamScore: a.integer(),
      opponentScore: a.integer(),
    }),

    OpponentForecastResult: a.customType({
      modelVersion: a.string().required(),
      generatedAt: a.datetime().required(),
      confidence: a.float().required(),
      coverage: a.ref("OpponentForecastCoverage").required(),
      topScenarios: a
        .ref("OpponentForecastScenario")
        .required()
        .array()
        .required(),
      analogGames: a
        .ref("OpponentForecastAnalogGame")
        .required()
        .array()
        .required(),
      featureSignals: a
        .ref("OpponentForecastSignal")
        .required()
        .array()
        .required(),
    }),

    OpponentForecastSnapshot: a.customType({
      jobId: a.string().required(),
      teamId: a.string().required(),
      teamName: a.string(),
      executionArn: a.string(),
      status: a.ref("OpponentForecastJobStatus").required(),
      requestedAt: a.datetime().required(),
      startedAt: a.datetime(),
      completedAt: a.datetime(),
      error: a.string(),
      modelVersion: a.string(),
      result: a.ref("OpponentForecastResult"),
    }),

    OpponentForecastJobRequest: a.customType({
      teamId: a.string().required(),
    }),

    OpponentForecastOurTeamContext: a.customType({
      nextMatch: a.ref("HomeNextMatch"),
      recentMatches: a.ref("MatchSummary").required().array().required(),
      record: a.ref("TeamRecordSummary"),
      roster: a.ref("PlayerSummary").required().array().required(),
      team: a.ref("HomeWorkspaceTeam").required(),
      topPlayers: a.ref("PlayerSummary").required().array().required(),
    }),

    OpponentForecastSampleSummary: a.customType({
      sampleStrategy: a.string().required(),
      seriousGamesConsidered: a.integer().required(),
      supportingGamesConsidered: a.integer().required(),
    }),

    OpponentForecastTargetTeamContext: a.customType({
      matchupPerspective: a.ref("ScoutMatchupPerspective").required(),
      nextMatch: a.ref("MatchSummary"),
      publicRoster: a.ref("PlayerSummary").required().array().required(),
      recentGames: a.ref("MatchSummary").required().array().required(),
      recentGameBoxscores: a
        .ref("StoredForecastBoxscore")
        .required()
        .array()
        .required(),
      record: a.ref("TeamRecordSummary"),
      sampleSummary: a.ref("OpponentForecastSampleSummary").required(),
      teamId: a.string(),
      teamName: a.string(),
      tendencies: a.ref("TendenciesSummary").required(),
      topPlayers: a.ref("PlayerSummary").required().array().required(),
    }),

    OpponentForecastHeadToHeadContext: a.customType({
      recentMatchups: a.ref("MatchSummary").required().array().required(),
      boxscores: a.ref("StoredForecastBoxscore").required().array().required(),
    }),

    OpponentForecastResolvedContext: a.customType({
      generatedAt: a.datetime().required(),
      ourTeam: a.ref("OpponentForecastOurTeamContext").required(),
      targetTeam: a.ref("OpponentForecastTargetTeamContext").required(),
      headToHead: a.ref("OpponentForecastHeadToHeadContext").required(),
      leagueContext: a.ref("LeagueIntelWorkspace").required(),
    }),

    NextGameRecommendationInput: a.customType({
      excludedPlayerIds: a.string().required().array().required(),
      enthusiasm: a.integer().required(),
      defensiveSwitch: a.ref("LineupHelperDefensiveSwitch").required(),
    }),

    NextGameRecommendationStoredRequest: a.customType({
      excludedPlayerIds: a.string().required().array().required(),
      input: a.ref("NextGameRecommendationInput").required(),
      matchId: a.string().required(),
      opponentTeamId: a.string().required(),
      opponentTeamName: a.string(),
    }),

    NextGameRecommendationCompletedPhase: a.customType({
      phaseKey: a.ref("NextGameRecommendationProgressPhaseKey").required(),
      startedAt: a.datetime().required(),
      completedAt: a.datetime().required(),
      durationMs: a.integer().required(),
      summary: a.string().required(),
    }),

    NextGameRecommendationProgressContext: a.customType({
      artifactKey: a.string(),
      availableRosterCount: a.integer(),
      candidateCount: a.integer(),
      excludedPlayerCount: a.integer(),
      forecastJobId: a.string(),
      forecastScenarioCount: a.integer(),
      plannerBatchCount: a.integer(),
      plannerBatchesCompleted: a.integer(),
      plannerPairCount: a.integer(),
      sourceMatchId: a.string(),
      sourceTeamLocation: a.string(),
      workspaceCacheKind: a.string(),
      workspaceCacheState: a.string(),
      workspaceSyncedAt: a.datetime(),
    }),

    NextGameRecommendationProgress: a.customType({
      phaseKey: a.ref("NextGameRecommendationProgressPhaseKey").required(),
      phaseIndex: a.integer().required(),
      phaseCount: a.integer().required(),
      summary: a.string().required(),
      updatedAt: a.datetime().required(),
      currentPhaseStartedAt: a.datetime(),
      completedPhases: a
        .ref("NextGameRecommendationCompletedPhase")
        .required()
        .array()
        .required(),
      context: a.ref("NextGameRecommendationProgressContext"),
      completedUnits: a.integer(),
      totalUnits: a.integer(),
      unitLabel: a.string(),
    }),

    RecommendedGamePlanLineupRow: a.customType({
      playerId: a.string(),
      fullName: a.string().required(),
      position: a.ref("PositionCode").required(),
      minutes: a.integer().required(),
    }),

    GamePlannerPlanScenarioResult: a.customType({
      scenarioId: a.string().required(),
      available: a.boolean().required(),
      predictedPointDiff: a.float(),
      predictedTeamScore: a.float(),
      predictedOpponentScore: a.float(),
    }),

    RecommendedGamePlan: a.customType({
      mode: a.ref("RecommendationMode").required(),
      pairId: a.string().required(),
      predictedPointDiff: a.float().required(),
      predictedTeamScore: a.float().required(),
      predictedOpponentScore: a.float().required(),
      weightedExpectedPointDiff: a.float().required(),
      floorPointDiff: a.float().required(),
      ceilingPointDiff: a.float().required(),
      winProbability: a.float().required(),
      offense: a.string().required(),
      defense: a.string().required(),
      effortChoice: a.string().required(),
      enthusiasm: a.integer().required(),
      defensiveSwitch: a.ref("LineupHelperDefensiveSwitch").required(),
      meetsTargetMargin: a.boolean().required(),
      targetMargin: a.integer(),
      lineup: a
        .ref("RecommendedGamePlanLineupRow")
        .required()
        .array()
        .required(),
      scenarioResults: a
        .ref("GamePlannerPlanScenarioResult")
        .required()
        .array()
        .required(),
    }),

    GamePlannerEvaluatedScenario: a.customType({
      scenarioId: a.string().required(),
      label: a.string().required(),
      probability: a.float().required(),
      offense: a.string().required(),
      defense: a.string().required(),
      effortChoice: a.string().required(),
      evidence: a.string().required().array().required(),
    }),

    GamePlannerTacticPair: a.customType({
      pairId: a.string().required(),
      offense: a.string().required(),
      defense: a.string().required(),
      estimated: a.boolean().required(),
      supportTier: a.ref("PlannerSupportTier").required(),
    }),

    GamePlannerCell: a.customType({
      ourPairId: a.string().required(),
      opponentPairId: a.string().required(),
      available: a.boolean().required(),
      predictedPointDiff: a.float(),
      predictedTeamScore: a.float(),
      predictedOpponentScore: a.float(),
    }),

    GamePlannerMatrixRow: a.customType({
      opponentPairId: a.string().required(),
      cells: a.ref("GamePlannerCell").required().array().required(),
    }),

    GamePlannerMatrixView: a.customType({
      viewId: a.string().required(),
      label: a.string().required(),
      scenarioId: a.string(),
      probability: a.float(),
      rows: a.ref("GamePlannerMatrixRow").required().array().required(),
    }),

    NextGamePlannerDetail: a.customType({
      artifactKey: a.string().required(),
      generatedAt: a.datetime().required(),
      evaluatedScenarios: a
        .ref("GamePlannerEvaluatedScenario")
        .required()
        .array()
        .required(),
      ourPairs: a.ref("GamePlannerTacticPair").required().array().required(),
      opponentPairs: a
        .ref("GamePlannerTacticPair")
        .required()
        .array()
        .required(),
      views: a.ref("GamePlannerMatrixView").required().array().required(),
    }),

    PlannerArtifactRow: a.customType({
      cells: a.ref("GamePlannerCell").required().array().required(),
      label: a.string().required(),
      opponentPairId: a.string().required(),
      probability: a.float(),
      scenarioId: a.string(),
      viewId: a.string().required(),
    }),

    NextGameRecommendationResult: a.customType({
      generatedAt: a.datetime().required(),
      matchId: a.string().required(),
      opponentTeamId: a.string().required(),
      opponentTeamName: a.string().required(),
      forecastJobId: a.string().required(),
      forecastScenarioId: a.string().required(),
      forecastScenarioLabel: a.string().required(),
      forecastScenarioProbability: a.float().required(),
      forecastModelVersion: a.string().required(),
      opponentSourceMatchId: a.string().required(),
      excludedPlayerIds: a.string().required().array().required(),
      enthusiasm: a.integer().required(),
      defensiveSwitch: a.ref("LineupHelperDefensiveSwitch").required(),
      stale: a.boolean().required(),
      artifactKey: a.string().required(),
      evaluatedScenarios: a
        .ref("GamePlannerEvaluatedScenario")
        .required()
        .array()
        .required(),
      bestExpectedPlan: a.ref("RecommendedGamePlan").required(),
      safestPlan: a.ref("RecommendedGamePlan").required(),
      efficientPlan: a.ref("RecommendedGamePlan").required(),
      biggestWinPlan: a.ref("RecommendedGamePlan").required(),
      efficientWinPlan: a.ref("RecommendedGamePlan").required(),
    }),

    NextGameRecommendationSnapshot: a.customType({
      jobId: a.string().required(),
      matchId: a.string().required(),
      opponentTeamId: a.string().required(),
      opponentTeamName: a.string(),
      excludedPlayerIds: a.string().required().array().required(),
      enthusiasm: a.integer().required(),
      defensiveSwitch: a.ref("LineupHelperDefensiveSwitch").required(),
      executionArn: a.string(),
      status: a.ref("NextGameRecommendationStatus").required(),
      requestedAt: a.datetime().required(),
      startedAt: a.datetime(),
      completedAt: a.datetime(),
      error: a.string(),
      progress: a.ref("NextGameRecommendationProgress"),
      result: a.ref("NextGameRecommendationResult"),
    }),

    LeagueSeasonSimulationStoredRequest: a.customType({
      leagueId: a.string().required(),
      scenarioKey: a.string(),
      season: a.integer().required(),
      snapshotModifiers: a
        .ref("LeagueSeasonSimulationTeamModifier")
        .array(),
      teamId: a.string().required(),
      teamName: a.string(),
    }),

    LeagueSeasonSimulationRatingModifier: a.customType({
      outsideScoring: a.float(),
      insideScoring: a.float(),
      outsideDefense: a.float(),
      insideDefense: a.float(),
      rebounding: a.float(),
      offensiveFlow: a.float(),
    }),

    LeagueSeasonSimulationTeamModifier: a.customType({
      teamId: a.string().required(),
      ratings: a.ref("LeagueSeasonSimulationRatingModifier").required(),
    }),

    LeagueSeasonSimulationCompletedPhase: a.customType({
      phaseKey: a.ref("LeagueSeasonSimulationProgressPhaseKey").required(),
      startedAt: a.datetime().required(),
      completedAt: a.datetime().required(),
      durationMs: a.integer().required(),
      summary: a.string().required(),
    }),

    LeagueSeasonSimulationProgressContext: a.customType({
      teamCount: a.integer(),
      candidateGameCount: a.integer(),
      remainingGameCount: a.integer(),
      scoredGameCount: a.integer(),
      simulationCount: a.integer(),
      lowSampleTeamCount: a.integer(),
      currentSeason: a.integer(),
    }),

    LeagueSeasonSimulationProgress: a.customType({
      phaseKey: a.ref("LeagueSeasonSimulationProgressPhaseKey").required(),
      phaseIndex: a.integer().required(),
      phaseCount: a.integer().required(),
      summary: a.string().required(),
      updatedAt: a.datetime().required(),
      currentPhaseStartedAt: a.datetime(),
      completedPhases: a
        .ref("LeagueSeasonSimulationCompletedPhase")
        .required()
        .array()
        .required(),
      context: a.ref("LeagueSeasonSimulationProgressContext"),
      completedUnits: a.integer(),
      totalUnits: a.integer(),
      unitLabel: a.string(),
    }),

    LeagueSeasonSimulationFinishProbability: a.customType({
      place: a.integer().required(),
      probability: a.float().required(),
    }),

    LeagueSeasonSimulationSourceSnapshot: a.customType({
      teamId: a.string().required(),
      teamName: a.string(),
      candidateGameCount: a.integer().required(),
      ratings: a.ref("MatchBoxscoreTeamRatings"),
      ratingModifiers: a.ref("MatchBoxscoreTeamRatings"),
      effectiveRatings: a.ref("MatchBoxscoreTeamRatings"),
      sourceMatchId: a.string(),
      sourceSeason: a.integer(),
      sourceStartTime: a.datetime(),
      offense: a.string().required(),
      defense: a.string().required(),
      selectionStrategy: a
        .ref("LeagueSeasonSimulationSelectionStrategy")
        .required(),
      sampleWarning: a.string(),
    }),

    LeagueSeasonSimulationTeamResult: a.customType({
      teamId: a.string().required(),
      teamName: a.string(),
      standingsIndex: a.integer().required(),
      currentWins: a.integer().required(),
      currentLosses: a.integer().required(),
      currentPointMargin: a.float().required(),
      expectedWins: a.float().required(),
      expectedLosses: a.float().required(),
      expectedPointMargin: a.float().required(),
      averageFinish: a.float().required(),
      firstPlaceProbability: a.float().required(),
      winsP10: a.float().required(),
      winsP50: a.float().required(),
      winsP90: a.float().required(),
      finishProbabilities: a
        .ref("LeagueSeasonSimulationFinishProbability")
        .required()
        .array()
        .required(),
      snapshot: a.ref("LeagueSeasonSimulationSourceSnapshot").required(),
    }),

    LeagueSeasonSimulationConferenceResult: a.customType({
      conferenceIndex: a.integer().required(),
      teams: a
        .ref("LeagueSeasonSimulationTeamResult")
        .required()
        .array()
        .required(),
    }),

    LeagueSeasonSimulationGameResult: a.customType({
      matchId: a.string().required(),
      startTime: a.datetime(),
      homeTeamId: a.string().required(),
      homeTeamName: a.string(),
      awayTeamId: a.string().required(),
      awayTeamName: a.string(),
      expectedHomeScore: a.float().required(),
      expectedAwayScore: a.float().required(),
      expectedMargin: a.float().required(),
      homeWinProbability: a.float().required(),
      homeOffense: a.string().required(),
      homeDefense: a.string().required(),
      awayOffense: a.string().required(),
      awayDefense: a.string().required(),
    }),

    LeagueSeasonSimulationResult: a.customType({
      generatedAt: a.datetime().required(),
      leagueId: a.string().required(),
      leagueName: a.string(),
      scenarioKey: a.string(),
      season: a.integer().required(),
      modelVersion: a.string(),
      simulationCount: a.integer().required(),
      residualSigma: a.float().required(),
      lowSampleTeamCount: a.integer().required(),
      conferences: a
        .ref("LeagueSeasonSimulationConferenceResult")
        .required()
        .array()
        .required(),
      remainingGames: a
        .ref("LeagueSeasonSimulationGameResult")
        .required()
        .array()
        .required(),
    }),

    LeagueSeasonSimulationSnapshot: a.customType({
      jobId: a.string().required(),
      leagueId: a.string().required(),
      leagueName: a.string(),
      season: a.integer().required(),
      teamId: a.string().required(),
      teamName: a.string(),
      executionArn: a.string(),
      status: a.ref("LeagueSeasonSimulationJobStatus").required(),
      requestedAt: a.datetime().required(),
      startedAt: a.datetime(),
      completedAt: a.datetime(),
      error: a.string(),
      progress: a.ref("LeagueSeasonSimulationProgress"),
      result: a.ref("LeagueSeasonSimulationResult"),
    }),

    LeagueSeasonSimulationArtifactTeamStanding: a.customType({
      conferenceIndex: a.integer().required(),
      currentLosses: a.integer().required(),
      currentPointMargin: a.float().required(),
      currentWins: a.integer().required(),
      stableRank: a.integer().required(),
      teamId: a.string().required(),
      teamName: a.string(),
    }),

    LeagueSeasonSimulationArtifactRemainingGame: a.customType({
      awayTeamId: a.string().required(),
      awayTeamName: a.string(),
      homeTeamId: a.string().required(),
      homeTeamName: a.string(),
      matchId: a.string().required(),
      startTime: a.datetime(),
    }),

    LeagueSeasonSimulationContextArtifact: a.customType({
      candidateGameCount: a.integer().required(),
      currentSeason: a.integer().required(),
      leagueId: a.string().required(),
      leagueName: a.string(),
      remainingGames: a
        .ref("LeagueSeasonSimulationArtifactRemainingGame")
        .required()
        .array()
        .required(),
      teamCount: a.integer().required(),
      teams: a
        .ref("LeagueSeasonSimulationArtifactTeamStanding")
        .required()
        .array()
        .required(),
    }),

    LeagueSeasonSimulationTeamSnapshotArtifact: a.customType({
      conferenceIndex: a.integer().required(),
      currentLosses: a.integer().required(),
      currentPointMargin: a.float().required(),
      currentWins: a.integer().required(),
      stableRank: a.integer().required(),
      teamId: a.string().required(),
      teamName: a.string(),
      candidateGameCount: a.integer().required(),
      effectiveRatings: a.ref("MatchBoxscoreTeamRatings"),
      normalizedRatings: a.ref("MatchBoxscoreTeamRatings"),
      ratingModifiers: a.ref("MatchBoxscoreTeamRatings"),
      sourceDefense: a.string().required(),
      sourceOffense: a.string().required(),
      sampleWarning: a.string(),
      selectionStrategy: a
        .ref("LeagueSeasonSimulationSelectionStrategy")
        .required(),
      sourceMatchId: a.string(),
      sourceSeason: a.integer(),
      sourceStartTime: a.datetime(),
    }),

    LeagueSeasonSimulationScoredGameArtifact: a.customType({
      awayTeamId: a.string().required(),
      awayTeamName: a.string(),
      homeTeamId: a.string().required(),
      homeTeamName: a.string(),
      matchId: a.string().required(),
      startTime: a.datetime(),
      awayTeamIndex: a.integer().required(),
      expectedAwayScore: a.float().required(),
      expectedHomeScore: a.float().required(),
      expectedMargin: a.float().required(),
      awayDefense: a.string().required(),
      awayOffense: a.string().required(),
      homeTeamIndex: a.integer().required(),
      homeDefense: a.string().required(),
      homeOffense: a.string().required(),
      homeWinProbability: a.float().required(),
      modelVersion: a.string(),
    }),

    GameDayRecapSubmitResult: a.customType({
      targetKey: a.string().required(),
      executionArn: a.string(),
    }),

    GameDayRecapStoredRequest: a.customType({
      approach: a.ref("RecapGenerationApproach"),
      gameDate: a.date().required(),
      interviewIntensity: a.ref("RecapInterviewIntensity"),
      leagueId: a.string().required(),
      modelJudgeEnabled: a.boolean(),
      mode: a.ref("RecapRequestMode").required(),
      qualityTier: a.ref("RecapQualityTier").required(),
    }),

    LeagueGameDayRecapStoredRequest: a.customType({
      approach: a.ref("RecapGenerationApproach"),
      gameDayNumber: a.integer().required(),
      interviewIntensity: a.ref("RecapInterviewIntensity"),
      leagueId: a.string().required(),
      modelJudgeEnabled: a.boolean(),
      mode: a.ref("RecapRequestMode").required(),
      qualityTier: a.ref("RecapQualityTier").required(),
      season: a.integer(),
    }),

    LeagueGameDayPerformancesStoredRequest: a.customType({
      gameDayNumber: a.integer().required(),
      leagueId: a.string().required(),
      mode: a.ref("RecapRequestMode").required(),
      season: a.integer(),
    }),

    SingleGameSummaryStoredRequest: a.customType({
      approach: a.ref("RecapGenerationApproach"),
      interviewIntensity: a.ref("RecapInterviewIntensity"),
      loserInterviewPersonalityType: a.string(),
      matchId: a.string().required(),
      modelJudgeEnabled: a.boolean(),
      mode: a.ref("RecapRequestMode").required(),
      qualityTier: a.ref("RecapQualityTier").required(),
      winnerInterviewPersonalityType: a.string(),
    }),

    GameDayRecapCoverageMissingGame: a.customType({
      awayTeamName: a.string().required(),
      homeTeamName: a.string().required(),
      matchId: a.string().required(),
      reason: a.string().required(),
    }),

    GameDayRecapCoverage: a.customType({
      availableGames: a.integer().required(),
      missingGames: a
        .ref("GameDayRecapCoverageMissingGame")
        .required()
        .array()
        .required(),
      partial: a.boolean().required(),
      requestedGames: a.integer().required(),
    }),

    GameDayRecapCostStage: a.customType({
      cacheReadInputTokens: a.integer(),
      cacheWriteInputTokens: a.integer(),
      estimatedCostUsd: a.float(),
      inputTokens: a.integer().required(),
      modelId: a.string().required(),
      outputTokens: a.integer().required(),
      providerName: a.string().required(),
      requestCount: a.integer().required(),
      stage: a.string().required(),
      totalTokens: a.integer().required(),
    }),

    GameDayRecapCost: a.customType({
      cacheReadInputTokens: a.integer(),
      cacheWriteInputTokens: a.integer(),
      currency: a.string().required(),
      estimatedPerGameCostUsd: a.float(),
      estimatedTotalCostUsd: a.float(),
      generatedGameCount: a.integer(),
      inputTokens: a.integer().required(),
      outputTokens: a.integer().required(),
      pricingStatus: a.string().required(),
      requestCount: a.integer().required(),
      stages: a.ref("GameDayRecapCostStage").required().array().required(),
      totalTokens: a.integer().required(),
    }),

    GameDayRecapValidationIssue: a.customType({
      actualValue: a.string(),
      feedback: a.string(),
      field: a.string().required(),
      kind: a.string().required(),
      reason: a.string().required(),
      sentence: a.string().required(),
      sentenceIndex: a.integer().required(),
      source: a.string().required(),
      sourceField: a.string(),
      teamSide: a.string(),
      verdict: a.string(),
    }),

    GameDayRecapGameValidation: a.customType({
      issueCount: a.integer().required(),
      issues: a
        .ref("GameDayRecapValidationIssue")
        .required()
        .array()
        .required(),
      status: a.string().required(),
    }),

    GameDayRecapFailureGame: a.customType({
      awayTeamName: a.string(),
      homeTeamName: a.string(),
      issueCount: a.integer().required(),
      issues: a
        .ref("GameDayRecapValidationIssue")
        .required()
        .array()
        .required(),
      matchId: a.string(),
    }),

    GameDayRecapFailureDetails: a.customType({
      errorName: a.string(),
      failedGameCount: a.integer().required(),
      games: a.ref("GameDayRecapFailureGame").required().array().required(),
      issueCount: a.integer().required(),
      message: a.string().required(),
      repairActionCount: a.integer().required(),
    }),

    GameDayRecapResultGame: a.customType({
      evidenceTags: a.string().required().array().required(),
      headline: a.string().required(),
      matchId: a.string().required(),
      postgameInterview: a.ref("GameDayRecapResultPostgameInterview"),
      postgameInterviews: a
        .ref("GameDayRecapResultPostgameInterview")
        .array(),
      postgameInterviewDiagnostics: a
        .ref("GameDayRecapPostgameInterviewDiagnostic")
        .array(),
      surpriseFactor: a.float(),
      validation: a.ref("GameDayRecapGameValidation"),
      writeup: a.string().required(),
    }),

    GameDayRecapPostgameInterviewDiagnostic: a.customType({
      details: a.string().array(),
      reason: a.string(),
      side: a.string().required(),
      status: a.string().required(),
    }),

    GameDayRecapResultPostgameInterviewExchange: a.customType({
      answer: a.string().required(),
      question: a.string().required(),
    }),

    GameDayRecapResultPostgameInterview: a.customType({
      personalitySource: a.string(),
      personalityType: a.string(),
      playerName: a.string().required(),
      qa: a
        .ref("GameDayRecapResultPostgameInterviewExchange")
        .required()
        .array()
        .required(),
      teamName: a.string().required(),
      teamSide: a.string().required(),
      title: a.string().required(),
    }),

    GameDayRecapResultSummary: a.customType({
      gameOfTheDayMatchId: a.string(),
      gameOfTheDaySurpriseFactor: a.float(),
      headline: a.string().required(),
      lede: a.string().required(),
    }),

    GameDayRecapResult: a.customType({
      games: a.ref("GameDayRecapResultGame").required().array().required(),
      summary: a.ref("GameDayRecapResultSummary").required(),
    }),

    LeagueGameDayPerformancesStatLine: a.customType({
      assists: a.integer().required(),
      blocks: a.integer().required(),
      points: a.integer().required(),
      rebounds: a.integer().required(),
      steals: a.integer().required(),
    }),

    LeagueGameDayPerformancesPlayerEntry: a.customType({
      efficiency: a.integer().required(),
      minutes: a.integer().required(),
      personalFouls: a.integer().required(),
      playerId: a.string(),
      playerName: a.string().required(),
      position: a.string().required(),
      rating: a.float(),
      statLine: a.ref("LeagueGameDayPerformancesStatLine").required(),
      teamId: a.string(),
      teamName: a.string().required(),
      turnovers: a.integer().required(),
    }),

    LeagueGameDayPerformancesTeamEntry: a.customType({
      teamId: a.string(),
      teamName: a.string().required(),
    }),

    LeagueGameDayPerformancesGame: a.customType({
      awayScore: a.integer().required(),
      awayTeamName: a.string().required(),
      homeScore: a.integer().required(),
      homeTeamName: a.string().required(),
      matchId: a.string().required(),
    }),

    LeagueGameDayPerformancesPlayerLeaderboard: a.customType({
      key: a.string().required(),
      label: a.string().required(),
      leaders: a
        .ref("LeagueGameDayPerformancesPlayerEntry")
        .required()
        .array()
        .required(),
      unit: a.string(),
      value: a.float().required(),
    }),

    LeagueGameDayPerformancesTeamLeaderboard: a.customType({
      key: a.string().required(),
      label: a.string().required(),
      leaders: a
        .ref("LeagueGameDayPerformancesTeamEntry")
        .required()
        .array()
        .required(),
      unit: a.string(),
      value: a.float().required(),
    }),

    LeagueGameDayPerformancesPositionLeaderboard: a.customType({
      key: a.string().required(),
      label: a.string().required(),
      leaders: a
        .ref("LeagueGameDayPerformancesPlayerEntry")
        .required()
        .array()
        .required(),
      position: a.string().required(),
      value: a.float().required(),
    }),

    LeagueGameDayPerformancesResult: a.customType({
      badPerformance: a
        .ref("LeagueGameDayPerformancesPlayerLeaderboard")
        .required(),
      gameDate: a.date(),
      gameDayNumber: a.integer().required(),
      games: a.ref("LeagueGameDayPerformancesGame").required().array().required(),
      leagueId: a.string().required(),
      leagueName: a.string(),
      mvp: a.ref("LeagueGameDayPerformancesPlayerLeaderboard").required(),
      playerLeaders: a
        .ref("LeagueGameDayPerformancesPlayerLeaderboard")
        .required()
        .array()
        .required(),
      season: a.integer(),
      statCallouts: a
        .ref("LeagueGameDayPerformancesPlayerLeaderboard")
        .required()
        .array()
        .required(),
      teamLeaders: a
        .ref("LeagueGameDayPerformancesTeamLeaderboard")
        .required()
        .array()
        .required(),
      topFive: a
        .ref("LeagueGameDayPerformancesPositionLeaderboard")
        .required()
        .array()
        .required(),
      tripleDoubles: a
        .ref("LeagueGameDayPerformancesPlayerEntry")
        .required()
        .array()
        .required(),
    }),

    AccessibleMatchSummary: a.customType({
      ingestStatus: a.string().required(),
      matchId: a.string().required(),
      opponentScore: a.integer(),
      opponentTeamId: a.string(),
      opponentTeamName: a.string(),
      outcome: a.string(),
      season: a.integer(),
      startTime: a.datetime(),
      teamId: a.string().required(),
      teamScore: a.integer(),
      type: a.string(),
    }),

    AccessibleMatchPage: a.customType({
      items: a.ref("AccessibleMatchSummary").required().array().required(),
      nextCursor: a.string(),
    }),

    JsonLookupResponse: a.customType({
      status: a.string().required(),
      payload: a.json(),
      error: a.string(),
    }),

    TeamHighlightsScanSubmitResult: a.customType({
      queued: a.boolean().required(),
      requestedAt: a.datetime().required(),
      status: a.ref("TeamHighlightsScanState").required(),
      teamId: a.string().required(),
      teamName: a.string(),
      executionArn: a.string(),
    }),

    LineupHelperDefensiveSwitch: a.customType({
      pg: a.ref("PositionCode").required(),
      sg: a.ref("PositionCode").required(),
      sf: a.ref("PositionCode").required(),
      pf: a.ref("PositionCode").required(),
      c: a.ref("PositionCode").required(),
    }),

    LineupHelperContext: a.customType({
      offense: a.string().required(),
      defense: a.string().required(),
      enthusiasm: a.integer().required(),
      homeCourt: a.string().required(),
      defensiveSwitch: a.ref("LineupHelperDefensiveSwitch").required(),
    }),

    LineupHelperAssignment: a.customType({
      playerId: a.string().required(),
      position: a.ref("PositionCode").required(),
      minutes: a.integer().required(),
    }),

    LineupHelperRosterSkills: a.customType({
      js: a.integer().required(),
      jr: a.integer().required(),
      od: a.integer().required(),
      ha: a.integer().required(),
      dr: a.integer().required(),
      pa: a.integer().required(),
      is: a.integer().required(),
      id: a.integer().required(),
      rb: a.integer().required(),
      sb: a.integer().required(),
      st: a.integer().required(),
      ft: a.integer().required(),
      ex: a.integer().required(),
      gs: a.integer().required(),
    }),

    LineupHelperRosterPlayer: a.customType({
      playerId: a.string().required(),
      fullName: a.string().required(),
      bestPosition: a.string(),
      salary: a.integer(),
      age: a.integer(),
      gameShape: a.string(),
      dmi: a.integer(),
      injuryWeeks: a.integer(),
      snapshotWeekKey: a.string(),
      snapshotCapturedAt: a.datetime(),
      available: a.boolean().required(),
      snapshotWarning: a.string(),
      skills: a.ref("LineupHelperRosterSkills").required(),
    }),

    LineupHelperSnapshotWarning: a.customType({
      playerId: a.string().required(),
      fullName: a.string().required(),
      warning: a.string().required(),
    }),

    LineupHelperRankingEntry: a.customType({
      playerId: a.string().required(),
      name: a.string().required(),
      output: a.float().required(),
    }),

    LineupHelperPositionOutput: a.customType({
      pg: a.float().required(),
      sg: a.float().required(),
      sf: a.float().required(),
      pf: a.float().required(),
      c: a.float().required(),
    }),

    LineupHelperPlayerPositionOutput: a.customType({
      playerId: a.string().required(),
      output: a.ref("LineupHelperPositionOutput").required(),
    }),

    LineupHelperPositionRankings: a.customType({
      pg: a.ref("LineupHelperRankingEntry").required().array().required(),
      sg: a.ref("LineupHelperRankingEntry").required().array().required(),
      sf: a.ref("LineupHelperRankingEntry").required().array().required(),
      pf: a.ref("LineupHelperRankingEntry").required().array().required(),
      c: a.ref("LineupHelperRankingEntry").required().array().required(),
    }),

    LineupHelperRatingValues: a.customType({
      outsideScoring: a.float().required(),
      insideScoring: a.float().required(),
      outsideDefense: a.float().required(),
      insideDefense: a.float().required(),
      rebounding: a.float().required(),
      offensiveFlow: a.float().required(),
    }),

    LineupHelperRatingLabels: a.customType({
      outsideScoring: a.string().required(),
      insideScoring: a.string().required(),
      outsideDefense: a.string().required(),
      insideDefense: a.string().required(),
      rebounding: a.string().required(),
      offensiveFlow: a.string().required(),
    }),

    LineupHelperPerPositionContributions: a.customType({
      outsideScoring: a.ref("LineupHelperPositionOutput").required(),
      insideScoring: a.ref("LineupHelperPositionOutput").required(),
      outsideDefense: a.ref("LineupHelperPositionOutput").required(),
      insideDefense: a.ref("LineupHelperPositionOutput").required(),
      rebounding: a.ref("LineupHelperPositionOutput").required(),
      offensiveFlow: a.ref("LineupHelperPositionOutput").required(),
    }),

    LineupHelperWorkspace: a.customType({
      generatedAt: a.datetime().required(),
      syncedAt: a.datetime(),
      roster: a.ref("LineupHelperRosterPlayer").required().array().required(),
      defaultContext: a.ref("LineupHelperContext").required(),
      defaultAssignments: a
        .ref("LineupHelperAssignment")
        .required()
        .array()
        .required(),
      evaluation: a.ref("LineupHelperEvaluation"),
      snapshotWarnings: a
        .ref("LineupHelperSnapshotWarning")
        .required()
        .array()
        .required(),
      availableOffenses: a.string().required().array().required(),
      availableDefenses: a.string().required().array().required(),
      availableLocations: a.string().required().array().required(),
    }),

    LineupHelperEvaluation: a.customType({
      context: a.ref("LineupHelperContext").required(),
      normalizedLineup: a
        .ref("LineupHelperAssignment")
        .required()
        .array()
        .required(),
      rawRatings: a.ref("LineupHelperRatingValues").required(),
      roundedRatings: a.ref("LineupHelperRatingValues").required(),
      ratingLabels: a.ref("LineupHelperRatingLabels").required(),
      outputBandLabels: a.ref("LineupHelperRatingLabels").required(),
      warnings: a.string().required().array().required(),
      rankings: a.ref("LineupHelperPositionRankings").required(),
      playerPositionOutputs: a
        .ref("LineupHelperPlayerPositionOutput")
        .required()
        .array()
        .required(),
      perPositionContributions: a
        .ref("LineupHelperPerPositionContributions")
        .required(),
      totalOutput: a.float().required(),
    }),

    MatchBoxscorePlayerLine: a.customType({
      playerId: a.string(),
      firstName: a.string(),
      lastName: a.string(),
      fullName: a.string().required(),
      isStarter: a.boolean().required(),
      minutes: a.float(),
      performance: a.ref("MatchMetricEntry").required().array().required(),
      minutesByPosition: a
        .ref("MatchMetricEntry")
        .required()
        .array()
        .required(),
    }),

    MatchBoxscoreTeam: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      shortName: a.string(),
      offStrategy: a.string(),
      defStrategy: a.string(),
      score: a.integer(),
      partialScores: a.integer().required().array().required(),
      teamTotals: a.ref("MatchMetricEntry").required().array().required(),
      ratings: a.ref("MatchBoxscoreTeamRatings"),
      efficiency: a.ref("MatchMetricEntry").required().array().required(),
      players: a.ref("MatchBoxscorePlayerLine").required().array().required(),
    }),

    StoredForecastPlayerSummary: a.customType({
      playerId: a.string(),
      fullName: a.string().required(),
      totalMinutes: a.float().required(),
      performance: a.ref("MatchMetricEntry").required().array().required(),
      minutesByPosition: a
        .ref("MatchMetricEntry")
        .required()
        .array()
        .required(),
    }),

    StoredForecastTeamSnapshot: a.customType({
      teamId: a.string(),
      teamName: a.string(),
      score: a.integer(),
      offStrategy: a.string(),
      defStrategy: a.string(),
      gdpFocus: a.string(),
      gdpPace: a.string(),
      ratings: a.ref("MatchBoxscoreTeamRatings"),
      efficiency: a.ref("MatchMetricEntry").required().array().required(),
      players: a
        .ref("StoredForecastPlayerSummary")
        .required()
        .array()
        .required(),
    }),

    StoredForecastBoxscore: a.customType({
      matchId: a.string(),
      startTime: a.datetime(),
      type: a.string(),
      season: a.integer(),
      effortDelta: a.integer(),
      neutral: a.boolean(),
      seriousness: a.string(),
      seriousnessReason: a.string(),
      seriousnessScore: a.float(),
      team: a.ref("StoredForecastTeamSnapshot").required(),
      opponent: a.ref("StoredForecastTeamSnapshot").required(),
    }),

    MatchBoxscoreDetails: a.customType({
      matchId: a.string().required(),
      matchType: a.string(),
      startTime: a.datetime(),
      endTime: a.datetime(),
      attendance: a.ref("ArenaSectionAttendance"),
      homeTeam: a.ref("MatchBoxscoreTeam"),
      awayTeam: a.ref("MatchBoxscoreTeam"),
      context: a.ref("MatchContext"),
      source: a.string().required(),
    }),

    StoredMatchBoxscore: a.customType({
      matchId: a.string().required(),
      matchType: a.string(),
      startTime: a.datetime(),
      endTime: a.datetime(),
      attendance: a.ref("ArenaSectionAttendance"),
      homeTeam: a.ref("MatchBoxscoreTeam"),
      awayTeam: a.ref("MatchBoxscoreTeam"),
      context: a.ref("MatchContext"),
      source: a.string().required(),
    }),

    TeamHighlightsFilters: a.customType({
      onlyOutcomeChange: a.boolean().required(),
      perspective: a.ref("TeamHighlightsPerspective").required(),
    }),

    TeamHighlightsBrokenMatch: a.customType({
      awayTeamName: a.string(),
      boxscoreUrl: a.string().required(),
      homeTeamName: a.string(),
      issue: a.string().required(),
      matchId: a.string().required(),
      matchType: a.string(),
      season: a.integer(),
      startTime: a.datetime(),
    }),

    TeamHighlightsScanStatus: a.customType({
      brokenMatches: a.ref("TeamHighlightsBrokenMatch").required().array(),
      completedAt: a.datetime(),
      currentSeason: a.integer(),
      errorCode: a.string(),
      executionArn: a.string(),
      error: a.string(),
      matchesAlreadyRecorded: a.integer(),
      matchesCompleted: a.integer(),
      matchesDiscovered: a.integer(),
      matchesEnqueuedForIngest: a.integer(),
      matchesEnqueuedForMaterialize: a.integer(),
      matchesFailed: a.integer(),
      matchesProcessedThisRun: a.integer(),
      matchesReused: a.integer(),
      matchesWithMoments: a.integer(),
      matchesWithoutMoments: a.integer(),
      momentsWritten: a.integer(),
      requestedAt: a.datetime().required(),
      seasonsFrom: a.integer(),
      seasonsTo: a.integer(),
      startedAt: a.datetime(),
      status: a.ref("TeamHighlightsScanState").required(),
      teamId: a.string().required(),
      teamName: a.string(),
      unsupportedSeasonsWarning: a.string(),
      updatedAt: a.datetime(),
    }),

    TeamHighlightsMoment: a.customType({
      comment: a.string(),
      eventKind: a.string(),
      finalOpponentScore: a.integer(),
      finalScoreAway: a.integer(),
      finalScoreHome: a.integer(),
      finalTeamScore: a.integer(),
      freeThrowType: a.string(),
      gameclock: a.float(),
      isHome: a.boolean(),
      matchId: a.string().required(),
      matchType: a.string(),
      momentId: a.string().required(),
      opponentId: a.string(),
      opponentName: a.string(),
      opponentScoreAfter: a.integer(),
      opponentScoreBefore: a.integer(),
      outcomeChanged: a.boolean().required(),
      period: a.string(),
      perspective: a.ref("TeamHighlightsPerspective").required(),
      playerId: a.string(),
      playerName: a.string(),
      recordId: a.string().required(),
      scoreAfterAway: a.integer(),
      scoreAfterHome: a.integer(),
      scoreBeforeAway: a.integer(),
      scoreBeforeHome: a.integer(),
      scoringTeamId: a.string(),
      scoringTeamName: a.string(),
      season: a.integer(),
      shotDistanceFt: a.float(),
      shotResult: a.string(),
      shotType: a.string(),
      shotTypeLabel: a.string(),
      shotX: a.float(),
      shotY: a.float(),
      startTime: a.datetime(),
      teamId: a.string().required(),
      teamName: a.string(),
      teamScoreAfter: a.integer(),
      teamScoreBefore: a.integer(),
      viewerUrl: a.string(),
    }),

    TeamHighlightsClearResult: a.customType({
      clearedCoverageCount: a.integer().required(),
      deletedMomentCount: a.integer().required(),
      teamId: a.string().required(),
      teamName: a.string(),
    }),

    TeamHighlightsSummary: a.customType({
      againstMoments: a.integer().required(),
      filteredMoments: a.integer().required(),
      forMoments: a.integer().required(),
      outcomeChangeMoments: a.integer().required(),
      totalMoments: a.integer().required(),
    }),

    TeamHighlightsTeam: a.customType({
      teamId: a.string().required(),
      teamName: a.string(),
    }),

    TeamHighlights: a.customType({
      filters: a.ref("TeamHighlightsFilters").required(),
      items: a.ref("TeamHighlightsMoment").required().array().required(),
      nextCursor: a.string(),
      scanStatus: a.ref("TeamHighlightsScanStatus"),
      summary: a.ref("TeamHighlightsSummary").required(),
      team: a.ref("TeamHighlightsTeam").required(),
    }),

    PredictionVenue: a.enum(["TEAM_A_HOME", "NEUTRAL", "TEAM_B_HOME"]),

    PredictionManualInput: a.customType({
      home_outsideScoring: a.float().required(),
      home_insideScoring: a.float().required(),
      home_outsideDefense: a.float().required(),
      home_insideDefense: a.float().required(),
      home_rebounding: a.float().required(),
      home_offensiveFlow: a.float().required(),
      away_outsideScoring: a.float().required(),
      away_insideScoring: a.float().required(),
      away_outsideDefense: a.float().required(),
      away_insideDefense: a.float().required(),
      away_rebounding: a.float().required(),
      away_offensiveFlow: a.float().required(),
      home_gdp_focus: a.string().required(),
      home_gdp_pace: a.string().required(),
      away_gdp_focus: a.string().required(),
      away_gdp_pace: a.string().required(),
      neutral: a.string().required(),
      effortDelta: a.float().required(),
    }),

    PredictionForecastContext: a.customType({
      forecastJobId: a.string().required(),
      forecastModelVersion: a.string().required(),
      forecastGeneratedAt: a.datetime().required(),
      scenarioId: a.string().required(),
      scenarioLabel: a.string().required(),
      scenarioProbability: a.float().required(),
      enthusiasmBand: a.string(),
      evidence: a.string().required().array().required(),
      sourceTeamId: a.string().required(),
    }),

    PredictionSubmissionRequestInput: a.customType({
      input: a.ref("PredictionManualInput").required(),
      forecastContext: a.ref("PredictionForecastContext"),
      modelKey: a.string(),
    }),

    PredictionMatrixRatingsInput: a.customType({
      insideDefense: a.float().required(),
      insideScoring: a.float().required(),
      offensiveFlow: a.float().required(),
      outsideDefense: a.float().required(),
      outsideScoring: a.float().required(),
      rebounding: a.float().required(),
    }),

    PredictionMatrixSideInput: a.customType({
      defense: a.string().required(),
      effortChoice: a.string().required(),
      offense: a.string().required(),
      ratings: a.ref("PredictionMatrixRatingsInput").required(),
      teamId: a.string(),
      teamName: a.string(),
    }),

    PredictionMatrixRequestInput: a.customType({
      modelKey: a.string(),
      teamA: a.ref("PredictionMatrixSideInput").required(),
      teamB: a.ref("PredictionMatrixSideInput").required(),
      venue: a.ref("PredictionVenue").required(),
    }),

    PredictionMatrixSideSummary: a.customType({
      defense: a.string().required(),
      effortChoice: a.string().required(),
      offense: a.string().required(),
      teamId: a.string(),
      teamName: a.string(),
    }),

    PredictionMatrixTacticPair: a.customType({
      pairId: a.string().required(),
      offense: a.string().required(),
      defense: a.string().required(),
      estimated: a.boolean().required(),
      supportTier: a.ref("PlannerSupportTier").required(),
    }),

    PredictionMatrixCell: a.customType({
      teamAPairId: a.string().required(),
      teamBPairId: a.string().required(),
      available: a.boolean().required(),
      bestEffortChoice: a.string(),
      predictedPointDiff: a.float(),
      predictedTeamAScore: a.float(),
      predictedTeamBScore: a.float(),
    }),

    PredictionMatrixRow: a.customType({
      teamBPairId: a.string().required(),
      cells: a.ref("PredictionMatrixCell").required().array().required(),
    }),

    PredictionMatrixView: a.customType({
      viewId: a.string().required(),
      label: a.string().required(),
      scenarioId: a.string(),
      probability: a.float(),
      rows: a.ref("PredictionMatrixRow").required().array().required(),
    }),

    PredictionMatrixResult: a.customType({
      generatedAt: a.datetime().required(),
      modelKey: a.string(),
      modelVersion: a.string().required(),
      selectedTeamAPairId: a.string(),
      selectedTeamBPairId: a.string(),
      teamAPairs: a
        .ref("PredictionMatrixTacticPair")
        .required()
        .array()
        .required(),
      teamASide: a.ref("PredictionMatrixSideSummary").required(),
      teamBPairs: a
        .ref("PredictionMatrixTacticPair")
        .required()
        .array()
        .required(),
      teamBSide: a.ref("PredictionMatrixSideSummary").required(),
      venue: a.ref("PredictionVenue").required(),
      views: a.ref("PredictionMatrixView").required().array().required(),
    }),

    SharedPlayerCardPayloadPlayer: a.customType({
      playerId: a.string(),
      fullName: a.string().required(),
      bestPosition: a.string(),
      salary: a.integer(),
      nationalityName: a.string(),
      gameShape: a.string(),
      dmi: a.integer(),
      injuryWeeks: a.integer(),
    }),

    SharedPlayerCardPayload: a.customType({
      player: a.ref("SharedPlayerCardPayloadPlayer").required(),
    }),

    SalaryCalculatorSkills: a.customType({
      jumpShot: a.integer().required(),
      jumpRange: a.integer().required(),
      outsideDefense: a.integer().required(),
      handling: a.integer().required(),
      driving: a.integer().required(),
      passing: a.integer().required(),
      insideScoring: a.integer().required(),
      insideDefense: a.integer().required(),
      rebounding: a.integer().required(),
      shotBlocking: a.integer().required(),
    }),

    SalaryByPosition: a.customType({
      PG: a.integer().required(),
      SG: a.integer().required(),
      SF: a.integer().required(),
      PF: a.integer().required(),
      C: a.integer().required(),
    }),

    SalaryCalculatorSeed: a.customType({
      playerId: a.string().required(),
      fullName: a.string().required(),
      currentSalary: a.integer(),
      bestPosition: a.string(),
      skills: a.ref("SalaryCalculatorSkills").required(),
    }),

    ManualSalaryEstimateInput: a.customType({
      skills: a.ref("SalaryCalculatorSkills").required(),
    }),

    ManualSalaryEstimate: a.customType({
      predictedSalary: a.integer().required(),
      bestPosition: a.string().required(),
      salaryByPosition: a.ref("SalaryByPosition").required(),
      modelSource: a.string().required(),
      modelSourceConfidence: a.string().required(),
      calibrationMode: a.string().required(),
      correctionFactorApplied: a.float().required(),
    }),

    SalaryProjection: a.customType({
      playerId: a.string().required(),
      fullName: a.string().required(),
      bestPosition: a.string(),
      nationalityName: a.string(),
      currentSalary: a.integer(),
      projectedSalary: a.integer(),
      weeklyDelta: a.integer(),
      trend: a.string().required(),
      isFlagTarget: a.boolean().required(),
      flagReason: a.string(),
    }),

    BillingAccount: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        email: a.string(),
        stripeCustomerId: a.string(),
        stripeSubscriptionId: a.string(),
        stripePriceId: a.string(),
        stripeSubscriptionStatus: a.string(),
        subscriptionPlanId: a.string(),
        currentPeriodEndAt: a.datetime(),
        cancelAtPeriodEnd: a.boolean(),
        grantedPlanId: a.string(),
        overrideExpiresAt: a.datetime(),
        overrideReason: a.string(),
        lifetimePlanId: a.string(),
        lifetimeGrantedAt: a.datetime(),
        lifetimeSourceObjectId: a.string(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    BillingPayment: a
      .model({
        providerObjectType: a.string().required(),
        providerObjectId: a.string().required(),
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        paymentKind: a.string().required(),
        status: a.string().required(),
        amountTotal: a.integer(),
        currency: a.string(),
        occurredAt: a.datetime().required(),
        grantedPlanId: a.string(),
        stripeCheckoutSessionId: a.string(),
        stripeCustomerId: a.string(),
        stripeInvoiceId: a.string(),
        stripePaymentIntentId: a.string(),
        stripePriceId: a.string(),
        stripeSubscriptionId: a.string(),
      })
      .identifier(["providerObjectType", "providerObjectId"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["occurredAt"])
          .queryField("listBillingPaymentsByUserIdAndOccurredAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    UserPreference: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read", "delete"]),
          ]),
        themeId: a.ref("ThemeId").required(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId")]),

    FeedbackSubmission: a
      .model({
        id: a.string().required(),
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        kind: a.ref("FeedbackSubmissionKind").required(),
        subject: a.string().required(),
        message: a.string().required(),
        email: a.string(),
        username: a.string(),
        teamId: a.string(),
        teamName: a.string(),
        submittedAt: a.datetime().required(),
        notifiedAt: a.datetime(),
        notificationError: a.string(),
      })
      .identifier(["id"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    BbConnection: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        bbLoginName: a.string().required(),
        status: a.ref("ConnectionStatus").required(),
        accessKeyLast4: a.string(),
        teamId: a.string(),
        teamName: a.string(),
        shortName: a.string(),
        leagueId: a.string(),
        leagueName: a.string(),
        countryId: a.string(),
        countryName: a.string(),
        leagueTimeZone: a.string(),
        connectedAt: a.datetime(),
        lastValidatedAt: a.datetime(),
        lastSyncAt: a.datetime(),
        lastSyncError: a.string(),
        profileJson: a.ref("StoredTeamInfo"),
        workspaceCacheJson: a.ref("WorkspaceCachePayload"),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    BbCredential: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        cipherText: a.string().required(),
        iv: a.string().required(),
        authTag: a.string().required(),
        algorithm: a.string().required(),
        secretFingerprint: a.string(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedTeam: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        teamId: a.string().required(),
        name: a.string().required(),
        shortName: a.string(),
        leagueId: a.string(),
        leagueName: a.string(),
        countryId: a.string(),
        countryName: a.string(),
        arenaName: a.string(),
        rivalId: a.string(),
        isPrimary: a.boolean(),
        summaryJson: a.ref("StoredTeamInfo"),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "teamId"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["teamId"])
          .queryField("listTrackedTeamsByUserIdAndTeamId"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedPlayer: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        playerId: a.string().required(),
        teamId: a.string().required(),
        teamName: a.string(),
        firstName: a.string(),
        lastName: a.string(),
        fullName: a.string().required(),
        bestPosition: a.string(),
        salary: a.integer(),
        age: a.integer(),
        height: a.integer(),
        nationalityName: a.string(),
        gameShape: a.string(),
        dmi: a.integer(),
        injuryWeeks: a.integer(),
        interviewPersonalityType: a.string(),
        interviewPersonalitySource: a.string(),
        profileJson: a.ref("StoredOwnedRosterPlayer"),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "playerId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    PlayerSkillObservation: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        playerId: a.string().required(),
        capturedAt: a.datetime().required(),
        playerCapturedAtKey: a.string().required(),
        weekKey: a.string(),
        teamId: a.string().required(),
        teamName: a.string(),
        fullName: a.string().required(),
        bestPosition: a.string(),
        salary: a.integer(),
        gameShape: a.string(),
        dmi: a.integer(),
        injuryWeeks: a.integer(),
      })
      .identifier(["userId", "playerId", "capturedAt"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["playerCapturedAtKey"])
          .queryField(
            "listPlayerSkillObservationsByUserIdAndPlayerCapturedAtKey",
          ),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedMatch: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        matchId: a.string().required(),
        teamId: a.string().required(),
        opponentTeamId: a.string(),
        opponentTeamName: a.string(),
        type: a.string(),
        season: a.integer(),
        startTime: a.datetime(),
        isHome: a.boolean(),
        isNeutral: a.boolean(),
        teamScore: a.integer(),
        opponentScore: a.integer(),
        outcome: a.string(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "matchId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    MatchBoxscore: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        matchId: a.string().required(),
        boxscoreJson: a.ref("StoredMatchBoxscore"),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "matchId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    ArenaPricingSnapshot: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        capturedAt: a.datetime().required(),
        nextHomeMatchId: a.string(),
        nextHomeMatchStartTime: a.datetime(),
        arenaName: a.string(),
        seats: a.ref("ArenaSeatState").required().array().required(),
        expansion: a.ref("ArenaExpansionSummary"),
        cash: a.integer(),
        availableBalance: a.integer(),
        transactions: a
          .ref("ArenaEconomyTransaction")
          .required()
          .array()
          .required(),
      })
      .identifier(["userId", "capturedAt"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["capturedAt"])
          .queryField("listArenaPricingSnapshotsByUserIdAndCapturedAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueStanding: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        season: a.integer().required(),
        teamId: a.string().required(),
        leagueId: a.string(),
        leagueName: a.string(),
        conferenceIndex: a.integer(),
        teamName: a.string(),
        wins: a.integer(),
        losses: a.integer(),
        pf: a.integer(),
        pa: a.integer(),
        isBot: a.boolean(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "season", "teamId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueHistoryStandingCache: a
      .model({
        leagueId: a.string().required(),
        season: a.integer().required(),
        teamId: a.string().required(),
        leagueName: a.string(),
        teamName: a.string(),
        wins: a.integer(),
        losses: a.integer(),
        playoffWins: a.integer(),
        playoffLosses: a.integer(),
        championships: a.integer(),
        pf: a.integer(),
        pa: a.integer(),
        conferenceIndex: a.integer(),
        isBot: a.boolean(),
        fetchedAt: a.datetime(),
      })
      .identifier(["leagueId", "season", "teamId"])
      .secondaryIndexes((index) => [
        index("leagueId")
          .sortKeys(["season", "teamId"])
          .queryField("listLeagueHistoryStandingCachesByLeagueIdAndSeason"),
      ])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    LeagueHistoryBackfill: a
      .model({
        leagueId: a.string().required(),
        leagueName: a.string(),
        status: a.ref("LeagueHistoryBackfillState").required(),
        requestedAt: a.datetime().required(),
        startedAt: a.datetime(),
        completedAt: a.datetime(),
        error: a.string(),
        historicalSeasonsExpected: a.integer(),
        historicalSeasonsStored: a.integer(),
        lastCompletedSeason: a.integer(),
        executionArn: a.string(),
        updatedAt: a.datetime().required(),
      })
      .identifier(["leagueId"])
      .authorization((allow) => [allow.authenticated().to(["read"])]),

    RivalsWorkspaceCache: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        teamId: a.string().required(),
        teamName: a.string(),
        shortName: a.string(),
        generatedAt: a.datetime().required(),
        syncedAt: a.datetime(),
        warning: a.string(),
        summaryJson: a.ref("RivalsWorkspaceSummary").required(),
        matchesJson: a.ref("RivalsMatchesCacheEnvelope").required(),
      })
      .identifier(["userId", "teamId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    RivalryMatchFact: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        teamId: a.string().required(),
        matchId: a.string().required(),
        season: a.integer().required(),
        startTime: a.datetime().required(),
        gameDate: a.date(),
        opponentTeamId: a.string().required(),
        opponentTeamName: a.string().required(),
        competitionKey: a.string().required(),
        competitionLabel: a.string().required(),
        stageKey: a.string(),
        stageLabel: a.string(),
        venue: a.string().required(),
        isHome: a.boolean().required(),
        isTvGame: a.boolean().required(),
        teamScore: a.integer().required(),
        opponentScore: a.integer().required(),
        margin: a.integer().required(),
        outcome: a.string().required(),
        rawType: a.string(),
      })
      .identifier(["userId", "teamId", "matchId"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["teamId", "startTime"])
          .queryField("listRivalryMatchFactsByUserIdAndTeamIdAndStartTime"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    RivalsBackfill: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        teamId: a.string().required(),
        teamName: a.string(),
        status: a.ref("RivalsBackfillState").required(),
        requestedAt: a.datetime().required(),
        startedAt: a.datetime(),
        completedAt: a.datetime(),
        error: a.string(),
        executionArn: a.string(),
        failedSeasons: a.integer().array(),
        generatedAt: a.datetime(),
        seasonsScanned: a.integer(),
        totalCompletedGames: a.integer(),
        totalOpponents: a.integer(),
        updatedAt: a.datetime().required(),
      })
      .identifier(["userId", "teamId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    SyncRun: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        kind: a.string().required(),
        status: a.ref("SyncStatus").required(),
        startedAt: a.datetime().required(),
        completedAt: a.datetime(),
        error: a.string(),
        detailsJson: a.json(),
        expiryKey: a.string().required(),
        expiresAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["startedAt"])
          .queryField("listSyncRunsByUserAndStartedAt"),
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField("listSyncRunsByExpiryKeyAndExpiresAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    SharedPlayerCard: a
      .model({
        shareToken: a.string().required(),
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        playerId: a.string().required(),
        title: a.string(),
        note: a.string(),
        expiresAt: a.datetime(),
        revokedAt: a.datetime(),
        payloadJson: a.ref("SharedPlayerCardPayload"),
      })
      .identifier(["shareToken"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    PredictionJob: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        requestId: a.string().required(),
        status: a.ref("PredictionJobStatus").required(),
        requestedAt: a.datetime().required(),
        home_outsideScoring: a.float(),
        home_insideScoring: a.float(),
        home_outsideDefense: a.float(),
        home_insideDefense: a.float(),
        home_rebounding: a.float(),
        home_offensiveFlow: a.float(),
        away_outsideScoring: a.float(),
        away_insideScoring: a.float(),
        away_outsideDefense: a.float(),
        away_insideDefense: a.float(),
        away_rebounding: a.float(),
        away_offensiveFlow: a.float(),
        home_gdp_focus: a.string(),
        home_gdp_pace: a.string(),
        away_gdp_focus: a.string(),
        away_gdp_pace: a.string(),
        neutral: a.string(),
        effortDelta: a.float(),
        homeScore: a.float(),
        awayScore: a.float(),
        pointDiff: a.float(),
        error: a.string(),
        executionArn: a.string(),
        modelKey: a.string(),
        modelVersion: a.string(),
        forecastJobId: a.string(),
        forecastModelVersion: a.string(),
        forecastGeneratedAt: a.datetime(),
        forecastScenarioId: a.string(),
        forecastScenarioLabel: a.string(),
        forecastScenarioProbability: a.float(),
        forecastEnthusiasmBand: a.string(),
        forecastSourceTeamId: a.string(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    PredictionGridCell: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        requestId: a.string().required(),
        awayDefense: a.string().required(),
        homeOffense: a.string().required(),
        homeScore: a.float(),
        awayScore: a.float(),
        pointDiff: a.float(),
      })
      .identifier(["userId", "requestId", "awayDefense", "homeOffense"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestId"])
          .queryField("listPredictionGridCellsByUserIdAndRequestId"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    OpponentForecastJob: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        teamId: a.string().required(),
        teamName: a.string(),
        status: a.ref("OpponentForecastJobStatus").required(),
        requestedAt: a.datetime().required(),
        startedAt: a.datetime(),
        completedAt: a.datetime(),
        requestJson: a.ref("OpponentForecastJobRequest").required(),
        resolvedContextJson: a.ref("OpponentForecastResolvedContext"),
        resultJson: a.ref("OpponentForecastResult"),
        error: a.string(),
        executionArn: a.string(),
        modelVersion: a.string(),
        expiryKey: a.string().required(),
        expiresAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listOpponentForecastJobsByUserAndRequestedAt"),
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField("listOpponentForecastJobsByExpiryKeyAndExpiresAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    NextGameRecommendationJob: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        matchId: a.string().required(),
        opponentTeamId: a.string().required(),
        opponentTeamName: a.string(),
        enthusiasm: a.integer().required(),
        switchPg: a.ref("PositionCode").required(),
        switchSg: a.ref("PositionCode").required(),
        switchSf: a.ref("PositionCode").required(),
        switchPf: a.ref("PositionCode").required(),
        switchC: a.ref("PositionCode").required(),
        status: a.ref("NextGameRecommendationStatus").required(),
        requestedAt: a.datetime().required(),
        startedAt: a.datetime(),
        completedAt: a.datetime(),
        requestJson: a.ref("NextGameRecommendationStoredRequest").required(),
        progressJson: a.ref("NextGameRecommendationProgress"),
        resultJson: a.ref("NextGameRecommendationResult"),
        error: a.string(),
        executionArn: a.string(),
        expiryKey: a.string().required(),
        expiresAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listNextGameRecommendationJobsByUserAndRequestedAt"),
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField("listNextGameRecommendationJobsByExpiryKeyAndExpiresAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueSeasonSimulationJob: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        leagueId: a.string().required(),
        leagueName: a.string(),
        season: a.integer().required(),
        teamId: a.string().required(),
        teamName: a.string(),
        status: a.ref("LeagueSeasonSimulationJobStatus").required(),
        requestedAt: a.datetime().required(),
        startedAt: a.datetime(),
        completedAt: a.datetime(),
        requestJson: a.ref("LeagueSeasonSimulationStoredRequest").required(),
        progressJson: a.ref("LeagueSeasonSimulationProgress"),
        resultJson: a.ref("LeagueSeasonSimulationResult"),
        scenarioKey: a.string(),
        error: a.string(),
        executionArn: a.string(),
        expiryKey: a.string().required(),
        expiresAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listLeagueSeasonSimulationJobsByUserAndRequestedAt"),
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField(
            "listLeagueSeasonSimulationJobsByExpiryKeyAndExpiresAt",
          ),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueSeasonSimulationArtifact: a
      .model({
        jobId: a.string().required(),
        artifactType: a.string().required(),
        artifactKey: a.string().required(),
        artifactOrder: a.integer().required(),
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        contextPayload: a.ref("LeagueSeasonSimulationContextArtifact"),
        snapshotPayload: a.ref("LeagueSeasonSimulationTeamSnapshotArtifact"),
        scoredGamePayload: a.ref("LeagueSeasonSimulationScoredGameArtifact"),
        expiryKey: a.string().required(),
        expiresAt: a.datetime().required(),
      })
      .identifier(["jobId", "artifactType", "artifactKey"])
      .secondaryIndexes((index) => [
        index("jobId")
          .sortKeys(["artifactOrder"])
          .queryField(
            "listLeagueSeasonSimulationArtifactsByJobIdAndArtifactOrder",
          ),
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField(
            "listLeagueSeasonSimulationArtifactsByExpiryKeyAndExpiresAt",
          ),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    NextGamePlannerArtifact: a
      .model({
        artifactKey: a.string().required(),
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        jobId: a.string().required(),
        matchId: a.string().required(),
        opponentTeamId: a.string().required(),
        generatedAt: a.datetime().required(),
        evaluatedScenariosJson: a
          .ref("GamePlannerEvaluatedScenario")
          .required()
          .array()
          .required(),
        ourPairsJson: a
          .ref("GamePlannerTacticPair")
          .required()
          .array()
          .required(),
        opponentPairsJson: a
          .ref("GamePlannerTacticPair")
          .required()
          .array()
          .required(),
        expiryKey: a.string().required(),
        expiresAt: a.datetime().required(),
      })
      .identifier(["artifactKey"])
      .secondaryIndexes((index) => [
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField("listNextGamePlannerArtifactsByExpiryKeyAndExpiresAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    NextGamePlannerArtifactRow: a
      .model({
        artifactKey: a.string().required(),
        viewId: a.string().required(),
        opponentPairId: a.string().required(),
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        jobId: a.string().required(),
        rowOrder: a.integer().required(),
        rowJson: a.ref("PlannerArtifactRow").required(),
        expiryKey: a.string().required(),
        expiresAt: a.datetime().required(),
      })
      .identifier(["artifactKey", "viewId", "opponentPairId"])
      .secondaryIndexes((index) => [
        index("artifactKey")
          .sortKeys(["rowOrder"])
          .queryField(
            "listNextGamePlannerArtifactRowsByArtifactKeyAndRowOrder",
          ),
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField("listNextGamePlannerArtifactRowsByExpiryKeyAndExpiresAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    GameDayRecap: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        targetKey: a.string().required(),
        leagueId: a.string().required(),
        leagueName: a.string(),
        gameDate: a.date().required(),
        season: a.integer(),
        status: a.ref("GameDayRecapStatus").required(),
        requestedAt: a.datetime().required(),
        completedAt: a.datetime(),
        requestJson: a.ref("GameDayRecapStoredRequest").required(),
        coverageJson: a.ref("GameDayRecapCoverage"),
        costJson: a.ref("GameDayRecapCost"),
        failureJson: a.ref("GameDayRecapFailureDetails"),
        resultJson: a.ref("GameDayRecapResult"),
        error: a.string(),
        executionArn: a.string(),
        modelProvider: a.string(),
        modelId: a.string(),
        promptVersion: a.string(),
      })
      .identifier(["userId", "targetKey"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listGameDayRecapsByUserAndRequestedAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueGameDayRecap: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        targetKey: a.string().required(),
        leagueId: a.string().required(),
        leagueName: a.string(),
        gameDayNumber: a.integer().required(),
        season: a.integer(),
        status: a.ref("GameDayRecapStatus").required(),
        requestedAt: a.datetime().required(),
        completedAt: a.datetime(),
        requestJson: a.ref("LeagueGameDayRecapStoredRequest").required(),
        coverageJson: a.ref("GameDayRecapCoverage"),
        costJson: a.ref("GameDayRecapCost"),
        failureJson: a.ref("GameDayRecapFailureDetails"),
        resultJson: a.ref("GameDayRecapResult"),
        error: a.string(),
        executionArn: a.string(),
        modelProvider: a.string(),
        modelId: a.string(),
        promptVersion: a.string(),
      })
      .identifier(["userId", "targetKey"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listLeagueGameDayRecapsByUserAndRequestedAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueGameDayPerformances: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        targetKey: a.string().required(),
        leagueId: a.string().required(),
        leagueName: a.string(),
        gameDayNumber: a.integer().required(),
        gameDate: a.date(),
        season: a.integer(),
        status: a.ref("GameDayRecapStatus").required(),
        requestedAt: a.datetime().required(),
        completedAt: a.datetime(),
        requestJson: a.ref("LeagueGameDayPerformancesStoredRequest").required(),
        coverageJson: a.ref("GameDayRecapCoverage"),
        resultJson: a.ref("LeagueGameDayPerformancesResult"),
        error: a.string(),
        executionArn: a.string(),
        modelProvider: a.string(),
        modelId: a.string(),
        promptVersion: a.string(),
      })
      .identifier(["userId", "targetKey"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listLeagueGameDayPerformancesByUserAndRequestedAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    SingleGameSummary: a
      .model({
        userId: a
          .string()
          .required()
          .authorization((allow) => [
            allow.ownerDefinedIn("userId").to(["read"]),
          ]),
        targetKey: a.string().required(),
        matchId: a.string().required(),
        gameDate: a.date(),
        leagueId: a.string(),
        leagueName: a.string(),
        season: a.integer(),
        status: a.ref("GameDayRecapStatus").required(),
        requestedAt: a.datetime().required(),
        completedAt: a.datetime(),
        requestJson: a.ref("SingleGameSummaryStoredRequest").required(),
        coverageJson: a.ref("GameDayRecapCoverage"),
        costJson: a.ref("GameDayRecapCost"),
        failureJson: a.ref("GameDayRecapFailureDetails"),
        resultJson: a.ref("GameDayRecapResult"),
        error: a.string(),
        executionArn: a.string(),
        modelProvider: a.string(),
        modelId: a.string(),
        promptVersion: a.string(),
      })
      .identifier(["userId", "targetKey"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listSingleGameSummariesByUserAndRequestedAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    connectBbAccount: a
      .mutation()
      .arguments({
        bbLoginName: a.string().required(),
        accessKey: a.string().required(),
      })
      .returns(a.ref("ConnectionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(connectBbAccount)),

    disconnectBbAccount: a
      .mutation()
      .returns(a.ref("ConnectionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(disconnectBbAccount)),

    refreshWorkspace: a
      .mutation()
      .returns(a.ref("HomeWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(refreshWorkspace)),

    getHomeWorkspace: a
      .query()
      .arguments({
        force: a.boolean(),
      })
      .returns(a.ref("HomeWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getHomeWorkspace)),

    getScoutTeamSummary: a
      .query()
      .arguments({
        force: a.boolean(),
        teamId: a.string(),
      })
      .returns(a.ref("ScoutWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getScoutTeamSummary)),

    getScoutSchedule: a
      .query()
      .arguments({
        competitionKeys: a.string().array(),
        force: a.boolean(),
        season: a.integer(),
        teamId: a.string(),
      })
      .returns(a.ref("ScoutSchedule"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getScoutSchedule)),

    getLatestOpponentForecast: a
      .query()
      .arguments({
        teamId: a.string().required(),
      })
      .returns(a.ref("OpponentForecastSnapshot"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLatestOpponentForecast)),

    getLatestNextGameRecommendation: a
      .query()
      .arguments({
        forecastJobId: a.string().required(),
        input: a.ref("NextGameRecommendationInput").required(),
        matchId: a.string().required(),
        opponentTeamId: a.string().required(),
      })
      .returns(a.ref("NextGameRecommendationSnapshot"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLatestNextGameRecommendation)),

    getLatestLeagueSeasonSimulation: a
      .query()
      .arguments({
        jobId: a.string(),
        leagueId: a.string(),
      })
      .returns(a.ref("LeagueSeasonSimulationSnapshot"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLatestLeagueSeasonSimulation)),

    getNextGamePlannerDetail: a
      .query()
      .arguments({
        artifactKey: a.string().required(),
      })
      .returns(a.ref("NextGamePlannerDetail"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getNextGamePlannerDetail)),

    getLeagueIntel: a
      .query()
      .arguments({
        force: a.boolean(),
        leagueId: a.string(),
      })
      .returns(a.ref("LeagueIntelWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLeagueIntel)),

    getLeagueHistory: a
      .query()
      .arguments({
        leagueId: a.string(),
      })
      .returns(a.ref("LeagueHistory"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLeagueHistory)),

    getLeagueHistoryAudit: a
      .query()
      .arguments({
        includeLiveComparison: a.boolean(),
        leagueId: a.string(),
      })
      .returns(a.ref("LeagueHistoryAudit"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLeagueHistoryAudit)),

    getPlayerLab: a
      .query()
      .arguments({
        force: a.boolean(),
      })
      .returns(a.ref("PlayerLabWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getPlayerLab)),

    getArenaWorkspace: a
      .query()
      .arguments({
        force: a.boolean(),
      })
      .returns(a.ref("ArenaWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getArenaWorkspace)),

    getRivalsWorkspace: a
      .query()
      .arguments({
        competitionKeys: a.string().array(),
        endSeason: a.integer(),
        outcomes: a.string().array(),
        selectedOpponentId: a.string(),
        startSeason: a.integer(),
        tvScopes: a.string().array(),
        venues: a.string().array(),
      })
      .returns(a.ref("RivalsWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getRivalsWorkspace)),

    submitRivalsBackfill: a
      .mutation()
      .returns(a.ref("RivalsBackfillSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitRivalsBackfill)),

    getLineupHelperWorkspace: a
      .query()
      .arguments({
        force: a.boolean(),
      })
      .returns(a.ref("LineupHelperWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLineupHelperWorkspace)),

    repairOwnerRosterData: a
      .mutation()
      .returns(a.ref("OwnerRosterRepairResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(repairOwnerRosterData)),

    evaluateLineupHelper: a
      .query()
      .arguments({
        roster: a.ref("LineupHelperRosterPlayer").required().array().required(),
        assignments: a
          .ref("LineupHelperAssignment")
          .required()
          .array()
          .required(),
        context: a.ref("LineupHelperContext").required(),
      })
      .returns(a.ref("LineupHelperEvaluation"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(evaluateLineupHelper)),

    optimizeLineupHelper: a
      .query()
      .arguments({
        roster: a.ref("LineupHelperRosterPlayer").required().array().required(),
        context: a.ref("LineupHelperContext").required(),
        algorithm: a.ref("LineupHelperAlgorithm"),
      })
      .returns(a.ref("LineupHelperEvaluation"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(optimizeLineupHelper)),

    getPlayerTrend: a
      .query()
      .arguments({
        playerId: a.string().required(),
      })
      .returns(a.ref("PlayerTrend"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getPlayerTrend)),

    getMyTeamHighlights: a
      .query()
      .arguments({
        cursor: a.string(),
        onlyOutcomeChange: a.boolean(),
        perspective: a.ref("TeamHighlightsPerspective"),
      })
      .returns(a.ref("TeamHighlights"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getMyTeamHighlights)),

    clearMyTeamHighlightsData: a
      .mutation()
      .returns(a.ref("TeamHighlightsClearResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(clearMyTeamHighlightsData)),

    getBillingSummary: a
      .query()
      .returns(a.ref("BillingSummary"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getBillingSummary)),

    createBillingCheckoutSession: a
      .mutation()
      .arguments({
        returnPath: a.string(),
      })
      .returns(a.ref("BillingSessionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(createBillingCheckoutSession)),

    createBillingLifetimeCheckoutSession: a
      .mutation()
      .arguments({
        returnPath: a.string(),
      })
      .returns(a.ref("BillingSessionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(createBillingLifetimeCheckoutSession)),

    createBillingPortalSession: a
      .mutation()
      .arguments({
        returnPath: a.string(),
      })
      .returns(a.ref("BillingSessionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(createBillingPortalSession)),

    // Keep this owner-scoped history query distinct from the BillingPayment
    // model's generated listBillingPayments operation.
    // AP: not sure why AI made/did this exactly, it's probably unnecessary, but seems ok for now
    listMyBillingPayments: a
      .query()
      .arguments({
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref("BillingPaymentsPage"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(listMyBillingPayments)),

    getSalaryProjection: a
      .query()
      .arguments({
        playerId: a.string().required(),
      })
      .returns(a.ref("SalaryProjection"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getSalaryProjection)),

    getSalaryCalculatorSeed: a
      .query()
      .arguments({
        playerId: a.string().required(),
      })
      .returns(a.ref("SalaryCalculatorSeed"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getSalaryCalculatorSeed)),

    getManualSalaryEstimate: a
      .query()
      .arguments({
        input: a.ref("ManualSalaryEstimateInput").required(),
      })
      .returns(a.ref("ManualSalaryEstimate"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getManualSalaryEstimate)),

    getMatchBoxscoreDetails: a
      .query()
      .arguments({
        matchId: a.string().required(),
        preferLive: a.boolean(),
      })
      .returns(a.ref("MatchBoxscoreDetails"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getMatchBoxscoreDetails)),

    evaluatePredictionMatrix: a
      .query()
      .arguments({
        request: a.ref("PredictionMatrixRequestInput").required(),
      })
      .returns(a.ref("PredictionMatrixResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(evaluatePredictionMatrix)),

    listAccessibleMatches: a
      .query()
      .arguments({
        teamId: a.string(),
        season: a.integer(),
        cursor: a.string(),
      })
      .returns(a.ref("AccessibleMatchPage"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(listAccessibleMatches)),

    getAccessibleMatch: a
      .query()
      .arguments({
        matchId: a.string().required(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getAccessibleMatch)),

    getAccessiblePlayByPlay: a
      .query()
      .arguments({
        matchId: a.string().required(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getAccessiblePlayByPlay)),

    generateSharedPlayerCard: a
      .mutation()
      .arguments({
        playerId: a.string().required(),
        title: a.string(),
        note: a.string(),
      })
      .returns(a.ref("SharedPlayerCardResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(generateSharedPlayerCard)),

    revokeSharedPlayerCard: a
      .mutation()
      .arguments({
        shareToken: a.string().required(),
      })
      .returns(a.ref("SharedPlayerCardResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(revokeSharedPlayerCard)),

    lookupSharedPlayerCard: a
      .query()
      .arguments({
        shareToken: a.string().required(),
      })
      .returns(a.ref("SharedPlayerCardResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(lookupSharedPlayerCard)),

    submitPredictionJob: a
      .mutation()
      .arguments({
        request: a.ref("PredictionSubmissionRequestInput").required(),
      })
      .returns(a.ref("PredictionJobSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(predictionSubmit)),

    submitOpponentForecastJob: a
      .mutation()
      .arguments({
        teamId: a.string().required(),
      })
      .returns(a.ref("OpponentForecastSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(opponentForecastSubmit)),

    submitNextGameRecommendationJob: a
      .mutation()
      .arguments({
        input: a.ref("NextGameRecommendationInput").required(),
      })
      .returns(a.ref("NextGameRecommendationSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(nextGameRecommendationSubmit)),

    submitLeagueSeasonSimulationJob: a
      .mutation()
      .arguments({
        leagueId: a.string(),
        snapshotModifiers: a
          .ref("LeagueSeasonSimulationTeamModifier")
          .array(),
      })
      .returns(a.ref("LeagueSeasonSimulationSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(leagueSeasonSimulationSubmit)),

    submitGameDayRecap: a
      .mutation()
      .arguments({
        approach: a.ref("RecapGenerationApproach"),
        leagueId: a.string().required(),
        gameDate: a.date().required(),
        interviewIntensity: a.ref("RecapInterviewIntensity"),
        modelJudgeEnabled: a.boolean(),
        qualityTier: a.ref("RecapQualityTier"),
      })
      .returns(a.ref("GameDayRecapSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(gameDayRecapSubmit)),

    submitLeagueGameDayRecap: a
      .mutation()
      .arguments({
        approach: a.ref("RecapGenerationApproach"),
        leagueId: a.string().required(),
        gameDayNumber: a.integer().required(),
        interviewIntensity: a.ref("RecapInterviewIntensity"),
        modelJudgeEnabled: a.boolean(),
        qualityTier: a.ref("RecapQualityTier"),
        season: a.integer(),
      })
      .returns(a.ref("GameDayRecapSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitLeagueGameDayRecap)),

    submitLeagueGameDayPerformances: a
      .mutation()
      .arguments({
        leagueId: a.string().required(),
        gameDayNumber: a.integer().required(),
        season: a.integer(),
      })
      .returns(a.ref("GameDayRecapSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitLeagueGameDayPerformances)),

    submitSingleGameSummary: a
      .mutation()
      .arguments({
        approach: a.ref("RecapGenerationApproach"),
        interviewIntensity: a.ref("RecapInterviewIntensity"),
        loserInterviewPersonalityType: a.string(),
        matchId: a.string().required(),
        modelJudgeEnabled: a.boolean(),
        qualityTier: a.ref("RecapQualityTier"),
        winnerInterviewPersonalityType: a.string(),
      })
      .returns(a.ref("GameDayRecapSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitSingleGameSummary)),

    setBbLeagueTimeZone: a
      .mutation()
      .arguments({
        leagueTimeZone: a.string().required(),
      })
      .returns(a.ref("ConnectionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(setBbLeagueTimeZone)),

    setTrackedPlayerInterviewPersonality: a
      .mutation()
      .arguments({
        playerId: a.string().required(),
        personalityType: a.string(),
      })
      .returns(a.ref("TrackedPlayerInterviewPersonalitySelection"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(setTrackedPlayerInterviewPersonality)),

    submitProductFeedback: a
      .mutation()
      .arguments({
        kind: a.ref("FeedbackSubmissionKind").required(),
        subject: a.string().required(),
        message: a.string().required(),
      })
      .returns(a.ref("ProductFeedbackSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitProductFeedback)),

    submitMyTeamHighlightsScan: a
      .mutation()
      .returns(a.ref("TeamHighlightsScanSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitMyTeamHighlightsScan)),

    submitLeagueHistoryBackfill: a
      .mutation()
      .arguments({
        leagueId: a.string(),
        refreshMode: a.ref("LeagueHistoryBackfillRefreshMode"),
      })
      .returns(a.ref("LeagueHistoryBackfillSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitLeagueHistoryBackfill)),
  })
  .authorization((allow) =>
    dataFunctions.map((resource) =>
      allow.resource(resource).to(["query", "mutate"]),
    ),
  );

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
