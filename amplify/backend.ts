import { defineBackend } from "@aws-amplify/backend";

import { configureAuthControls } from "./_backend/auth-controls.js";
import { configureBbConnectionSecretAccess } from "./_backend/bb-connection-secret-access.js";
import { configureBillingIntegration } from "./_backend/billing-integration.js";
import { configureCostVisibility } from "./_backend/cost-visibility.js";
import { configureGameDayRecapJobs } from "./_backend/game-day-recap-jobs.js";
import { configureHostedComputeRole } from "./_backend/hosted-compute-role.js";
import { configureLeagueHistoryJobs } from "./_backend/league-history-jobs.js";
import { configureMaintenanceControlPlane } from "./_backend/maintenance-control-plane.js";
import { configureMatchStoreIntegration } from "./_backend/match-store-integration.js";
import { configureOpponentForecastJobs } from "./_backend/opponent-forecast-jobs.js";
import { configureOperationalRetention } from "./_backend/operational-retention.js";
import { configurePredictionJobs } from "./_backend/prediction-jobs.js";
import {
  resolveAppResourceRemovalPolicy,
  resolveBillingConfig,
  resolveCostVisibilityConfig,
  resolveGameDayRecapConfig,
  resolveOperationalRetentionConfig,
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
  getRivalsWorkspace,
  getSalaryProjection,
  getScoutWorkspace,
  getTeamHub,
  leagueHistoryWorker,
  listMyBillingPayments,
  pruneOperationalData,
  refreshWorkspace,
  revokeSharedPlayerCard,
  setBbLeagueTimeZone,
  submitLeagueHistoryBackfill,
  submitLeagueGameDayRecap,
  submitMyTeamHighlightsScan,
  submitSingleGameSummary,
  lookupSharedPlayerCard,
} from "./data/resource.js";
import { getAccessibleMatch } from "./get-accessible-match/resource.js";
import { getAccessiblePlayByPlay } from "./get-accessible-play-by-play/resource.js";
import { gameDayRecapSubmit } from "./game-day-recap-submit/resource.js";
import { gameDayRecapWorker } from "./game-day-recap-worker/resource.js";
import { getMatchBoxscoreDetails } from "./get-match-boxscore-details/resource.js";
import { listAccessibleMatches } from "./list-accessible-matches/resource.js";
import { maintenanceAdmin } from "./maintenance-admin/resource.js";
import { maintenanceAlarmTrip } from "./maintenance-alarm-trip/resource.js";
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
  getRivalsWorkspace,
  getLineupHelperWorkspace,
  evaluateLineupHelper,
  getPlayerTrend,
  getBillingSummary,
  listMyBillingPayments,
  getMyTeamHighlights,
  getSalaryProjection,
  leagueHistoryWorker,
  generateSharedPlayerCard,
  revokeSharedPlayerCard,
  lookupSharedPlayerCard,
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
  maintenanceAdmin,
  maintenanceAlarmTrip,
});

const sharedInfraBindings = resolveSharedInfraBindings();
const appResourceRemovalPolicy = resolveAppResourceRemovalPolicy();

configureAuthControls(backend);
configureBbConnectionSecretAccess([
  backend.connectBbAccount,
  backend.disconnectBbAccount,
  backend.refreshWorkspace,
  backend.getHomeWorkspace,
  backend.getTeamHub,
  backend.getScoutWorkspace,
  backend.getLatestOpponentForecast,
  backend.getLeagueIntel,
  backend.getLeagueHistory,
  backend.getPlayerLab,
  backend.getRivalsWorkspace,
  backend.getLineupHelperWorkspace,
  backend.evaluateLineupHelper,
  backend.getPlayerTrend,
  backend.submitMyTeamHighlightsScan,
  backend.submitLeagueHistoryBackfill,
  backend.leagueHistoryWorker,
  backend.getSalaryProjection,
  backend.generateSharedPlayerCard,
  backend.revokeSharedPlayerCard,
  backend.lookupSharedPlayerCard,
  backend.pruneOperationalData,
  backend.getMatchBoxscoreDetails,
  backend.gameDayRecapWorker,
  backend.opponentForecastWorker,
]);
configureBillingIntegration(backend, resolveBillingConfig());
configureMaintenanceControlPlane(backend, [
  backend.connectBbAccount,
  backend.disconnectBbAccount,
  backend.refreshWorkspace,
  backend.getHomeWorkspace,
  backend.getTeamHub,
  backend.getScoutWorkspace,
  backend.getLatestOpponentForecast,
  backend.getLeagueIntel,
  backend.getLeagueHistory,
  backend.getPlayerLab,
  backend.getRivalsWorkspace,
  backend.getLineupHelperWorkspace,
  backend.evaluateLineupHelper,
  backend.getPlayerTrend,
  backend.submitMyTeamHighlightsScan,
  backend.submitLeagueHistoryBackfill,
  backend.getMyTeamHighlights,
  backend.getBillingSummary,
  backend.createBillingCheckoutSession,
  backend.createBillingLifetimeCheckoutSession,
  backend.createBillingPortalSession,
  backend.listMyBillingPayments,
  backend.getSalaryProjection,
  backend.submitLeagueGameDayRecap,
  backend.submitSingleGameSummary,
  backend.setBbLeagueTimeZone,
  backend.listAccessibleMatches,
  backend.getAccessibleMatch,
  backend.getAccessiblePlayByPlay,
  backend.getMatchBoxscoreDetails,
  backend.generateSharedPlayerCard,
  backend.revokeSharedPlayerCard,
  backend.lookupSharedPlayerCard,
  backend.leagueHistoryWorker,
  backend.gameDayRecapSubmit,
  backend.gameDayRecapWorker,
  backend.opponentForecastSubmit,
  backend.opponentForecastWorker,
  backend.predictionSubmit,
  backend.predictionWorker,
]);
configureHostedComputeRole(backend);
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
configureMatchStoreIntegration(backend, sharedInfraBindings);
configureOperationalRetention(backend, resolveOperationalRetentionConfig());
