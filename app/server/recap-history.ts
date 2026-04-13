import type {
  GameDayRecapRecord,
  GameDayRecapCoveragePayload,
  GameDayRecapResultPayload,
  LeagueDateRecapHistoryRecord,
  LeagueGameDayRecapHistoryRecord,
  LeagueGameDayRecapRecord,
  RecapHistoryKind,
  RecapHistoryRecord,
  SingleGameRecapHistoryRecord,
  SingleGameSummaryRecord,
} from "@/app/types";
import { safeJsonParse } from "@/lib/json-parsing";

export type RecapStreamState = {
  buffer: RecapHistoryRecord[];
  nextToken?: string | null;
};

export type RecapHistoryCursor = {
  gameDay: RecapStreamState;
  leagueGameDay: RecapStreamState;
  singleGame: RecapStreamState;
};

export function mergeRecapHistoryStreams(
  state: RecapHistoryCursor,
  limit: number,
): RecapHistoryRecord[] {
  const items: RecapHistoryRecord[] = [];
  const buffers = {
    gameDay: state.gameDay.buffer,
    leagueGameDay: state.leagueGameDay.buffer,
    singleGame: state.singleGame.buffer,
  };

  while (items.length < limit) {
    const candidates = [
      buffers.gameDay[0],
      buffers.leagueGameDay[0],
      buffers.singleGame[0],
    ].filter((value): value is RecapHistoryRecord => Boolean(value));

    if (!candidates.length) {
      break;
    }

    const nextItem = [...candidates].sort(compareRecapHistoryRecord)[0];
    if (!nextItem) {
      break;
    }
    items.push(nextItem);

    if (buffers.gameDay[0]?.selectionKey === nextItem.selectionKey) {
      buffers.gameDay.shift();
      continue;
    }

    if (buffers.leagueGameDay[0]?.selectionKey === nextItem.selectionKey) {
      buffers.leagueGameDay.shift();
      continue;
    }

    buffers.singleGame.shift();
  }

  return items;
}

export function hasMoreRecapHistory(state: RecapHistoryCursor): boolean {
  return [
    state.gameDay,
    state.leagueGameDay,
    state.singleGame,
  ].some((stream) => stream.buffer.length || stream.nextToken !== null);
}

export function encodeRecapHistoryToken(state: RecapHistoryCursor): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

export function decodeRecapHistoryToken(
  value: string | null,
): RecapHistoryCursor | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<RecapHistoryCursor>;
    if (typeof parsed !== "object") {
      return null;
    }

    return {
      gameDay: normalizeRecapStreamState(parsed.gameDay),
      leagueGameDay: normalizeRecapStreamState(parsed.leagueGameDay),
      singleGame: normalizeRecapStreamState(parsed.singleGame),
    };
  } catch {
    return null;
  }
}

export function normalizeRecapStreamState(
  value: Partial<RecapStreamState> | undefined,
): RecapStreamState {
  const nextToken = value?.nextToken;
  return {
    buffer: Array.isArray(value?.buffer)
      ? value.buffer.filter(isRecapHistoryRecord)
      : [],
    nextToken: nextToken == null ? nextToken : String(nextToken),
  };
}

export function isRecapHistoryRecord(
  value: unknown,
): value is RecapHistoryRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as RecapHistoryRecord).selectionKey === "string" &&
      typeof (value as RecapHistoryRecord).requestedAt === "string" &&
      typeof (value as RecapHistoryRecord).updatedAt === "string",
  );
}

export function compareRecapHistoryRecord(
  left: RecapHistoryRecord,
  right: RecapHistoryRecord,
): number {
  const byRequestedAt = right.requestedAt.localeCompare(left.requestedAt);
  if (byRequestedAt !== 0) {
    return byRequestedAt;
  }

  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  if (byUpdatedAt !== 0) {
    return byUpdatedAt;
  }

  return left.selectionKey.localeCompare(right.selectionKey);
}

export function adaptLeagueDateRecap(
  record: GameDayRecapRecord,
): LeagueDateRecapHistoryRecord {
  const normalized = normalizeGameDayRecapRecord(record);
  return {
    completedAt: normalized.completedAt ?? null,
    coverageJson: normalized.coverageJson ?? null,
    error: normalized.error ?? null,
    gameDate: normalized.gameDate,
    gameDayNumber: null,
    kind: "LEAGUE_DATE",
    leagueId: normalized.leagueId,
    leagueName: normalized.leagueName ?? null,
    matchId: null,
    requestJson: normalized.requestJson,
    requestedAt: normalized.requestedAt,
    resultJson: normalized.resultJson ?? null,
    season: normalized.season ?? null,
    selectionKey: toRecapSelectionKey("LEAGUE_DATE", normalized.targetKey),
    status: normalized.status,
    targetKey: normalized.targetKey,
    updatedAt: normalized.updatedAt,
  };
}

export function adaptLeagueGameDayRecap(
  record: LeagueGameDayRecapRecord,
): LeagueGameDayRecapHistoryRecord {
  const normalized = normalizeLeagueGameDayRecapRecord(record);
  return {
    completedAt: normalized.completedAt ?? null,
    coverageJson: normalized.coverageJson ?? null,
    error: normalized.error ?? null,
    gameDate: null,
    gameDayNumber: normalized.gameDayNumber,
    kind: "LEAGUE_GAME_DAY",
    leagueId: normalized.leagueId,
    leagueName: normalized.leagueName ?? null,
    matchId: null,
    requestJson: normalized.requestJson,
    requestedAt: normalized.requestedAt,
    resultJson: normalized.resultJson ?? null,
    season: normalized.season ?? null,
    selectionKey: toRecapSelectionKey("LEAGUE_GAME_DAY", normalized.targetKey),
    status: normalized.status,
    targetKey: normalized.targetKey,
    updatedAt: normalized.updatedAt,
  };
}

export function adaptSingleGameSummary(
  record: SingleGameSummaryRecord,
): SingleGameRecapHistoryRecord {
  const normalized = normalizeSingleGameSummaryRecord(record);
  return {
    completedAt: normalized.completedAt ?? null,
    coverageJson: normalized.coverageJson ?? null,
    error: normalized.error ?? null,
    gameDate: normalized.gameDate ?? null,
    gameDayNumber: null,
    kind: "SINGLE_GAME",
    leagueId: normalized.leagueId ?? null,
    leagueName: normalized.leagueName ?? null,
    matchId: normalized.matchId,
    requestJson: normalized.requestJson,
    requestedAt: normalized.requestedAt,
    resultJson: normalized.resultJson ?? null,
    season: normalized.season ?? null,
    selectionKey: toRecapSelectionKey("SINGLE_GAME", normalized.targetKey),
    status: normalized.status,
    targetKey: normalized.targetKey,
    updatedAt: normalized.updatedAt,
  };
}

export function normalizeGameDayRecapRecord(
  record: GameDayRecapRecord,
): GameDayRecapRecord {
  return {
    ...record,
    coverageJson: normalizeRecapCoverage(record.coverageJson),
    requestJson: {
      gameDate: normalizeDateString(readLegacyField(record.requestJson)?.gameDate) ?? record.gameDate,
      leagueId: asNonEmptyString(readLegacyField(record.requestJson)?.leagueId) ?? record.leagueId,
      mode: "FULL_SLATE",
    },
    resultJson: normalizeRecapResult(record.resultJson),
  };
}

export function normalizeLeagueGameDayRecapRecord(
  record: LeagueGameDayRecapRecord,
): LeagueGameDayRecapRecord {
  return {
    ...record,
    coverageJson: normalizeRecapCoverage(record.coverageJson),
    requestJson: {
      gameDayNumber:
        asFiniteNumber(readLegacyField(record.requestJson)?.gameDayNumber) ??
        record.gameDayNumber,
      leagueId: asNonEmptyString(readLegacyField(record.requestJson)?.leagueId) ?? record.leagueId,
      mode: "LEAGUE_GAME_DAY",
      season:
        asFiniteNumber(readLegacyField(record.requestJson)?.season) ??
        record.season ??
        null,
    },
    resultJson: normalizeRecapResult(record.resultJson),
  };
}

export function normalizeSingleGameSummaryRecord(
  record: SingleGameSummaryRecord,
): SingleGameSummaryRecord {
  return {
    ...record,
    coverageJson: normalizeRecapCoverage(record.coverageJson),
    requestJson: {
      matchId:
        asNonEmptyString(readLegacyField(record.requestJson)?.matchId) ?? record.matchId,
      mode: "SINGLE_GAME",
    },
    resultJson: normalizeRecapResult(record.resultJson),
  };
}

export function toRecapSelectionKey(
  kind: RecapHistoryKind,
  targetKey: string,
): string {
  return `${kind}:${targetKey}`;
}

function normalizeRecapCoverage(
  value: unknown,
): GameDayRecapCoveragePayload | null {
  const record = readLegacyField(value);
  if (!record) {
    return null;
  }

  const availableGames = asFiniteNumber(record.availableGames);
  const partial = asBoolean(record.partial);
  const requestedGames = asFiniteNumber(record.requestedGames);
  const missingGames = Array.isArray(record.missingGames)
    ? record.missingGames
        .map((entry) => {
          const source = toRecord(entry);
          const awayTeamName = asNonEmptyString(source?.awayTeamName);
          const homeTeamName = asNonEmptyString(source?.homeTeamName);
          const matchId = asNonEmptyString(source?.matchId);
          const reason = asNonEmptyString(source?.reason);
          if (!awayTeamName || !homeTeamName || !matchId || !reason) {
            return null;
          }

          return {
            awayTeamName,
            homeTeamName,
            matchId,
            reason,
          };
        })
        .filter(
          (
            entry,
          ): entry is GameDayRecapCoveragePayload["missingGames"][number] =>
            Boolean(entry),
        )
    : [];

  if (
    availableGames === null ||
    partial === null ||
    requestedGames === null
  ) {
    return null;
  }

  return {
    availableGames,
    missingGames,
    partial,
    requestedGames,
  };
}

function normalizeRecapResult(
  value: unknown,
): GameDayRecapResultPayload | null {
  const record = readLegacyField(value);
  const summary = toRecord(record?.summary);
  const games = Array.isArray(record?.games)
    ? record.games
        .flatMap((entry) => {
          const source = toRecord(entry);
          const headline = asNonEmptyString(source?.headline);
          const matchId = asNonEmptyString(source?.matchId);
          const writeup = asNonEmptyString(source?.writeup);
          if (!headline || !matchId || !writeup) {
            return [];
          }

          return [{
            evidenceTags: toStringArray(source?.evidenceTags),
            headline,
            matchId,
            surpriseFactor: asFiniteNumber(source?.surpriseFactor),
            writeup,
          }];
        })
    : [];

  const headline = asNonEmptyString(summary?.headline);
  const lede = asNonEmptyString(summary?.lede);
  if (!summary || !headline || !lede || games.length === 0) {
    return null;
  }

  return {
    games,
    summary: {
      gameOfTheDayMatchId: asNonEmptyString(summary.gameOfTheDayMatchId),
      gameOfTheDaySurpriseFactor: asFiniteNumber(summary.gameOfTheDaySurpriseFactor),
      headline,
      lede,
    },
  };
}

function readLegacyField(value: unknown): Record<string, unknown> | null {
  const raw =
    typeof value === "string"
      ? safeJsonParse(value)
      : value;
  return toRecord(raw);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeDateString(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
