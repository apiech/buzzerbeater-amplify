import { env } from "$amplify/env/prune-operational-data";

import {
  deletePredictionJob,
  deleteSyncRun,
  listPredictionJobs,
  listSyncRuns,
} from "../_backend/repository";

export const handler = async (): Promise<{
  deletedPredictionJobs: number;
  deletedSyncRuns: number;
}> => {
  const [syncRuns, predictionJobs] = await Promise.all([
    listSyncRuns(env),
    listPredictionJobs(env),
  ]);

  let deletedSyncRuns = 0;
  for (const syncRun of syncRuns) {
    if (!isExpired(syncRun.expiresAt)) {
      continue;
    }
    await deleteSyncRun(env, syncRun.id);
    deletedSyncRuns += 1;
  }

  let deletedPredictionJobs = 0;
  for (const predictionJob of predictionJobs) {
    if (!isExpired(predictionJob.expiresAt)) {
      continue;
    }
    await deletePredictionJob(env, predictionJob.id);
    deletedPredictionJobs += 1;
  }

  return {
    deletedPredictionJobs,
    deletedSyncRuns,
  };
};

function isExpired(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return parsed <= Date.now();
}
