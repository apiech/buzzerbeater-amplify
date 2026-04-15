import { defineBackend } from "@aws-amplify/backend";

import { configureAuthControls } from "./_backend/auth-controls.js";
import { configureBbConnectionSecretAccess } from "./_backend/bb-connection-secret-access.js";
import { configureBillingIntegration } from "./_backend/billing-integration.js";
import { configureCostVisibility } from "./_backend/cost-visibility.js";
import { configureFeedbackNotifications } from "./_backend/feedback-notifications.js";
import { configureGameDayRecapJobs } from "./_backend/game-day-recap-jobs.js";
import { configureHostedComputeRole } from "./_backend/hosted-compute-role.js";
import { configureLeagueHistoryJobs } from "./_backend/league-history-jobs.js";
import { configureMaintenanceControlPlane } from "./_backend/maintenance-control-plane.js";
import { configureMatchStoreIntegration } from "./_backend/match-store-integration.js";
import { configureNextGameRecommendationJobs } from "./_backend/next-game-recommendation-jobs.js";
import { configureOpponentForecastJobs } from "./_backend/opponent-forecast-jobs.js";
import { configureOperationalRetention } from "./_backend/operational-retention.js";
import { configurePredictionJobs } from "./_backend/prediction-jobs.js";
import { configureRivalsJobs } from "./_backend/rivals-jobs.js";
import {
  resolveAppResourceRemovalPolicy,
  resolveBillingConfig,
  resolveCostVisibilityConfig,
  resolveFeedbackNotificationConfig,
  resolveGameDayRecapConfig,
  resolveOperationalRetentionConfig,
  resolveSharedInfraBindings,
} from "./_shared/synth-env.js";
import { auth } from "./auth/resource.js";
import { billingAdminOverride } from "./billing-admin-override/resource.js";
import { billingWebhook } from "./billing-webhook/resource.js";
import { evaluatePredictionMatrix } from "./evaluate-prediction-matrix/resource.js";
import {
  createBillingCheckoutSession,
  createBillingLifetimeCheckoutSession,
  createBillingPortalSession,
  clearMyTeamHighlightsData,
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
  getLatestNextGameRecommendation,
  getNextGamePlannerDetail,
  getLineupHelperWorkspace,
  getManualSalaryEstimate,
  getMyTeamHighlights,
  getPlayerLab,
  getPlayerTrend,
  getRivalsWorkspace,
  getSalaryCalculatorSeed,
  getSalaryProjection,
  getScoutSchedule,
  getScoutTeamSummary,
  leagueHistoryWorker,
  listMyBillingPayments,
  pruneOperationalData,
  refreshWorkspace,
  rivalsWorker,
  revokeSharedPlayerCard,
  setBbLeagueTimeZone,
  submitProductFeedback,
  submitRivalsBackfill,
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
import { nextGameRecommendationSubmit } from "./next-game-recommendation-submit/resource.js";
import { nextGameRecommendationWorker } from "./next-game-recommendation-worker/resource.js";
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
  clearMyTeamHighlightsData,
  connectBbAccount,
  disconnectBbAccount,
  evaluatePredictionMatrix,
  refreshWorkspace,
  getHomeWorkspace,
  getScoutTeamSummary,
  getScoutSchedule,
  getLeagueIntel,
  getLeagueHistory,
  getLatestOpponentForecast,
  getLatestNextGameRecommendation,
  getNextGamePlannerDetail,
  getPlayerLab,
  getRivalsWorkspace,
  submitRivalsBackfill,
  getLineupHelperWorkspace,
  evaluateLineupHelper,
  getPlayerTrend,
  getSalaryCalculatorSeed,
  getManualSalaryEstimate,
  getBillingSummary,
  listMyBillingPayments,
  getMyTeamHighlights,
  getSalaryProjection,
  leagueHistoryWorker,
  rivalsWorker,
  generateSharedPlayerCard,
  revokeSharedPlayerCard,
  lookupSharedPlayerCard,
  nextGameRecommendationSubmit,
  nextGameRecommendationWorker,
  pruneOperationalData,
  setBbLeagueTimeZone,
  submitProductFeedback,
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
  backend.getScoutTeamSummary,
  backend.getScoutSchedule,
  backend.getLatestOpponentForecast,
  backend.getLatestNextGameRecommendation,
  backend.getNextGamePlannerDetail,
  backend.getLeagueIntel,
  backend.getLeagueHistory,
  backend.getPlayerLab,
  backend.getLineupHelperWorkspace,
  backend.evaluateLineupHelper,
  backend.getPlayerTrend,
  backend.getSalaryCalculatorSeed,
  backend.submitMyTeamHighlightsScan,
  backend.submitRivalsBackfill,
  backend.submitLeagueHistoryBackfill,
  backend.leagueHistoryWorker,
  backend.rivalsWorker,
  backend.getSalaryProjection,
  backend.generateSharedPlayerCard,
  backend.revokeSharedPlayerCard,
  backend.lookupSharedPlayerCard,
  backend.pruneOperationalData,
  backend.getMatchBoxscoreDetails,
  backend.gameDayRecapWorker,
  backend.nextGameRecommendationSubmit,
  backend.nextGameRecommendationWorker,
  backend.opponentForecastWorker,
]);
configureBillingIntegration(backend, resolveBillingConfig());
configureMaintenanceControlPlane(backend, [
  backend.connectBbAccount,
  backend.disconnectBbAccount,
  backend.refreshWorkspace,
  backend.getHomeWorkspace,
  backend.getScoutTeamSummary,
  backend.getScoutSchedule,
  backend.getLatestOpponentForecast,
  backend.getLatestNextGameRecommendation,
  backend.getNextGamePlannerDetail,
  backend.getLeagueIntel,
  backend.getLeagueHistory,
  backend.getPlayerLab,
  backend.getRivalsWorkspace,
  backend.getLineupHelperWorkspace,
  backend.evaluateLineupHelper,
  backend.getPlayerTrend,
  backend.getSalaryCalculatorSeed,
  backend.getManualSalaryEstimate,
  backend.submitMyTeamHighlightsScan,
  backend.submitRivalsBackfill,
  backend.clearMyTeamHighlightsData,
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
  backend.submitProductFeedback,
  backend.listAccessibleMatches,
  backend.getAccessibleMatch,
  backend.getAccessiblePlayByPlay,
  backend.getMatchBoxscoreDetails,
  backend.evaluatePredictionMatrix,
  backend.generateSharedPlayerCard,
  backend.revokeSharedPlayerCard,
  backend.lookupSharedPlayerCard,
  backend.leagueHistoryWorker,
  backend.rivalsWorker,
  backend.gameDayRecapSubmit,
  backend.gameDayRecapWorker,
  backend.nextGameRecommendationSubmit,
  backend.nextGameRecommendationWorker,
  backend.opponentForecastSubmit,
  backend.opponentForecastWorker,
  backend.predictionSubmit,
  backend.evaluatePredictionMatrix,
  backend.predictionWorker,
]);
configureHostedComputeRole(backend);
configureFeedbackNotifications(
  backend,
  resolveFeedbackNotificationConfig(),
  appResourceRemovalPolicy,
);
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
configureRivalsJobs(backend, appResourceRemovalPolicy);
configureOpponentForecastJobs(
  backend,
  sharedInfraBindings,
  appResourceRemovalPolicy,
);
configureNextGameRecommendationJobs(
  backend,
  sharedInfraBindings,
  appResourceRemovalPolicy,
);
configurePredictionJobs(backend, sharedInfraBindings, appResourceRemovalPolicy);
configureMatchStoreIntegration(backend, sharedInfraBindings);
configureOperationalRetention(backend, resolveOperationalRetentionConfig());
