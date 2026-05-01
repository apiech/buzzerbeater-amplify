const ENCODED_AWS_JSON_FIELDS = {
  BillingAccount: [],
  BillingPayment: [],
  UserPreference: [],
  BbConnection: [],
  TrackedTeam: [],
  TrackedPlayer: [],
  PlayerSkillObservation: [],
  TrackedMatch: [],
  MatchBoxscore: [],
  ArenaPricingSnapshot: [],
  LeagueStanding: [],
  LeagueHistoryStandingCache: [],
  LeagueHistoryBackfill: [],
  RivalsWorkspaceCache: [],
  RivalryMatchFact: [],
  SyncRun: ["detailsJson"],
  SharedPlayerCard: [],
  OpponentForecastJob: [],
  NextGameRecommendationJob: [],
  LeagueSeasonSimulationJob: [],
  LeagueSeasonSimulationArtifact: ["payloadJson"],
  NextGamePlannerArtifact: [],
  NextGamePlannerArtifactRow: [],
  GameDayRecap: [],
  LeagueGameDayRecap: [],
  SingleGameSummary: [],
} as const;

const LEGACY_DECODE_AWS_JSON_FIELDS = {
  BillingAccount: [],
  BillingPayment: [],
  UserPreference: [],
  BbConnection: ["profileJson", "workspaceCacheJson"],
  TrackedTeam: ["summaryJson"],
  TrackedPlayer: ["profileJson"],
  PlayerSkillObservation: [],
  TrackedMatch: [],
  MatchBoxscore: ["boxscoreJson"],
  ArenaPricingSnapshot: [],
  LeagueStanding: [],
  LeagueHistoryStandingCache: [],
  LeagueHistoryBackfill: [],
  RivalsWorkspaceCache: ["summaryJson", "matchesJson"],
  RivalryMatchFact: [],
  SyncRun: ["detailsJson"],
  SharedPlayerCard: ["payloadJson"],
  OpponentForecastJob: ["requestJson", "resolvedContextJson", "resultJson"],
  NextGameRecommendationJob: ["requestJson", "progressJson", "resultJson"],
  LeagueSeasonSimulationJob: ["requestJson", "progressJson", "resultJson"],
  LeagueSeasonSimulationArtifact: ["payloadJson"],
  NextGamePlannerArtifact: [
    "evaluatedScenariosJson",
    "ourPairsJson",
    "opponentPairsJson",
  ],
  NextGamePlannerArtifactRow: ["rowJson"],
  GameDayRecap: ["requestJson", "coverageJson", "resultJson"],
  LeagueGameDayRecap: ["requestJson", "coverageJson", "resultJson"],
  SingleGameSummary: ["requestJson", "coverageJson", "resultJson"],
} as const;

type JsonRecord = Record<string, unknown>;
const encodedAwsJsonFieldsByModel = ENCODED_AWS_JSON_FIELDS as Record<
  string,
  readonly string[]
>;
const legacyDecodeAwsJsonFieldsByModel =
  LEGACY_DECODE_AWS_JSON_FIELDS as Record<string, readonly string[]>;

export function encodeAwsJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  return JSON.stringify(value);
}

export function decodeAwsJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function encodeAwsJsonFields<TRecord>(
  modelName: string,
  record: TRecord,
): TRecord {
  return transformAwsJsonFields(
    encodedAwsJsonFieldsByModel,
    modelName,
    record,
    encodeAwsJsonValue,
  );
}

export function decodeAwsJsonFields<TRecord>(
  modelName: string,
  record: TRecord,
): TRecord {
  return transformAwsJsonFields(
    legacyDecodeAwsJsonFieldsByModel,
    modelName,
    record,
    decodeAwsJsonValue,
  );
}

export function decodeAwsJsonList<TRecord>(
  modelName: string,
  records: readonly TRecord[],
): TRecord[] {
  return records.map((record) => decodeAwsJsonFields(modelName, record));
}

function transformAwsJsonFields<TRecord>(
  fieldsByModel: Record<string, readonly string[]>,
  modelName: string,
  record: TRecord,
  transform: (value: unknown) => unknown,
): TRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }

  const source = record as JsonRecord;
  let updated: JsonRecord | null = null;

  for (const field of fieldsByModel[modelName] ?? []) {
    if (!(field in source)) {
      continue;
    }

    const currentValue = source[field];
    const nextValue = transform(currentValue);
    if (nextValue === currentValue) {
      continue;
    }

    updated ??= { ...source };
    updated[field] = nextValue;
  }

  return (updated ?? record) as TRecord;
}
