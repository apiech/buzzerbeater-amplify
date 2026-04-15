import { env } from "$amplify/env/league-history-worker";

import { processLeagueHistoryBackfill } from "../_backend/league-history";

type LeagueHistoryMessage = {
  leagueId: string;
  refreshMode?: "MISSING_ONLY" | "REFRESH_ALL_HISTORICAL" | null;
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
