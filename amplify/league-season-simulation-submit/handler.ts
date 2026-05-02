import { env } from "$amplify/env/league-season-simulation-submit";

import type { Schema } from "../data/resource";
import { submitLeagueSeasonSimulationJob } from "../data/_backend/league-season-simulation";

type Handler = Schema["submitLeagueSeasonSimulationJob"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)[
    "LEAGUE_SEASON_SIMULATION_JOB_STATE_MACHINE_ARN"
  ];
  if (!stateMachineArn) {
    throw new Error(
      "League season simulation state machine ARN environment variable was not found.",
    );
  }

  return submitLeagueSeasonSimulationJob({
    env,
    identity: event.identity,
    leagueId: event.arguments.leagueId,
    stateMachineArn,
  });
};
