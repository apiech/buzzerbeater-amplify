import { env } from "$amplify/env/get-scout-schedule";

import type { Schema } from "../resource";
import { getScoutScheduleForTeamWithMeta } from "../_backend/workspace";
import {
  elapsedMs,
  logWorkspaceError,
  logWorkspaceInfo,
  toLoggableError,
} from "../_backend/workspace-request-logging";

type Handler = Schema["getScoutSchedule"]["functionHandler"];

export const handler: Handler = async (event) => {
  const competitionKeys = event.arguments.competitionKeys?.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const startedAt = Date.now();
  const force = event.arguments.force ?? false;
  const requestedTeamId = event.arguments.teamId?.trim() || null;
  const selectedSeason = event.arguments.season ?? null;

  logWorkspaceInfo("getScoutSchedule.start", {
    competitionFilterCount: competitionKeys?.length ?? 0,
    force,
    requestedTeamId,
    selectedSeason,
  });

  try {
    const result = await getScoutScheduleForTeamWithMeta({
      competitionKeys: competitionKeys?.length ? competitionKeys : undefined,
      env,
      force,
      identity: event.identity,
      season: selectedSeason ?? undefined,
      teamId: requestedTeamId,
    });

    logWorkspaceInfo("getScoutSchedule.completed", {
      cacheHitBoxscoreCount: result.meta.cacheHitBoxscoreCount,
      competitionFilterCount: result.meta.competitionFilterCount,
      completedMatchCount: result.meta.completedMatchCount,
      currentSeason: result.meta.currentSeason,
      elapsedMs: elapsedMs(startedAt),
      force,
      hydratedBoxscoreCount: result.meta.hydratedBoxscoreCount,
      liveFetchedBoxscoreCount: result.meta.liveFetchedBoxscoreCount,
      liveFetchRequestedCount: result.meta.liveFetchRequestedCount,
      requestedTeamId: result.meta.requestedTeamId,
      resolvedTeamId: result.meta.resolvedTeamId,
      scheduleRowCount: result.meta.scheduleRowCount,
      selectedSeason: result.meta.selectedSeason,
      selectedSeasonMatchCount: result.meta.selectedSeasonMatchCount,
      stepMetrics: result.meta.stepMetrics,
      usedCachedBaseWorkspace: result.meta.usedCachedBaseWorkspace,
    });

    return result.schedule;
  } catch (error) {
    logWorkspaceError("getScoutSchedule.failed", {
      competitionFilterCount: competitionKeys?.length ?? 0,
      elapsedMs: elapsedMs(startedAt),
      force,
      requestedTeamId,
      selectedSeason,
      ...toLoggableError(error),
    });
    throw error;
  }
};
