import { env } from "$amplify/env/set-bb-league-time-zone";

import type { Schema } from "../resource";
import { setLeagueTimeZone } from "../_backend/workspace";

type Handler = Schema["setBbLeagueTimeZone"]["functionHandler"];

export const handler: Handler = async (event) => {
  const connection = await setLeagueTimeZone({
    env,
    identity: event.identity,
    leagueTimeZone: event.arguments.leagueTimeZone,
  });

  return {
    bbLoginName: connection.bbLoginName,
    status: connection.status,
    accessKeyLast4: connection.accessKeyLast4 ?? null,
    teamId: connection.teamId ?? null,
    teamName: connection.teamName ?? null,
    leagueId: connection.leagueId ?? null,
    leagueName: connection.leagueName ?? null,
    countryId: connection.countryId ?? null,
    countryName: connection.countryName ?? null,
    leagueTimeZone: connection.leagueTimeZone ?? null,
    connectedAt: connection.connectedAt ?? null,
    lastValidatedAt: connection.lastValidatedAt ?? null,
    lastSyncAt: connection.lastSyncAt ?? null,
    lastSyncError: connection.lastSyncError ?? null,
  };
};
