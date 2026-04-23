import type {
  GameDayRecapCostPayload,
  GameDayRecapRecord,
  GameDayRecapCoveragePayload,
  GameDayRecapResultPayload,
  LeagueDateRecapHistoryRecord,
  LeagueGameDayPerformancesHistoryRecord,
  LeagueGameDayPerformancesRecord,
  LeagueGameDayPerformancesResultPayload,
  LeagueGameDayRecapHistoryRecord,
  LeagueGameDayRecapRecord,
  RecapHistoryKind,
  RecapHistoryRecord,
  SingleGameRecapHistoryRecord,
  SingleGameSummaryRecord,
} from "@/app/types";
import { RecapGenerationApproach } from "@/amplify/data/schema-enums";
import { safeJsonParse } from "@/lib/json-parsing";

export type RecapStreamState = {
  buffer: RecapHistoryRecord[];
  nextToken?: string | null;
};

export type RecapHistoryCursor = {
  gameDay: RecapStreamState;
  performances: RecapStreamState;
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
    performances: state.performances.buffer,
    leagueGameDay: state.leagueGameDay.buffer,
    singleGame: state.singleGame.buffer,
  };

  while (items.length < limit) {
    const candidates = [
      buffers.gameDay[0],
      buffers.performances[0],
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

    if (buffers.performances[0]?.selectionKey === nextItem.selectionKey) {
      buffers.performances.shift();
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
    state.performances,
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
      performances: normalizeRecapStreamState(parsed.performances),
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
    costJson: normalized.costJson ?? null,
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
    costJson: normalized.costJson ?? null,
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

export function adaptLeagueGameDayPerformances(
  record: LeagueGameDayPerformancesRecord,
): LeagueGameDayPerformancesHistoryRecord {
  const normalized = normalizeLeagueGameDayPerformancesRecord(record);
  return {
    completedAt: normalized.completedAt ?? null,
    coverageJson: normalized.coverageJson ?? null,
    costJson: null,
    error: normalized.error ?? null,
    gameDate: normalized.gameDate ?? null,
    gameDayNumber: normalized.gameDayNumber,
    kind: "LEAGUE_GAME_DAY_PERFORMANCES",
    leagueId: normalized.leagueId,
    leagueName: normalized.leagueName ?? null,
    matchId: null,
    requestJson: normalized.requestJson,
    requestedAt: normalized.requestedAt,
    resultJson: normalized.resultJson ?? null,
    season: normalized.season ?? null,
    selectionKey: toRecapSelectionKey(
      "LEAGUE_GAME_DAY_PERFORMANCES",
      normalized.targetKey,
    ),
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
    costJson: normalized.costJson ?? null,
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
    costJson: normalizeRecapCost(record.costJson),
    requestJson: {
      approach:
        readOptionalRecapGenerationApproach(
          readLegacyField(record.requestJson)?.approach,
        ) ?? RecapGenerationApproach.LEGACY,
      gameDate: normalizeDateString(readLegacyField(record.requestJson)?.gameDate) ?? record.gameDate,
      leagueId: asNonEmptyString(readLegacyField(record.requestJson)?.leagueId) ?? record.leagueId,
      mode: "FULL_SLATE",
      qualityTier: normalizeRecapQualityTier(
        readLegacyField(record.requestJson)?.qualityTier,
      ),
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
    costJson: normalizeRecapCost(record.costJson),
    requestJson: {
      approach:
        readOptionalRecapGenerationApproach(
          readLegacyField(record.requestJson)?.approach,
        ) ?? RecapGenerationApproach.LEGACY,
      gameDayNumber:
        asFiniteNumber(readLegacyField(record.requestJson)?.gameDayNumber) ??
        record.gameDayNumber,
      leagueId: asNonEmptyString(readLegacyField(record.requestJson)?.leagueId) ?? record.leagueId,
      mode: "LEAGUE_GAME_DAY",
      qualityTier: normalizeRecapQualityTier(
        readLegacyField(record.requestJson)?.qualityTier,
      ),
      season:
        asFiniteNumber(readLegacyField(record.requestJson)?.season) ??
        record.season ??
        null,
    },
    resultJson: normalizeRecapResult(record.resultJson),
  };
}

export function normalizeLeagueGameDayPerformancesRecord(
  record: LeagueGameDayPerformancesRecord,
): LeagueGameDayPerformancesRecord {
  return {
    ...record,
    coverageJson: normalizeRecapCoverage(record.coverageJson),
    requestJson: {
      gameDayNumber:
        asFiniteNumber(readLegacyField(record.requestJson)?.gameDayNumber) ??
        record.gameDayNumber,
      leagueId:
        asNonEmptyString(readLegacyField(record.requestJson)?.leagueId) ??
        record.leagueId,
      mode: "LEAGUE_GAME_DAY_PERFORMANCES",
      season:
        asFiniteNumber(readLegacyField(record.requestJson)?.season) ??
        record.season ??
        null,
    },
    resultJson: normalizeLeagueGameDayPerformancesResult(record.resultJson),
  };
}

export function normalizeSingleGameSummaryRecord(
  record: SingleGameSummaryRecord,
): SingleGameSummaryRecord {
  return {
    ...record,
    coverageJson: normalizeRecapCoverage(record.coverageJson),
    costJson: normalizeRecapCost(record.costJson),
    requestJson: {
      approach:
        readOptionalRecapGenerationApproach(
          readLegacyField(record.requestJson)?.approach,
        ) ?? RecapGenerationApproach.LEGACY,
      matchId:
        asNonEmptyString(readLegacyField(record.requestJson)?.matchId) ?? record.matchId,
      mode: "SINGLE_GAME",
      qualityTier: normalizeRecapQualityTier(
        readLegacyField(record.requestJson)?.qualityTier,
      ),
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

function normalizeRecapCost(
  value: unknown,
): GameDayRecapCostPayload | null {
  const record = readLegacyField(value);
  const currency = asNonEmptyString(record?.currency);
  const inputTokens = asFiniteNumber(record?.inputTokens);
  const outputTokens = asFiniteNumber(record?.outputTokens);
  const pricingStatus =
    record?.pricingStatus === "estimated" ||
    record?.pricingStatus === "partial" ||
    record?.pricingStatus === "unavailable"
      ? record.pricingStatus
      : null;
  const requestCount = asFiniteNumber(record?.requestCount);
  const totalTokens = asFiniteNumber(record?.totalTokens);
  const stages = Array.isArray(record?.stages)
    ? record.stages
        .flatMap((entry) => {
          const source = toRecord(entry);
          const stage = asNonEmptyString(source?.stage);
          const modelId = asNonEmptyString(source?.modelId);
          const providerName = asNonEmptyString(source?.providerName);
          const stageInputTokens = asFiniteNumber(source?.inputTokens);
          const stageOutputTokens = asFiniteNumber(source?.outputTokens);
          const stageRequestCount = asFiniteNumber(source?.requestCount);
          const stageTotalTokens = asFiniteNumber(source?.totalTokens);
          if (
            !stage ||
            !modelId ||
            !providerName ||
            stageInputTokens === null ||
            stageOutputTokens === null ||
            stageRequestCount === null ||
            stageTotalTokens === null
          ) {
            return [];
          }

          return [{
            cacheReadInputTokens: asFiniteNumber(source?.cacheReadInputTokens),
            cacheWriteInputTokens: asFiniteNumber(source?.cacheWriteInputTokens),
            estimatedCostUsd: asFiniteNumber(source?.estimatedCostUsd),
            inputTokens: stageInputTokens,
            modelId,
            outputTokens: stageOutputTokens,
            providerName,
            requestCount: stageRequestCount,
            stage,
            totalTokens: stageTotalTokens,
          }];
        })
    : [];

  if (
    !currency ||
    inputTokens === null ||
    outputTokens === null ||
    !pricingStatus ||
    requestCount === null ||
    totalTokens === null ||
    stages.length === 0
  ) {
    return null;
  }

  return {
    cacheReadInputTokens: asFiniteNumber(record?.cacheReadInputTokens),
    cacheWriteInputTokens: asFiniteNumber(record?.cacheWriteInputTokens),
    currency,
    estimatedPerGameCostUsd: asFiniteNumber(record?.estimatedPerGameCostUsd),
    estimatedTotalCostUsd: asFiniteNumber(record?.estimatedTotalCostUsd),
    generatedGameCount: asFiniteNumber(record?.generatedGameCount),
    inputTokens,
    outputTokens,
    pricingStatus,
    requestCount,
    stages,
    totalTokens,
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
          const postgameInterview = normalizeRecapPostgameInterview(
            source?.postgameInterview,
          );
          const writeup = asNonEmptyString(source?.writeup);
          if (!headline || !matchId || !writeup) {
            return [];
          }

          return [{
            evidenceTags: toStringArray(source?.evidenceTags),
            headline,
            matchId,
            ...(postgameInterview ? { postgameInterview } : {}),
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

function normalizeRecapPostgameInterview(
  value: unknown,
): NonNullable<
  GameDayRecapResultPayload["games"][number]["postgameInterview"]
> | null {
  const record = toRecord(readLegacyField(value));
  const playerName = asNonEmptyString(record?.playerName);
  const teamName = asNonEmptyString(record?.teamName);
  const teamSide = record?.teamSide === "away" || record?.teamSide === "home"
    ? record.teamSide
    : null;
  const title = asNonEmptyString(record?.title);
  const qa = Array.isArray(record?.qa)
    ? record.qa
        .flatMap((entry) => {
          const exchange = toRecord(entry);
          const question = asNonEmptyString(exchange?.question);
          const answer = asNonEmptyString(exchange?.answer);
          return question && answer
            ? [
                {
                  answer,
                  question,
                },
              ]
            : [];
        })
        .slice(0, 2)
    : [];

  if (!playerName || !teamName || !teamSide || !title || qa.length === 0) {
    return null;
  }

  return {
    playerName,
    qa,
    teamName,
    teamSide,
    title,
  };
}

function normalizeLeagueGameDayPerformancesResult(
  value: unknown,
): LeagueGameDayPerformancesResultPayload | null {
  const record = readLegacyField(value);
  const gameDayNumber = asFiniteNumber(record?.gameDayNumber);
  const leagueId = asNonEmptyString(record?.leagueId);
  const games = Array.isArray(record?.games)
    ? record.games
        .map((entry) => normalizeLeagueGameDayPerformancesGame(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["games"][number] =>
            Boolean(entry),
        )
    : [];
  const playerLeaders = Array.isArray(record?.playerLeaders)
    ? record.playerLeaders
        .map((entry) => normalizeLeagueGameDayPerformancesPlayerLeaderboard(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["playerLeaders"][number] =>
            Boolean(entry),
        )
    : [];
  const statCallouts = Array.isArray(record?.statCallouts)
    ? record.statCallouts
        .map((entry) => normalizeLeagueGameDayPerformancesPlayerLeaderboard(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["statCallouts"][number] =>
            Boolean(entry),
        )
    : [];
  const teamLeaders = Array.isArray(record?.teamLeaders)
    ? record.teamLeaders
        .map((entry) => normalizeLeagueGameDayPerformancesTeamLeaderboard(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["teamLeaders"][number] =>
            Boolean(entry),
        )
    : [];
  const topFive = Array.isArray(record?.topFive)
    ? record.topFive
        .map((entry) => normalizeLeagueGameDayPerformancesPositionLeaderboard(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["topFive"][number] =>
            Boolean(entry),
        )
    : [];
  const mvp = normalizeLeagueGameDayPerformancesPlayerLeaderboard(record?.mvp);
  const badPerformance = normalizeLeagueGameDayPerformancesPlayerLeaderboard(
    record?.badPerformance,
  );
  const tripleDoubles = Array.isArray(record?.tripleDoubles)
    ? record.tripleDoubles
        .map((entry) => normalizeLeagueGameDayPerformancesPlayerEntry(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["tripleDoubles"][number] =>
            Boolean(entry),
        )
    : [];

  if (
    gameDayNumber === null ||
    !leagueId ||
    games.length === 0 ||
    !mvp ||
    !badPerformance
  ) {
    return null;
  }

  return {
    badPerformance,
    gameDate: normalizeDateString(record?.gameDate),
    gameDayNumber,
    games,
    leagueId,
    leagueName: asNonEmptyString(record?.leagueName),
    mvp,
    playerLeaders,
    season: asFiniteNumber(record?.season),
    statCallouts,
    teamLeaders,
    topFive,
    tripleDoubles,
  };
}

function normalizeLeagueGameDayPerformancesGame(
  value: unknown,
): LeagueGameDayPerformancesResultPayload["games"][number] | null {
  const record = toRecord(value);
  const awayScore = asFiniteNumber(record?.awayScore);
  const awayTeamName = asNonEmptyString(record?.awayTeamName);
  const homeScore = asFiniteNumber(record?.homeScore);
  const homeTeamName = asNonEmptyString(record?.homeTeamName);
  const matchId = asNonEmptyString(record?.matchId);
  if (
    awayScore === null ||
    !awayTeamName ||
    homeScore === null ||
    !homeTeamName ||
    !matchId
  ) {
    return null;
  }

  return {
    awayScore,
    awayTeamName,
    homeScore,
    homeTeamName,
    matchId,
  };
}

function normalizeLeagueGameDayPerformancesPlayerEntry(
  value: unknown,
): LeagueGameDayPerformancesResultPayload["tripleDoubles"][number] | null {
  const record = toRecord(value);
  const efficiency = asFiniteNumber(record?.efficiency);
  const minutes = asFiniteNumber(record?.minutes);
  const personalFouls = asFiniteNumber(record?.personalFouls);
  const playerName = asNonEmptyString(record?.playerName);
  const position = asNonEmptyString(record?.position);
  const statLine = toRecord(record?.statLine);
  const assists = asFiniteNumber(statLine?.assists);
  const blocks = asFiniteNumber(statLine?.blocks);
  const points = asFiniteNumber(statLine?.points);
  const rebounds = asFiniteNumber(statLine?.rebounds);
  const steals = asFiniteNumber(statLine?.steals);
  const teamName = asNonEmptyString(record?.teamName);
  const turnovers = asFiniteNumber(record?.turnovers);
  if (
    efficiency === null ||
    minutes === null ||
    personalFouls === null ||
    !playerName ||
    !position ||
    assists === null ||
    blocks === null ||
    points === null ||
    rebounds === null ||
    steals === null ||
    !teamName ||
    turnovers === null
  ) {
    return null;
  }

  return {
    efficiency,
    minutes,
    personalFouls,
    playerId: asNonEmptyString(record?.playerId),
    playerName,
    position,
    rating: asFiniteNumber(record?.rating),
    statLine: {
      assists,
      blocks,
      points,
      rebounds,
      steals,
    },
    teamId: asNonEmptyString(record?.teamId),
    teamName,
    turnovers,
  };
}

function normalizeLeagueGameDayPerformancesPlayerLeaderboard(
  value: unknown,
): LeagueGameDayPerformancesResultPayload["playerLeaders"][number] | null {
  const record = toRecord(value);
  const key = asNonEmptyString(record?.key);
  const label = asNonEmptyString(record?.label);
  const leaders = Array.isArray(record?.leaders)
    ? record.leaders
        .map((entry) => normalizeLeagueGameDayPerformancesPlayerEntry(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["playerLeaders"][number]["leaders"][number] =>
            Boolean(entry),
        )
    : [];
  const valueNumber = asFiniteNumber(record?.value);
  if (!key || !label || valueNumber === null) {
    return null;
  }

  return {
    key,
    label,
    leaders,
    unit: asNonEmptyString(record?.unit),
    value: valueNumber,
  };
}

function normalizeLeagueGameDayPerformancesTeamLeaderboard(
  value: unknown,
): LeagueGameDayPerformancesResultPayload["teamLeaders"][number] | null {
  const record = toRecord(value);
  const key = asNonEmptyString(record?.key);
  const label = asNonEmptyString(record?.label);
  const leaders = Array.isArray(record?.leaders)
    ? record.leaders
        .map((entry) => {
          const source = toRecord(entry);
          const teamName = asNonEmptyString(source?.teamName);
          if (!teamName) {
            return null;
          }

          return {
            teamId: asNonEmptyString(source?.teamId),
            teamName,
          };
        })
        .filter(Boolean) as LeagueGameDayPerformancesResultPayload["teamLeaders"][number]["leaders"]
    : [];
  const valueNumber = asFiniteNumber(record?.value);
  if (!key || !label || valueNumber === null) {
    return null;
  }

  return {
    key,
    label,
    leaders,
    unit: asNonEmptyString(record?.unit),
    value: valueNumber,
  };
}

function normalizeLeagueGameDayPerformancesPositionLeaderboard(
  value: unknown,
): LeagueGameDayPerformancesResultPayload["topFive"][number] | null {
  const record = toRecord(value);
  const key = asNonEmptyString(record?.key);
  const label = asNonEmptyString(record?.label);
  const position = asNonEmptyString(record?.position);
  const leaders = Array.isArray(record?.leaders)
    ? record.leaders
        .map((entry) => normalizeLeagueGameDayPerformancesPlayerEntry(entry))
        .filter(
          (
            entry,
          ): entry is LeagueGameDayPerformancesResultPayload["topFive"][number]["leaders"][number] =>
            Boolean(entry),
        )
    : [];
  const valueNumber = asFiniteNumber(record?.value);
  if (!key || !label || !position || valueNumber === null) {
    return null;
  }

  return {
    key,
    label,
    leaders,
    position,
    value: valueNumber,
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

function readOptionalRecapGenerationApproach(
  value: unknown,
): RecapGenerationApproach | null {
  return value === RecapGenerationApproach.FACT_LIBRARY_FIRST ||
    value === RecapGenerationApproach.LEGACY
    ? value
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeRecapQualityTier(value: unknown): "standard" | "premium" {
  return value === "premium" ? "premium" : "standard";
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
