import { env } from "$amplify/env/prune-operational-data";

import {
  deleteLeagueSeasonSimulationArtifact,
  deleteLeagueSeasonSimulationJob,
  deleteNextGamePlannerArtifact,
  deleteNextGamePlannerArtifactRow,
  deleteNextGameRecommendationJob,
  deleteOpponentForecastJob,
  listExpiredLeagueSeasonSimulationArtifacts,
  listExpiredLeagueSeasonSimulationJobs,
  listExpiredNextGamePlannerArtifacts,
  listExpiredNextGameRecommendationJobs,
  listExpiredOpponentForecastJobs,
  listNextGamePlannerArtifactRowsByArtifactKey,
  listExpiredSyncRuns,
  deleteSyncRun,
} from "../_backend/repository";

export const handler = async (): Promise<{
  deletedLeagueSeasonSimulationJobs: number;
  deletedLeagueSeasonSimulationArtifacts: number;
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

  let deletedLeagueSeasonSimulationJobs = 0;
  let deletedLeagueSeasonSimulationArtifacts = 0;
  let leagueSeasonSimulationArtifactNextToken: string | null = null;
  do {
    const page = await listExpiredLeagueSeasonSimulationArtifacts(env, now, {
      limit: 100,
      nextToken: leagueSeasonSimulationArtifactNextToken,
    });

    for (const artifact of page.records) {
      await deleteLeagueSeasonSimulationArtifact(env, {
        artifactKey: artifact.artifactKey,
        artifactType: artifact.artifactType,
        jobId: artifact.jobId,
      });
      deletedLeagueSeasonSimulationArtifacts += 1;
    }

    leagueSeasonSimulationArtifactNextToken = page.nextToken;
  } while (leagueSeasonSimulationArtifactNextToken);

  let leagueSeasonSimulationNextToken: string | null = null;
  do {
    const page = await listExpiredLeagueSeasonSimulationJobs(env, now, {
      limit: 100,
      nextToken: leagueSeasonSimulationNextToken,
    });

    for (const job of page.records) {
      await deleteLeagueSeasonSimulationJob(env, job.id);
      deletedLeagueSeasonSimulationJobs += 1;
    }

    leagueSeasonSimulationNextToken = page.nextToken;
  } while (leagueSeasonSimulationNextToken);

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
    deletedLeagueSeasonSimulationArtifacts,
    deletedLeagueSeasonSimulationJobs,
    deletedNextGamePlannerArtifacts,
    deletedNextGamePlannerArtifactRows,
    deletedNextGameRecommendationJobs,
    deletedOpponentForecastJobs,
    deletedSyncRuns,
  };
};
