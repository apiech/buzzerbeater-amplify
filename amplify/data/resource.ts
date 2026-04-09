import {
  a,
  defineData,
  defineFunction,
  secret,
  type ClientSchema,
} from "@aws-amplify/backend";

import { PositionCode, TeamHighlightsPerspective } from "./schema-enums";
import { buildBbConnectionSecretFunctionEnvironment } from "../_shared/bb-connection-secret";
import { getAccessibleMatch } from "../get-accessible-match/resource";
import { getAccessiblePlayByPlay } from "../get-accessible-play-by-play/resource";
import { getMatchBoxscoreDetails } from "../get-match-boxscore-details/resource";
import { billingAdminOverride } from "../billing-admin-override/resource";
import { billingWebhook } from "../billing-webhook/resource";
import { gameDayRecapSubmit } from "../game-day-recap-submit/resource";
import { gameDayRecapWorker } from "../game-day-recap-worker/resource";
import { listAccessibleMatches } from "../list-accessible-matches/resource";
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

export const getTeamHub = defineFunction({
  resourceGroupName: "data",
  name: "get-team-hub",
  entry: "./get-team-hub/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getScoutWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-scout-workspace",
  entry: "./get-scout-workspace/handler.ts",
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

export const getPlayerLab = defineFunction({
  resourceGroupName: "data",
  name: "get-player-lab",
  entry: "./get-player-lab/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getRivalsWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-rivals-workspace",
  entry: "./get-rivals-workspace/handler.ts",
  timeoutSeconds: 120,
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

export const evaluateLineupHelper = defineFunction({
  resourceGroupName: "data",
  name: "evaluate-lineup-helper",
  entry: "./evaluate-lineup-helper/handler.ts",
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
  getTeamHub,
  getScoutWorkspace,
  getLatestOpponentForecast,
  getLeagueIntel,
  getLeagueHistory,
  getPlayerLab,
  getRivalsWorkspace,
  getLineupHelperWorkspace,
  evaluateLineupHelper,
  getPlayerTrend,
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
  submitSingleGameSummary,
  setBbLeagueTimeZone,
  listAccessibleMatches,
  getAccessibleMatch,
  getAccessiblePlayByPlay,
  getMatchBoxscoreDetails,
  generateSharedPlayerCard,
  revokeSharedPlayerCard,
  lookupSharedPlayerCard,
  leagueHistoryWorker,
  gameDayRecapSubmit,
  gameDayRecapWorker,
  opponentForecastSubmit,
  opponentForecastWorker,
  predictionSubmit,
  predictionWorker,
] as const;

const dataFunctions = [
  ...maintenanceProtectedFunctions,
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

    PositionCode: a.enum(Object.values(PositionCode)),

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

    LeagueIntelWorkspace: a.customType({
      league: a.ref("NamedReference"),
      standings: a
        .ref("LeagueConferenceStanding")
        .required()
        .array()
        .required(),
    }),

    LeagueHistoryRow: a.customType({
      teamId: a.string().required(),
      teamName: a.string().required(),
      seasons: a.integer().required(),
      games: a.integer().required(),
      wins: a.integer().required(),
      losses: a.integer().required(),
      winPct: a.float().required(),
      pf: a.integer().required(),
      pa: a.integer().required(),
      pointMargin: a.integer().required(),
      averageMargin: a.float().required(),
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

    LeagueHistory: a.customType({
      league: a.ref("NamedReference").required(),
      requestedLeagueId: a.string(),
      summary: a.ref("LeagueHistorySummary").required(),
      rows: a.ref("LeagueHistoryRow").required().array().required(),
      status: a.ref("LeagueHistoryBackfillStatus"),
      warning: a.string(),
    }),

    HomeWorkspace: a.customType({
      syncedAt: a.datetime(),
      connection: a.ref("ConnectionResult").required(),
      team: a.ref("HomeWorkspaceTeam").required(),
      nextMatch: a.ref("HomeNextMatch"),
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
      summary: a.ref("ScoutWorkspaceSummary"),
      requestedTeamId: a.string(),
      message: a.string(),
    }),

    PlayerLabWorkspace: a.customType({
      syncedAt: a.datetime(),
      players: a.ref("PlayerSummary").required().array().required(),
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

    RivalsWorkspace: a.customType({
      generatedAt: a.datetime().required(),
      matches: a.ref("RivalryMatch").required().array().required(),
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

    OpponentForecastCoverage: a.customType({
      recentGamesConsidered: a.integer().required(),
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

    GameDayRecapSubmitResult: a.customType({
      targetKey: a.string().required(),
      executionArn: a.string(),
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

    LineupHelperContext: a.customType({
      offense: a.string().required(),
      defense: a.string().required(),
      enthusiasm: a.integer().required(),
      homeCourt: a.string().required(),
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

    MatchBoxscoreDetails: a.customType({
      matchId: a.string().required(),
      matchType: a.string(),
      startTime: a.datetime(),
      endTime: a.datetime(),
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
        userId: a.string().required().authorization((allow) => [
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
        userId: a.string().required().authorization((allow) => [
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

    BbConnection: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        profileJson: a.json(),
        workspaceCacheJson: a.json(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    BbCredential: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        userId: a.string().required().authorization((allow) => [
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
        summaryJson: a.json(),
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
        userId: a.string().required().authorization((allow) => [
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
        profileJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "playerId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    PlayerSkillObservation: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        userId: a.string().required().authorization((allow) => [
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
        matchJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "matchId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    MatchBoxscore: a
      .model({
        userId: a.string().required().authorization((allow) => [
          allow.ownerDefinedIn("userId").to(["read"]),
        ]),
        matchId: a.string().required(),
        boxscoreJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "matchId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueStanding: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        standingJson: a.json(),
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

    SyncRun: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        userId: a.string().required().authorization((allow) => [
          allow.ownerDefinedIn("userId").to(["read"]),
        ]),
        playerId: a.string().required(),
        title: a.string(),
        note: a.string(),
        expiresAt: a.datetime(),
        revokedAt: a.datetime(),
        payloadJson: a.json(),
      })
      .identifier(["shareToken"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    PredictionJob: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        userId: a.string().required().authorization((allow) => [
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
        userId: a.string().required().authorization((allow) => [
          allow.ownerDefinedIn("userId").to(["read"]),
        ]),
        teamId: a.string().required(),
        teamName: a.string(),
        status: a.ref("OpponentForecastJobStatus").required(),
        requestedAt: a.datetime().required(),
        startedAt: a.datetime(),
        completedAt: a.datetime(),
        requestJson: a.json().required(),
        resolvedContextJson: a.json(),
        resultJson: a.json(),
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

    GameDayRecap: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        requestJson: a.json().required(),
        coverageJson: a.json(),
        resultJson: a.json(),
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
        userId: a.string().required().authorization((allow) => [
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
        requestJson: a.json().required(),
        coverageJson: a.json(),
        resultJson: a.json(),
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

    SingleGameSummary: a
      .model({
        userId: a.string().required().authorization((allow) => [
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
        requestJson: a.json().required(),
        coverageJson: a.json(),
        resultJson: a.json(),
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
      .returns(a.ref("HomeWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getHomeWorkspace)),

    getTeamHub: a
      .query()
      .returns(a.ref("TeamHubWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getTeamHub)),

    getScoutWorkspace: a
      .query()
      .arguments({
        teamId: a.string(),
      })
      .returns(a.ref("ScoutWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getScoutWorkspace)),

    getLatestOpponentForecast: a
      .query()
      .arguments({
        teamId: a.string().required(),
      })
      .returns(a.ref("OpponentForecastSnapshot"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLatestOpponentForecast)),

    getLeagueIntel: a
      .query()
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

    getPlayerLab: a
      .query()
      .returns(a.ref("PlayerLabWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getPlayerLab)),

    getRivalsWorkspace: a
      .query()
      .returns(a.ref("RivalsWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getRivalsWorkspace)),

    getLineupHelperWorkspace: a
      .query()
      .returns(a.ref("LineupHelperWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLineupHelperWorkspace)),

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

    getMatchBoxscoreDetails: a
      .query()
      .arguments({
        matchId: a.string().required(),
      })
      .returns(a.ref("MatchBoxscoreDetails"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getMatchBoxscoreDetails)),

    listAccessibleMatches: a
      .query()
      .arguments({
        teamId: a.string(),
        season: a.integer(),
        cursor: a.string(),
      })
      .returns(a.ref("JsonLookupResponse"))
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

    submitGameDayRecap: a
      .mutation()
      .arguments({
        leagueId: a.string().required(),
        gameDate: a.date().required(),
      })
      .returns(a.ref("GameDayRecapSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(gameDayRecapSubmit)),

    submitLeagueGameDayRecap: a
      .mutation()
      .arguments({
        leagueId: a.string().required(),
        gameDayNumber: a.integer().required(),
        season: a.integer(),
      })
      .returns(a.ref("GameDayRecapSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitLeagueGameDayRecap)),

    submitSingleGameSummary: a
      .mutation()
      .arguments({
        matchId: a.string().required(),
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

    submitMyTeamHighlightsScan: a
      .mutation()
      .returns(a.ref("TeamHighlightsScanSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitMyTeamHighlightsScan)),

    submitLeagueHistoryBackfill: a
      .mutation()
      .arguments({
        leagueId: a.string(),
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
