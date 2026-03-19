import { env } from "$amplify/env/submit-league-history-backfill";

import type { Schema } from "../resource";
import { submitLeagueHistoryBackfill } from "../_backend/league-history";

type Handler = Schema["submitLeagueHistoryBackfill"]["functionHandler"];
type RuntimeEnv = Record<string, string | undefined>;

export const handler: Handler = async (event) => {
  const queueUrl = (env as RuntimeEnv)["LEAGUE_HISTORY_BACKFILL_QUEUE_URL"];
  if (!queueUrl) {
    throw new Error(
      "League history backfill queue URL environment variable was not found.",
    );
  }

  return submitLeagueHistoryBackfill({
    env,
    identity: event.identity,
    leagueId: event.arguments.leagueId,
    queueUrl,
  });
};
