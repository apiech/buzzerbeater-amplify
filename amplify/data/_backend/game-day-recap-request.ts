import type { Schema } from "../resource";
import {
  RecapGenerationApproach,
  RecapInterviewIntensity,
} from "../schema-enums";
import {
  isInterviewPersonalityType,
  type InterviewPersonalityType,
} from "../../../lib/interview-personalities";

type JsonRecord = Record<string, unknown>;

export type GameDayRecapSubmissionRequest = NonNullable<
  Schema["submitGameDayRecap"]["args"]
>;

export type LeagueGameDayRecapSubmissionRequest = NonNullable<
  Schema["submitLeagueGameDayRecap"]["args"]
> & {
  season: number | null;
};

export type LeagueGameDayPerformancesSubmissionRequest = NonNullable<
  Schema["submitLeagueGameDayPerformances"]["args"]
> & {
  season: number | null;
};

export type SingleGameSummarySubmissionRequest = Omit<
  NonNullable<Schema["submitSingleGameSummary"]["args"]>,
  "loserInterviewPersonalityType" | "winnerInterviewPersonalityType"
> & {
  loserInterviewPersonalityType?: InterviewPersonalityType;
  winnerInterviewPersonalityType?: InterviewPersonalityType;
};

export type RecapGenerationApproachValue = RecapGenerationApproach;
export type RecapInterviewIntensityValue = RecapInterviewIntensity;

export type RecapJobKind =
  | "LEAGUE_DATE"
  | "LEAGUE_GAME_DAY"
  | "LEAGUE_GAME_DAY_PERFORMANCES"
  | "SINGLE_GAME";
export type RecapQualityTier = "standard" | "premium";

export type RecapQueueMessage = {
  interviewIntensity: RecapInterviewIntensityValue;
  kind: RecapJobKind;
  modelId?: string;
  modelJudgeEnabled: boolean;
  qualityTier: RecapQualityTier;
  requestedAt: string;
  targetKey: string;
  userId: string;
};

export function normalizeGameDayRecapRequest(
  input: unknown,
): GameDayRecapSubmissionRequest {
  const record = requireRecord(input, "Game day recap request");
  const approach = normalizeRecapGenerationApproach(
    record.approach,
    RecapGenerationApproach.FACT_LIBRARY_FIRST,
  );
  const leagueId = asOptionalString(record.leagueId)?.trim();
  const gameDate = asOptionalString(record.gameDate)?.trim();
  const interviewIntensity = normalizeRecapInterviewIntensity(
    record.interviewIntensity,
  );
  const modelJudgeEnabled = normalizeModelJudgeEnabled(
    record.modelJudgeEnabled,
  );
  const qualityTier = normalizeRequestedRecapQualityTier(record.qualityTier);

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
    approach,
    gameDate,
    interviewIntensity,
    leagueId,
    modelJudgeEnabled,
    ...(qualityTier ? { qualityTier } : {}),
  };
}

export function normalizeLeagueGameDayRecapRequest(
  input: unknown,
): LeagueGameDayRecapSubmissionRequest {
  const record = requireRecord(input, "League game day recap request");
  const approach = normalizeRecapGenerationApproach(
    record.approach,
    RecapGenerationApproach.FACT_LIBRARY_FIRST,
  );
  const leagueId = asOptionalString(record.leagueId)?.trim();
  const gameDayNumber = asOptionalNumber(record.gameDayNumber);
  const interviewIntensity = normalizeRecapInterviewIntensity(
    record.interviewIntensity,
  );
  const modelJudgeEnabled = normalizeModelJudgeEnabled(
    record.modelJudgeEnabled,
  );
  const qualityTier = normalizeRequestedRecapQualityTier(record.qualityTier);
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
    approach,
    gameDayNumber,
    interviewIntensity,
    leagueId,
    modelJudgeEnabled,
    ...(qualityTier ? { qualityTier } : {}),
    season,
  };
}

export function normalizeLeagueGameDayPerformancesRequest(
  input: unknown,
): LeagueGameDayPerformancesSubmissionRequest {
  const request = normalizeLeagueGameDayRecapRequest(input);
  return {
    gameDayNumber: request.gameDayNumber,
    leagueId: request.leagueId,
    season: request.season,
  };
}

export function normalizeSingleGameSummaryRequest(
  input: unknown,
): SingleGameSummarySubmissionRequest {
  const record = requireRecord(input, "Single game summary request");
  const approach = normalizeRecapGenerationApproach(
    record.approach,
    RecapGenerationApproach.FACT_LIBRARY_FIRST,
  );
  const matchId = asOptionalString(record.matchId)?.trim();
  const interviewIntensity = normalizeRecapInterviewIntensity(
    record.interviewIntensity,
  );
  const modelJudgeEnabled = normalizeModelJudgeEnabled(
    record.modelJudgeEnabled,
  );
  const qualityTier = normalizeRequestedRecapQualityTier(record.qualityTier);
  const winnerInterviewPersonalityType =
    normalizeRequestedInterviewPersonalityType(
      record.winnerInterviewPersonalityType,
      "winnerInterviewPersonalityType",
    );
  const loserInterviewPersonalityType = normalizeRequestedInterviewPersonalityType(
    record.loserInterviewPersonalityType,
    "loserInterviewPersonalityType",
  );
  if (!matchId || !/^\d+$/.test(matchId)) {
    throw new Error("Single game summaries require a numeric matchId.");
  }

  return {
    approach,
    interviewIntensity,
    ...(loserInterviewPersonalityType
      ? { loserInterviewPersonalityType }
      : {}),
    matchId,
    modelJudgeEnabled,
    ...(qualityTier ? { qualityTier } : {}),
    ...(winnerInterviewPersonalityType
      ? { winnerInterviewPersonalityType }
      : {}),
  };
}

export function buildGameDayRecapTargetKey(
  leagueId: string,
  gameDate: string,
  approach: RecapGenerationApproachValue = RecapGenerationApproach.LEGACY,
  qualityTier: RecapQualityTier | null = null,
  modelJudgeEnabled = false,
  interviewIntensity: RecapInterviewIntensityValue = RecapInterviewIntensity.PG13,
): string {
  return appendModelJudgeSuffix(
    appendInterviewIntensitySuffix(
      appendQualityTierSuffix(
        appendApproachSuffix(`${leagueId}#${gameDate}`, approach),
        qualityTier,
      ),
      interviewIntensity,
    ),
    modelJudgeEnabled,
  );
}

export function buildLeagueGameDayRecapTargetKey(
  leagueId: string,
  gameDayNumber: number,
  season: number | null,
  approach: RecapGenerationApproachValue = RecapGenerationApproach.LEGACY,
  qualityTier: RecapQualityTier | null = null,
  modelJudgeEnabled = false,
  interviewIntensity: RecapInterviewIntensityValue = RecapInterviewIntensity.PG13,
): string {
  return appendModelJudgeSuffix(
    appendInterviewIntensitySuffix(
      appendQualityTierSuffix(
        appendApproachSuffix(
          `${leagueId}#${season ?? "current"}#gameday-${gameDayNumber}`,
          approach,
        ),
        qualityTier,
      ),
      interviewIntensity,
    ),
    modelJudgeEnabled,
  );
}

export function buildSingleGameSummaryTargetKey(
  matchId: string,
  approach: RecapGenerationApproachValue = RecapGenerationApproach.LEGACY,
  qualityTier: RecapQualityTier | null = null,
  modelJudgeEnabled = false,
  interviewIntensity: RecapInterviewIntensityValue = RecapInterviewIntensity.PG13,
  winnerInterviewPersonalityType: InterviewPersonalityType | null = null,
  loserInterviewPersonalityType: InterviewPersonalityType | null = null,
): string {
  return appendModelJudgeSuffix(
    appendRequestedInterviewPersonalitySuffix(
      appendInterviewIntensitySuffix(
        appendQualityTierSuffix(
          appendApproachSuffix(matchId, approach),
          qualityTier,
        ),
        interviewIntensity,
      ),
      winnerInterviewPersonalityType,
      loserInterviewPersonalityType,
    ),
    modelJudgeEnabled,
  );
}

export function parseGameDayRecapQueueMessage(
  messageBody: string,
): RecapQueueMessage {
  const payload = requireRecord(
    JSON.parse(messageBody),
    "Game day recap queue message",
  );
  const interviewIntensity = normalizeRecapInterviewIntensity(
    payload.interviewIntensity,
  );
  const rawKind = asOptionalString(payload.kind)?.trim();
  const modelId = asOptionalString(payload.modelId)?.trim();
  const modelJudgeEnabled = normalizeModelJudgeEnabled(
    payload.modelJudgeEnabled,
  );
  const rawQualityTier = asOptionalString(payload.qualityTier)?.trim();
  const userId = asOptionalString(payload.userId)?.trim();
  const targetKey = asOptionalString(payload.targetKey)?.trim();
  const requestedAt = asOptionalString(payload.requestedAt)?.trim();
  const kind = rawKind ?? "LEAGUE_DATE";
  const qualityTier = rawQualityTier ?? "standard";

  if (
    !userId ||
    !targetKey ||
    !requestedAt ||
    (kind !== "LEAGUE_DATE" &&
      kind !== "LEAGUE_GAME_DAY" &&
      kind !== "LEAGUE_GAME_DAY_PERFORMANCES" &&
      kind !== "SINGLE_GAME") ||
    (qualityTier !== "standard" && qualityTier !== "premium")
  ) {
    throw new Error(
      "Game day recap queue message must include kind, qualityTier, userId, targetKey, and requestedAt.",
    );
  }

  return {
    interviewIntensity,
    kind,
    ...(modelId ? { modelId } : {}),
    modelJudgeEnabled,
    qualityTier,
    requestedAt,
    targetKey,
    userId,
  };
}

export function normalizeModelJudgeEnabled(value: unknown): boolean {
  return value === true;
}

function requireRecord(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }

  return value as JsonRecord;
}

export function normalizeStoredRecapGenerationApproach(
  value: unknown,
): RecapGenerationApproachValue {
  return normalizeRecapGenerationApproach(value, RecapGenerationApproach.LEGACY);
}

export function normalizeSubmittedRecapGenerationApproach(
  value: unknown,
): RecapGenerationApproachValue {
  return normalizeRecapGenerationApproach(
    value,
    RecapGenerationApproach.FACT_LIBRARY_FIRST,
  );
}

export function normalizeRecapInterviewIntensity(
  value: unknown,
): RecapInterviewIntensityValue {
  const intensity = asOptionalString(value)?.trim();
  if (intensity === RecapInterviewIntensity.CLEAN) {
    return RecapInterviewIntensity.CLEAN;
  }
  if (intensity === RecapInterviewIntensity.FULL_HEAT) {
    return RecapInterviewIntensity.FULL_HEAT;
  }

  return RecapInterviewIntensity.PG13;
}

function normalizeRecapGenerationApproach(
  value: unknown,
  fallback: RecapGenerationApproachValue,
): RecapGenerationApproachValue {
  const approach = asOptionalString(value)?.trim();
  if (approach === RecapGenerationApproach.LEGACY) {
    return RecapGenerationApproach.LEGACY;
  }
  if (approach === RecapGenerationApproach.FACT_LIBRARY_FIRST) {
    return RecapGenerationApproach.FACT_LIBRARY_FIRST;
  }

  return fallback;
}

function appendApproachSuffix(
  baseTargetKey: string,
  approach: RecapGenerationApproachValue,
): string {
  return approach === RecapGenerationApproach.FACT_LIBRARY_FIRST
    ? `${baseTargetKey}#fact-library-first`
    : baseTargetKey;
}

function appendQualityTierSuffix(
  baseTargetKey: string,
  qualityTier: RecapQualityTier | null,
): string {
  return qualityTier ? `${baseTargetKey}#quality-${qualityTier}` : baseTargetKey;
}

function appendInterviewIntensitySuffix(
  baseTargetKey: string,
  interviewIntensity: RecapInterviewIntensityValue,
): string {
  switch (interviewIntensity) {
    case RecapInterviewIntensity.CLEAN:
      return `${baseTargetKey}#intensity-clean`;
    case RecapInterviewIntensity.FULL_HEAT:
      return `${baseTargetKey}#intensity-full-heat`;
    case RecapInterviewIntensity.PG13:
    default:
      return baseTargetKey;
  }
}

function appendModelJudgeSuffix(
  baseTargetKey: string,
  modelJudgeEnabled: boolean,
): string {
  return modelJudgeEnabled ? `${baseTargetKey}#model-judge` : baseTargetKey;
}

function appendRequestedInterviewPersonalitySuffix(
  baseTargetKey: string,
  winnerInterviewPersonalityType: InterviewPersonalityType | null,
  loserInterviewPersonalityType: InterviewPersonalityType | null,
): string {
  let targetKey = baseTargetKey;
  if (winnerInterviewPersonalityType) {
    targetKey = `${targetKey}#winner-voice-${winnerInterviewPersonalityType}`;
  }
  if (loserInterviewPersonalityType) {
    targetKey = `${targetKey}#loser-voice-${loserInterviewPersonalityType}`;
  }
  return targetKey;
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

function normalizeRequestedRecapQualityTier(
  value: unknown,
): RecapQualityTier | null {
  const qualityTier = asOptionalString(value)?.trim();
  if (qualityTier === "standard" || qualityTier === "premium") {
    return qualityTier;
  }

  return null;
}

function normalizeRequestedInterviewPersonalityType(
  value: unknown,
  fieldName: string,
): InterviewPersonalityType | null {
  if (value == null || value === "") {
    return null;
  }

  if (isInterviewPersonalityType(value)) {
    return value;
  }

  throw new Error(
    `Single game summary ${fieldName} must be one of the supported interview personalities.`,
  );
}
