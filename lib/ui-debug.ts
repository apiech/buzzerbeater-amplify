const NON_PROD_HOSTNAME_MARKERS = [
  ".local",
  "localhost",
  "sandbox",
  "staging",
  "preview",
  "dev",
  "test",
] as const;

export function isNonProductionHostname(
  hostname: string | null | undefined,
): boolean {
  const normalized = hostname?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }

  if (normalized === "127.0.0.1" || normalized === "::1") {
    return true;
  }

  return NON_PROD_HOSTNAME_MARKERS.some((marker) =>
    marker.startsWith(".")
      ? normalized.endsWith(marker)
      : normalized.includes(marker),
  );
}

export function isNonProductionClientRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return isNonProductionHostname(window.location.hostname);
}
