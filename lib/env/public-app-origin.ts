export const LOCALHOST_APP_ORIGIN = "http://localhost:3000";

type OptionalStringRecord = Record<string, string | undefined>;

type ResolvePublicAppOriginOptions = {
  errorMessage?: string;
  fallback?: string | null;
};

export function normalizePublicAppOrigin(
  value: string | null | undefined,
): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

export function resolvePublicAppOrigin(
  env: OptionalStringRecord,
  options: ResolvePublicAppOriginOptions = {},
): string {
  const configuredOrigin = normalizePublicAppOrigin(env.APP_BASE_URL);
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const fallbackOrigin = normalizePublicAppOrigin(options.fallback);
  if (fallbackOrigin) {
    return fallbackOrigin;
  }

  throw new Error(options.errorMessage ?? "APP_BASE_URL must be configured.");
}

export function deriveAmplifyAppOrigin(env: OptionalStringRecord): string {
  return resolvePublicAppOrigin(env, {
    errorMessage:
      "APP_BASE_URL must be configured to derive AMPLIFY_APP_ORIGIN for Next.js runtime.",
  });
}
