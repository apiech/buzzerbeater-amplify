import { env } from "$amplify/env/repair-owner-roster-data";

import type { Schema } from "../resource";
import { repairOwnerRosterData } from "../_backend/workspace";
import {
  elapsedMs,
  logWorkspaceError,
  logWorkspaceInfo,
  toLoggableError,
} from "../_backend/workspace-request-logging";

type Handler = Schema["repairOwnerRosterData"]["functionHandler"];

export const handler: Handler = async (event) => {
  const startedAt = Date.now();

  logWorkspaceInfo("repairOwnerRosterData.start", {
    targeted: true,
  });

  try {
    const result = await repairOwnerRosterData({
      env,
      identity: event.identity,
    });

    logWorkspaceInfo("repairOwnerRosterData.completed", {
      elapsedMs: elapsedMs(startedAt),
      repairedPlayerCount: result.repairedPlayerCount,
      targeted: true,
    });

    return result;
  } catch (error) {
    logWorkspaceError("repairOwnerRosterData.failed", {
      elapsedMs: elapsedMs(startedAt),
      targeted: true,
      ...toLoggableError(error),
    });
    throw error;
  }
};
