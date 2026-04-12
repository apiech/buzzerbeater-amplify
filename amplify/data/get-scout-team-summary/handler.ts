import { env } from "$amplify/env/get-scout-team-summary";

import type { Schema } from "../resource";
import { getScoutTeamSummaryForTeamWithMeta } from "../_backend/workspace";
import {
  elapsedMs,
  logWorkspaceError,
  logWorkspaceInfo,
  toLoggableError,
} from "../_backend/workspace-request-logging";

type Handler = Schema["getScoutTeamSummary"]["functionHandler"];

export const handler: Handler = async (event) => {
  const startedAt = Date.now();
  const force = event.arguments.force ?? false;
  const requestedTeamId = event.arguments.teamId?.trim() || null;

  logWorkspaceInfo("getScoutTeamSummary.start", {
    force,
    requestedTeamId,
  });

  try {
    const result = await getScoutTeamSummaryForTeamWithMeta({
      env,
      force,
      identity: event.identity,
      teamId: requestedTeamId,
    });

    logWorkspaceInfo("getScoutTeamSummary.completed", {
      elapsedMs: elapsedMs(startedAt),
      force,
      recentBoxscoreCount: result.meta.recentBoxscoreCount,
      recentMatchCount: result.meta.recentMatchCount,
      requestedTeamId: result.meta.requestedTeamId,
      resolvedTeamId: result.meta.resolvedTeamId,
      usedCachedBaseWorkspace: result.meta.usedCachedBaseWorkspace,
    });

    return result.scout;
  } catch (error) {
    logWorkspaceError("getScoutTeamSummary.failed", {
      elapsedMs: elapsedMs(startedAt),
      force,
      requestedTeamId,
      ...toLoggableError(error),
    });
    throw error;
  }
};
