import type { CipherGCMTypes } from "node:crypto";

import {
  encodeAwsJsonFields,
  decodeAwsJsonFields,
  decodeAwsJsonList,
  type AwsJsonModelName,
} from "./awsjson";
import {
  getDataClient,
  type AmplifyDataFunctionEnv,
} from "./data-client";

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
  connectedAt?: string | null;
  lastValidatedAt?: string | null;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  profileJson?: unknown;
  workspaceCacheJson?: unknown;
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
  expiresAt?: string | null;
};

export type PredictionJobRecord = {
  id: string;
  userId: string;
  status: PredictionJobStatus;
  mode: PredictionRequestMode;
  request: unknown;
  resolvedInputSnapshot?: unknown;
  result?: unknown;
  error?: string | null;
  modelVersion?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
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
  list: (
    input?: Record<string, unknown>,
  ) => Promise<ClientResult<ReadonlyArray<TRecord>>>;
  update: (input: Record<string, unknown>) => Promise<ClientResult<TRecord>>;
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

export async function listBbConnections(
  env: RepositoryEnv,
  limit = 1000,
): Promise<BbConnectionRecord[]> {
  const records = await listModelRecords<BbConnectionRecord>(
    env,
    "BbConnection",
    { limit },
    "list BB connections",
  );

  return decodeAwsJsonList("BbConnection", records);
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
    await assertSuccessful(
      model.update(input),
      "update BB credential",
    );
    return;
  }

  await assertSuccessful(
    model.create(input),
    "create BB credential",
  );
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
    expiresAt: input.expiresAt ?? addDays(input.startedAt, 14),
  });
  const record = assertPresent(
    await assertSuccessful(
      model.create(recordInput),
      "create sync run",
    ),
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

export async function listSyncRuns(
  env: RepositoryEnv,
  limit = 1000,
): Promise<SyncRunRecord[]> {
  const records = await listModelRecords<SyncRunRecord>(
    env,
    "SyncRun",
    { limit },
    "list sync runs",
  );

  return decodeAwsJsonList("SyncRun", records);
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

export async function listPredictionJobs(
  env: RepositoryEnv,
  limit = 1000,
): Promise<PredictionJobRecord[]> {
  const records = await listModelRecords<PredictionJobRecord>(
    env,
    "PredictionJob",
    { limit },
    "list prediction jobs",
  );

  return decodeAwsJsonList("PredictionJob", records);
}

export async function deletePredictionJob(
  env: RepositoryEnv,
  id: string,
): Promise<void> {
  const model = await getModel<PredictionJobRecord>(env, "PredictionJob");
  await assertSuccessful(model.delete({ id }), "delete prediction job");
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

export async function listTrackedTeams(
  env: RepositoryEnv,
  userId: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const records = await listModelRecords<Record<string, unknown>>(
    env,
    "TrackedTeam",
    {
      filter: {
        userId: { eq: userId },
      },
      limit,
    },
    "list tracked teams",
  );

  return decodeAwsJsonList("TrackedTeam", records);
}

export async function upsertTrackedPlayer(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  await upsertModelRecord(env, "TrackedPlayer", ["userId", "playerId"], input);
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

export async function upsertWeeklyPlayerSnapshot(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  await upsertModelRecord(
    env,
    "WeeklyPlayerSnapshot",
    ["userId", "playerId", "weekKey"],
    input,
  );
}

export async function createSharedPlayerCard(
  env: RepositoryEnv,
  input: Record<string, unknown>,
): Promise<void> {
  const model = await getModel<Record<string, unknown>>(env, "SharedPlayerCard");
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

export async function listWeeklyPlayerSnapshots(
  env: RepositoryEnv,
  userId: string,
  playerId: string,
  limit = 12,
): Promise<Record<string, unknown>[]> {
  const records = await listModelRecords<Record<string, unknown>>(
    env,
    "WeeklyPlayerSnapshot",
    {
      filter: {
        userId: { eq: userId },
        playerId: { eq: playerId },
      },
      limit,
    },
    "list weekly player snapshots",
  );

  return decodeAwsJsonList("WeeklyPlayerSnapshot", records);
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
    await assertSuccessful(
      model.update(payload),
      `update ${modelName} record`,
    );
    return;
  }

  await assertSuccessful(
    model.create(payload),
    `create ${modelName} record`,
  );
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

async function listModelRecords<TRecord>(
  env: RepositoryEnv,
  modelName: string,
  input: Record<string, unknown>,
  context: string,
): Promise<TRecord[]> {
  const model = await getModel<TRecord>(env, modelName);
  const records: TRecord[] = [];
  let nextToken: string | null | undefined;

  do {
    const result = await model.list(
      omitUndefinedValues({
        ...input,
        nextToken,
      }),
    );

    if (result.errors?.length) {
      throw new Error(
        `${context} failed: ${result.errors
          .map((error) => error.message ?? "Unknown Amplify data client error")
          .join("; ")}`,
      );
    }

    records.push(...(result.data ?? []));
    nextToken = result.nextToken;
  } while (nextToken);

  return records;
}

async function getModel<TRecord>(
  env: RepositoryEnv,
  modelName: string,
): Promise<ModelApi<TRecord>> {
  const client = await runtime.getClient(env as AmplifyDataFunctionEnv);
  const model = (client.models as unknown as Record<
    string,
    ModelApi<TRecord> | undefined
  >)[
    modelName
  ];

  if (!model) {
    throw new Error(`Amplify data client model ${modelName} is not available.`);
  }

  return model;
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

  return new Date(
    parsed.getTime() + days * 24 * 60 * 60 * 1000,
  ).toISOString();
}
