import { env } from "$amplify/env/prune-operational-data";

import {
  deleteNextGamePlannerArtifact,
  deleteNextGamePlannerArtifactRow,
  deleteNextGameRecommendationJob,
  deleteOpponentForecastJob,
  listExpiredNextGamePlannerArtifacts,
  listExpiredNextGameRecommendationJobs,
  listExpiredOpponentForecastJobs,
  listNextGamePlannerArtifactRowsByArtifactKey,
  listExpiredSyncRuns,
  deleteSyncRun,
} from "../_backend/repository";

export const handler = async (): Promise<{
  deletedNextGamePlannerArtifacts: number;
  deletedNextGamePlannerArtifactRows: number;
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

  let deletedNextGamePlannerArtifacts = 0;
  let deletedNextGamePlannerArtifactRows = 0;
  let nextGamePlannerArtifactNextToken: string | null = null;
  do {
    const page = await listExpiredNextGamePlannerArtifacts(env, now, {
      limit: 100,
      nextToken: nextGamePlannerArtifactNextToken,
    });

    for (const artifact of page.records) {
      let rowNextToken: string | null = null;
      do {
        const rowPage = await listNextGamePlannerArtifactRowsByArtifactKey(
          env,
          artifact.artifactKey,
          {
            limit: 100,
            nextToken: rowNextToken,
          },
        );

        for (const row of rowPage.records) {
          await deleteNextGamePlannerArtifactRow(env, {
            artifactKey: row.artifactKey,
            viewId: row.viewId,
            opponentPairId: row.opponentPairId,
          });
          deletedNextGamePlannerArtifactRows += 1;
        }

        rowNextToken = rowPage.nextToken;
      } while (rowNextToken);

      await deleteNextGamePlannerArtifact(env, artifact.artifactKey);
      deletedNextGamePlannerArtifacts += 1;
    }

    nextGamePlannerArtifactNextToken = page.nextToken;
  } while (nextGamePlannerArtifactNextToken);

  return {
    deletedNextGamePlannerArtifacts,
    deletedNextGamePlannerArtifactRows,
    deletedNextGameRecommendationJobs,
    deletedOpponentForecastJobs,
    deletedSyncRuns,
  };
};
