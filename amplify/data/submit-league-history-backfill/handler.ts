import { env } from "$amplify/env/submit-league-history-backfill";

import type { Schema } from "../resource";
import { submitLeagueHistoryBackfill } from "../_backend/league-history";

type Handler = Schema["submitLeagueHistoryBackfill"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const stateMachineArn = (env as RuntimeEnv)["LEAGUE_HISTORY_BACKFILL_STATE_MACHINE_ARN"];
  if (!stateMachineArn) {
    throw new Error(
      "League history backfill state machine ARN environment variable was not found.",
    );
  }

  return submitLeagueHistoryBackfill({
    env,
    identity: event.identity,
    leagueId: event.arguments.leagueId,
    stateMachineArn,
  });
};
