import { env } from "$amplify/env/league-history-worker";

import { processLeagueHistoryBackfill } from "../_backend/league-history";

type LeagueHistoryMessage = {
  leagueId: string;
  requestedAt: string;
  userId: string;
};

export const handler = async (
  event: LeagueHistoryMessage,
): Promise<{ ok: true }> => {
  await processLeagueHistoryBackfill({
    env,
    message: event,
  });
  return { ok: true };
};
