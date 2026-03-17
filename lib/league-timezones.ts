export const DEFAULT_USA_LEAGUE_TIME_ZONE = "America/New_York";

const COUNTRY_TIME_ZONE_BY_ID = new Map<string, string>([
  ["1", DEFAULT_USA_LEAGUE_TIME_ZONE],
]);

const COUNTRY_TIME_ZONE_BY_NAME = new Map<string, string>([
  ["UNITED STATES", DEFAULT_USA_LEAGUE_TIME_ZONE],
  ["UNITED STATES OF AMERICA", DEFAULT_USA_LEAGUE_TIME_ZONE],
  ["USA", DEFAULT_USA_LEAGUE_TIME_ZONE],
  ["US", DEFAULT_USA_LEAGUE_TIME_ZONE],
]);

export function isValidLeagueTimeZone(value: string | null | undefined): value is string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeLeagueTimeZone(value: string | null | undefined): string | null {
  if (!isValidLeagueTimeZone(value)) {
    return null;
  }

  return value.trim();
}

export function inferLeagueTimeZone(args: {
  countryId?: string | null;
  countryName?: string | null;
}): string | null {
  const countryId = args.countryId?.trim();
  if (countryId && COUNTRY_TIME_ZONE_BY_ID.has(countryId)) {
    return COUNTRY_TIME_ZONE_BY_ID.get(countryId) ?? null;
  }

  const normalizedCountryName = args.countryName?.trim().toUpperCase();
  if (normalizedCountryName && COUNTRY_TIME_ZONE_BY_NAME.has(normalizedCountryName)) {
    return COUNTRY_TIME_ZONE_BY_NAME.get(normalizedCountryName) ?? null;
  }

  return null;
}

export function resolveCalendarDateKey(
  value: string | null | undefined,
  timeZone?: string | null,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    const normalizedTimeZone = normalizeLeagueTimeZone(timeZone);
    if (!normalizedTimeZone) {
      return date.toISOString().slice(0, 10);
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  }

  const directMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return directMatch?.[1] ?? null;
}
