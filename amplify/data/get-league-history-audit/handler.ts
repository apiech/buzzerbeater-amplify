import { env } from "$amplify/env/get-league-history-audit";

import type { Schema } from "../resource";
import { getLeagueHistoryAudit } from "../_backend/league-history";

type Handler = Schema["getLeagueHistoryAudit"]["functionHandler"];

export const handler: Handler = async (event) =>
  getLeagueHistoryAudit({
    env,
    identity: event.identity,
    includeLiveComparison: event.arguments.includeLiveComparison,
    leagueId: event.arguments.leagueId,
  });
