import type { CipherGCMTypes } from "node:crypto";

import {
  encodeAwsJsonFields,
  decodeAwsJsonFields,
  decodeAwsJsonList,
  type AwsJsonModelName,
} from "./awsjson";
import { getDataClient, type AmplifyDataFunctionEnv } from "./data-client";

export type ConnectionStatus =
  | "UNSET"
  | "CONNECTED"
  | "INVALID"
  | "ERROR"
  | "DISCONNECTED";

export type SyncStatus = "IDLE" | "SYNCING" | "SUCCEEDED" | "FAILED";

export type PredictionJobStatus =
  | "QUEUED"
  | "RESOLVING_INPUT"
  | "INVOKING_MODEL"
  | "SUCCEEDED"
  | "FAILED";

export type GameDayRecapStatus =
  | "QUEUED"
  | "RESOLVING_SLATE"
  | "BUILDING_CONTEXT"
  | "INVOKING_MODEL"
  | "SUCCEEDED"
  | "FAILED";

export type PredictionRequestMode = "MANUAL" | "CONNECTED";

export type BbConnectionRecord = {
  userId: string;
  bbLoginName: string;
  status: ConnectionStatus;
  accessKeyLast4?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  shortName?: string | null;
  leagueId?: string | null;
  leagueName?: string | null;
  countryId?: string | null;
  countryName?: string | null;
  leagueTimeZone?: string | null;
  connectedAt?: string | null;
  lastValidatedAt?: string | null;
  lastSyncAt?: string | null;
  refreshSortAt?: string | null;
  lastSyncError?: string | null;
  profileJson?: unknown;
  workspaceCacheJson?: unknown;
};

export type BillingAccountRecord = {
  userId: string;
  email?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  stripeSubscriptionStatus?: string | null;
  subscriptionPlanId?: string | null;
  currentPeriodEndAt?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  grantedPlanId?: string | null;
  overrideExpiresAt?: string | null;
  overrideReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UserPreferenceRecord = {
  userId: string;
  themeId: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BbCredentialRecord = {
  userId: string;
  cipherText: string;
  iv: string;
  authTag: string;
  algorithm: CipherGCMTypes;
};

export type SyncRunRecord = {
  id: string;
  userId: string;
  kind: string;
  status: SyncStatus;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  detailsJson?: unknown;
  expiryKey?: string | null;
  expiresAt?: string | null;
};

export type PredictionJobRecord = {
  id: string;
  userId: string;
  status: PredictionJobStatus;
  mode: PredictionRequestMode;
  requestedAt?: string | null;
  request: unknown;
  resolvedInputSnapshot?: unknown;
  result?: unknown;
  error?: string | null;
  modelVersion?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiryKey?: string | null;
  expiresAt?: string | null;
};

export type GameDayRecapRecord = {
  userId: string;
  targetKey: string;
  leagueId: string;
  leagueName?: string | null;
  gameDate: string;
  season?: number | null;
  status: GameDayRecapStatus;
  requestedAt: string;
  completedAt?: string | null;
  requestJson: unknown;
  coverageJson?: unknown;
  resultJson?: unknown;
  error?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
  promptVersion?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type LeagueGameDayRecapRecord = {
  userId: string;
  targetKey: string;
  leagueId: string;
  leagueName?: string | null;
  gameDayNumber: number;
  season?: number | null;
  status: GameDayRecapStatus;
  requestedAt: string;
  completedAt?: string | null;
  requestJson: unknown;
  coverageJson?: unknown;
  resultJson?: unknown;
  error?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
  promptVersion?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SingleGameSummaryRecord = {
  userId: string;
  targetKey: string;
  matchId: string;
  gameDate?: string | null;
  leagueId?: string | null;
  leagueName?: string | null;
  season?: number | null;
  status: GameDayRecapStatus;
  requestedAt: string;
  completedAt?: string | null;
  requestJson: unknown;
  coverageJson?: unknown;
  resultJson?: unknown;
  error?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
  promptVersion?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SharedPlayerCardRecord = {
  shareToken: string;
  userId: string;
  playerId: string;
  title?: string | null;
  note?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  payloadJson?: unknown;
};

export type SavedLineupScenarioRecord = {
  scenarioId: string;
  userId: string;
  name: string;
  startersJson: unknown;
  minuteTargetsJson: unknown;
  note?: string | null;
  savedAt: string;
};

export type PlayerSkillObservationRecord = {
  userId: string;
  playerId: string;
  capturedAt: string;
  playerCapturedAtKey: string;
  weekKey?: string | null;
  teamId: string;
  teamName?: string | null;
  fullName: string;
  bestPosition?: string | null;
  salary?: number | null;
  gameShape?: string | null;
  dmi?: number | null;
  injuryWeeks?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

type RepositoryEnv = Record<string, string | undefined>;

type ClientError = { message?: string };

type ClientResult<TData> = {
  data?: TData | null;
  errors?: ReadonlyArray<ClientError> | null;
  nextToken?: string | null;
};

type ModelApi<TRecord> = {
  create: (input: Record<string, unknown>) => Promise<ClientResult<TRecord>>;
  delete: (input: Record<string, unknown>) => Promise<ClientResult<TRecord>>;
  get: (input: Record<string, unknown>) => Promise<ClientResult<TRecord>>;
  update: (input: Record<string, unknown>) => Promise<ClientResult<TRecord>>;
};

type IndexQueryOptions = {
  filter?: Record<string, unknown>;
  limit?: number;
  nextToken?: string | null;
  sortDirection?: "ASC" | "DESC";
};

type IndexQueryMethod<TRecord> = (
  input: Record<string, unknown>,
  options?: IndexQueryOptions,
) => Promise<ClientResult<ReadonlyArray<TRecord>>>;

export type PagedRecords<TRecord> = {
  nextToken: string | null;
  records: TRecord[];
};

const runtime = {
  getClient: getDataClient,
};

export const __testing = {
  runtime,
};

export async function getBbConnection(
  env: RepositoryEnv,
  userId: string,
): Promise<BbConnectionRecord | null> {
  const record = await getModelRecord<BbConnectionRecord>(
    env,
    "BbConnection",
    { userId },
    "load BB connection",
  );

  return decodeAwsJsonFields("BbConnection", record);
}

export async function getBillingAccount(
  env: RepositoryEnv,
  userId: string,
): Promise<BillingAccountRecord | null> {
  const record = await getModelRecord<BillingAccountRecord>(
    env,
    "BillingAccount",
    { userId },
    "load billing account",
  );

  return decodeAwsJsonFields("BillingAccount", record);
}

export async function upsertBillingAccount(
  env: RepositoryEnv,
  record: BillingAccountRecord,
): Promise<void> {
  await upsertModelRecord(env, "BillingAccount", ["userId"], record);
}

export async function getUserPreference(
  env: RepositoryEnv,
  userId: string,
): Promise<UserPreferenceRecord | null> {
  const record = await getModelRecord<UserPreferenceRecord>(
    env,
    "UserPreference",
    { userId },
    "load user preference",
  );

  return decodeAwsJsonFields("UserPreference", record);
}

export async function upsertUserPreference(
  env: RepositoryEnv,
  record: UserPreferenceRecord,
): Promise<void> {
  await upsertModelRecord(env, "UserPreference", ["userId"], record);
}

export async function listConnectedBbConnections(
  env: RepositoryEnv,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<BbConnectionRecord>> {
  const page = await queryModelIndexPage<BbConnectionRecord>(
    env,
    "BbConnection",
    "listBbConnectionsByStatusAndRefreshSortAt",
    { status: "CONNECTED" },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list connected BB connections",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("BbConnection", page.records),
  };
}

export async function listStaleConnectedBbConnections(
  env: RepositoryEnv,
  staleBefore: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<BbConnectionRecord>> {
  const page = await queryModelIndexPage<BbConnectionRecord>(
    env,
    "BbConnection",
    "listBbConnectionsByStatusAndRefreshSortAt",
    {
      status: "CONNECTED",
      refreshSortAt: { lt: staleBefore },
    },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list stale connected BB connections",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("BbConnection", page.records),
  };
}

export async function upsertBbConnection(
  env: RepositoryEnv,
  record: BbConnectionRecord,
): Promise<void> {
  await upsertModelRecord(env, "BbConnection", ["userId"], record);
}

export async function getBbCredential(
  env: RepositoryEnv,
  userId: string,
): Promise<BbCredentialRecord | null> {
  return getModelRecord<BbCredentialRecord>(
    env,
    "BbCredential",
    { userId },
    "load BB credential",
  );
}

export async function upsertBbCredential(
  env: RepositoryEnv,
  record: BbCredentialRecord,
): Promise<void> {
  const model = await getModel<BbCredentialRecord>(env, "BbCredential");
  const exists = await getBbCredential(env, record.userId);
  const input = omitUndefinedValues(record);

  if (exists) {
    await assertSuccessful(model.update(input), "update BB credential");
    return;
  }

  await assertSuccessful(model.create(input), "create BB credential");
}

export async function deleteBbCredential(
  env: RepositoryEnv,
  userId: string,
): Promise<void> {
  const model = await getModel<BbCredentialRecord>(env, "BbCredential");
  await assertSuccessful(model.delete({ userId }), "delete BB credential");
}

export async function createSyncRun(
  env: RepositoryEnv,
  input: Omit<SyncRunRecord, "id">,
): Promise<SyncRunRecord> {
  const model = await getModel<SyncRunRecord>(env, "SyncRun");
  const recordInput = prepareModelInput("SyncRun", {
    ...input,
    expiryKey: input.expiryKey ?? "EXPIRABLE",
    expiresAt: input.expiresAt ?? addDays(input.startedAt, 14),
  });
  const record = assertPresent(
    await assertSuccessful(model.create(recordInput), "create sync run"),
    "create sync run",
  );

  return decodeAwsJsonFields("SyncRun", record);
}

export async function updateSyncRun(
  env: RepositoryEnv,
  input: Partial<SyncRunRecord> & Pick<SyncRunRecord, "id">,
): Promise<void> {
  const model = await getModel<SyncRunRecord>(env, "SyncRun");
  await assertSuccessful(
    model.update(prepareModelInput("SyncRun", input)),
    "update sync run",
  );
}

export async function listExpiredSyncRuns(
  env: RepositoryEnv,
  expiresBefore: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<SyncRunRecord>> {
  const page = await queryModelIndexPage<SyncRunRecord>(
    env,
    "SyncRun",
    "listSyncRunsByExpiryKeyAndExpiresAt",
    {
      expiryKey: "EXPIRABLE",
      expiresAt: { lt: expiresBefore },
    },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list expired sync runs",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("SyncRun", page.records),
  };
}

export async function deleteSyncRun(
  env: RepositoryEnv,
  id: string,
): Promise<void> {
  const model = await getModel<SyncRunRecord>(env, "SyncRun");
  await assertSuccessful(model.delete({ id }), "delete sync run");
}

export async function createPredictionJob(
  env: RepositoryEnv,
  input: Omit<PredictionJobRecord, "createdAt" | "updatedAt">,
): Promise<PredictionJobRecord> {
  const model = await getModel<PredictionJobRecord>(env, "PredictionJob");
  const now = new Date().toISOString();
  const record = assertPresent(
    await assertSuccessful(
      model.create(
        prepareModelInput("PredictionJob", {
          ...input,
          requestedAt: input.requestedAt ?? now,
          expiryKey: input.expiryKey ?? "EXPIRABLE",
          expiresAt: input.expiresAt ?? addDays(now, 30),
        }),
      ),
      "create prediction job",
    ),
    "create prediction job",
  );

  return decodeAwsJsonFields("PredictionJob", record);
}

export async function getPredictionJob(
  env: RepositoryEnv,
  id: string,
): Promise<PredictionJobRecord | null> {
  const record = await getModelRecord<PredictionJobRecord>(
    env,
    "PredictionJob",
    { id },
    "load prediction job",
  );

  return decodeAwsJsonFields("PredictionJob", record);
}

export async function updatePredictionJob(
  env: RepositoryEnv,
  input: Partial<PredictionJobRecord> & Pick<PredictionJobRecord, "id">,
): Promise<void> {
  const model = await getModel<PredictionJobRecord>(env, "PredictionJob");
  await assertSuccessful(
    model.update(prepareModelInput("PredictionJob", input)),
    "update prediction job",
  );
}

export async function listExpiredPredictionJobs(
  env: RepositoryEnv,
  expiresBefore: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<PredictionJobRecord>> {
  const page = await queryModelIndexPage<PredictionJobRecord>(
    env,
    "PredictionJob",
    "listPredictionJobsByExpiryKeyAndExpiresAt",
    {
      expiryKey: "EXPIRABLE",
      expiresAt: { lt: expiresBefore },
    },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list expired prediction jobs",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("PredictionJob", page.records),
  };
}

export async function deletePredictionJob(
  env: RepositoryEnv,
  id: string,
): Promise<void> {
  const model = await getModel<PredictionJobRecord>(env, "PredictionJob");
  await assertSuccessful(model.delete({ id }), "delete prediction job");
}

export async function getGameDayRecap(
  env: RepositoryEnv,
  userId: string,
  targetKey: string,
): Promise<GameDayRecapRecord | null> {
  const record = await getModelRecord<GameDayRecapRecord>(
    env,
    "GameDayRecap",
    { userId, targetKey },
    "load game day recap",
  );

  return decodeAwsJsonFields("GameDayRecap", record);
}

export async function upsertGameDayRecap(
  env: RepositoryEnv,
  record: GameDayRecapRecord,
): Promise<void> {
  await upsertModelRecord(env, "GameDayRecap", ["userId", "targetKey"], record);
}

export async function updateGameDayRecap(
  env: RepositoryEnv,
  input: Partial<GameDayRecapRecord> &
    Pick<GameDayRecapRecord, "userId" | "targetKey">,
): Promise<void> {
  const model = await getModel<GameDayRecapRecord>(env, "GameDayRecap");
  await assertSuccessful(
    model.update(prepareModelInput("GameDayRecap", input)),
    "update game day recap",
  );
}

export async function getLeagueGameDayRecap(
  env: RepositoryEnv,
  userId: string,
  targetKey: string,
): Promise<LeagueGameDayRecapRecord | null> {
  const record = await getModelRecord<LeagueGameDayRecapRecord>(
    env,
    "LeagueGameDayRecap",
    { userId, targetKey },
    "load league game day recap",
  );

  return decodeAwsJsonFields("LeagueGameDayRecap", record);
}

export async function upsertLeagueGameDayRecap(
  env: RepositoryEnv,
  record: LeagueGameDayRecapRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "LeagueGameDayRecap",
    ["userId", "targetKey"],
    record,
  );
}

export async function updateLeagueGameDayRecap(
  env: RepositoryEnv,
  input: Partial<LeagueGameDayRecapRecord> &
    Pick<LeagueGameDayRecapRecord, "userId" | "targetKey">,
): Promise<void> {
  const model = await getModel<LeagueGameDayRecapRecord>(
    env,
    "LeagueGameDayRecap",
  );
  await assertSuccessful(
    model.update(prepareModelInput("LeagueGameDayRecap", input)),
    "update league game day recap",
  );
}

export async function getSingleGameSummary(
  env: RepositoryEnv,
  userId: string,
  targetKey: string,
): Promise<SingleGameSummaryRecord | null> {
  const record = await getModelRecord<SingleGameSummaryRecord>(
    env,
    "SingleGameSummary",
    { userId, targetKey },
    "load single game summary",
  );

  return decodeAwsJsonFields("SingleGameSummary", record);
}

export async function upsertSingleGameSummary(
  env: RepositoryEnv,
  record: SingleGameSummaryRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "SingleGameSummary",
    ["userId", "targetKey"],
    record,
  );
}

export async function updateSingleGameSummary(
  env: RepositoryEnv,
  input: Partial<SingleGameSummaryRecord> &
    Pick<SingleGameSummaryRecord, "userId" | "targetKey">,
): Promise<void> {
  const model = await getModel<SingleGameSummaryRecord>(
    env,
    "SingleGameSummary",
  );
  await assertSuccessful(
    model.update(prepareModelInput("SingleGameSummary", input)),
    "update single game summary",
  );
}

export async function getMatchBoxscore(
  env: RepositoryEnv,
  userId: string,
  matchId: string,
): Promise<Record<string, unknown> | null> {
  const record = await getModelRecord<Record<string, unknown>>(
    env,
    "MatchBoxscore",
    { userId, matchId },
    "load match boxscore",
  );

  return decodeAwsJsonFields("MatchBoxscore", record);
}

export async function upsertTrackedTeam(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  await upsertModelRecord(env, "TrackedTeam", ["userId", "teamId"], input);
}

export async function upsertTrackedPlayer(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  await upsertModelRecord(env, "TrackedPlayer", ["userId", "playerId"], input);
}

export function buildPlayerSkillObservationSortKey(
  playerId: string,
  capturedAt: string,
): string {
  return `${playerId}#${capturedAt}`;
}

export async function getTrackedPlayer(
  env: RepositoryEnv,
  userId: string,
  playerId: string,
): Promise<Record<string, unknown> | null> {
  const record = await getModelRecord<Record<string, unknown>>(
    env,
    "TrackedPlayer",
    { userId, playerId },
    "load tracked player",
  );

  return decodeAwsJsonFields("TrackedPlayer", record);
}

export async function upsertPlayerSkillObservation(
  env: RepositoryEnv,
  record: PlayerSkillObservationRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "PlayerSkillObservation",
    ["userId", "playerId", "capturedAt"],
    record,
  );
}

export async function listPlayerSkillObservations(
  env: RepositoryEnv,
  userId: string,
  playerId: string,
  limit = 365,
): Promise<PlayerSkillObservationRecord[]> {
  const records: PlayerSkillObservationRecord[] = [];
  let nextToken: string | null = null;

  do {
    const page: PagedRecords<PlayerSkillObservationRecord> =
      await queryModelIndexPage<PlayerSkillObservationRecord>(
        env,
        "PlayerSkillObservation",
        "listPlayerSkillObservationsByUserIdAndPlayerCapturedAtKey",
        {
          userId,
          playerCapturedAtKey: {
            beginsWith: `${playerId}#`,
          },
        },
        {
          limit: Math.max(1, limit - records.length),
          nextToken,
          sortDirection: "DESC",
        },
        "list player skill observations",
      );
    records.push(...decodeAwsJsonList("PlayerSkillObservation", page.records));
    nextToken = page.nextToken;
  } while (nextToken && records.length < limit);

  return records.slice(0, limit);
}

export async function upsertTrackedMatch(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  await upsertModelRecord(env, "TrackedMatch", ["userId", "matchId"], input);
}

export async function upsertMatchBoxscore(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  await upsertModelRecord(env, "MatchBoxscore", ["userId", "matchId"], input);
}

export async function upsertLeagueStanding(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  await upsertModelRecord(
    env,
    "LeagueStanding",
    ["userId", "season", "teamId"],
    input,
  );
}

export async function createSharedPlayerCard(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  const model = await getModel<Record<string, unknown>>(
    env,
    "SharedPlayerCard",
  );
  await assertSuccessful(
    model.create(prepareModelInput("SharedPlayerCard", input)),
    "create shared player card",
  );
}

export async function updateSharedPlayerCard(
  env: RepositoryEnv,
  input: Partial<SharedPlayerCardRecord> &
    Pick<SharedPlayerCardRecord, "shareToken">,
): Promise<void> {
  const model = await getModel<SharedPlayerCardRecord>(env, "SharedPlayerCard");
  await assertSuccessful(
    model.update(prepareModelInput("SharedPlayerCard", input)),
    "update shared player card",
  );
}

export async function createSavedLineupScenario(
  env: RepositoryEnv,
  input: SavedLineupScenarioRecord,
): Promise<SavedLineupScenarioRecord> {
  const model = await getModel<SavedLineupScenarioRecord>(
    env,
    "SavedLineupScenario",
  );
  const record = assertPresent(
    await assertSuccessful(
      model.create(prepareModelInput("SavedLineupScenario", input)),
      "create saved lineup scenario",
    ),
    "create saved lineup scenario",
  );

  return decodeAwsJsonFields("SavedLineupScenario", record);
}

export async function getSharedPlayerCardRecord(
  env: RepositoryEnv,
  shareToken: string,
): Promise<SharedPlayerCardRecord | null> {
  const record = await getModelRecord<SharedPlayerCardRecord>(
    env,
    "SharedPlayerCard",
    { shareToken },
    "load shared player card",
  );

  return decodeAwsJsonFields("SharedPlayerCard", record);
}

async function upsertModelRecord(
  env: RepositoryEnv,
  modelName: AwsJsonModelName,
  identifierFields: readonly string[],
  input: Record<string, unknown>,
): Promise<void> {
  const model = await getModel<Record<string, unknown>>(env, modelName);
  const identifier = pickFields(input, identifierFields);
  const currentRecord = await assertSuccessful(
    model.get(identifier),
    `load ${modelName} record`,
  );
  const payload = prepareModelInput(modelName, input);

  if (currentRecord) {
    await assertSuccessful(model.update(payload), `update ${modelName} record`);
    return;
  }

  await assertSuccessful(model.create(payload), `create ${modelName} record`);
}

function prepareModelInput<TRecord extends Record<string, unknown>>(
  modelName: AwsJsonModelName,
  input: TRecord,
): TRecord {
  return omitUndefinedValues(encodeAwsJsonFields(modelName, input));
}

async function getModelRecord<TRecord>(
  env: RepositoryEnv,
  modelName: string,
  input: Record<string, unknown>,
  context: string,
): Promise<TRecord | null> {
  const model = await getModel<TRecord>(env, modelName);
  return assertSuccessful(model.get(omitUndefinedValues(input)), context);
}

async function queryModelIndexPage<TRecord>(
  env: RepositoryEnv,
  modelName: string,
  queryField: string,
  input: Record<string, unknown>,
  options: IndexQueryOptions,
  context: string,
): Promise<PagedRecords<TRecord>> {
  const query = await getModelIndexQuery<TRecord>(env, modelName, queryField);
  const result = await query(
    omitUndefinedValues(input),
    omitUndefinedValues(options),
  );

  if (!result.errors?.length) {
    return {
      nextToken: result.nextToken ?? null,
      records: [...(result.data ?? [])],
    };
  }

  throw new Error(
    `${context} failed: ${result.errors
      .map((error) => error.message ?? "Unknown Amplify data client error")
      .join("; ")}`,
  );
}

async function getModel<TRecord>(
  env: RepositoryEnv,
  modelName: string,
): Promise<ModelApi<TRecord>> {
  const client = await runtime.getClient(env as AmplifyDataFunctionEnv);
  const model = (
    client.models as unknown as Record<string, ModelApi<TRecord> | undefined>
  )[modelName];

  if (!model) {
    throw new Error(`Amplify data client model ${modelName} is not available.`);
  }

  return model;
}

async function getModelIndexQuery<TRecord>(
  env: RepositoryEnv,
  modelName: string,
  queryField: string,
): Promise<IndexQueryMethod<TRecord>> {
  const model = await getModel<TRecord>(env, modelName);
  const query = (
    model as unknown as Record<string, IndexQueryMethod<TRecord> | undefined>
  )[queryField];

  if (!query) {
    throw new Error(
      `Amplify data client index query ${modelName}.${queryField} is not available.`,
    );
  }

  return query;
}

async function assertSuccessful<TData>(
  operation: Promise<ClientResult<TData>>,
  context: string,
): Promise<TData | null> {
  const result = await operation;
  if (!result.errors?.length) {
    return result.data ?? null;
  }

  throw new Error(
    `${context} failed: ${result.errors
      .map((error) => error.message ?? "Unknown Amplify data client error")
      .join("; ")}`,
  );
}

function assertPresent<TData>(value: TData | null, context: string): TData {
  if (value !== null) {
    return value;
  }

  throw new Error(`${context} failed: Amplify data client returned no data.`);
}

function omitUndefinedValues<TRecord extends Record<string, unknown>>(
  input: TRecord,
): TRecord {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as TRecord;
}

function pickFields(
  input: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((selected, field) => {
    selected[field] = input[field];
    return selected;
  }, {});
}

function addDays(value: string, days: number): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  return new Date(parsed.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
