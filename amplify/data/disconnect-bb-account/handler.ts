import { env } from "$amplify/env/disconnect-bb-account";

import type { Schema } from "../resource";
import { disconnectAccount } from "../_backend/workspace";

type Handler = Schema["disconnectBbAccount"]["functionHandler"];

export const handler: Handler = async (event) => {
  const connection = await disconnectAccount({
    env,
    identity: event.identity,
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
    connectedAt: connection.connectedAt ?? null,
    lastValidatedAt: connection.lastValidatedAt ?? null,
    lastSyncAt: connection.lastSyncAt ?? null,
    lastSyncError: connection.lastSyncError ?? null,
  };
};
