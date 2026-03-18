import {
  a,
  defineData,
  defineFunction,
  secret,
  type ClientSchema,
} from "@aws-amplify/backend";

import { PositionCode, TeamHighlightsPerspective } from "./schema-enums";
import { getAccessibleMatch } from "../get-accessible-match/resource";
import { getAccessiblePlayByPlay } from "../get-accessible-play-by-play/resource";
import { getMatchBoxscoreDetails } from "../get-match-boxscore-details/resource";
import { billingAdminOverride } from "../billing-admin-override/resource";
import { billingWebhook } from "../billing-webhook/resource";
import { gameDayRecapSubmit } from "../game-day-recap-submit/resource";
import { gameDayRecapWorker } from "../game-day-recap-worker/resource";
import { listAccessibleMatches } from "../list-accessible-matches/resource";
import { predictionSubmit } from "../prediction-submit/resource";
import { predictionWorker } from "../prediction-worker/resource";

const secureFunctionEnvironment = {
  BB_CONNECTION_ENCRYPTION_SECRET: secret("BB_CONNECTION_ENCRYPTION_SECRET"),
};

const stripeSecretFunctionEnvironment = {
  STRIPE_SECRET_KEY: secret("STRIPE_SECRET_KEY"),
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

export const getLeagueIntel = defineFunction({
  resourceGroupName: "data",
  name: "get-league-intel",
  entry: "./get-league-intel/handler.ts",
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
});

export const getMyTeamHighlights = defineFunction({
  resourceGroupName: "data",
  name: "get-my-team-highlights",
  entry: "./get-my-team-highlights/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const getBillingSummary = defineFunction({
  resourceGroupName: "data",
  name: "get-billing-summary",
  entry: "./get-billing-summary/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});

export const createBillingCheckoutSession = defineFunction({
  resourceGroupName: "data",
  name: "create-billing-checkout-session",
  entry: "./create-billing-checkout-session/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: stripeSecretFunctionEnvironment,
});

export const createBillingPortalSession = defineFunction({
  resourceGroupName: "data",
  name: "create-billing-portal-session",
  entry: "./create-billing-portal-session/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: stripeSecretFunctionEnvironment,
});

const getLineupPlan = defineFunction({
  resourceGroupName: "data",
  name: "get-lineup-plan",
  entry: "./get-lineup-plan/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const saveLineupScenario = defineFunction({
  resourceGroupName: "data",
  name: "save-lineup-scenario",
  entry: "./save-lineup-scenario/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
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

const revokeSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "revoke-shared-player-card",
  entry: "./revoke-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const lookupSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "lookup-shared-player-card",
  entry: "./lookup-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const refreshBbWorkspaces = defineFunction({
  resourceGroupName: "data",
  name: "refresh-bb-workspaces",
  entry: "./refresh-bb-workspaces/handler.ts",
  timeoutSeconds: 300,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const refreshBbWorkspaceWorker = defineFunction({
  resourceGroupName: "data",
  name: "refresh-bb-workspace-worker",
  entry: "./refresh-bb-workspace-worker/handler.ts",
  timeoutSeconds: 120,
  memoryMB: 1024,
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

const dataFunctions = [
  connectBbAccount,
  disconnectBbAccount,
  refreshWorkspace,
  getHomeWorkspace,
  getTeamHub,
  getScoutWorkspace,
  getLeagueIntel,
  getPlayerLab,
  getLineupHelperWorkspace,
  evaluateLineupHelper,
  getPlayerTrend,
  submitMyTeamHighlightsScan,
  getMyTeamHighlights,
  getBillingSummary,
  createBillingCheckoutSession,
  createBillingPortalSession,
  getLineupPlan,
  saveLineupScenario,
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
  refreshBbWorkspaces,
  refreshBbWorkspaceWorker,
  pruneOperationalData,
  gameDayRecapSubmit,
  gameDayRecapWorker,
  predictionSubmit,
  predictionWorker,
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

    GameDayRecapStatus: a.enum([
      "QUEUED",
      "RESOLVING_SLATE",
      "BUILDING_CONTEXT",
      "INVOKING_MODEL",
      "SUCCEEDED",
      "FAILED",
    ]),

    PredictionRequestMode: a.enum(["MANUAL", "CONNECTED"]),

    MatchIngestStatus: a.enum(["PENDING", "PARTIAL", "SUCCEEDED", "FAILED"]),

    ThemeId: a.enum(["clubhouse", "arena", "nightfall"]),

    PositionCode: a.enum(Object.values(PositionCode)),

    TeamHighlightsPerspective: a.enum(Object.values(TeamHighlightsPerspective)),

    BillingSummary: a.customType({
      planId: a.string().required(),
      accessSource: a.string().required(),
      subscriptionStatus: a.string(),
      currentPeriodEndAt: a.datetime(),
      cancelAtPeriodEnd: a.boolean().required(),
      hasBillingCustomer: a.boolean().required(),
    }),

    BillingSessionResult: a.customType({
      url: a.string().required(),
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
      numberValue: a.float(),
      textValue: a.string(),
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
    }),

    GameDayRecapSubmitResult: a.customType({
      targetKey: a.string().required(),
    }),

    JsonLookupResponse: a.customType({
      status: a.string().required(),
      payload: a.json(),
      error: a.string(),
    }),

    TeamHighlightsScanSubmitResult: a.customType({
      queued: a.boolean().required(),
      requestedAt: a.datetime().required(),
      status: a.string().required(),
      teamId: a.string().required(),
      teamName: a.string(),
    }),

    LineupPlanPlayer: a.customType({
      playerId: a.string().required(),
      fullName: a.string().required(),
      bestPosition: a.string(),
      projectedStarterCount: a.integer(),
      salary: a.integer(),
      gameShape: a.string(),
      score: a.float(),
      slot: a.integer(),
      benchSlot: a.integer(),
    }),

    MinuteTargetEntry: a.customType({
      playerId: a.string().required(),
      minutes: a.integer().required(),
    }),

    LineupPlan: a.customType({
      generatedAt: a.datetime().required(),
      recommendedStarters: a
        .ref("LineupPlanPlayer")
        .required()
        .array()
        .required(),
      benchOrder: a.ref("LineupPlanPlayer").required().array().required(),
      minuteTargets: a.ref("MinuteTargetEntry").required().array().required(),
      rotationNotes: a.string().required().array().required(),
      matchupRationale: a.string().required().array().required(),
      injuryAlerts: a.ref("InjurySummary").required().array().required(),
      confidence: a.float().required(),
    }),

    LineupScenario: a.customType({
      scenarioId: a.string().required(),
      name: a.string().required(),
      savedAt: a.datetime().required(),
      starters: a.ref("LineupPlanPlayer").required().array().required(),
      minuteTargets: a.ref("MinuteTargetEntry").required().array().required(),
      note: a.string(),
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

    MatchBoxscoreDetails: a.customType({
      matchId: a.string().required(),
      opponentTeamName: a.string(),
      offStrategy: a.string(),
      defStrategy: a.string(),
      opponentOffStrategy: a.string(),
      opponentDefStrategy: a.string(),
      teamRatings: a.ref("MatchMetricEntry").required().array().required(),
      opponentRatings: a.ref("MatchMetricEntry").required().array().required(),
      teamEfficiency: a.ref("MatchMetricEntry").required().array().required(),
      opponentEfficiency: a
        .ref("MatchMetricEntry")
        .required()
        .array()
        .required(),
      context: a.ref("MatchContext"),
      source: a.string().required(),
    }),

    TeamHighlightsFilters: a.customType({
      onlyOutcomeChange: a.boolean().required(),
      perspective: a.ref("TeamHighlightsPerspective").required(),
    }),

    TeamHighlightsScanStatus: a.customType({
      completedAt: a.datetime(),
      error: a.string(),
      matchesDiscovered: a.integer(),
      matchesEnqueuedForIngest: a.integer(),
      matchesEnqueuedForMaterialize: a.integer(),
      matchesReused: a.integer(),
      requestedAt: a.datetime().required(),
      seasonsFrom: a.integer(),
      seasonsTo: a.integer(),
      startedAt: a.datetime(),
      status: a.string().required(),
      teamId: a.string().required(),
      teamName: a.string(),
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
      home_offStrategy: a.string().required(),
      home_defStrategy: a.string().required(),
      away_offStrategy: a.string().required(),
      away_defStrategy: a.string().required(),
      neutral: a.string().required(),
      effortDelta: a.float().required(),
    }),

    PredictionConnectedInput: a.customType({
      homeSourceMatchId: a.string(),
      awaySourceMatchId: a.string(),
      homeTeamId: a.string(),
      awayTeamId: a.string(),
      home_offStrategy: a.string(),
      home_defStrategy: a.string(),
      away_offStrategy: a.string(),
      away_defStrategy: a.string(),
      neutral: a.string(),
      effortDelta: a.float(),
      manualFallback: a.ref("PredictionManualInput"),
    }),

    PredictionSubmissionRequestInput: a.customType({
      mode: a.ref("PredictionRequestMode").required(),
      manualInput: a.ref("PredictionManualInput"),
      connectedInput: a.ref("PredictionConnectedInput"),
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
        userId: a.string().required(),
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
      })
      .identifier(["userId"])
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
        userId: a.string().required(),
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
        refreshSortAt: a.datetime(),
        lastSyncError: a.string(),
        profileJson: a.json(),
        workspaceCacheJson: a.json(),
      })
      .identifier(["userId"])
      .secondaryIndexes((index) => [
        index("status")
          .sortKeys(["refreshSortAt"])
          .queryField("listBbConnectionsByStatusAndRefreshSortAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    BbCredential: a
      .model({
        userId: a.string().required(),
        cipherText: a.string().required(),
        iv: a.string().required(),
        authTag: a.string().required(),
        algorithm: a.string().required(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedTeam: a
      .model({
        userId: a.string().required(),
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
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedPlayer: a
      .model({
        userId: a.string().required(),
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
        userId: a.string().required(),
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
        userId: a.string().required(),
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
        userId: a.string().required(),
        matchId: a.string().required(),
        teamId: a.string().required(),
        opponentTeamId: a.string(),
        opponentTeamName: a.string(),
        offStrategy: a.string(),
        defStrategy: a.string(),
        opponentOffStrategy: a.string(),
        opponentDefStrategy: a.string(),
        teamRatingsJson: a.json(),
        opponentRatingsJson: a.json(),
        teamEfficiencyJson: a.json(),
        opponentEfficiencyJson: a.json(),
        boxscoreJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "matchId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueStanding: a
      .model({
        userId: a.string().required(),
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

    SyncRun: a
      .model({
        userId: a.string().required(),
        kind: a.string().required(),
        status: a.ref("SyncStatus").required(),
        startedAt: a.datetime().required(),
        completedAt: a.datetime(),
        error: a.string(),
        detailsJson: a.json(),
        expiryKey: a.string(),
        expiresAt: a.datetime(),
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
        userId: a.string().required(),
        playerId: a.string().required(),
        title: a.string(),
        note: a.string(),
        expiresAt: a.datetime(),
        revokedAt: a.datetime(),
        payloadJson: a.json(),
      })
      .identifier(["shareToken"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    SavedLineupScenario: a
      .model({
        scenarioId: a.string().required(),
        userId: a.string().required(),
        name: a.string().required(),
        startersJson: a.json().required(),
        minuteTargetsJson: a.json().required(),
        note: a.string(),
        savedAt: a.datetime().required(),
      })
      .identifier(["scenarioId"])
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["savedAt"])
          .queryField("listSavedLineupScenariosByUserAndSavedAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    PredictionJob: a
      .model({
        userId: a.string().required(),
        status: a.ref("PredictionJobStatus").required(),
        mode: a.ref("PredictionRequestMode").required(),
        requestedAt: a.datetime(),
        request: a.json().required(),
        resolvedInputSnapshot: a.json(),
        result: a.json(),
        error: a.string(),
        modelVersion: a.string(),
        expiryKey: a.string(),
        expiresAt: a.datetime(),
      })
      .secondaryIndexes((index) => [
        index("userId")
          .sortKeys(["requestedAt"])
          .queryField("listPredictionJobsByUserAndRequestedAt"),
        index("expiryKey")
          .sortKeys(["expiresAt"])
          .queryField("listPredictionJobsByExpiryKeyAndExpiresAt"),
      ])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    GameDayRecap: a
      .model({
        userId: a.string().required(),
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
        userId: a.string().required(),
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
        userId: a.string().required(),
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

    getLeagueIntel: a
      .query()
      .returns(a.ref("LeagueIntelWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLeagueIntel)),

    getPlayerLab: a
      .query()
      .returns(a.ref("PlayerLabWorkspace"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getPlayerLab)),

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

    getBillingSummary: a
      .query()
      .returns(a.ref("BillingSummary"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getBillingSummary)),

    createBillingCheckoutSession: a
      .mutation()
      .returns(a.ref("BillingSessionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(createBillingCheckoutSession)),

    createBillingPortalSession: a
      .mutation()
      .returns(a.ref("BillingSessionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(createBillingPortalSession)),

    getLineupPlan: a
      .query()
      .returns(a.ref("LineupPlan"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLineupPlan)),

    saveLineupScenario: a
      .mutation()
      .arguments({
        name: a.string().required(),
        starters: a.ref("LineupPlanPlayer").required().array().required(),
        minuteTargets: a.ref("MinuteTargetEntry").required().array().required(),
        note: a.string(),
      })
      .returns(a.ref("LineupScenario"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(saveLineupScenario)),

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
