import { getServerDataClient } from "@/app/server/amplify-server";
import type {
  CurrentPredictionForecastContext,
  CurrentPredictionPreview,
  GameDayRecapRecord,
  LeagueGameDayRecapRecord,
  OperationsActivity,
  PaginatedResult,
  PredictionGridCell,
  RecapHistoryKind,
  RecapHistoryRecord,
  SingleGameSummaryRecord,
} from "@/app/types";
import { currentPredictionPreviewSchema } from "@/lib/prediction/contracts";
import {
  PREDICTION_AWAY_DEFENSE_OPTIONS,
  PREDICTION_HOME_OFFENSE_OPTIONS,
} from "@/lib/prediction/normalization";

type ErrorPayload = {
  message?: string;
};

type OperationResult<TData> = {
  data?: TData | null;
  errors?: ReadonlyArray<ErrorPayload> | null;
  nextToken?: string | null;
};

type ReadOperation = (
  userId: string,
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown>>;

type PredictionPreviewDataClient = {
  models: {
    PredictionGridCell: {
      listPredictionGridCellsByUserIdAndRequestId: (
        input: {
          requestId: { eq: string };
          userId: string;
        },
        options?: {
          limit?: number;
          nextToken?: string | null;
          sortDirection?: "ASC" | "DESC";
        },
      ) => Promise<
        OperationResult<
          Array<{
            awayDefense: string;
            awayScore?: number | null;
            homeOffense: string;
            homeScore?: number | null;
            pointDiff?: number | null;
          }>
        >
      >;
    };
    PredictionJob: {
      get: (
        input: { userId: string },
      ) => Promise<
        OperationResult<{
          awayScore?: number | null;
          error?: string | null;
          executionArn?: string | null;
          forecastEnthusiasmBand?: string | null;
          forecastGeneratedAt?: string | null;
          forecastJobId?: string | null;
          forecastModelVersion?: string | null;
          forecastScenarioId?: string | null;
          forecastScenarioLabel?: string | null;
          forecastScenarioProbability?: number | null;
          forecastSourceTeamId?: string | null;
          homeScore?: number | null;
          modelVersion?: string | null;
          pointDiff?: number | null;
          requestId: string;
          requestedAt: string;
          status: CurrentPredictionPreview["status"];
          updatedAt: string;
          userId: string;
        }>
      >;
    };
  };
};

type ReadName = keyof typeof readOperations;

type RecapHistoryCursor = {
  gameDay: RecapStreamState;
  leagueGameDay: RecapStreamState;
  singleGame: RecapStreamState;
};

type RecapStreamState = {
  buffer: RecapHistoryRecord[];
  nextToken?: string | null;
};

class ReadOperationError extends Error {
  readonly errors: ReadonlyArray<ErrorPayload>;

  constructor(errors: ReadonlyArray<ErrorPayload>) {
    super(
      errors
        .map((error) => error.message?.trim())
        .filter((message): message is string => Boolean(message))
        .join(" ") || "The read operation failed.",
    );
    this.errors = errors;
  }
}

const runtime = {
  getServerDataClient,
};

export const __testing = {
  decodeRecapHistoryToken,
  encodeRecapHistoryToken,
  hasMoreRecapHistory,
  mergeRecapHistoryStreams,
  runtime,
  toRecapSelectionKey,
};

const readOperations = {
  getCurrentBbConnection: (userId) => getCurrentBbConnection(userId),
  getCurrentPrediction: (userId) => getCurrentPrediction(userId),
  getOperationsActivity: (userId, input) => getOperationsActivity(userId, input),
  getRecapHistory: (userId, input) => getRecapHistory(userId, input),
} satisfies Record<string, ReadOperation>;

export function isReadName(value: string): value is ReadName {
  return value in readOperations;
}

export async function runReadOperation(
  name: ReadName,
  userId: string,
  input?: Record<string, unknown>,
): Promise<OperationResult<unknown>> {
  return readOperations[name](userId, input);
}

async function getCurrentBbConnection(
  userId: string,
): Promise<OperationResult<unknown>> {
  const serverDataClient = await runtime.getServerDataClient();
  const result = await serverDataClient.models.BbConnection.get({ userId });
  return {
    data: result.data ?? null,
    errors: result.errors,
  };
}

async function getOperationsActivity(
  userId: string,
  input?: Record<string, unknown>,
): Promise<OperationResult<OperationsActivity>> {
  const limit = readLimit(input, 8);
  const serverDataClient = await runtime.getServerDataClient();
  const [
    syncRuns,
    currentPrediction,
    gameDayRecaps,
    leagueGameDayRecaps,
    singleGameSummaries,
  ] = await Promise.all([
    serverDataClient.models.SyncRun.listSyncRunsByUserAndStartedAt(
      { userId },
      { limit, sortDirection: "DESC" },
    ),
    loadCurrentPredictionPreview(serverDataClient, userId),
    serverDataClient.models.GameDayRecap.listGameDayRecapsByUserAndRequestedAt(
      { userId },
      { limit, sortDirection: "DESC" },
    ),
    serverDataClient.models.LeagueGameDayRecap.listLeagueGameDayRecapsByUserAndRequestedAt(
      { userId },
      { limit, sortDirection: "DESC" },
    ),
    serverDataClient.models.SingleGameSummary.listSingleGameSummariesByUserAndRequestedAt(
      { userId },
      { limit, sortDirection: "DESC" },
    ),
  ]);

  const errors = collectErrors(
    syncRuns,
    currentPrediction,
    gameDayRecaps,
    leagueGameDayRecaps,
    singleGameSummaries,
  );
  if (errors.length) {
    return {
      data: null,
      errors,
    };
  }

  return {
    data: {
      gameDayRecaps: toArray(gameDayRecaps.data),
      currentPrediction: currentPrediction.data ?? null,
      leagueGameDayRecaps: toArray(leagueGameDayRecaps.data),
      singleGameSummaries: toArray(singleGameSummaries.data),
      syncRuns: toArray(syncRuns.data),
    },
  };
}

async function getCurrentPrediction(
  userId: string,
): Promise<OperationResult<CurrentPredictionPreview | null>> {
  const serverDataClient = await runtime.getServerDataClient();
  return loadCurrentPredictionPreview(serverDataClient, userId);
}

async function getRecapHistory(
  userId: string,
  input?: Record<string, unknown>,
): Promise<OperationResult<PaginatedResult<RecapHistoryRecord>>> {
  const limit = readLimit(input, 8);
  const cursor = decodeRecapHistoryToken(readToken(input));
  const serverDataClient = await runtime.getServerDataClient();
  const state: RecapHistoryCursor = cursor ?? {
    gameDay: { buffer: [], nextToken: undefined },
    leagueGameDay: { buffer: [], nextToken: undefined },
    singleGame: { buffer: [], nextToken: undefined },
  };

  try {
    await Promise.all([
      fillRecapHistoryBuffer(state.gameDay, limit, async (nextToken) => {
        const result =
          await serverDataClient.models.GameDayRecap.listGameDayRecapsByUserAndRequestedAt(
            { userId },
            {
              limit,
              nextToken,
              sortDirection: "DESC",
            },
          );
        return {
          nextToken: result.nextToken ?? null,
          items: toArray(result.data).map(adaptLeagueDateRecap),
          errors: result.errors,
        };
      }),
      fillRecapHistoryBuffer(state.leagueGameDay, limit, async (nextToken) => {
        const result =
          await serverDataClient.models.LeagueGameDayRecap.listLeagueGameDayRecapsByUserAndRequestedAt(
            { userId },
            {
              limit,
              nextToken,
              sortDirection: "DESC",
            },
          );
        return {
          nextToken: result.nextToken ?? null,
          items: toArray(result.data).map(adaptLeagueGameDayRecap),
          errors: result.errors,
        };
      }),
      fillRecapHistoryBuffer(state.singleGame, limit, async (nextToken) => {
        const result =
          await serverDataClient.models.SingleGameSummary.listSingleGameSummariesByUserAndRequestedAt(
            { userId },
            {
              limit,
              nextToken,
              sortDirection: "DESC",
            },
          );
        return {
          nextToken: result.nextToken ?? null,
          items: toArray(result.data).map(adaptSingleGameSummary),
          errors: result.errors,
        };
      }),
    ]);
  } catch (error) {
    return {
      data: null,
      errors:
        error instanceof ReadOperationError
          ? error.errors
          : [{ message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const items = mergeRecapHistoryStreams(state, limit);
  return {
    data: {
      items,
      nextToken: hasMoreRecapHistory(state)
        ? encodeRecapHistoryToken(state)
        : null,
    },
  };
}

function collectErrors(
  ...results: Array<OperationResult<unknown>>
): ErrorPayload[] {
  return results.flatMap((result) => result.errors ?? []);
}

async function loadCurrentPredictionPreview(
  serverDataClient: PredictionPreviewDataClient,
  userId: string,
): Promise<OperationResult<CurrentPredictionPreview | null>> {
  const predictionJob = await serverDataClient.models.PredictionJob.get({ userId });
  if (predictionJob.errors?.length) {
    return {
      data: null,
      errors: predictionJob.errors,
    };
  }

  const job = predictionJob.data;
  if (!job) {
    return {
      data: null,
      errors: null,
    };
  }

  const predictionGridCells =
    await serverDataClient.models.PredictionGridCell.listPredictionGridCellsByUserIdAndRequestId(
      {
        userId,
        requestId: { eq: job.requestId },
      },
      {
        limit: 100,
        sortDirection: "ASC",
      },
    );
  if (predictionGridCells.errors?.length) {
    return {
      data: null,
      errors: predictionGridCells.errors,
    };
  }

  try {
    return {
      data: currentPredictionPreviewSchema.parse(
        assembleCurrentPredictionPreview(
          job,
          toArray(predictionGridCells.data),
        ),
      ),
      errors: null,
    };
  } catch (error) {
    return {
      data: null,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function readLimit(input: Record<string, unknown> | undefined, fallback: number): number {
  const rawLimit = input?.["limit"];
  if (typeof rawLimit !== "number" || !Number.isFinite(rawLimit)) {
    return fallback;
  }

  return Math.max(1, Math.min(25, Math.trunc(rawLimit)));
}

function readToken(input: Record<string, unknown> | undefined): string | null {
  const nextToken = input?.["nextToken"];
  return typeof nextToken === "string" && nextToken.trim()
    ? nextToken
    : null;
}

function toArray<TItem>(value: ReadonlyArray<TItem> | null | undefined): TItem[] {
  return value ? [...value] : [];
}

function assembleCurrentPredictionPreview(
  job: {
    awayScore?: number | null;
    error?: string | null;
    executionArn?: string | null;
    forecastEnthusiasmBand?: string | null;
    forecastGeneratedAt?: string | null;
    forecastJobId?: string | null;
    forecastModelVersion?: string | null;
    forecastScenarioId?: string | null;
    forecastScenarioLabel?: string | null;
    forecastScenarioProbability?: number | null;
    forecastSourceTeamId?: string | null;
    homeScore?: number | null;
    modelVersion?: string | null;
    pointDiff?: number | null;
    requestId: string;
    requestedAt: string;
    status: CurrentPredictionPreview["status"];
    updatedAt: string;
    userId: string;
  },
  cells: Array<{
    awayDefense: string;
    awayScore?: number | null;
    homeOffense: string;
    homeScore?: number | null;
    pointDiff?: number | null;
  }>,
): CurrentPredictionPreview {
  const matrixCells = buildCurrentPredictionGrid(cells);

  return {
    awayScore: job.awayScore ?? null,
    error: job.error ?? null,
    executionArn: job.executionArn ?? null,
    forecastContext: buildCurrentPredictionForecastContext(job),
    homeScore: job.homeScore ?? null,
    modelVersion: job.modelVersion ?? null,
    pointDiff: job.pointDiff ?? null,
    requestId: job.requestId,
    requestedAt: job.requestedAt,
    status: job.status,
    tacticsGrid: matrixCells,
    updatedAt: job.updatedAt,
    userId: job.userId,
  };
}

function buildCurrentPredictionForecastContext(job: {
  forecastEnthusiasmBand?: string | null;
  forecastGeneratedAt?: string | null;
  forecastJobId?: string | null;
  forecastModelVersion?: string | null;
  forecastScenarioId?: string | null;
  forecastScenarioLabel?: string | null;
  forecastScenarioProbability?: number | null;
  forecastSourceTeamId?: string | null;
}): CurrentPredictionForecastContext | null {
  if (
    !job.forecastGeneratedAt ||
    !job.forecastJobId ||
    !job.forecastModelVersion ||
    !job.forecastScenarioId ||
    !job.forecastScenarioLabel ||
    job.forecastScenarioProbability === null ||
    job.forecastScenarioProbability === undefined ||
    !job.forecastSourceTeamId
  ) {
    return null;
  }

  return {
    forecastGeneratedAt: job.forecastGeneratedAt,
    forecastJobId: job.forecastJobId,
    forecastModelVersion: job.forecastModelVersion,
    scenarioId: job.forecastScenarioId,
    scenarioLabel: job.forecastScenarioLabel,
    scenarioProbability: job.forecastScenarioProbability,
    sourceTeamId: job.forecastSourceTeamId,
    enthusiasmBand: job.forecastEnthusiasmBand ?? null,
  };
}

function buildCurrentPredictionGrid(
  cells: Array<{
    awayDefense: string;
    awayScore?: number | null;
    homeOffense: string;
    homeScore?: number | null;
    pointDiff?: number | null;
  }>,
) {
  const keyedCells = new Map<string, PredictionGridCell>();

  for (const cell of cells) {
    if (
      !isPredictionAwayDefense(cell.awayDefense) ||
      !isPredictionHomeOffense(cell.homeOffense)
    ) {
      continue;
    }

    keyedCells.set(`${cell.awayDefense}::${cell.homeOffense}`, {
      awayDefense: cell.awayDefense,
      awayScore: cell.awayScore ?? null,
      homeOffense: cell.homeOffense,
      homeScore: cell.homeScore ?? null,
      pointDiff: cell.pointDiff ?? null,
    });
  }

  return {
    offenses: [...PREDICTION_HOME_OFFENSE_OPTIONS],
    defenses: [...PREDICTION_AWAY_DEFENSE_OPTIONS],
    cells: PREDICTION_AWAY_DEFENSE_OPTIONS.map((awayDefense) =>
      PREDICTION_HOME_OFFENSE_OPTIONS.map((homeOffense) => {
        return (
          keyedCells.get(`${awayDefense}::${homeOffense}`) ?? {
            awayDefense,
            awayScore: null,
            homeOffense,
            homeScore: null,
            pointDiff: null,
          }
        );
      }),
    ),
  };
}

function isPredictionHomeOffense(
  value: string,
): value is (typeof PREDICTION_HOME_OFFENSE_OPTIONS)[number] {
  return (PREDICTION_HOME_OFFENSE_OPTIONS as readonly string[]).includes(value);
}

function isPredictionAwayDefense(
  value: string,
): value is (typeof PREDICTION_AWAY_DEFENSE_OPTIONS)[number] {
  return (PREDICTION_AWAY_DEFENSE_OPTIONS as readonly string[]).includes(value);
}

async function fillRecapHistoryBuffer(
  state: RecapStreamState,
  limit: number,
  fetchPage: (nextToken: string | null | undefined) => Promise<{
    errors?: ReadonlyArray<ErrorPayload> | null;
    items: RecapHistoryRecord[];
    nextToken: string | null;
  }>,
): Promise<void> {
  while (state.buffer.length < limit && state.nextToken !== null) {
    const page = await fetchPage(state.nextToken);
    if (page.errors?.length) {
      throw new ReadOperationError(page.errors);
    }

    state.buffer.push(...page.items);
    state.nextToken = page.nextToken;
  }
}

function mergeRecapHistoryStreams(
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

function hasMoreRecapHistory(state: RecapHistoryCursor): boolean {
  return [
    state.gameDay,
    state.leagueGameDay,
    state.singleGame,
  ].some((stream) => stream.buffer.length || stream.nextToken !== null);
}

function encodeRecapHistoryToken(state: RecapHistoryCursor): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function decodeRecapHistoryToken(value: string | null): RecapHistoryCursor | null {
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

function normalizeRecapStreamState(
  value: Partial<RecapStreamState> | undefined,
): RecapStreamState {
  const nextToken = value?.nextToken;
  return {
    buffer: Array.isArray(value?.buffer) ? value.buffer.filter(isRecapHistoryRecord) : [],
    nextToken: nextToken == null ? nextToken : String(nextToken),
  };
}

function isRecapHistoryRecord(value: unknown): value is RecapHistoryRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as RecapHistoryRecord).selectionKey === "string" &&
      typeof (value as RecapHistoryRecord).requestedAt === "string" &&
      typeof (value as RecapHistoryRecord).updatedAt === "string",
  );
}

function compareRecapHistoryRecord(
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

function adaptLeagueDateRecap(record: GameDayRecapRecord): RecapHistoryRecord {
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

function adaptLeagueGameDayRecap(
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

function adaptSingleGameSummary(
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

function toRecapSelectionKey(kind: RecapHistoryKind, targetKey: string): string {
  return `${kind}:${targetKey}`;
}
