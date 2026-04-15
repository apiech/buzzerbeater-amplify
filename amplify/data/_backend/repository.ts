import type { CipherGCMTypes } from "node:crypto";

import {
  encodeAwsJsonFields,
  decodeAwsJsonFields,
  decodeAwsJsonList,
} from "./awsjson";
import { getDataClient, type AmplifyDataFunctionEnv } from "./data-client";
import { partitionLegacyWorkspaceCacheCoercionErrors } from "./workspace-cache";
import type { PredictionInputShape } from "../../../lib/prediction/normalization";
import type { Schema } from "../resource";

type StoredTeamInfo = Schema["StoredTeamInfo"]["type"];
type RepositoryModel<TRecord extends { createdAt: string; updatedAt: string }> =
  Omit<TRecord, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  };
type WorkspaceCachePayload = Schema["WorkspaceCachePayload"]["type"];
type SharedPlayerCardPayload = NonNullable<
  Schema["SharedPlayerCard"]["type"]["payloadJson"]
>;
type OpponentForecastJobRequest = NonNullable<
  Schema["OpponentForecastJob"]["type"]["requestJson"]
>;
type OpponentForecastResolvedContext = NonNullable<
  Schema["OpponentForecastJob"]["type"]["resolvedContextJson"]
>;
type OpponentForecastStoredResult = NonNullable<
  Schema["OpponentForecastJob"]["type"]["resultJson"]
>;
type NextGameRecommendationStoredRequest = NonNullable<
  Schema["NextGameRecommendationJob"]["type"]["requestJson"]
>;
type NextGameRecommendationStoredProgress = NonNullable<
  Schema["NextGameRecommendationJob"]["type"]["progressJson"]
>;
type NextGameRecommendationStoredResult = NonNullable<
  Schema["NextGameRecommendationJob"]["type"]["resultJson"]
>;
type StoredPlannerEvaluatedScenario = NonNullable<
  Schema["NextGamePlannerArtifact"]["type"]["evaluatedScenariosJson"]
>[number];
type StoredPlannerTacticPair = NonNullable<
  Schema["NextGamePlannerArtifact"]["type"]["ourPairsJson"]
>[number];
type PlannerArtifactRowPayload = NonNullable<
  Schema["NextGamePlannerArtifactRow"]["type"]["rowJson"]
>;
type GameDayRecapStoredRequest = NonNullable<
  Schema["GameDayRecap"]["type"]["requestJson"]
>;
type LeagueGameDayRecapStoredRequest = NonNullable<
  Schema["LeagueGameDayRecap"]["type"]["requestJson"]
>;
type SingleGameSummaryStoredRequest = NonNullable<
  Schema["SingleGameSummary"]["type"]["requestJson"]
>;
type GameDayRecapCoverage = NonNullable<
  Schema["GameDayRecap"]["type"]["coverageJson"]
>;
type GameDayRecapResult = NonNullable<
  Schema["GameDayRecap"]["type"]["resultJson"]
>;
type RivalsWorkspaceSummary = NonNullable<
  Schema["RivalsWorkspaceCache"]["type"]["summaryJson"]
>;
type RivalsMatchesCacheEnvelope = NonNullable<
  Schema["RivalsWorkspaceCache"]["type"]["matchesJson"]
>;

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

export type OpponentForecastJobStatus =
  | "QUEUED"
  | "RESOLVING_CONTEXT"
  | "INVOKING_MODEL"
  | "SUCCEEDED"
  | "FAILED";

export type NextGameRecommendationStatus =
  | "QUEUED"
  | "PREPARING_INPUTS"
  | "RESOLVING_CONTEXT"
  | "OPTIMIZING_LINEUPS"
  | "EVALUATING_CANDIDATES"
  | "SCORING_MATCHUPS"
  | "BUILDING_PLANNER"
  | "SUCCEEDED"
  | "FAILED";

export type NextGameRecommendationProgressPhaseKey =
  | "QUEUED"
  | "RESOLVING_CONTEXT"
  | "OPTIMIZING_LINEUPS"
  | "SCORING_MATCHUPS"
  | "BUILDING_PLANNER"
  | "SUCCEEDED"
  | "FAILED";

export type GameDayRecapStatus =
  | "QUEUED"
  | "RESOLVING_SLATE"
  | "BUILDING_CONTEXT"
  | "INVOKING_MODEL"
  | "SUCCEEDED"
  | "FAILED";

export type LeagueHistoryBackfillState =
  | "QUEUED"
  | "RESOLVING_SEASONS"
  | "FETCHING_STANDINGS"
  | "SUCCEEDED"
  | "FAILED";

export type RivalsBackfillState =
  | "QUEUED"
  | "FETCHING_SEASONS"
  | "FETCHING_SCHEDULES"
  | "BUILDING_DATASET"
  | "SUCCEEDED"
  | "FAILED";

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
  lastSyncError?: string | null;
  profileJson?: StoredTeamInfo | null;
  workspaceCacheJson?: WorkspaceCachePayload | null;
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
  lifetimePlanId?: string | null;
  lifetimeGrantedAt?: string | null;
  lifetimeSourceObjectId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type BillingPaymentRecord = {
  providerObjectType: string;
  providerObjectId: string;
  userId: string;
  paymentKind: string;
  status: string;
  amountTotal?: number | null;
  currency?: string | null;
  occurredAt: string;
  grantedPlanId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripePriceId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UserPreferenceRecord = {
  userId: string;
  themeId: string;
  createdAt?: string;
  updatedAt?: string;
};

export type FeedbackSubmissionRecord = RepositoryModel<
  Schema["FeedbackSubmission"]["type"]
>;

export type BbCredentialRecord = {
  userId: string;
  cipherText: string;
  iv: string;
  authTag: string;
  algorithm: CipherGCMTypes;
  secretFingerprint?: string | null;
};

export type TrackedTeamRecord = {
  userId: string;
  teamId: string;
  name: string;
  shortName?: string | null;
  leagueId?: string | null;
  leagueName?: string | null;
  countryId?: string | null;
  countryName?: string | null;
  arenaName?: string | null;
  rivalId?: string | null;
  isPrimary?: boolean | null;
  summaryJson?: StoredTeamInfo | null;
  fetchedAt?: string | null;
};

export type TrackedPlayerRecord = RepositoryModel<
  Schema["TrackedPlayer"]["type"]
>;

export type TrackedMatchRecord = RepositoryModel<
  Schema["TrackedMatch"]["type"]
>;

export type MatchBoxscoreRecord = RepositoryModel<
  Schema["MatchBoxscore"]["type"]
>;
export type ArenaPricingSnapshotRecord = RepositoryModel<
  Schema["ArenaPricingSnapshot"]["type"]
>;
export type MatchBoxscoreCacheReadResult =
  | {
      status: "hit";
      record: MatchBoxscoreRecord;
    }
  | {
      status: "missing";
    }
  | {
      status: "unreadable";
      errorMessage: string;
    };

export type LeagueStandingRecord = RepositoryModel<
  Schema["LeagueStanding"]["type"]
>;

export type SyncRunRecord = {
  id: string;
  userId: string;
  kind: string;
  status: SyncStatus;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  detailsJson?: unknown;
  expiryKey: string;
  expiresAt: string;
};

export type PredictionJobRecord = {
  userId: string;
  requestId: string;
  status: PredictionJobStatus;
  requestedAt: string;
  executionArn?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  pointDiff?: number | null;
  error?: string | null;
  modelKey?: string | null;
  modelVersion?: string | null;
  forecastJobId?: string | null;
  forecastModelVersion?: string | null;
  forecastGeneratedAt?: string | null;
  forecastScenarioId?: string | null;
  forecastScenarioLabel?: string | null;
  forecastScenarioProbability?: number | null;
  forecastEnthusiasmBand?: string | null;
  forecastSourceTeamId?: string | null;
  createdAt?: string;
  updatedAt?: string;
} & PredictionInputShape;

export type PredictionGridCellRecord = {
  userId: string;
  requestId: string;
  awayDefense: string;
  homeOffense: string;
  homeScore?: number | null;
  awayScore?: number | null;
  pointDiff?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type OpponentForecastJobRecord = {
  id: string;
  userId: string;
  teamId: string;
  teamName?: string | null;
  status: OpponentForecastJobStatus;
  requestedAt: string;
  executionArn?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  requestJson: OpponentForecastJobRequest;
  resolvedContextJson?: OpponentForecastResolvedContext | null;
  resultJson?: OpponentForecastStoredResult | null;
  error?: string | null;
  modelVersion?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiryKey: string;
  expiresAt: string;
};

export type NextGameRecommendationJobRecord = {
  id: string;
  userId: string;
  matchId: string;
  opponentTeamId: string;
  opponentTeamName?: string | null;
  enthusiasm: number;
  switchPg: string;
  switchSg: string;
  switchSf: string;
  switchPf: string;
  switchC: string;
  status: NextGameRecommendationStatus;
  requestedAt: string;
  executionArn?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  requestJson: NextGameRecommendationStoredRequest;
  progressJson?: NextGameRecommendationStoredProgress | null;
  resultJson?: NextGameRecommendationStoredResult | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiryKey: string;
  expiresAt: string;
};

export type NextGamePlannerArtifactRecord = {
  artifactKey: string;
  userId: string;
  jobId: string;
  matchId: string;
  opponentTeamId: string;
  generatedAt: string;
  evaluatedScenariosJson: StoredPlannerEvaluatedScenario[];
  ourPairsJson: StoredPlannerTacticPair[];
  opponentPairsJson: StoredPlannerTacticPair[];
  createdAt?: string;
  updatedAt?: string;
  expiryKey: string;
  expiresAt: string;
};

export type NextGamePlannerArtifactRowRecord = {
  artifactKey: string;
  viewId: string;
  opponentPairId: string;
  userId: string;
  jobId: string;
  rowOrder: number;
  rowJson: PlannerArtifactRowPayload;
  createdAt?: string;
  updatedAt?: string;
  expiryKey: string;
  expiresAt: string;
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
  executionArn?: string | null;
  completedAt?: string | null;
  requestJson: GameDayRecapStoredRequest;
  coverageJson?: GameDayRecapCoverage | null;
  resultJson?: GameDayRecapResult | null;
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
  executionArn?: string | null;
  completedAt?: string | null;
  requestJson: LeagueGameDayRecapStoredRequest;
  coverageJson?: GameDayRecapCoverage | null;
  resultJson?: GameDayRecapResult | null;
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
  executionArn?: string | null;
  completedAt?: string | null;
  requestJson: SingleGameSummaryStoredRequest;
  coverageJson?: GameDayRecapCoverage | null;
  resultJson?: GameDayRecapResult | null;
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
  payloadJson?: SharedPlayerCardPayload | null;
};

export type LeagueHistoryStandingCacheRecord = {
  leagueId: string;
  season: number;
  teamId: string;
  leagueName?: string | null;
  teamName?: string | null;
  wins?: number | null;
  losses?: number | null;
  pf?: number | null;
  pa?: number | null;
  conferenceIndex?: number | null;
  isBot?: boolean | null;
  fetchedAt?: string | null;
};

export type LeagueHistoryBackfillRecord = {
  leagueId: string;
  leagueName?: string | null;
  status: LeagueHistoryBackfillState;
  requestedAt: string;
  executionArn?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  historicalSeasonsExpected?: number | null;
  historicalSeasonsStored?: number | null;
  lastCompletedSeason?: number | null;
  updatedAt: string;
};

export type RivalsWorkspaceCacheRecord = {
  userId: string;
  teamId: string;
  teamName?: string | null;
  shortName?: string | null;
  generatedAt: string;
  syncedAt?: string | null;
  warning?: string | null;
  summaryJson: RivalsWorkspaceSummary;
  matchesJson: RivalsMatchesCacheEnvelope;
};

export type RivalryMatchFactRecord = {
  userId: string;
  teamId: string;
  matchId: string;
  season: number;
  startTime: string;
  gameDate?: string | null;
  opponentTeamId: string;
  opponentTeamName: string;
  competitionKey: string;
  competitionLabel: string;
  stageKey?: string | null;
  stageLabel?: string | null;
  venue: string;
  isHome: boolean;
  isTvGame: boolean;
  teamScore: number;
  opponentScore: number;
  margin: number;
  outcome: string;
  rawType?: string | null;
};

export type RivalsBackfillRecord = {
  userId: string;
  teamId: string;
  teamName?: string | null;
  status: RivalsBackfillState;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  executionArn?: string | null;
  failedSeasons?: number[] | null;
  generatedAt?: string | null;
  seasonsScanned?: number | null;
  totalCompletedGames?: number | null;
  totalOpponents?: number | null;
  updatedAt: string;
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

type PreparedModelInput<TRecord> = {
  payload: TRecord;
  removedPaths: string[];
  sanitizedFields: string[];
  namedReferenceDiagnostics: NamedReferenceFieldDiagnostic[];
};

type NamedReferenceFieldDiagnostic = {
  originalKeys: string[];
  path: string;
  removedKeys: string[];
  sanitizedPreview: {
    id: string | null;
    name: string | null;
  };
};

type NamedReferenceFieldViolation = {
  extraKeys: string[];
  keys: string[];
  path: string;
};

const runtime = {
  getClient: getDataClient,
};

export const __testing = {
  describeBbConnectionNamedReferenceViolations,
  prepareModelInput,
  prepareModelInputWithDiagnostics,
  runtime,
};

const REPOSITORY_LOG_PREFIX = "[repository]";
const NAMED_REFERENCE_INPUT_KEYS = new Set(["id", "name"]);
const BB_CONNECTION_NAMED_REFERENCE_PATHS = [
  "profileJson.country",
  "profileJson.league",
  "profileJson.rival",
  "workspaceCacheJson.home.connection.profileJson.country",
  "workspaceCacheJson.home.connection.profileJson.league",
  "workspaceCacheJson.home.connection.profileJson.rival",
  "workspaceCacheJson.home.league.league",
  "workspaceCacheJson.leagueIntel.league",
  "workspaceCacheJson.teamHub.team.country",
  "workspaceCacheJson.teamHub.team.league",
  "workspaceCacheJson.teamHub.team.rival",
] as const;
const UNSUPPORTED_CUSTOM_TYPE_KEYS = new Set(["attributes", "__typename"]);

export async function getBbConnection(
  env: RepositoryEnv,
  userId: string,
): Promise<BbConnectionRecord | null> {
  const model = await getModel<BbConnectionRecord>(env, "BbConnection");
  const result = await model.get({ userId });
  const { legacyErrors, otherErrors } =
    partitionLegacyWorkspaceCacheCoercionErrors(result.errors);

  if (!result.errors?.length) {
    return decodeAwsJsonFields("BbConnection", result.data ?? null);
  }

  if (result.data && legacyErrors.length > 0 && otherErrors.length === 0) {
    const record = decodeAwsJsonFields("BbConnection", result.data);
    return record
      ? {
          ...record,
          workspaceCacheJson: null,
        }
      : null;
  }

  const errorsToReport =
    result.data && legacyErrors.length > 0 ? otherErrors : result.errors;
  throw new Error(
    `load BB connection failed: ${formatClientErrors(errorsToReport)}`,
  );
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

export async function upsertBillingPayment(
  env: RepositoryEnv,
  record: BillingPaymentRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "BillingPayment",
    ["providerObjectType", "providerObjectId"],
    record,
  );
}

export async function listBillingPaymentsByUserId(
  env: RepositoryEnv,
  userId: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<BillingPaymentRecord>> {
  const page = await queryModelIndexPage<BillingPaymentRecord>(
    env,
    "BillingPayment",
    "listBillingPaymentsByUserIdAndOccurredAt",
    { userId },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "DESC",
    },
    "list billing payments",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("BillingPayment", page.records),
  };
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

export async function createFeedbackSubmission(
  env: RepositoryEnv,
  record: FeedbackSubmissionRecord,
): Promise<FeedbackSubmissionRecord> {
  const model = await getModel<FeedbackSubmissionRecord>(
    env,
    "FeedbackSubmission",
  );
  return assertPresent(
    await assertSuccessful(
      model.create(prepareModelInput("FeedbackSubmission", record)),
      "create feedback submission",
    ),
    "create feedback submission",
  );
}

export async function updateFeedbackSubmission(
  env: RepositoryEnv,
  input: Partial<FeedbackSubmissionRecord> &
    Pick<FeedbackSubmissionRecord, "id">,
): Promise<void> {
  const model = await getModel<FeedbackSubmissionRecord>(
    env,
    "FeedbackSubmission",
  );
  await assertSuccessful(
    model.update(prepareModelInput("FeedbackSubmission", input)),
    "update feedback submission",
  );
}

export async function upsertBbConnection(
  env: RepositoryEnv,
  record: BbConnectionRecord,
): Promise<void> {
  console.log("[upsertBbConnection] A");
  const model = await getModel<BbConnectionRecord>(env, "BbConnection");
  console.log("[upsertBbConnection] B");
  const currentRecord = await assertSuccessful(
    model.get({ userId: record.userId }),
    "load BbConnection record",
  );
  console.log("[upsertBbConnection] C");
  const prepared = prepareModelInputWithDiagnostics("BbConnection", record);
  console.log("prepared", prepared);
  const mode = currentRecord ? "update" : "create";
  console.log("[upsertBbConnection] D");
  const namedReferenceViolations = describeBbConnectionNamedReferenceViolations(
    prepared.payload,
  );
  console.log("[upsertBbConnection] E");
  const payloadKeys = Object.keys(prepared.payload).sort();
  console.log("[upsertBbConnection] F");
  logRepositoryInfo("upsertBbConnection.prepare", {
    hasProfileJson: prepared.payload.profileJson != null,
    hasWorkspaceCacheJson: prepared.payload.workspaceCacheJson != null,
    mode,
    namedReferenceDiagnosticCount: prepared.namedReferenceDiagnostics.length,
    namedReferenceDiagnostics: prepared.namedReferenceDiagnostics,
    namedReferenceViolationCount: namedReferenceViolations.length,
    namedReferenceViolations,
    payloadKeys,
    removedPaths: prepared.removedPaths,
    sanitizedFields: prepared.sanitizedFields,
    userId: record.userId,
  });

  try {
    console.log("[upsertBbConnection] F2");
    logRepositoryInfo("upsertBbConnection.mutation", {
      mode,
      namedReferenceDiagnosticCount: prepared.namedReferenceDiagnostics.length,
      namedReferenceDiagnostics: prepared.namedReferenceDiagnostics,
      namedReferenceViolationCount: namedReferenceViolations.length,
      namedReferenceViolations,
      payloadKeys,
      userId: record.userId,
    });
    console.log("[upsertBbConnection] G");
    if (currentRecord) {
      await assertSuccessful(
        model.update(prepared.payload),
        "update BbConnection record",
      );
      console.log("[upsertBbConnection] H");
    } else {
      await assertSuccessful(
        model.create(prepared.payload),
        "create BbConnection record",
      );
      console.log("[upsertBbConnection] I");
    }
  } catch (error) {
    console.log("[upsertBbConnection] J");
    const detailedError = annotateBbConnectionMutationError(
      error,
      prepared.namedReferenceDiagnostics,
      namedReferenceViolations,
    );
    console.log("[upsertBbConnection] K");
    logRepositoryError("upsertBbConnection.failed", {
      hasProfileJson: prepared.payload.profileJson != null,
      hasWorkspaceCacheJson: prepared.payload.workspaceCacheJson != null,
      mode,
      namedReferenceDiagnosticCount: prepared.namedReferenceDiagnostics.length,
      namedReferenceDiagnostics: prepared.namedReferenceDiagnostics,
      namedReferenceViolationCount: namedReferenceViolations.length,
      namedReferenceViolations,
      payloadKeys,
      removedPaths: prepared.removedPaths,
      sanitizedFields: prepared.sanitizedFields,
      userId: record.userId,
      ...toLoggableError(detailedError),
    });
    throw detailedError;
  }

  console.log("[upsertBbConnection] L");
  logRepositoryInfo("upsertBbConnection.completed", {
    hasProfileJson: prepared.payload.profileJson != null,
    hasWorkspaceCacheJson: prepared.payload.workspaceCacheJson != null,
    mode,
    namedReferenceDiagnosticCount: prepared.namedReferenceDiagnostics.length,
    namedReferenceViolationCount: namedReferenceViolations.length,
    payloadKeys,
    removedPaths: prepared.removedPaths,
    sanitizedFields: prepared.sanitizedFields,
    userId: record.userId,
  });
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
  input: Omit<SyncRunRecord, "id" | "expiryKey" | "expiresAt"> & {
    expiryKey?: string | null;
    expiresAt?: string | null;
  },
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

export async function upsertPredictionJob(
  env: RepositoryEnv,
  input: PredictionJobRecord,
): Promise<void> {
  const model = await getModel<PredictionJobRecord>(env, "PredictionJob");
  const currentRecord = await assertSuccessful(
    model.get({ userId: input.userId }),
    "load PredictionJob record",
  );
  const payload = omitUndefinedValues(input);

  if (currentRecord) {
    await assertSuccessful(
      model.update(payload),
      "update PredictionJob record",
    );
    return;
  }

  await assertSuccessful(model.create(payload), "create PredictionJob record");
}

export async function getPredictionJob(
  env: RepositoryEnv,
  userId: string,
): Promise<PredictionJobRecord | null> {
  const record = await getModelRecord<PredictionJobRecord>(
    env,
    "PredictionJob",
    { userId },
    "load prediction job",
  );
  return record;
}

export async function updatePredictionJob(
  env: RepositoryEnv,
  input: Partial<PredictionJobRecord> & Pick<PredictionJobRecord, "userId">,
): Promise<void> {
  const model = await getModel<PredictionJobRecord>(env, "PredictionJob");
  await assertSuccessful(
    model.update(omitUndefinedValues(input)),
    "update prediction job",
  );
}

export async function updatePredictionJobIfRequestMatches(
  env: RepositoryEnv,
  input: Partial<PredictionJobRecord> &
    Pick<PredictionJobRecord, "requestId" | "userId">,
): Promise<boolean> {
  const current = await getPredictionJob(env, input.userId);
  if (!current || current.requestId !== input.requestId) {
    return false;
  }

  await updatePredictionJob(env, input);
  return true;
}

export async function upsertPredictionGridCells(
  env: RepositoryEnv,
  records: readonly PredictionGridCellRecord[],
): Promise<void> {
  for (const record of records) {
    await upsertPredictionGridCell(env, record);
  }
}

async function upsertPredictionGridCell(
  env: RepositoryEnv,
  record: PredictionGridCellRecord,
): Promise<void> {
  const model = await getModel<PredictionGridCellRecord>(
    env,
    "PredictionGridCell",
  );
  const currentRecord = await assertSuccessful(
    model.get({
      awayDefense: record.awayDefense,
      homeOffense: record.homeOffense,
      requestId: record.requestId,
      userId: record.userId,
    }),
    "load PredictionGridCell record",
  );
  const payload = omitUndefinedValues(record);

  if (currentRecord) {
    await assertSuccessful(
      model.update(payload),
      "update PredictionGridCell record",
    );
    return;
  }

  await assertSuccessful(
    model.create(payload),
    "create PredictionGridCell record",
  );
}

export async function listPredictionGridCellsByUserAndRequestId(
  env: RepositoryEnv,
  userId: string,
  requestId: string,
): Promise<PredictionGridCellRecord[]> {
  const records: PredictionGridCellRecord[] = [];
  let nextToken: string | null | undefined = null;

  do {
    const page: PagedRecords<PredictionGridCellRecord> =
      await queryModelIndexPage<PredictionGridCellRecord>(
        env,
        "PredictionGridCell",
        "listPredictionGridCellsByUserIdAndRequestId",
        { requestId: { eq: requestId }, userId },
        {
          limit: 100,
          nextToken,
          sortDirection: "ASC",
        },
        "list prediction grid cells",
      );
    records.push(...page.records);
    nextToken = page.nextToken;
  } while (nextToken);

  return records;
}

export async function deletePredictionGridCellsByUserAndRequestId(
  env: RepositoryEnv,
  userId: string,
  requestId: string,
): Promise<void> {
  const model = await getModel<PredictionGridCellRecord>(
    env,
    "PredictionGridCell",
  );
  const records = await listPredictionGridCellsByUserAndRequestId(
    env,
    userId,
    requestId,
  );

  for (const record of records) {
    await assertSuccessful(
      model.delete({
        awayDefense: record.awayDefense,
        homeOffense: record.homeOffense,
        requestId: record.requestId,
        userId: record.userId,
      }),
      "delete prediction grid cell",
    );
  }
}

export async function createOpponentForecastJob(
  env: RepositoryEnv,
  input: Omit<
    OpponentForecastJobRecord,
    "createdAt" | "updatedAt" | "requestedAt" | "expiryKey" | "expiresAt"
  > & {
    requestedAt?: string | null;
    expiryKey?: string | null;
    expiresAt?: string | null;
  },
): Promise<OpponentForecastJobRecord> {
  const model = await getModel<OpponentForecastJobRecord>(
    env,
    "OpponentForecastJob",
  );
  const now = new Date().toISOString();
  const record = assertPresent(
    await assertSuccessful(
      model.create(
        prepareModelInput("OpponentForecastJob", {
          ...input,
          requestedAt: input.requestedAt ?? now,
          expiryKey: input.expiryKey ?? "EXPIRABLE",
          expiresAt: input.expiresAt ?? addDays(now, 30),
        }),
      ),
      "create opponent forecast job",
    ),
    "create opponent forecast job",
  );

  return decodeAwsJsonFields("OpponentForecastJob", record);
}

export async function getOpponentForecastJob(
  env: RepositoryEnv,
  id: string,
): Promise<OpponentForecastJobRecord | null> {
  const record = await getModelRecord<OpponentForecastJobRecord>(
    env,
    "OpponentForecastJob",
    { id },
    "load opponent forecast job",
  );

  return decodeAwsJsonFields("OpponentForecastJob", record);
}

export async function updateOpponentForecastJob(
  env: RepositoryEnv,
  input: Partial<OpponentForecastJobRecord> &
    Pick<OpponentForecastJobRecord, "id">,
): Promise<void> {
  const model = await getModel<OpponentForecastJobRecord>(
    env,
    "OpponentForecastJob",
  );
  await assertSuccessful(
    model.update(prepareModelInput("OpponentForecastJob", input)),
    "update opponent forecast job",
  );
}

export async function listOpponentForecastJobsByUser(
  env: RepositoryEnv,
  userId: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<OpponentForecastJobRecord>> {
  const page = await queryModelIndexPage<OpponentForecastJobRecord>(
    env,
    "OpponentForecastJob",
    "listOpponentForecastJobsByUserAndRequestedAt",
    { userId },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "DESC",
    },
    "list opponent forecast jobs by user",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("OpponentForecastJob", page.records),
  };
}

export async function listExpiredOpponentForecastJobs(
  env: RepositoryEnv,
  expiresBefore: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<OpponentForecastJobRecord>> {
  const page = await queryModelIndexPage<OpponentForecastJobRecord>(
    env,
    "OpponentForecastJob",
    "listOpponentForecastJobsByExpiryKeyAndExpiresAt",
    {
      expiryKey: "EXPIRABLE",
      expiresAt: { lt: expiresBefore },
    },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list expired opponent forecast jobs",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("OpponentForecastJob", page.records),
  };
}

export async function deleteOpponentForecastJob(
  env: RepositoryEnv,
  id: string,
): Promise<void> {
  const model = await getModel<OpponentForecastJobRecord>(
    env,
    "OpponentForecastJob",
  );
  await assertSuccessful(model.delete({ id }), "delete opponent forecast job");
}

export async function createNextGameRecommendationJob(
  env: RepositoryEnv,
  input: Omit<
    NextGameRecommendationJobRecord,
    "createdAt" | "updatedAt" | "requestedAt" | "expiryKey" | "expiresAt"
  > & {
    requestedAt?: string | null;
    expiryKey?: string | null;
    expiresAt?: string | null;
  },
): Promise<NextGameRecommendationJobRecord> {
  const model = await getModel<NextGameRecommendationJobRecord>(
    env,
    "NextGameRecommendationJob",
  );
  const now = new Date().toISOString();
  const record = assertPresent(
    await assertSuccessful(
      model.create(
        prepareModelInput("NextGameRecommendationJob", {
          ...input,
          requestedAt: input.requestedAt ?? now,
          expiryKey: input.expiryKey ?? "EXPIRABLE",
          expiresAt: input.expiresAt ?? addDays(now, 30),
        }),
      ),
      "create next game recommendation job",
    ),
    "create next game recommendation job",
  );

  return decodeAwsJsonFields("NextGameRecommendationJob", record);
}

export async function getNextGameRecommendationJob(
  env: RepositoryEnv,
  id: string,
): Promise<NextGameRecommendationJobRecord | null> {
  const record = await getModelRecord<NextGameRecommendationJobRecord>(
    env,
    "NextGameRecommendationJob",
    { id },
    "load next game recommendation job",
  );

  return decodeAwsJsonFields("NextGameRecommendationJob", record);
}

export async function updateNextGameRecommendationJob(
  env: RepositoryEnv,
  input: Partial<NextGameRecommendationJobRecord> &
    Pick<NextGameRecommendationJobRecord, "id">,
): Promise<void> {
  const model = await getModel<NextGameRecommendationJobRecord>(
    env,
    "NextGameRecommendationJob",
  );
  await assertSuccessful(
    model.update(prepareModelInput("NextGameRecommendationJob", input)),
    "update next game recommendation job",
  );
}

export async function listNextGameRecommendationJobsByUser(
  env: RepositoryEnv,
  userId: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<NextGameRecommendationJobRecord>> {
  const page = await queryModelIndexPage<NextGameRecommendationJobRecord>(
    env,
    "NextGameRecommendationJob",
    "listNextGameRecommendationJobsByUserAndRequestedAt",
    { userId },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "DESC",
    },
    "list next game recommendation jobs by user",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("NextGameRecommendationJob", page.records),
  };
}

export async function listExpiredNextGameRecommendationJobs(
  env: RepositoryEnv,
  expiresBefore: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<NextGameRecommendationJobRecord>> {
  const page = await queryModelIndexPage<NextGameRecommendationJobRecord>(
    env,
    "NextGameRecommendationJob",
    "listNextGameRecommendationJobsByExpiryKeyAndExpiresAt",
    {
      expiryKey: "EXPIRABLE",
      expiresAt: { lt: expiresBefore },
    },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list expired next game recommendation jobs",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("NextGameRecommendationJob", page.records),
  };
}

export async function deleteNextGameRecommendationJob(
  env: RepositoryEnv,
  id: string,
): Promise<void> {
  const model = await getModel<NextGameRecommendationJobRecord>(
    env,
    "NextGameRecommendationJob",
  );
  await assertSuccessful(
    model.delete({ id }),
    "delete next game recommendation job",
  );
}

export async function upsertNextGamePlannerArtifact(
  env: RepositoryEnv,
  input: NextGamePlannerArtifactRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "NextGamePlannerArtifact",
    ["artifactKey"],
    input,
  );
}

export async function getNextGamePlannerArtifact(
  env: RepositoryEnv,
  artifactKey: string,
): Promise<NextGamePlannerArtifactRecord | null> {
  const record = await getModelRecord<NextGamePlannerArtifactRecord>(
    env,
    "NextGamePlannerArtifact",
    { artifactKey },
    "load next game planner artifact",
  );

  return decodeAwsJsonFields("NextGamePlannerArtifact", record);
}

export async function upsertNextGamePlannerArtifactRows(
  env: RepositoryEnv,
  records: readonly NextGamePlannerArtifactRowRecord[],
): Promise<void> {
  for (const record of records) {
    await upsertModelRecord(
      env,
      "NextGamePlannerArtifactRow",
      ["artifactKey", "viewId", "opponentPairId"],
      record,
    );
  }
}

export async function listNextGamePlannerArtifactRowsByArtifactKey(
  env: RepositoryEnv,
  artifactKey: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<NextGamePlannerArtifactRowRecord>> {
  const page = await queryModelIndexPage<NextGamePlannerArtifactRowRecord>(
    env,
    "NextGamePlannerArtifactRow",
    "listNextGamePlannerArtifactRowsByArtifactKeyAndRowOrder",
    { artifactKey },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list next game planner artifact rows",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("NextGamePlannerArtifactRow", page.records),
  };
}

export async function listExpiredNextGamePlannerArtifacts(
  env: RepositoryEnv,
  expiresBefore: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<NextGamePlannerArtifactRecord>> {
  const page = await queryModelIndexPage<NextGamePlannerArtifactRecord>(
    env,
    "NextGamePlannerArtifact",
    "listNextGamePlannerArtifactsByExpiryKeyAndExpiresAt",
    {
      expiryKey: "EXPIRABLE",
      expiresAt: { lt: expiresBefore },
    },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list expired next game planner artifacts",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("NextGamePlannerArtifact", page.records),
  };
}

export async function deleteNextGamePlannerArtifact(
  env: RepositoryEnv,
  artifactKey: string,
): Promise<void> {
  const model = await getModel<NextGamePlannerArtifactRecord>(
    env,
    "NextGamePlannerArtifact",
  );
  await assertSuccessful(
    model.delete({ artifactKey }),
    "delete next game planner artifact",
  );
}

export async function deleteNextGamePlannerArtifactRow(
  env: RepositoryEnv,
  input: Pick<
    NextGamePlannerArtifactRowRecord,
    "artifactKey" | "viewId" | "opponentPairId"
  >,
): Promise<void> {
  const model = await getModel<NextGamePlannerArtifactRowRecord>(
    env,
    "NextGamePlannerArtifactRow",
  );
  await assertSuccessful(
    model.delete(input),
    "delete next game planner artifact row",
  );
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
): Promise<MatchBoxscoreRecord | null> {
  const result = await readMatchBoxscoreCacheRecord(env, userId, matchId);
  if (result.status === "hit") {
    return result.record;
  }

  if (result.status === "unreadable") {
    console.warn(
      "[repository] Treating unreadable MatchBoxscore cache row as a cache miss.",
      {
        errorMessage: result.errorMessage,
        matchId,
        userId,
      },
    );
  }

  return null;
}

export async function readMatchBoxscoreCacheRecord(
  env: RepositoryEnv,
  userId: string,
  matchId: string,
): Promise<MatchBoxscoreCacheReadResult> {
  try {
    const record = await getModelRecord<MatchBoxscoreRecord>(
      env,
      "MatchBoxscore",
      { userId, matchId },
      "load match boxscore",
    );
    if (!record) {
      return {
        status: "missing",
      };
    }

    return {
      status: "hit",
      record: decodeAwsJsonFields("MatchBoxscore", record),
    };
  } catch (error) {
    if (isLegacyMatchBoxscoreCacheReadFailure(error)) {
      return {
        status: "unreadable",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    throw error;
  }
}

export async function listTrackedTeamsForUser(
  env: RepositoryEnv,
  userId: string,
): Promise<TrackedTeamRecord[]> {
  const records: TrackedTeamRecord[] = [];
  let nextToken: string | null = null;

  do {
    const page: PagedRecords<TrackedTeamRecord> =
      await queryModelIndexPage<TrackedTeamRecord>(
        env,
        "TrackedTeam",
        "listTrackedTeamsByUserIdAndTeamId",
        { userId },
        {
          limit: 100,
          nextToken,
          sortDirection: "ASC",
        },
        "list tracked teams",
      );
    const decodedPageRecords = decodeAwsJsonList("TrackedTeam", page.records);
    records.push(...decodedPageRecords);
    nextToken = page.nextToken;
  } while (nextToken);

  return records;
}

export async function upsertTrackedTeam(
  env: RepositoryEnv,
  input: TrackedTeamRecord,
): Promise<void> {
  await upsertModelRecord(env, "TrackedTeam", ["userId", "teamId"], input);
}

export async function upsertTrackedPlayer(
  env: RepositoryEnv,
  input: TrackedPlayerRecord,
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
): Promise<TrackedPlayerRecord | null> {
  const record = await getModelRecord<TrackedPlayerRecord>(
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
  input: TrackedMatchRecord,
): Promise<void> {
  await upsertModelRecord(env, "TrackedMatch", ["userId", "matchId"], input);
}

export async function upsertMatchBoxscore(
  env: RepositoryEnv,
  input: MatchBoxscoreRecord,
): Promise<void> {
  await upsertModelRecord(env, "MatchBoxscore", ["userId", "matchId"], input);
}

export async function upsertArenaPricingSnapshot(
  env: RepositoryEnv,
  input: ArenaPricingSnapshotRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "ArenaPricingSnapshot",
    ["userId", "capturedAt"],
    input,
  );
}

export async function listArenaPricingSnapshotsByUserId(
  env: RepositoryEnv,
  userId: string,
  limit = 30,
): Promise<ArenaPricingSnapshotRecord[]> {
  const records: ArenaPricingSnapshotRecord[] = [];
  let nextToken: string | null = null;

  do {
    const page: PagedRecords<ArenaPricingSnapshotRecord> =
      await queryModelIndexPage<ArenaPricingSnapshotRecord>(
        env,
        "ArenaPricingSnapshot",
        "listArenaPricingSnapshotsByUserIdAndCapturedAt",
        { userId },
        {
          limit: Math.max(1, limit - records.length),
          nextToken,
          sortDirection: "DESC",
        },
        "list arena pricing snapshots",
      );
    records.push(...decodeAwsJsonList("ArenaPricingSnapshot", page.records));
    nextToken = page.nextToken;
  } while (nextToken && records.length < limit);

  return records.slice(0, limit);
}

export async function upsertLeagueStanding(
  env: RepositoryEnv,
  input: LeagueStandingRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "LeagueStanding",
    ["userId", "season", "teamId"],
    input,
  );
}

export async function getLeagueHistoryBackfill(
  env: RepositoryEnv,
  leagueId: string,
): Promise<LeagueHistoryBackfillRecord | null> {
  return getModelRecord<LeagueHistoryBackfillRecord>(
    env,
    "LeagueHistoryBackfill",
    { leagueId },
    "load league history backfill",
  );
}

export async function upsertLeagueHistoryBackfill(
  env: RepositoryEnv,
  input: LeagueHistoryBackfillRecord,
): Promise<void> {
  await upsertModelRecord(env, "LeagueHistoryBackfill", ["leagueId"], input);
}

export async function upsertLeagueHistoryStandingCache(
  env: RepositoryEnv,
  input: LeagueHistoryStandingCacheRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "LeagueHistoryStandingCache",
    ["leagueId", "season", "teamId"],
    input,
  );
}

export async function listLeagueHistoryStandingCachesByLeagueId(
  env: RepositoryEnv,
  leagueId: string,
  input: {
    limit?: number;
    nextToken?: string | null;
  } = {},
): Promise<PagedRecords<LeagueHistoryStandingCacheRecord>> {
  const page = await queryModelIndexPage<LeagueHistoryStandingCacheRecord>(
    env,
    "LeagueHistoryStandingCache",
    "listLeagueHistoryStandingCachesByLeagueIdAndSeason",
    { leagueId },
    {
      limit: input.limit,
      nextToken: input.nextToken,
      sortDirection: "ASC",
    },
    "list league history standing caches",
  );

  return {
    nextToken: page.nextToken,
    records: decodeAwsJsonList("LeagueHistoryStandingCache", page.records),
  };
}

export async function getRivalsWorkspaceCache(
  env: RepositoryEnv,
  userId: string,
  teamId: string,
): Promise<RivalsWorkspaceCacheRecord | null> {
  const record = await getModelRecord<RivalsWorkspaceCacheRecord>(
    env,
    "RivalsWorkspaceCache",
    { teamId, userId },
    "load rivals workspace cache",
  );

  return decodeAwsJsonFields("RivalsWorkspaceCache", record);
}

export async function upsertRivalsWorkspaceCache(
  env: RepositoryEnv,
  input: RivalsWorkspaceCacheRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "RivalsWorkspaceCache",
    ["userId", "teamId"],
    input,
  );
}

export async function listRivalryMatchFactsByUserAndTeamId(
  env: RepositoryEnv,
  userId: string,
  teamId: string,
): Promise<RivalryMatchFactRecord[]> {
  const records: RivalryMatchFactRecord[] = [];
  let nextToken: string | null | undefined = null;

  do {
    const page: PagedRecords<RivalryMatchFactRecord> =
      await queryModelIndexPage<RivalryMatchFactRecord>(
        env,
        "RivalryMatchFact",
        "listRivalryMatchFactsByUserIdAndTeamIdAndStartTime",
        { teamId: { eq: teamId }, userId },
        {
          limit: 200,
          nextToken,
          sortDirection: "DESC",
        },
        "list rivalry match facts",
      );
    records.push(...page.records);
    nextToken = page.nextToken;
  } while (nextToken);

  return records;
}

export async function upsertRivalryMatchFact(
  env: RepositoryEnv,
  input: RivalryMatchFactRecord,
): Promise<void> {
  await upsertModelRecord(
    env,
    "RivalryMatchFact",
    ["userId", "teamId", "matchId"],
    input,
  );
}

export async function deleteRivalryMatchFact(
  env: RepositoryEnv,
  input: Pick<RivalryMatchFactRecord, "userId" | "teamId" | "matchId">,
): Promise<void> {
  const model = await getModel<RivalryMatchFactRecord>(env, "RivalryMatchFact");
  await assertSuccessful(
    model.delete({
      matchId: input.matchId,
      teamId: input.teamId,
      userId: input.userId,
    }),
    "delete rivalry match fact",
  );
}

export async function getRivalsBackfill(
  env: RepositoryEnv,
  userId: string,
  teamId: string,
): Promise<RivalsBackfillRecord | null> {
  const record = await getModelRecord<RivalsBackfillRecord>(
    env,
    "RivalsBackfill",
    { teamId, userId },
    "load rivals backfill",
  );

  if (!record) {
    return null;
  }

  return {
    ...record,
    failedSeasons: normalizeIntegerArray(record.failedSeasons),
  };
}

export async function upsertRivalsBackfill(
  env: RepositoryEnv,
  input: RivalsBackfillRecord,
): Promise<void> {
  await upsertModelRecord(env, "RivalsBackfill", ["userId", "teamId"], input);
}

export async function createSharedPlayerCard(
  env: RepositoryEnv,
  input: SharedPlayerCardRecord,
): Promise<void> {
  const model = await getModel<SharedPlayerCardRecord>(env, "SharedPlayerCard");
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
  modelName: string,
  identifierFields: readonly string[],
  input: Record<string, unknown>,
): Promise<void> {
  const model = await getModel<Record<string, unknown>>(env, modelName);
  const identifier = pickFields(input, identifierFields);
  const payload = prepareModelInput(modelName, input);
  let currentRecord: Record<string, unknown> | null;

  try {
    currentRecord = await assertSuccessful(
      model.get(identifier),
      `load ${modelName} record`,
    );
  } catch (error) {
    if (canOverwriteUnreadableMatchBoxscoreRecord(modelName, error)) {
      console.warn(
        "[repository] Overwriting unreadable MatchBoxscore cache row during upsert.",
        {
          errorMessage: error instanceof Error ? error.message : String(error),
          identifier,
        },
      );
      await assertSuccessful(
        model.update(payload),
        `update ${modelName} record`,
      );
      return;
    }
    throw error;
  }

  if (currentRecord) {
    await assertSuccessful(model.update(payload), `update ${modelName} record`);
    return;
  }

  await assertSuccessful(model.create(payload), `create ${modelName} record`);
}

function prepareModelInput<TRecord extends Record<string, unknown>>(
  modelName: string,
  input: TRecord,
): TRecord {
  return prepareModelInputWithDiagnostics(modelName, input).payload;
}

function prepareModelInputWithDiagnostics<
  TRecord extends Record<string, unknown>,
>(modelName: string, input: TRecord): PreparedModelInput<TRecord> {
  const sanitized = sanitizeModelInput(modelName, input);

  return {
    payload: omitUndefinedValues(
      encodeAwsJsonFields(modelName, sanitized.input),
    ),
    namedReferenceDiagnostics: sanitized.namedReferenceDiagnostics,
    removedPaths: sanitized.removedPaths,
    sanitizedFields: sanitized.sanitizedFields,
  };
}

function sanitizeModelInput<TRecord extends Record<string, unknown>>(
  modelName: string,
  input: TRecord,
): {
  input: TRecord;
  namedReferenceDiagnostics: NamedReferenceFieldDiagnostic[];
  removedPaths: string[];
  sanitizedFields: string[];
} {
  if (modelName === "BbConnection") {
    return sanitizeBbConnectionInput(input);
  }
  if (modelName === "TrackedTeam") {
    return sanitizeTrackedTeamInput(input);
  }
  if (modelName === "TrackedPlayer") {
    return sanitizeTrackedPlayerInput(input);
  }

  return {
    input,
    namedReferenceDiagnostics: [],
    removedPaths: [],
    sanitizedFields: [],
  };
}

function sanitizeBbConnectionInput<TRecord extends Record<string, unknown>>(
  input: TRecord,
): {
  input: TRecord;
  namedReferenceDiagnostics: NamedReferenceFieldDiagnostic[];
  removedPaths: string[];
  sanitizedFields: string[];
} {
  const sanitized = sanitizeNestedAttributes(input, [
    "profileJson",
    "workspaceCacheJson",
  ]);

  return sanitizeBbConnectionNamedReferencePaths(
    sanitized.input,
    sanitized.removedPaths,
    sanitized.sanitizedFields,
  );
}

function sanitizeTrackedTeamInput<TRecord extends Record<string, unknown>>(
  input: TRecord,
): {
  input: TRecord;
  namedReferenceDiagnostics: NamedReferenceFieldDiagnostic[];
  removedPaths: string[];
  sanitizedFields: string[];
} {
  const sanitized = sanitizeNestedAttributes(input, ["summaryJson"]);

  return {
    ...sanitized,
    namedReferenceDiagnostics: [],
  };
}

function sanitizeTrackedPlayerInput<TRecord extends Record<string, unknown>>(
  input: TRecord,
): {
  input: TRecord;
  namedReferenceDiagnostics: NamedReferenceFieldDiagnostic[];
  removedPaths: string[];
  sanitizedFields: string[];
} {
  const sanitized = sanitizeNestedAttributes(input, ["profileJson"]);

  return {
    ...sanitized,
    namedReferenceDiagnostics: [],
  };
}

function sanitizeNestedAttributes<TRecord extends Record<string, unknown>>(
  input: TRecord,
  fieldNames: readonly string[],
): {
  input: TRecord;
  removedPaths: string[];
  sanitizedFields: string[];
} {
  let updated: Record<string, unknown> | null = null;
  const removedPaths: string[] = [];
  const sanitizedFields: string[] = [];

  for (const fieldName of fieldNames) {
    if (!(fieldName in input)) {
      continue;
    }

    const currentValue = input[fieldName];
    const nextValue = stripAttributesDeep(
      currentValue,
      fieldName,
      removedPaths,
    );

    if (nextValue === currentValue) {
      continue;
    }

    updated ??= { ...input };
    updated[fieldName] = nextValue;
    sanitizedFields.push(fieldName);
  }

  return {
    input: (updated ?? input) as TRecord,
    removedPaths,
    sanitizedFields,
  };
}

function stripAttributesDeep(
  value: unknown,
  path: string,
  removedPaths: string[],
): unknown {
  if (Array.isArray(value)) {
    let updated: unknown[] | null = null;

    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      const nextEntry = stripAttributesDeep(
        entry,
        `${path}[${index}]`,
        removedPaths,
      );
      if (nextEntry === entry) {
        continue;
      }

      updated ??= [...value];
      updated[index] = nextEntry;
    }

    return updated ?? value;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  let updated: Record<string, unknown> | null = null;

  for (const [key, entry] of Object.entries(source)) {
    if (UNSUPPORTED_CUSTOM_TYPE_KEYS.has(key)) {
      updated ??= { ...source };
      delete updated[key];
      removedPaths.push(`${path}.${key}`);
      continue;
    }

    const nextEntry = stripAttributesDeep(
      entry,
      `${path}.${key}`,
      removedPaths,
    );
    if (nextEntry === entry) {
      continue;
    }

    updated ??= { ...source };
    updated[key] = nextEntry;
  }

  return updated ?? value;
}

function describeBbConnectionNamedReferenceViolations(
  payload: Record<string, unknown>,
): NamedReferenceFieldViolation[] {
  const violations: NamedReferenceFieldViolation[] = [];

  for (const path of BB_CONNECTION_NAMED_REFERENCE_PATHS) {
    const value = readNestedValue(payload, path);
    if (!isRecord(value)) {
      continue;
    }

    const keys = Object.keys(value).sort();
    const extraKeys = keys.filter((key) => !NAMED_REFERENCE_INPUT_KEYS.has(key));
    if (!extraKeys.length) {
      continue;
    }

    violations.push({
      extraKeys,
      keys,
      path,
    });
  }

  return violations;
}

function annotateBbConnectionMutationError(
  error: unknown,
  diagnostics: readonly NamedReferenceFieldDiagnostic[],
  violations: readonly NamedReferenceFieldViolation[],
): Error {
  const baseError =
    error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
  if (
    !baseError.message.includes("NamedReferenceInput") ||
    (diagnostics.length === 0 && violations.length === 0)
  ) {
    return baseError;
  }

  const detailParts: string[] = [];
  if (diagnostics.length > 0) {
    detailParts.push(
      diagnostics
        .map(
          ({ originalKeys, path, removedKeys, sanitizedPreview }) =>
            `${path} removed unsupported key(s) [${removedKeys.join(", ")}] (keys: ${originalKeys.join(", ")}, sanitized preview: ${JSON.stringify(sanitizedPreview)})`,
        )
        .join("; "),
    );
  }
  if (violations.length > 0) {
    detailParts.push(
      violations
        .map(
          ({ extraKeys, keys, path }) =>
            `${path} still has unsupported key(s) [${extraKeys.join(", ")}] (keys: ${keys.join(", ")})`,
        )
        .join("; "),
    );
  }
  const details = detailParts.join("; ");
  if (!details || baseError.message.includes(details)) {
    return baseError;
  }

  const annotated = new Error(`${baseError.message} Likely paths: ${details}`);
  if (baseError.stack) {
    annotated.stack = `${annotated.name}: ${annotated.message}\n${baseError.stack
      .split("\n")
      .slice(1)
      .join("\n")}`;
  }
  return annotated;
}

function sanitizeBbConnectionNamedReferencePaths<
  TRecord extends Record<string, unknown>,
>(
  input: TRecord,
  removedPaths: readonly string[],
  sanitizedFields: readonly string[],
): {
  input: TRecord;
  namedReferenceDiagnostics: NamedReferenceFieldDiagnostic[];
  removedPaths: string[];
  sanitizedFields: string[];
} {
  let updated: Record<string, unknown> | null = null;
  const nextRemovedPaths = [...removedPaths];
  const nextSanitizedFields = [...sanitizedFields];
  const namedReferenceDiagnostics: NamedReferenceFieldDiagnostic[] = [];

  for (const path of BB_CONNECTION_NAMED_REFERENCE_PATHS) {
    const currentValue = readNestedValue(updated ?? input, path);
    if (!isRecord(currentValue)) {
      continue;
    }

    const originalKeys = Object.keys(currentValue).sort();
    const removedKeys = originalKeys.filter(
      (key) => !NAMED_REFERENCE_INPUT_KEYS.has(key),
    );
    if (!removedKeys.length) {
      continue;
    }

    namedReferenceDiagnostics.push({
      originalKeys,
      path,
      removedKeys,
      sanitizedPreview: buildNamedReferencePreview(currentValue),
    });

    for (const key of removedKeys) {
      nextRemovedPaths.push(`${path}.${key}`);
    }
    pushUnique(nextSanitizedFields, path.split(".")[0] ?? path);
    updated = replaceNestedValue(
      updated ?? input,
      path,
      buildNamedReferencePreview(currentValue),
    );
  }

  return {
    input: (updated ?? input) as TRecord,
    namedReferenceDiagnostics,
    removedPaths: nextRemovedPaths,
    sanitizedFields: nextSanitizedFields,
  };
}

function buildNamedReferencePreview(value: Record<string, unknown>): {
  id: string | null;
  name: string | null;
} {
  return {
    id: typeof value.id === "string" ? value.id : null,
    name: typeof value.name === "string" ? value.name : null,
  };
}

function replaceNestedValue<TValue>(
  value: TValue,
  path: string,
  replacement: unknown,
): TValue {
  return replaceNestedValueAtSegments(
    value,
    path.split("."),
    replacement,
  ) as TValue;
}

function replaceNestedValueAtSegments(
  value: unknown,
  segments: readonly string[],
  replacement: unknown,
): unknown {
  if (segments.length === 0) {
    return replacement;
  }
  if (!isRecord(value)) {
    return value;
  }

  const [segment, ...rest] = segments;
  if (segment === undefined) {
    return value;
  }
  const currentValue = value[segment];
  const nextValue =
    rest.length === 0
      ? replacement
      : replaceNestedValueAtSegments(currentValue, rest, replacement);
  if (nextValue === currentValue) {
    return value;
  }

  return {
    ...value,
    [segment]: nextValue,
  };
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNestedValue(value: unknown, path: string): unknown {
  let current = value;

  for (const segment of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function logRepositoryInfo(
  event: string,
  details: Record<string, unknown>,
): void {
  writeRepositoryLog("INFO", event, details);
}

function logRepositoryError(
  event: string,
  details: Record<string, unknown>,
): void {
  writeRepositoryLog("ERROR", event, details);
}

function writeRepositoryLog(
  level: "INFO" | "ERROR",
  event: string,
  details: Record<string, unknown>,
): void {
  const line = `${REPOSITORY_LOG_PREFIX} ${JSON.stringify({
    details,
    event,
    level,
    loggedAt: new Date().toISOString(),
  })}`;

  if (level === "INFO") {
    console.log(line);
    return;
  }

  console.error(line);
}

function toLoggableError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      error: String(error),
    };
  }

  return {
    errorMessage: error.message,
    errorName: error.name,
    ...(error.stack ? { errorStack: error.stack } : {}),
  };
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

  throw new Error(`${context} failed: ${formatClientErrors(result.errors)}`);
}

function formatClientErrors(
  errors: ReadonlyArray<ClientError> | null | undefined,
): string {
  return (errors ?? [])
    .map((error) => error.message ?? "Unknown Amplify data client error")
    .join("; ");
}

function assertPresent<TData>(value: TData | null, context: string): TData {
  if (value !== null) {
    return value;
  }

  throw new Error(`${context} failed: Amplify data client returned no data.`);
}

function isLegacyMatchBoxscoreCacheReadFailure(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return (
    (errorMessage.includes("load match boxscore failed:") ||
      errorMessage.includes("load MatchBoxscore record failed:")) &&
    errorMessage.includes("/getMatchBoxscore/boxscoreJson") &&
    (errorMessage.includes("type mismatch error") ||
      errorMessage.includes("Cannot return null for non-nullable type"))
  );
}

function canOverwriteUnreadableMatchBoxscoreRecord(
  modelName: string,
  error: unknown,
): boolean {
  return (
    modelName === "MatchBoxscore" &&
    isLegacyMatchBoxscoreCacheReadFailure(error)
  );
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

function normalizeIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is number => Number.isInteger(entry));
}

function addDays(value: string, days: number): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  return new Date(parsed.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
