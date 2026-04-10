import { env } from "$amplify/env/prune-operational-data";

import {
  deleteNextGameRecommendationJob,
  deleteOpponentForecastJob,
  listExpiredNextGameRecommendationJobs,
  listExpiredOpponentForecastJobs,
  listExpiredSyncRuns,
  deleteSyncRun,
} from "../_backend/repository";

export const handler = async (): Promise<{
  deletedNextGameRecommendationJobs: number;
  deletedOpponentForecastJobs: number;
  deletedSyncRuns: number;
}> => {
  const now = new Date().toISOString();
  let deletedSyncRuns = 0;
  let syncRunNextToken: string | null = null;
  do {
    const page = await listExpiredSyncRuns(env, now, {
      limit: 100,
      nextToken: syncRunNextToken,
    });

    for (const syncRun of page.records) {
      await deleteSyncRun(env, syncRun.id);
      deletedSyncRuns += 1;
    }

    syncRunNextToken = page.nextToken;
  } while (syncRunNextToken);

  let deletedOpponentForecastJobs = 0;
  let opponentForecastJobNextToken: string | null = null;
  do {
    const page = await listExpiredOpponentForecastJobs(env, now, {
      limit: 100,
      nextToken: opponentForecastJobNextToken,
    });

    for (const job of page.records) {
      await deleteOpponentForecastJob(env, job.id);
      deletedOpponentForecastJobs += 1;
    }

    opponentForecastJobNextToken = page.nextToken;
  } while (opponentForecastJobNextToken);

  let deletedNextGameRecommendationJobs = 0;
  let nextGameRecommendationNextToken: string | null = null;
  do {
    const page = await listExpiredNextGameRecommendationJobs(env, now, {
      limit: 100,
      nextToken: nextGameRecommendationNextToken,
    });

    for (const job of page.records) {
      await deleteNextGameRecommendationJob(env, job.id);
      deletedNextGameRecommendationJobs += 1;
    }

    nextGameRecommendationNextToken = page.nextToken;
  } while (nextGameRecommendationNextToken);

  return {
    deletedNextGameRecommendationJobs,
    deletedOpponentForecastJobs,
    deletedSyncRuns,
  };
};
