export const LOCALHOST_APP_ORIGIN: string;

export function normalizePublicAppOrigin(
  value: string | null | undefined,
): string | null;

export function resolvePublicAppOrigin(
  env: Record<string, string | undefined>,
  options?: {
    errorMessage?: string;
    fallback?: string | null;
  },
): string;

export function deriveAmplifyAppOrigin(
  env: Record<string, string | undefined>,
): string;
