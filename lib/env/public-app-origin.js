export const LOCALHOST_APP_ORIGIN = "http://localhost:3000";

export function normalizePublicAppOrigin(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

export function resolvePublicAppOrigin(env, options = {}) {
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

export function deriveAmplifyAppOrigin(env) {
  return resolvePublicAppOrigin(env, {
    errorMessage:
      "APP_BASE_URL must be configured to derive AMPLIFY_APP_ORIGIN for Next.js runtime.",
  });
}
