import { defineBackend } from "@aws-amplify/backend";

import { configureAuthControls } from "./_backend/auth-controls.js";
import { configureBillingIntegration } from "./_backend/billing-integration.js";
import { configureCostVisibility } from "./_backend/cost-visibility.js";
import { configureGameDayRecapJobs } from "./_backend/game-day-recap-jobs.js";
import { configureMatchStoreIntegration } from "./_backend/match-store-integration.js";
import { configureOperationalRetention } from "./_backend/operational-retention.js";
import { configurePredictionJobs } from "./_backend/prediction-jobs.js";
import { configureRefreshJobs } from "./_backend/refresh-jobs.js";
import { auth } from "./auth/resource.js";
import { billingAdminOverride } from "./billing-admin-override/resource.js";
import { billingWebhook } from "./billing-webhook/resource.js";
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
  connectBbAccount,
  data,
  disconnectBbAccount,
  evaluateLineupHelper,
  generateSharedPlayerCard,
  getBillingSummary,
  getHomeWorkspace,
  getLeagueIntel,
  getLineupHelperWorkspace,
  getPlayerTrend,
  getPlayerLab,
  getSalaryProjection,
  getScoutWorkspace,
  getTeamHub,
  pruneOperationalData,
  refreshBbWorkspaces,
  refreshBbWorkspaceWorker,
  refreshWorkspace,
} from "./data/resource.js";
import { getAccessibleMatch } from "./get-accessible-match/resource.js";
import { getAccessiblePlayByPlay } from "./get-accessible-play-by-play/resource.js";
import { gameDayRecapSubmit } from "./game-day-recap-submit/resource.js";
import { gameDayRecapWorker } from "./game-day-recap-worker/resource.js";
import { getMatchBoxscoreDetails } from "./get-match-boxscore-details/resource.js";
import { listAccessibleMatches } from "./list-accessible-matches/resource.js";
import { predictionSubmit } from "./prediction-submit/resource.js";
import { predictionWorker } from "./prediction-worker/resource.js";

const backend = defineBackend({
  auth,
  data,
  createBillingCheckoutSession,
  createBillingPortalSession,
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
  getBillingSummary,
  getSalaryProjection,
  generateSharedPlayerCard,
  refreshBbWorkspaces,
  refreshBbWorkspaceWorker,
  pruneOperationalData,
  getAccessibleMatch,
  getAccessiblePlayByPlay,
  getMatchBoxscoreDetails,
  listAccessibleMatches,
  gameDayRecapSubmit,
  gameDayRecapWorker,
  predictionSubmit,
  predictionWorker,
  billingWebhook,
  billingAdminOverride,
});

configureAuthControls(backend);
configureBillingIntegration(backend);
configureCostVisibility(backend);
configureGameDayRecapJobs(backend);
configurePredictionJobs(backend);
configureRefreshJobs(backend);
configureMatchStoreIntegration(backend);
configureOperationalRetention(backend);
