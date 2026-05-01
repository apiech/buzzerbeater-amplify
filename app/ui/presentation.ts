export function normalizeStatusValue(
  status: string | null | undefined,
): string | null {
  const normalized = status?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function humanizeTechnicalText(
  value: string | null | undefined,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "Unknown";
  }

  return normalized
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isSuccessfulStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatusValue(status);
  return normalized
    ? ["connected", "idle", "ready", "succeeded"].includes(normalized)
    : false;
}

export function isFailedStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatusValue(status);
  return normalized
    ? ["disconnected", "error", "failed", "invalid", "not_found"].includes(
        normalized,
      )
    : false;
}

export function isActiveStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatusValue(status);
  if (!normalized) {
    return false;
  }

  return (
    ["pending", "queued", "running", "syncing"].includes(normalized) ||
    normalized.startsWith("building_") ||
    normalized.startsWith("evaluating_") ||
    normalized.startsWith("enqueuing_") ||
    normalized.startsWith("invoking_") ||
    normalized.startsWith("optimizing_") ||
    normalized.startsWith("preparing_") ||
    normalized.startsWith("resolving_") ||
    normalized.startsWith("scoring_") ||
    normalized.startsWith("waiting_")
  );
}

export function formatConnectionStatus(
  status: string | null | undefined,
): string {
  if (isSuccessfulStatus(status)) {
    return "Up to date";
  }

  if (isActiveStatus(status)) {
    return "Updating club data";
  }

  if (isFailedStatus(status)) {
    return "Needs attention";
  }

  return humanizeTechnicalText(status);
}

export function hasConnectionSnapshotWarning(
  status: string | null | undefined,
  lastSyncError: string | null | undefined,
): boolean {
  return normalizeStatusValue(status) === "connected" && Boolean(lastSyncError?.trim());
}

export function formatConnectionHealthStatus(
  status: string | null | undefined,
  lastSyncError: string | null | undefined,
): string {
  if (hasConnectionSnapshotWarning(status, lastSyncError)) {
    return "Using saved snapshot";
  }

  return formatConnectionStatus(status);
}

export function formatPreviewStatus(
  status: string | null | undefined,
): string {
  if (isSuccessfulStatus(status)) {
    return "Preview ready";
  }

  if (isFailedStatus(status)) {
    return "Preview failed";
  }

  if (status) {
    return "Preview running";
  }

  return "Preview unavailable";
}

export function formatWriteupStatus(
  status: string | null | undefined,
): string {
  if (isSuccessfulStatus(status)) {
    return "Writeup ready";
  }

  if (isFailedStatus(status)) {
    return "Writeup failed";
  }

  if (status) {
    return "Writeup in progress";
  }

  return "Writeup unavailable";
}

export function formatHighlightsStatus(
  status: string | null | undefined,
): string {
  const normalized = normalizeStatusValue(status);
  if (normalized === "completed_with_gaps") {
    return "Moments ready with gaps";
  }

  if (normalized === "waiting_for_match_jobs") {
    return "Preparing moments";
  }

  if (isSuccessfulStatus(status)) {
    return "Moments ready";
  }

  if (isFailedStatus(status)) {
    return "Scan failed";
  }

  if (status) {
    return "Scanning team history";
  }

  return "Highlights unavailable";
}

export function formatOpponentForecastStatus(
  status: string | null | undefined,
): string {
  const normalized = normalizeStatusValue(status);
  if (!normalized) {
    return "Opponent outlook unavailable";
  }

  if (isSuccessfulStatus(status)) {
    return "Opponent outlook ready";
  }

  if (isFailedStatus(status)) {
    return "Opponent outlook failed";
  }

  switch (normalized) {
    case "invoking_model":
      return "Building opponent outlook";
    case "resolving_context":
      return "Resolving opponent context";
    case "queued":
      return "Queueing opponent outlook";
    default:
      return "Preparing opponent outlook";
  }
}

export function formatNextGameRecommendationStatus(
  status: string | null | undefined,
): string {
  const normalized = normalizeStatusValue(status);
  if (!normalized) {
    return "Recommendation unavailable";
  }

  if (isSuccessfulStatus(status)) {
    return "Recommendation ready";
  }

  if (isFailedStatus(status)) {
    return "Recommendation failed";
  }

  switch (normalized) {
    case "queued":
      return "Queueing recommendation";
    case "preparing_inputs":
      return "Preparing recommendation";
    case "resolving_context":
      return "Resolving game context";
    case "optimizing_lineups":
      return "Optimizing usable lineups";
    case "evaluating_candidates":
    case "scoring_matchups":
      return "Scoring matchup combinations";
    case "building_planner":
      return "Building final planner";
    default:
      return "Recommendation running";
  }
}

export function formatSyncKind(kind: string | null | undefined): string {
  if (normalizeStatusValue(kind) === "workspace-refresh") {
    return "Club data refresh";
  }

  return humanizeTechnicalText(kind);
}
