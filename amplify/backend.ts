import { defineBackend } from "@aws-amplify/backend";

import { configureAuthControls } from "./_backend/auth-controls.js";
import { configureCostVisibility } from "./_backend/cost-visibility.js";
import { configureMatchStoreIntegration } from "./_backend/match-store-integration.js";
import { configureOperationalRetention } from "./_backend/operational-retention.js";
import { configurePredictionJobs } from "./_backend/prediction-jobs.js";
import { configureRefreshJobs } from "./_backend/refresh-jobs.js";
import { auth } from "./auth/resource.js";
import {
  connectBbAccount,
  data,
  disconnectBbAccount,
  generateSharedPlayerCard,
  getHomeWorkspace,
  getLeagueIntel,
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
import { getMatchBoxscoreDetails } from "./get-match-boxscore-details/resource.js";
import { listAccessibleMatches } from "./list-accessible-matches/resource.js";
import { predictionSubmit } from "./prediction-submit/resource.js";
import { predictionWorker } from "./prediction-worker/resource.js";

const backend = defineBackend({
  auth,
  data,
  connectBbAccount,
  disconnectBbAccount,
  refreshWorkspace,
  getHomeWorkspace,
  getTeamHub,
  getScoutWorkspace,
  getLeagueIntel,
  getPlayerLab,
  getPlayerTrend,
  getSalaryProjection,
  generateSharedPlayerCard,
  refreshBbWorkspaces,
  refreshBbWorkspaceWorker,
  pruneOperationalData,
  getAccessibleMatch,
  getAccessiblePlayByPlay,
  getMatchBoxscoreDetails,
  listAccessibleMatches,
  predictionSubmit,
  predictionWorker,
});

configureAuthControls(backend);
configureCostVisibility(backend);
configurePredictionJobs(backend);
configureRefreshJobs(backend);
configureMatchStoreIntegration(backend);
configureOperationalRetention(backend);
