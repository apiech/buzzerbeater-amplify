import { env } from "$amplify/env/league-season-simulation-failure-finalizer";

import { finalizeLeagueSeasonSimulationWorkflowFailure } from "../data/_backend/league-season-simulation";

type WorkflowFailureEvent = {
  error?: unknown;
  jobId: string;
  userId: string;
};

export const handler = async (
  event: WorkflowFailureEvent,
): Promise<{ ok: true; updated: boolean }> => {
  const result = await finalizeLeagueSeasonSimulationWorkflowFailure({
    env,
    event,
  });
  return {
    ok: true,
    updated: result.updated,
  };
};
