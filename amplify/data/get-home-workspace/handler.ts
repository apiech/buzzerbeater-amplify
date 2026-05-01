import { env } from "$amplify/env/get-home-workspace";

import type { Schema } from "../resource";
import { getOrRefreshWorkspaceWithMeta } from "../_backend/workspace";
import {
  elapsedMs,
  logWorkspaceError,
  logWorkspaceInfo,
  toLoggableError,
} from "../_backend/workspace-request-logging";

type Handler = Schema["getHomeWorkspace"]["functionHandler"];

export const handler: Handler = async (event) => {
  const startedAt = Date.now();
  const force = event.arguments.force ?? false;

  logWorkspaceInfo("getHomeWorkspace.start", {
    force,
  });

  try {
    const { meta, workspace } = await getOrRefreshWorkspaceWithMeta({
      env,
      force,
      identity: event.identity,
      syncActiveTrackedTeams: false,
    });

    logWorkspaceInfo("getHomeWorkspace.completed", {
      cacheState: meta.cacheState,
      elapsedMs: elapsedMs(startedAt),
      force,
      nextOpponentTeamId: meta.nextOpponentTeamId,
      recentMatchCount: workspace.home.recentMatches.length,
      usedCachedWorkspace: meta.usedCachedWorkspace,
    });

    return workspace.home;
  } catch (error) {
    logWorkspaceError("getHomeWorkspace.failed", {
      elapsedMs: elapsedMs(startedAt),
      force,
      ...toLoggableError(error),
    });
    throw error;
  }
};
