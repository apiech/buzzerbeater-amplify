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
    normalized.startsWith("enqueuing_") ||
    normalized.startsWith("invoking_") ||
    normalized.startsWith("resolving_")
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

export function formatSyncKind(kind: string | null | undefined): string {
  if (normalizeStatusValue(kind) === "workspace-refresh") {
    return "Club data refresh";
  }

  return humanizeTechnicalText(kind);
}
