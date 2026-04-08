export const COMMERCIAL_MODE_ENABLED_ENV_NAME = "COMMERCIAL_MODE_ENABLED";

type EnvLike = Record<string, string | undefined>;

export function resolveCommercialModeEnabled(
  env: EnvLike,
): boolean {
  if (!Object.hasOwn(env, COMMERCIAL_MODE_ENABLED_ENV_NAME)) {
    return true;
  }

  return parseBooleanEnv(env[COMMERCIAL_MODE_ENABLED_ENV_NAME]);
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
