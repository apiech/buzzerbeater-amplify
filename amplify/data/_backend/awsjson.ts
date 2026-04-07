const AWS_JSON_FIELDS = {
  BillingAccount: [],
  BillingPayment: [],
  UserPreference: [],
  BbConnection: ["profileJson", "workspaceCacheJson"],
  TrackedTeam: ["summaryJson"],
  TrackedPlayer: ["profileJson"],
  PlayerSkillObservation: [],
  TrackedMatch: ["matchJson"],
  MatchBoxscore: ["boxscoreJson"],
  LeagueStanding: ["standingJson"],
  LeagueHistoryStandingCache: [],
  LeagueHistoryBackfill: [],
  SyncRun: ["detailsJson"],
  SharedPlayerCard: ["payloadJson"],
  OpponentForecastJob: ["requestJson", "resolvedContextJson", "resultJson"],
  GameDayRecap: ["requestJson", "coverageJson", "resultJson"],
  LeagueGameDayRecap: ["requestJson", "coverageJson", "resultJson"],
  SingleGameSummary: ["requestJson", "coverageJson", "resultJson"],
} as const;

export type AwsJsonModelName = keyof typeof AWS_JSON_FIELDS;

type JsonRecord = Record<string, unknown>;

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
  modelName: AwsJsonModelName,
  record: TRecord,
): TRecord {
  return transformAwsJsonFields(modelName, record, encodeAwsJsonValue);
}

export function decodeAwsJsonFields<TRecord>(
  modelName: AwsJsonModelName,
  record: TRecord,
): TRecord {
  return transformAwsJsonFields(modelName, record, decodeAwsJsonValue);
}

export function decodeAwsJsonList<TRecord>(
  modelName: AwsJsonModelName,
  records: readonly TRecord[],
): TRecord[] {
  return records.map((record) => decodeAwsJsonFields(modelName, record));
}

function transformAwsJsonFields<TRecord>(
  modelName: AwsJsonModelName,
  record: TRecord,
  transform: (value: unknown) => unknown,
): TRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }

  const source = record as JsonRecord;
  let updated: JsonRecord | null = null;

  for (const field of AWS_JSON_FIELDS[modelName]) {
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
