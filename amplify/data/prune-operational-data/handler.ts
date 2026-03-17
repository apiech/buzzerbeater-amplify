import { env } from "$amplify/env/prune-operational-data";

import {
  deletePredictionJob,
  listExpiredPredictionJobs,
  listExpiredSyncRuns,
  deleteSyncRun,
} from "../_backend/repository";

export const handler = async (): Promise<{
  deletedPredictionJobs: number;
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

  let deletedPredictionJobs = 0;
  let predictionJobNextToken: string | null = null;
  do {
    const page = await listExpiredPredictionJobs(env, now, {
      limit: 100,
      nextToken: predictionJobNextToken,
    });

    for (const predictionJob of page.records) {
      await deletePredictionJob(env, predictionJob.id);
      deletedPredictionJobs += 1;
    }

    predictionJobNextToken = page.nextToken;
  } while (predictionJobNextToken);

  return {
    deletedPredictionJobs,
    deletedSyncRuns,
  };
};
