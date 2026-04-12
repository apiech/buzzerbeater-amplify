import { env } from "$amplify/env/refresh-workspace";

import type { Schema } from "../resource";
import { getOrRefreshWorkspaceWithMeta } from "../_backend/workspace";
import {
  elapsedMs,
  logWorkspaceError,
  logWorkspaceInfo,
  toLoggableError,
} from "../_backend/workspace-request-logging";

type Handler = Schema["refreshWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  const startedAt = Date.now();

  logWorkspaceInfo("refreshWorkspace.start", {
    force: true,
  });

  try {
    const { meta, workspace } = await getOrRefreshWorkspaceWithMeta({
      env,
      identity: event.identity,
      force: true,
      syncActiveTrackedTeams: true,
    });

    logWorkspaceInfo("refreshWorkspace.completed", {
      cacheState: meta.cacheState,
      elapsedMs: elapsedMs(startedAt),
      force: true,
      nextOpponentTeamId: meta.nextOpponentTeamId,
      recentMatchCount: workspace.home.recentMatches.length,
      usedCachedWorkspace: meta.usedCachedWorkspace,
    });

    return workspace.home;
  } catch (error) {
    logWorkspaceError("refreshWorkspace.failed", {
      elapsedMs: elapsedMs(startedAt),
      force: true,
      ...toLoggableError(error),
    });
    throw error;
  }
};
