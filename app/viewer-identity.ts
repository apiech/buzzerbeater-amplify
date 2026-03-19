type ViewerLabelInput = {
  email?: string | null;
  name?: string | null;
  preferredUsername?: string | null;
  username?: string | null;
};

const opaqueAuthIdentifierPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeIdentityValue(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function isOpaqueAuthIdentifier(
  value?: string | null,
): value is string {
  const normalized = normalizeIdentityValue(value);
  return Boolean(normalized && opaqueAuthIdentifierPattern.test(normalized));
}

export function resolveViewerLabel({
  email,
  name,
  preferredUsername,
  username,
}: ViewerLabelInput): string | null {
  const normalizedEmail = normalizeIdentityValue(email);
  if (normalizedEmail) {
    return normalizedEmail;
  }

  const normalizedPreferredUsername =
    normalizeIdentityValue(preferredUsername);
  if (
    normalizedPreferredUsername &&
    !isOpaqueAuthIdentifier(normalizedPreferredUsername)
  ) {
    return normalizedPreferredUsername;
  }

  const normalizedName = normalizeIdentityValue(name);
  if (normalizedName && !isOpaqueAuthIdentifier(normalizedName)) {
    return normalizedName;
  }

  const normalizedUsername = normalizeIdentityValue(username);
  if (normalizedUsername && !isOpaqueAuthIdentifier(normalizedUsername)) {
    return normalizedUsername;
  }

  return null;
}
