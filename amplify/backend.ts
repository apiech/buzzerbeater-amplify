import { defineBackend } from "@aws-amplify/backend";

import { configureMatchStoreIntegration } from "./_backend/match-store-integration.js";
import { configurePredictionJobs } from "./_backend/prediction-jobs.js";
import { auth } from "./auth/resource.js";
import {
  connectBbAccount,
  data,
  disconnectBbAccount,
  getHomeWorkspace,
  getLeagueIntel,
  getPlayerLab,
  getScoutWorkspace,
  getTeamHub,
  refreshBbWorkspaces,
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
  refreshBbWorkspaces,
  getAccessibleMatch,
  getAccessiblePlayByPlay,
  getMatchBoxscoreDetails,
  listAccessibleMatches,
  predictionSubmit,
  predictionWorker,
});

configurePredictionJobs(backend);
configureMatchStoreIntegration(backend);
