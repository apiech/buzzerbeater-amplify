import { env } from "$amplify/env/connect-bb-account";

import type { Schema } from "../resource";
import { connectAccount } from "../_backend/workspace";
import {
  elapsedMs,
  logWorkspaceError,
  logWorkspaceInfo,
  toLoggableError,
} from "../_backend/workspace-request-logging";

type Handler = Schema["connectBbAccount"]["functionHandler"];

export const handler: Handler = async (event) => {
  const startedAt = Date.now();
  const bbLoginName = event.arguments.bbLoginName;
  const userId =
    event.identity && typeof event.identity === "object" && "sub" in event.identity
      ? (event.identity.sub as string | undefined)
      : undefined;

  logWorkspaceInfo("connectBbAccount.start", {
    bbLoginName,
    hasAccessKey: Boolean(event.arguments.accessKey?.trim()),
    userId: userId ?? null,
  });

  try {
    const connection = await connectAccount({
      env,
      identity: event.identity,
      bbLoginName,
      accessKey: event.arguments.accessKey,
    });

    logWorkspaceInfo("connectBbAccount.completed", {
      bbLoginName,
      elapsedMs: elapsedMs(startedAt),
      status: connection.status,
      teamId: connection.teamId ?? null,
      userId: userId ?? null,
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
  } catch (error) {
    logWorkspaceError("connectBbAccount.failed", {
      bbLoginName,
      elapsedMs: elapsedMs(startedAt),
      userId: userId ?? null,
      ...toLoggableError(error),
    });
    throw error;
  }
};
