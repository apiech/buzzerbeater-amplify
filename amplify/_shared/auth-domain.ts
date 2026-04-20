export type CognitoAuthCustomDomainConfig = {
  domain: string;
  zoneId: string;
  zoneName: string;
};

type OptionalStringRecord = Record<string, string | undefined>;

export function normalizeCognitoAuthDomain(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
  const host = withoutProtocol.split("/")[0]?.trim().toLowerCase() ?? "";
  const normalized = host.replace(/\.+$/, "");
  return normalized ? normalized : null;
}

export function isAmazonCognitoManagedDomain(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeCognitoAuthDomain(value);
  return normalized?.endsWith(".amazoncognito.com") ?? false;
}

export function normalizeHostedZoneName(
  value: string | null | undefined,
): string | null {
  return normalizeCognitoAuthDomain(value);
}

export function deriveDefaultCognitoAuthCustomDomain(
  zoneName: string,
): string {
  return `auth.${normalizeRequiredHostedZoneName(zoneName)}`;
}

export function resolveCognitoAuthCustomDomainOverride(
  env: OptionalStringRecord,
): string | null {
  const configuredDomain = normalizeCognitoAuthDomain(
    env.COGNITO_AUTH_CUSTOM_DOMAIN,
  );
  if (configuredDomain) {
    return configuredDomain;
  }

  const zoneName = normalizeHostedZoneName(
    env.COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME,
  );
  if (!zoneName) {
    return null;
  }

  return deriveDefaultCognitoAuthCustomDomain(zoneName);
}

export function resolveCognitoAuthCustomDomainConfig(
  env: OptionalStringRecord,
): CognitoAuthCustomDomainConfig | null {
  const zoneId = normalizeOptionalString(env.COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID);
  const zoneName = normalizeHostedZoneName(
    env.COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME,
  );
  const domain = resolveCognitoAuthCustomDomainOverride(env);

  if (!domain && !zoneId && !zoneName) {
    return null;
  }

  if (!zoneId || !zoneName) {
    throw new Error(
      "COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME and COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID must both be set when enabling the Cognito custom auth domain.",
    );
  }

  if (!domain) {
    throw new Error(
      "COGNITO_AUTH_CUSTOM_DOMAIN could not be resolved from the provided hosted zone settings.",
    );
  }

  if (domain !== zoneName && !domain.endsWith(`.${zoneName}`)) {
    throw new Error(
      `COGNITO_AUTH_CUSTOM_DOMAIN must be within the hosted zone '${zoneName}'.`,
    );
  }

  return {
    domain,
    zoneId,
    zoneName,
  };
}

export function extractCognitoAuthDomainFromConfig(config: unknown): string | null {
  const rawAuthDomain = extractNestedString(config, [
    "auth",
    "oauth",
    "domain",
  ]);
  if (rawAuthDomain) {
    return normalizeCognitoAuthDomain(rawAuthDomain);
  }

  return normalizeCognitoAuthDomain(
    extractNestedString(config, ["Auth", "Cognito", "loginWith", "oauth", "domain"]),
  );
}

export function applyCognitoAuthDomainOverride<T>(
  config: T,
  overrideDomain: string | null,
): T {
  const normalizedOverride = normalizeCognitoAuthDomain(overrideDomain);
  if (!normalizedOverride || typeof config !== "object" || config === null) {
    return config;
  }

  let nextConfig = config as Record<string, unknown>;
  let updated = false;

  const rawAuth = asRecord(nextConfig.auth);
  const rawOauth = asRecord(rawAuth?.oauth);
  if (rawAuth && rawOauth) {
    nextConfig = {
      ...nextConfig,
      auth: {
        ...rawAuth,
        oauth: {
          ...rawOauth,
          domain: normalizedOverride,
        },
      },
    };
    updated = true;
  }

  const parsedAuth = asRecord(nextConfig.Auth);
  const parsedCognito = asRecord(parsedAuth?.Cognito);
  const parsedLoginWith = asRecord(parsedCognito?.loginWith);
  const parsedOauth = asRecord(parsedLoginWith?.oauth);
  if (parsedAuth && parsedCognito && parsedLoginWith && parsedOauth) {
    nextConfig = {
      ...nextConfig,
      Auth: {
        ...parsedAuth,
        Cognito: {
          ...parsedCognito,
          loginWith: {
            ...parsedLoginWith,
            oauth: {
              ...parsedOauth,
              domain: normalizedOverride,
            },
          },
        },
      },
    };
    updated = true;
  }

  return (updated ? nextConfig : config) as T;
}

function extractNestedString(
  value: unknown,
  path: readonly string[],
): string | null {
  let current: unknown = value;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record) {
      return null;
    }
    current = record[segment];
  }

  return typeof current === "string" ? current : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredHostedZoneName(value: string): string {
  const normalized = normalizeHostedZoneName(value);
  if (!normalized) {
    throw new Error("Hosted zone name could not be resolved.");
  }

  return normalized;
}
