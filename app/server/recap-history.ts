import type {
  GameDayRecapRecord,
  LeagueGameDayRecapRecord,
  RecapHistoryKind,
  RecapHistoryRecord,
  SingleGameSummaryRecord,
} from "@/app/types";

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
): RecapHistoryRecord {
  return {
    completedAt: record.completedAt ?? null,
    coverageJson: record.coverageJson,
    error: record.error ?? null,
    gameDate: record.gameDate,
    gameDayNumber: null,
    kind: "LEAGUE_DATE",
    leagueId: record.leagueId,
    leagueName: record.leagueName ?? null,
    matchId: null,
    requestJson: record.requestJson,
    requestedAt: record.requestedAt,
    resultJson: record.resultJson,
    season: record.season ?? null,
    selectionKey: toRecapSelectionKey("LEAGUE_DATE", record.targetKey),
    status: record.status,
    targetKey: record.targetKey,
    updatedAt: record.updatedAt,
  };
}

export function adaptLeagueGameDayRecap(
  record: LeagueGameDayRecapRecord,
): RecapHistoryRecord {
  return {
    completedAt: record.completedAt ?? null,
    coverageJson: record.coverageJson,
    error: record.error ?? null,
    gameDate: null,
    gameDayNumber: record.gameDayNumber,
    kind: "LEAGUE_GAME_DAY",
    leagueId: record.leagueId,
    leagueName: record.leagueName ?? null,
    matchId: null,
    requestJson: record.requestJson,
    requestedAt: record.requestedAt,
    resultJson: record.resultJson,
    season: record.season ?? null,
    selectionKey: toRecapSelectionKey("LEAGUE_GAME_DAY", record.targetKey),
    status: record.status,
    targetKey: record.targetKey,
    updatedAt: record.updatedAt,
  };
}

export function adaptSingleGameSummary(
  record: SingleGameSummaryRecord,
): RecapHistoryRecord {
  return {
    completedAt: record.completedAt ?? null,
    coverageJson: record.coverageJson,
    error: record.error ?? null,
    gameDate: record.gameDate ?? null,
    gameDayNumber: null,
    kind: "SINGLE_GAME",
    leagueId: record.leagueId ?? null,
    leagueName: record.leagueName ?? null,
    matchId: record.matchId,
    requestJson: record.requestJson,
    requestedAt: record.requestedAt,
    resultJson: record.resultJson,
    season: record.season ?? null,
    selectionKey: toRecapSelectionKey("SINGLE_GAME", record.targetKey),
    status: record.status,
    targetKey: record.targetKey,
    updatedAt: record.updatedAt,
  };
}

export function toRecapSelectionKey(
  kind: RecapHistoryKind,
  targetKey: string,
): string {
  return `${kind}:${targetKey}`;
}
