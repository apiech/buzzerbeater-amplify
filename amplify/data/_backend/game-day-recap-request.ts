type JsonRecord = Record<string, unknown>;

export type GameDayRecapSubmissionRequest = {
  gameDate: string;
  leagueId: string;
};

export type LeagueGameDayRecapSubmissionRequest = {
  gameDayNumber: number;
  leagueId: string;
  season: number | null;
};

export type SingleGameSummarySubmissionRequest = {
  matchId: string;
};

export type RecapJobKind = "LEAGUE_DATE" | "LEAGUE_GAME_DAY" | "SINGLE_GAME";

export type RecapQueueMessage = {
  kind: RecapJobKind;
  modelId?: string;
  requestedAt: string;
  targetKey: string;
  userId: string;
};

export function normalizeGameDayRecapRequest(
  input: unknown,
): GameDayRecapSubmissionRequest {
  const record = requireRecord(input, "Game day recap request");
  const leagueId = asOptionalString(record.leagueId)?.trim();
  const gameDate = asOptionalString(record.gameDate)?.trim();

  if (!leagueId) {
    throw new Error("Game day recap requests require a leagueId.");
  }
  if (!gameDate || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
    throw new Error("Game day recap requests require a YYYY-MM-DD gameDate.");
  }
  if (!Number.isFinite(Date.parse(`${gameDate}T00:00:00Z`))) {
    throw new Error("Game day recap gameDate must be a valid calendar date.");
  }

  return {
    gameDate,
    leagueId,
  };
}

export function normalizeLeagueGameDayRecapRequest(
  input: unknown,
): LeagueGameDayRecapSubmissionRequest {
  const record = requireRecord(input, "League game day recap request");
  const leagueId = asOptionalString(record.leagueId)?.trim();
  const gameDayNumber = asOptionalNumber(record.gameDayNumber);
  const season = asOptionalNumber(record.season);

  if (!leagueId) {
    throw new Error("League game day recaps require a leagueId.");
  }
  if (
    gameDayNumber === null ||
    !Number.isInteger(gameDayNumber) ||
    gameDayNumber < 1 ||
    gameDayNumber > 22
  ) {
    throw new Error(
      "League game day recaps require a gameDayNumber from 1 to 22.",
    );
  }
  if (season !== null && (!Number.isInteger(season) || season < 1)) {
    throw new Error("League game day recap season must be a positive integer.");
  }

  return {
    gameDayNumber,
    leagueId,
    season,
  };
}

export function normalizeSingleGameSummaryRequest(
  input: unknown,
): SingleGameSummarySubmissionRequest {
  const record = requireRecord(input, "Single game summary request");
  const matchId = asOptionalString(record.matchId)?.trim();
  if (!matchId || !/^\d+$/.test(matchId)) {
    throw new Error("Single game summaries require a numeric matchId.");
  }

  return { matchId };
}

export function buildGameDayRecapTargetKey(
  leagueId: string,
  gameDate: string,
): string {
  return `${leagueId}#${gameDate}`;
}

export function buildLeagueGameDayRecapTargetKey(
  leagueId: string,
  gameDayNumber: number,
  season: number | null,
): string {
  return `${leagueId}#${season ?? "current"}#gameday-${gameDayNumber}`;
}

export function buildSingleGameSummaryTargetKey(matchId: string): string {
  return matchId;
}

export function parseGameDayRecapQueueMessage(
  messageBody: string,
): RecapQueueMessage {
  const payload = requireRecord(
    JSON.parse(messageBody),
    "Game day recap queue message",
  );
  const rawKind = asOptionalString(payload.kind)?.trim();
  const modelId = asOptionalString(payload.modelId)?.trim();
  const userId = asOptionalString(payload.userId)?.trim();
  const targetKey = asOptionalString(payload.targetKey)?.trim();
  const requestedAt = asOptionalString(payload.requestedAt)?.trim();
  const kind = rawKind ?? "LEAGUE_DATE";

  if (
    !userId ||
    !targetKey ||
    !requestedAt ||
    (kind !== "LEAGUE_DATE" &&
      kind !== "LEAGUE_GAME_DAY" &&
      kind !== "SINGLE_GAME")
  ) {
    throw new Error(
      "Game day recap queue message must include kind, userId, targetKey, and requestedAt.",
    );
  }

  return {
    kind,
    ...(modelId ? { modelId } : {}),
    requestedAt,
    targetKey,
    userId,
  };
}

function requireRecord(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }

  return value as JsonRecord;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
