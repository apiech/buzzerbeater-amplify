import { defineBackend } from "@aws-amplify/backend";

import { configureAuthControls } from "./_backend/auth-controls.js";
import { configureBillingIntegration } from "./_backend/billing-integration.js";
import { configureCostVisibility } from "./_backend/cost-visibility.js";
import { configureGameDayRecapJobs } from "./_backend/game-day-recap-jobs.js";
import { configureLeagueHistoryJobs } from "./_backend/league-history-jobs.js";
import { configureMatchStoreIntegration } from "./_backend/match-store-integration.js";
import { configureOpponentForecastJobs } from "./_backend/opponent-forecast-jobs.js";
import { configureOperationalRetention } from "./_backend/operational-retention.js";
import { configurePredictionJobs } from "./_backend/prediction-jobs.js";
import { configureRefreshJobs } from "./_backend/refresh-jobs.js";
import {
  resolveAppResourceRemovalPolicy,
  resolveBillingConfig,
  resolveCostVisibilityConfig,
  resolveGameDayRecapConfig,
  resolveOperationalRetentionConfig,
  resolveRefreshJobsConfig,
  resolveSharedInfraBindings,
} from "./_shared/synth-env.js";
import { auth } from "./auth/resource.js";
import { billingAdminOverride } from "./billing-admin-override/resource.js";
import { billingWebhook } from "./billing-webhook/resource.js";
import {
  createBillingCheckoutSession,
  createBillingLifetimeCheckoutSession,
  createBillingPortalSession,
  connectBbAccount,
  data,
  disconnectBbAccount,
  evaluateLineupHelper,
  generateSharedPlayerCard,
  getBillingSummary,
  getHomeWorkspace,
  getLeagueIntel,
  getLeagueHistory,
  getLatestOpponentForecast,
  getLineupHelperWorkspace,
  getMyTeamHighlights,
  getPlayerLab,
  getPlayerTrend,
  getSalaryProjection,
  getScoutWorkspace,
  getTeamHub,
  leagueHistoryWorker,
  listMyBillingPayments,
  pruneOperationalData,
  refreshBbWorkspaces,
  refreshBbWorkspaceWorker,
  refreshWorkspace,
  setBbLeagueTimeZone,
  submitLeagueHistoryBackfill,
  submitLeagueGameDayRecap,
  submitMyTeamHighlightsScan,
  submitSingleGameSummary,
} from "./data/resource.js";
import { getAccessibleMatch } from "./get-accessible-match/resource.js";
import { getAccessiblePlayByPlay } from "./get-accessible-play-by-play/resource.js";
import { gameDayRecapSubmit } from "./game-day-recap-submit/resource.js";
import { gameDayRecapWorker } from "./game-day-recap-worker/resource.js";
import { getMatchBoxscoreDetails } from "./get-match-boxscore-details/resource.js";
import { listAccessibleMatches } from "./list-accessible-matches/resource.js";
import { opponentForecastSubmit } from "./opponent-forecast-submit/resource.js";
import { opponentForecastWorker } from "./opponent-forecast-worker/resource.js";
import { predictionSubmit } from "./prediction-submit/resource.js";
import { predictionWorker } from "./prediction-worker/resource.js";

const backend = defineBackend({
  auth,
  data,
  createBillingCheckoutSession,
  createBillingLifetimeCheckoutSession,
  createBillingPortalSession,
  connectBbAccount,
  disconnectBbAccount,
  refreshWorkspace,
  getHomeWorkspace,
  getTeamHub,
  getScoutWorkspace,
  getLeagueIntel,
  getLeagueHistory,
  getLatestOpponentForecast,
  getPlayerLab,
  getLineupHelperWorkspace,
  evaluateLineupHelper,
  getPlayerTrend,
  getBillingSummary,
  listMyBillingPayments,
  getMyTeamHighlights,
  getSalaryProjection,
  leagueHistoryWorker,
  generateSharedPlayerCard,
  refreshBbWorkspaces,
  refreshBbWorkspaceWorker,
  pruneOperationalData,
  setBbLeagueTimeZone,
  getAccessibleMatch,
  getAccessiblePlayByPlay,
  getMatchBoxscoreDetails,
  listAccessibleMatches,
  gameDayRecapSubmit,
  gameDayRecapWorker,
  opponentForecastSubmit,
  opponentForecastWorker,
  predictionSubmit,
  predictionWorker,
  submitLeagueGameDayRecap,
  submitLeagueHistoryBackfill,
  submitMyTeamHighlightsScan,
  submitSingleGameSummary,
  billingWebhook,
  billingAdminOverride,
});

const sharedInfraBindings = resolveSharedInfraBindings();
const appResourceRemovalPolicy = resolveAppResourceRemovalPolicy();

configureAuthControls(backend);
configureBillingIntegration(backend, resolveBillingConfig());
configureCostVisibility(
  backend,
  resolveCostVisibilityConfig(),
  appResourceRemovalPolicy,
);
configureGameDayRecapJobs(
  backend,
  resolveGameDayRecapConfig(),
  appResourceRemovalPolicy,
);
configureLeagueHistoryJobs(backend, appResourceRemovalPolicy);
configureOpponentForecastJobs(
  backend,
  sharedInfraBindings,
  appResourceRemovalPolicy,
);
configurePredictionJobs(backend, sharedInfraBindings, appResourceRemovalPolicy);
configureRefreshJobs(
  backend,
  resolveRefreshJobsConfig(),
  appResourceRemovalPolicy,
);
configureMatchStoreIntegration(backend, sharedInfraBindings);
configureOperationalRetention(backend, resolveOperationalRetentionConfig());
