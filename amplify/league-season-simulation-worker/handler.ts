import { env } from "$amplify/env/league-season-simulation-worker";

import { processLeagueSeasonSimulationWorkerAction } from "../data/_backend/league-season-simulation";

type RuntimeEnv = Record<string, string | undefined>;
type SimulationJobMessage = {
  action:
    | "PREPARE_CONTEXT"
    | "COLLECT_SNAPSHOTS_CHUNK"
    | "FINALIZE_SNAPSHOTS"
    | "SCORE_GAMES_CHUNK"
    | "RUN_MONTE_CARLO";
  jobId: string;
  nextGameIndex?: number | null;
  nextTeamIndex?: number | null;
  userId: string;
};

export const handler = async (
  event: SimulationJobMessage,
  context: { getRemainingTimeInMillis: () => number },
): Promise<Record<string, unknown>> => {
  const endpointName = (env as RuntimeEnv)["PREDICTION_ENDPOINT_NAME"];
  if (!endpointName) {
    throw new Error(
      "Prediction endpoint name environment variable was not found.",
    );
  }

  return processLeagueSeasonSimulationWorkerAction({
    endpointName,
    env,
    event,
    remainingTimeInMillis: () => context.getRemainingTimeInMillis(),
  });
};
