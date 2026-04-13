import type { BBApiBoxScore } from "../../../lib/bbapi";
import type { Schema } from "../resource";

type MatchBoxscoreDetails = NonNullable<
  Schema["getMatchBoxscoreDetails"]["returnType"]
>;
type StoredMatchBoxscore = NonNullable<
  Schema["MatchBoxscore"]["type"]["boxscoreJson"]
>;
type StoredMatchBoxscoreTeam = NonNullable<StoredMatchBoxscore["homeTeam"]>;
type StoredMatchBoxscorePlayer = StoredMatchBoxscoreTeam["players"][number];
type StoredMetricEntry = { key: string; numberValue: number };

export function toStoredMatchBoxscore(input: {
  boxscore: BBApiBoxScore;
  source?: string | null;
}): StoredMatchBoxscore | null {
  const matchId = asOptionalString(input.boxscore.matchId);
  if (!matchId) {
    return null;
  }

  return {
    matchId,
    matchType: asOptionalString(input.boxscore.type),
    startTime: asOptionalString(input.boxscore.startTime),
    endTime: asOptionalString(input.boxscore.endTime),
    homeTeam: serializeTeam(asRecord(input.boxscore.homeTeam)),
    awayTeam: serializeTeam(asRecord(input.boxscore.awayTeam)),
    context: {
      homeTeamName: asOptionalString(
        asRecord(input.boxscore.homeTeam)?.teamName,
      ),
      awayTeamName: asOptionalString(
        asRecord(input.boxscore.awayTeam)?.teamName,
      ),
      effortDelta: asOptionalInteger(input.boxscore.effortDelta),
      neutral: asOptionalBoolean(input.boxscore.neutral),
    },
    source: normalizeSourceLabel(input.source),
  };
}

export function inflateStoredMatchBoxscore(value: unknown): BBApiBoxScore | null {
  const parsed = parseLegacyJsonValue(value);
  const record = asRecord(parsed);
  if (!record) {
    return null;
  }

  if (!isStoredMatchBoxscore(record)) {
    return record as BBApiBoxScore;
  }

  return {
    matchId: record.matchId,
    type: record.matchType ?? undefined,
    startTime: record.startTime ?? undefined,
    endTime: record.endTime ?? undefined,
    effortDelta: record.context?.effortDelta ?? undefined,
    neutral: record.context?.neutral ?? undefined,
    homeTeam: inflateStoredTeam(record.homeTeam ?? null),
    awayTeam: inflateStoredTeam(record.awayTeam ?? null),
  } as BBApiBoxScore;
}

export function readStoredMatchBoxscoreDetails(
  value: unknown,
  sourceFallback = "MATCH_BOXSCORE_CACHE",
): MatchBoxscoreDetails | null {
  const parsed = parseLegacyJsonValue(value);
  const record = asRecord(parsed);
  if (!record) {
    return null;
  }

  if (isStoredMatchBoxscore(record)) {
    return record;
  }

  return toStoredMatchBoxscore({
    boxscore: record as BBApiBoxScore,
    source: sourceFallback,
  });
}

function serializeTeam(value: Record<string, unknown> | null): StoredMatchBoxscoreTeam | null {
  if (!value) {
    return null;
  }

  return {
    teamId: asOptionalString(value.id ?? value.teamId),
    teamName: asOptionalString(value.teamName),
    shortName: asOptionalString(value.shortName),
    offStrategy: asOptionalString(value.offStrategy),
    defStrategy: asOptionalString(value.defStrategy),
    score: asOptionalInteger(value.score),
    partialScores: toIntegerArray(value.partialScores),
    teamTotals: toMetricEntries(asRecord(value.teamTotals)),
    ratings: toRatings(value.ratings),
    efficiency: toMetricEntries(asRecord(value.efficiency)),
    players: toPlayerLines(value.players),
  };
}

function toPlayerLines(value: unknown): StoredMatchBoxscorePlayer[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((player) => {
      const minutesByPosition = toMetricEntries(asRecord(player.minutesByPosition));
      return {
        playerId: asOptionalString(player.id ?? player.playerId),
        firstName: asOptionalString(player.firstName),
        lastName: asOptionalString(player.lastName),
        fullName: asOptionalString(player.fullName) ?? "Unknown player",
        isStarter: asOptionalBoolean(player.isStarter) ?? false,
        minutes:
          asOptionalNumber(player.minutes) ??
          deriveMinutesFromPositions(minutesByPosition),
        performance: toMetricEntries(
          asRecord(player.performanceStats) ?? asRecord(player.performance),
        ),
        minutesByPosition,
      };
    });
}

function inflateStoredTeam(value: StoredMatchBoxscoreTeam | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  return {
    id: value.teamId ?? undefined,
    teamName: value.teamName ?? undefined,
    shortName: value.shortName ?? undefined,
    offStrategy: value.offStrategy ?? undefined,
    defStrategy: value.defStrategy ?? undefined,
    score: value.score ?? undefined,
    partialScores: value.partialScores ?? [],
    teamTotals: toMetricRecord(value.teamTotals),
    ratings: value.ratings ? { ...value.ratings } : {},
    efficiency: toMetricRecord(value.efficiency),
    gdp: {},
    players: value.players.map((player) => ({
      id: player.playerId ?? undefined,
      firstName: player.firstName ?? undefined,
      lastName: player.lastName ?? undefined,
      fullName: player.fullName,
      isStarter: player.isStarter,
      minutes: player.minutes ?? undefined,
      performanceStats: toMetricRecord(player.performance),
      minutesByPosition: toMetricRecord(player.minutesByPosition),
    })),
  };
}

function toMetricEntries(
  value: Record<string, unknown> | null,
): StoredMetricEntry[] {
  if (!value) {
    return [];
  }

  return Object.entries(value)
    .flatMap(([key, entry]) => {
      const numberValue = asOptionalNumber(entry);
      return numberValue === null
        ? []
        : [{
            key,
            numberValue,
          }];
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function deriveMinutesFromPositions(
  entries: readonly StoredMetricEntry[],
): number | null {
  if (entries.length === 0) {
    return null;
  }

  return entries.reduce((total, entry) => total + entry.numberValue, 0);
}

function toMetricRecord(
  entries: readonly StoredMetricEntry[],
): Record<string, number> {
  return Object.fromEntries(
    entries.map((entry) => [entry.key, entry.numberValue]),
  );
}

function toRatings(
  value: unknown,
): NonNullable<StoredMatchBoxscoreTeam["ratings"]> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    outsideScoring: asOptionalNumber(record.outsideScoring) ?? 0,
    insideScoring: asOptionalNumber(record.insideScoring) ?? 0,
    outsideDefense: asOptionalNumber(record.outsideDefense) ?? 0,
    insideDefense: asOptionalNumber(record.insideDefense) ?? 0,
    rebounding: asOptionalNumber(record.rebounding) ?? 0,
    offensiveFlow: asOptionalNumber(record.offensiveFlow) ?? 0,
  };
}

function toIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asOptionalInteger(entry))
    .filter((entry): entry is number => entry !== null);
}

function isStoredMatchBoxscore(value: Record<string, unknown>): value is StoredMatchBoxscore {
  return (
    typeof value.matchId === "string" &&
    typeof value.source === "string" &&
    ("homeTeam" in value || "awayTeam" in value)
  );
}

function normalizeSourceLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "WORKSPACE_CACHE";
}

function parseLegacyJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asOptionalInteger(value: unknown): number | null {
  const parsed = asOptionalNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }

  return null;
}
