import { env } from "$amplify/env/connect-bb-account";

import type { Schema } from "../resource";
import { connectAccount } from "../_backend/workspace";

type Handler = Schema["connectBbAccount"]["functionHandler"];

export const handler: Handler = async (event) => {
  const connection = await connectAccount({
    env,
    identity: event.identity,
    bbLoginName: event.arguments.bbLoginName,
    accessKey: event.arguments.accessKey,
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
