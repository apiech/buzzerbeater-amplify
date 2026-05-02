import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

import {
  BBXmlApiClient,
  BBXmlApiParseError,
  fetchPublicMatchPlayByPlay,
  type BBXmlApiClientOptions,
} from "../../../lib/bbapi";
import type {
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiBoxScoreTeam,
  BBApiSchedule,
  BBApiScheduleMatch,
  BBApiScheduleMatchSide,
  BBApiSeasons,
  BBApiStandings,
} from "../../../lib/bbapi/types";
import {
  inferLeagueTimeZone,
  normalizeLeagueTimeZone,
  resolveCalendarDateKey,
} from "../../../lib/league-timezones";
import {
  buildInterviewPersonalitySeed,
  isInterviewPersonalitySource,
  isInterviewPersonalityType,
  normalizeInterviewPersonalityMode,
  resolveDeterministicInterviewPersonality,
  resolveInterviewPersonalityPrompt,
  type InterviewIntensity,
  type InterviewPersonalityMode,
  type InterviewPersonalitySource,
  type InterviewPersonalityType,
} from "../../../lib/interview-personalities";
import { formatBuzzerBeaterLabel } from "../../../lib/buzzerbeater/rating-scale";
import {
  TEAM_RATING_KEYS,
  type TeamRatingKey,
} from "../../../lib/buzzerbeater/team-ratings";
import { RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME } from "../../_shared/game-day-recap-errors";
import {
  RecapGenerationApproach,
  RecapInterviewIntensity,
} from "../schema-enums";
import { resolveBbAccessKey } from "./credentials";
import {
  buildGameDayRecapTargetKey,
  buildLeagueGameDayRecapTargetKey,
  buildSingleGameSummaryTargetKey,
  normalizeGameDayRecapRequest,
  normalizeRecapInterviewIntensity,
  normalizeLeagueGameDayPerformancesRequest,
  normalizeLeagueGameDayRecapRequest,
  normalizeSingleGameSummaryRequest,
  parseGameDayRecapQueueMessage,
  type RecapGenerationApproachValue,
  type RecapInterviewIntensityValue,
  type RecapJobKind,
  type RecapQualityTier,
  type RecapQueueMessage,
} from "./game-day-recap-request";
import { buildLeagueGameDayPerformancesResult } from "./league-game-day-performances";
import {
  buildExecutionName,
  startStateMachineExecution,
} from "./step-functions";
import {
  getBbConnection,
  getGameDayRecap,
  getLeagueGameDayPerformances,
  getLeagueGameDayRecap,
  getTrackedPlayer,
  getSingleGameSummary,
  updateLeagueGameDayPerformances,
  updateLeagueGameDayRecap,
  updateGameDayRecap,
  updateSingleGameSummary,
  upsertLeagueGameDayPerformances,
  upsertLeagueGameDayRecap,
  upsertGameDayRecap,
  upsertSingleGameSummary,
  type BbConnectionRecord,
  type GameDayRecapStatus,
} from "./repository";
import { requireFeatureAccess } from "./billing";
import {
  assertMaintenanceInactive,
  toMaintenanceAwareErrorMessage,
} from "./maintenance";
import {
  classifyCompetition,
  isLeagueRegularSeasonCompetition,
} from "./match-importance";
import {
  loadGameDayRecapPlayByPlayFacts,
  type GameDayRecapPlayByPlayFacts,
  type GameDayRecapPlayByPlayLoadResult,
  type GameDayRecapPlayByPlayRun,
} from "./game-day-recap-play-by-play";
import { resolveCommercialModeEnabled } from "../../../lib/billing/commercial-mode";
import type { PlanId } from "../../../lib/billing/plans";
import type { Schema } from "../resource";

type GraphqlEnv = Record<string, string | undefined>;

type JsonRecord = Record<string, unknown>;

type TeamStandingSummary = {
  conferenceIndex: number;
  conferencePosition: number;
  losses: number;
  pointMargin: number;
  teamId: string;
  teamName: string;
  wins: number;
};

type TeamSeasonContext = {
  conferenceIndex: number;
  conferencePosition: number;
  currentStreak: string;
  lastFive: string;
  losses: number;
  recentAverageMargin: number | null;
  recentBoxScoreCoverage: number;
  recentMargins: number[];
  recentSignalFlags: string[];
  teamId: string;
  teamName: string;
  wins: number;
};

type TeamSeasonContextPromptField = string | null;

export type GameDayRecapCoveragePayload = NonNullable<
  Schema["GameDayRecap"]["type"]["coverageJson"]
>;
export type GameDayRecapCostPayload = NonNullable<
  Schema["GameDayRecap"]["type"]["costJson"]
>;
type GameDayRecapFailureDetailsPayload = NonNullable<
  Schema["GameDayRecap"]["type"]["failureJson"]
>;
export type GameDayRecapResultPayload = NonNullable<
  Schema["GameDayRecap"]["type"]["resultJson"]
>;
type CoverageIssue = GameDayRecapCoveragePayload["missingGames"][number];

type GameDayRecapCostStagePayload = GameDayRecapCostPayload["stages"][number];
type GameDayRecapResultGame = GameDayRecapResultPayload["games"][number];
type GameDayRecapResultSummary = GameDayRecapResultPayload["summary"];
type GameDayRecapGameValidationPayload = NonNullable<
  GameDayRecapResultGame["validation"]
>;
type GameDayRecapValidationIssuePayload =
  GameDayRecapGameValidationPayload["issues"][number];

type GameDayRecapPromptPeriodFact = {
  awayScore: number;
  homeScore: number;
  label: string;
  margin: number;
  period: number;
  winningSide: "away" | "home" | "tie";
};

type GameDayRecapPromptQuarterFacts = {
  decisiveQuarter:
    | (GameDayRecapPromptPeriodFact & {
        winningSide: "away" | "home";
      })
    | null;
  fourthQuarterOutcome: GameDayRecapPromptPeriodFact | null;
  periods: GameDayRecapPromptPeriodFact[];
};

const FACT_LIBRARY_RATING_LABELS: Record<string, string> = {
  insideDefense: "inside defense",
  insideScoring: "inside scoring",
  offensiveFlow: "offensive flow",
  outsideDefense: "perimeter defense",
  outsideScoring: "outside scoring",
  rebounding: "rebounding",
};

type GameDayRecapFactsLibraryPeriodState = {
  awayScore: number;
  homeScore: number;
  label: string;
  margin: number;
  period: number;
  scoreFromLeaderPerspective: string;
};

type GameDayRecapFactsLibraryGameFlow = {
  closingNote: string | null;
  doNotEmphasize: string[];
  highlightLeadChanges: string[];
  highlightRuns: Array<{
    playerBurst: string | null;
    summary: string;
  }>;
  lastLeadByLoser: string | null;
  scoringDroughts: string[];
  tookLeadForGood: string | null;
};

type GameDayRecapFactsLibraryNarrativePlan = {
  closingFacts: string[];
  gameFlowFacts: string[];
  paragraphOrder: string[];
  setupFacts: string[];
};

type GameDayRecapFactsLibrary = {
  headlineCandidates: string[];
  matchupEdgeFacts: {
    suppressed: string[];
    supported: string[];
  };
  narrativePlan: GameDayRecapFactsLibraryNarrativePlan;
  openingCandidates: string[];
  periodStates: {
    afterPeriods: GameDayRecapFactsLibraryPeriodState[];
    throughThreeQuarters: GameDayRecapFactsLibraryPeriodState | null;
  };
  requiredContextSentences: string[];
  storySignals: string[];
  summaryFacts: string[];
  winner: {
    finalMargin: number;
    finalScoreFromWinnerPerspective: string;
    loserName: string;
    winnerName: string;
  };
  gameFlow: GameDayRecapFactsLibraryGameFlow;
};

type GameDayRecapPromptInterviewCandidate = {
  perspective?: "loser" | "winner";
  personalitySource?: InterviewPersonalitySource | null;
  personalityType?: InterviewPersonalityType | null;
  playerId?: string | null;
  playerName: string;
  selectionReason: string;
  statLine: {
    assists: number;
    blocks: number;
    minutes: number;
    points: number;
    rebounds: number;
    steals: number;
    turnovers: number;
  };
  supportedFacts: string[];
  teamName: string;
  teamSide: "away" | "home";
};

type GameDayRecapPromptGame = {
  effortDelta: number | null;
  effortSummary: string | null;
  factsLibrary?: GameDayRecapFactsLibrary;
  gameDayPrepSummaries: string[];
  gameScoringContext: "high_scoring_shootout" | "low_scoring_grind" | null;
  requiredContextSentences: string[];
  rotationSummaries: string[];
  evidenceSignals: string[];
  finalMargin: number;
  matchId: string;
  neutral: boolean | null;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  playByPlaySummaryLines: string[];
  postgameInterviewCandidate?: GameDayRecapPromptInterviewCandidate | null;
  postgameInterviewCandidates?: GameDayRecapPromptInterviewCandidate[] | null;
  quarterFacts: GameDayRecapPromptQuarterFacts;
  quarterScores: {
    away: number[];
    home: number[];
  };
  seriesContext?: GameDayRecapSeriesContext;
  standingsContext: string[];
  teamRatingFacts?: GameDayRecapTeamRatingFacts;
  teamTalent?: GameDayRecapTeamTalentFacts;
  teams: {
    away: GameDayRecapPromptTeam;
    home: GameDayRecapPromptTeam;
  };
  type: string | null;
};

type GameDayRecapRequestFacts = {
  gameDate: string | null;
  gameDayNumber: number | null;
  generationApproach: RecapGenerationApproachValue;
  interviewIntensity: RecapInterviewIntensityValue;
  kind: RecapJobKind;
  label: string;
  leagueId: string | null;
  leagueName: string | null;
  loserInterviewPersonalityType?: InterviewPersonalityType | null;
  matchId: string | null;
  season: number | null;
  timeZone: string | null;
  winnerInterviewPersonalityType?: InterviewPersonalityType | null;
};

type GameDayRecapWriterPayload = {
  coverage: GameDayRecapCoveragePayload;
  games: GameDayRecapPromptGame[];
  request: GameDayRecapRequestFacts;
};

type GameDayRecapPolishRequestPayload = {
  gameFacts: GameDayRecapPromptGame;
  recapGame: Pick<
    GameDayRecapResultPayload["games"][number],
    "headline" | "matchId" | "writeup"
  >;
  request: GameDayRecapRequestFacts;
  task: "style_polish";
};

type GameDayRecapPostgameInterviewRequestPayload = {
  candidate: GameDayRecapPromptInterviewCandidate;
  gameFacts: GameDayRecapPromptGame;
  recapGame: Pick<
    GameDayRecapResultPayload["games"][number],
    "headline" | "matchId" | "writeup"
  >;
  request: GameDayRecapRequestFacts;
  task: "postgame_interview";
};

type GameDayRecapWriterRequestPayload =
  | GameDayRecapPromptPayload
  | GameDayRecapPolishRequestPayload
  | GameDayRecapPostgameInterviewRequestPayload;

type BestOfThreePlayoffStageKey = "finals" | "relegation";

type GameDayRecapSeriesContext = {
  isTerminal: boolean;
  postgameWins: {
    away: number;
    home: number;
  };
  stageKey: BestOfThreePlayoffStageKey;
  summaryLine: string;
};

type RotationContextForRecap = {
  foulTroubleLimitationCount: number;
  keyAbsenceCount: number;
  summaries: string[];
};

type GameDayRecapPromptTeam = {
  conferenceIndex: number | null;
  conferencePosition: number | null;
  defStrategy: string | null;
  efficiency: Record<string, number | string>;
  foulTroubleLimitationCount: number;
  gdp: Record<string, number | string>;
  keyAbsenceCount: number;
  lastFive: TeamSeasonContextPromptField;
  lastFiveEnteringGame: TeamSeasonContextPromptField;
  name: string;
  offStrategy: string | null;
  ratingLabels: Record<string, string>;
  ratingTotal: number | null;
  ratingValues?: Partial<Record<TeamRatingKey, number>>;
  recentAverageMargin: number | null;
  recentSignalFlags: string[];
  record: TeamSeasonContextPromptField;
  recordEnteringGame: TeamSeasonContextPromptField;
  score: number;
  streak: TeamSeasonContextPromptField;
  streakEnteringGame: TeamSeasonContextPromptField;
  turnovers: number | null;
  topPlayers: Array<{
    assists: number;
    blocks: number;
    minutes: number;
    name: string;
    points: number;
    rebounds: number;
    steals: number;
    turnovers: number;
  }>;
};

type GameDayRecapFactStorePeriodState = GameDayRecapFactsLibraryPeriodState & {
  leaderName: string | null;
  leaderSide: "away" | "home" | "tie";
  trailerName: string | null;
};

type GameDayRecapFactStorePlayerLeader = {
  playerName: string;
  statLine: GameDayRecapPromptInterviewCandidate["statLine"];
  teamName: string;
  teamSide: "away" | "home";
  value: number;
};

type GameDayRecapFactStoreTeam = GameDayRecapPromptTeam & {
  rawRatings: BBApiBoxScoreTeam["ratings"] | null;
};

type GameDayRecapRatingAttackContext = {
  attackLabel: string;
  defenseKey: "insideDefense" | "outsideDefense";
  defenseLabel: string;
  scoringKey: "insideScoring" | "outsideScoring";
};

type GameDayRecapRatingMatchupRelevance =
  | "inside_attack"
  | "inside_defense"
  | "neutral_attack"
  | "offensive_flow_turnovers"
  | "outside_attack"
  | "outside_defense"
  | "rebounding"
  | "same_category";

type GameDayRecapRatingFactValue = {
  key: TeamRatingKey;
  label: string;
  value: number;
};

type GameDayRecapTeamRatingSnapshot = {
  ratingLabels: Record<string, string>;
  ratingTotal: number | null;
  ratings: Partial<Record<TeamRatingKey, GameDayRecapRatingFactValue>>;
  teamTalentTotal: number | null;
  turnovers: number | null;
};

type GameDayRecapRatingComparisonFact = {
  differential: number;
  left: {
    label: string;
    ratingKey: TeamRatingKey;
    teamName: string;
    teamSide: "away" | "home";
    value: number;
  };
  relevance: GameDayRecapRatingMatchupRelevance;
  right: {
    label: string;
    ratingKey: TeamRatingKey;
    teamName: string;
    teamSide: "away" | "home";
    value: number;
  };
  summary: string;
};

type GameDayRecapTeamRatingFacts = {
  away: GameDayRecapTeamRatingSnapshot;
  comparisons: GameDayRecapRatingComparisonFact[];
  home: GameDayRecapTeamRatingSnapshot;
};

type GameDayRecapTeamTalentFacts = {
  awayTotal: number | null;
  differentialFromHomePerspective: number | null;
  homeTotal: number | null;
  leaderSide: "away" | "home" | "tie" | null;
  summary: string | null;
};

type GameDayRecapWinnerFacts = {
  loserName: string | null;
  loserSide: "away" | "home" | null;
  finalScoreHomeAway: string;
  finalScoreWinnerFacing: string | null;
  winnerName: string | null;
  winnerSide: "away" | "home" | null;
};

type GameDayRecapGameFactStore = {
  effortDelta: number | null;
  effortSummary: string | null;
  evidenceSignals: string[];
  finalMargin: number;
  gameScoringContext: "high_scoring_shootout" | "low_scoring_grind" | null;
  gameDayPrepSummaries: string[];
  isPlayoffGame: boolean;
  matchId: string;
  neutral: boolean | null;
  overtime: boolean;
  periodStates: {
    afterPeriods: GameDayRecapFactStorePeriodState[];
    halftime: GameDayRecapFactStorePeriodState | null;
    throughThreeQuarters: GameDayRecapFactStorePeriodState | null;
  };
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  playByPlaySummaryLines: string[];
  playerLeaders: {
    assists: GameDayRecapFactStorePlayerLeader | null;
    bestAllAround: GameDayRecapFactStorePlayerLeader | null;
    points: GameDayRecapFactStorePlayerLeader | null;
    rebounds: GameDayRecapFactStorePlayerLeader | null;
  };
  postgameInterviewCandidate?: GameDayRecapPromptInterviewCandidate | null;
  postgameInterviewCandidates?: GameDayRecapPromptInterviewCandidate[] | null;
  quarterFacts: GameDayRecapPromptQuarterFacts;
  quarterScores: {
    away: number[];
    home: number[];
  };
  requiredContextSentences: string[];
  rotationSummaries: string[];
  seriesContext?: GameDayRecapSeriesContext;
  standingsContext: string[];
  teamRatingFacts: GameDayRecapTeamRatingFacts;
  teamTalent: GameDayRecapTeamTalentFacts;
  teams: {
    away: GameDayRecapFactStoreTeam;
    home: GameDayRecapFactStoreTeam;
  };
  type: string | null;
  winner: GameDayRecapWinnerFacts;
};

type GameDayRecapFactStore = {
  games: GameDayRecapGameFactStore[];
  request: GameDayRecapRequestFacts;
};

type GameDayRecapFullSlatePolishMode = "always" | "auto" | "off";
type GameDayRecapRuntimeConfig = {
  contextConcurrency: number;
  enforceBannedStylePhrases: boolean;
  fullSlatePolishMode: GameDayRecapFullSlatePolishMode;
  interviewConcurrency: number;
  interviewPersonalityMode: InterviewPersonalityMode;
  judgeConcurrency: number;
  polishConcurrency: number;
};

type GameDayRecapPromptPayload = GameDayRecapWriterPayload & {
  factStore: GameDayRecapFactStore;
};

type RequestedInterviewPersonalityOverrides = {
  loserInterviewPersonalityType?: InterviewPersonalityType | null;
  winnerInterviewPersonalityType?: InterviewPersonalityType | null;
};

type BoundedConcurrencyLimiter = <T>(task: () => Promise<T>) => Promise<T>;

type GameDayRecapGenerationConcurrency = {
  interviewLimiter: BoundedConcurrencyLimiter;
  judgeLimiter: BoundedConcurrencyLimiter;
  polishLimiter: BoundedConcurrencyLimiter;
};

export type SlateGame = {
  awayTeamId: string;
  awayTeamName: string;
  isScheduleFinal: boolean;
  homeTeamId: string;
  homeTeamName: string;
  matchId: string;
  scheduledAwayScore: number | null;
  scheduledHomeScore: number | null;
  startTime: string | null;
  type: string | null;
};

type BoxScoreLoadErrorDetails = {
  bodyPreview?: string;
  endpoint?: string;
  errorMessage: string;
  errorName?: string;
  status?: number;
};

type BoxScoreLoadResult =
  | {
      boxScore: BBApiBoxScore;
      kind: "ok";
    }
  | {
      boxScore: BBApiBoxScore;
      kind: "incomplete_boxscore";
    }
  | {
      error: BoxScoreLoadErrorDetails;
      kind: "api_fetch_failed";
    }
  | {
      error: BoxScoreLoadErrorDetails;
      kind: "parse_failed";
    };

type ScheduleMatchInclusionPredicate = (match: BBApiScheduleMatch) => boolean;
type StructuredGameDayRecapProviderStage = "writer" | "retry_writer" | "judge";
type GameDayRecapRetryValidationContext = {
  deterministicIssues: Array<{
    feedback: string;
    field: GameDayRecapSemanticValidationIssueField;
    kind: GameDayRecapSemanticValidationIssueKind;
    matchId: string;
    sentence: string;
    sentenceIndex: number;
  }>;
  judgeIssues: Array<{
    contradictionType: GameDayRecapJudgeContradictionType;
    field: GameDayRecapJudgeSentenceField;
    matchId: string;
    notes: string | null;
    sentence: string;
    sentenceIndex: number;
    sourceField: string | null;
    verdict: GameDayRecapJudgeSentenceVerdict;
  }>;
};
type GameDayRecapGenerateOptions = {
  candidateIndex?: number;
  validationFeedback?: string[];
  validationContext?: GameDayRecapRetryValidationContext | null;
};

type GameDayRecapSemanticValidationIssueField =
  | "headline"
  | "postgameInterview"
  | "writeup";
type GameDayRecapSemanticValidationIssueKind =
  | "banned_style_phrase"
  | "compact_streak_mismatch"
  | "choppy_fact_stack"
  | "duplicate_period_state_restatement"
  | "explicit_streak_mismatch"
  | "conflicting_series_summary_line"
  | "duplicate_outcome_restatement"
  | "missing_required_context_sentence"
  | "missing_primary_run_mention"
  | "missing_run_timing"
  | "overlapping_run_claims"
  | "missing_decisive_ending_emphasis"
  | "missing_series_summary_line"
  | "one_game_streak_language"
  | "playoff_record_language"
  | "playoff_streak_language"
  | "quarter_score_mismatch"
  | "quarter_winner_score_mismatch"
  | "repetitive_sentence_start"
  | "record_mismatch"
  | "short_fact_sentence_cluster"
  | "through_three_quarters_mismatch"
  | "tied_quarter_claim"
  | "unsupported_interview_claim"
  | "unsupported_lead_change_claim"
  | "unsupported_scoring_context"
  | "unsupported_run_framing"
  | "unsupported_run_claim"
  | "unsupported_tactic_contrast"
  | "wrong_quarter_winner";
type GameDayRecapSemanticValidationIssueSalvage =
  | "drop_only"
  | "patch_or_remove";
type GameDayRecapSemanticValidationIssue = {
  actualValue?: string;
  feedback: string;
  field: GameDayRecapSemanticValidationIssueField;
  kind: GameDayRecapSemanticValidationIssueKind;
  matchId: string;
  period?: number;
  reason: string;
  salvage: GameDayRecapSemanticValidationIssueSalvage;
  sentence: string;
  sentenceIndex: number;
  teamSide?: "away" | "home";
};

type GameDayRecapJudgeValidationIssue = {
  contradictionType: GameDayRecapJudgeContradictionType;
  feedback: string;
  field: GameDayRecapJudgeSentenceField;
  matchId: string;
  notes: string | null;
  sentence: string;
  sentenceIndex: number;
  sourceField: string | null;
  verdict: GameDayRecapJudgeSentenceVerdict;
};

type GameDayRecapRepairAction =
  | {
      action: "drop_game";
      matchId: string;
      reason: string;
    }
  | {
      action: "drop_postgame_interview";
      matchId: string;
      reason: string;
    }
  | {
      action: "insert_sentence";
      matchId: string;
      reason: string;
      sentence: string;
      sentenceIndex: number;
    }
  | {
      action: "rebuild_opener";
      matchId: string;
      reason: string;
    }
  | {
      action: "replace_sentence";
      matchId: string;
      sentenceIndex: number;
      reason: string;
    }
  | {
      action: "trim_sentence";
      matchId: string;
      sentenceIndex: number;
      reason: string;
    };

type GameDayRecapGameSalvageOutcome = {
  game: GameDayRecapResultGame | null;
  postPatchDeterministicIssues: GameDayRecapSemanticValidationIssue[];
  postPatchJudgeIssues: GameDayRecapJudgeValidationIssue[];
  postTrimDeterministicIssues: GameDayRecapSemanticValidationIssue[];
  postTrimJudgeIssues: GameDayRecapJudgeValidationIssue[];
  repairActions: GameDayRecapRepairAction[];
};

type GeneratedGameDayRecap = {
  coverageIssues: CoverageIssue[];
  result: GameDayRecapResultPayload;
};

type GameDayRecapGenerationLogContext = {
  targetKey?: string;
  userId?: string;
};

type GameDayRecapResultPostgameInterview = {
  personalitySource?: InterviewPersonalitySource;
  personalityType?: InterviewPersonalityType;
  playerName: string;
  qa: Array<{
    answer: string;
    question: string;
  }>;
  teamName: string;
  teamSide: "away" | "home";
  title: string;
};

type GameDayRecapPostgameInterviewDiagnostic = {
  details: string[];
  reason: string | null;
  side: "loser" | "winner";
  status:
    | "generated"
    | "missing_candidate"
    | "skipped"
    | "suspect"
    | "unavailable";
};

type GuaranteedPostgameInterviewResult = {
  details: string[];
  interview: GameDayRecapResultPostgameInterview;
  reason: string | null;
  status: "generated" | "suspect";
};

type GameDayRecapNormalizationWarning = {
  details: string[];
  kind: "invalid_postgame_interview";
  matchId: string;
  reason: string;
};

type GameDayRecapNormalizedResult = {
  result: GameDayRecapResultPayload;
  warnings: GameDayRecapNormalizationWarning[];
};

type GameDayRecapJudgeContractIssueKind =
  | "invalid_interestingness_shape"
  | "invalid_sentence_chunk_shape"
  | "invalid_sentence_verdict"
  | "missing_slot_verdicts"
  | "unexpected_slot_verdicts";

type GameDayRecapJudgeContractIssue = {
  candidateIndex: number | null;
  expectedCandidateCount: number;
  expectedSentenceCount: number;
  kind: GameDayRecapJudgeContractIssueKind;
  matchId: string | null;
  missingKeys: string[];
  notes: string;
  returnedCandidateCount: number;
  returnedSentenceCount: number;
  chunkIndex: number | null;
  unexpectedKeys: string[];
};

class RetryableCompletedSlateCoverageError extends Error {
  readonly coverage: GameDayRecapCoveragePayload;

  constructor(
    coverage: GameDayRecapCoveragePayload,
    message = "Completed slate recap coverage is incomplete because one or more final box scores could not be processed.",
  ) {
    super(message);
    this.name = RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME;
    this.coverage = coverage;
  }
}

class GameDayRecapSemanticValidationError extends Error {
  readonly feedbackLines: string[];
  readonly issues: GameDayRecapSemanticValidationIssue[];

  constructor(issues: GameDayRecapSemanticValidationIssue[]) {
    super(
      `Game day recap response contained factual contradictions: ${issues
        .map((issue) => `match ${issue.matchId}: ${issue.reason}`)
        .join("; ")}`,
    );
    this.name = "GameDayRecapSemanticValidationError";
    this.feedbackLines = issues.map((issue) => issue.feedback);
    this.issues = issues;
  }
}

class GameDayRecapRepairFailureError extends Error {
  readonly deterministicIssues: GameDayRecapSemanticValidationIssue[];
  readonly feedbackLines: string[];
  readonly judgeIssues: GameDayRecapJudgeValidationIssue[];
  readonly postPatchDeterministicIssues: GameDayRecapSemanticValidationIssue[];
  readonly postPatchJudgeIssues: GameDayRecapJudgeValidationIssue[];
  readonly postTrimDeterministicIssues: GameDayRecapSemanticValidationIssue[];
  readonly postTrimJudgeIssues: GameDayRecapJudgeValidationIssue[];
  readonly repairActions: GameDayRecapRepairAction[];

  constructor(args: {
    deterministicIssues: GameDayRecapSemanticValidationIssue[];
    judgeIssues: GameDayRecapJudgeValidationIssue[];
    postPatchDeterministicIssues?: GameDayRecapSemanticValidationIssue[];
    postPatchJudgeIssues?: GameDayRecapJudgeValidationIssue[];
    postTrimDeterministicIssues?: GameDayRecapSemanticValidationIssue[];
    postTrimJudgeIssues?: GameDayRecapJudgeValidationIssue[];
    repairActions?: GameDayRecapRepairAction[];
  }) {
    super(
      "Game day recap response could not be safely repaired because every game summary still contained factual contradictions.",
    );
    this.name = "GameDayRecapRepairFailureError";
    this.deterministicIssues = args.deterministicIssues;
    this.judgeIssues = args.judgeIssues;
    this.postPatchDeterministicIssues = args.postPatchDeterministicIssues ?? [];
    this.postPatchJudgeIssues = args.postPatchJudgeIssues ?? [];
    this.postTrimDeterministicIssues = args.postTrimDeterministicIssues ?? [];
    this.postTrimJudgeIssues = args.postTrimJudgeIssues ?? [];
    this.repairActions = args.repairActions ?? [];
    this.feedbackLines = buildRecapValidationFeedbackLines({
      deterministicIssues: this.deterministicIssues,
      judgeIssues: this.judgeIssues,
    });
  }
}

class GameDayRecapJudgeContractError extends Error {
  readonly issues: GameDayRecapJudgeContractIssue[];

  constructor(issues: GameDayRecapJudgeContractIssue[]) {
    super(
      "Game day recap judge result did not satisfy the expected sentence coverage contract.",
    );
    this.name = "GameDayRecapJudgeContractError";
    this.issues = issues;
  }
}

type LeagueSlateResolutionDiagnostics = {
  exactMatchCount: number;
  leagueMatchCount: number;
  nearMisses: Array<{
    awayTeamId: string | null;
    awayTeamName: string | null;
    derivedDate: string | null;
    homeTeamId: string | null;
    homeTeamName: string | null;
    matchId: string | null;
    startTime: string | null;
  }>;
  scheduleRowCount: number;
  teamCount: number;
  timeZone: string | null;
};

type StructuredGameDayRecapProviderUsageSummary = {
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  inputTokens: number;
  modelId: string;
  outputTokens: number;
  providerName: "bedrock";
  requestCount: number;
  stage: StructuredGameDayRecapProviderStage;
  totalTokens: number;
};

type StructuredGameDayRecapProvider = {
  generate: (
    payload: unknown,
    options?: GameDayRecapGenerateOptions,
  ) => Promise<unknown>;
  getUsageSummary?: () => StructuredGameDayRecapProviderUsageSummary | null;
  modelId: string;
  providerName: "bedrock";
  stage: StructuredGameDayRecapProviderStage;
};

type RecapStageModelIds = {
  judgeModelId: string | null;
  retryModelId: string | null;
  writerModelId: string;
};

type GameDayRecapJudgeSentenceVerdict =
  | "supported"
  | "style_only"
  | "uncertain"
  | "unsupported";

type GameDayRecapJudgeContradictionType =
  | "final_score"
  | "ending"
  | "lead_change"
  | "none"
  | "other"
  | "overtime"
  | "quarter_outcome"
  | "record"
  | "run"
  | "series_state"
  | "winner";

type GameDayRecapJudgeSentenceField =
  | "headline"
  | "postgameInterview"
  | "writeup";

type GameDayRecapJudgeSentenceInventoryEntry = {
  field: GameDayRecapJudgeSentenceField;
  key: string;
  matchId: string;
  sentence: string;
  sentenceIndex: number;
};

type GameDayRecapJudgeSlotId =
  | "slot0"
  | "slot1"
  | "slot2"
  | "slot3"
  | "slot4"
  | "slot5";

type GameDayRecapJudgeSentenceChunkEntry =
  GameDayRecapJudgeSentenceInventoryEntry & {
    slotId: GameDayRecapJudgeSlotId;
  };

type GameDayRecapJudgeSentenceChunk = {
  candidateIndex: number;
  chunkCount: number;
  chunkIndex: number;
  entries: GameDayRecapJudgeSentenceChunkEntry[];
  matchId: string;
};

type GameDayRecapJudgeSentenceVerdictRecord = {
  containsOutcomeClaim: boolean;
  contradictionType: GameDayRecapJudgeContradictionType;
  notes: string | null;
  sourceField: string | null;
  verdict: GameDayRecapJudgeSentenceVerdict;
};

type GameDayRecapJudgeFallbackMode = "chunk" | "single_sentence";

type GameDayRecapJudgeGameFactPacket = {
  evidenceSignals: string[];
  effortDelta: number | null;
  effortSummary: string | null;
  finalMargin: number;
  gameScoringContext: "high_scoring_shootout" | "low_scoring_grind" | null;
  gameDayPrepSummaries: string[];
  isPlayoffGame: boolean;
  matchId: string;
  overtime: boolean;
  periodStates: GameDayRecapGameFactStore["periodStates"];
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  playerLeaders: GameDayRecapGameFactStore["playerLeaders"];
  postgameInterviewCandidate: GameDayRecapPromptInterviewCandidate | null;
  postgameInterviewCandidates: GameDayRecapPromptInterviewCandidate[] | null;
  quarterFacts: GameDayRecapPromptQuarterFacts;
  quarterScores: {
    away: number[];
    home: number[];
  };
  requiredContextSentences: string[];
  rotationSummaries: string[];
  seriesContext: GameDayRecapSeriesContext | null;
  standingsContext: string[];
  teamRatingFacts: GameDayRecapTeamRatingFacts;
  teamTalent: GameDayRecapTeamTalentFacts;
  teams: {
    away: Pick<
      GameDayRecapFactStoreTeam,
      | "name"
      | "score"
      | "topPlayers"
      | "turnovers"
      | "ratingLabels"
      | "ratingTotal"
      | "ratingValues"
    >;
    home: Pick<
      GameDayRecapFactStoreTeam,
      | "name"
      | "score"
      | "topPlayers"
      | "turnovers"
      | "ratingLabels"
      | "ratingTotal"
      | "ratingValues"
    >;
  };
  winner: GameDayRecapWinnerFacts;
};

type GameDayRecapSentenceJudgeRequestPayload = {
  candidateIndex: number;
  chunkCount: number;
  chunkIndex: number;
  gameFacts: GameDayRecapJudgeGameFactPacket;
  judgeKind: "sentence_factuality";
  request: GameDayRecapRequestFacts;
  sentenceChunk: Array<{
    field: GameDayRecapJudgeSentenceField;
    sentence: string;
    sentenceIndex: number;
    slotId: GameDayRecapJudgeSlotId;
  }>;
};

type GameDayRecapInterestingnessJudgeRequestPayload = {
  candidateIndex: number;
  games: GameDayRecapJudgeGameFactPacket[];
  judgeKind: "candidate_interestingness";
  request: GameDayRecapRequestFacts;
  result: GameDayRecapResultPayload;
};

type GameDayRecapJudgeRequestPayload =
  | GameDayRecapSentenceJudgeRequestPayload
  | GameDayRecapInterestingnessJudgeRequestPayload;

type GameDayRecapJudgeSchemaBudget = {
  serializedSchemaBytes: number;
  sentenceVerdictCount: number;
  unionParameterCount: number;
};

type GameDayRecapJudgeSentenceAssessment = {
  containsOutcomeClaim: boolean;
  contradictionType: GameDayRecapJudgeContradictionType;
  field: GameDayRecapJudgeSentenceField;
  matchId: string;
  notes: string | null;
  sentence: string;
  sentenceIndex: number;
  sourceField: string | null;
  verdict: GameDayRecapJudgeSentenceVerdict;
};

type GameDayRecapJudgeCandidateAssessment = {
  candidateIndex: number;
  interestingnessScore: number;
  sentences: GameDayRecapJudgeSentenceAssessment[];
};

type GameDayRecapJudgeFactStore = GameDayRecapFactStore;
type GameDayRecapJudgeGameFactStore = GameDayRecapGameFactStore;

type PremiumRecapCandidate = {
  candidateIndex: number;
  deterministicFailureMessage: string | null;
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  disagreementPenalty: number;
  judgeAssessment: GameDayRecapJudgeCandidateAssessment | null;
  normalizedResult: GameDayRecapResultPayload | null;
  validatedResult: GameDayRecapResultPayload | null;
};

type PublicPlayByPlayFetcher = typeof fetchPublicMatchPlayByPlay;

type SubmitDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: RecapQueueMessage,
  ) => Promise<string>;
  getGameDayRecap: typeof getGameDayRecap;
  getLeagueGameDayRecap: typeof getLeagueGameDayRecap;
  getLeagueGameDayPerformances: typeof getLeagueGameDayPerformances;
  getSingleGameSummary: typeof getSingleGameSummary;
  now: () => Date;
  requireFeatureAccess: typeof requireFeatureAccess;
  updateLeagueGameDayPerformances: typeof updateLeagueGameDayPerformances;
  updateLeagueGameDayRecap: typeof updateLeagueGameDayRecap;
  updateGameDayRecap: typeof updateGameDayRecap;
  updateSingleGameSummary: typeof updateSingleGameSummary;
  upsertLeagueGameDayPerformances: typeof upsertLeagueGameDayPerformances;
  upsertLeagueGameDayRecap: typeof upsertLeagueGameDayRecap;
  upsertGameDayRecap: typeof upsertGameDayRecap;
  upsertSingleGameSummary: typeof upsertSingleGameSummary;
};

type ProcessDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: (
    options: BBXmlApiClientOptions,
  ) => Pick<
    BBXmlApiClient,
    | "getBoxScore"
    | "getSchedule"
    | "getSeasons"
    | "getStandings"
    | "getTeamInfo"
  > &
    Partial<Pick<BBXmlApiClient, "getSeasonsXml">>;
  createProvider: (args: {
    modelId: string;
    region: string | undefined;
    stage: StructuredGameDayRecapProviderStage;
  }) => StructuredGameDayRecapProvider;
  fetchPublicMatchPlayByPlay: PublicPlayByPlayFetcher;
  getBbConnection: typeof getBbConnection;
  getGameDayRecap: typeof getGameDayRecap;
  getLeagueGameDayPerformances: typeof getLeagueGameDayPerformances;
  getLeagueGameDayRecap: typeof getLeagueGameDayRecap;
  getSingleGameSummary: typeof getSingleGameSummary;
  now: () => Date;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  updateLeagueGameDayPerformances: typeof updateLeagueGameDayPerformances;
  updateLeagueGameDayRecap: typeof updateLeagueGameDayRecap;
  updateGameDayRecap: typeof updateGameDayRecap;
  updateSingleGameSummary: typeof updateSingleGameSummary;
};

type SubmitDependencyOverrides = Partial<SubmitDependencies>;
type ProcessDependencyOverrides = Partial<ProcessDependencies>;

const LEGACY_GAME_DAY_RECAP_PROMPT_VERSION = "gameday-recap-v10";
const FACT_LIBRARY_FIRST_GAME_DAY_RECAP_PROMPT_VERSION =
  "gameday-recap-v12-fact-library-first";
const GAME_DAY_RECAP_PROMPT_VERSION = LEGACY_GAME_DAY_RECAP_PROMPT_VERSION;
const GAME_DAY_RECAP_MODEL_ENV_NAME = "GAME_DAY_RECAP_MODEL_ID";
const GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME = "GAME_DAY_RECAP_MODEL_ID_PREMIUM";
const GAME_DAY_RECAP_RETRY_MODEL_ENV_NAME = "GAME_DAY_RECAP_RETRY_MODEL_ID";
const GAME_DAY_RECAP_RETRY_PREMIUM_MODEL_ENV_NAME =
  "GAME_DAY_RECAP_RETRY_MODEL_ID_PREMIUM";
const GAME_DAY_RECAP_JUDGE_MODEL_ENV_NAME = "GAME_DAY_RECAP_JUDGE_MODEL_ID";
const GAME_DAY_RECAP_JUDGE_PREMIUM_MODEL_ENV_NAME =
  "GAME_DAY_RECAP_JUDGE_MODEL_ID_PREMIUM";
const GAME_DAY_RECAP_CONTEXT_CONCURRENCY_ENV_NAME =
  "GAME_DAY_RECAP_CONTEXT_CONCURRENCY";
const GAME_DAY_RECAP_JUDGE_CONCURRENCY_ENV_NAME =
  "GAME_DAY_RECAP_JUDGE_CONCURRENCY";
const GAME_DAY_RECAP_POLISH_CONCURRENCY_ENV_NAME =
  "GAME_DAY_RECAP_POLISH_CONCURRENCY";
const GAME_DAY_RECAP_INTERVIEW_CONCURRENCY_ENV_NAME =
  "GAME_DAY_RECAP_INTERVIEW_CONCURRENCY";
const GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE_ENV_NAME =
  "GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE";
const GAME_DAY_RECAP_DECISIVE_QUARTER_MARGIN = 8;
const PREMIUM_RECAP_CANDIDATE_COUNT = 3;
const TERMINAL_RECAP_STATUSES = new Set<GameDayRecapStatus>([
  "FAILED",
  "SUCCEEDED",
]);
const SUPPORTED_COMMERCIAL_REGION_PATTERN =
  /^(af|ap|ca|eu|il|me|sa|us)-[a-z]+-\d+$/;
const SUPPORTED_STRUCTURED_OUTPUT_MODEL_PATTERNS = [
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-haiku-4-5-20251001-v1:0$/i,
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-sonnet-4-5-20250929-v1:0$/i,
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-opus-4-5-20251101-v1:0$/i,
  /(^|(?:global|us|eu|au)\.)anthropic\.claude-opus-4-6-v1$/i,
  /^qwen\.qwen3-235b-a22b-2507-v1:0$/i,
  /^qwen\.qwen3-32b-v1:0$/i,
  /^qwen\.qwen3-coder-30b-a3b-v1:0$/i,
  /^qwen\.qwen3-coder-480b-a35b-v1:0$/i,
  /^qwen\.qwen3-next-80b-a3b$/i,
  /^qwen\.qwen3-vl-235b-a22b$/i,
  /^openai\.gpt-oss-120b-1:0$/i,
  /^openai\.gpt-oss-20b-1:0$/i,
  /^openai\.gpt-oss-safeguard-120b$/i,
  /^openai\.gpt-oss-safeguard-20b$/i,
  /^deepseek\.v3-v1:0$/i,
  /^google\.gemma-3-12b-it$/i,
  /^google\.gemma-3-27b-it$/i,
  /^minimax\.minimax-m2$/i,
  /^mistral\.magistral-small-2509$/i,
  /^mistral\.ministral-3-3b-instruct$/i,
  /^mistral\.ministral-3-8b-instruct$/i,
  /^mistral\.ministral-3-14b-instruct$/i,
  /^mistral\.mistral-large-3-675b-instruct$/i,
  /^mistral\.voxtral-mini-3b-2507$/i,
  /^mistral\.voxtral-small-24b-2507$/i,
  /^moonshot\.kimi-k2-thinking$/i,
  /^nvidia\.nemotron-nano-12b-v2$/i,
  /^nvidia\.nemotron-nano-9b-v2$/i,
];
const GAME_DAY_RECAP_EVIDENCE_TAGS = [
  "back_and_forth",
  "blowout",
  "buzzerbeater",
  "close_finish",
  "comeback",
  "deemphasis_signal",
  "effort_gap",
  "late_game_swing",
  "losing_streak",
  "one_possession_finish",
  "quarter_turn",
  "recent_form",
  "standings_race",
  "top_performance",
  "winning_streak",
] as const;
const BANNED_RECAP_STYLE_PHRASES = [
  "at a key juncture",
  "proved decisive",
] as const;
const KNOWN_RECAP_MODEL_PRICING = [
  {
    inputCostPerMillionUsd: 1,
    outputCostPerMillionUsd: 5,
    pattern: /claude-haiku-4-5/i,
  },
  {
    inputCostPerMillionUsd: 3,
    outputCostPerMillionUsd: 15,
    pattern: /claude-sonnet-4-5/i,
  },
] as const;
const DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG: GameDayRecapRuntimeConfig = {
  contextConcurrency: 4,
  enforceBannedStylePhrases: false,
  fullSlatePolishMode: "auto",
  interviewConcurrency: 2,
  interviewPersonalityMode: "random",
  judgeConcurrency: 4,
  polishConcurrency: 2,
};
const COMEBACK_SUMMARY_THRESHOLD = 8;
const MIN_REMAINING_MS_FOR_STYLE_POLISH = 90_000;
const MIN_REMAINING_MS_FOR_INTERVIEW_GENERATION = 60_000;
const MIN_REMAINING_MS_FOR_INTERVIEW_RETRY = 35_000;
const GAME_DAY_RECAP_POSTGAME_INTERVIEW_SCHEMA = {
  additionalProperties: false,
  properties: {
    personalitySource: {
      enum: ["auto", "request_override", "user_override"],
      type: "string",
    },
    personalityType: {
      enum: [
        "curt",
        "friendly",
        "rambling",
        "nonsensical",
        "excited",
        "braggart",
        "earnest",
        "stoic",
        "deadpan",
        "reflective",
        "cagey",
        "swaggering",
      ],
      type: "string",
    },
    playerName: {
      type: "string",
    },
    qa: {
      items: {
        additionalProperties: false,
        properties: {
          answer: {
            type: "string",
          },
          question: {
            type: "string",
          },
        },
        required: ["question", "answer"],
        type: "object",
      },
      type: "array",
    },
    teamName: {
      type: "string",
    },
    teamSide: {
      enum: ["away", "home"],
      type: "string",
    },
    title: {
      type: "string",
    },
  },
  required: ["playerName", "teamName", "teamSide", "title", "qa"],
  type: "object",
} as const;
const GAME_DAY_RECAP_STYLE_POLISH_RESULT_SCHEMA = {
  additionalProperties: false,
  properties: {
    writeup: {
      type: "string",
    },
  },
  required: ["writeup"],
  type: "object",
} as const;
const GAME_DAY_RECAP_RESULT_SCHEMA = {
  additionalProperties: false,
  properties: {
    games: {
      items: {
        additionalProperties: false,
        properties: {
          evidenceTags: {
            items: {
              enum: [...GAME_DAY_RECAP_EVIDENCE_TAGS],
              type: "string",
            },
            type: "array",
          },
          headline: {
            maxLength: 160,
            minLength: 8,
            type: "string",
          },
          matchId: {
            minLength: 1,
            type: "string",
          },
          postgameInterview: GAME_DAY_RECAP_POSTGAME_INTERVIEW_SCHEMA,
          writeup: {
            maxLength: 1400,
            minLength: 80,
            type: "string",
          },
        },
        required: ["matchId", "headline", "writeup", "evidenceTags"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
    summary: {
      additionalProperties: false,
      properties: {
        headline: {
          maxLength: 160,
          minLength: 8,
          type: "string",
        },
        lede: {
          maxLength: 320,
          minLength: 40,
          type: "string",
        },
      },
      required: ["headline", "lede"],
      type: "object",
    },
  },
  required: ["summary", "games"],
  type: "object",
} as const;
const GAME_DAY_RECAP_JUDGE_SENTENCE_VERDICT_SCHEMA = {
  additionalProperties: false,
  properties: {
    containsOutcomeClaim: {
      type: "boolean",
    },
    contradictionType: {
      enum: [
        "none",
        "winner",
        "final_score",
        "overtime",
        "quarter_outcome",
        "series_state",
        "run",
        "lead_change",
        "ending",
        "record",
        "other",
      ],
      type: "string",
    },
    notes: {
      type: "string",
    },
    sourceField: {
      type: "string",
    },
    verdict: {
      enum: ["supported", "unsupported", "uncertain", "style_only"],
      type: "string",
    },
  },
  required: [
    "verdict",
    "contradictionType",
    "sourceField",
    "notes",
    "containsOutcomeClaim",
  ],
  type: "object",
} as const;
const GAME_DAY_RECAP_JUDGE_SLOT_IDS: readonly GameDayRecapJudgeSlotId[] = [
  "slot0",
  "slot1",
  "slot2",
  "slot3",
  "slot4",
  "slot5",
] as const;
const GAME_DAY_RECAP_JUDGE_SENTENCE_CHUNK_SIZE =
  GAME_DAY_RECAP_JUDGE_SLOT_IDS.length;
const BEDROCK_STRUCTURED_OUTPUT_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "description",
  "enum",
  "items",
  "properties",
  "required",
  "type",
]);
const GAME_DAY_RECAP_LOG_PREFIX = "[game-day-recap]";
const GAME_DAY_RECAP_INFO_EVENTS = new Set([
  "submit.skipped_active_job",
  "submit.execution.start",
  "submit.execution.succeeded",
  "process.stage_timing",
  "process.completed",
]);

function resolveGameDayRecapPromptVersion(
  approach: RecapGenerationApproachValue,
): string {
  return approach === RecapGenerationApproach.FACT_LIBRARY_FIRST
    ? FACT_LIBRARY_FIRST_GAME_DAY_RECAP_PROMPT_VERSION
    : LEGACY_GAME_DAY_RECAP_PROMPT_VERSION;
}

function resolveRecapGenerationApproach(
  requestJson:
    | {
        approach?: unknown;
      }
    | null
    | undefined,
): RecapGenerationApproachValue {
  return requestJson?.approach === RecapGenerationApproach.FACT_LIBRARY_FIRST
    ? RecapGenerationApproach.FACT_LIBRARY_FIRST
    : RecapGenerationApproach.LEGACY;
}

function toBedrockStructuredOutputSchema(
  schema: unknown,
  contextKey: string | null = null,
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) =>
      toBedrockStructuredOutputSchema(entry, contextKey),
    );
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const record = schema as Record<string, unknown>;
  if (contextKey === "properties") {
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        toBedrockStructuredOutputSchema(value),
      ]),
    );
  }

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => BEDROCK_STRUCTURED_OUTPUT_SCHEMA_KEYS.has(key))
      .map(([key, value]) => [
        key,
        toBedrockStructuredOutputSchema(value, key),
      ]),
  );
}

type GameDayRecapEvidenceTag = (typeof GAME_DAY_RECAP_EVIDENCE_TAGS)[number];

const defaultSubmitDependencies: SubmitDependencies = {
  assertMaintenanceInactive,
  startWorkflowExecution: async (stateMachineArn, executionName, message) => {
    return startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    });
  },
  getGameDayRecap,
  getLeagueGameDayPerformances,
  getLeagueGameDayRecap,
  getSingleGameSummary,
  now: () => new Date(),
  requireFeatureAccess,
  updateLeagueGameDayPerformances,
  updateLeagueGameDayRecap,
  updateGameDayRecap,
  updateSingleGameSummary,
  upsertLeagueGameDayPerformances,
  upsertLeagueGameDayRecap,
  upsertGameDayRecap,
  upsertSingleGameSummary,
};

const defaultProcessDependencies: ProcessDependencies = {
  assertMaintenanceInactive,
  createBbClient: (options) => new BBXmlApiClient(options),
  createProvider: ({ modelId, region, stage }) =>
    createBedrockGameDayRecapProvider({
      modelId,
      region,
      stage,
    }),
  fetchPublicMatchPlayByPlay,
  getBbConnection,
  getGameDayRecap,
  getLeagueGameDayPerformances,
  getLeagueGameDayRecap,
  getSingleGameSummary,
  now: () => new Date(),
  resolveBbAccessKey,
  updateLeagueGameDayPerformances,
  updateLeagueGameDayRecap,
  updateGameDayRecap,
  updateSingleGameSummary,
};

export async function submitGameDayRecap(
  args: {
    approach?: RecapGenerationApproachValue | null;
    env: GraphqlEnv;
    gameDate: string;
    identity: unknown;
    interviewIntensity?: RecapInterviewIntensityValue | null;
    leagueId: string;
    modelJudgeEnabled?: boolean | null;
    qualityTier?: RecapQualityTier | null;
    stateMachineArn: string;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<{ executionArn: string | null; targetKey: string }> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }
  await deps.assertMaintenanceInactive();

  logGameDayRecapInfo("submit.received", {
    gameDate: args.gameDate,
    leagueId: args.leagueId,
    userId,
  });

  const planId = await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });
  const request = normalizeGameDayRecapRequest({
    approach: args.approach ?? undefined,
    gameDate: args.gameDate,
    interviewIntensity: args.interviewIntensity ?? undefined,
    leagueId: args.leagueId,
    modelJudgeEnabled: args.modelJudgeEnabled ?? undefined,
    qualityTier: args.qualityTier ?? undefined,
  });
  const modelJudgeEnabled = request.modelJudgeEnabled === true;
  const interviewIntensity = normalizeRecapInterviewIntensity(
    request.interviewIntensity,
  );
  const qualityTier =
    request.qualityTier ?? resolveRequestedRecapQualityTier(args.env, planId);
  const generationApproach =
    request.approach ?? RecapGenerationApproach.FACT_LIBRARY_FIRST;
  const targetKey = buildGameDayRecapTargetKey(
    request.leagueId,
    request.gameDate,
    generationApproach,
    request.qualityTier ?? null,
    modelJudgeEnabled,
    interviewIntensity,
  );
  const existing = await deps.getGameDayRecap(args.env, userId, targetKey);

  logGameDayRecapInfo("submit.normalized", {
    existingRequestedAt: existing?.requestedAt ?? null,
    existingStatus: existing?.status ?? null,
    gameDate: request.gameDate,
    generationApproach,
    interviewIntensity,
    leagueId: request.leagueId,
    modelJudgeEnabled,
    targetKey,
    userId,
  });

  if (existing && !TERMINAL_RECAP_STATUSES.has(existing.status)) {
    logGameDayRecapInfo("submit.skipped_active_job", {
      existingRequestedAt: existing.requestedAt,
      existingStatus: existing.status,
      targetKey,
      userId,
    });
    return {
      executionArn: existing.executionArn ?? null,
      targetKey,
    };
  }

  const stageModels = resolveConfiguredRecapStageModelIds(
    args.env,
    qualityTier,
  );
  const modelId = stageModels.writerModelId;
  const requestedAt = deps.now().toISOString();

  logGameDayRecapInfo("submit.persisting_job", {
    modelId,
    planId,
    promptVersion: resolveGameDayRecapPromptVersion(generationApproach),
    requestedAt,
    targetKey,
    userId,
  });

  await deps.upsertGameDayRecap(args.env, {
    completedAt: null,
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDate: request.gameDate,
    leagueId: request.leagueId,
    leagueName: existing?.leagueName ?? null,
    modelId,
    modelProvider: "bedrock",
    promptVersion: resolveGameDayRecapPromptVersion(generationApproach),
    requestJson: {
      approach: generationApproach,
      gameDate: request.gameDate,
      interviewIntensity,
      leagueId: request.leagueId,
      modelJudgeEnabled,
      mode: "FULL_SLATE",
      qualityTier,
    },
    requestedAt,
    resultJson: null,
    season: null,
    status: "QUEUED",
    targetKey,
    userId,
    executionArn: null,
  });

  try {
    logGameDayRecapInfo("submit.execution.start", {
      requestedAt,
      targetKey,
      userId,
    });
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "gameday-recap",
        `${userId}:${targetKey}:${requestedAt}`,
      ),
      {
        kind: "LEAGUE_DATE",
        interviewIntensity,
        modelId,
        modelJudgeEnabled,
        qualityTier,
        requestedAt,
        targetKey,
        userId,
      },
    );
    await deps.updateGameDayRecap(args.env, {
      executionArn,
      targetKey,
      userId,
    });
    logGameDayRecapInfo("submit.execution.succeeded", {
      executionArn,
      requestedAt,
      targetKey,
      userId,
    });
    return { executionArn, targetKey };
  } catch (error) {
    logGameDayRecapError("submit.execution.failed", {
      requestedAt,
      targetKey,
      userId,
      ...toLoggableError(error),
    });
    await deps.updateGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      modelId,
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }
}

export async function submitLeagueGameDayRecap(
  args: {
    approach?: RecapGenerationApproachValue | null;
    env: GraphqlEnv;
    gameDayNumber: number;
    identity: unknown;
    interviewIntensity?: RecapInterviewIntensityValue | null;
    leagueId: string;
    modelJudgeEnabled?: boolean | null;
    qualityTier?: RecapQualityTier | null;
    stateMachineArn: string;
    season?: number | null;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<{ executionArn: string | null; targetKey: string }> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }
  await deps.assertMaintenanceInactive();

  const planId = await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });
  const request = normalizeLeagueGameDayRecapRequest({
    approach: args.approach ?? undefined,
    gameDayNumber: args.gameDayNumber,
    interviewIntensity: args.interviewIntensity ?? undefined,
    leagueId: args.leagueId,
    modelJudgeEnabled: args.modelJudgeEnabled ?? undefined,
    qualityTier: args.qualityTier ?? undefined,
    season: args.season ?? null,
  });
  const modelJudgeEnabled = request.modelJudgeEnabled === true;
  const interviewIntensity = normalizeRecapInterviewIntensity(
    request.interviewIntensity,
  );
  const qualityTier =
    request.qualityTier ?? resolveRequestedRecapQualityTier(args.env, planId);
  const generationApproach =
    request.approach ?? RecapGenerationApproach.FACT_LIBRARY_FIRST;
  const targetKey = buildLeagueGameDayRecapTargetKey(
    request.leagueId,
    request.gameDayNumber,
    request.season,
    generationApproach,
    request.qualityTier ?? null,
    modelJudgeEnabled,
    interviewIntensity,
  );
  const existing = await deps.getLeagueGameDayRecap(
    args.env,
    userId,
    targetKey,
  );
  if (existing && !TERMINAL_RECAP_STATUSES.has(existing.status)) {
    return {
      executionArn: existing.executionArn ?? null,
      targetKey,
    };
  }

  const stageModels = resolveConfiguredRecapStageModelIds(
    args.env,
    qualityTier,
  );
  const modelId = stageModels.writerModelId;
  const requestedAt = deps.now().toISOString();
  await deps.upsertLeagueGameDayRecap(args.env, {
    completedAt: null,
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDayNumber: request.gameDayNumber,
    leagueId: request.leagueId,
    leagueName: existing?.leagueName ?? null,
    modelId,
    modelProvider: "bedrock",
    promptVersion: resolveGameDayRecapPromptVersion(generationApproach),
    requestJson: {
      approach: generationApproach,
      gameDayNumber: request.gameDayNumber,
      interviewIntensity,
      leagueId: request.leagueId,
      modelJudgeEnabled,
      mode: "LEAGUE_GAME_DAY",
      qualityTier,
      season: request.season,
    },
    requestedAt,
    resultJson: null,
    season: request.season,
    status: "QUEUED",
    targetKey,
    userId,
    executionArn: null,
  });

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "league-gameday-recap",
        `${userId}:${targetKey}:${requestedAt}`,
      ),
      {
        kind: "LEAGUE_GAME_DAY",
        interviewIntensity,
        modelId,
        modelJudgeEnabled,
        qualityTier,
        requestedAt,
        targetKey,
        userId,
      },
    );
    await deps.updateLeagueGameDayRecap(args.env, {
      executionArn,
      targetKey,
      userId,
    });
    return { executionArn, targetKey };
  } catch (error) {
    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      modelId,
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }
}

export async function submitSingleGameSummary(
  args: {
    approach?: RecapGenerationApproachValue | null;
    env: GraphqlEnv;
    identity: unknown;
    interviewIntensity?: RecapInterviewIntensityValue | null;
    loserInterviewPersonalityType?: InterviewPersonalityType | null;
    matchId: string;
    modelJudgeEnabled?: boolean | null;
    qualityTier?: RecapQualityTier | null;
    stateMachineArn: string;
    winnerInterviewPersonalityType?: InterviewPersonalityType | null;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<{ executionArn: string | null; targetKey: string }> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }
  await deps.assertMaintenanceInactive();

  const planId = await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });
  const request = normalizeSingleGameSummaryRequest({
    approach: args.approach ?? undefined,
    interviewIntensity: args.interviewIntensity ?? undefined,
    loserInterviewPersonalityType:
      args.loserInterviewPersonalityType ?? undefined,
    matchId: args.matchId,
    modelJudgeEnabled: args.modelJudgeEnabled ?? undefined,
    qualityTier: args.qualityTier ?? undefined,
    winnerInterviewPersonalityType:
      args.winnerInterviewPersonalityType ?? undefined,
  });
  const modelJudgeEnabled = request.modelJudgeEnabled === true;
  const interviewIntensity = normalizeRecapInterviewIntensity(
    request.interviewIntensity,
  );
  const qualityTier =
    request.qualityTier ?? resolveRequestedRecapQualityTier(args.env, planId);
  const generationApproach =
    request.approach ?? RecapGenerationApproach.FACT_LIBRARY_FIRST;
  const targetKey = buildSingleGameSummaryTargetKey(
    request.matchId,
    generationApproach,
    request.qualityTier ?? null,
    modelJudgeEnabled,
    interviewIntensity,
    request.winnerInterviewPersonalityType ?? null,
    request.loserInterviewPersonalityType ?? null,
  );
  const existing = await deps.getSingleGameSummary(args.env, userId, targetKey);
  if (existing && !TERMINAL_RECAP_STATUSES.has(existing.status)) {
    return {
      executionArn: existing.executionArn ?? null,
      targetKey,
    };
  }

  const stageModels = resolveConfiguredRecapStageModelIds(
    args.env,
    qualityTier,
  );
  const modelId = stageModels.writerModelId;
  const requestedAt = deps.now().toISOString();
  await deps.upsertSingleGameSummary(args.env, {
    completedAt: null,
    coverageJson: null,
    costJson: null,
    error: null,
    failureJson: null,
    gameDate: existing?.gameDate ?? null,
    leagueId: existing?.leagueId ?? null,
    leagueName: existing?.leagueName ?? null,
    matchId: request.matchId,
    modelId,
    modelProvider: "bedrock",
    promptVersion: resolveGameDayRecapPromptVersion(generationApproach),
    requestJson: {
      approach: generationApproach,
      interviewIntensity,
      ...(request.loserInterviewPersonalityType
        ? {
            loserInterviewPersonalityType:
              request.loserInterviewPersonalityType,
          }
        : {}),
      matchId: request.matchId,
      modelJudgeEnabled,
      mode: "SINGLE_GAME",
      qualityTier,
      ...(request.winnerInterviewPersonalityType
        ? {
            winnerInterviewPersonalityType:
              request.winnerInterviewPersonalityType,
          }
        : {}),
    },
    requestedAt,
    resultJson: null,
    season: existing?.season ?? null,
    status: "QUEUED",
    targetKey,
    userId,
    executionArn: null,
  });

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "single-game-summary",
        `${userId}:${targetKey}:${requestedAt}`,
      ),
      {
        kind: "SINGLE_GAME",
        interviewIntensity,
        modelId,
        modelJudgeEnabled,
        qualityTier,
        requestedAt,
        targetKey,
        userId,
      },
    );
    await deps.updateSingleGameSummary(args.env, {
      executionArn,
      targetKey,
      userId,
    });
    return { executionArn, targetKey };
  } catch (error) {
    await deps.updateSingleGameSummary(args.env, {
      completedAt: deps.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      modelId,
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }
}

export async function submitLeagueGameDayPerformances(
  args: {
    env: GraphqlEnv;
    gameDayNumber: number;
    identity: unknown;
    leagueId: string;
    stateMachineArn: string;
    season?: number | null;
  },
  dependencies: SubmitDependencyOverrides = defaultSubmitDependencies,
): Promise<{ executionArn: string | null; targetKey: string }> {
  const deps: SubmitDependencies = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }
  await deps.assertMaintenanceInactive();

  const request = normalizeLeagueGameDayPerformancesRequest({
    gameDayNumber: args.gameDayNumber,
    leagueId: args.leagueId,
    season: args.season ?? null,
  });
  const targetKey = buildLeagueGameDayRecapTargetKey(
    request.leagueId,
    request.gameDayNumber,
    request.season,
  );
  const existing = await deps.getLeagueGameDayPerformances(
    args.env,
    userId,
    targetKey,
  );
  if (existing && !TERMINAL_RECAP_STATUSES.has(existing.status)) {
    return {
      executionArn: existing.executionArn ?? null,
      targetKey,
    };
  }

  const requestedAt = deps.now().toISOString();
  await deps.upsertLeagueGameDayPerformances(args.env, {
    completedAt: null,
    coverageJson: null,
    error: null,
    executionArn: null,
    gameDate: existing?.gameDate ?? null,
    gameDayNumber: request.gameDayNumber,
    leagueId: request.leagueId,
    leagueName: existing?.leagueName ?? null,
    modelId: null,
    modelProvider: "deterministic",
    promptVersion: null,
    requestJson: {
      gameDayNumber: request.gameDayNumber,
      leagueId: request.leagueId,
      mode: "LEAGUE_GAME_DAY_PERFORMANCES",
      season: request.season,
    },
    requestedAt,
    resultJson: null,
    season: request.season,
    status: "QUEUED",
    targetKey,
    userId,
  });

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "league-gameday-performances",
        `${userId}:${targetKey}:${requestedAt}`,
      ),
      {
        interviewIntensity: RecapInterviewIntensity.PG13,
        kind: "LEAGUE_GAME_DAY_PERFORMANCES",
        modelJudgeEnabled: false,
        qualityTier: "standard",
        requestedAt,
        targetKey,
        userId,
      },
    );
    await deps.updateLeagueGameDayPerformances(args.env, {
      executionArn,
      targetKey,
      userId,
    });
    return { executionArn, targetKey };
  } catch (error) {
    await deps.updateLeagueGameDayPerformances(args.env, {
      completedAt: deps.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      modelId: null,
      modelProvider: "deterministic",
      promptVersion: null,
      status: "FAILED",
      targetKey,
      userId,
    });
    throw error;
  }
}

export async function processGameDayRecap(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    remainingTimeInMillis?: () => number;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage(args);
  const runtimeModels = resolveQueuedRecapStageModelIds({
    env: args.env,
    fallbackModelId: args.modelId,
    message,
  });
  const runtimeConfig = resolveGameDayRecapRuntimeConfig(args.env);
  const modelId = runtimeModels.writerModelId;
  logGameDayRecapInfo("process.message.received", {
    interviewIntensity: message.interviewIntensity,
    modelId,
    modelJudgeEnabled: message.modelJudgeEnabled,
    qualityTier: message.qualityTier,
    requestedAt: message.requestedAt,
    targetKey: message.targetKey,
    userId: message.userId,
  });
  const recap = await deps.getGameDayRecap(
    args.env,
    message.userId,
    message.targetKey,
  );
  if (!recap || recap.userId !== message.userId) {
    throw new Error(
      "Game day recap request is missing or no longer belongs to the enqueued user.",
    );
  }

  logGameDayRecapInfo("process.recap.loaded", {
    completedAt: recap.completedAt,
    generationApproach: resolveRecapGenerationApproach(recap.requestJson),
    interviewIntensity: normalizeRecapInterviewIntensity(
      recap.requestJson?.interviewIntensity,
    ),
    requestedAt: recap.requestedAt,
    status: recap.status,
    targetKey: recap.targetKey,
    userId: recap.userId,
  });

  if (
    recap.requestedAt !== message.requestedAt ||
    (recap.status === "SUCCEEDED" && recap.completedAt)
  ) {
    logGameDayRecapInfo("process.skipped_stale_or_completed", {
      recapCompletedAt: recap.completedAt,
      recapRequestedAt: recap.requestedAt,
      recapStatus: recap.status,
      requestedAt: message.requestedAt,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    return;
  }

  let coverage: GameDayRecapCoveragePayload | null = null;
  const generationApproach = resolveRecapGenerationApproach(recap.requestJson);
  const promptVersion = resolveGameDayRecapPromptVersion(generationApproach);
  let writerProvider: StructuredGameDayRecapProvider | null = null;
  let retryProvider: StructuredGameDayRecapProvider | null = null;
  let judgeProvider: StructuredGameDayRecapProvider | null = null;

  try {
    await deps.assertMaintenanceInactive();
    logGameDayRecapInfo("process.status_transition", {
      nextStatus: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    await deps.updateGameDayRecap(args.env, {
      error: null,
      failureJson: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion,
      costJson: null,
      status: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    await deps.assertMaintenanceInactive();
    const connection = await requireBbConnection(args.env, recap.userId, deps);
    const accessKey = await deps.resolveBbAccessKey(args.env, recap.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });

    logGameDayRecapInfo("process.bb_connection.ready", {
      bbLoginName: connection.bbLoginName,
      gameDate: recap.gameDate,
      leagueId: recap.leagueId,
      leagueTimeZone: resolveLeagueTimeZone(connection, null),
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const { season, slate, standings } =
      await resolveSeasonedLeagueSlateForRecap({
        bb,
        connection,
        gameDate: recap.gameDate,
        leagueId: recap.leagueId,
        targetKey: recap.targetKey,
        userId: recap.userId,
      });

    logGameDayRecapInfo("process.status_transition", {
      nextStatus: "BUILDING_CONTEXT",
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    await deps.updateGameDayRecap(args.env, {
      coverageJson: {
        availableGames: 0,
        missingGames: [],
        partial: false,
        requestedGames: slate.length,
      },
      leagueName: standings.league?.name ?? recap.leagueName ?? null,
      season,
      status: "BUILDING_CONTEXT",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const builtPromptPayload = await buildGameDayRecapPromptPayload({
      bb,
      connection,
      contextConcurrency: runtimeConfig.contextConcurrency,
      enforceCompletedSlateCoverage: true,
      fetchPublicMatchPlayByPlay: dependencies.fetchPublicMatchPlayByPlay,
      now: deps.now(),
      requestedGames: slate,
      request: {
        gameDate: recap.gameDate,
        gameDayNumber: null,
        generationApproach,
        interviewIntensity: normalizeRecapInterviewIntensity(
          recap.requestJson?.interviewIntensity,
        ),
        kind: "LEAGUE_DATE",
        label: `${standings.league?.name ?? recap.leagueId} ${recap.gameDate}`,
        leagueId: recap.leagueId,
        leagueName: standings.league?.name ?? recap.leagueName ?? null,
        matchId: null,
        season,
        timeZone: resolveLeagueTimeZone(connection, standings),
      },
      season,
      standings,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    const promptFactStore = await withResolvedInterviewPersonalities({
      env: args.env,
      factStore: builtPromptPayload.factStore,
      interviewPersonalityMode: runtimeConfig.interviewPersonalityMode,
      userId: recap.userId,
    });
    const promptPayload = buildGameDayRecapWriterPayloadFromFactStore({
      coverage: builtPromptPayload.coverage,
      factStore: promptFactStore,
    });
    coverage = promptPayload.coverage;

    logGameDayRecapInfo("process.prompt_payload.ready", {
      coverage,
      gameCount: promptPayload.games.length,
      leagueName: promptPayload.request.leagueName,
      season: promptPayload.request.season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    if (!promptPayload.games.length) {
      throw new Error(
        "No completed league games had enough box score coverage to generate a recap.",
      );
    }

    logGameDayRecapInfo("process.status_transition", {
      coverage,
      nextStatus: "INVOKING_MODEL",
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    await deps.updateGameDayRecap(args.env, {
      coverageJson: coverage,
      leagueName: promptPayload.request.leagueName,
      season,
      status: "INVOKING_MODEL",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    await deps.assertMaintenanceInactive();
    writerProvider = deps.createProvider({
      modelId,
      region: args.region,
      stage: "writer",
    });
    retryProvider =
      message.qualityTier === "premium" && runtimeModels.retryModelId
        ? deps.createProvider({
            modelId: runtimeModels.retryModelId,
            region: args.region,
            stage: "retry_writer",
          })
        : null;
    judgeProvider = message.modelJudgeEnabled && runtimeModels.judgeModelId
      ? deps.createProvider({
          modelId: runtimeModels.judgeModelId,
          region: args.region,
          stage: "judge",
        })
      : null;
    logGameDayRecapInfo("process.provider.ready", {
      modelId: writerProvider.modelId,
      providerName: writerProvider.providerName,
      qualityTier: message.qualityTier,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    const generatedRecap = await generateResolvedGameDayRecap({
      remainingTimeInMillis: args.remainingTimeInMillis,
      runtimeConfig,
      payload: promptPayload,
      qualityTier: message.qualityTier,
      retryProvider,
      judgeProvider,
      targetKey: recap.targetKey,
      userId: recap.userId,
      writerProvider,
    });
    coverage = mergeCoverageIssues(coverage, generatedRecap.coverageIssues);
    logGameDayRecapInfo("process.provider.succeeded", {
      gameCount: generatedRecap.result.games.length,
      summaryHeadline: generatedRecap.result.summary.headline,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    await deps.updateGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      costJson: buildGameDayRecapCostPayload({
        providers: [writerProvider, retryProvider, judgeProvider],
        result: generatedRecap.result,
      }),
      error: null,
      failureJson: null,
      leagueName: promptPayload.request.leagueName,
      modelId: writerProvider.modelId,
      modelProvider: writerProvider.providerName,
      promptVersion,
      resultJson: generatedRecap.result,
      season,
      status: "SUCCEEDED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    logGameDayRecapInfo("process.completed", {
      coverage,
      finalStatus: "SUCCEEDED",
      season,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
  } catch (error) {
    if (isRetryableCompletedSlateCoverageError(error)) {
      coverage = error.coverage;
    }
    logGameDayRecapError("process.failed", {
      coverage,
      targetKey: recap.targetKey,
      userId: recap.userId,
      ...toLoggableError(error),
    });
    await deps.updateGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      costJson: buildGameDayRecapCostPayload({
        providers: [writerProvider, retryProvider, judgeProvider],
        result: null,
      }),
      error: toMaintenanceAwareErrorMessage(error),
      failureJson: buildGameDayRecapFailureDetails(error),
      modelId,
      modelProvider: "bedrock",
      promptVersion,
      status: "FAILED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    throw error;
  }
}

export async function processQueuedRecapJob(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    remainingTimeInMillis?: () => number;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const message = resolveRecapMessage(args);
  switch (message.kind) {
    case "LEAGUE_GAME_DAY_PERFORMANCES":
      await processLeagueGameDayPerformances(args, dependencies);
      return;
    case "LEAGUE_GAME_DAY":
      await processLeagueGameDayRecap(args, dependencies);
      return;
    case "SINGLE_GAME":
      await processSingleGameSummary(args, dependencies);
      return;
    case "LEAGUE_DATE":
    default:
      await processGameDayRecap(args, dependencies);
  }
}

export async function finalizeQueuedRecapJobFailure(
  args: {
    env: GraphqlEnv;
    event: RecapQueueMessage & {
      error?: unknown;
    };
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<{ updated: boolean }> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage({ message: args.event });
  const completedAt = deps.now().toISOString();
  const errorMessage = buildQueuedRecapWorkflowFailureMessage({
    error: args.event.error,
    kind: message.kind,
  });

  switch (message.kind) {
    case "LEAGUE_GAME_DAY_PERFORMANCES": {
      const record = await deps.getLeagueGameDayPerformances(
        args.env,
        message.userId,
        message.targetKey,
      );
      if (
        !record ||
        record.userId !== message.userId ||
        record.requestedAt !== message.requestedAt ||
        (record.status && TERMINAL_RECAP_STATUSES.has(record.status))
      ) {
        return { updated: false };
      }
      await deps.updateLeagueGameDayPerformances(args.env, {
        completedAt,
        error: errorMessage,
        status: "FAILED",
        targetKey: record.targetKey,
        userId: record.userId,
      });
      break;
    }
    case "LEAGUE_GAME_DAY": {
      const record = await deps.getLeagueGameDayRecap(
        args.env,
        message.userId,
        message.targetKey,
      );
      if (
        !record ||
        record.userId !== message.userId ||
        record.requestedAt !== message.requestedAt ||
        (record.status && TERMINAL_RECAP_STATUSES.has(record.status))
      ) {
        return { updated: false };
      }
      await deps.updateLeagueGameDayRecap(args.env, {
        completedAt,
        error: errorMessage,
        status: "FAILED",
        targetKey: record.targetKey,
        userId: record.userId,
      });
      break;
    }
    case "SINGLE_GAME": {
      const record = await deps.getSingleGameSummary(
        args.env,
        message.userId,
        message.targetKey,
      );
      if (
        !record ||
        record.userId !== message.userId ||
        record.requestedAt !== message.requestedAt ||
        (record.status && TERMINAL_RECAP_STATUSES.has(record.status))
      ) {
        return { updated: false };
      }
      await deps.updateSingleGameSummary(args.env, {
        completedAt,
        error: errorMessage,
        status: "FAILED",
        targetKey: record.targetKey,
        userId: record.userId,
      });
      break;
    }
    case "LEAGUE_DATE":
    default: {
      const record = await deps.getGameDayRecap(
        args.env,
        message.userId,
        message.targetKey,
      );
      if (
        !record ||
        record.userId !== message.userId ||
        record.requestedAt !== message.requestedAt ||
        (record.status && TERMINAL_RECAP_STATUSES.has(record.status))
      ) {
        return { updated: false };
      }
      await deps.updateGameDayRecap(args.env, {
        completedAt,
        error: errorMessage,
        status: "FAILED",
        targetKey: record.targetKey,
        userId: record.userId,
      });
      break;
    }
  }

  logGameDayRecapWarn("process.workflow_failure_finalized", {
    errorMessage,
    kind: message.kind,
    requestedAt: message.requestedAt,
    targetKey: message.targetKey,
    userId: message.userId,
  });

  return { updated: true };
}

function buildQueuedRecapWorkflowFailureMessage(args: {
  error: unknown;
  kind: RecapQueueMessage["kind"];
}): string {
  const { causeMessage, errorName } = parseQueuedRecapWorkflowFailure(
    args.error,
  );
  const combinedText = [errorName, causeMessage].filter(Boolean).join(" ");
  const timedOut = /\b(?:states\.timeout|task timed out|timed out)\b/i.test(
    combinedText,
  );
  if (timedOut) {
    return args.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? "The report timed out before finishing."
      : "The writeup timed out before finishing.";
  }

  return (
    causeMessage ??
    errorName ??
    (args.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? "The report failed before finishing."
      : "The writeup failed before finishing.")
  );
}

function parseQueuedRecapWorkflowFailure(error: unknown): {
  causeMessage: string | null;
  errorName: string | null;
} {
  const errorRecord =
    error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : null;
  const errorName = asOptionalString(errorRecord?.["Error"])?.trim() ?? null;
  const rawCause = asOptionalString(errorRecord?.["Cause"])?.trim() ?? null;
  if (!rawCause) {
    return {
      causeMessage: null,
      errorName,
    };
  }

  try {
    const parsedCause = JSON.parse(rawCause) as Record<string, unknown>;
    const parsedMessage =
      asOptionalString(parsedCause.errorMessage)?.trim() ??
      asOptionalString(parsedCause.message)?.trim() ??
      rawCause;
    return {
      causeMessage: parsedMessage || null,
      errorName,
    };
  } catch {
    return {
      causeMessage: rawCause,
      errorName,
    };
  }
}

export async function processLeagueGameDayRecap(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    remainingTimeInMillis?: () => number;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage(args);
  const runtimeModels = resolveQueuedRecapStageModelIds({
    env: args.env,
    fallbackModelId: args.modelId,
    message,
  });
  const runtimeConfig = resolveGameDayRecapRuntimeConfig(args.env);
  const modelId = runtimeModels.writerModelId;
  const recap = await deps.getLeagueGameDayRecap(
    args.env,
    message.userId,
    message.targetKey,
  );
  if (!recap || recap.userId !== message.userId) {
    throw new Error(
      "League game day recap request is missing or no longer belongs to the enqueued user.",
    );
  }
  if (
    recap.requestedAt !== message.requestedAt ||
    (recap.status === "SUCCEEDED" && recap.completedAt)
  ) {
    return;
  }

  let coverage: GameDayRecapCoveragePayload | null = null;
  const generationApproach = resolveRecapGenerationApproach(recap.requestJson);
  const promptVersion = resolveGameDayRecapPromptVersion(generationApproach);
  let writerProvider: StructuredGameDayRecapProvider | null = null;
  let retryProvider: StructuredGameDayRecapProvider | null = null;
  let judgeProvider: StructuredGameDayRecapProvider | null = null;

  try {
    await deps.assertMaintenanceInactive();
    await deps.updateLeagueGameDayRecap(args.env, {
      error: null,
      failureJson: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion,
      costJson: null,
      status: "RESOLVING_SLATE",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    await deps.assertMaintenanceInactive();
    const connection = await requireBbConnection(args.env, recap.userId, deps);
    const accessKey = await deps.resolveBbAccessKey(args.env, recap.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });

    const standings =
      recap.season !== null && recap.season !== undefined
        ? await bb.getStandings(recap.leagueId, recap.season)
        : await bb.getStandings(recap.leagueId);
    const season = standings.season ?? recap.season;
    if (season === null || season === undefined) {
      throw new Error(
        `Unable to resolve a season for league ${recap.leagueId}.`,
      );
    }

    const slate = await resolveLeagueGameDaySlate({
      bb,
      gameDayNumber: recap.gameDayNumber,
      standings,
    });
    if (!slate.length) {
      throw new Error(
        `No regular-season league games were found for league ${recap.leagueId} on game day ${recap.gameDayNumber}.`,
      );
    }

    await deps.updateLeagueGameDayRecap(args.env, {
      coverageJson: {
        availableGames: 0,
        missingGames: [],
        partial: false,
        requestedGames: slate.length,
      },
      leagueName: standings.league?.name ?? recap.leagueName ?? null,
      season,
      status: "BUILDING_CONTEXT",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    const builtPromptPayload = await buildGameDayRecapPromptPayload({
      bb,
      connection,
      contextConcurrency: runtimeConfig.contextConcurrency,
      enforceCompletedSlateCoverage: true,
      fetchPublicMatchPlayByPlay: dependencies.fetchPublicMatchPlayByPlay,
      now: deps.now(),
      requestedGames: slate,
      request: {
        gameDate: null,
        gameDayNumber: recap.gameDayNumber,
        generationApproach,
        interviewIntensity: normalizeRecapInterviewIntensity(
          recap.requestJson?.interviewIntensity,
        ),
        kind: "LEAGUE_GAME_DAY",
        label: `${standings.league?.name ?? recap.leagueId} game day ${recap.gameDayNumber}`,
        leagueId: recap.leagueId,
        leagueName: standings.league?.name ?? recap.leagueName ?? null,
        matchId: null,
        season,
        timeZone: resolveLeagueTimeZone(connection, standings),
      },
      season,
      standings,
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    const promptFactStore = await withResolvedInterviewPersonalities({
      env: args.env,
      factStore: builtPromptPayload.factStore,
      interviewPersonalityMode: runtimeConfig.interviewPersonalityMode,
      userId: recap.userId,
    });
    const promptPayload = buildGameDayRecapWriterPayloadFromFactStore({
      coverage: builtPromptPayload.coverage,
      factStore: promptFactStore,
    });
    coverage = promptPayload.coverage;

    if (!promptPayload.games.length) {
      throw new Error(
        "No completed regular-season league games had enough box score coverage to generate a recap.",
      );
    }

    await deps.updateLeagueGameDayRecap(args.env, {
      coverageJson: coverage,
      leagueName: promptPayload.request.leagueName,
      season,
      status: "INVOKING_MODEL",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });

    await deps.assertMaintenanceInactive();
    writerProvider = deps.createProvider({
      modelId,
      region: args.region,
      stage: "writer",
    });
    retryProvider =
      message.qualityTier === "premium" && runtimeModels.retryModelId
        ? deps.createProvider({
            modelId: runtimeModels.retryModelId,
            region: args.region,
            stage: "retry_writer",
          })
        : null;
    judgeProvider = message.modelJudgeEnabled && runtimeModels.judgeModelId
      ? deps.createProvider({
          modelId: runtimeModels.judgeModelId,
          region: args.region,
          stage: "judge",
        })
      : null;
    const generatedRecap = await generateResolvedGameDayRecap({
      remainingTimeInMillis: args.remainingTimeInMillis,
      runtimeConfig,
      payload: promptPayload,
      qualityTier: message.qualityTier,
      retryProvider,
      judgeProvider,
      targetKey: recap.targetKey,
      userId: recap.userId,
      writerProvider,
    });
    coverage = mergeCoverageIssues(coverage, generatedRecap.coverageIssues);

    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      costJson: buildGameDayRecapCostPayload({
        providers: [writerProvider, retryProvider, judgeProvider],
        result: generatedRecap.result,
      }),
      error: null,
      failureJson: null,
      leagueName: promptPayload.request.leagueName,
      modelId: writerProvider.modelId,
      modelProvider: writerProvider.providerName,
      promptVersion,
      resultJson: generatedRecap.result,
      season,
      status: "SUCCEEDED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
  } catch (error) {
    if (isRetryableCompletedSlateCoverageError(error)) {
      coverage = error.coverage;
    }
    logGameDayRecapError("process.failed", {
      coverage,
      targetKey: recap.targetKey,
      userId: recap.userId,
      ...toLoggableError(error),
    });
    await deps.updateLeagueGameDayRecap(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      costJson: buildGameDayRecapCostPayload({
        providers: [writerProvider, retryProvider, judgeProvider],
        result: null,
      }),
      error: toMaintenanceAwareErrorMessage(error),
      failureJson: buildGameDayRecapFailureDetails(error),
      modelId,
      modelProvider: "bedrock",
      promptVersion,
      status: "FAILED",
      targetKey: recap.targetKey,
      userId: recap.userId,
    });
    throw error;
  }
}

export async function processLeagueGameDayPerformances(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage(args);
  const performances = await deps.getLeagueGameDayPerformances(
    args.env,
    message.userId,
    message.targetKey,
  );
  if (!performances || performances.userId !== message.userId) {
    throw new Error(
      "League game day performances request is missing or no longer belongs to the enqueued user.",
    );
  }
  if (
    performances.requestedAt !== message.requestedAt ||
    (performances.status === "SUCCEEDED" && performances.completedAt)
  ) {
    return;
  }

  let coverage: GameDayRecapCoveragePayload | null = null;

  try {
    await deps.assertMaintenanceInactive();
    await deps.updateLeagueGameDayPerformances(args.env, {
      error: null,
      modelId: null,
      modelProvider: "deterministic",
      promptVersion: null,
      status: "RESOLVING_SLATE",
      targetKey: performances.targetKey,
      userId: performances.userId,
    });

    await deps.assertMaintenanceInactive();
    const connection = await requireBbConnection(
      args.env,
      performances.userId,
      deps,
    );
    const accessKey = await deps.resolveBbAccessKey(
      args.env,
      performances.userId,
    );
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });

    const standings =
      performances.season !== null && performances.season !== undefined
        ? await bb.getStandings(performances.leagueId, performances.season)
        : await bb.getStandings(performances.leagueId);
    const season = standings.season ?? performances.season;
    if (season === null || season === undefined) {
      throw new Error(
        `Unable to resolve a season for league ${performances.leagueId}.`,
      );
    }

    const slate = await resolveLeagueGameDaySlate({
      bb,
      gameDayNumber: performances.gameDayNumber,
      standings,
    });
    if (!slate.length) {
      throw new Error(
        `No regular-season league games were found for league ${performances.leagueId} on game day ${performances.gameDayNumber}.`,
      );
    }

    coverage = {
      availableGames: 0,
      missingGames: [],
      partial: false,
      requestedGames: slate.length,
    };
    await deps.updateLeagueGameDayPerformances(args.env, {
      coverageJson: coverage,
      gameDate: null,
      leagueName: standings.league?.name ?? performances.leagueName ?? null,
      season,
      status: "BUILDING_CONTEXT",
      targetKey: performances.targetKey,
      userId: performances.userId,
    });

    const boxScoreCache = new Map<string, Promise<BoxScoreLoadResult>>();
    const loadedGames: Array<{
      boxScore: BBApiBoxScore;
      requestedGame: SlateGame;
    }> = [];

    for (const requestedGame of slate) {
      const boxScoreResult = await loadBoxScore(
        bb,
        boxScoreCache,
        requestedGame.matchId,
      );
      if (boxScoreResult.kind === "ok") {
        loadedGames.push({
          boxScore: boxScoreResult.boxScore,
          requestedGame,
        });
        continue;
      }

      coverage = {
        availableGames: loadedGames.length,
        missingGames: [
          {
            awayTeamName: requestedGame.awayTeamName,
            homeTeamName: requestedGame.homeTeamName,
            matchId: requestedGame.matchId,
            reason:
              boxScoreResult.kind === "incomplete_boxscore"
                ? "final box score was incomplete"
                : boxScoreResult.kind === "parse_failed"
                  ? "final box score could not be parsed"
                  : "final box score was unavailable",
          },
        ],
        partial: true,
        requestedGames: slate.length,
      };
      throw new Error(
        `League game day performances require a complete final slate. ${requestedGame.awayTeamName} at ${requestedGame.homeTeamName} could not be loaded.`,
      );
    }

    const timeZone = resolveLeagueTimeZone(connection, standings);
    const resolvedGameDate =
      resolveCalendarDateKey(
        loadedGames[0]?.boxScore.startTime ?? null,
        timeZone,
      ) ?? resolveCalendarDateKey(slate[0]?.startTime ?? null, timeZone);
    const result = buildLeagueGameDayPerformancesResult({
      gameDate: resolvedGameDate,
      gameDayNumber: performances.gameDayNumber,
      games: loadedGames,
      leagueId: performances.leagueId,
      leagueName: standings.league?.name ?? performances.leagueName ?? null,
      season,
    });
    coverage = {
      availableGames: loadedGames.length,
      missingGames: [],
      partial: false,
      requestedGames: slate.length,
    };

    await deps.updateLeagueGameDayPerformances(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: null,
      gameDate: resolvedGameDate ?? null,
      leagueName: result.leagueName,
      modelId: null,
      modelProvider: "deterministic",
      promptVersion: null,
      resultJson: result,
      season,
      status: "SUCCEEDED",
      targetKey: performances.targetKey,
      userId: performances.userId,
    });
  } catch (error) {
    await deps.updateLeagueGameDayPerformances(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      error: toMaintenanceAwareErrorMessage(error),
      modelId: null,
      modelProvider: "deterministic",
      promptVersion: null,
      status: "FAILED",
      targetKey: performances.targetKey,
      userId: performances.userId,
    });
    throw error;
  }
}

export async function processSingleGameSummary(
  args: {
    env: GraphqlEnv;
    message?: RecapQueueMessage;
    messageBody?: string;
    modelId?: string;
    remainingTimeInMillis?: () => number;
    region?: string;
  },
  dependencies: ProcessDependencyOverrides = defaultProcessDependencies,
): Promise<void> {
  const deps: ProcessDependencies = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecapMessage(args);
  const runtimeModels = resolveQueuedRecapStageModelIds({
    env: args.env,
    fallbackModelId: args.modelId,
    message,
  });
  const runtimeConfig = resolveGameDayRecapRuntimeConfig(args.env);
  const modelId = runtimeModels.writerModelId;
  const summary = await deps.getSingleGameSummary(
    args.env,
    message.userId,
    message.targetKey,
  );
  if (!summary || summary.userId !== message.userId) {
    throw new Error(
      "Single game summary request is missing or no longer belongs to the enqueued user.",
    );
  }
  if (
    summary.requestedAt !== message.requestedAt ||
    (summary.status === "SUCCEEDED" && summary.completedAt)
  ) {
    return;
  }

  let coverage: GameDayRecapCoveragePayload | null = null;
  const generationApproach = resolveRecapGenerationApproach(
    summary.requestJson,
  );
  const promptVersion = resolveGameDayRecapPromptVersion(generationApproach);
  let writerProvider: StructuredGameDayRecapProvider | null = null;
  let retryProvider: StructuredGameDayRecapProvider | null = null;
  let judgeProvider: StructuredGameDayRecapProvider | null = null;

  try {
    await deps.assertMaintenanceInactive();
    await deps.updateSingleGameSummary(args.env, {
      error: null,
      failureJson: null,
      modelId,
      modelProvider: "bedrock",
      promptVersion,
      costJson: null,
      status: "RESOLVING_SLATE",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });

    await deps.assertMaintenanceInactive();
    const connection = await requireBbConnection(
      args.env,
      summary.userId,
      deps,
    );
    const accessKey = await deps.resolveBbAccessKey(args.env, summary.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: connection.bbLoginName,
    });
    const boxScore = await bb.getBoxScore(summary.matchId);
    if (boxScore.homeTeam.score === null || boxScore.awayTeam.score === null) {
      throw new Error(
        `Match ${summary.matchId} does not have a final box score yet.`,
      );
    }

    const builtPromptPayload = await buildSingleGameSummaryPromptPayload({
      bb,
      boxScore,
      connection,
      fetchPublicMatchPlayByPlay: dependencies.fetchPublicMatchPlayByPlay,
      generationApproach,
      interviewIntensity: normalizeRecapInterviewIntensity(
        summary.requestJson?.interviewIntensity,
      ),
      loserInterviewPersonalityType: isInterviewPersonalityType(
        summary.requestJson?.loserInterviewPersonalityType,
      )
        ? summary.requestJson.loserInterviewPersonalityType
        : null,
      matchId: summary.matchId,
      winnerInterviewPersonalityType: isInterviewPersonalityType(
        summary.requestJson?.winnerInterviewPersonalityType,
      )
        ? summary.requestJson.winnerInterviewPersonalityType
        : null,
    });
    const promptFactStore = await withResolvedInterviewPersonalities({
      env: args.env,
      factStore: builtPromptPayload.factStore,
      interviewPersonalityMode: runtimeConfig.interviewPersonalityMode,
      requestedOverrides: {
        loserInterviewPersonalityType: isInterviewPersonalityType(
          summary.requestJson?.loserInterviewPersonalityType,
        )
          ? summary.requestJson.loserInterviewPersonalityType
          : null,
        winnerInterviewPersonalityType: isInterviewPersonalityType(
          summary.requestJson?.winnerInterviewPersonalityType,
        )
          ? summary.requestJson.winnerInterviewPersonalityType
          : null,
      },
      userId: summary.userId,
    });
    const promptPayload = buildGameDayRecapWriterPayloadFromFactStore({
      coverage: builtPromptPayload.coverage,
      factStore: promptFactStore,
    });
    coverage = promptPayload.coverage;

    await deps.updateSingleGameSummary(args.env, {
      coverageJson: coverage,
      gameDate: promptPayload.request.gameDate,
      leagueId: promptPayload.request.leagueId,
      leagueName: promptPayload.request.leagueName,
      season: promptPayload.request.season,
      status: "INVOKING_MODEL",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });

    await deps.assertMaintenanceInactive();
    writerProvider = deps.createProvider({
      modelId,
      region: args.region,
      stage: "writer",
    });
    retryProvider =
      message.qualityTier === "premium" && runtimeModels.retryModelId
        ? deps.createProvider({
            modelId: runtimeModels.retryModelId,
            region: args.region,
            stage: "retry_writer",
          })
        : null;
    judgeProvider = message.modelJudgeEnabled && runtimeModels.judgeModelId
      ? deps.createProvider({
          modelId: runtimeModels.judgeModelId,
          region: args.region,
          stage: "judge",
        })
      : null;
    const generatedRecap = await generateResolvedGameDayRecap({
      remainingTimeInMillis: args.remainingTimeInMillis,
      runtimeConfig,
      payload: promptPayload,
      qualityTier: message.qualityTier,
      retryProvider,
      judgeProvider,
      targetKey: summary.targetKey,
      userId: summary.userId,
      writerProvider,
    });
    coverage = mergeCoverageIssues(coverage, generatedRecap.coverageIssues);

    await deps.updateSingleGameSummary(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      costJson: buildGameDayRecapCostPayload({
        providers: [writerProvider, retryProvider, judgeProvider],
        result: generatedRecap.result,
      }),
      error: null,
      failureJson: null,
      gameDate: promptPayload.request.gameDate,
      leagueId: promptPayload.request.leagueId,
      leagueName: promptPayload.request.leagueName,
      modelId: writerProvider.modelId,
      modelProvider: writerProvider.providerName,
      promptVersion,
      resultJson: generatedRecap.result,
      season: promptPayload.request.season,
      status: "SUCCEEDED",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });
  } catch (error) {
    await deps.updateSingleGameSummary(args.env, {
      completedAt: deps.now().toISOString(),
      coverageJson: coverage,
      costJson: buildGameDayRecapCostPayload({
        providers: [writerProvider, retryProvider, judgeProvider],
        result: null,
      }),
      error: toMaintenanceAwareErrorMessage(error),
      failureJson: buildGameDayRecapFailureDetails(error),
      modelId,
      modelProvider: "bedrock",
      promptVersion,
      status: "FAILED",
      targetKey: summary.targetKey,
      userId: summary.userId,
    });
    throw error;
  }
}

function resolveRecapMessage(args: {
  message?: RecapQueueMessage;
  messageBody?: string;
}): RecapQueueMessage {
  if (args.message) {
    return {
      ...args.message,
      interviewIntensity: normalizeRecapInterviewIntensity(
        args.message.interviewIntensity,
      ),
      modelJudgeEnabled: args.message.modelJudgeEnabled === true,
    };
  }
  if (!args.messageBody) {
    throw new Error("Game day recap payload was not provided.");
  }
  return parseGameDayRecapQueueMessage(args.messageBody);
}

function resolveRecapQualityTier(planId: PlanId): RecapQualityTier {
  return planId === "premium" ? "premium" : "standard";
}

function resolveRequestedRecapQualityTier(
  env: GraphqlEnv,
  planId: PlanId,
): RecapQualityTier {
  if (!resolveCommercialModeEnabled(env)) {
    return "premium";
  }

  return resolveRecapQualityTier(planId);
}

function resolveConfiguredRecapStageModelIds(
  env: GraphqlEnv,
  qualityTier: RecapQualityTier,
): RecapStageModelIds {
  const writerModelId = resolveConfiguredRecapModelId(
    env,
    qualityTier === "premium" ? "premium" : "free",
  );
  if (qualityTier === "standard") {
    return {
      judgeModelId:
        normalizeConfiguredRecapModelId(
          env[GAME_DAY_RECAP_JUDGE_MODEL_ENV_NAME],
          GAME_DAY_RECAP_JUDGE_MODEL_ENV_NAME,
          false,
        ) ?? writerModelId,
      retryModelId: null,
      writerModelId,
    };
  }

  return {
    judgeModelId: resolvePremiumStageModelIdOrWriterFallback(env, {
      defaultEnvName: GAME_DAY_RECAP_JUDGE_MODEL_ENV_NAME,
      fallbackModelId: writerModelId,
      overrideEnvName: GAME_DAY_RECAP_JUDGE_PREMIUM_MODEL_ENV_NAME,
    }),
    retryModelId: resolvePremiumStageModelIdOrWriterFallback(env, {
      defaultEnvName: GAME_DAY_RECAP_RETRY_MODEL_ENV_NAME,
      fallbackModelId: writerModelId,
      overrideEnvName: GAME_DAY_RECAP_RETRY_PREMIUM_MODEL_ENV_NAME,
    }),
    writerModelId,
  };
}

function resolveConfiguredRecapModelId(
  env: GraphqlEnv,
  planId: PlanId,
): string {
  const defaultModelId = normalizeConfiguredRecapModelId(
    env[GAME_DAY_RECAP_MODEL_ENV_NAME],
    GAME_DAY_RECAP_MODEL_ENV_NAME,
    true,
  );
  if (!defaultModelId) {
    throw new Error(
      `${GAME_DAY_RECAP_MODEL_ENV_NAME} must be set for recap generation.`,
    );
  }
  const premiumModelId = normalizeConfiguredRecapModelId(
    env[GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME],
    GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME,
    false,
  );

  if (planId === "premium" && premiumModelId) {
    return premiumModelId;
  }

  return defaultModelId;
}

function resolvePremiumStageModelIdOrWriterFallback(
  env: GraphqlEnv,
  args: {
    defaultEnvName: string;
    fallbackModelId: string;
    overrideEnvName: string;
  },
): string {
  const defaultModelId = normalizeConfiguredRecapModelId(
    env[args.defaultEnvName],
    args.defaultEnvName,
    false,
  );
  const overrideModelId = normalizeConfiguredRecapModelId(
    env[args.overrideEnvName],
    args.overrideEnvName,
    false,
  );
  const resolvedModelId = overrideModelId ?? defaultModelId;
  return resolvedModelId ?? args.fallbackModelId;
}

function normalizeConfiguredRecapModelId(
  value: string | undefined,
  envName: string,
  required: boolean,
): string | null {
  const modelId = value?.trim() ?? "";
  if (!modelId) {
    if (required) {
      throw new Error(`${envName} must be set for recap generation.`);
    }
    return null;
  }

  assertSupportedBedrockRecapModelId(modelId, envName);
  return modelId;
}

function resolveQueuedRecapModelId(
  message: RecapQueueMessage,
  fallbackModelId: string | undefined,
): string {
  const resolvedModelId = message.modelId?.trim() || fallbackModelId?.trim();
  if (!resolvedModelId) {
    throw new Error(
      "Game day recap worker could not resolve a modelId from the queue message or GAME_DAY_RECAP_MODEL_ID.",
    );
  }

  return resolvedModelId;
}

function resolveQueuedRecapStageModelIds(args: {
  env: GraphqlEnv;
  fallbackModelId: string | undefined;
  message: RecapQueueMessage;
}): RecapStageModelIds {
  const writerModelFallback =
    args.message.qualityTier === "premium"
      ? (normalizeConfiguredRecapModelId(
          args.env[GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME] ??
            args.env[GAME_DAY_RECAP_MODEL_ENV_NAME],
          args.env[GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME]
            ? GAME_DAY_RECAP_PREMIUM_MODEL_ENV_NAME
            : GAME_DAY_RECAP_MODEL_ENV_NAME,
          false,
        ) ?? args.fallbackModelId)
      : args.fallbackModelId;
  const writerModelId = resolveQueuedRecapModelId(
    args.message,
    writerModelFallback,
  );

  if (args.message.qualityTier !== "premium") {
    return {
      judgeModelId:
        normalizeConfiguredRecapModelId(
          args.env[GAME_DAY_RECAP_JUDGE_MODEL_ENV_NAME],
          GAME_DAY_RECAP_JUDGE_MODEL_ENV_NAME,
          false,
        ) ?? writerModelId,
      retryModelId: null,
      writerModelId,
    };
  }

  return {
    judgeModelId: resolvePremiumStageModelIdOrWriterFallback(args.env, {
      defaultEnvName: GAME_DAY_RECAP_JUDGE_MODEL_ENV_NAME,
      fallbackModelId: writerModelId,
      overrideEnvName: GAME_DAY_RECAP_JUDGE_PREMIUM_MODEL_ENV_NAME,
    }),
    retryModelId: resolvePremiumStageModelIdOrWriterFallback(args.env, {
      defaultEnvName: GAME_DAY_RECAP_RETRY_MODEL_ENV_NAME,
      fallbackModelId: writerModelId,
      overrideEnvName: GAME_DAY_RECAP_RETRY_PREMIUM_MODEL_ENV_NAME,
    }),
    writerModelId,
  };
}

function resolveGameDayRecapRuntimeConfig(
  env: GraphqlEnv,
): GameDayRecapRuntimeConfig {
  return {
    ...DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG,
    contextConcurrency: parsePositiveIntegerRuntimeEnv(
      env[GAME_DAY_RECAP_CONTEXT_CONCURRENCY_ENV_NAME],
      DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG.contextConcurrency,
    ),
    enforceBannedStylePhrases:
      (env.GAME_DAY_RECAP_ENFORCE_BANNED_STYLE_PHRASES ?? "")
        .trim()
        .toLowerCase() === "true",
    fullSlatePolishMode: normalizeFullSlatePolishModeRuntimeEnv(
      env[GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE_ENV_NAME],
    ),
    interviewConcurrency: parsePositiveIntegerRuntimeEnv(
      env[GAME_DAY_RECAP_INTERVIEW_CONCURRENCY_ENV_NAME],
      DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG.interviewConcurrency,
    ),
    interviewPersonalityMode: normalizeInterviewPersonalityMode(
      env.GAME_DAY_RECAP_INTERVIEW_PERSONALITY_MODE ?? null,
    ),
    judgeConcurrency: parsePositiveIntegerRuntimeEnv(
      env[GAME_DAY_RECAP_JUDGE_CONCURRENCY_ENV_NAME],
      DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG.judgeConcurrency,
    ),
    polishConcurrency: parsePositiveIntegerRuntimeEnv(
      env[GAME_DAY_RECAP_POLISH_CONCURRENCY_ENV_NAME],
      DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG.polishConcurrency,
    ),
  };
}

function parsePositiveIntegerRuntimeEnv(
  value: string | undefined,
  fallback: number,
): number {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeFullSlatePolishModeRuntimeEnv(
  value: string | undefined,
): GameDayRecapFullSlatePolishMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "always" || normalized === "off" ? normalized : "auto";
}

export function resolveSeasonForDate(
  seasons: BBApiSeasons,
  gameDate: string,
): number {
  const matchTimestamp = parseDateOnlyToTimestamp(gameDate);
  const diagnostics = summarizeSeasonDiagnostics(seasons, gameDate);
  logGameDayRecapInfo("resolveSeasonForDate.evaluate", {
    gameDate,
    matchTimestamp: toFiniteNumberOrNull(matchTimestamp),
    seasons: diagnostics,
  });
  if (!Number.isFinite(matchTimestamp)) {
    logGameDayRecapWarn("resolveSeasonForDate.invalid_game_date", {
      gameDate,
      matchTimestamp: toFiniteNumberOrNull(matchTimestamp),
    });
    throw new Error(`Unable to resolve season for invalid date ${gameDate}.`);
  }

  const matchedSeason = diagnostics.find((season) => season.matchesGameDate);

  if (matchedSeason?.id !== null && matchedSeason?.id !== undefined) {
    logGameDayRecapInfo("resolveSeasonForDate.matched", {
      gameDate,
      seasonId: matchedSeason.id,
    });
    return matchedSeason.id;
  }

  logGameDayRecapWarn("resolveSeasonForDate.no_match", {
    gameDate,
    matchTimestamp: toFiniteNumberOrNull(matchTimestamp),
    seasons: diagnostics,
  });
  throw new Error(`Unable to resolve a BuzzerBeater season for ${gameDate}.`);
}

export async function resolveLeagueDaySlate(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  gameDate: string;
  standings: BBApiStandings;
  timeZone?: string | null;
}): Promise<SlateGame[]> {
  const { slate } = await resolveLeagueDaySlateWithDiagnostics(args);
  return slate;
}

async function resolveLeagueDaySlateWithDiagnostics(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  gameDate: string;
  standings: BBApiStandings;
  timeZone?: string | null;
}): Promise<{
  diagnostics: LeagueSlateResolutionDiagnostics;
  slate: SlateGame[];
}> {
  const standingTeams = extractStandingTeams(args.standings);
  if (!standingTeams.size) {
    return {
      diagnostics: {
        exactMatchCount: 0,
        leagueMatchCount: 0,
        nearMisses: [],
        scheduleRowCount: 0,
        teamCount: 0,
        timeZone: normalizeLeagueTimeZone(args.timeZone),
      },
      slate: [],
    };
  }

  const schedules = await Promise.all(
    Array.from(standingTeams.keys()).map(async (teamId) =>
      args.bb.getSchedule(teamId, args.standings.season ?? undefined),
    ),
  );

  const slateByMatchId = new Map<string, SlateGame>();
  const diagnostics: LeagueSlateResolutionDiagnostics = {
    exactMatchCount: 0,
    leagueMatchCount: 0,
    nearMisses: [],
    scheduleRowCount: 0,
    teamCount: standingTeams.size,
    timeZone: normalizeLeagueTimeZone(args.timeZone),
  };

  for (const schedule of schedules) {
    for (const match of schedule.matches) {
      diagnostics.scheduleRowCount += 1;
      const matchId = match.id?.trim();

      const homeTeamId = match.homeTeam.id?.trim();
      const awayTeamId = match.awayTeam.id?.trim();
      if (
        !homeTeamId ||
        !awayTeamId ||
        !standingTeams.has(homeTeamId) ||
        !standingTeams.has(awayTeamId) ||
        !isLeagueScheduleMatchType(match.type)
      ) {
        continue;
      }

      diagnostics.leagueMatchCount += 1;

      const matchDate = resolveCalendarDateKey(
        match.startTime,
        diagnostics.timeZone,
      );
      if (!matchId || matchDate !== args.gameDate) {
        if (diagnostics.nearMisses.length < 3) {
          diagnostics.nearMisses.push({
            awayTeamId,
            awayTeamName: match.awayTeam.teamName ?? null,
            derivedDate: matchDate,
            homeTeamId,
            homeTeamName: match.homeTeam.teamName ?? null,
            matchId: matchId ?? null,
            startTime: match.startTime,
          });
        }
        continue;
      }

      diagnostics.exactMatchCount += 1;

      if (!slateByMatchId.has(matchId)) {
        slateByMatchId.set(
          matchId,
          toSlateGameFromScheduleMatch({
            awayTeamName:
              match.awayTeam.teamName ??
              standingTeams.get(awayTeamId)?.teamName ??
              "Away team",
            homeTeamName:
              match.homeTeam.teamName ??
              standingTeams.get(homeTeamId)?.teamName ??
              "Home team",
            match,
          }),
        );
      }
    }
  }

  return {
    diagnostics,
    slate: Array.from(slateByMatchId.values()).sort((left, right) =>
      compareTimestamps(left.startTime, right.startTime),
    ),
  };
}

export async function resolveLeagueGameDaySlate(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  gameDayNumber: number;
  standings: BBApiStandings;
}): Promise<SlateGame[]> {
  const standingTeams = extractStandingTeams(args.standings);
  if (!standingTeams.size) {
    return [];
  }

  const schedules = await Promise.all(
    Array.from(standingTeams.keys()).map(async (teamId) =>
      args.bb.getSchedule(teamId, args.standings.season ?? undefined),
    ),
  );

  const slateByMatchId = new Map<
    string,
    SlateGame & {
      gameDayNumbers: Set<number>;
    }
  >();

  for (const schedule of schedules) {
    const regularSeasonMatches = schedule.matches
      .filter((match) => isRegularSeasonLeagueMatchType(match.type))
      .sort((left, right) =>
        compareTimestamps(left.startTime, right.startTime),
      );

    regularSeasonMatches.forEach((match, index) => {
      const gameDayNumber = index + 1;
      const matchId = match.id?.trim();
      const homeTeamId = match.homeTeam.id?.trim();
      const awayTeamId = match.awayTeam.id?.trim();
      if (
        !matchId ||
        !homeTeamId ||
        !awayTeamId ||
        !standingTeams.has(homeTeamId) ||
        !standingTeams.has(awayTeamId)
      ) {
        return;
      }

      const existing = slateByMatchId.get(matchId);
      if (existing) {
        existing.gameDayNumbers.add(gameDayNumber);
        return;
      }

      slateByMatchId.set(matchId, {
        ...toSlateGameFromScheduleMatch({
          awayTeamName:
            match.awayTeam.teamName ??
            standingTeams.get(awayTeamId)?.teamName ??
            "Away team",
          homeTeamName:
            match.homeTeam.teamName ??
            standingTeams.get(homeTeamId)?.teamName ??
            "Home team",
          match,
        }),
        gameDayNumbers: new Set([gameDayNumber]),
      });
    });
  }

  return Array.from(slateByMatchId.values())
    .filter((game) => game.gameDayNumbers.has(args.gameDayNumber))
    .sort((left, right) => compareTimestamps(left.startTime, right.startTime))
    .map(({ gameDayNumbers: _gameDayNumbers, ...game }) => game);
}

function isLeagueScheduleMatchType(type: string | null | undefined): boolean {
  const normalizedType = type?.trim().toLowerCase();
  return Boolean(
    normalizedType &&
    (normalizedType === "league" || normalizedType.startsWith("league.")),
  );
}

function isRegularSeasonLeagueMatchType(
  type: string | null | undefined,
): boolean {
  return isLeagueRegularSeasonCompetition(type);
}

function toSlateGameFromScheduleMatch(args: {
  awayTeamName: string;
  homeTeamName: string;
  match: BBApiScheduleMatch;
}): SlateGame {
  return {
    awayTeamId: args.match.awayTeam.id?.trim() ?? "unknown-away",
    awayTeamName: args.awayTeamName,
    isScheduleFinal:
      args.match.homeTeam.score !== null && args.match.awayTeam.score !== null,
    homeTeamId: args.match.homeTeam.id?.trim() ?? "unknown-home",
    homeTeamName: args.homeTeamName,
    matchId: args.match.id?.trim() ?? "unknown-match",
    scheduledAwayScore: args.match.awayTeam.score,
    scheduledHomeScore: args.match.homeTeam.score,
    startTime: args.match.startTime,
    type: args.match.type,
  };
}

export function buildGameDayRecapBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapWriterRequestPayload;
  validationFeedback?: string[];
  validationContext?: GameDayRecapRetryValidationContext | null;
}) {
  if (isStylePolishRequestPayload(args.payload)) {
    return buildGameDayRecapStylePolishBedrockRequest({
      modelId: args.modelId,
      payload: args.payload,
    });
  }

  if (isPostgameInterviewRequestPayload(args.payload)) {
    return buildGameDayRecapPostgameInterviewBedrockRequest({
      modelId: args.modelId,
      payload: args.payload,
    });
  }

  return buildGameDayRecapWriterBedrockRequest({
    modelId: args.modelId,
    payload: args.payload,
    validationFeedback: args.validationFeedback,
    validationContext: args.validationContext,
  });
}

function isStylePolishRequestPayload(
  payload: GameDayRecapWriterRequestPayload,
): payload is GameDayRecapPolishRequestPayload {
  return "task" in payload && payload.task === "style_polish";
}

function isPostgameInterviewRequestPayload(
  payload: GameDayRecapWriterRequestPayload,
): payload is GameDayRecapPostgameInterviewRequestPayload {
  return "task" in payload && payload.task === "postgame_interview";
}

function buildGameDayRecapWriterBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapPromptPayload;
  validationFeedback?: string[];
  validationContext?: GameDayRecapRetryValidationContext | null;
}) {
  const validationFeedback = args.validationFeedback?.filter(Boolean) ?? [];
  const validationContext = args.validationContext ?? null;
  const promptPayload = sanitizePromptPayloadForWriter(args.payload);
  const useFactsLibraryFirst =
    args.payload.request.generationApproach ===
    RecapGenerationApproach.FACT_LIBRARY_FIRST;
  const writerGoals = [
    "Write a concise headline and lede for the requested recap scope.",
    "Write one reporter-style recap for each completed game in medium length.",
    "Write every recap in the voice of a polished professional sportswriter.",
    "Use the supplied final team scores and winner as the source of truth for every outcome claim.",
    "If a game has only four periods, do not mention overtime. If it has more than four periods, mention overtime only when it helps the story and keep the count accurate.",
    "If a game includes requiredContextSentences, include each supplied requiredContextSentence exactly once in the writeup and keep the wording intact.",
    "If a game includes effortSummary or gameDayPrepSummaries, use the supplied requiredContextSentences as the only effort and game-day-prep copy rather than inventing a paraphrase or citing raw effortDelta or GDP codes.",
    "Do not write a separate tactical or GDP setup sentence that repeats a requiredContextSentence in different words.",
    "If a game includes rotationSummaries, fold that short-handed or foul-trouble context into the writeup in natural language without guessing why a player sat.",
    "Only call a game high-scoring or a shootout when gameScoringContext is high_scoring_shootout; only call it low-scoring or a defensive grind when gameScoringContext is low_scoring_grind.",
    "If a one-possession game includes playByPlayFacts.endingFacts, lead with that decisive ending in the headline or the opening sentence instead of burying it under broader context.",
    "If a game includes playByPlaySummaryLines, prefer those code-generated lines when mentioning supplied play-by-play context.",
    "If a game includes playByPlayFacts.endingFacts, use those structured ending facts as the source of truth for buzzerbeaters, go-ahead shots, and last missed chances.",
    "If a game includes playByPlayFacts.bestCompetitiveSwingRun or playByPlayFacts.leadChangeFacts, use those structured facts as the source of truth for runs, comebacks to the lead, and lead-change bursts.",
    "If a game includes playByPlayFacts.primaryRun, mention that exact primaryRun somewhere in the writeup using the supplied run score and timing anchors.",
    "If a game includes playByPlayFacts.secondaryRun, you may mention it when it meaningfully sharpens the story, but do not force it in.",
    "If a game includes playByPlayFacts and its ending facts mark a buzzerbeater, use the word buzzerbeater in the headline or opening sentence.",
    "If a game includes seriesContext.summaryLine, put the series state in the game headline and do not repeat the series-score sentence in the writeup.",
    "For team-rating or team-talent claims, use only game.teamRatingFacts, game.teamTalent, and factsLibrary.matchupEdgeFacts.supported; never invent rating edges.",
    "Use natural phrases such as team talent or talent edge; never write raw ratings, BBStats, or numeric rating totals in public recap prose.",
    "If a game is decided by three points or fewer but the supplied play-by-play does not identify a final-possession detail, keep the finish grounded and do not invent a last shot, last miss, or last turnover.",
    "If a game includes playByPlayFacts, use only those supplied facts and never infer unsupplied possession-by-possession detail.",
    "Only mention a run when the supplied play-by-play facts support it, and include the supplied timing anchors when you do.",
    "If mentioning more than one run, use only non-overlapping run windows from the supplied facts.",
    "Use game-high only for a global game leader supplied by playerLeaders. Use team-high or led [team] for team-scoped leaders from teams[].topPlayers.",
    "Only mention lead-change counts, rapid back-and-forth bursts, or comeback-to-the-lead claims when the supplied play-by-play facts support them, and keep the counts and timing exact.",
    "Once the writeup moves past the lede, keep the game flow in chronological order.",
    "Use comeback language for a cited run only when that team started the run trailing; if it started tied or ahead, describe the run neutrally as building the lead or staying in front.",
    "Reserve contrasting or opposite offense language for materially different offensive families; do not call same-family pairings such as Motion and Princeton contrasting.",
    "When a late go-ahead score and immediate lead-extension free throws belong to the same closing sequence, condense them into one closing-possession sentence instead of listing each free throw separately.",
    "In playoff games, do not mention regular-season records or any winning or losing streaks.",
    "Keep each writeup flowing like sports-reporter prose rather than a checklist, bullet list, or stack of disconnected facts.",
    "Use connective, polished sports-desk prose with varied sentence length instead of stacking short note-like fact sentences.",
    "Do not restate the same winner-and-score outcome in a later throwaway sentence once the writeup has already established it.",
    "Prefer concrete basketball detail over filler such as 'at a key juncture' or 'proved decisive'.",
    "Do not call a one-game win or loss a streak.",
    "When a supplied ending, buzzerbeater, comeback, or last-chance miss is the story, do not lead with effort or preparation context instead.",
    "Do not include postgameInterview in this response. The interview is generated in a separate pass.",
    "Use only the provided evidence and keep any strategic de-emphasis language cautious.",
    "If validationContext is present, fix the flagged sentences and issues directly while leaving already-supported material intact.",
    ...(useFactsLibraryFirst
      ? [
          "When factsLibrary is present for a game, treat it as the primary deterministic story source for headline, opener, period-state, and momentum claims.",
          "Prefer factsLibrary.headlineCandidates and factsLibrary.openingCandidates before inventing a new framing angle.",
          "When factsLibrary.requiredContextSentences is present, include each requiredContextSentence exactly once.",
          "Use factsLibrary.periodStates.throughThreeQuarters for any through-three-quarters claim instead of estimating from other context.",
          "Use only factsLibrary.matchupEdgeFacts.supported for why-the-winner-won explanations and avoid the suppressed explanations.",
          "If factsLibrary.gameFlow.doNotEmphasize includes guidance, follow it and avoid those angles.",
          "Use factsLibrary.narrativePlan to organize the writeup into paragraphs in this order: setup, chronological game flow, then player and team-rating explanation.",
          "Separate writeup paragraphs with a blank line. Paragraph 1 should cover pregame tactics, effort, and game-day prep context; paragraph 2 should move through the game in time order; paragraph 3 should close with player stat lines and why the winner won.",
          "Only mention runs, lead-change bursts, last-lead, or took-the-lead-for-good angles when they are explicitly present in factsLibrary.gameFlow or playByPlayFacts.",
        ]
      : []),
  ];
  const systemInstructions = [
    "You are writing basketball recaps for the requested game or slate in the voice of a polished professional sports reporter.",
    "Use only supplied facts. Do not invent transfers, injuries, off-court news, or unsupplied play-by-play details.",
    "Write in a natural sports-reporter voice with connected prose, not a checklist of facts.",
    "Favor smooth, transitional sentences over stacked score-note fragments.",
    "If the evidence suggests one side may have treated the game as lower priority, phrase it cautiously and never call it a punt unless the evidence is explicit.",
    "When requiredContextSentences are present for a game, include each one exactly once in the writeup.",
    "When requiredContextSentences cover effort or game-day prep, do not add a second paraphrase of that same prep or pace read.",
    "Never cite the raw effortDelta value or raw GDP codes.",
    "When rotationSummaries are present for a game, mention that short-handed or foul-trouble context naturally and do not invent reasons such as injuries, load management, or discipline beyond the provided note.",
    "When playByPlayFacts.endingFacts are present for a close game, treat those structured ending facts as the preferred source for the lede.",
    "When playByPlaySummaryLines are present for a game, treat them as the preferred source for any supplied play-by-play mention.",
    "When playByPlayFacts.endingFacts mark a buzzerbeater, use the word buzzerbeater in the headline or opening sentence.",
    "When playByPlayFacts.primaryRun is present, mention that exact run in the writeup using the supplied score and timing anchors.",
    "When playByPlayFacts.secondaryRun is present, use it only when it helps the story stay specific.",
    "When seriesContext.summaryLine is present for a game, express the series state in the game headline and do not repeat the series-score sentence in the writeup.",
    "If a game is decided by three points or fewer but the supplied play-by-play does not identify a final-possession detail, keep the finish grounded and do not invent a last shot, last miss, or last turnover.",
    "When playByPlayFacts are present for a game, use them only as provided and do not embellish them into unsupplied sequences.",
    "When playByPlayFacts.bestCompetitiveSwingRun or playByPlayFacts.leadChangeFacts are present, use them as the source of truth for runs and back-and-forth claims.",
    "Only mention runs when the supplied play-by-play facts support them, and include the supplied timing anchors.",
    "Keep the game flow in time order after the opener; do not jump backward in the timeline without a clear transition.",
    "Use comeback phrasing for a run only when that team actually started the run trailing.",
    "Do not mention overlapping run windows as separate game swings; if two supplied run facts overlap, keep the stronger primary run.",
    "Use game-high only for a global game leader supplied by playerLeaders. Use team-high or led [team] for team-scoped leaders from teams[].topPlayers.",
    "Only mention lead-change counts, rapid bursts, or comeback-to-the-lead claims when the supplied play-by-play facts support them, and keep the counts and timing exact.",
    "Reserve contrasting or opposite offense wording for materially different offensive families; do not call same-family pairings such as Motion and Princeton contrasting.",
    "When a late go-ahead basket and immediate lead-extension free throws are part of the same sequence, summarize them as one closing possession.",
    "Do not include postgameInterview in this response.",
    "In playoff games, do not mention regular-season records or any winning or losing streaks.",
    "Outside playoff games, unqualified team record, streak, and recent-form fields describe the postgame state after the final result.",
    "Team context fields ending in EnteringGame describe the state before tipoff and should only appear when you are explicitly contrasting the pregame setup.",
    "The final winner and final score are the source of truth for outcome language.",
    "If a game has only four periods, do not call it overtime. If it has overtime periods, keep that claim accurate.",
    "Use quarterFacts as the source of truth for period-by-period scoring. If a quarter is tied, do not say either team outscored, won, or took that quarter.",
    "Only use high-scoring/shootout or low-scoring/defensive-grind framing when gameScoringContext explicitly supports it.",
    "If you mention team ratings, use the supplied BuzzerBeater word labels rather than raw numeric scores.",
    "For team-rating or team-talent claims, use only teamRatingFacts, teamTalent, and factsLibrary.matchupEdgeFacts.supported; never invent rating edges.",
    "Use natural phrases such as team talent or talent edge; never write raw ratings, BBStats, or numeric rating totals in public recap prose.",
    "Do not restate the exact same winner-and-score outcome in a later sentence once the game result is already clear.",
    "Prefer concrete basketball detail over filler such as 'at a key juncture' or 'proved decisive'.",
    "Never call a one-game win or loss a streak.",
    "If a decisive late-game ending is supplied, do not bury it beneath effort or GDP context.",
    "If validationContext is present, treat it as a surgical rewrite brief rather than a reason to rewrite the whole recap.",
    "Headlines should be vivid but factual.",
    ...(useFactsLibraryFirst
      ? [
          "When factsLibrary is present, treat it as the preferred deterministic source for headline candidates, opening candidates, matchup edges, and story-shape cues.",
          "When factsLibrary.requiredContextSentences is present, keep those exact sentences intact.",
          "Use factsLibrary.summaryFacts and factsLibrary.storySignals to guide the writeup, but keep the final prose connected and natural.",
          "Honor any factsLibrary.matchupEdgeFacts.suppressed guidance and do not present those angles as reasons the winner won.",
          "Honor any factsLibrary.gameFlow.doNotEmphasize guidance and do not force late-basket capper language when the payload warns against it.",
          "Use factsLibrary.narrativePlan as the story outline and separate the setup, chronological game flow, and closing analysis with blank lines.",
        ]
      : []),
    validationFeedback.length > 0
      ? `Previous draft issues to correct: ${validationFeedback.join(" ")}`
      : "",
  ];

  return {
    inferenceConfig: {
      maxTokens: 5000,
      temperature: useFactsLibraryFirst ? 0.55 : 0.8,
    },
    messages: [
      {
        content: [
          {
            text: JSON.stringify(
              {
                instructions: {
                  evidenceTags: GAME_DAY_RECAP_EVIDENCE_TAGS,
                  goals: writerGoals,
                  validationFeedback:
                    validationFeedback.length > 0
                      ? validationFeedback
                      : undefined,
                  validationContext: validationContext ?? undefined,
                },
                recapContext: promptPayload,
              },
              null,
              2,
            ),
          },
        ],
        role: "user" as const,
      },
    ],
    modelId: args.modelId,
    outputConfig: {
      // The JSON schema is the contract. Prompt text is only for tone and evidence use.
      textFormat: {
        structure: {
          jsonSchema: {
            description:
              "Reporter-style basketball recap output for one requested scope.",
            name: "game_day_recap",
            schema: JSON.stringify(
              toBedrockStructuredOutputSchema(GAME_DAY_RECAP_RESULT_SCHEMA),
            ),
          },
        },
        type: "json_schema" as const,
      },
    },
    system: [
      {
        text: systemInstructions.join(" "),
      },
    ],
  };
}

function buildGameDayRecapStylePolishBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapPolishRequestPayload;
}) {
  return {
    inferenceConfig: {
      maxTokens: 1800,
      temperature: 0.2,
    },
    messages: [
      {
        content: [
          {
            text: JSON.stringify(
              {
                instructions: {
                  goals: [
                    "Rewrite only the writeup into smoother professional sportswriter prose.",
                    "Preserve every supplied fact exactly.",
                    "Keep playoff series-score language out of the writeup; that state belongs in the headline.",
                    "Keep the exact supplied primary run mention and timing anchors.",
                    "Keep every requiredContextSentence exactly once.",
                    "Do not add a second paraphrase of a required effort, tactic, pace, or game-day-prep sentence.",
                    "Remove duplicate quarter or outcome restatements when they are redundant.",
                    "Keep the timeline in chronological order once the writeup moves into game flow.",
                    "Use comeback language only when the cited run began with that team trailing.",
                    "Reserve contrasting or opposite offense language for materially different offensive families.",
                    "Condense same-sequence go-ahead scores and immediate lead-extension free throws into one closing-possession beat.",
                    "Keep or create paragraph breaks between setup, chronological game flow, and closing analysis.",
                    "Vary sentence openings and sentence length.",
                    "Use cleaner transitions and more connected prose.",
                  ],
                  restrictions: [
                    "Do not change the game result.",
                    "Do not add or remove any supported factual claim unless you are removing a redundant repetition.",
                    "Do not split the same late-game closing possession into multiple micro-event sentences.",
                    "Do not introduce any postgameInterview content.",
                    "Return only the rewritten writeup.",
                  ],
                },
                gameFacts: args.payload.gameFacts,
                recapGame: args.payload.recapGame,
                request: args.payload.request,
              },
              null,
              2,
            ),
          },
        ],
        role: "user" as const,
      },
    ],
    modelId: args.modelId,
    outputConfig: {
      textFormat: {
        structure: {
          jsonSchema: {
            description: "Style-only rewrite of one basketball recap writeup.",
            name: "game_day_recap_style_polish",
            schema: JSON.stringify(
              toBedrockStructuredOutputSchema(
                GAME_DAY_RECAP_STYLE_POLISH_RESULT_SCHEMA,
              ),
            ),
          },
        },
        type: "json_schema" as const,
      },
    },
    system: [
      {
        text: [
          "You are a sports-desk line editor polishing a grounded basketball recap.",
          "Use only the supplied facts.",
          "Keep required exact sentences intact.",
          "Improve flow and readability without adding new information.",
          "Return structured output only.",
        ].join(" "),
      },
    ],
  };
}

function buildGameDayRecapPostgameInterviewBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapPostgameInterviewRequestPayload;
}) {
  const interviewIntensity = args.payload.request.interviewIntensity;
  return {
    inferenceConfig: {
      maxTokens: 1400,
      temperature: 0.35,
    },
    messages: [
      {
        content: [
          {
            text: JSON.stringify(
              {
                instructions: {
                  goals: [
                    "Write a short fact-grounded postgame interview for the supplied player.",
                    "Use one or two short Q&A exchanges.",
                    "Ground every answer only in the supplied candidate facts and game facts.",
                    "Write the title and every question in polished professional sportswriter tone.",
                    "For a loser-perspective candidate, ask what went wrong, where the game turned, and what changes for the next game.",
                    "Let the supplied personality type shape only the player's answers, without changing the facts.",
                    "Make the selected personality unmistakable in every player answer through cadence, rhythm, metaphor, and word choice.",
                    "Push the player's answers far enough that the voice is obvious without any debug labels.",
                    "Use the example sentence inside personalityGuidance as a style reference point, not as a fact to copy.",
                  ],
                  restrictions: [
                    `Honor the requested interviewIntensity of ${interviewIntensity}.`,
                    "Use the exact supplied playerName, teamName, and teamSide.",
                    "Do not invent exact shot-order details, streak counts, locker-room scenes, or coach quotes.",
                    "Do not overstate garbage-time baskets as game-sealing moments unless the supplied ending facts support that.",
                    "Do not contradict the supplied writeup or game facts.",
                    "Do not let the player's personality spill into the title or the reporter questions.",
                    "Do not flatten the player's answers into generic athlete-speak when a personality type is supplied.",
                    "Keep any swagger, philosopher references, bar-like phrasing, and trash talk original rather than quoting recognizable lyrics or public lines verbatim.",
                    "Do not copy the example sentence verbatim unless the supplied facts make that wording naturally fit.",
                    "Return only the postgameInterview object.",
                  ],
                },
                candidate: args.payload.candidate,
                gameFacts: args.payload.gameFacts,
                personalityGuidance: resolveInterviewPersonalityPrompt(
                  {
                    intensity: interviewIntensity,
                    personalityType:
                      args.payload.candidate.personalityType ?? "friendly",
                  },
                ),
                recapGame: args.payload.recapGame,
                request: args.payload.request,
              },
              null,
              2,
            ),
          },
        ],
        role: "user" as const,
      },
    ],
    modelId: args.modelId,
    outputConfig: {
      textFormat: {
        structure: {
          jsonSchema: {
            description:
              "Grounded postgame interview for one basketball recap game.",
            name: "game_day_recap_postgame_interview",
            schema: JSON.stringify(
              toBedrockStructuredOutputSchema(
                GAME_DAY_RECAP_POSTGAME_INTERVIEW_SCHEMA,
              ),
            ),
          },
        },
        type: "json_schema" as const,
      },
    },
    system: [
      {
        text: [
          "You are writing a fact-grounded postgame interview snippet for a basketball recap.",
          "Use only the supplied facts.",
          "Keep the interview short, concrete, and quotable.",
          "Write the title and questions in professional sportswriter tone.",
          "Use the supplied personality guidance only for the player's answers.",
          "Make the selected personality obvious in every player answer through cadence, rhythm, metaphor, and word choice.",
          "Let the requested interview intensity control how wild, cocky, funny, or hostile the player's answers become.",
          "Do not let the player's personality bleed into the title or reporter questions.",
          "Do not flatten the answers into generic athlete-speak when a personality type is supplied.",
          "Do not quote copyrighted lyrics or famous lines verbatim.",
          "Treat any example sentence in personalityGuidance as style reference only, not text to copy.",
          "Return structured output only.",
        ].join(" "),
      },
    ],
  };
}

function sanitizePromptPayloadForWriter(
  payload: GameDayRecapPromptPayload,
): GameDayRecapWriterPayload {
  return {
    coverage: payload.coverage,
    request: payload.request,
    games: payload.games.map((game) => {
      if (!isPlayoffRecapGame(game)) {
        return game;
      }

      return {
        ...game,
        teams: {
          away: {
            ...game.teams.away,
            record: null,
            recordEnteringGame: null,
            streak: null,
            streakEnteringGame: null,
          },
          home: {
            ...game.teams.home,
            record: null,
            recordEnteringGame: null,
            streak: null,
            streakEnteringGame: null,
          },
        },
      };
    }),
  };
}

function buildGameDayRecapFactStore(args: {
  games: GameDayRecapGameFactStore[];
  request: GameDayRecapRequestFacts;
}): GameDayRecapFactStore {
  return {
    games: args.games,
    request: args.request,
  };
}

function buildGameDayRecapJudgeFactStore(args: {
  expectedGames: GameDayRecapPromptGame[];
  request: GameDayRecapPromptPayload["request"];
}): GameDayRecapJudgeFactStore {
  return buildGameDayRecapFactStore({
    games: args.expectedGames.map((game) =>
      buildGameDayRecapJudgeGameFactStore(game),
    ),
    request: args.request,
  });
}

function buildGameDayRecapJudgeGameFactStore(
  game: GameDayRecapPromptGame,
): GameDayRecapJudgeGameFactStore {
  const winner = buildGameDayRecapWinnerFacts({
    awayTeam: game.teams.away,
    homeTeam: game.teams.home,
  });
  const periodStates = buildGameDayRecapFactStorePeriodStates({
    awayTeamName: game.teams.away.name,
    homeTeamName: game.teams.home.name,
    quarterScores: game.quarterScores,
  });
  const teams = {
    away: {
      ...game.teams.away,
      rawRatings: null,
    },
    home: {
      ...game.teams.home,
      rawRatings: null,
    },
  };
  const teamRatingFacts =
    game.teamRatingFacts ?? buildTeamRatingFactsForRecap(teams);
  const teamTalent = game.teamTalent ?? buildTeamTalentFactsForRecap(teams);

  return {
    effortDelta: game.effortDelta,
    effortSummary: game.effortSummary,
    evidenceSignals: game.evidenceSignals,
    finalMargin: game.finalMargin,
    gameScoringContext: game.gameScoringContext,
    gameDayPrepSummaries: game.gameDayPrepSummaries,
    isPlayoffGame: isPlayoffRecapGame(game),
    matchId: game.matchId,
    neutral: game.neutral,
    overtime: hasGameOvertimeFromQuarterScores(game.quarterScores),
    periodStates,
    playByPlayFacts: game.playByPlayFacts,
    playByPlaySummaryLines: game.playByPlaySummaryLines,
    playerLeaders: buildGameDayRecapPromptPlayerLeaders(game),
    postgameInterviewCandidate: game.postgameInterviewCandidate ?? null,
    postgameInterviewCandidates: game.postgameInterviewCandidates ?? null,
    quarterFacts: game.quarterFacts,
    quarterScores: game.quarterScores,
    requiredContextSentences: game.requiredContextSentences,
    rotationSummaries: game.rotationSummaries,
    ...(game.seriesContext ? { seriesContext: game.seriesContext } : {}),
    standingsContext: game.standingsContext,
    teamRatingFacts,
    teamTalent,
    teams,
    type: game.type,
    winner,
  };
}

function buildTeamRatingFactsForRecap(args: {
  away: Pick<
    GameDayRecapFactStoreTeam,
    | "name"
    | "offStrategy"
    | "ratingLabels"
    | "ratingTotal"
    | "ratingValues"
    | "rawRatings"
    | "turnovers"
  >;
  home: Pick<
    GameDayRecapFactStoreTeam,
    | "name"
    | "offStrategy"
    | "ratingLabels"
    | "ratingTotal"
    | "ratingValues"
    | "rawRatings"
    | "turnovers"
  >;
}): GameDayRecapTeamRatingFacts {
  const awaySnapshot = buildTeamRatingSnapshotForRecap(args.away);
  const homeSnapshot = buildTeamRatingSnapshotForRecap(args.home);
  const sameCategoryComparisons = TEAM_RATING_KEYS.flatMap((key) =>
    buildSameCategoryRatingComparison({
      awaySnapshot,
      awayTeamName: args.away.name,
      homeSnapshot,
      homeTeamName: args.home.name,
      key,
    }),
  );
  const crossMatchupComparisons = [
    ...buildRatingAttackComparisonsForRecap({
      attacker: args.away,
      attackerSide: "away" as const,
      defender: args.home,
      defenderSide: "home" as const,
    }),
    ...buildRatingAttackComparisonsForRecap({
      attacker: args.home,
      attackerSide: "home" as const,
      defender: args.away,
      defenderSide: "away" as const,
    }),
  ];

  return {
    away: awaySnapshot,
    comparisons: uniqueRatingComparisonFacts([
      ...crossMatchupComparisons,
      ...sameCategoryComparisons,
    ]),
    home: homeSnapshot,
  };
}

function buildTeamTalentFactsForRecap(args: {
  away: Pick<GameDayRecapFactStoreTeam, "name" | "ratingValues" | "rawRatings">;
  home: Pick<GameDayRecapFactStoreTeam, "name" | "ratingValues" | "rawRatings">;
}): GameDayRecapTeamTalentFacts {
  const awayTotal = buildTeamTalentTotalForRecap(args.away);
  const homeTotal = buildTeamTalentTotalForRecap(args.home);
  const differentialFromHomePerspective =
    awayTotal === null || homeTotal === null ? null : homeTotal - awayTotal;
  const leaderSide =
    awayTotal === null || homeTotal === null
      ? null
      : awayTotal === homeTotal
        ? "tie"
        : homeTotal > awayTotal
          ? "home"
          : "away";
  const summary =
    leaderSide === null
      ? null
      : leaderSide === "tie"
        ? `${args.home.name} and ${args.away.name} looked evenly matched on team talent.`
        : `${leaderSide === "home" ? args.home.name : args.away.name} seemed to have the team talent edge.`;

  return {
    awayTotal,
    differentialFromHomePerspective,
    homeTotal,
    leaderSide,
    summary,
  };
}

function buildTeamRatingSnapshotForRecap(
  team: Pick<
    GameDayRecapFactStoreTeam,
    "ratingLabels" | "ratingTotal" | "ratingValues" | "rawRatings" | "turnovers"
  >,
): GameDayRecapTeamRatingSnapshot {
  const values = resolveTeamRatingValuesForRecap(team);
  const ratings = Object.fromEntries(
    TEAM_RATING_KEYS.flatMap((key) => {
      const value = values[key];
      if (!isFiniteRatingValue(value)) {
        return [];
      }
      return [
        [
          key,
          {
            key,
            label: formatRatingLabelForFact(team.ratingLabels, key, value),
            value,
          },
        ],
      ];
    }),
  ) as Partial<Record<TeamRatingKey, GameDayRecapRatingFactValue>>;

  return {
    ratingLabels: team.ratingLabels,
    ratingTotal: team.ratingTotal,
    ratings,
    teamTalentTotal: buildTeamTalentTotalForRecap(team),
    turnovers: team.turnovers,
  };
}

function buildSameCategoryRatingComparison(args: {
  awaySnapshot: GameDayRecapTeamRatingSnapshot;
  awayTeamName: string;
  homeSnapshot: GameDayRecapTeamRatingSnapshot;
  homeTeamName: string;
  key: TeamRatingKey;
}): GameDayRecapRatingComparisonFact[] {
  const awayRating = args.awaySnapshot.ratings[args.key];
  const homeRating = args.homeSnapshot.ratings[args.key];
  if (!awayRating || !homeRating || awayRating.value === homeRating.value) {
    return [];
  }

  const awayIsStronger = awayRating.value > homeRating.value;
  const leftRating = awayIsStronger ? awayRating : homeRating;
  const rightRating = awayIsStronger ? homeRating : awayRating;
  const leftTeamName = awayIsStronger ? args.awayTeamName : args.homeTeamName;
  const rightTeamName = awayIsStronger ? args.homeTeamName : args.awayTeamName;
  const leftTeamSide = awayIsStronger ? "away" : "home";
  const rightTeamSide = awayIsStronger ? "home" : "away";
  const label = FACT_LIBRARY_RATING_LABELS[args.key] ?? args.key;
  const differential = roundToOneDecimal(leftRating.value - rightRating.value);

  return [
    {
      differential,
      left: {
        label: leftRating.label,
        ratingKey: args.key,
        teamName: leftTeamName,
        teamSide: leftTeamSide,
        value: leftRating.value,
      },
      relevance: args.key === "rebounding" ? "rebounding" : "same_category",
      right: {
        label: rightRating.label,
        ratingKey: args.key,
        teamName: rightTeamName,
        teamSide: rightTeamSide,
        value: rightRating.value,
      },
      summary: `${leftTeamName} held the stronger ${label} rating (${leftRating.label} vs ${rightRating.label}).`,
    },
  ];
}

function buildRatingAttackComparisonsForRecap(args: {
  attacker: Pick<
    GameDayRecapFactStoreTeam,
    "name" | "offStrategy" | "ratingLabels" | "ratingValues" | "rawRatings"
  >;
  attackerSide: "away" | "home";
  defender: Pick<
    GameDayRecapFactStoreTeam,
    "name" | "ratingLabels" | "ratingValues" | "rawRatings"
  >;
  defenderSide: "away" | "home";
}): GameDayRecapRatingComparisonFact[] {
  return resolveRatingAttackContexts(args.attacker.offStrategy).flatMap(
    (context) => {
      const attackValue = resolveTeamRatingValueForRecap(
        args.attacker,
        context.scoringKey,
      );
      const defenseValue = resolveTeamRatingValueForRecap(
        args.defender,
        context.defenseKey,
      );
      if (
        !isFiniteRatingValue(attackValue) ||
        !isFiniteRatingValue(defenseValue)
      ) {
        return [];
      }

      const attackLabel = formatRatingLabelForFact(
        args.attacker.ratingLabels,
        context.scoringKey,
        attackValue,
      );
      const defenseLabel = formatRatingLabelForFact(
        args.defender.ratingLabels,
        context.defenseKey,
        defenseValue,
      );
      const defenseIsStronger = defenseValue >= attackValue;
      const differential = roundToOneDecimal(
        Math.abs(defenseValue - attackValue),
      );
      return [
        {
          differential,
          left: defenseIsStronger
            ? {
                label: defenseLabel,
                ratingKey: context.defenseKey,
                teamName: args.defender.name,
                teamSide: args.defenderSide,
                value: defenseValue,
              }
            : {
                label: attackLabel,
                ratingKey: context.scoringKey,
                teamName: args.attacker.name,
                teamSide: args.attackerSide,
                value: attackValue,
              },
          relevance:
            context.scoringKey === "outsideScoring"
              ? defenseIsStronger
                ? "outside_defense"
                : "outside_attack"
              : defenseIsStronger
                ? "inside_defense"
                : "inside_attack",
          right: defenseIsStronger
            ? {
                label: attackLabel,
                ratingKey: context.scoringKey,
                teamName: args.attacker.name,
                teamSide: args.attackerSide,
                value: attackValue,
              }
            : {
                label: defenseLabel,
                ratingKey: context.defenseKey,
                teamName: args.defender.name,
                teamSide: args.defenderSide,
                value: defenseValue,
              },
          summary: defenseIsStronger
            ? `${args.defender.name} had ${defenseLabel} ${context.defenseLabel} against ${attackLabel} ${context.attackLabel} from ${args.attacker.name}.`
            : `${args.attacker.name} brought ${attackLabel} ${context.attackLabel} against ${defenseLabel} ${context.defenseLabel} from ${args.defender.name}.`,
        },
      ];
    },
  );
}

function uniqueRatingComparisonFacts(
  comparisons: GameDayRecapRatingComparisonFact[],
): GameDayRecapRatingComparisonFact[] {
  const seen = new Set<string>();
  return comparisons.filter((comparison) => {
    const key = [
      comparison.left.teamSide,
      comparison.left.ratingKey,
      comparison.right.teamSide,
      comparison.right.ratingKey,
      comparison.relevance,
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildTeamTalentTotalForRecap(
  team: Pick<GameDayRecapFactStoreTeam, "ratingValues" | "rawRatings">,
): number | null {
  let hasRating = false;
  const total = TEAM_RATING_KEYS.reduce((sum, key) => {
    const value = resolveTeamRatingValueForRecap(team, key);
    if (!isFiniteRatingValue(value)) {
      return sum;
    }
    hasRating = true;
    return sum + Math.round(value * 3);
  }, 0);

  return hasRating ? total : null;
}

function resolveTeamRatingValuesForRecap(
  team: Pick<GameDayRecapFactStoreTeam, "ratingValues" | "rawRatings">,
): Partial<Record<TeamRatingKey, number>> {
  return Object.fromEntries(
    TEAM_RATING_KEYS.flatMap((key) => {
      const value = resolveTeamRatingValueForRecap(team, key);
      return isFiniteRatingValue(value)
        ? [[key, roundToOneDecimal(value)]]
        : [];
    }),
  ) as Partial<Record<TeamRatingKey, number>>;
}

function resolveTeamRatingValueForRecap(
  team: Pick<GameDayRecapFactStoreTeam, "ratingValues" | "rawRatings">,
  key: TeamRatingKey,
): number | null {
  const rawValue = team.rawRatings?.[key] ?? team.ratingValues?.[key];
  return isFiniteRatingValue(rawValue) ? roundToOneDecimal(rawValue) : null;
}

function buildGameDayRecapPromptPlayerLeaders(
  game: GameDayRecapPromptGame,
): GameDayRecapGameFactStore["playerLeaders"] {
  const candidates = (["away", "home"] as const).flatMap((teamSide) =>
    game.teams[teamSide].topPlayers.map((player) => ({
      playerName: player.name,
      statLine: {
        assists: player.assists,
        blocks: player.blocks,
        minutes: player.minutes,
        points: player.points,
        rebounds: player.rebounds,
        steals: player.steals,
        turnovers: player.turnovers,
      },
      teamName: game.teams[teamSide].name,
      teamSide,
    })),
  );

  const buildLeader = (
    valueFor: (
      entry: Omit<GameDayRecapFactStorePlayerLeader, "value">,
    ) => number,
  ): GameDayRecapFactStorePlayerLeader | null => {
    return (
      candidates
        .map((candidate) => ({
          ...candidate,
          value: valueFor(candidate),
        }))
        .filter((candidate) => candidate.value > 0)
        .sort(
          (left, right) =>
            right.value - left.value ||
            compareFactStorePlayerLeaderEntries(left, right),
        )[0] ?? null
    );
  };

  return {
    assists: buildLeader((entry) => entry.statLine.assists),
    bestAllAround: buildLeader((entry) =>
      scoreInterviewStatLine(entry.statLine),
    ),
    points: buildLeader((entry) => entry.statLine.points),
    rebounds: buildLeader((entry) => entry.statLine.rebounds),
  };
}

function collectPostgameInterviewJudgeSentences(
  interview:
    | {
        qa: Array<{
          answer: string;
          question: string;
        }>;
        title: string;
      }
    | null
    | undefined,
): Array<{ sentence: string; sentenceIndex: number }> {
  if (!interview) {
    return [];
  }

  const sentences: Array<{ sentence: string; sentenceIndex: number }> = [
    {
      sentence: interview.title,
      sentenceIndex: 0,
    },
  ];
  let sentenceIndex = 1;
  for (const exchange of interview.qa) {
    sentences.push({
      sentence: exchange.question,
      sentenceIndex,
    });
    sentenceIndex += 1;
    sentences.push({
      sentence: exchange.answer,
      sentenceIndex,
    });
    sentenceIndex += 1;
  }

  return sentences;
}

function buildGameDayRecapJudgeGameFactPacket(
  game: GameDayRecapJudgeGameFactStore,
): GameDayRecapJudgeGameFactPacket {
  return {
    evidenceSignals: game.evidenceSignals,
    effortDelta: game.effortDelta,
    effortSummary: game.effortSummary,
    finalMargin: game.finalMargin,
    gameScoringContext: game.gameScoringContext,
    gameDayPrepSummaries: game.gameDayPrepSummaries,
    isPlayoffGame: game.isPlayoffGame,
    matchId: game.matchId,
    overtime: game.overtime,
    periodStates: game.periodStates,
    playByPlayFacts: game.playByPlayFacts,
    playerLeaders: game.playerLeaders,
    postgameInterviewCandidate: game.postgameInterviewCandidate ?? null,
    postgameInterviewCandidates: game.postgameInterviewCandidates ?? null,
    quarterFacts: game.quarterFacts,
    quarterScores: game.quarterScores,
    requiredContextSentences: game.requiredContextSentences,
    rotationSummaries: game.rotationSummaries,
    seriesContext: game.seriesContext ?? null,
    standingsContext: game.standingsContext,
    teamRatingFacts: game.teamRatingFacts,
    teamTalent: game.teamTalent,
    teams: {
      away: {
        name: game.teams.away.name,
        ratingLabels: game.teams.away.ratingLabels,
        ratingTotal: game.teams.away.ratingTotal,
        ratingValues: game.teams.away.ratingValues,
        score: game.teams.away.score,
        topPlayers: game.teams.away.topPlayers,
        turnovers: game.teams.away.turnovers,
      },
      home: {
        name: game.teams.home.name,
        ratingLabels: game.teams.home.ratingLabels,
        ratingTotal: game.teams.home.ratingTotal,
        ratingValues: game.teams.home.ratingValues,
        score: game.teams.home.score,
        topPlayers: game.teams.home.topPlayers,
        turnovers: game.teams.home.turnovers,
      },
    },
    winner: game.winner,
  };
}

function buildGameDayRecapJudgeSentenceFactualityResultSchema(args: {
  activeSlotIds: readonly GameDayRecapJudgeSlotId[];
}) {
  const slotVerdictProperties = Object.fromEntries(
    GAME_DAY_RECAP_JUDGE_SLOT_IDS.map((slotId) => [
      slotId,
      GAME_DAY_RECAP_JUDGE_SENTENCE_VERDICT_SCHEMA,
    ]),
  );

  return {
    additionalProperties: false,
    properties: {
      slotVerdicts: {
        additionalProperties: false,
        properties: slotVerdictProperties,
        required: [...args.activeSlotIds],
        type: "object",
      },
    },
    required: ["slotVerdicts"],
    type: "object",
  };
}

function buildGameDayRecapJudgeInterestingnessResultSchema() {
  return {
    additionalProperties: false,
    properties: {
      candidateIndex: {
        type: "integer",
      },
      interestingnessScore: {
        type: "number",
      },
    },
    required: ["candidateIndex", "interestingnessScore"],
    type: "object",
  };
}

function buildGameDayRecapJudgeBedrockRequest(args: {
  modelId: string;
  payload: GameDayRecapJudgeRequestPayload;
}) {
  if (args.payload.judgeKind === "sentence_factuality") {
    const schema = toBedrockStructuredOutputSchema(
      buildGameDayRecapJudgeSentenceFactualityResultSchema({
        activeSlotIds: args.payload.sentenceChunk.map((entry) => entry.slotId),
      }),
    );

    return {
      inferenceConfig: {
        maxTokens: 2000,
        temperature: 0,
      },
      messages: [
        {
          content: [
            {
              text: JSON.stringify(
                {
                  instructions: {
                    goals: [
                      "Review each supplied sentence slot only against the supplied gameFacts.",
                      "Return exactly one structured verdict for every active slot in sentenceChunk.",
                      "Mark each sentence as supported, unsupported, uncertain, or style_only.",
                      "Use unsupported when the sentence conflicts with or overreaches the supplied gameFacts.",
                      "Use uncertain when the sentence appears factual but the supplied gameFacts do not fully support it.",
                      "Use style_only when the sentence contains no checkable factual claim.",
                      "Winner truth comes only from gameFacts.winner.",
                      "Use gameFacts.periodStates, quarterFacts, quarterScores, and overtime as the source of truth for period-state and overtime claims.",
                      "Use gameFacts.playByPlayFacts as the source of truth for ending, run, comeback, and lead-change claims.",
                      "Use gameFacts.playerLeaders, teams[].topPlayers, and postgameInterviewCandidates as the source of truth for player-attribution claims.",
                      "Treat game-high as supported only when the named player is the global leader in gameFacts.playerLeaders for that stat. Team-high or led [team] may be supported by teams[].topPlayers.",
                      "Use gameFacts.teamRatingFacts and gameFacts.teamTalent as the source of truth for team-rating, matchup-edge, turnover-flow, and team-talent claims.",
                      "Treat natural equivalents as the same rating family when gameFacts supports them, such as perimeter defense for outsideDefense and team talent for the internal total.",
                      "Reject rating or team-talent claims when no matching gameFacts.teamRatingFacts or gameFacts.teamTalent support exists.",
                      "Set containsOutcomeClaim to true only for sentences that make a winner, final-score, overtime, or quarter-outcome claim.",
                      "Use contradictionType winner, final_score, overtime, quarter_outcome, series_state, run, lead_change, ending, record, other, or none as appropriate.",
                      "Judge postgameInterview title, questions, and answers sentence by sentence against the supplied matching interview candidate for that side and its supported facts.",
                      "If the opening writeup sentence is the exact series summary line, a decisive ending in the second writeup sentence still counts as foregrounded rather than buried.",
                    ],
                    restrictions: [
                      "Use no world knowledge.",
                      "Do not rewrite any sentence.",
                      "Do not compare this chunk to any other chunk.",
                      "Only cite sourceField values that point back to the supplied gameFacts.",
                    ],
                  },
                  candidateIndex: args.payload.candidateIndex,
                  chunkCount: args.payload.chunkCount,
                  chunkIndex: args.payload.chunkIndex,
                  gameFacts: args.payload.gameFacts,
                  request: args.payload.request,
                  sentenceChunk: args.payload.sentenceChunk,
                },
                null,
                2,
              ),
            },
          ],
          role: "user" as const,
        },
      ],
      modelId: args.modelId,
      outputConfig: {
        textFormat: {
          structure: {
            jsonSchema: {
              description:
                "Grounded sentence-level factuality review for one basketball recap chunk.",
              name: "game_day_recap_sentence_judge",
              schema: JSON.stringify(schema),
            },
          },
          type: "json_schema" as const,
        },
      },
      system: [
        {
          text: [
            "You are a grounded factuality judge for basketball recap sentences.",
            "Use only the supplied gameFacts.",
            "Use gameFacts.teamRatingFacts and gameFacts.teamTalent for rating-edge and team-talent claims.",
            "Do not require exact wording for rating labels when the supplied facts support a natural equivalent.",
            "Do not use world knowledge or outside basketball conventions.",
            "Do not rewrite or improve the prose.",
            "Judge each sentence independently against the gameFacts.",
            "Return structured verdicts only.",
          ].join(" "),
        },
      ],
    };
  }

  const schema = toBedrockStructuredOutputSchema(
    buildGameDayRecapJudgeInterestingnessResultSchema(),
  );
  return {
    inferenceConfig: {
      maxTokens: 1000,
      temperature: 0,
    },
    messages: [
      {
        content: [
          {
            text: JSON.stringify(
              {
                instructions: {
                  goals: [
                    "Score the candidate on grounded vividness and specificity after factuality has already been checked.",
                    "Reward candidates that foreground supplied ending facts instead of generic summary language.",
                    "Reward candidates that use supplied run timing, lead-change counts, and comeback facts precisely instead of vague momentum filler.",
                    "Reward smoother connected prose over stacked note-like sentences when factuality is otherwise equal.",
                  ],
                  restrictions: [
                    "Use only the supplied result and gameFacts.",
                    "Do not judge sentence-level factual correctness here.",
                    "Do not compare against any other candidate.",
                    "Return structured output only.",
                  ],
                },
                candidateIndex: args.payload.candidateIndex,
                gameFacts: args.payload.games,
                request: args.payload.request,
                result: args.payload.result,
              },
              null,
              2,
            ),
          },
        ],
        role: "user" as const,
      },
    ],
    modelId: args.modelId,
    outputConfig: {
      textFormat: {
        structure: {
          jsonSchema: {
            description:
              "Grounded candidate-level interestingness score for one basketball recap candidate.",
            name: "game_day_recap_candidate_interestingness",
            schema: JSON.stringify(schema),
          },
        },
        type: "json_schema" as const,
      },
    },
    system: [
      {
        text: [
          "You are a grounded style judge for basketball recap candidates.",
          "Use only the supplied result and gameFacts.",
          "Do not rewrite the prose.",
          "Return structured output only.",
        ].join(" "),
      },
    ],
  };
}

function countBedrockSchemaUnionParameters(schema: unknown): number {
  if (Array.isArray(schema)) {
    return schema.reduce(
      (total, entry) => total + countBedrockSchemaUnionParameters(entry),
      0,
    );
  }

  if (!schema || typeof schema !== "object") {
    return 0;
  }

  const record = schema as Record<string, unknown>;
  const localUnionCount =
    (Array.isArray(record.type) ? 1 : 0) + ("anyOf" in record ? 1 : 0);
  return (
    localUnionCount +
    Object.values(record).reduce<number>(
      (total, value) => total + countBedrockSchemaUnionParameters(value),
      0,
    )
  );
}

function computeJudgeSchemaBudget(args: {
  schema: unknown;
  sentenceVerdictCount: number;
}): GameDayRecapJudgeSchemaBudget {
  const serializedSchema = JSON.stringify(args.schema);
  return {
    serializedSchemaBytes: Buffer.byteLength(serializedSchema, "utf8"),
    sentenceVerdictCount: args.sentenceVerdictCount,
    unionParameterCount: countBedrockSchemaUnionParameters(args.schema),
  };
}

function logJudgeSchemaBudget(args: {
  budget: GameDayRecapJudgeSchemaBudget;
  candidateIndex: number;
  chunkCount: number | null;
  chunkIndex: number | null;
  chunkSentenceCount: number;
  fallbackMode: GameDayRecapJudgeFallbackMode | null;
  judgeKind: GameDayRecapJudgeRequestPayload["judgeKind"];
  matchId: string | null;
  stage:
    | "premium-candidate-selection"
    | "retry"
    | "style-polish"
    | "postgame-interview"
    | "salvage-post-patch"
    | "salvage-post-trim"
    | "writer";
  targetKey?: string;
  userId?: string;
}): void {
  logGameDayRecapWarn("process.judge_schema_budget", {
    candidateIndex: args.candidateIndex,
    chunkCount: args.chunkCount,
    chunkIndex: args.chunkIndex,
    chunkSentenceCount: args.chunkSentenceCount,
    fallbackMode: args.fallbackMode ?? "none",
    judgeKind: args.judgeKind,
    matchId: args.matchId,
    sentenceVerdictCount: args.budget.sentenceVerdictCount,
    serializedSchemaBytes: args.budget.serializedSchemaBytes,
    stage: args.stage,
    targetKey: args.targetKey ?? null,
    unionParameterCount: args.budget.unionParameterCount,
    userId: args.userId ?? null,
  });
}

function isBedrockJudgeSchemaValidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const name = asOptionalString(record.name)?.trim();
  const message = asOptionalString(record.message)?.trim();
  if (name !== "ValidationException" || !message) {
    return false;
  }

  return /output_config\.format\.schema|json[_ -]?schema|schema(?:s)? contains too many parameters with union types|maxItems|minItems|minimum|maximum|minLength|maxLength|union types|compiled grammar is too large|grammar is too large|reduce the number of strict tools/i.test(
    message,
  );
}

function assertSupportedBedrockRecapModelId(
  modelId: string,
  envName = GAME_DAY_RECAP_MODEL_ENV_NAME,
): void {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) {
    throw new Error(`${envName} must not be empty.`);
  }

  const supported = SUPPORTED_STRUCTURED_OUTPUT_MODEL_PATTERNS.some((pattern) =>
    pattern.test(normalizedModelId),
  );
  if (!supported) {
    throw new Error(
      `Model ${normalizedModelId} is not in the verified structured-output allowlist for game day recaps.`,
    );
  }
}

export function assertSupportedBedrockRecapModel(
  modelId: string,
  region: string | undefined,
): void {
  assertSupportedBedrockRecapModelId(modelId);

  const normalizedRegion = region?.trim();
  if (
    !normalizedRegion ||
    !SUPPORTED_COMMERCIAL_REGION_PATTERN.test(normalizedRegion)
  ) {
    throw new Error(
      `Game day recap structured output currently requires a supported commercial Bedrock region. Received ${normalizedRegion ?? "unknown"}.`,
    );
  }
}

async function buildGameDayRecapPromptPayload(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore" | "getSchedule" | "getTeamInfo">;
  connection: BbConnectionRecord;
  contextConcurrency?: number;
  enforceCompletedSlateCoverage?: boolean;
  fetchPublicMatchPlayByPlay?: PublicPlayByPlayFetcher;
  now: Date;
  requestedGames: SlateGame[];
  request: GameDayRecapPromptPayload["request"];
  season: number;
  standings: BBApiStandings;
  targetKey: string;
  userId: string;
}): Promise<GameDayRecapPromptPayload> {
  const includeRecapContextMatch = isRegularSeasonLeagueContextMatch;
  const standingsIndex = extractStandingTeams(args.standings);
  const schedules = await Promise.all(
    Array.from(standingsIndex.keys()).map(
      async (teamId) =>
        [teamId, await args.bb.getSchedule(teamId, args.season)] as const,
    ),
  );
  const scheduleByTeamId = new Map<string, BBApiSchedule>(schedules);
  const boxScoreCache = new Map<string, Promise<BoxScoreLoadResult>>();
  const playByPlayCache = new Map<
    string,
    Promise<GameDayRecapPlayByPlayLoadResult>
  >();
  const coverageIssues: CoverageIssue[] = [];
  const finalCoverageBlockers: CoverageIssue[] = [];
  const factStoreGames: GameDayRecapFactStore["games"] = [];
  const contextConcurrency =
    args.contextConcurrency ??
    DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG.contextConcurrency;
  const gameContextResults = await withGameDayRecapStageTiming(
    "context_games",
    {
      concurrency: contextConcurrency,
      gameCount: args.requestedGames.length,
      requestKind: args.request.kind,
      targetKey: args.targetKey,
      userId: args.userId,
    },
    () =>
      mapWithBoundedConcurrency(
        args.requestedGames,
        contextConcurrency,
        async (requestedGame) => {
          const boxScoreResult = await loadBoxScore(
            args.bb,
            boxScoreCache,
            requestedGame.matchId,
          );
          const expectedFinal = isRequestedGameExpectedFinal({
            now: args.now,
            request: args.request,
            requestedGame,
          });
          if (boxScoreResult.kind !== "ok") {
            if (boxScoreResult.kind === "api_fetch_failed") {
              logGameDayRecapWarn("process.box_score_fetch_failed", {
                expectedFinal,
                matchId: requestedGame.matchId,
                scheduledAwayScore: requestedGame.scheduledAwayScore,
                scheduledHomeScore: requestedGame.scheduledHomeScore,
                scheduleFinal: requestedGame.isScheduleFinal,
                targetKey: args.targetKey,
                userId: args.userId,
                ...boxScoreResult.error,
              });
            } else if (boxScoreResult.kind === "parse_failed") {
              logGameDayRecapWarn("process.box_score_parse_failed", {
                expectedFinal,
                matchId: requestedGame.matchId,
                scheduledAwayScore: requestedGame.scheduledAwayScore,
                scheduledHomeScore: requestedGame.scheduledHomeScore,
                scheduleFinal: requestedGame.isScheduleFinal,
                targetKey: args.targetKey,
                userId: args.userId,
                ...boxScoreResult.error,
              });
            } else {
              logGameDayRecapWarn("process.box_score_incomplete", {
                awayScore: boxScoreResult.boxScore.awayTeam.score,
                expectedFinal,
                homeScore: boxScoreResult.boxScore.homeTeam.score,
                matchId: requestedGame.matchId,
                scheduledAwayScore: requestedGame.scheduledAwayScore,
                scheduledHomeScore: requestedGame.scheduledHomeScore,
                scheduleFinal: requestedGame.isScheduleFinal,
                targetKey: args.targetKey,
                userId: args.userId,
              });
            }

            const issue: CoverageIssue = {
              awayTeamName: requestedGame.awayTeamName,
              homeTeamName: requestedGame.homeTeamName,
              matchId: requestedGame.matchId,
              reason:
                boxScoreResult.kind === "incomplete_boxscore"
                  ? "final box score was incomplete"
                  : boxScoreResult.kind === "parse_failed"
                    ? "final box score response could not be parsed"
                    : "final box score was unavailable",
            };
            return {
              coverageIssue: issue,
              finalCoverageBlocker: expectedFinal ? issue : null,
              factStoreGame: null,
            };
          }
          const boxScore = boxScoreResult.boxScore;

          const homeSchedule = scheduleByTeamId.get(requestedGame.homeTeamId);
          const awaySchedule = scheduleByTeamId.get(requestedGame.awayTeamId);
          const homeStanding = standingsIndex.get(requestedGame.homeTeamId);
          const awayStanding = standingsIndex.get(requestedGame.awayTeamId);
          if (
            !homeSchedule ||
            !awaySchedule ||
            !homeStanding ||
            !awayStanding
          ) {
            return {
              coverageIssue: {
                awayTeamName: requestedGame.awayTeamName,
                homeTeamName: requestedGame.homeTeamName,
                matchId: requestedGame.matchId,
                reason:
                  "team context could not be resolved from standings or schedules",
              },
              finalCoverageBlocker: null,
              factStoreGame: null,
            };
          }

          const [homeRecentBoxScores, awayRecentBoxScores, playByPlayResult] =
            await Promise.all([
              loadRecentCompletedBoxScores({
                bb: args.bb,
                boxScoreCache,
                gameStartTime: requestedGame.startTime,
                includeMatch: includeRecapContextMatch,
                limit: 3,
                schedule: homeSchedule,
              }),
              loadRecentCompletedBoxScores({
                bb: args.bb,
                boxScoreCache,
                gameStartTime: requestedGame.startTime,
                includeMatch: includeRecapContextMatch,
                limit: 3,
                schedule: awaySchedule,
              }),
              args.fetchPublicMatchPlayByPlay
                ? loadPromptGamePlayByPlay({
                    awayTeamName: requestedGame.awayTeamName,
                    cache: playByPlayCache,
                    fetchPublicMatchPlayByPlay: args.fetchPublicMatchPlayByPlay,
                    homeTeamName: requestedGame.homeTeamName,
                    matchId: requestedGame.matchId,
                  })
                : Promise.resolve<GameDayRecapPlayByPlayLoadResult>({
                    debug: null,
                    error: null,
                    facts: null,
                  }),
            ]);

          if (playByPlayResult.error) {
            logGameDayRecapWarn(
              playByPlayResult.error.kind === "parse_failed"
                ? "process.play_by_play_parse_failed"
                : "process.play_by_play_fetch_failed",
              {
                matchId: requestedGame.matchId,
                targetKey: args.targetKey,
                userId: args.userId,
                ...playByPlayResult.error.details,
              },
            );
          }
          logPlayByPlayEndingFactsDebug({
            matchId: requestedGame.matchId,
            playByPlayResult,
            targetKey: args.targetKey,
            userId: args.userId,
          });

          const homeContext = buildTeamSeasonContext({
            boxScores: homeRecentBoxScores,
            gameStartTime: requestedGame.startTime,
            includeMatch: includeRecapContextMatch,
            schedule: homeSchedule,
            standing: homeStanding,
          });
          const awayContext = buildTeamSeasonContext({
            boxScores: awayRecentBoxScores,
            gameStartTime: requestedGame.startTime,
            includeMatch: includeRecapContextMatch,
            schedule: awaySchedule,
            standing: awayStanding,
          });
          const homePostgameContext = derivePostgameTeamSeasonContext({
            boxScore,
            enteringGameContext: homeContext,
            priorBoxScores: homeRecentBoxScores,
          });
          const awayPostgameContext = derivePostgameTeamSeasonContext({
            boxScore,
            enteringGameContext: awayContext,
            priorBoxScores: awayRecentBoxScores,
          });
          const seriesContext =
            args.request.kind === "LEAGUE_DATE"
              ? resolvePlayoffSeriesContext({
                  awaySchedule,
                  boxScore,
                  homeSchedule,
                  requestedGame,
                  standings: args.standings,
                })
              : null;

          return {
            coverageIssue: null,
            finalCoverageBlocker: null,
            factStoreGame: buildGameDayRecapGameFactStore({
              awayEnteringGameContext: awayContext,
              awayPostgameContext,
              boxScore,
              hasHistoricalContext: true,
              homeEnteringGameContext: homeContext,
              homePostgameContext,
              playByPlayFacts: playByPlayResult.facts,
              requestedGame,
              seriesContext,
            }),
          };
        },
      ),
  );

  for (const result of gameContextResults) {
    if (result.coverageIssue) {
      coverageIssues.push(result.coverageIssue);
    }
    if (result.finalCoverageBlocker) {
      finalCoverageBlockers.push(result.finalCoverageBlocker);
    }
    if (result.factStoreGame) {
      factStoreGames.push(result.factStoreGame);
    }
  }

  const leagueName =
    args.standings.league?.name ??
    (args.connection.leagueId === args.request.leagueId
      ? args.connection.leagueName
      : null) ??
    null;
  const coverage: GameDayRecapCoveragePayload = {
    availableGames: factStoreGames.length,
    missingGames: coverageIssues,
    partial: coverageIssues.length > 0,
    requestedGames: args.requestedGames.length,
  };
  if (
    args.enforceCompletedSlateCoverage &&
    finalCoverageBlockers.length > 0 &&
    isCoverageStrictForRequest(args.request)
  ) {
    logGameDayRecapWarn("process.completed_slate_coverage_blocked", {
      blockedGames: finalCoverageBlockers,
      coverage,
      requestKind: args.request.kind,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    throw new RetryableCompletedSlateCoverageError(coverage);
  }

  const factStore: GameDayRecapFactStore = {
    games: factStoreGames,
    request: {
      ...args.request,
      leagueName,
      season: args.season,
    },
  };

  return buildGameDayRecapWriterPayloadFromFactStore({
    coverage,
    factStore,
  });
}

async function buildSingleGameSummaryPromptPayload(args: {
  bb: Pick<
    BBXmlApiClient,
    "getBoxScore" | "getSchedule" | "getSeasons" | "getStandings"
  >;
  boxScore: BBApiBoxScore;
  connection: BbConnectionRecord;
  fetchPublicMatchPlayByPlay?: PublicPlayByPlayFetcher;
  generationApproach: RecapGenerationApproachValue;
  interviewIntensity: RecapInterviewIntensityValue;
  loserInterviewPersonalityType?: InterviewPersonalityType | null;
  matchId: string;
  winnerInterviewPersonalityType?: InterviewPersonalityType | null;
}): Promise<GameDayRecapPromptPayload> {
  const requestedGame = toSlateGameFromBoxScore(args.boxScore);
  const playoffSeriesResolution = await resolveSingleGamePlayoffSeriesContext({
    bb: args.bb,
    boxScore: args.boxScore,
    connection: args.connection,
    requestedGame,
  });
  const timeZone = resolveLeagueTimeZone(
    args.connection,
    playoffSeriesResolution.standings,
  );
  const gameDate = resolveCalendarDateKey(args.boxScore.startTime, timeZone);
  const homeEnteringGameContext = buildNeutralTeamSeasonContext(
    args.boxScore.homeTeam,
  );
  const awayEnteringGameContext = buildNeutralTeamSeasonContext(
    args.boxScore.awayTeam,
  );
  const playByPlayResult = args.fetchPublicMatchPlayByPlay
    ? await loadGameDayRecapPlayByPlayFacts({
        awayTeamName: requestedGame.awayTeamName,
        fetchPublicMatchPlayByPlay: args.fetchPublicMatchPlayByPlay,
        homeTeamName: requestedGame.homeTeamName,
        matchId: args.matchId,
      })
    : {
        debug: null,
        error: null,
        facts: null,
      };

  if (playByPlayResult.error) {
    logGameDayRecapWarn(
      playByPlayResult.error.kind === "parse_failed"
        ? "process.play_by_play_parse_failed"
        : "process.play_by_play_fetch_failed",
      {
        matchId: args.matchId,
        ...playByPlayResult.error.details,
      },
    );
  }
  logPlayByPlayEndingFactsDebug({
    matchId: args.matchId,
    playByPlayResult,
  });

  const factStore: GameDayRecapFactStore = {
    games: [
      buildGameDayRecapGameFactStore({
        awayEnteringGameContext,
        awayPostgameContext: awayEnteringGameContext,
        boxScore: args.boxScore,
        hasHistoricalContext: false,
        homeEnteringGameContext,
        homePostgameContext: homeEnteringGameContext,
        playByPlayFacts: playByPlayResult.facts,
        requestedGame,
        seriesContext: playoffSeriesResolution.seriesContext,
      }),
    ],
    request: {
      gameDate,
      gameDayNumber: null,
      generationApproach: args.generationApproach,
      interviewIntensity: args.interviewIntensity,
      kind: "SINGLE_GAME",
      label: `Match ${args.matchId}`,
      leagueId: args.connection.leagueId ?? null,
      leagueName: args.connection.leagueName ?? null,
      ...(args.loserInterviewPersonalityType
        ? {
            loserInterviewPersonalityType:
              args.loserInterviewPersonalityType,
          }
        : {}),
      matchId: args.matchId,
      season: playoffSeriesResolution.season,
      timeZone,
      ...(args.winnerInterviewPersonalityType
        ? {
            winnerInterviewPersonalityType:
              args.winnerInterviewPersonalityType,
          }
        : {}),
    },
  };

  return buildGameDayRecapWriterPayloadFromFactStore({
    coverage: {
      availableGames: 1,
      missingGames: [],
      partial: false,
      requestedGames: 1,
    },
    factStore,
  });
}

async function resolveSingleGamePlayoffSeriesContext(args: {
  bb: Pick<BBXmlApiClient, "getSchedule" | "getSeasons" | "getStandings">;
  boxScore: BBApiBoxScore;
  connection: BbConnectionRecord;
  requestedGame: SlateGame;
}): Promise<{
  season: number | null;
  seriesContext: GameDayRecapSeriesContext | null;
  standings: BBApiStandings | null;
}> {
  if (!resolveBestOfThreePlayoffStageKey(args.boxScore.type)) {
    return {
      season: null,
      seriesContext: null,
      standings: null,
    };
  }

  const leagueId = args.connection.leagueId?.trim();
  const gameDate = resolveDateKey(args.boxScore.startTime);
  if (!leagueId || !gameDate) {
    return {
      season: null,
      seriesContext: null,
      standings: null,
    };
  }

  try {
    const season = resolveSeasonForDate(await args.bb.getSeasons(), gameDate);
    const standings = await args.bb.getStandings(leagueId, season);
    const bracketSeriesContext = resolvePlayoffSeriesContext({
      boxScore: args.boxScore,
      requestedGame: args.requestedGame,
      standings,
    });
    if (bracketSeriesContext) {
      return {
        season,
        seriesContext: bracketSeriesContext,
        standings,
      };
    }

    const homeTeamId = args.boxScore.homeTeam.id?.trim();
    const awayTeamId = args.boxScore.awayTeam.id?.trim();
    if (!homeTeamId || !awayTeamId) {
      return {
        season,
        seriesContext: null,
        standings,
      };
    }

    const [homeSchedule, awaySchedule] = await Promise.all([
      args.bb.getSchedule(homeTeamId, season),
      args.bb.getSchedule(awayTeamId, season),
    ]);

    return {
      season,
      seriesContext: resolvePlayoffSeriesContext({
        awaySchedule,
        boxScore: args.boxScore,
        homeSchedule,
        requestedGame: args.requestedGame,
        standings,
      }),
      standings,
    };
  } catch (error) {
    logGameDayRecapWarn("process.single_game_series_context_failed", {
      leagueId,
      matchId: args.requestedGame.matchId,
      ...toLoggableError(error),
    });
    return {
      season: null,
      seriesContext: null,
      standings: null,
    };
  }
}

function buildGameDayRecapGameFactStore(args: {
  awayEnteringGameContext: TeamSeasonContext;
  awayPostgameContext: TeamSeasonContext;
  boxScore: BBApiBoxScore;
  hasHistoricalContext: boolean;
  homeEnteringGameContext: TeamSeasonContext;
  homePostgameContext: TeamSeasonContext;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  requestedGame: SlateGame;
  seriesContext?: GameDayRecapSeriesContext | null;
}): GameDayRecapGameFactStore {
  const quarterFacts = buildQuarterFacts(args.boxScore);
  const awayRotationContext = analyzeRotationContextForRecap(
    args.boxScore.awayTeam,
  );
  const homeRotationContext = analyzeRotationContextForRecap(
    args.boxScore.homeTeam,
  );
  const isPlayoffGame =
    Boolean(args.seriesContext) ||
    classifyCompetition(args.requestedGame.type).competitionKey === "PLAYOFFS";
  const evidenceSignals = buildEvidenceSignals({
    awayContext: args.awayPostgameContext,
    boxScore: args.boxScore,
    homeContext: args.homePostgameContext,
    isPlayoffGame,
    playByPlayFacts: args.playByPlayFacts ?? null,
    quarterFacts,
  });
  const standingsContext = args.hasHistoricalContext
    ? buildStandingsContext({
        awayContext: args.awayEnteringGameContext,
        homeContext: args.homeEnteringGameContext,
      })
    : [];
  const gameDayPrepSummaries = buildGameDayPrepSummariesForRecap({
    awayTeam: args.boxScore.awayTeam,
    homeTeam: args.boxScore.homeTeam,
  });
  const rotationSummaries = [
    ...homeRotationContext.summaries,
    ...awayRotationContext.summaries,
  ];
  const playByPlayFacts = args.playByPlayFacts ?? null;
  const quarterScores = {
    away: args.boxScore.awayTeam.partialScores,
    home: args.boxScore.homeTeam.partialScores,
  };
  const awayTeam = buildGameDayRecapFactStoreTeam({
    enteringGameContext: args.awayEnteringGameContext,
    hasHistoricalContext: args.hasHistoricalContext,
    postgameContext: args.awayPostgameContext,
    rotationContext: awayRotationContext,
    team: args.boxScore.awayTeam,
  });
  const homeTeam = buildGameDayRecapFactStoreTeam({
    enteringGameContext: args.homeEnteringGameContext,
    hasHistoricalContext: args.hasHistoricalContext,
    postgameContext: args.homePostgameContext,
    rotationContext: homeRotationContext,
    team: args.boxScore.homeTeam,
  });
  const winner = buildGameDayRecapWinnerFacts({
    awayTeam,
    homeTeam,
  });
  const periodStates = buildGameDayRecapFactStorePeriodStates({
    awayTeamName: awayTeam.name,
    homeTeamName: homeTeam.name,
    quarterScores,
  });
  const postgameInterviewCandidates = buildPostgameInterviewCandidates({
    boxScore: args.boxScore,
    playByPlayFacts,
    requestedGame: args.requestedGame,
  });
  const postgameInterviewCandidate =
    postgameInterviewCandidates.find(
      (candidate) => candidate.perspective !== "loser",
    ) ?? null;
  const effortSummary = describeEffortDeltaForRecap({
    awayTeamName: args.boxScore.awayTeam.teamName,
    effortDelta: args.boxScore.effortDelta,
    homeTeamName: args.boxScore.homeTeam.teamName,
  });
  const requiredContextSentences = buildRequiredContextSentencesForRecap({
    effortSummary,
    gameDayPrepSummaries,
  });
  const gameScoringContext = resolveGameScoringContext({
    awayScore: awayTeam.score,
    homeScore: homeTeam.score,
  });
  const teams = {
    away: awayTeam,
    home: homeTeam,
  };
  const teamRatingFacts = buildTeamRatingFactsForRecap(teams);
  const teamTalent = buildTeamTalentFactsForRecap(teams);

  return {
    effortDelta: args.boxScore.effortDelta,
    effortSummary,
    gameDayPrepSummaries,
    rotationSummaries,
    evidenceSignals,
    finalMargin: Math.abs(
      (args.boxScore.homeTeam.score ?? 0) - (args.boxScore.awayTeam.score ?? 0),
    ),
    gameScoringContext,
    isPlayoffGame,
    matchId: args.requestedGame.matchId,
    neutral: args.boxScore.neutral,
    overtime: hasGameOvertimeFromQuarterScores(quarterScores),
    periodStates,
    playByPlayFacts,
    playByPlaySummaryLines: playByPlayFacts?.summaryLines ?? [],
    playerLeaders: buildGameDayRecapPlayerLeaders({
      boxScore: args.boxScore,
      requestedGame: args.requestedGame,
    }),
    ...(postgameInterviewCandidate ? { postgameInterviewCandidate } : {}),
    ...(postgameInterviewCandidates.length
      ? { postgameInterviewCandidates }
      : {}),
    quarterFacts,
    quarterScores,
    requiredContextSentences,
    ...(args.seriesContext ? { seriesContext: args.seriesContext } : {}),
    standingsContext,
    teamRatingFacts,
    teamTalent,
    teams,
    type: args.boxScore.type ?? args.requestedGame.type,
    winner,
  };
}

async function withResolvedInterviewPersonalities(args: {
  env: GraphqlEnv;
  factStore: GameDayRecapFactStore;
  interviewPersonalityMode: InterviewPersonalityMode;
  requestedOverrides?: RequestedInterviewPersonalityOverrides | null;
  userId: string;
}): Promise<GameDayRecapFactStore> {
  const hasRequestedOverrides = Boolean(
    args.requestedOverrides?.winnerInterviewPersonalityType ||
      args.requestedOverrides?.loserInterviewPersonalityType,
  );
  if (args.interviewPersonalityMode === "off" && !hasRequestedOverrides) {
    return args.factStore;
  }

  const games = await Promise.all(
    args.factStore.games.map(async (game) => {
      const candidates = collectPostgameInterviewCandidates(game);
      if (!candidates.length) {
        return game;
      }

      const resolvedCandidates = await Promise.all(
        candidates.map((candidate) =>
          resolvePostgameInterviewCandidatePersonality({
            allowAutomaticResolution:
              args.interviewPersonalityMode !== "off",
            candidate,
            env: args.env,
            game,
            requestedOverrides: args.requestedOverrides ?? null,
            userId: args.userId,
          }),
        ),
      );
      const winnerCandidate =
        resolvedCandidates.find(
          (candidate) => candidate.perspective !== "loser",
        ) ?? null;

      return {
        ...game,
        ...(winnerCandidate
          ? { postgameInterviewCandidate: winnerCandidate }
          : {}),
        postgameInterviewCandidates: resolvedCandidates,
      };
    }),
  );

  return {
    ...args.factStore,
    games,
  };
}

async function resolvePostgameInterviewCandidatePersonality(args: {
  allowAutomaticResolution: boolean;
  candidate: GameDayRecapPromptInterviewCandidate;
  env: GraphqlEnv;
  game: GameDayRecapGameFactStore;
  requestedOverrides?: RequestedInterviewPersonalityOverrides | null;
  userId: string;
}): Promise<GameDayRecapPromptInterviewCandidate> {
  const requestedType = resolveRequestedPostgameInterviewPersonalityType({
    candidate: args.candidate,
    requestedOverrides: args.requestedOverrides ?? null,
  });
  if (requestedType) {
    return {
      ...args.candidate,
      personalitySource: "request_override",
      personalityType: requestedType,
    };
  }
  if (!args.allowAutomaticResolution) {
    return args.candidate;
  }

  let trackedPlayer = null;
  if (
    args.candidate.playerId &&
    args.candidate.teamSide === args.game.winner.winnerSide
  ) {
    try {
      trackedPlayer = await getTrackedPlayer(
        args.env,
        args.userId,
        args.candidate.playerId,
      );
    } catch (error) {
      logGameDayRecapWarn("process.interview_personality_lookup_failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        matchId: args.game.matchId,
        playerId: args.candidate.playerId,
        targetKey: null,
        userId: args.userId,
      });
    }
  }
  const storedType = trackedPlayer?.interviewPersonalityType ?? null;
  const storedSource = trackedPlayer?.interviewPersonalitySource ?? null;
  const personalityType = isInterviewPersonalityType(storedType)
    ? storedType
    : resolveDeterministicInterviewPersonality(
        buildInterviewPersonalitySeed({
          playerId: args.candidate.playerId,
          playerName: args.candidate.playerName,
          teamName: args.candidate.teamName,
        }),
      );
  const personalitySource: InterviewPersonalitySource =
    trackedPlayer && storedSource === "user_override" ? "user_override" : "auto";

  return {
    ...args.candidate,
    personalitySource,
    personalityType,
  };
}

function resolveRequestedPostgameInterviewPersonalityType(args: {
  candidate: GameDayRecapPromptInterviewCandidate;
  requestedOverrides: RequestedInterviewPersonalityOverrides | null;
}): InterviewPersonalityType | null {
  if (!args.requestedOverrides) {
    return null;
  }

  if (args.candidate.perspective === "loser") {
    return args.requestedOverrides.loserInterviewPersonalityType ?? null;
  }

  return args.requestedOverrides.winnerInterviewPersonalityType ?? null;
}

function resolveRequestedInterviewOverridesFromRequest(
  request: Pick<
    GameDayRecapRequestFacts,
    "loserInterviewPersonalityType" | "winnerInterviewPersonalityType"
  >,
): RequestedInterviewPersonalityOverrides | null {
  const loserInterviewPersonalityType = isInterviewPersonalityType(
    request.loserInterviewPersonalityType,
  )
    ? request.loserInterviewPersonalityType
    : null;
  const winnerInterviewPersonalityType = isInterviewPersonalityType(
    request.winnerInterviewPersonalityType,
  )
    ? request.winnerInterviewPersonalityType
    : null;

  return loserInterviewPersonalityType || winnerInterviewPersonalityType
    ? {
        loserInterviewPersonalityType,
        winnerInterviewPersonalityType,
      }
    : null;
}

function applyRequestedInterviewOverrideToCandidate(
  candidate: GameDayRecapPromptInterviewCandidate,
  requestedOverrides: RequestedInterviewPersonalityOverrides | null,
): GameDayRecapPromptInterviewCandidate {
  const requestedType = resolveRequestedPostgameInterviewPersonalityType({
    candidate,
    requestedOverrides,
  });
  if (!requestedType) {
    return candidate;
  }

  return {
    ...candidate,
    personalitySource: "request_override",
    personalityType: requestedType,
  };
}

function collectPostgameInterviewCandidates(
  game: Pick<
    GameDayRecapGameFactStore | GameDayRecapPromptGame,
    "postgameInterviewCandidate" | "postgameInterviewCandidates"
  >,
): GameDayRecapPromptInterviewCandidate[] {
  const candidates = game.postgameInterviewCandidates ?? [];
  if (candidates.length) {
    return candidates;
  }

  return game.postgameInterviewCandidate ? [game.postgameInterviewCandidate] : [];
}

function buildGameDayRecapWriterPayloadFromFactStore(args: {
  coverage: GameDayRecapCoveragePayload;
  factStore: GameDayRecapFactStore;
}): GameDayRecapPromptPayload {
  // The writer only sees a projection of the canonical fact store.
  // Any truth used by prompts, validation, or repair must already exist here.
  return {
    coverage: args.coverage,
    factStore: args.factStore,
    games: args.factStore.games.map((game) =>
      buildGameDayRecapWriterGameFromFactStore({
        game,
        generationApproach: args.factStore.request.generationApproach,
      }),
    ),
    request: args.factStore.request,
  };
}

function buildGameDayRecapWriterGameFromFactStore(args: {
  game: GameDayRecapGameFactStore;
  generationApproach: RecapGenerationApproachValue;
}): GameDayRecapPromptGame {
  return {
    effortDelta: args.game.effortDelta,
    effortSummary: args.game.effortSummary,
    ...(args.generationApproach === RecapGenerationApproach.FACT_LIBRARY_FIRST
      ? {
          factsLibrary: buildGameFactsLibraryFromFactStore(args.game),
        }
      : {}),
    gameDayPrepSummaries: args.game.gameDayPrepSummaries,
    gameScoringContext: args.game.gameScoringContext,
    requiredContextSentences: args.game.requiredContextSentences,
    rotationSummaries: args.game.rotationSummaries,
    evidenceSignals: args.game.evidenceSignals,
    finalMargin: args.game.finalMargin,
    matchId: args.game.matchId,
    neutral: args.game.neutral,
    playByPlayFacts: args.game.playByPlayFacts,
    playByPlaySummaryLines: args.game.playByPlaySummaryLines,
    ...(args.game.postgameInterviewCandidate
      ? { postgameInterviewCandidate: args.game.postgameInterviewCandidate }
      : {}),
    ...(args.game.postgameInterviewCandidates?.length
      ? { postgameInterviewCandidates: args.game.postgameInterviewCandidates }
      : {}),
    quarterFacts: args.game.quarterFacts,
    quarterScores: args.game.quarterScores,
    ...(args.game.seriesContext
      ? { seriesContext: args.game.seriesContext }
      : {}),
    standingsContext: args.game.standingsContext,
    teamRatingFacts: args.game.teamRatingFacts,
    teamTalent: toWriterFacingTeamTalentFacts(args.game.teamTalent),
    teams: {
      away: toPromptTeamFromFactStoreTeam(args.game.teams.away),
      home: toPromptTeamFromFactStoreTeam(args.game.teams.home),
    },
    type: args.game.type,
  };
}

function toWriterFacingTeamTalentFacts(
  facts: GameDayRecapTeamTalentFacts,
): GameDayRecapTeamTalentFacts {
  return {
    awayTotal: null,
    differentialFromHomePerspective: null,
    homeTotal: null,
    leaderSide: facts.leaderSide,
    summary: facts.summary,
  };
}

function buildGameDayRecapFactStoreTeam(args: {
  enteringGameContext: TeamSeasonContext;
  hasHistoricalContext: boolean;
  postgameContext: TeamSeasonContext;
  rotationContext: RotationContextForRecap;
  team: BBApiBoxScoreTeam;
}): GameDayRecapFactStoreTeam {
  return {
    ...buildPromptTeam(args),
    rawRatings: args.team.ratings ?? null,
  };
}

function toPromptTeamFromFactStoreTeam(
  team: GameDayRecapFactStoreTeam,
): GameDayRecapPromptTeam {
  const { rawRatings: _rawRatings, ...promptTeam } = team;
  return promptTeam;
}

function buildGameDayRecapWinnerFacts(args: {
  awayTeam: Pick<GameDayRecapFactStoreTeam, "name" | "score">;
  homeTeam: Pick<GameDayRecapFactStoreTeam, "name" | "score">;
}): GameDayRecapWinnerFacts {
  const winnerSide =
    args.homeTeam.score === args.awayTeam.score
      ? null
      : args.homeTeam.score > args.awayTeam.score
        ? "home"
        : "away";
  const loserSide =
    winnerSide === "home" ? "away" : winnerSide === "away" ? "home" : null;
  const finalScoreHomeAway = `${args.homeTeam.score}-${args.awayTeam.score}`;
  const winnerName =
    winnerSide === "home"
      ? args.homeTeam.name
      : winnerSide === "away"
        ? args.awayTeam.name
        : null;
  const loserName =
    loserSide === "home"
      ? args.homeTeam.name
      : loserSide === "away"
        ? args.awayTeam.name
        : null;

  return {
    loserName,
    loserSide,
    finalScoreHomeAway,
    finalScoreWinnerFacing: winnerSide
      ? winnerSide === "home"
        ? `${args.homeTeam.score}-${args.awayTeam.score}`
        : `${args.awayTeam.score}-${args.homeTeam.score}`
      : null,
    winnerName,
    winnerSide,
  };
}

function buildGameDayRecapFactStorePeriodStates(args: {
  awayTeamName: string;
  homeTeamName: string;
  quarterScores: {
    away: number[];
    home: number[];
  };
}): GameDayRecapGameFactStore["periodStates"] {
  const states: GameDayRecapFactStorePeriodState[] = [];
  let homeScore = 0;
  let awayScore = 0;
  const periodCount = Math.min(
    args.quarterScores.home.length,
    args.quarterScores.away.length,
  );

  for (let period = 1; period <= periodCount; period += 1) {
    homeScore += args.quarterScores.home[period - 1] ?? 0;
    awayScore += args.quarterScores.away[period - 1] ?? 0;
    const leaderSide =
      homeScore === awayScore ? "tie" : homeScore > awayScore ? "home" : "away";
    const leaderName =
      leaderSide === "home"
        ? args.homeTeamName
        : leaderSide === "away"
          ? args.awayTeamName
          : null;
    const trailerName =
      leaderSide === "home"
        ? args.awayTeamName
        : leaderSide === "away"
          ? args.homeTeamName
          : null;

    states.push({
      awayScore,
      homeScore,
      label: formatFactsLibraryPeriodStateLabel(period, periodCount),
      leaderName,
      leaderSide,
      margin: Math.abs(homeScore - awayScore),
      period,
      scoreFromLeaderPerspective:
        leaderSide === "away"
          ? `${awayScore}-${homeScore}`
          : `${homeScore}-${awayScore}`,
      trailerName,
    });
  }

  return {
    afterPeriods: states,
    halftime: states.find((state) => state.period === 2) ?? null,
    throughThreeQuarters: states.find((state) => state.period === 3) ?? null,
  };
}

function hasGameOvertimeFromQuarterScores(quarterScores: {
  away: number[];
  home: number[];
}): boolean {
  return Math.min(quarterScores.home.length, quarterScores.away.length) > 4;
}

function buildGameDayRecapPlayerLeaders(args: {
  boxScore: BBApiBoxScore;
  requestedGame: SlateGame;
}): GameDayRecapGameFactStore["playerLeaders"] {
  const candidates = (["home", "away"] as const).flatMap((teamSide) => {
    const team =
      teamSide === "home" ? args.boxScore.homeTeam : args.boxScore.awayTeam;
    const teamName =
      team.teamName ??
      (teamSide === "home"
        ? args.requestedGame.homeTeamName
        : args.requestedGame.awayTeamName);

    return team.players
      .filter((player) => !player.didNotPlay)
      .map((player) => ({
        playerName: player.fullName,
        statLine: extractInterviewStatLine(player),
        teamName,
        teamSide,
      }));
  });

  const buildLeader = (
    compare: (
      left: GameDayRecapFactStorePlayerLeader,
      right: GameDayRecapFactStorePlayerLeader,
    ) => number,
    valueFor: (
      entry: Omit<GameDayRecapFactStorePlayerLeader, "value">,
    ) => number,
  ): GameDayRecapFactStorePlayerLeader | null => {
    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        value: valueFor(candidate),
      }))
      .filter((candidate) => candidate.value > 0)
      .sort(compare);
    return ranked[0] ?? null;
  };

  return {
    assists: buildLeader(
      (left, right) =>
        right.value - left.value ||
        compareFactStorePlayerLeaderEntries(left, right),
      (entry) => entry.statLine.assists,
    ),
    bestAllAround: buildLeader(
      (left, right) =>
        right.value - left.value ||
        compareFactStorePlayerLeaderEntries(left, right),
      (entry) => scoreInterviewStatLine(entry.statLine),
    ),
    points: buildLeader(
      (left, right) =>
        right.value - left.value ||
        compareFactStorePlayerLeaderEntries(left, right),
      (entry) => entry.statLine.points,
    ),
    rebounds: buildLeader(
      (left, right) =>
        right.value - left.value ||
        compareFactStorePlayerLeaderEntries(left, right),
      (entry) => entry.statLine.rebounds,
    ),
  };
}

function compareFactStorePlayerLeaderEntries(
  left: Pick<GameDayRecapFactStorePlayerLeader, "playerName" | "statLine">,
  right: Pick<GameDayRecapFactStorePlayerLeader, "playerName" | "statLine">,
): number {
  const pointGap = right.statLine.points - left.statLine.points;
  if (pointGap !== 0) {
    return pointGap;
  }

  const allAroundGap =
    scoreInterviewStatLine(right.statLine) -
    scoreInterviewStatLine(left.statLine);
  if (allAroundGap !== 0) {
    return allAroundGap;
  }

  return left.playerName.localeCompare(right.playerName);
}

function buildGameFactsLibraryFromFactStore(
  game: GameDayRecapGameFactStore,
): GameDayRecapFactsLibrary {
  const winnerSide = game.winner.winnerSide ?? "home";
  const loserSide = winnerSide === "home" ? "away" : "home";
  const winnerName = game.winner.winnerName ?? game.teams[winnerSide].name;
  const loserName = game.winner.loserName ?? game.teams[loserSide].name;
  const winnerScore =
    winnerSide === "home" ? game.teams.home.score : game.teams.away.score;
  const loserScore =
    winnerSide === "home" ? game.teams.away.score : game.teams.home.score;
  const finalScoreFromWinnerPerspective = `${winnerScore}-${loserScore}`;
  const periodStates = game.periodStates.afterPeriods;
  const throughThreeQuarters = game.periodStates.throughThreeQuarters;
  const matchupEdgeFacts = buildFactsLibraryMatchupEdgeFacts(game);
  const gameFlow = buildFactsLibraryGameFlow({
    finalMargin: game.finalMargin,
    playByPlayFacts: game.playByPlayFacts,
    seriesContext: game.seriesContext ?? null,
  });
  const summaryFacts = buildFactsLibrarySummaryFacts({
    awayTeamName: game.teams.away.name,
    finalMargin: game.finalMargin,
    finalScoreFromWinnerPerspective,
    gameScoringContext: game.gameScoringContext,
    gameFlow,
    homeTeamName: game.teams.home.name,
    loserName,
    playByPlayFacts: game.playByPlayFacts,
    quarterFacts: game.quarterFacts,
    throughThreeQuarters,
    winnerName,
  });
  const storySignals = buildFactsLibraryStorySignals({
    awayTeamName: game.teams.away.name,
    finalMargin: game.finalMargin,
    gameScoringContext: game.gameScoringContext,
    gameFlow,
    homeTeamName: game.teams.home.name,
    overtime: game.overtime,
    playByPlayFacts: game.playByPlayFacts,
    seriesContext: game.seriesContext ?? null,
    throughThreeQuarters,
    winnerName,
  });
  const openingCandidates = buildFactsLibraryOpeningCandidates({
    awayTeamName: game.teams.away.name,
    finalScoreFromWinnerPerspective,
    gameFlow,
    homeTeamName: game.teams.home.name,
    loserName,
    playByPlayFacts: game.playByPlayFacts,
    throughThreeQuarters,
    winnerName,
  });
  const headlineCandidates = buildFactsLibraryHeadlineCandidates({
    finalScoreFromWinnerPerspective,
    gameFlow,
    loserName,
    playByPlayFacts: game.playByPlayFacts,
    seriesContext: game.seriesContext ?? null,
    winnerName,
    winnerSide,
  });
  const narrativePlan = buildFactsLibraryNarrativePlan({
    game,
    gameFlow,
    matchupEdgeFacts,
    summaryFacts,
  });

  return {
    gameFlow,
    headlineCandidates,
    matchupEdgeFacts,
    narrativePlan,
    openingCandidates,
    periodStates: {
      afterPeriods: periodStates,
      throughThreeQuarters,
    },
    requiredContextSentences: game.requiredContextSentences,
    storySignals,
    summaryFacts,
    winner: {
      finalMargin: game.finalMargin,
      finalScoreFromWinnerPerspective,
      loserName,
      winnerName,
    },
  };
}

function resolveBoxScoreWinnerSide(
  boxScore: BBApiBoxScore,
): "away" | "home" | null {
  const homeScore = boxScore.homeTeam.score;
  const awayScore = boxScore.awayTeam.score;
  if (homeScore === null || awayScore === null || homeScore === awayScore) {
    return null;
  }

  return homeScore > awayScore ? "home" : "away";
}

function buildPostgameInterviewCandidates(args: {
  boxScore: BBApiBoxScore;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  requestedGame: SlateGame;
}): GameDayRecapPromptInterviewCandidate[] {
  const winnerSide = resolveBoxScoreWinnerSide(args.boxScore);
  if (!winnerSide) {
    return [];
  }
  const loserSide = winnerSide === "home" ? "away" : "home";

  const winnerTeam =
    winnerSide === "home" ? args.boxScore.homeTeam : args.boxScore.awayTeam;
  const winnerName =
    winnerTeam.teamName ??
    (winnerSide === "home"
      ? args.requestedGame.homeTeamName
      : args.requestedGame.awayTeamName);
  const eligiblePlayers = winnerTeam.players.filter(
    (player) => !player.didNotPlay,
  );
  if (!eligiblePlayers.length) {
    return [];
  }

  const decisivePlayer = resolveInterviewDecisivePlayer({
    players: eligiblePlayers,
    playByPlayFacts: args.playByPlayFacts,
    winnerSide,
  });
  const selectedPlayer =
    decisivePlayer ?? [...eligiblePlayers].sort(compareInterviewPlayers)[0];
  if (!selectedPlayer) {
    return [];
  }

  const statLine = extractInterviewStatLine(selectedPlayer);
  const hasDecisiveMoment = decisivePlayer?.id === selectedPlayer.id;
  const candidates: GameDayRecapPromptInterviewCandidate[] = [];
  if (shouldGeneratePostgameInterview(statLine, hasDecisiveMoment)) {
    candidates.push({
      perspective: "winner",
      playerId: selectedPlayer.id ?? null,
      playerName: selectedPlayer.fullName,
      selectionReason: buildPostgameInterviewSelectionReason({
        playByPlayFacts: args.playByPlayFacts,
        player: selectedPlayer,
        statLine,
        winnerName,
        winnerSide,
      }),
      statLine,
      supportedFacts: buildPostgameInterviewSupportedFacts({
        playByPlayFacts: args.playByPlayFacts,
        player: selectedPlayer,
        statLine,
        winnerName,
        winnerSide,
      }),
      teamName: winnerName,
      teamSide: winnerSide,
    });
  }

  const loserCandidate = buildLosingPostgameInterviewCandidate({
    boxScore: args.boxScore,
    loserSide,
    requestedGame: args.requestedGame,
    winnerSide,
  });
  if (loserCandidate) {
    candidates.push(loserCandidate);
  }

  return candidates;
}

function buildLosingPostgameInterviewCandidate(args: {
  boxScore: BBApiBoxScore;
  loserSide: "away" | "home";
  requestedGame: SlateGame;
  winnerSide: "away" | "home";
}): GameDayRecapPromptInterviewCandidate | null {
  const loserTeam =
    args.loserSide === "home" ? args.boxScore.homeTeam : args.boxScore.awayTeam;
  const winnerTeam =
    args.winnerSide === "home"
      ? args.boxScore.homeTeam
      : args.boxScore.awayTeam;
  const loserName =
    loserTeam.teamName ??
    (args.loserSide === "home"
      ? args.requestedGame.homeTeamName
      : args.requestedGame.awayTeamName);
  const winnerName =
    winnerTeam.teamName ??
    (args.winnerSide === "home"
      ? args.requestedGame.homeTeamName
      : args.requestedGame.awayTeamName);
  const selectedPlayer =
    loserTeam.players.filter((player) => !player.didNotPlay).sort(compareInterviewPlayers)[0] ??
    null;
  if (!selectedPlayer) {
    return null;
  }

  const statLine = extractInterviewStatLine(selectedPlayer);
  if (!shouldGeneratePostgameInterview(statLine, false)) {
    return null;
  }

  return {
    perspective: "loser",
    playerId: selectedPlayer.id ?? null,
    playerName: selectedPlayer.fullName,
    selectionReason: `Best grounded losing-side interview candidate for ${loserName}.`,
    statLine,
    supportedFacts: buildLosingPostgameInterviewSupportedFacts({
      loserName,
      player: selectedPlayer,
      statLine,
      winnerName,
    }),
    teamName: loserName,
    teamSide: args.loserSide,
  };
}

function buildLosingPostgameInterviewSupportedFacts(args: {
  loserName: string;
  player: BBApiBoxScorePlayer;
  statLine: GameDayRecapPromptInterviewCandidate["statLine"];
  winnerName: string;
}): string[] {
  const facts = new Set<string>();
  facts.add(`${args.loserName} lost to ${args.winnerName}.`);
  facts.add(
    `${args.player.fullName} finished with ${args.statLine.points} points.`,
  );
  if (args.statLine.rebounds > 0 || args.statLine.assists > 0) {
    facts.add(
      `${args.player.fullName} added ${args.statLine.rebounds} rebounds and ${args.statLine.assists} assists.`,
    );
  }
  if (args.statLine.turnovers > 0) {
    facts.add(`${args.player.fullName} had ${args.statLine.turnovers} turnovers.`);
  }

  return Array.from(facts).slice(0, 4);
}

function resolveInterviewDecisivePlayer(args: {
  players: BBApiBoxScorePlayer[];
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  winnerSide: "away" | "home";
}): BBApiBoxScorePlayer | null {
  const decisiveScore = args.playByPlayFacts?.endingFacts.decisiveScore;
  const eventText = decisiveScore?.eventText?.trim();
  if (
    !eventText ||
    !decisiveScore ||
    decisiveScore.scoringTeamSide !== args.winnerSide
  ) {
    return null;
  }

  return (
    [...args.players]
      .filter((player) => eventTextMentionsPlayer(eventText, player))
      .sort(compareInterviewPlayers)[0] ?? null
  );
}

function eventTextMentionsPlayer(
  eventText: string,
  player: BBApiBoxScorePlayer,
): boolean {
  const lastName = player.lastName?.trim();
  if (
    player.fullName &&
    new RegExp(`\\b${escapeRegExp(player.fullName)}\\b`, "i").test(eventText)
  ) {
    return true;
  }

  return Boolean(
    lastName &&
    lastName.length >= 3 &&
    new RegExp(`\\b${escapeRegExp(lastName)}\\b`, "i").test(eventText),
  );
}

function compareInterviewPlayers(
  left: BBApiBoxScorePlayer,
  right: BBApiBoxScorePlayer,
): number {
  const leftStatLine = extractInterviewStatLine(left);
  const rightStatLine = extractInterviewStatLine(right);
  if (rightStatLine.points !== leftStatLine.points) {
    return rightStatLine.points - leftStatLine.points;
  }

  const performanceDiff =
    scorePlayerPerformance(right) - scorePlayerPerformance(left);
  if (performanceDiff !== 0) {
    return performanceDiff;
  }

  const rightStocks = rightStatLine.steals + rightStatLine.blocks;
  const leftStocks = leftStatLine.steals + leftStatLine.blocks;
  if (rightStocks !== leftStocks) {
    return rightStocks - leftStocks;
  }

  const rightPlaymaking = rightStatLine.rebounds + rightStatLine.assists;
  const leftPlaymaking = leftStatLine.rebounds + leftStatLine.assists;
  if (rightPlaymaking !== leftPlaymaking) {
    return rightPlaymaking - leftPlaymaking;
  }

  return left.fullName.localeCompare(right.fullName);
}

function extractInterviewStatLine(
  player: BBApiBoxScorePlayer,
): GameDayRecapPromptInterviewCandidate["statLine"] {
  const performanceStats = player.performanceStats ?? {};
  return {
    assists: asNumberFromUnknown(performanceStats.ast),
    blocks: asNumberFromUnknown(performanceStats.blk),
    minutes: playerTotalMinutes(player),
    points: asNumberFromUnknown(performanceStats.pts),
    rebounds: asNumberFromUnknown(performanceStats.reb),
    steals: asNumberFromUnknown(performanceStats.stl),
    turnovers: asNumberFromUnknown(performanceStats.to),
  };
}

function shouldGeneratePostgameInterview(
  statLine: GameDayRecapPromptInterviewCandidate["statLine"],
  hasDecisiveMoment: boolean,
): boolean {
  if (hasDecisiveMoment) {
    return true;
  }

  return Boolean(
    statLine.points >= 10 ||
    scoreInterviewStatLine(statLine) >= 16 ||
    statLine.rebounds >= 10 ||
    statLine.assists >= 8 ||
    statLine.steals + statLine.blocks >= 4,
  );
}

function scoreInterviewStatLine(
  statLine: GameDayRecapPromptInterviewCandidate["statLine"],
): number {
  return (
    statLine.points +
    statLine.rebounds * 0.7 +
    statLine.assists * 0.7 +
    statLine.steals +
    statLine.blocks -
    statLine.turnovers * 0.5
  );
}

function buildPostgameInterviewSelectionReason(args: {
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  player: BBApiBoxScorePlayer;
  statLine: GameDayRecapPromptInterviewCandidate["statLine"];
  winnerName: string;
  winnerSide: "away" | "home";
}): string {
  const decisiveScore = args.playByPlayFacts?.endingFacts.decisiveScore;
  if (
    decisiveScore &&
    decisiveScore.scoringTeamSide === args.winnerSide &&
    decisiveScore.eventText &&
    eventTextMentionsPlayer(decisiveScore.eventText, args.player)
  ) {
    return decisiveScore.isBuzzerBeater
      ? `Delivered ${args.winnerName}'s buzzerbeater.`
      : decisiveScore.momentType === "go_ahead"
        ? `Delivered ${args.winnerName}'s go-ahead basket.`
        : `Delivered ${args.winnerName}'s decisive late bucket.`;
  }

  if (args.statLine.points >= 20) {
    return `Led ${args.winnerName} in scoring.`;
  }

  return `Turned in ${args.winnerName}'s strongest all-around line.`;
}

function buildPostgameInterviewSupportedFacts(args: {
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  player: BBApiBoxScorePlayer;
  statLine: GameDayRecapPromptInterviewCandidate["statLine"];
  winnerName: string;
  winnerSide: "away" | "home";
}): string[] {
  const facts = new Set<string>();
  const decisiveScore = args.playByPlayFacts?.endingFacts.decisiveScore;
  if (
    decisiveScore &&
    decisiveScore.scoringTeamSide === args.winnerSide &&
    decisiveScore.eventText &&
    eventTextMentionsPlayer(decisiveScore.eventText, args.player)
  ) {
    facts.add(
      decisiveScore.isBuzzerBeater
        ? `${args.player.fullName} was tied to ${args.winnerName}'s buzzerbeater.`
        : decisiveScore.momentType === "go_ahead"
          ? `${args.player.fullName} was tied to ${args.winnerName}'s go-ahead basket.`
          : `${args.player.fullName} was tied to ${args.winnerName}'s decisive late score.`,
    );
  }

  facts.add(
    `${args.player.fullName} finished with ${args.statLine.points} points.`,
  );

  if (args.statLine.rebounds > 0 || args.statLine.assists > 0) {
    facts.add(
      `${args.player.fullName} added ${args.statLine.rebounds} rebounds and ${args.statLine.assists} assists.`,
    );
  }
  if (args.statLine.steals > 0 || args.statLine.blocks > 0) {
    facts.add(
      `${args.player.fullName} chipped in ${args.statLine.steals} steals and ${args.statLine.blocks} blocks.`,
    );
  }

  const winnerRun =
    args.playByPlayFacts?.primaryRun?.teamSide === args.winnerSide
      ? args.playByPlayFacts.primaryRun
      : args.playByPlayFacts?.secondaryRun?.teamSide === args.winnerSide
        ? args.playByPlayFacts.secondaryRun
        : null;
  if (winnerRun) {
    const timeRange = formatInterviewRunTimeRange(winnerRun);
    if (timeRange) {
      facts.add(
        `${args.winnerName}'s primary run was ${winnerRun.teamPoints}-${winnerRun.opponentPoints} ${timeRange}.`,
      );
    }
  }

  return Array.from(facts).slice(0, 4);
}

function formatInterviewRunTimeRange(
  run: NonNullable<GameDayRecapPlayByPlayFacts["primaryRun"]>,
): string | null {
  if (run.startQuarter === null || !run.startClock) {
    return null;
  }

  const start = `${run.startClock} left in ${formatPeriodLabel(run.startQuarter)}`;
  if (
    run.endQuarter !== null &&
    run.endClock &&
    (run.endQuarter !== run.startQuarter || run.endClock !== run.startClock)
  ) {
    return `from ${start} to ${run.endClock} left in ${formatPeriodLabel(run.endQuarter)}`;
  }

  return `starting at ${start}`;
}

function formatFactsLibraryPeriodStateLabel(
  period: number,
  totalPeriods: number,
): string {
  if (period === 2) {
    return "At halftime";
  }
  if (period === 3) {
    return "Through three quarters";
  }
  if (period === totalPeriods) {
    return totalPeriods > 4 ? "Final after overtime" : "Final";
  }
  if (period <= 4) {
    return `After the ${ordinal(period)} quarter`;
  }

  return `After ${formatPeriodLabel(period)}`;
}

function buildFactsLibraryMatchupEdgeFacts(
  game: GameDayRecapGameFactStore,
): GameDayRecapFactsLibrary["matchupEdgeFacts"] {
  const winnerSide = game.winner.winnerSide ?? "home";
  const loserSide = winnerSide === "home" ? "away" : "home";
  const winnerTeam = game.teams[winnerSide];
  const loserTeam = game.teams[loserSide];
  const winnerRatingLabels = formatTeamRatingsForRecap(winnerTeam.rawRatings);
  const loserRatingLabels = formatTeamRatingsForRecap(loserTeam.rawRatings);
  const ratingComparisons = TEAM_RATING_KEYS.flatMap((key) => {
    const winnerValue = winnerTeam.rawRatings?.[key];
    const loserValue = loserTeam.rawRatings?.[key];
    if (
      typeof winnerValue !== "number" ||
      !Number.isFinite(winnerValue) ||
      typeof loserValue !== "number" ||
      !Number.isFinite(loserValue)
    ) {
      return [];
    }

    return [
      {
        gap: roundToOneDecimal(winnerValue - loserValue),
        key,
        label: FACT_LIBRARY_RATING_LABELS[key] ?? key,
        loserLabel:
          loserRatingLabels[key] ?? String(roundToOneDecimal(loserValue)),
        winnerLabel:
          winnerRatingLabels[key] ?? String(roundToOneDecimal(winnerValue)),
      },
    ];
  });

  const contextualSupported = [
    ...game.teamRatingFacts.comparisons
      .filter(
        (comparison) =>
          comparison.left.teamSide === winnerSide &&
          comparison.differential >= 0.7 &&
          comparison.relevance !== "same_category",
      )
      .sort((left, right) => right.differential - left.differential)
      .slice(0, 3)
      .map((comparison) => comparison.summary),
    buildDefenseAgainstOpponentAttackRatingFact({
      attacker: loserTeam,
      attackerLabels: loserRatingLabels,
      attackerName: game.winner.loserName ?? loserTeam.name,
      defender: winnerTeam,
      defenderLabels: winnerRatingLabels,
      defenderName: game.winner.winnerName ?? winnerTeam.name,
    }),
    buildOffenseAgainstOpponentDefenseRatingFact({
      attacker: winnerTeam,
      attackerLabels: winnerRatingLabels,
      attackerName: game.winner.winnerName ?? winnerTeam.name,
      defender: loserTeam,
      defenderLabels: loserRatingLabels,
      defenderName: game.winner.loserName ?? loserTeam.name,
    }),
    buildLowFlowTurnoverRatingFact({
      team: loserTeam,
      teamLabels: loserRatingLabels,
      teamName: game.winner.loserName ?? loserTeam.name,
    }),
  ].filter((fact): fact is string => Boolean(fact));

  const supported = uniqueRecapLines([
    ...contextualSupported,
    ...teamTalentFactsForMatchupEdges(game),
  ]).slice(0, 4);
  const suppressed = ratingComparisons
    .filter((comparison) => comparison.gap <= -0.8)
    .sort((left, right) => left.gap - right.gap)
    .slice(0, 3)
    .map(
      (comparison) =>
        `Do not say ${game.winner.winnerName ?? winnerTeam.name} won because of ${comparison.label}; ${game.winner.loserName ?? loserTeam.name} rated better there (${comparison.loserLabel} vs ${comparison.winnerLabel}).`,
    );

  return {
    suppressed,
    supported,
  };
}

function buildDefenseAgainstOpponentAttackRatingFact(args: {
  attacker: GameDayRecapFactStoreTeam;
  attackerLabels: Record<string, string>;
  attackerName: string;
  defender: GameDayRecapFactStoreTeam;
  defenderLabels: Record<string, string>;
  defenderName: string;
}): string | null {
  const context = resolveRatingAttackContext(args.attacker.offStrategy);
  if (!context) {
    return null;
  }

  const defenseValue = args.defender.rawRatings?.[context.defenseKey];
  const attackValue = args.attacker.rawRatings?.[context.scoringKey];
  if (
    !isFiniteRatingValue(defenseValue) ||
    !isFiniteRatingValue(attackValue) ||
    Math.max(defenseValue, attackValue) < 11.5 ||
    defenseValue < attackValue - 0.7
  ) {
    return null;
  }

  return `${args.defenderName} had ${formatRatingLabelForFact(
    args.defenderLabels,
    context.defenseKey,
    defenseValue,
  )} ${context.defenseLabel} against ${formatRatingLabelForFact(
    args.attackerLabels,
    context.scoringKey,
    attackValue,
  )} ${context.attackLabel} from ${args.attackerName}.`;
}

function buildOffenseAgainstOpponentDefenseRatingFact(args: {
  attacker: GameDayRecapFactStoreTeam;
  attackerLabels: Record<string, string>;
  attackerName: string;
  defender: GameDayRecapFactStoreTeam;
  defenderLabels: Record<string, string>;
  defenderName: string;
}): string | null {
  const context = resolveRatingAttackContext(args.attacker.offStrategy);
  if (!context) {
    return null;
  }

  const attackValue = args.attacker.rawRatings?.[context.scoringKey];
  const defenseValue = args.defender.rawRatings?.[context.defenseKey];
  if (
    !isFiniteRatingValue(attackValue) ||
    !isFiniteRatingValue(defenseValue) ||
    attackValue < 11.5 ||
    attackValue < defenseValue + 0.8
  ) {
    return null;
  }

  return `${args.attackerName} brought ${formatRatingLabelForFact(
    args.attackerLabels,
    context.scoringKey,
    attackValue,
  )} ${context.attackLabel} against ${formatRatingLabelForFact(
    args.defenderLabels,
    context.defenseKey,
    defenseValue,
  )} ${context.defenseLabel} from ${args.defenderName}.`;
}

function buildLowFlowTurnoverRatingFact(args: {
  team: GameDayRecapFactStoreTeam;
  teamLabels: Record<string, string>;
  teamName: string;
}): string | null {
  const offensiveFlow = args.team.rawRatings?.offensiveFlow;
  const turnovers = args.team.turnovers;
  if (
    !isFiniteRatingValue(offensiveFlow) ||
    turnovers === null ||
    turnovers < 12 ||
    offensiveFlow > 9.5
  ) {
    return null;
  }

  return `For ${args.teamName}, ${formatRatingLabelForFact(
    args.teamLabels,
    "offensiveFlow",
    offensiveFlow,
  )} offensive flow paired with ${turnovers} turnovers.`;
}

function teamTalentFactsForMatchupEdges(
  game: GameDayRecapGameFactStore,
): string[] {
  if (!game.teamTalent.summary) {
    return [];
  }

  const differential = Math.abs(
    game.teamTalent.differentialFromHomePerspective ?? 0,
  );
  return differential >= 6 ? [game.teamTalent.summary] : [];
}

function resolveRatingAttackContext(
  offStrategy: string | null,
): GameDayRecapRatingAttackContext | null {
  return resolveRatingAttackContexts(offStrategy)[0] ?? null;
}

function resolveRatingAttackContexts(
  offStrategy: string | null,
): GameDayRecapRatingAttackContext[] {
  const normalized =
    offStrategy
      ?.toLowerCase()
      .replace(/[^a-z]+/g, " ")
      .trim() ?? "";
  const outsideContext: GameDayRecapRatingAttackContext = {
    attackLabel: "outside scoring",
    defenseKey: "outsideDefense",
    defenseLabel: "perimeter defense",
    scoringKey: "outsideScoring",
  };
  const insideContext: GameDayRecapRatingAttackContext = {
    attackLabel: "inside scoring",
    defenseKey: "insideDefense",
    defenseLabel: "inside defense",
    scoringKey: "insideScoring",
  };

  if (/\b(?:motion|run and gun|princeton|outside)\b/.test(normalized)) {
    return [outsideContext];
  }

  if (/\b(?:look inside|low post|inside isolation|inside)\b/.test(normalized)) {
    return [insideContext];
  }

  return [outsideContext, insideContext];
}

function resolveOffenseStoryFamily(
  offStrategy: string | null,
): "inside" | "outside" | null {
  const contexts = resolveRatingAttackContexts(offStrategy);
  if (contexts.length !== 1) {
    return null;
  }

  return contexts[0]?.scoringKey === "insideScoring" ? "inside" : "outside";
}

function isFiniteRatingValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatRatingLabelForFact(
  labels: Record<string, string>,
  key: string,
  value: number,
): string {
  return labels[key] ?? String(roundToOneDecimal(value));
}

function buildFactsLibraryNarrativePlan(args: {
  game: GameDayRecapGameFactStore;
  gameFlow: GameDayRecapFactsLibraryGameFlow;
  matchupEdgeFacts: GameDayRecapFactsLibrary["matchupEdgeFacts"];
  summaryFacts: string[];
}): GameDayRecapFactsLibraryNarrativePlan {
  const setupFacts = uniqueRecapLines(
    [
      buildTacticalSetupFact(args.game),
      ...args.game.requiredContextSentences,
      ...args.game.rotationSummaries,
    ].filter((fact): fact is string => Boolean(fact)),
  );
  const gameFlowFacts = uniqueRecapLines(
    [
      args.game.periodStates.halftime
        ? buildThroughPeriodSentenceFromState(args.game.periodStates.halftime)
        : null,
      args.game.periodStates.throughThreeQuarters
        ? buildThroughPeriodSentenceFromState(
            args.game.periodStates.throughThreeQuarters,
          )
        : null,
      ...args.gameFlow.highlightLeadChanges,
      ...args.gameFlow.highlightRuns.map((highlight) => highlight.summary),
      args.gameFlow.closingNote,
      ...args.summaryFacts.filter((fact) =>
        /\b(?:quarter|run|lead|comeback|largest lead|through three)\b/i.test(
          fact,
        ),
      ),
    ].filter((fact): fact is string => Boolean(fact)),
  );
  const closingFacts = uniqueRecapLines([
    ...buildPlayerLeaderNarrativeFacts(args.game),
    ...args.matchupEdgeFacts.supported,
    `${args.game.winner.winnerName ?? args.game.teams.home.name} won by ${args.game.finalMargin} points.`,
  ]);

  return {
    closingFacts,
    gameFlowFacts,
    paragraphOrder: [
      "Paragraph 1: pregame tactics, effort, rotation, and game-day-prep context.",
      "Paragraph 2: chronological game flow, period states, and approved non-overlapping runs.",
      "Paragraph 3: player stat lines, team-rating edges, and why the winner won.",
    ],
    setupFacts,
  };
}

function buildTacticalSetupFact(
  game: GameDayRecapGameFactStore,
): string | null {
  const awayOffense = game.teams.away.offStrategy?.trim();
  const homeOffense = game.teams.home.offStrategy?.trim();
  const awayDefense = game.teams.away.defStrategy?.trim();
  const homeDefense = game.teams.home.defStrategy?.trim();
  const tacticParts = [
    awayOffense ? `${game.teams.away.name} played ${awayOffense}` : null,
    homeOffense ? `${game.teams.home.name} played ${homeOffense}` : null,
    awayDefense ? `${game.teams.away.name} defended with ${awayDefense}` : null,
    homeDefense ? `${game.teams.home.name} defended with ${homeDefense}` : null,
  ].filter((part): part is string => Boolean(part));

  return tacticParts.length
    ? `Tactical setup: ${tacticParts.join("; ")}.`
    : null;
}

function buildThroughPeriodSentenceFromState(
  state: GameDayRecapFactStorePeriodState,
): string {
  if (state.leaderSide === "tie") {
    return `${state.label}, the game was tied ${state.homeScore}-${state.awayScore}.`;
  }

  return `${state.label}, ${state.leaderName ?? "the leader"} led ${state.trailerName ?? "the opponent"} ${state.scoreFromLeaderPerspective}.`;
}

function buildPlayerLeaderNarrativeFacts(
  game: GameDayRecapGameFactStore,
): string[] {
  const leaders = [
    game.playerLeaders.points,
    game.playerLeaders.rebounds,
    game.playerLeaders.assists,
    game.playerLeaders.bestAllAround,
  ].filter((leader): leader is GameDayRecapFactStorePlayerLeader =>
    Boolean(leader),
  );
  const facts = leaders.map((leader) => {
    const line = leader.statLine;
    return `${leader.playerName} led ${leader.teamName} with ${line.points} points, ${line.rebounds} rebounds, and ${line.assists} assists.`;
  });

  return uniqueRecapLines(facts);
}

function buildFactsLibraryGameFlow(args: {
  finalMargin: number;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  seriesContext: GameDayRecapSeriesContext | null;
}): GameDayRecapFactsLibraryGameFlow {
  const highlightRuns = buildFactsLibraryRunHighlights(args.playByPlayFacts);
  const highlightLeadChanges = buildFactsLibraryLeadChangeHighlights(
    args.playByPlayFacts,
  );
  const closingNote =
    args.playByPlayFacts?.summaryLines.find((line) =>
      /\b(?:Closing sequence|buzzerbeater|Late-game swing|Late-game swings)\b/i.test(
        line,
      ),
    ) ?? null;
  const doNotEmphasize: string[] = [];

  if (args.seriesContext) {
    doNotEmphasize.push(
      "Put the current playoff series result in the game headline rather than repeating the series score in the writeup.",
    );
  }
  if (
    args.finalMargin >= 8 &&
    args.playByPlayFacts?.endingFacts.decisiveScore &&
    args.playByPlayFacts.endingFacts.decisiveScore.momentType ===
      "lead_extension" &&
    !args.playByPlayFacts.endingFacts.decisiveScore.isBuzzerBeater &&
    !args.playByPlayFacts.endingFacts.opponentLastChance
  ) {
    doNotEmphasize.push(
      "Do not frame the final scoring play as the decisive capper when the result was already in hand.",
    );
  }

  return {
    closingNote,
    doNotEmphasize,
    highlightLeadChanges,
    highlightRuns,
    lastLeadByLoser: null,
    scoringDroughts: [],
    tookLeadForGood: null,
  };
}

function buildFactsLibraryRunHighlights(
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null,
): GameDayRecapFactsLibraryGameFlow["highlightRuns"] {
  return (playByPlayFacts?.summaryLines ?? [])
    .filter((line) => /\brun\b/i.test(line))
    .slice(0, 2)
    .map((summary) => ({
      playerBurst: null,
      summary,
    }));
}

function buildFactsLibraryLeadChangeHighlights(
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null,
): string[] {
  const summary =
    playByPlayFacts?.summaryLines.find((line) =>
      /\blead changed hands\b|\berased a \d+-point deficit and took the lead\b/i.test(
        line,
      ),
    ) ?? null;
  return summary ? [summary] : [];
}

function buildFactsLibrarySummaryFacts(args: {
  awayTeamName: string;
  finalMargin: number;
  finalScoreFromWinnerPerspective: string;
  gameScoringContext: "high_scoring_shootout" | "low_scoring_grind" | null;
  gameFlow: GameDayRecapFactsLibraryGameFlow;
  homeTeamName: string;
  loserName: string;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  quarterFacts: GameDayRecapPromptQuarterFacts;
  throughThreeQuarters: GameDayRecapFactsLibraryPeriodState | null;
  winnerName: string;
}): string[] {
  const facts = new Set<string>();
  facts.add(
    `${args.winnerName} beat ${args.loserName} ${args.finalScoreFromWinnerPerspective}.`,
  );
  if (args.gameScoringContext === "high_scoring_shootout") {
    facts.add(`Both teams topped 100 points, making it a high-scoring game.`);
  } else if (args.gameScoringContext === "low_scoring_grind") {
    facts.add(
      `Both teams stayed below 80 points, making it a low-scoring game.`,
    );
  }

  if (args.throughThreeQuarters) {
    facts.add(
      buildThroughThreeQuartersSentenceFromState(
        args.throughThreeQuarters,
        args.homeTeamName,
        args.awayTeamName,
      ),
    );
  }
  if (args.quarterFacts.decisiveQuarter?.winningSide) {
    const decisiveSide = args.quarterFacts.decisiveQuarter.winningSide;
    const decisiveTeamName =
      decisiveSide === "home" ? args.homeTeamName : args.awayTeamName;
    facts.add(
      `${decisiveTeamName} won the ${args.quarterFacts.decisiveQuarter.label} ${winnerFacingQuarterScore(
        args.quarterFacts.decisiveQuarter,
        decisiveSide,
      )}.`,
    );
  }
  if ((args.playByPlayFacts?.winnerComebackDeficit ?? 0) >= 8) {
    facts.add(
      `${args.winnerName} erased a ${args.playByPlayFacts!.winnerComebackDeficit}-point deficit to win.`,
    );
  }
  if (
    (args.playByPlayFacts?.largestLead.points ?? 0) >= 10 &&
    args.playByPlayFacts?.largestLead.teamName
  ) {
    facts.add(
      `${args.playByPlayFacts.largestLead.teamName} built the largest lead at ${args.playByPlayFacts.largestLead.points} points.`,
    );
  }
  args.gameFlow.highlightRuns.forEach((highlight) => {
    facts.add(highlight.summary);
  });
  if (args.gameFlow.highlightLeadChanges[0]) {
    facts.add(args.gameFlow.highlightLeadChanges[0]);
  }
  if (args.gameFlow.closingNote) {
    facts.add(args.gameFlow.closingNote);
  }
  if (args.finalMargin >= 15) {
    facts.add(`${args.winnerName} won by ${args.finalMargin} points.`);
  }

  return Array.from(facts).slice(0, 8);
}

function buildFactsLibraryStorySignals(args: {
  awayTeamName: string;
  finalMargin: number;
  gameScoringContext: "high_scoring_shootout" | "low_scoring_grind" | null;
  gameFlow: GameDayRecapFactsLibraryGameFlow;
  homeTeamName: string;
  overtime: boolean;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  seriesContext: GameDayRecapSeriesContext | null;
  throughThreeQuarters: GameDayRecapFactsLibraryPeriodState | null;
  winnerName: string;
}): string[] {
  const signals = new Set<string>();

  if (args.seriesContext) {
    signals.add(
      "This is a playoff series game, so the series state belongs in the headline rather than the writeup opener.",
    );
  }
  if (args.finalMargin <= 5) {
    signals.add("This was a close finish.");
  } else if (args.finalMargin >= 15) {
    signals.add("The winner created clear final separation.");
  }
  if (args.gameScoringContext === "high_scoring_shootout") {
    signals.add("Both teams scored more than 100 points.");
  } else if (args.gameScoringContext === "low_scoring_grind") {
    signals.add("Both teams scored fewer than 80 points.");
  }
  if (
    args.throughThreeQuarters &&
    args.throughThreeQuarters.margin <= 6 &&
    args.finalMargin >= 10 &&
    (args.throughThreeQuarters.homeScore > args.throughThreeQuarters.awayScore
      ? args.homeTeamName
      : args.throughThreeQuarters.awayScore >
          args.throughThreeQuarters.homeScore
        ? args.awayTeamName
        : null) === args.winnerName
  ) {
    signals.add(
      `${args.winnerName} only led ${args.throughThreeQuarters.scoreFromLeaderPerspective} through three quarters before pulling away late.`,
    );
  } else if (
    args.throughThreeQuarters &&
    args.throughThreeQuarters.homeScore !==
      args.throughThreeQuarters.awayScore &&
    args.finalMargin >= 10
  ) {
    const leaderName =
      args.throughThreeQuarters.homeScore > args.throughThreeQuarters.awayScore
        ? args.homeTeamName
        : args.awayTeamName;
    signals.add(
      `${leaderName} held a ${args.throughThreeQuarters.scoreFromLeaderPerspective} edge through three quarters.`,
    );
  }
  if (args.overtime) {
    signals.add("The game went to overtime.");
  }
  if (args.playByPlayFacts?.winnerComebackDeficit) {
    signals.add(
      `${args.winnerName}'s comeback depth was ${args.playByPlayFacts.winnerComebackDeficit} points.`,
    );
  }
  if (args.gameFlow.highlightLeadChanges[0]) {
    signals.add(args.gameFlow.highlightLeadChanges[0]);
  }
  args.gameFlow.highlightRuns.forEach((highlight) => {
    signals.add(highlight.summary);
  });
  if (args.gameFlow.doNotEmphasize.length > 0) {
    args.gameFlow.doNotEmphasize.forEach((signal) => {
      signals.add(signal);
    });
  }

  return Array.from(signals).slice(0, 8);
}

function buildFactsLibraryOpeningCandidates(args: {
  awayTeamName: string;
  finalScoreFromWinnerPerspective: string;
  gameFlow: GameDayRecapFactsLibraryGameFlow;
  homeTeamName: string;
  loserName: string;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  throughThreeQuarters: GameDayRecapFactsLibraryPeriodState | null;
  winnerName: string;
}): string[] {
  const candidates: string[] = [];

  if (args.playByPlayFacts?.summaryLines[0]) {
    candidates.push(args.playByPlayFacts.summaryLines[0]);
  }
  candidates.push(
    `${args.winnerName} beat ${args.loserName} ${args.finalScoreFromWinnerPerspective}.`,
  );
  if (args.gameFlow.closingNote) {
    candidates.push(args.gameFlow.closingNote);
  }
  if (args.throughThreeQuarters) {
    candidates.push(
      buildThroughThreeQuartersSentenceFromState(
        args.throughThreeQuarters,
        args.homeTeamName,
        args.awayTeamName,
      ),
    );
  }

  return uniqueRecapLines(candidates).slice(0, 5);
}

function buildFactsLibraryHeadlineCandidates(args: {
  finalScoreFromWinnerPerspective: string;
  gameFlow: GameDayRecapFactsLibraryGameFlow;
  loserName: string;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  seriesContext: GameDayRecapSeriesContext | null;
  winnerName: string;
  winnerSide: "away" | "home";
}): string[] {
  const candidates: string[] = [];
  const seriesGameNumber = args.seriesContext
    ? args.seriesContext.postgameWins.away +
      args.seriesContext.postgameWins.home
    : null;
  const winnerSeriesWins =
    args.seriesContext?.summaryLine === "The series is tied 1-1."
      ? 1
      : Math.max(
          args.seriesContext?.postgameWins.away ?? 0,
          args.seriesContext?.postgameWins.home ?? 0,
        );
  const loserSeriesWins = Math.min(
    args.seriesContext?.postgameWins.away ?? 0,
    args.seriesContext?.postgameWins.home ?? 0,
  );

  if (args.seriesContext) {
    if (args.seriesContext.isTerminal) {
      candidates.push(
        `${args.winnerName} wins series ${winnerSeriesWins}-${loserSeriesWins}`,
      );
    } else if (args.seriesContext.summaryLine === "The series is tied 1-1.") {
      candidates.push(`${args.winnerName} evens series 1-1`);
    } else if (seriesGameNumber === 1) {
      candidates.push(`${args.winnerName} takes Game 1, leads series 1-0`);
    } else if (seriesGameNumber) {
      candidates.push(`${args.winnerName} takes Game ${seriesGameNumber}`);
    }
  }

  if (args.playByPlayFacts?.endingFacts.decisiveScore?.isBuzzerBeater) {
    candidates.push(`${args.winnerName} wins on buzzerbeater`);
  }
  if (
    args.playByPlayFacts?.leadChangeFacts.bigComebackLeadChange
      ?.scoringTeamSide === args.winnerSide
  ) {
    candidates.push(
      `${args.winnerName} rallies from ${args.playByPlayFacts.leadChangeFacts.bigComebackLeadChange.deficitErased} down`,
    );
  } else if (args.playByPlayFacts?.leadChangeFacts.rapidLeadChangeBurst) {
    candidates.push(
      `${args.winnerName} survives ${args.playByPlayFacts.leadChangeFacts.rapidLeadChangeBurst.leadChangeCount}-swap finish`,
    );
  } else if (
    args.playByPlayFacts?.leadChangeFacts.highVolumeLeadChangeGame.qualifies
  ) {
    candidates.push(
      `${args.winnerName} wins ${args.playByPlayFacts.leadChangeFacts.highVolumeLeadChangeGame.leadChangeCount}-lead-change battle`,
    );
  }
  candidates.push(
    `${args.winnerName} beats ${args.loserName} ${args.finalScoreFromWinnerPerspective}`,
  );
  const winnerRun =
    args.playByPlayFacts?.primaryRun?.teamSide === args.winnerSide
      ? args.playByPlayFacts.primaryRun
      : args.playByPlayFacts?.secondaryRun?.teamSide === args.winnerSide
        ? args.playByPlayFacts.secondaryRun
        : args.playByPlayFacts?.longestUnansweredRun.teamSide ===
            args.winnerSide
          ? args.playByPlayFacts.longestUnansweredRun
          : args.playByPlayFacts?.bestCompetitiveSwingRun.teamSide ===
              args.winnerSide
            ? args.playByPlayFacts.bestCompetitiveSwingRun
            : null;
  if (winnerRun) {
    candidates.push(
      `${args.winnerName} uses ${winnerRun.teamPoints}-${winnerRun.opponentPoints} run`,
    );
  }

  return uniqueRecapLines(candidates).slice(0, 4);
}

function buildThroughThreeQuartersSentenceFromState(
  state: GameDayRecapFactsLibraryPeriodState,
  homeTeamName: string,
  awayTeamName: string,
): string {
  if (state.homeScore === state.awayScore) {
    return `The game was tied ${state.homeScore}-${state.awayScore} through three quarters.`;
  }

  const homeLed = state.homeScore > state.awayScore;
  const leaderName = homeLed ? homeTeamName : awayTeamName;
  const trailerName = homeLed ? awayTeamName : homeTeamName;

  return `${leaderName} led ${trailerName} ${state.scoreFromLeaderPerspective} through three quarters.`;
}

function uniqueRecapLines(lines: string[]): string[] {
  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
}

type CompletedBestOfThreeSeriesMatch = {
  awayTeamId: string;
  awayTeamName: string;
  homeTeamId: string;
  homeTeamName: string;
  matchId: string;
  startTime: string | null;
  winnerTeamId: string;
};

type SeriesMatchCollection = {
  currentMatchResolved: boolean;
  matches: CompletedBestOfThreeSeriesMatch[];
};

function resolvePlayoffSeriesContext(args: {
  awaySchedule?: BBApiSchedule | null;
  boxScore: BBApiBoxScore;
  homeSchedule?: BBApiSchedule | null;
  requestedGame: SlateGame;
  standings?: Pick<BBApiStandings, "brackets"> | null;
}): GameDayRecapSeriesContext | null {
  const stageKey = resolveBestOfThreePlayoffStageKey(
    args.boxScore.type ?? args.requestedGame.type,
  );
  if (!stageKey) {
    return null;
  }

  const currentMatch = toCompletedBestOfThreeSeriesMatchFromBoxScore({
    boxScore: args.boxScore,
    requestedGame: args.requestedGame,
    stageKey,
  });
  if (!currentMatch) {
    return null;
  }

  const pairKey = buildSeriesPairKey(
    currentMatch.homeTeamId,
    currentMatch.awayTeamId,
  );
  if (!pairKey) {
    return null;
  }
  const bracketMatches = collectBestOfThreeSeriesMatchesFromBrackets({
    currentMatchId: currentMatch.matchId,
    pairKey,
    stageKey,
    standings: args.standings ?? null,
  });
  const seriesMatches = bracketMatches.currentMatchResolved
    ? bracketMatches.matches
    : collectBestOfThreeSeriesMatchesFromSchedules({
        awaySchedule: args.awaySchedule ?? null,
        currentMatch,
        homeSchedule: args.homeSchedule ?? null,
        pairKey,
        stageKey,
      });

  return buildSeriesContextFromMatches({
    currentMatch,
    seriesMatches,
    stageKey,
  });
}

function resolveBestOfThreePlayoffStageKey(
  type: string | null | undefined,
): BestOfThreePlayoffStageKey | null {
  const competition = classifyCompetition(type);
  if (competition.competitionKey !== "PLAYOFFS") {
    return null;
  }

  return normalizeBestOfThreePlayoffStageKey(competition.stageKey);
}

function normalizeBestOfThreePlayoffStageKey(
  value: string | null | undefined,
): BestOfThreePlayoffStageKey | null {
  const normalized = value
    ?.replace(/[^a-z0-9]+/g, "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "final" || normalized === "finals") {
    return "finals";
  }
  if (normalized === "relegation" || normalized === "relegationseries") {
    return "relegation";
  }

  return null;
}

function toCompletedBestOfThreeSeriesMatchFromBoxScore(args: {
  boxScore: BBApiBoxScore;
  requestedGame: SlateGame;
  stageKey: BestOfThreePlayoffStageKey;
}): CompletedBestOfThreeSeriesMatch | null {
  if (
    resolveBestOfThreePlayoffStageKey(
      args.boxScore.type ?? args.requestedGame.type,
    ) !== args.stageKey
  ) {
    return null;
  }

  const matchId =
    args.boxScore.matchId?.trim() ?? args.requestedGame.matchId?.trim();
  const homeTeamId =
    args.boxScore.homeTeam.id?.trim() ?? args.requestedGame.homeTeamId.trim();
  const awayTeamId =
    args.boxScore.awayTeam.id?.trim() ?? args.requestedGame.awayTeamId.trim();
  const homeScore = args.boxScore.homeTeam.score;
  const awayScore = args.boxScore.awayTeam.score;

  if (
    !matchId ||
    !homeTeamId ||
    !awayTeamId ||
    homeScore === null ||
    awayScore === null ||
    homeScore === awayScore
  ) {
    return null;
  }

  return {
    awayTeamId,
    awayTeamName:
      args.boxScore.awayTeam.teamName ?? args.requestedGame.awayTeamName,
    homeTeamId,
    homeTeamName:
      args.boxScore.homeTeam.teamName ?? args.requestedGame.homeTeamName,
    matchId,
    startTime: args.boxScore.startTime ?? args.requestedGame.startTime,
    winnerTeamId: homeScore > awayScore ? homeTeamId : awayTeamId,
  };
}

function collectBestOfThreeSeriesMatchesFromBrackets(args: {
  currentMatchId: string;
  pairKey: string;
  stageKey: BestOfThreePlayoffStageKey;
  standings: Pick<BBApiStandings, "brackets"> | null;
}): SeriesMatchCollection {
  const matchesById = new Map<string, CompletedBestOfThreeSeriesMatch>();
  let currentMatchResolved = false;

  for (const round of args.standings?.brackets ?? []) {
    const roundStageKey = normalizeBestOfThreePlayoffStageKey(round.name);
    for (const match of round.matches ?? []) {
      const matchStageKey =
        roundStageKey ??
        resolveBestOfThreePlayoffStageKey(match.type ?? round.name);
      if (matchStageKey !== args.stageKey) {
        continue;
      }

      const currentBracketMatchId = match.id?.trim();
      const pairMatchKey = buildSeriesPairKey(
        match.homeTeam.id,
        match.awayTeam.id,
      );
      if (pairMatchKey !== args.pairKey) {
        continue;
      }

      const seriesMatch = toCompletedBestOfThreeSeriesMatchFromScheduleMatch({
        match,
        stageKey: args.stageKey,
      });
      if (seriesMatch) {
        matchesById.set(seriesMatch.matchId, seriesMatch);
      }
      if (
        currentBracketMatchId &&
        currentBracketMatchId === args.currentMatchId &&
        seriesMatch
      ) {
        currentMatchResolved = true;
      }
    }
  }

  return {
    currentMatchResolved,
    matches: sortBestOfThreeSeriesMatches(Array.from(matchesById.values())),
  };
}

function collectBestOfThreeSeriesMatchesFromSchedules(args: {
  awaySchedule: BBApiSchedule | null;
  currentMatch: CompletedBestOfThreeSeriesMatch;
  homeSchedule: BBApiSchedule | null;
  pairKey: string;
  stageKey: BestOfThreePlayoffStageKey;
}): CompletedBestOfThreeSeriesMatch[] {
  const matchesById = new Map<string, CompletedBestOfThreeSeriesMatch>();
  let foundSeriesScheduleEntry = false;

  for (const schedule of [args.homeSchedule, args.awaySchedule]) {
    for (const match of schedule?.matches ?? []) {
      if (
        buildSeriesPairKey(match.homeTeam.id, match.awayTeam.id) !==
        args.pairKey
      ) {
        continue;
      }
      if (resolveBestOfThreePlayoffStageKey(match.type) !== args.stageKey) {
        continue;
      }
      foundSeriesScheduleEntry = true;

      const seriesMatch = toCompletedBestOfThreeSeriesMatchFromScheduleMatch({
        match,
        stageKey: args.stageKey,
      });
      if (!seriesMatch) {
        continue;
      }

      matchesById.set(seriesMatch.matchId, seriesMatch);
    }
  }

  if (!foundSeriesScheduleEntry) {
    return [];
  }

  matchesById.set(args.currentMatch.matchId, args.currentMatch);
  return sortBestOfThreeSeriesMatches(Array.from(matchesById.values()));
}

function toCompletedBestOfThreeSeriesMatchFromScheduleMatch(args: {
  match: BBApiScheduleMatch;
  stageKey: BestOfThreePlayoffStageKey;
}): CompletedBestOfThreeSeriesMatch | null {
  if (resolveBestOfThreePlayoffStageKey(args.match.type) !== args.stageKey) {
    return null;
  }

  const matchId = args.match.id?.trim();
  const homeTeamId = args.match.homeTeam.id?.trim();
  const awayTeamId = args.match.awayTeam.id?.trim();
  const homeScore = args.match.homeTeam.score;
  const awayScore = args.match.awayTeam.score;

  if (
    !matchId ||
    !homeTeamId ||
    !awayTeamId ||
    homeScore === null ||
    awayScore === null ||
    homeScore === awayScore
  ) {
    return null;
  }

  return {
    awayTeamId,
    awayTeamName: args.match.awayTeam.teamName ?? "Away team",
    homeTeamId,
    homeTeamName: args.match.homeTeam.teamName ?? "Home team",
    matchId,
    startTime: args.match.startTime,
    winnerTeamId: homeScore > awayScore ? homeTeamId : awayTeamId,
  };
}

function sortBestOfThreeSeriesMatches(
  matches: CompletedBestOfThreeSeriesMatch[],
): CompletedBestOfThreeSeriesMatch[] {
  return [...matches].sort((left, right) => {
    const timeComparison = compareTimestamps(left.startTime, right.startTime);
    if (timeComparison !== 0) {
      return timeComparison;
    }

    return left.matchId.localeCompare(right.matchId);
  });
}

function buildSeriesContextFromMatches(args: {
  currentMatch: CompletedBestOfThreeSeriesMatch;
  seriesMatches: CompletedBestOfThreeSeriesMatch[];
  stageKey: BestOfThreePlayoffStageKey;
}): GameDayRecapSeriesContext | null {
  const currentMatchIndex = args.seriesMatches.findIndex(
    (match) => match.matchId === args.currentMatch.matchId,
  );
  if (currentMatchIndex < 0) {
    return null;
  }

  const matchesThroughCurrent = args.seriesMatches.slice(
    0,
    currentMatchIndex + 1,
  );
  if (matchesThroughCurrent.length < 1 || matchesThroughCurrent.length > 3) {
    return null;
  }

  const homeWins = matchesThroughCurrent.filter(
    (match) => match.winnerTeamId === args.currentMatch.homeTeamId,
  ).length;
  const awayWins = matchesThroughCurrent.filter(
    (match) => match.winnerTeamId === args.currentMatch.awayTeamId,
  ).length;
  const leadingWins = Math.max(homeWins, awayWins);
  const trailingWins = Math.min(homeWins, awayWins);

  let summaryLine: string | null = null;
  let isTerminal = false;

  if (
    matchesThroughCurrent.length === 1 &&
    leadingWins === 1 &&
    trailingWins === 0
  ) {
    summaryLine = `${
      homeWins > awayWins
        ? args.currentMatch.homeTeamName
        : args.currentMatch.awayTeamName
    } leads the series 1-0.`;
  } else if (homeWins === 1 && awayWins === 1) {
    summaryLine = "The series is tied 1-1.";
  } else if (
    leadingWins === 2 &&
    (trailingWins === 0 || trailingWins === 1) &&
    matchesThroughCurrent.length === leadingWins + trailingWins
  ) {
    summaryLine = `${
      homeWins > awayWins
        ? args.currentMatch.homeTeamName
        : args.currentMatch.awayTeamName
    } wins the series ${leadingWins}-${trailingWins}.`;
    isTerminal = true;
  }

  if (!summaryLine) {
    return null;
  }

  return {
    isTerminal,
    postgameWins: {
      away: awayWins,
      home: homeWins,
    },
    stageKey: args.stageKey,
    summaryLine,
  };
}

function buildSeriesPairKey(
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
): string | null {
  const homeId = homeTeamId?.trim();
  const awayId = awayTeamId?.trim();
  if (!homeId || !awayId) {
    return null;
  }

  return [homeId, awayId].sort().join("#");
}

function describeEffortDeltaForRecap(args: {
  awayTeamName: string | null | undefined;
  effortDelta: number | null | undefined;
  homeTeamName: string | null | undefined;
}): string | null {
  const effortDelta = asOptionalNumber(args.effortDelta);
  if (effortDelta === null || effortDelta === 0) {
    return null;
  }

  const homeTeamName = args.homeTeamName?.trim() || "The home team";
  const awayTeamName = args.awayTeamName?.trim() || "the away team";
  const strongerTeamName = effortDelta > 0 ? homeTeamName : awayTeamName;
  const weakerTeamName = effortDelta > 0 ? awayTeamName : homeTeamName;
  const effortDegree =
    Math.abs(effortDelta) >= 2
      ? "held the clear effort edge"
      : "held the effort edge";

  return `${strongerTeamName} ${effortDegree} over ${weakerTeamName}.`;
}

type GameDayPrepRecapAspect = "focus" | "pace";
type GameDayPrepRecapOutcomeKind = "hit" | "miss";
type GameDayPrepRecapOutcome = {
  aspect: GameDayPrepRecapAspect;
  kind: GameDayPrepRecapOutcomeKind;
  opponentName: string;
  opponentOffStrategy: string | null;
  target: string;
  teamName: string;
};

function buildGameDayPrepSummariesForRecap(args: {
  awayTeam: BBApiBoxScoreTeam;
  homeTeam: BBApiBoxScoreTeam;
}): string[] {
  const homeTeamName = args.homeTeam.teamName?.trim() || "The home team";
  const awayTeamName = args.awayTeam.teamName?.trim() || "The away team";
  const homeFocus = parseGameDayPrepOutcome({
    aspect: "focus",
    opponentName: awayTeamName,
    opponentOffStrategy: args.awayTeam.offStrategy,
    teamName: homeTeamName,
    value: args.homeTeam.gdp.focus,
  });
  const awayFocus = parseGameDayPrepOutcome({
    aspect: "focus",
    opponentName: homeTeamName,
    opponentOffStrategy: args.homeTeam.offStrategy,
    teamName: awayTeamName,
    value: args.awayTeam.gdp.focus,
  });
  const homePace = parseGameDayPrepOutcome({
    aspect: "pace",
    opponentName: awayTeamName,
    opponentOffStrategy: args.awayTeam.offStrategy,
    teamName: homeTeamName,
    value: args.homeTeam.gdp.pace,
  });
  const awayPace = parseGameDayPrepOutcome({
    aspect: "pace",
    opponentName: homeTeamName,
    opponentOffStrategy: args.homeTeam.offStrategy,
    teamName: awayTeamName,
    value: args.awayTeam.gdp.pace,
  });

  return [
    describeGameDayPrepOutcomesForRecap(
      [homeFocus, awayFocus].filter(
        (outcome): outcome is GameDayPrepRecapOutcome => Boolean(outcome),
      ),
    ),
    describeGameDayPrepOutcomesForRecap(
      [homePace, awayPace].filter(
        (outcome): outcome is GameDayPrepRecapOutcome => Boolean(outcome),
      ),
    ),
  ].filter((summary): summary is string => Boolean(summary));
}

function parseGameDayPrepOutcome(args: {
  aspect: GameDayPrepRecapAspect;
  opponentName: string;
  opponentOffStrategy: string | null | undefined;
  teamName: string;
  value: number | string | null | undefined;
}): GameDayPrepRecapOutcome | null {
  const rawValue = asOptionalString(args.value)?.trim();
  if (!rawValue || rawValue.toLowerCase() === "n/a" || rawValue === "--") {
    return null;
  }

  const [rawTarget, rawKind] = rawValue.split(".");
  const kind = rawKind?.toLowerCase();
  if (kind !== "hit" && kind !== "miss") {
    return null;
  }

  const target =
    args.aspect === "focus"
      ? normalizeGameDayPrepFocusTarget(rawTarget)
      : normalizeGameDayPrepPaceTarget(rawTarget);
  if (!target) {
    return null;
  }

  return {
    aspect: args.aspect,
    kind,
    opponentName: args.opponentName,
    opponentOffStrategy: args.opponentOffStrategy?.trim() || null,
    target,
    teamName: args.teamName,
  };
}

function normalizeGameDayPrepFocusTarget(
  value: string | null | undefined,
): string | null {
  switch (value?.trim().toLowerCase()) {
    case "outside":
      return "Outside";
    case "inside":
      return "Inside";
    case "balanced":
      return "Balanced";
    case undefined:
    default:
      return null;
  }
}

function normalizeGameDayPrepPaceTarget(
  value: string | null | undefined,
): string | null {
  switch (value?.trim().toLowerCase()) {
    case "fast":
      return "Fast";
    case "normal":
      return "Normal";
    case "slow":
      return "Slow";
    case undefined:
    default:
      return null;
  }
}

function describeGameDayPrepOutcomesForRecap(
  outcomes: GameDayPrepRecapOutcome[],
): string | null {
  if (outcomes.length === 0) {
    return null;
  }

  const firstOutcome = outcomes[0];
  const secondOutcome = outcomes[1];
  if (
    firstOutcome &&
    secondOutcome &&
    outcomes.length === 2 &&
    firstOutcome.kind === secondOutcome.kind &&
    firstOutcome.target === secondOutcome.target &&
    (firstOutcome.aspect === "focus" || firstOutcome.kind === "hit")
  ) {
    return ensureSentence(
      firstOutcome.aspect === "focus"
        ? describeSharedGameDayPrepFocusOutcome(firstOutcome)
        : describeSharedGameDayPrepPaceOutcome(firstOutcome),
    );
  }

  const body = outcomes.map(describeSingleGameDayPrepOutcome).join("; ");
  return ensureSentence(
    outcomes[0]?.aspect === "pace" ? `On pace, ${body}` : body,
  );
}

function describeSharedGameDayPrepFocusOutcome(
  outcome: GameDayPrepRecapOutcome,
): string {
  return outcome.kind === "hit"
    ? `Both teams prepared well for ${formatGameDayPrepFocusTarget(outcome.target)}`
    : `Both teams missed on the ${outcome.target} focus read`;
}

function describeSharedGameDayPrepPaceOutcome(
  outcome: GameDayPrepRecapOutcome,
): string {
  return outcome.kind === "hit"
    ? `On pace, both teams prepared well for ${outcome.target} pace`
    : `On pace, both teams missed on the ${outcome.target} pace read`;
}

function describeSingleGameDayPrepOutcome(
  outcome: GameDayPrepRecapOutcome,
): string {
  if (outcome.aspect === "focus") {
    return outcome.kind === "hit"
      ? `${outcome.teamName} prepared well for ${formatGameDayPrepFocusTarget(
          outcome.target,
        )}`
      : `${outcome.teamName} missed on the ${outcome.target} focus read`;
  }

  if (outcome.kind === "hit") {
    return `${outcome.teamName} prepared well for ${outcome.target} pace`;
  }

  if (!outcome.opponentOffStrategy) {
    return `${outcome.teamName} prepared for ${outcome.target} pace, but the pace read missed`;
  }

  return `${outcome.teamName} prepared for ${outcome.target} pace, but ${outcome.opponentName} played ${outcome.opponentOffStrategy}`;
}

function formatGameDayPrepFocusTarget(target: string): string {
  return target === "Balanced" ? "a Balanced attack" : `${target} looks`;
}

function describeGameDayPrepFocusForRecap(args: {
  focus: number | string | null | undefined;
  teamName: string | null | undefined;
}): string | null {
  const teamName = args.teamName?.trim() || "That team";
  const outcome = parseGameDayPrepOutcome({
    aspect: "focus",
    opponentName: "the opponent",
    opponentOffStrategy: null,
    teamName,
    value: args.focus,
  });
  return outcome
    ? ensureSentence(describeSingleGameDayPrepOutcome(outcome))
    : null;
}

function buildRequiredContextSentencesForRecap(args: {
  effortSummary: string | null;
  gameDayPrepSummaries: string[];
}): string[] {
  const required: string[] = [];
  const effortSummary = args.effortSummary?.trim() || null;
  const prepSummaries = args.gameDayPrepSummaries
    .map((summary) => summary.trim())
    .filter(Boolean);

  if (effortSummary) {
    required.push(effortSummary);
  }

  required.push(...prepSummaries.map(ensureSentence));

  return required;
}

function ensureSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function ensureQuestion(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  return `${trimmed.replace(/[.!?]+$/, "")}?`;
}

function analyzeRotationContextForRecap(
  team: BBApiBoxScoreTeam,
): RotationContextForRecap {
  const summaries: string[] = [];
  const importantPlayerIds = new Set(
    [...team.players]
      .filter((player) => player.ratingValue !== null)
      .sort(
        (left, right) =>
          (right.ratingValue ?? -Infinity) - (left.ratingValue ?? -Infinity),
      )
      .slice(0, 2)
      .map((player) => player.id)
      .filter((playerId): playerId is string => Boolean(playerId)),
  );
  const keyAbsences = team.players
    .filter(
      (player) =>
        player.didNotPlay &&
        player.id !== null &&
        importantPlayerIds.has(player.id),
    )
    .sort(
      (left, right) =>
        (right.ratingValue ?? -Infinity) - (left.ratingValue ?? -Infinity),
    )
    .slice(0, 2);
  if (keyAbsences.length === 1) {
    summaries.push(
      `${team.teamName ?? "That team"} came in without ${keyAbsences[0]!.fullName}, leaving them short-handed.`,
    );
  } else if (keyAbsences.length > 1) {
    summaries.push(
      `${team.teamName ?? "That team"} came in without ${joinRecapNames(
        keyAbsences.map((player) => player.fullName),
      )}, leaving them especially short-handed.`,
    );
  }

  const foulTroubleCandidate =
    [...team.players]
      .filter(
        (player) =>
          !player.didNotPlay &&
          player.id !== null &&
          importantPlayerIds.has(player.id) &&
          playerTotalMinutes(player) > 0 &&
          wasPlayerLimitedByFoulTrouble(player),
      )
      .sort((left, right) => {
        const foulGap =
          asNumberFromUnknown(right.performanceStats?.pf) -
          asNumberFromUnknown(left.performanceStats?.pf);
        if (foulGap !== 0) {
          return foulGap;
        }
        return playerTotalMinutes(left) - playerTotalMinutes(right);
      })[0] ?? null;
  if (foulTroubleCandidate) {
    summaries.push(
      `${foulTroubleCandidate.fullName} spent much of the night in foul trouble and played only ${formatMinutesForRecap(
        playerTotalMinutes(foulTroubleCandidate),
      )} minutes.`,
    );
  }

  return {
    foulTroubleLimitationCount: foulTroubleCandidate ? 1 : 0,
    keyAbsenceCount: keyAbsences.length,
    summaries,
  };
}

function buildRotationSummariesForRecap(team: BBApiBoxScoreTeam): string[] {
  return analyzeRotationContextForRecap(team).summaries;
}

function buildNeutralTeamSeasonContext(
  team: BBApiBoxScoreTeam,
): TeamSeasonContext {
  return {
    conferenceIndex: 0,
    conferencePosition: 0,
    currentStreak: "Unknown",
    lastFive: "Unknown",
    losses: 0,
    recentAverageMargin: null,
    recentBoxScoreCoverage: 0,
    recentMargins: [],
    recentSignalFlags: [],
    teamId: team.id ?? "unknown",
    teamName: team.teamName ?? "Team",
    wins: 0,
  };
}

function toSlateGameFromBoxScore(boxScore: BBApiBoxScore): SlateGame {
  return {
    awayTeamId: boxScore.awayTeam.id ?? "unknown-away",
    awayTeamName: boxScore.awayTeam.teamName ?? "Away team",
    isScheduleFinal:
      boxScore.homeTeam.score !== null && boxScore.awayTeam.score !== null,
    homeTeamId: boxScore.homeTeam.id ?? "unknown-home",
    homeTeamName: boxScore.homeTeam.teamName ?? "Home team",
    matchId: boxScore.matchId ?? "unknown-match",
    scheduledAwayScore: boxScore.awayTeam.score,
    scheduledHomeScore: boxScore.homeTeam.score,
    startTime: boxScore.startTime,
    type: boxScore.type,
  };
}

function buildPromptTeam(args: {
  enteringGameContext: TeamSeasonContext;
  hasHistoricalContext: boolean;
  postgameContext: TeamSeasonContext;
  rotationContext: RotationContextForRecap;
  team: BBApiBoxScoreTeam;
}): GameDayRecapPromptTeam {
  const teamContextFields = args.hasHistoricalContext
    ? {
        lastFive: args.postgameContext.lastFive,
        lastFiveEnteringGame: args.enteringGameContext.lastFive,
        record: formatTeamRecord(args.postgameContext),
        recordEnteringGame: formatTeamRecord(args.enteringGameContext),
        streak: args.postgameContext.currentStreak,
        streakEnteringGame: args.enteringGameContext.currentStreak,
      }
    : {
        lastFive: null,
        lastFiveEnteringGame: null,
        record: null,
        recordEnteringGame: null,
        streak: null,
        streakEnteringGame: null,
      };

  return {
    conferenceIndex: args.hasHistoricalContext
      ? args.postgameContext.conferenceIndex + 1
      : null,
    conferencePosition: args.hasHistoricalContext
      ? args.postgameContext.conferencePosition
      : null,
    defStrategy: args.team.defStrategy,
    efficiency: compactScalarRecord(args.team.efficiency),
    foulTroubleLimitationCount: args.rotationContext.foulTroubleLimitationCount,
    gdp: compactScalarRecord(args.team.gdp),
    keyAbsenceCount: args.rotationContext.keyAbsenceCount,
    ...teamContextFields,
    name: args.postgameContext.teamName,
    offStrategy: args.team.offStrategy,
    ratingLabels: formatTeamRatingsForRecap(args.team.ratings),
    ratingTotal: sumTeamRatingsForRecap(args.team.ratings),
    ratingValues: compactTeamRatingValuesForRecap(args.team.ratings),
    recentAverageMargin: args.hasHistoricalContext
      ? args.postgameContext.recentAverageMargin
      : null,
    recentSignalFlags: args.hasHistoricalContext
      ? args.postgameContext.recentSignalFlags
      : [],
    score: args.team.score ?? 0,
    turnovers: resolveTeamTurnoversForRecap(args.team),
    topPlayers: extractTopPlayers(args.team.players),
  };
}

function resolveTeamTurnoversForRecap(team: BBApiBoxScoreTeam): number | null {
  const totalTurnovers =
    team.teamTotals.to ?? team.teamTotals.turnovers ?? team.teamTotals.turnover;
  if (typeof totalTurnovers === "number" && Number.isFinite(totalTurnovers)) {
    return totalTurnovers;
  }

  let hasPlayerTurnovers = false;
  const playerTurnovers = team.players.reduce((sum, player) => {
    const turnovers = player.performanceStats?.to;
    if (typeof turnovers !== "number" || !Number.isFinite(turnovers)) {
      return sum;
    }

    hasPlayerTurnovers = true;
    return sum + turnovers;
  }, 0);

  return hasPlayerTurnovers ? playerTurnovers : null;
}

function buildEvidenceSignals(args: {
  awayContext: TeamSeasonContext;
  boxScore: BBApiBoxScore;
  homeContext: TeamSeasonContext;
  isPlayoffGame: boolean;
  playByPlayFacts: GameDayRecapPlayByPlayFacts | null;
  quarterFacts: GameDayRecapPromptQuarterFacts;
}): string[] {
  const signals = new Set<string>();
  const finalMargin = Math.abs(
    (args.boxScore.homeTeam.score ?? 0) - (args.boxScore.awayTeam.score ?? 0),
  );

  if (finalMargin <= 5) {
    signals.add("close_finish");
  }
  if (finalMargin <= 3) {
    signals.add("one_possession_finish");
  }
  if (finalMargin >= 18) {
    signals.add("blowout");
  }
  const gameScoringContext = resolveGameScoringContext({
    awayScore: args.boxScore.awayTeam.score ?? 0,
    homeScore: args.boxScore.homeTeam.score ?? 0,
  });
  if (gameScoringContext) {
    signals.add(gameScoringContext);
  }
  if (Math.abs(args.boxScore.effortDelta ?? 0) >= 2) {
    signals.add("effort_gap");
  }
  if (
    args.homeContext.recentSignalFlags.includes(
      "possible_strategic_deemphasis",
    ) ||
    args.awayContext.recentSignalFlags.includes("possible_strategic_deemphasis")
  ) {
    signals.add("possible_strategic_deemphasis");
  }
  if (!args.isPlayoffGame) {
    if (
      args.homeContext.currentStreak.startsWith("W") ||
      args.awayContext.currentStreak.startsWith("W")
    ) {
      signals.add("winning_streak_context");
    }
    if (
      args.homeContext.currentStreak.startsWith("L") ||
      args.awayContext.currentStreak.startsWith("L")
    ) {
      signals.add("losing_streak_context");
    }
  }

  if (args.quarterFacts.decisiveQuarter) {
    signals.add("decisive_quarter_run");
  }
  if ((args.playByPlayFacts?.lateGameMoments.length ?? 0) > 0) {
    signals.add("late_game_swing");
  }
  if (
    args.playByPlayFacts?.leadChangeFacts.rapidLeadChangeBurst ||
    args.playByPlayFacts?.leadChangeFacts.highVolumeLeadChangeGame.qualifies
  ) {
    signals.add("back_and_forth");
  }
  if (args.playByPlayFacts?.endingFacts.decisiveScore?.isBuzzerBeater) {
    signals.add("buzzerbeater");
  }
  if (
    (args.playByPlayFacts?.winnerComebackDeficit ?? 0) >=
    COMEBACK_SUMMARY_THRESHOLD
  ) {
    signals.add("comeback");
  }

  return Array.from(signals);
}

function resolveGameScoringContext(args: {
  awayScore: number;
  homeScore: number;
}): "high_scoring_shootout" | "low_scoring_grind" | null {
  if (args.awayScore > 100 && args.homeScore > 100) {
    return "high_scoring_shootout";
  }
  if (args.awayScore < 80 && args.homeScore < 80) {
    return "low_scoring_grind";
  }

  return null;
}

function buildStandingsContext(args: {
  awayContext: TeamSeasonContext;
  homeContext: TeamSeasonContext;
}): string[] {
  const context: string[] = [];
  context.push(
    `${args.homeContext.teamName} was ${ordinal(args.homeContext.conferencePosition)} in conference ${args.homeContext.conferenceIndex + 1} entering the game.`,
  );
  context.push(
    `${args.awayContext.teamName} was ${ordinal(args.awayContext.conferencePosition)} in conference ${args.awayContext.conferenceIndex + 1} entering the game.`,
  );

  const standingGap = Math.abs(
    args.homeContext.conferencePosition - args.awayContext.conferencePosition,
  );
  if (standingGap <= 2) {
    context.push(
      "The matchup was between clubs occupying nearby conference positions.",
    );
  }

  return context;
}

async function loadBoxScore(
  bb: Pick<BBXmlApiClient, "getBoxScore">,
  cache: Map<string, Promise<BoxScoreLoadResult>>,
  matchId: string,
): Promise<BoxScoreLoadResult> {
  const existing = cache.get(matchId);
  if (existing) {
    return existing;
  }

  const pending = bb
    .getBoxScore(matchId)
    .then((boxScore) =>
      hasCompleteBoxScore(boxScore)
        ? ({
            boxScore,
            kind: "ok",
          } satisfies BoxScoreLoadResult)
        : ({
            boxScore,
            kind: "incomplete_boxscore",
          } satisfies BoxScoreLoadResult),
    )
    .catch((error) =>
      error instanceof BBXmlApiParseError
        ? ({
            error: toBoxScoreLoadErrorDetails(error),
            kind: "parse_failed",
          } satisfies BoxScoreLoadResult)
        : ({
            error: toBoxScoreLoadErrorDetails(error),
            kind: "api_fetch_failed",
          } satisfies BoxScoreLoadResult),
    );
  cache.set(matchId, pending);
  return pending;
}

async function loadPromptGamePlayByPlay(args: {
  awayTeamName: string;
  cache: Map<string, Promise<GameDayRecapPlayByPlayLoadResult>>;
  fetchPublicMatchPlayByPlay: PublicPlayByPlayFetcher;
  homeTeamName: string;
  matchId: string;
}): Promise<GameDayRecapPlayByPlayLoadResult> {
  const existing = args.cache.get(args.matchId);
  if (existing) {
    return existing;
  }

  const pending = loadGameDayRecapPlayByPlayFacts({
    awayTeamName: args.awayTeamName,
    fetchPublicMatchPlayByPlay: args.fetchPublicMatchPlayByPlay,
    homeTeamName: args.homeTeamName,
    matchId: args.matchId,
  });
  args.cache.set(args.matchId, pending);
  return pending;
}

async function loadRecentCompletedBoxScores(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore">;
  boxScoreCache: Map<string, Promise<BoxScoreLoadResult>>;
  gameStartTime: string | null;
  includeMatch?: ScheduleMatchInclusionPredicate;
  limit: number;
  schedule: BBApiSchedule;
}): Promise<BBApiBoxScore[]> {
  const recentMatches = listCompletedMatchesBefore(
    args.schedule,
    args.gameStartTime,
    args.includeMatch,
  )
    .slice(0, args.limit)
    .map((match) => match.id)
    .filter((matchId): matchId is string => Boolean(matchId));

  const loaded = await Promise.all(
    recentMatches.map((matchId) =>
      loadBoxScore(args.bb, args.boxScoreCache, matchId),
    ),
  );

  return loaded.flatMap((result) =>
    result.kind === "ok" ? [result.boxScore] : [],
  );
}

function hasCompleteBoxScore(boxScore: BBApiBoxScore): boolean {
  return boxScore.homeTeam.score !== null && boxScore.awayTeam.score !== null;
}

function toBoxScoreLoadErrorDetails(error: unknown): BoxScoreLoadErrorDetails {
  const loggable = toLoggableError(error);
  const bodyPreview =
    typeof loggable.bodyPreview === "string" ? loggable.bodyPreview : undefined;
  const endpoint =
    typeof loggable.endpoint === "string" ? loggable.endpoint : undefined;
  const errorMessage =
    typeof loggable.errorMessage === "string"
      ? loggable.errorMessage
      : String(error);
  const errorName =
    typeof loggable.errorName === "string" ? loggable.errorName : undefined;
  const status =
    typeof loggable.status === "number" ? loggable.status : undefined;

  const details: BoxScoreLoadErrorDetails = {
    errorMessage,
  };

  if (bodyPreview !== undefined) {
    details.bodyPreview = bodyPreview;
  }
  if (endpoint !== undefined) {
    details.endpoint = endpoint;
  }
  if (errorName !== undefined) {
    details.errorName = errorName;
  }
  if (status !== undefined) {
    details.status = status;
  }

  return details;
}

function isRequestedGameExpectedFinal(args: {
  now: Date;
  request: GameDayRecapPromptPayload["request"];
  requestedGame: SlateGame;
}): boolean {
  if (args.requestedGame.isScheduleFinal) {
    return true;
  }

  const timeZone = normalizeLeagueTimeZone(args.request.timeZone);
  if (!timeZone) {
    return false;
  }

  const currentLeagueDate = resolveCalendarDateKey(
    args.now.toISOString(),
    timeZone,
  );
  if (!currentLeagueDate) {
    return false;
  }

  if (args.request.kind === "LEAGUE_DATE" && args.request.gameDate) {
    return args.request.gameDate < currentLeagueDate;
  }

  const scheduledLeagueDate = resolveCalendarDateKey(
    args.requestedGame.startTime,
    timeZone,
  );
  return Boolean(
    scheduledLeagueDate && scheduledLeagueDate < currentLeagueDate,
  );
}

function isCoverageStrictForRequest(
  request: GameDayRecapPromptPayload["request"],
): boolean {
  return request.kind === "LEAGUE_DATE" || request.kind === "LEAGUE_GAME_DAY";
}

function formatTeamRatingsForRecap(
  ratings: BBApiBoxScoreTeam["ratings"],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ratings ?? {}).flatMap(([key, value]) => {
      if (!Number.isFinite(value)) {
        return [];
      }

      const label = formatBuzzerBeaterLabel({
        scale: "team_rating",
        value,
      });
      return [[key, label ?? String(roundToOneDecimal(value))]];
    }),
  );
}

function compactTeamRatingValuesForRecap(
  ratings: BBApiBoxScoreTeam["ratings"],
): Partial<Record<TeamRatingKey, number>> {
  return Object.fromEntries(
    TEAM_RATING_KEYS.flatMap((key) => {
      const value = ratings?.[key];
      return isFiniteRatingValue(value)
        ? [[key, roundToOneDecimal(value)]]
        : [];
    }),
  ) as Partial<Record<TeamRatingKey, number>>;
}

function sumTeamRatingsForRecap(
  ratings: BBApiBoxScoreTeam["ratings"],
): number | null {
  let total = 0;
  let hasRating = false;

  for (const key of TEAM_RATING_KEYS) {
    const value = ratings?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    total += value;
    hasRating = true;
  }

  return hasRating ? roundToOneDecimal(total) : null;
}

function summarizeCompletedRecord(
  matches: BBApiScheduleMatch[],
  teamId: string,
): { losses: number; wins: number } {
  return matches.reduce(
    (record, match) => {
      const margin = getMarginForTeam(match, teamId);
      if (margin === null) {
        return record;
      }

      if (margin >= 0) {
        record.wins += 1;
      } else {
        record.losses += 1;
      }
      return record;
    },
    { losses: 0, wins: 0 },
  );
}

function derivePostgameTeamSeasonContext(args: {
  boxScore: BBApiBoxScore;
  enteringGameContext: TeamSeasonContext;
  priorBoxScores: BBApiBoxScore[];
}): TeamSeasonContext {
  const currentMargin = getBoxScoreMarginForTeam(
    args.boxScore,
    args.enteringGameContext.teamId,
  );
  if (currentMargin === null) {
    return args.enteringGameContext;
  }

  const recentMargins = [
    currentMargin,
    ...args.enteringGameContext.recentMargins,
  ]
    .filter((margin): margin is number => Number.isFinite(margin))
    .slice(0, 5);
  const postgameBoxScores = [args.boxScore, ...args.priorBoxScores].slice(0, 3);
  const streakPrefix = currentMargin >= 0 ? "W" : "L";
  const priorPrefix =
    args.enteringGameContext.currentStreak.startsWith("W") ||
    args.enteringGameContext.currentStreak.startsWith("L")
      ? args.enteringGameContext.currentStreak[0]
      : null;
  const priorCount = parseInt(
    args.enteringGameContext.currentStreak.slice(1),
    10,
  );
  const streakCount =
    priorPrefix === streakPrefix && Number.isFinite(priorCount)
      ? priorCount + 1
      : 1;
  const currentStreak = `${streakPrefix}${streakCount}`;
  const recentAverageMargin = recentMargins.length
    ? roundToOneDecimal(
        recentMargins.reduce((sum, margin) => sum + margin, 0) /
          recentMargins.length,
      )
    : null;

  return {
    ...args.enteringGameContext,
    currentStreak,
    lastFive: formatLastFiveFromMargins(recentMargins),
    losses: args.enteringGameContext.losses + (currentMargin < 0 ? 1 : 0),
    recentAverageMargin,
    recentBoxScoreCoverage: postgameBoxScores.length,
    recentMargins,
    recentSignalFlags: buildRecentSignalFlags({
      boxScores: postgameBoxScores,
      recentAverageMargin,
      streak: currentStreak,
      teamId: args.enteringGameContext.teamId,
    }),
    wins: args.enteringGameContext.wins + (currentMargin >= 0 ? 1 : 0),
  };
}

function buildTeamSeasonContext(args: {
  boxScores: BBApiBoxScore[];
  gameStartTime: string | null;
  includeMatch?: ScheduleMatchInclusionPredicate;
  schedule: BBApiSchedule;
  standing: TeamStandingSummary;
}): TeamSeasonContext {
  const completedMatches = listCompletedMatchesBefore(
    args.schedule,
    args.gameStartTime,
    args.includeMatch,
  );
  const record = summarizeCompletedRecord(
    completedMatches,
    args.standing.teamId,
  );
  const recentMatches = completedMatches.slice(0, 5);
  const recentMargins = recentMatches
    .map((match) => getMarginForTeam(match, args.standing.teamId))
    .filter((margin): margin is number => margin !== null);
  const streak = formatCurrentStreak(completedMatches, args.standing.teamId);
  const recentAverageMargin = recentMargins.length
    ? roundToOneDecimal(
        recentMargins.reduce((sum, margin) => sum + margin, 0) /
          recentMargins.length,
      )
    : null;

  return {
    conferenceIndex: args.standing.conferenceIndex,
    conferencePosition: args.standing.conferencePosition,
    currentStreak: streak,
    lastFive: formatLastFive(recentMatches, args.standing.teamId),
    losses: record.losses,
    recentAverageMargin,
    recentBoxScoreCoverage: args.boxScores.length,
    recentMargins,
    recentSignalFlags: buildRecentSignalFlags({
      boxScores: args.boxScores,
      recentAverageMargin,
      streak,
      teamId: args.standing.teamId,
    }),
    teamId: args.standing.teamId,
    teamName: args.standing.teamName,
    wins: record.wins,
  };
}

function buildRecentSignalFlags(args: {
  boxScores: BBApiBoxScore[];
  recentAverageMargin: number | null;
  streak: string;
  teamId: string;
}): string[] {
  const recentSignalFlags = new Set<string>();

  if (countBlowoutLosses(args.boxScores, args.teamId) >= 2) {
    recentSignalFlags.add("possible_strategic_deemphasis");
  }
  if ((args.recentAverageMargin ?? 0) <= -10) {
    recentSignalFlags.add("recent_slide");
  }
  if (args.streak.startsWith("W") && parseInt(args.streak.slice(1), 10) >= 3) {
    recentSignalFlags.add("hot_streak");
  }
  if (args.streak.startsWith("L") && parseInt(args.streak.slice(1), 10) >= 3) {
    recentSignalFlags.add("cold_streak");
  }

  return Array.from(recentSignalFlags);
}

function countBlowoutLosses(
  boxScores: BBApiBoxScore[],
  teamId: string,
): number {
  return boxScores.filter((boxScore) => {
    const margin = getBoxScoreMarginForTeam(boxScore, teamId);
    return margin !== null && margin <= -15;
  }).length;
}

function formatLastFiveFromMargins(margins: number[]): string {
  if (!margins.length) {
    return "0-0";
  }

  let wins = 0;
  let losses = 0;
  for (const margin of margins) {
    if (margin >= 0) {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  return `${wins}-${losses}`;
}

function formatTeamRecord(context: TeamSeasonContext): string {
  return `${context.wins}-${context.losses}`;
}

function extractStandingTeams(
  standings: BBApiStandings,
): Map<string, TeamStandingSummary> {
  const index = new Map<string, TeamStandingSummary>();
  standings.conferences.forEach((conference) => {
    conference.teams.forEach((team, teamIndex) => {
      if (!team.id) {
        return;
      }

      index.set(team.id, {
        conferenceIndex: conference.index,
        conferencePosition: teamIndex + 1,
        losses: team.losses ?? 0,
        pointMargin: roundToOneDecimal(
          ((team.pf ?? 0) - (team.pa ?? 0)) /
            Math.max(1, (team.wins ?? 0) + (team.losses ?? 0)),
        ),
        teamId: team.id,
        teamName: team.teamName ?? `Team ${team.id}`,
        wins: team.wins ?? 0,
      });
    });
  });

  return index;
}

function listCompletedMatchesBefore(
  schedule: BBApiSchedule,
  gameStartTime: string | null,
  includeMatch?: ScheduleMatchInclusionPredicate,
): BBApiScheduleMatch[] {
  const cutoff = parseTimestamp(gameStartTime);
  return [...schedule.matches]
    .filter((match) =>
      Boolean(
        match.id &&
        (includeMatch ? includeMatch(match) : true) &&
        match.homeTeam.score !== null &&
        match.awayTeam.score !== null &&
        (!Number.isFinite(cutoff) || parseTimestamp(match.startTime) < cutoff),
      ),
    )
    .sort((left, right) => compareTimestamps(right.startTime, left.startTime));
}

function extractTopPlayers(
  players: BBApiBoxScorePlayer[],
): GameDayRecapPromptTeam["topPlayers"] {
  return [...players]
    .sort(
      (left, right) =>
        scorePlayerPerformance(right) - scorePlayerPerformance(left),
    )
    .slice(0, 3)
    .map((player) => {
      const performanceStats = player.performanceStats ?? {};
      return {
        assists: asNumberFromUnknown(performanceStats.ast),
        blocks: asNumberFromUnknown(performanceStats.blk),
        minutes: playerTotalMinutes(player),
        name: player.fullName,
        points: asNumberFromUnknown(performanceStats.pts),
        rebounds: asNumberFromUnknown(performanceStats.reb),
        steals: asNumberFromUnknown(performanceStats.stl),
        turnovers: asNumberFromUnknown(performanceStats.to),
      };
    });
}

function isRegularSeasonLeagueContextMatch(match: BBApiScheduleMatch): boolean {
  return (
    classifyCompetition(match.type).competitionKey === "LEAGUE_REGULAR_SEASON"
  );
}

function scorePlayerPerformance(player: BBApiBoxScorePlayer): number {
  const performanceStats = player.performanceStats ?? {};
  const points = asNumberFromUnknown(performanceStats.pts);
  const rebounds = asNumberFromUnknown(performanceStats.reb);
  const assists = asNumberFromUnknown(performanceStats.ast);
  const steals = asNumberFromUnknown(performanceStats.stl);
  const blocks = asNumberFromUnknown(performanceStats.blk);
  const turnovers = asNumberFromUnknown(performanceStats.to);

  return (
    points + rebounds * 0.7 + assists * 0.7 + steals + blocks - turnovers * 0.5
  );
}

function playerTotalMinutes(player: BBApiBoxScorePlayer): number {
  return Object.values(
    toOptionalRecord(player.minutesByPosition) ?? {},
  ).reduce<number>((sum, value) => sum + asNumberFromUnknown(value), 0);
}

function wasPlayerLimitedByFoulTrouble(player: BBApiBoxScorePlayer): boolean {
  const fouls = asNumberFromUnknown(player.performanceStats?.pf);
  const minutes = playerTotalMinutes(player);
  return (fouls >= 6 && minutes <= 34) || (fouls >= 5 && minutes <= 28);
}

function formatMinutesForRecap(minutes: number): number {
  return Math.max(1, Math.round(minutes));
}

function joinRecapNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function resolveBoxScoreTeam(
  boxScore: BBApiBoxScore,
  teamId: string,
): BBApiBoxScoreTeam | null {
  if (boxScore.homeTeam.id === teamId) {
    return boxScore.homeTeam;
  }
  if (boxScore.awayTeam.id === teamId) {
    return boxScore.awayTeam;
  }
  return null;
}

function getBoxScoreMarginForTeam(
  boxScore: BBApiBoxScore,
  teamId: string,
): number | null {
  const teamBoxScore = resolveBoxScoreTeam(boxScore, teamId);
  const opponentBoxScore = resolveOpponentBoxScoreTeam(boxScore, teamId);

  return teamBoxScore && opponentBoxScore
    ? (teamBoxScore.score ?? 0) - (opponentBoxScore.score ?? 0)
    : null;
}

function resolveOpponentBoxScoreTeam(
  boxScore: BBApiBoxScore,
  teamId: string,
): BBApiBoxScoreTeam | null {
  if (boxScore.homeTeam.id === teamId) {
    return boxScore.awayTeam;
  }
  if (boxScore.awayTeam.id === teamId) {
    return boxScore.homeTeam;
  }
  return null;
}

function getMarginForTeam(
  match: BBApiScheduleMatch,
  teamId: string,
): number | null {
  const side = resolveScheduleSide(match, teamId);
  const opponent = resolveOpponentScheduleSide(match, teamId);

  if (!side || !opponent || side.score === null || opponent.score === null) {
    return null;
  }

  return side.score - opponent.score;
}

function resolveScheduleSide(
  match: BBApiScheduleMatch,
  teamId: string,
): BBApiScheduleMatchSide | null {
  if (match.homeTeam.id === teamId) {
    return match.homeTeam;
  }
  if (match.awayTeam.id === teamId) {
    return match.awayTeam;
  }
  return null;
}

function resolveOpponentScheduleSide(
  match: BBApiScheduleMatch,
  teamId: string,
): BBApiScheduleMatchSide | null {
  if (match.homeTeam.id === teamId) {
    return match.awayTeam;
  }
  if (match.awayTeam.id === teamId) {
    return match.homeTeam;
  }
  return null;
}

function formatCurrentStreak(
  matches: BBApiScheduleMatch[],
  teamId: string,
): string {
  if (!matches.length) {
    return "No streak";
  }

  let streakLength = 0;
  let streakPrefix = "";

  for (const match of matches) {
    const margin = getMarginForTeam(match, teamId);
    if (margin === null) {
      continue;
    }

    const nextPrefix = margin >= 0 ? "W" : "L";
    if (!streakPrefix) {
      streakPrefix = nextPrefix;
    }
    if (streakPrefix !== nextPrefix) {
      break;
    }
    streakLength += 1;
  }

  return streakLength ? `${streakPrefix}${streakLength}` : "No streak";
}

function formatLastFive(matches: BBApiScheduleMatch[], teamId: string): string {
  if (!matches.length) {
    return "0-0";
  }

  let wins = 0;
  let losses = 0;
  for (const match of matches) {
    const margin = getMarginForTeam(match, teamId);
    if (margin === null) {
      continue;
    }
    if (margin >= 0) {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  return `${wins}-${losses}`;
}

function buildQuarterFacts(
  boxScore: BBApiBoxScore,
): GameDayRecapPromptQuarterFacts {
  const periods = boxScore.homeTeam.partialScores.flatMap(
    (homeScore, index) => {
      const awayScore = boxScore.awayTeam.partialScores[index];
      if (awayScore == null) {
        return [];
      }

      const margin = Math.abs(homeScore - awayScore);
      const winningSide =
        homeScore === awayScore
          ? "tie"
          : homeScore > awayScore
            ? "home"
            : "away";

      return [
        {
          awayScore,
          homeScore,
          label: formatPeriodLabel(index + 1),
          margin,
          period: index + 1,
          winningSide,
        } satisfies GameDayRecapPromptPeriodFact,
      ];
    },
  );

  const decisiveQuarter =
    [...periods]
      .filter(
        (
          period,
        ): period is GameDayRecapPromptPeriodFact & {
          winningSide: "away" | "home";
        } =>
          period.winningSide !== "tie" &&
          period.margin >= GAME_DAY_RECAP_DECISIVE_QUARTER_MARGIN,
      )
      .sort(
        (left, right) =>
          right.margin - left.margin || left.period - right.period,
      )
      .at(0) ?? null;

  return {
    decisiveQuarter,
    fourthQuarterOutcome: periods.find((period) => period.period === 4) ?? null,
    periods,
  };
}

function formatPeriodLabel(period: number): string {
  if (period <= 4) {
    return `${ordinal(period)} quarter`;
  }

  return period === 5 ? "overtime" : `${ordinal(period - 4)} overtime`;
}

function compactScalarRecord(
  input: Record<string, number | string | null> | null | undefined,
): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(input ?? {})
      .filter((entry): entry is [string, number | string] => {
        const value = entry[1];
        return value !== null && value !== "";
      })
      .map(([key, value]) => [
        key,
        typeof value === "number" ? roundToOneDecimal(value) : value,
      ]),
  );
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function compareTimestamps(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return parseTimestamp(left) - parseTimestamp(right);
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function parseDateOnlyToTimestamp(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }

  return Date.parse(`${value}T00:00:00Z`);
}

export type SeasonResolutionDiagnostic = {
  finish: string | null;
  finishTimestamp: number | null;
  hasUsableBounds: boolean;
  id: number | null;
  invalidBounds: boolean;
  matchesGameDate: boolean;
  normalizedFinish: string | null;
  normalizedStart: string | null;
  start: string | null;
  startTimestamp: number | null;
};

type SeasonDiagnosticEntry = SeasonResolutionDiagnostic & {
  index: number;
};

function summarizeSeasonDiagnostics(
  seasons: BBApiSeasons,
  gameDate: string,
): SeasonResolutionDiagnostic[] {
  const matchTimestamp = parseDateOnlyToTimestamp(gameDate);
  const diagnostics = seasons.seasons.map(
    (season, index): SeasonDiagnosticEntry => {
      const normalizedStart = resolveDateKey(season.start);
      const normalizedFinish = resolveDateKey(season.finish);
      const startTimestamp = parseDateOnlyToTimestamp(normalizedStart);
      const finishTimestamp = parseDateOnlyToTimestamp(normalizedFinish);

      return {
        finish: season.finish,
        finishTimestamp: toFiniteNumberOrNull(finishTimestamp),
        hasUsableBounds: false,
        id: season.id,
        index,
        invalidBounds: false,
        matchesGameDate: false,
        normalizedFinish,
        normalizedStart,
        start: season.start,
        startTimestamp: toFiniteNumberOrNull(startTimestamp),
      };
    },
  );

  const orderedStarts = diagnostics
    .filter(
      (season) =>
        season.id !== null &&
        season.id !== undefined &&
        season.startTimestamp !== null,
    )
    .sort((left, right) => {
      if (left.startTimestamp !== right.startTimestamp) {
        return (
          (left.startTimestamp ?? Number.POSITIVE_INFINITY) -
          (right.startTimestamp ?? Number.POSITIVE_INFINITY)
        );
      }

      return (
        (left.id ?? Number.POSITIVE_INFINITY) -
        (right.id ?? Number.POSITIVE_INFINITY)
      );
    });
  const nextStartByIndex = new Map<number, number | null>();
  orderedStarts.forEach((season, index) => {
    nextStartByIndex.set(
      season.index,
      orderedStarts[index + 1]?.startTimestamp ?? null,
    );
  });

  return diagnostics.map((season) => {
    const startTimestamp = season.startTimestamp;
    const finishTimestamp = season.finishTimestamp;
    const nextStartTimestamp = nextStartByIndex.get(season.index) ?? null;
    const openEnded =
      startTimestamp !== null &&
      nextStartTimestamp === null &&
      finishTimestamp === null;
    const hasUsableBounds =
      season.id !== null &&
      season.id !== undefined &&
      startTimestamp !== null &&
      (openEnded || nextStartTimestamp !== null || finishTimestamp !== null);
    const matchesGameDate = hasUsableBounds
      ? nextStartTimestamp !== null
        ? startTimestamp <= matchTimestamp &&
          matchTimestamp < nextStartTimestamp
        : finishTimestamp !== null
          ? startTimestamp <= matchTimestamp &&
            matchTimestamp <= finishTimestamp
          : startTimestamp <= matchTimestamp
      : false;

    return {
      finish: season.finish,
      finishTimestamp,
      hasUsableBounds,
      id: season.id,
      invalidBounds:
        Boolean(season.normalizedStart || season.normalizedFinish) &&
        !hasUsableBounds,
      matchesGameDate,
      normalizedFinish: season.normalizedFinish,
      normalizedStart: season.normalizedStart,
      start: season.start,
      startTimestamp,
    };
  });
}

async function resolveSeasonedLeagueSlateForRecap(args: {
  bb: Pick<BBXmlApiClient, "getSchedule" | "getSeasons" | "getStandings"> &
    Partial<Pick<BBXmlApiClient, "getSeasonsXml">>;
  connection: BbConnectionRecord;
  gameDate: string;
  leagueId: string;
  targetKey: string;
  userId: string;
}): Promise<{
  season: number;
  slate: SlateGame[];
  standings: BBApiStandings;
}> {
  logGameDayRecapInfo("process.fetch_current_standings.start", {
    gameDate: args.gameDate,
    leagueId: args.leagueId,
    targetKey: args.targetKey,
    userId: args.userId,
  });
  const currentStandings = await args.bb.getStandings(args.leagueId);
  const timeZone = resolveLeagueTimeZone(args.connection, currentStandings);
  if (!timeZone) {
    throw new Error(
      "League date recaps require a league time zone. Set one before requesting a date-based recap.",
    );
  }
  logGameDayRecapInfo("process.fetch_current_standings.succeeded", {
    leagueName: currentStandings.league?.name ?? null,
    season: currentStandings.season ?? null,
    targetKey: args.targetKey,
    timeZone,
    userId: args.userId,
  });

  if (
    currentStandings.season !== null &&
    currentStandings.season !== undefined
  ) {
    logGameDayRecapInfo("process.resolve_current_slate.start", {
      gameDate: args.gameDate,
      season: currentStandings.season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    const currentSlateResult = await resolveLeagueDaySlateWithDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      standings: currentStandings,
      timeZone,
    });
    const currentSlate = currentSlateResult.slate;
    if (currentSlate.length > 0) {
      logGameDayRecapInfo("process.resolve_current_slate.succeeded", {
        diagnostics: currentSlateResult.diagnostics,
        requestedGames: currentSlate.length,
        season: currentStandings.season,
        slate: currentSlate.map((game) => ({
          awayTeamId: game.awayTeamId,
          homeTeamId: game.homeTeamId,
          matchId: game.matchId,
          startTime: game.startTime,
          type: game.type,
        })),
        targetKey: args.targetKey,
        userId: args.userId,
      });
      return {
        season: currentStandings.season,
        slate: currentSlate,
        standings: currentStandings,
      };
    }

    logGameDayRecapInfo("process.resolve_current_slate.no_games", {
      diagnostics: currentSlateResult.diagnostics,
      gameDate: args.gameDate,
      season: currentStandings.season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
  } else {
    logGameDayRecapWarn(
      "process.resolve_current_slate.skipped_missing_season",
      {
        gameDate: args.gameDate,
        leagueId: args.leagueId,
        targetKey: args.targetKey,
        userId: args.userId,
      },
    );
  }

  logGameDayRecapInfo("process.fetch_seasons.start", {
    gameDate: args.gameDate,
    targetKey: args.targetKey,
    userId: args.userId,
  });
  const seasons = await args.bb.getSeasons();
  const seasonDiagnostics = summarizeSeasonDiagnostics(seasons, args.gameDate);
  logGameDayRecapInfo("process.fetch_seasons.succeeded", {
    gameDate: args.gameDate,
    matchedSeasonIds: seasonDiagnostics
      .filter((season) => season.matchesGameDate && season.id !== null)
      .map((season) => season.id),
    openSeasonIds: seasonDiagnostics
      .filter(
        (season) =>
          season.id !== null &&
          season.startTimestamp !== null &&
          season.finishTimestamp === null,
      )
      .map((season) => season.id),
    seasonCount: seasons.seasons.length,
    tailSeasons: seasonDiagnostics.slice(-3),
    targetKey: args.targetKey,
    userId: args.userId,
  });

  const parsedSeasonsLookUnusable =
    seasonDiagnostics.length === 0 ||
    seasonDiagnostics.every((season) => !season.hasUsableBounds);
  if (parsedSeasonsLookUnusable) {
    await logRawSeasonsXmlDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: seasons,
      reason: "parsed_seasons_unusable",
      targetKey: args.targetKey,
      userId: args.userId,
    });
  }

  const candidateSeasons = resolveSeasonCandidatesForDate(
    seasons,
    args.gameDate,
  );
  logGameDayRecapInfo("process.resolve_historical_candidates", {
    candidateSeasons,
    currentSeason: currentStandings.season ?? null,
    gameDate: args.gameDate,
    targetKey: args.targetKey,
    userId: args.userId,
  });

  const triedSeasons = new Set<number>();
  if (
    currentStandings.season !== null &&
    currentStandings.season !== undefined
  ) {
    triedSeasons.add(currentStandings.season);
  }

  for (const season of candidateSeasons) {
    if (triedSeasons.has(season)) {
      continue;
    }

    triedSeasons.add(season);
    logGameDayRecapInfo("process.fetch_historical_standings.start", {
      leagueId: args.leagueId,
      season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    const standings = await args.bb.getStandings(args.leagueId, season);
    logGameDayRecapInfo("process.fetch_historical_standings.succeeded", {
      leagueName: standings.league?.name ?? null,
      season: standings.season ?? null,
      targetKey: args.targetKey,
      userId: args.userId,
    });

    logGameDayRecapInfo("process.resolve_historical_slate.start", {
      gameDate: args.gameDate,
      season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    const historicalSlateResult = await resolveLeagueDaySlateWithDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      standings,
      timeZone,
    });
    const slate = historicalSlateResult.slate;
    if (slate.length > 0) {
      logGameDayRecapInfo("process.resolve_historical_slate.succeeded", {
        diagnostics: historicalSlateResult.diagnostics,
        requestedGames: slate.length,
        season,
        slate: slate.map((game) => ({
          awayTeamId: game.awayTeamId,
          homeTeamId: game.homeTeamId,
          matchId: game.matchId,
          startTime: game.startTime,
          type: game.type,
        })),
        targetKey: args.targetKey,
        userId: args.userId,
      });
      return { season, slate, standings };
    }

    logGameDayRecapInfo("process.resolve_historical_slate.no_games", {
      diagnostics: historicalSlateResult.diagnostics,
      gameDate: args.gameDate,
      season,
      targetKey: args.targetKey,
      userId: args.userId,
    });
  }

  if (candidateSeasons.length === 0) {
    await logRawSeasonsXmlDiagnostics({
      bb: args.bb,
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: seasons,
      reason: "resolve_season_failed",
      targetKey: args.targetKey,
      userId: args.userId,
    });
    throw new Error(
      `Unable to resolve a BuzzerBeater season for ${args.gameDate}.`,
    );
  }

  throw new Error(
    `No league games were found for league ${args.leagueId} on ${args.gameDate}.`,
  );
}

function resolveSeasonCandidatesForDate(
  seasons: BBApiSeasons,
  gameDate: string,
): number[] {
  return summarizeSeasonDiagnostics(seasons, gameDate)
    .filter(
      (season): season is SeasonResolutionDiagnostic & { id: number } =>
        season.id !== null && season.id !== undefined && season.matchesGameDate,
    )
    .map((season) => season.id);
}

async function logRawSeasonsXmlDiagnostics(args: {
  bb: Partial<Pick<BBXmlApiClient, "getSeasonsXml">>;
  gameDate: string;
  leagueId: string;
  parsedSeasons: BBApiSeasons;
  reason: string;
  targetKey: string;
  userId: string;
}): Promise<void> {
  if (typeof args.bb.getSeasonsXml !== "function") {
    logGameDayRecapWarn("process.fetch_seasons_xml.unavailable", {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: summarizeSeasonDiagnostics(
        args.parsedSeasons,
        args.gameDate,
      ),
      reason: args.reason,
      targetKey: args.targetKey,
      userId: args.userId,
    });
    return;
  }

  try {
    const xml = await args.bb.getSeasonsXml();
    logGameDayRecapInfo("process.fetch_seasons_xml.succeeded", {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      parsedSeasons: summarizeSeasonDiagnostics(
        args.parsedSeasons,
        args.gameDate,
      ),
      rawXmlHasFinishElement: xml.includes("<finish>"),
      rawXmlHasSeasonTag: xml.includes("<season"),
      rawXmlHasStartElement: xml.includes("<start>"),
      rawXmlLength: xml.length,
      rawXmlPreview: summarizeXmlPreview(xml),
      reason: args.reason,
      targetKey: args.targetKey,
      userId: args.userId,
    });
  } catch (error) {
    logGameDayRecapWarn("process.fetch_seasons_xml.failed", {
      gameDate: args.gameDate,
      leagueId: args.leagueId,
      reason: args.reason,
      targetKey: args.targetKey,
      userId: args.userId,
      ...toLoggableError(error),
    });
  }
}

function summarizeXmlPreview(xml: string, maxLength = 500): string {
  const normalized = xml.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function toFiniteNumberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function logGameDayRecapInfo(
  event: string,
  details: Record<string, unknown>,
): void {
  const entry = buildGameDayRecapInfoLogEntry(event, details);
  if (!entry) {
    return;
  }

  console.info(`${GAME_DAY_RECAP_LOG_PREFIX} ${entry.event}`, entry.details);
}

function logGameDayRecapWarn(
  event: string,
  details: Record<string, unknown>,
): void {
  console.warn(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function logGameDayRecapError(
  event: string,
  details: Record<string, unknown>,
): void {
  console.error(`${GAME_DAY_RECAP_LOG_PREFIX} ${event}`, details);
}

function createBoundedConcurrencyLimiter(
  concurrency: number,
): BoundedConcurrencyLimiter {
  const limit = Math.max(1, Math.trunc(concurrency));
  const queue: Array<{
    reject: (reason?: unknown) => void;
    resolve: (value: unknown) => void;
    task: () => Promise<unknown>;
  }> = [];
  let activeCount = 0;

  const runNext = () => {
    if (activeCount >= limit) {
      return;
    }
    const next = queue.shift();
    if (!next) {
      return;
    }

    activeCount += 1;
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        activeCount -= 1;
        runNext();
      });
  };

  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push({
        reject,
        resolve: resolve as (value: unknown) => void,
        task: task as () => Promise<unknown>,
      });
      runNext();
    });
}

async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limiter = createBoundedConcurrencyLimiter(concurrency);
  return Promise.all(
    items.map((item, index) => limiter(() => worker(item, index))),
  );
}

function createGameDayRecapGenerationConcurrency(
  config: GameDayRecapRuntimeConfig,
): GameDayRecapGenerationConcurrency {
  return {
    interviewLimiter: createBoundedConcurrencyLimiter(
      config.interviewConcurrency,
    ),
    judgeLimiter: createBoundedConcurrencyLimiter(config.judgeConcurrency),
    polishLimiter: createBoundedConcurrencyLimiter(config.polishConcurrency),
  };
}

async function withGameDayRecapStageTiming<T>(
  stage: string,
  details: Record<string, unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    logGameDayRecapInfo("process.stage_timing", {
      ...details,
      durationMs: Date.now() - startedAt,
      stage,
      status: "succeeded",
    });
    return result;
  } catch (error) {
    logGameDayRecapInfo("process.stage_timing", {
      ...details,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
      stage,
      status: "failed",
    });
    throw error;
  }
}

function buildGameDayRecapInfoLogEntry(
  event: string,
  details: Record<string, unknown>,
): { details: Record<string, unknown>; event: string } | null {
  if (!GAME_DAY_RECAP_INFO_EVENTS.has(event)) {
    return null;
  }

  if (event === "process.completed") {
    const coverage = summarizeCoverageForGameDayRecapLog(details.coverage);
    if (!shouldLogGameDayRecapCompletionInfo(coverage)) {
      return null;
    }

    return {
      details: {
        ...pickGameDayRecapLogFields(details, [
          "finalStatus",
          "season",
          "targetKey",
          "userId",
        ]),
        coverage,
      },
      event,
    };
  }

  if (event === "process.stage_timing") {
    return {
      details: pickGameDayRecapLogFields(details, [
        "candidateCount",
        "concurrency",
        "durationMs",
        "errorMessage",
        "gameCount",
        "qualityTier",
        "remainingTimeMs",
        "requestKind",
        "stage",
        "status",
        "targetKey",
        "userId",
      ]),
      event,
    };
  }

  return {
    details: pickGameDayRecapLogFields(details, [
      "executionArn",
      "existingRequestedAt",
      "existingStatus",
      "gameDate",
      "leagueId",
      "requestedAt",
      "targetKey",
      "userId",
    ]),
    event,
  };
}

function pickGameDayRecapLogFields(
  details: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};

  for (const field of fields) {
    if (field in details && details[field] !== undefined) {
      picked[field] = details[field];
    }
  }

  return picked;
}

function summarizeCoverageForGameDayRecapLog(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const coverage = value as {
    availableGames?: unknown;
    missingGames?: unknown;
    partial?: unknown;
    requestedGames?: unknown;
  };
  const partial =
    typeof coverage.partial === "boolean" ? coverage.partial : null;

  return {
    availableGames: toFiniteNumberOrNull(
      typeof coverage.availableGames === "number"
        ? coverage.availableGames
        : NaN,
    ),
    missingGameCount: Array.isArray(coverage.missingGames)
      ? coverage.missingGames.length
      : 0,
    partial,
    requestedGames: toFiniteNumberOrNull(
      typeof coverage.requestedGames === "number"
        ? coverage.requestedGames
        : NaN,
    ),
  };
}

function shouldLogGameDayRecapCompletionInfo(
  coverage: Record<string, unknown> | null,
): boolean {
  if (!coverage) {
    return true;
  }

  const requestedGames =
    typeof coverage.requestedGames === "number"
      ? coverage.requestedGames
      : null;
  const partial = coverage.partial === true;
  const missingGameCount =
    typeof coverage.missingGameCount === "number"
      ? coverage.missingGameCount
      : null;

  return (
    partial ||
    (missingGameCount !== null && missingGameCount > 0) ||
    (requestedGames !== null && requestedGames > 1)
  );
}

function isRetryableCompletedSlateCoverageError(
  error: unknown,
): error is RetryableCompletedSlateCoverageError {
  return (
    error instanceof RetryableCompletedSlateCoverageError ||
    (error instanceof Error &&
      error.name === RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME &&
      "coverage" in error)
  );
}

function toLoggableError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { errorMessage: String(error) };
  }

  const details: Record<string, unknown> = {
    errorMessage: error.message,
    errorName: error.name,
  };

  if ("endpoint" in error && typeof error.endpoint === "string") {
    details.endpoint = error.endpoint;
  }
  if ("status" in error && typeof error.status === "number") {
    details.status = error.status;
  }
  if ("bodyPreview" in error && typeof error.bodyPreview === "string") {
    details.bodyPreview = error.bodyPreview;
  }
  if (error instanceof GameDayRecapRepairFailureError) {
    details.validationFeedbackLines = error.feedbackLines.slice(0, 10);
    details.deterministicIssueCount = error.deterministicIssues.length;
    details.deterministicIssues = summarizeGameDayRecapValidationIssuesForLog(
      error.deterministicIssues,
    );
    details.judgeIssueCount = error.judgeIssues.length;
    details.judgeIssues = summarizeGameDayRecapJudgeIssuesForLog(
      error.judgeIssues,
    );
    details.postPatchDeterministicIssueCount =
      error.postPatchDeterministicIssues.length;
    details.postPatchDeterministicIssues =
      summarizeGameDayRecapValidationIssuesForLog(
        error.postPatchDeterministicIssues,
      );
    details.postPatchJudgeIssueCount = error.postPatchJudgeIssues.length;
    details.postPatchJudgeIssues = summarizeGameDayRecapJudgeIssuesForLog(
      error.postPatchJudgeIssues,
    );
    details.postTrimDeterministicIssueCount =
      error.postTrimDeterministicIssues.length;
    details.postTrimDeterministicIssues =
      summarizeGameDayRecapValidationIssuesForLog(
        error.postTrimDeterministicIssues,
      );
    details.postTrimJudgeIssueCount = error.postTrimJudgeIssues.length;
    details.postTrimJudgeIssues = summarizeGameDayRecapJudgeIssuesForLog(
      error.postTrimJudgeIssues,
    );
    details.repairActions = error.repairActions.slice(0, 20);
    return details;
  }
  if (isGameDayRecapSemanticValidationError(error)) {
    details.validationIssueCount = error.issues.length;
    details.validationFeedbackLines = error.feedbackLines.slice(0, 10);
    details.validationIssues = summarizeGameDayRecapValidationIssuesForLog(
      error.issues,
    );
    if (error.issues.length > 10) {
      details.validationIssueOverflowCount = error.issues.length - 10;
    }
  }

  return details;
}

function summarizeGameDayRecapValidationIssuesForLog(
  issues: GameDayRecapSemanticValidationIssue[],
): Array<Record<string, unknown>> {
  return issues.slice(0, 10).map((issue) => ({
    matchId: issue.matchId,
    field: issue.field,
    kind: issue.kind,
    reason: issue.reason,
    sentenceIndex: issue.sentenceIndex,
    ...(issue.teamSide ? { teamSide: issue.teamSide } : {}),
    ...(issue.period !== undefined ? { period: issue.period } : {}),
    ...(issue.actualValue ? { actualValue: issue.actualValue } : {}),
    sentence: summarizeGameDayRecapSentenceForLog(issue.sentence),
  }));
}

function summarizeGameDayRecapJudgeIssuesForLog(
  issues: GameDayRecapJudgeValidationIssue[],
): Array<Record<string, unknown>> {
  return issues.slice(0, 10).map((issue) => ({
    contradictionType: issue.contradictionType,
    field: issue.field,
    matchId: issue.matchId,
    sentence: summarizeGameDayRecapSentenceForLog(issue.sentence),
    sentenceIndex: issue.sentenceIndex,
    ...(issue.notes ? { notes: issue.notes } : {}),
    ...(issue.sourceField ? { sourceField: issue.sourceField } : {}),
    verdict: issue.verdict,
  }));
}

function summarizeGameDayRecapSentenceForLog(sentence: string): string {
  const normalized = sentence.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

function buildGameValidationPayload(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  judgeIssues: GameDayRecapJudgeValidationIssue[];
}): GameDayRecapGameValidationPayload {
  const issues = [
    ...args.deterministicIssues.map(summarizeSemanticIssueForPayload),
    ...args.judgeIssues.map(summarizeJudgeIssueForPayload),
  ].slice(0, 8);
  return {
    issueCount: args.deterministicIssues.length + args.judgeIssues.length,
    issues,
    status: resolveGameValidationStatus(args),
  };
}

function resolveGameValidationStatus(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  judgeIssues: GameDayRecapJudgeValidationIssue[];
}): "SUSPECT" | "UNSAFE" | "VALID" {
  if (!args.deterministicIssues.length && !args.judgeIssues.length) {
    return "VALID";
  }
  const hasUnsafeIssue =
    args.deterministicIssues.some(
      (issue) => issue.field === "headline" || issue.salvage === "drop_only",
    ) || args.judgeIssues.some((issue) => issue.field === "headline");
  return hasUnsafeIssue ? "UNSAFE" : "SUSPECT";
}

function summarizeSemanticIssueForPayload(
  issue: GameDayRecapSemanticValidationIssue,
): GameDayRecapValidationIssuePayload {
  return {
    actualValue: issue.actualValue ?? null,
    feedback: issue.feedback,
    field: issue.field,
    kind: issue.kind,
    reason: issue.reason,
    sentence: summarizeGameDayRecapSentenceForLog(issue.sentence),
    sentenceIndex: issue.sentenceIndex,
    source: "deterministic",
    sourceField: null,
    teamSide: issue.teamSide ?? null,
    verdict: null,
  };
}

function summarizeJudgeIssueForPayload(
  issue: GameDayRecapJudgeValidationIssue,
): GameDayRecapValidationIssuePayload {
  return {
    actualValue: issue.sourceField,
    feedback: issue.feedback,
    field: issue.field,
    kind: issue.contradictionType,
    reason:
      issue.notes ??
      `The judge marked this ${issue.field} sentence ${issue.verdict} for ${issue.contradictionType}.`,
    sentence: summarizeGameDayRecapSentenceForLog(issue.sentence),
    sentenceIndex: issue.sentenceIndex,
    source: "judge",
    sourceField: issue.sourceField,
    teamSide: null,
    verdict: issue.verdict,
  };
}

function attachGameValidation(
  game: GameDayRecapResultGame,
  validation: GameDayRecapGameValidationPayload,
): GameDayRecapResultGame {
  return {
    ...game,
    validation,
  };
}

function attachValidGameValidation(
  game: GameDayRecapResultGame,
): GameDayRecapResultGame {
  return attachGameValidation(game, {
    issueCount: 0,
    issues: [],
    status: "VALID",
  });
}

function attachValidResultValidation(
  result: GameDayRecapResultPayload,
): GameDayRecapResultPayload {
  return {
    ...result,
    games: result.games.map(attachValidGameValidation),
  };
}

function buildGameDayRecapFailureDetails(
  error: unknown,
): GameDayRecapFailureDetailsPayload {
  const message = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : null;
  if (error instanceof GameDayRecapRepairFailureError) {
    const issuesByMatchId = new Map<
      string,
      {
        deterministicIssues: GameDayRecapSemanticValidationIssue[];
        judgeIssues: GameDayRecapJudgeValidationIssue[];
      }
    >();
    for (const issue of [
      ...error.deterministicIssues,
      ...error.postPatchDeterministicIssues,
      ...error.postTrimDeterministicIssues,
    ]) {
      const existing = issuesByMatchId.get(issue.matchId) ?? {
        deterministicIssues: [],
        judgeIssues: [],
      };
      existing.deterministicIssues.push(issue);
      issuesByMatchId.set(issue.matchId, existing);
    }
    for (const issue of [
      ...error.judgeIssues,
      ...error.postPatchJudgeIssues,
      ...error.postTrimJudgeIssues,
    ]) {
      const existing = issuesByMatchId.get(issue.matchId) ?? {
        deterministicIssues: [],
        judgeIssues: [],
      };
      existing.judgeIssues.push(issue);
      issuesByMatchId.set(issue.matchId, existing);
    }
    const games = Array.from(issuesByMatchId.entries())
      .slice(0, 12)
      .map(([matchId, issues]) => {
        const validation = buildGameValidationPayload(issues);
        return {
          awayTeamName: null,
          homeTeamName: null,
          issueCount: validation.issueCount,
          issues: validation.issues,
          matchId,
        };
      });
    return {
      errorName,
      failedGameCount: games.length,
      games,
      issueCount: games.reduce((total, game) => total + game.issueCount, 0),
      message,
      repairActionCount: error.repairActions.length,
    };
  }

  return {
    errorName,
    failedGameCount: 0,
    games: [],
    issueCount: 0,
    message,
    repairActionCount: 0,
  };
}

function resolveDateKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1] ?? null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : null;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
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

function asNumberFromUnknown(value: unknown): number {
  return typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value) || 0
      : 0;
}

function toOptionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function resolveUserId(identity: unknown): string | null {
  const record = requireRecord(identity ?? {}, "Authenticated identity");
  if (typeof record.sub === "string" && record.sub.trim()) {
    return record.sub;
  }

  const claims = record.claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    return null;
  }

  const sub = (claims as Record<string, unknown>).sub;
  return typeof sub === "string" && sub.trim() ? sub : null;
}

async function requireBbConnection(
  env: GraphqlEnv,
  userId: string,
  dependencies: Pick<ProcessDependencies, "getBbConnection">,
): Promise<BbConnectionRecord> {
  const connection = await dependencies.getBbConnection(env, userId);
  if (!connection) {
    throw new Error("Connect a BuzzerBeater account before requesting recaps.");
  }
  if (!connection.bbLoginName) {
    throw new Error(
      "The saved BuzzerBeater connection is missing a login name.",
    );
  }
  return connection;
}

function resolveLeagueTimeZone(
  connection: BbConnectionRecord,
  standings: BBApiStandings | null,
): string | null {
  const savedTimeZone = normalizeLeagueTimeZone(connection.leagueTimeZone);
  if (savedTimeZone) {
    return savedTimeZone;
  }

  return inferLeagueTimeZone({
    countryId: standings?.country?.id ?? null,
    countryName: standings?.country?.name ?? null,
  });
}

function normalizeBedrockUsageTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function resolveGameDayRecapModelPricing(modelId: string): {
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
} | null {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) {
    return null;
  }

  for (const pricing of KNOWN_RECAP_MODEL_PRICING) {
    if (pricing.pattern.test(normalizedModelId)) {
      return {
        inputCostPerMillionUsd: pricing.inputCostPerMillionUsd,
        outputCostPerMillionUsd: pricing.outputCostPerMillionUsd,
      };
    }
  }

  return null;
}

function roundRecapUsdEstimate(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function buildGameDayRecapCostPayload(args: {
  providers: Array<StructuredGameDayRecapProvider | null | undefined>;
  result: GameDayRecapResultPayload | null;
}): GameDayRecapCostPayload | null {
  const usageSummaries = args.providers.flatMap((provider) => {
    const usage = provider?.getUsageSummary?.();
    return usage && (usage.requestCount > 0 || usage.totalTokens > 0)
      ? [usage]
      : [];
  });
  if (usageSummaries.length === 0) {
    return null;
  }

  const stages: GameDayRecapCostStagePayload[] = usageSummaries.map((usage) => {
    const pricing = resolveGameDayRecapModelPricing(usage.modelId);
    const estimatedCostUsd = pricing
      ? roundRecapUsdEstimate(
          (usage.inputTokens / 1_000_000) * pricing.inputCostPerMillionUsd +
            (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillionUsd,
        )
      : undefined;

    return {
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
      inputTokens: usage.inputTokens,
      modelId: usage.modelId,
      outputTokens: usage.outputTokens,
      providerName: usage.providerName,
      requestCount: usage.requestCount,
      stage: usage.stage,
      totalTokens: usage.totalTokens,
    };
  });

  const cacheReadInputTokens = usageSummaries.reduce(
    (total, usage) => total + usage.cacheReadInputTokens,
    0,
  );
  const cacheWriteInputTokens = usageSummaries.reduce(
    (total, usage) => total + usage.cacheWriteInputTokens,
    0,
  );
  const estimatedStageCosts = stages
    .map((stage) => stage.estimatedCostUsd)
    .filter(
      (estimatedCostUsd): estimatedCostUsd is number =>
        typeof estimatedCostUsd === "number",
    );
  const estimatedTotalCostUsd =
    estimatedStageCosts.length > 0
      ? roundRecapUsdEstimate(
          estimatedStageCosts.reduce(
            (total, stageCost) => total + stageCost,
            0,
          ),
        )
      : undefined;
  const generatedGameCount = args.result?.games.length ?? 0;
  const estimatedPerGameCostUsd =
    estimatedTotalCostUsd !== undefined && generatedGameCount > 0
      ? roundRecapUsdEstimate(estimatedTotalCostUsd / generatedGameCount)
      : undefined;
  const pricingStatus =
    estimatedStageCosts.length === 0
      ? "unavailable"
      : estimatedStageCosts.length === stages.length
        ? "estimated"
        : "partial";

  return {
    cacheReadInputTokens,
    cacheWriteInputTokens,
    currency: "USD",
    ...(estimatedPerGameCostUsd !== undefined
      ? { estimatedPerGameCostUsd }
      : {}),
    ...(estimatedTotalCostUsd !== undefined ? { estimatedTotalCostUsd } : {}),
    ...(generatedGameCount > 0 ? { generatedGameCount } : {}),
    inputTokens: usageSummaries.reduce(
      (total, usage) => total + usage.inputTokens,
      0,
    ),
    outputTokens: usageSummaries.reduce(
      (total, usage) => total + usage.outputTokens,
      0,
    ),
    pricingStatus,
    requestCount: usageSummaries.reduce(
      (total, usage) => total + usage.requestCount,
      0,
    ),
    stages,
    totalTokens: usageSummaries.reduce(
      (total, usage) => total + usage.totalTokens,
      0,
    ),
  };
}

function createBedrockGameDayRecapProvider(args: {
  modelId: string;
  region: string | undefined;
  stage: StructuredGameDayRecapProviderStage;
}): StructuredGameDayRecapProvider {
  assertSupportedBedrockRecapModel(args.modelId, args.region);

  const client = new BedrockRuntimeClient({
    region: args.region,
  });
  const usage = {
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    totalTokens: 0,
  };

  return {
    generate: async (payload, options) => {
      const request =
        args.stage === "judge"
          ? buildGameDayRecapJudgeBedrockRequest({
              modelId: args.modelId,
              payload: requireJudgeRequestPayload(payload),
            })
          : buildGameDayRecapBedrockRequest({
              modelId: args.modelId,
              payload: requireWriterRequestPayload(payload),
              validationFeedback: options?.validationFeedback,
              validationContext: options?.validationContext ?? null,
            });
      const response = await client.send(new ConverseCommand(request));
      const responseUsage = response.usage;
      usage.requestCount += 1;
      if (responseUsage) {
        const cacheReadInputTokens = normalizeBedrockUsageTokenCount(
          responseUsage.cacheReadInputTokens,
        );
        const cacheWriteInputTokens = normalizeBedrockUsageTokenCount(
          responseUsage.cacheWriteInputTokens,
        );
        const inputTokens = normalizeBedrockUsageTokenCount(
          responseUsage.inputTokens,
        );
        const outputTokens = normalizeBedrockUsageTokenCount(
          responseUsage.outputTokens,
        );
        const totalTokens = normalizeBedrockUsageTokenCount(
          responseUsage.totalTokens,
        );
        usage.cacheReadInputTokens += cacheReadInputTokens;
        usage.cacheWriteInputTokens += cacheWriteInputTokens;
        usage.inputTokens += inputTokens;
        usage.outputTokens += outputTokens;
        usage.totalTokens +=
          totalTokens > 0 ? totalTokens : inputTokens + outputTokens;
      }

      const output = response.output;
      const content =
        output && "message" in output ? (output.message?.content ?? []) : [];
      const text = content
        .map((block) => ("text" in block ? block.text : ""))
        .join("")
        .trim();

      if (!text) {
        throw new Error("Bedrock returned an empty structured recap response.");
      }
      if (response.stopReason && response.stopReason !== "end_turn") {
        throw new Error(
          `Bedrock stopped recap generation with reason ${response.stopReason}.`,
        );
      }

      return JSON.parse(text);
    },
    getUsageSummary: () =>
      usage.requestCount > 0 || usage.totalTokens > 0
        ? {
            cacheReadInputTokens: usage.cacheReadInputTokens,
            cacheWriteInputTokens: usage.cacheWriteInputTokens,
            inputTokens: usage.inputTokens,
            modelId: args.modelId,
            outputTokens: usage.outputTokens,
            providerName: "bedrock",
            requestCount: usage.requestCount,
            stage: args.stage,
            totalTokens: usage.totalTokens,
          }
        : null,
    modelId: args.modelId,
    providerName: "bedrock",
    stage: args.stage,
  };
}

function requireWriterRequestPayload(
  value: unknown,
): GameDayRecapWriterRequestPayload {
  return value as GameDayRecapWriterRequestPayload;
}

function resolvePayloadFactStore(
  payload: GameDayRecapPromptPayload,
): GameDayRecapFactStore {
  // Runtime paths should carry the canonical fact store through once built.
  // This rebuild path only exists for tests and older payload shapes.
  return (
    payload.factStore ??
    buildGameDayRecapJudgeFactStore({
      expectedGames: payload.games,
      request: payload.request,
    })
  );
}

function requireJudgeRequestPayload(
  value: unknown,
): GameDayRecapJudgeRequestPayload {
  const record = requireRecord(value, "Game day recap judge request");
  const judgeKind = asOptionalString(record.judgeKind)?.trim();
  if (
    judgeKind !== "sentence_factuality" &&
    judgeKind !== "candidate_interestingness"
  ) {
    throw new Error(
      "Game day recap judge request must include a supported judgeKind.",
    );
  }

  return record as unknown as GameDayRecapJudgeRequestPayload;
}

async function generateResolvedGameDayRecap(args: {
  judgeProvider: StructuredGameDayRecapProvider | null;
  payload: GameDayRecapPromptPayload;
  qualityTier: RecapQualityTier;
  remainingTimeInMillis?: () => number;
  retryProvider: StructuredGameDayRecapProvider | null;
  runtimeConfig?: GameDayRecapRuntimeConfig;
  targetKey?: string;
  userId?: string;
  writerProvider: StructuredGameDayRecapProvider;
}): Promise<GeneratedGameDayRecap> {
  const factStore = resolvePayloadFactStore(args.payload);
  const runtimeConfig =
    args.runtimeConfig ?? DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG;
  const concurrency = createGameDayRecapGenerationConcurrency(runtimeConfig);
  const logContext = {
    targetKey: args.targetKey,
    userId: args.userId,
  };
  const rewriteProvider =
    args.qualityTier === "premium"
      ? (args.retryProvider ?? args.writerProvider)
      : args.writerProvider;

  let generated: GeneratedGameDayRecap;
  if (args.qualityTier === "premium") {
    if (!args.retryProvider) {
      throw new Error("Premium recap generation requires a retry provider.");
    }

    generated = await generatePremiumValidatedGameDayRecap({
      concurrency,
      judgeProvider: args.judgeProvider,
      logContext,
      payload: args.payload,
      retryProvider: args.retryProvider,
      runtimeConfig,
      writerProvider: args.writerProvider,
    });
  } else {
    generated = await generateValidatedGameDayRecap({
      concurrency,
      judgeProvider: args.judgeProvider,
      logContext,
      payload: args.payload,
      provider: args.writerProvider,
      runtimeConfig,
    });
  }

  return finalizeGeneratedGameDayRecap({
    factStore,
    generated,
    concurrency,
    interviewProvider: rewriteProvider,
    judgeProvider: args.judgeProvider,
    logContext,
    polishProvider: rewriteProvider,
    qualityTier: args.qualityTier,
    remainingTimeInMillis: args.remainingTimeInMillis,
    runtimeConfig,
  });
}

async function finalizeGeneratedGameDayRecap(args: {
  concurrency: GameDayRecapGenerationConcurrency;
  factStore: GameDayRecapFactStore;
  generated: GeneratedGameDayRecap;
  interviewProvider: StructuredGameDayRecapProvider;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  remainingTimeInMillis?: () => number;
  polishProvider: StructuredGameDayRecapProvider;
  qualityTier: RecapQualityTier;
  runtimeConfig: GameDayRecapRuntimeConfig;
}): Promise<GeneratedGameDayRecap> {
  const recapWithoutInterviews = stripPostgameInterviewsFromResult(
    args.generated.result,
  );
  const stylePolishDecision = resolveStylePolishDecision({
    gameCount: recapWithoutInterviews.games.length,
    remainingTimeInMillis: args.remainingTimeInMillis,
    runtimeConfig: args.runtimeConfig,
  });
  const polishedResult = stylePolishDecision.shouldRun
    ? await withGameDayRecapStageTiming(
        "style_polish",
        {
          concurrency: args.runtimeConfig.polishConcurrency,
          gameCount: recapWithoutInterviews.games.length,
          remainingTimeMs: args.remainingTimeInMillis?.() ?? null,
          targetKey: args.logContext?.targetKey,
          userId: args.logContext?.userId,
        },
        () =>
          polishGeneratedGameDayRecapResult({
            concurrency: args.concurrency,
            factStore: args.factStore,
            judgeProvider: args.judgeProvider,
            logContext: args.logContext,
            provider: args.polishProvider,
            qualityTier: args.qualityTier,
            remainingTimeInMillis: args.remainingTimeInMillis,
            result: recapWithoutInterviews,
            runtimeConfig: args.runtimeConfig,
          }),
      )
    : recapWithoutInterviews;
  if (!stylePolishDecision.shouldRun) {
    logGameDayRecapWarn("process.style_polish_skipped_budget", {
      reason: stylePolishDecision.reason,
      remainingTimeMs: args.remainingTimeInMillis?.() ?? null,
      stage: "style-polish",
      targetKey: args.logContext?.targetKey ?? null,
      userId: args.logContext?.userId ?? null,
    });
  }
  const resultWithInterviews = await withGameDayRecapStageTiming(
    "postgame_interviews",
    {
      concurrency: args.runtimeConfig.interviewConcurrency,
      gameCount: polishedResult.games.length,
      remainingTimeMs: args.remainingTimeInMillis?.() ?? null,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    },
    () =>
      attachGuaranteedPostgameInterviews({
        concurrency: args.concurrency,
        factStore: args.factStore,
        judgeProvider: args.judgeProvider,
        logContext: args.logContext,
        provider: args.interviewProvider,
        qualityTier: args.qualityTier,
        result: polishedResult,
        remainingTimeInMillis: args.remainingTimeInMillis,
        runtimeConfig: args.runtimeConfig,
      }),
  );

  return {
    coverageIssues: args.generated.coverageIssues,
    result: resultWithInterviews,
  };
}

function hasRemainingExecutionBudget(
  remainingTimeInMillis: (() => number) | undefined,
  minimumRequiredMs: number,
): boolean {
  if (!remainingTimeInMillis) {
    return true;
  }

  return remainingTimeInMillis() > minimumRequiredMs;
}

function resolveStylePolishDecision(args: {
  gameCount: number;
  remainingTimeInMillis: (() => number) | undefined;
  runtimeConfig: GameDayRecapRuntimeConfig;
}): { reason: string | null; shouldRun: boolean } {
  if (args.runtimeConfig.fullSlatePolishMode === "off") {
    return {
      reason: "mode_off",
      shouldRun: false,
    };
  }
  if (
    args.runtimeConfig.fullSlatePolishMode === "auto" &&
    args.gameCount >= 8
  ) {
    return {
      reason: "full_slate_auto",
      shouldRun: false,
    };
  }
  if (
    !hasRemainingExecutionBudget(
      args.remainingTimeInMillis,
      MIN_REMAINING_MS_FOR_STYLE_POLISH,
    )
  ) {
    return {
      reason: "remaining_time",
      shouldRun: false,
    };
  }

  return {
    reason: null,
    shouldRun: true,
  };
}

function buildSingleGameValidationResult(
  game: GameDayRecapResultGame,
): GameDayRecapResultPayload {
  return {
    games: [game],
    summary: {
      gameOfTheDayMatchId: null,
      gameOfTheDaySurpriseFactor: null,
      headline: game.headline,
      lede: "Single-game recap validation placeholder to recheck grounded recap content.",
    },
  };
}

async function validateStandaloneRecapGame(args: {
  expectedGame: GameDayRecapGameFactStore;
  game: GameDayRecapResultGame;
  judgeLimiter?: BoundedConcurrencyLimiter;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  request: GameDayRecapRequestFacts;
  runtimeConfig: GameDayRecapRuntimeConfig;
  stage:
    | "style-polish"
    | "postgame-interview"
    | "salvage-post-patch"
    | "salvage-post-trim"
    | "writer";
}): Promise<{
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  game: GameDayRecapResultGame;
  judgeIssues: GameDayRecapJudgeValidationIssue[];
}> {
  const result = buildSingleGameValidationResult(args.game);
  const deterministic = assessGameDayRecapDeterministicPayload(
    result,
    [args.expectedGame],
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const judged = await judgeGameDayRecapResultIfEnabled({
    factStore: buildGameDayRecapFactStore({
      games: [args.expectedGame],
      request: args.request,
    }),
    fields:
      args.stage === "postgame-interview"
        ? ["postgameInterview"]
        : ["headline", "writeup", "postgameInterview"],
    judgeLimiter: args.judgeLimiter,
    logContext: args.logContext,
    provider: args.judgeProvider,
    result: deterministic.orderedResult,
    stage: args.stage,
  });

  return {
    deterministicIssues: deterministic.issues,
    game: deterministic.orderedResult.games[0]!,
    judgeIssues: judged.blockingIssues,
  };
}

async function polishGeneratedGameDayRecapResult(args: {
  concurrency: GameDayRecapGenerationConcurrency;
  factStore: GameDayRecapFactStore;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  qualityTier: RecapQualityTier;
  remainingTimeInMillis?: () => number;
  result: GameDayRecapResultPayload;
  runtimeConfig: GameDayRecapRuntimeConfig;
}): Promise<GameDayRecapResultPayload> {
  const expectedGamesByMatchId = new Map(
    args.factStore.games.map((game) => [game.matchId, game]),
  );
  const games = await Promise.all(
    args.result.games.map((game) =>
      args.concurrency.polishLimiter(async () => {
        if (
          !hasRemainingExecutionBudget(
            args.remainingTimeInMillis,
            MIN_REMAINING_MS_FOR_STYLE_POLISH,
          )
        ) {
          logGameDayRecapWarn("process.style_polish_skipped_budget", {
            matchId: game.matchId,
            remainingTimeMs: args.remainingTimeInMillis?.() ?? null,
            stage: "style-polish",
            targetKey: args.logContext?.targetKey ?? null,
            userId: args.logContext?.userId ?? null,
          });
          return game;
        }

        const expectedGame = expectedGamesByMatchId.get(game.matchId);
        if (!expectedGame) {
          return game;
        }

        try {
          const polishedOutput = await args.provider.generate({
            gameFacts: buildGameDayRecapWriterGameFromFactStore({
              game: expectedGame,
              generationApproach: args.factStore.request.generationApproach,
            }),
            recapGame: {
              headline: game.headline,
              matchId: game.matchId,
              writeup: game.writeup,
            },
            request: args.factStore.request,
            task: "style_polish",
          });
          const polishedWriteup =
            normalizeGameDayRecapStylePolishWriteup(polishedOutput);
          if (!polishedWriteup || polishedWriteup === game.writeup) {
            return game;
          }

          const validated = await validateStandaloneRecapGame({
            expectedGame,
            game: {
              ...game,
              writeup: polishedWriteup,
            },
            judgeLimiter: args.concurrency.judgeLimiter,
            judgeProvider: args.judgeProvider,
            logContext: args.logContext,
            request: args.factStore.request,
            runtimeConfig: args.runtimeConfig,
            stage: "style-polish",
          });
          if (
            validated.deterministicIssues.length > 0 ||
            validated.judgeIssues.length > 0
          ) {
            logGameDayRecapWarn("process.style_polish_rejected", {
              deterministicIssues: summarizeGameDayRecapValidationIssuesForLog(
                validated.deterministicIssues,
              ),
              judgeIssues: summarizeGameDayRecapJudgeIssuesForLog(
                validated.judgeIssues,
              ),
              matchId: game.matchId,
              stage: "style-polish",
              targetKey: args.logContext?.targetKey ?? null,
              userId: args.logContext?.userId ?? null,
            });
            return game;
          }

          logGameDayRecapInfo("process.style_polish_applied", {
            matchId: game.matchId,
            targetKey: args.logContext?.targetKey,
            userId: args.logContext?.userId,
          });
          return validated.game;
        } catch (error) {
          logGameDayRecapWarn("process.style_polish_skipped", {
            errorMessage:
              error instanceof Error ? error.message : String(error),
            matchId: game.matchId,
            stage: "style-polish",
            targetKey: args.logContext?.targetKey ?? null,
            userId: args.logContext?.userId ?? null,
          });
          return game;
        }
      }),
    ),
  );

  return {
    ...args.result,
    games,
  };
}

function isSingleGameRecapRequest(request: GameDayRecapRequestFacts): boolean {
  return request.kind === "SINGLE_GAME";
}

function collectGuaranteedPostgameInterviewCandidates(args: {
  game: GameDayRecapGameFactStore;
  request: GameDayRecapRequestFacts;
}): GameDayRecapPromptInterviewCandidate[] {
  const candidates = collectPostgameInterviewCandidates(args.game);
  if (!isSingleGameRecapRequest(args.request)) {
    return candidates;
  }

  const winnerSide = args.game.winner.winnerSide;
  if (!winnerSide) {
    return candidates;
  }
  const loserSide = winnerSide === "home" ? "away" : "home";

  return [
    candidates.find((candidate) => candidate.teamSide === winnerSide) ??
      buildSingleGameFallbackInterviewCandidate({
        game: args.game,
        perspective: "winner",
        teamSide: winnerSide,
      }),
    candidates.find((candidate) => candidate.teamSide === loserSide) ??
      buildSingleGameFallbackInterviewCandidate({
        game: args.game,
        perspective: "loser",
        teamSide: loserSide,
      }),
  ].filter(
    (
      candidate,
    ): candidate is GameDayRecapPromptInterviewCandidate => candidate !== null,
  );
}

function listMissingGuaranteedPostgameInterviewSides(args: {
  candidates: GameDayRecapPromptInterviewCandidate[];
  game: GameDayRecapGameFactStore;
  request: GameDayRecapRequestFacts;
}): Array<"loser" | "winner"> {
  if (!isSingleGameRecapRequest(args.request)) {
    return args.candidates.length ? [] : ["winner"];
  }

  const winnerSide = args.game.winner.winnerSide;
  if (!winnerSide) {
    return args.candidates.length ? [] : ["winner", "loser"];
  }
  const sidesByPerspective = new Set(
    args.candidates.map((candidate) =>
      candidate.teamSide === winnerSide ? "winner" : "loser",
    ),
  );

  const requiredSides: Array<"loser" | "winner"> = ["winner", "loser"];
  return requiredSides.filter(
    (side): side is "loser" | "winner" => !sidesByPerspective.has(side),
  );
}

function buildSingleGameFallbackInterviewCandidate(args: {
  game: GameDayRecapGameFactStore;
  perspective: "loser" | "winner";
  teamSide: "away" | "home";
}): GameDayRecapPromptInterviewCandidate | null {
  const team = args.game.teams[args.teamSide];
  const opponentSide = args.teamSide === "home" ? "away" : "home";
  const opponent = args.game.teams[opponentSide];
  const selectedPlayer = team.topPlayers[0];
  if (!selectedPlayer) {
    return null;
  }

  const statLine = {
    assists: selectedPlayer.assists,
    blocks: selectedPlayer.blocks,
    minutes: selectedPlayer.minutes,
    points: selectedPlayer.points,
    rebounds: selectedPlayer.rebounds,
    steals: selectedPlayer.steals,
    turnovers: selectedPlayer.turnovers,
  };

  return {
    perspective: args.perspective,
    playerId: null,
    playerName: selectedPlayer.name,
    selectionReason: `Single-game fallback ${args.perspective}-side interview candidate for ${team.name}.`,
    statLine,
    supportedFacts: buildSingleGameFallbackInterviewSupportedFacts({
      opponentName: opponent.name,
      perspective: args.perspective,
      playerName: selectedPlayer.name,
      statLine,
      teamName: team.name,
    }),
    teamName: team.name,
    teamSide: args.teamSide,
  };
}

function buildSingleGameFallbackInterviewSupportedFacts(args: {
  opponentName: string;
  perspective: "loser" | "winner";
  playerName: string;
  statLine: GameDayRecapPromptInterviewCandidate["statLine"];
  teamName: string;
}): string[] {
  const facts = new Set<string>();
  facts.add(
    args.perspective === "winner"
      ? `${args.teamName} beat ${args.opponentName}.`
      : `${args.teamName} lost to ${args.opponentName}.`,
  );
  facts.add(
    `${args.playerName} finished with ${args.statLine.points} points.`,
  );
  if (args.statLine.rebounds > 0 || args.statLine.assists > 0) {
    facts.add(
      `${args.playerName} added ${args.statLine.rebounds} rebounds and ${args.statLine.assists} assists.`,
    );
  }
  if (args.statLine.turnovers > 0) {
    facts.add(`${args.playerName} had ${args.statLine.turnovers} turnovers.`);
  }

  return Array.from(facts).slice(0, 4);
}

function buildRetainedPostgameInterviewWarningDetails(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  judgeIssues: GameDayRecapJudgeValidationIssue[];
}): string[] {
  const details = [
    ...args.deterministicIssues
      .slice(0, 3)
      .map((issue) => `Deterministic check: ${issue.reason}`),
    ...args.judgeIssues
      .slice(0, 3)
      .map(
        (issue) =>
          `Judge check: ${
            issue.notes ??
            "One or more interview lines may not be fully supported by the grounded facts."
          }`,
      ),
  ];

  return details.length
    ? details
    : [
        "One or more interview lines may not be fully supported by the grounded facts.",
      ];
}

function withGuaranteedPostgameInterviewCandidate(args: {
  candidate: GameDayRecapPromptInterviewCandidate;
  game: GameDayRecapGameFactStore;
}): GameDayRecapGameFactStore {
  const existingCandidates = collectPostgameInterviewCandidates(args.game);
  if (
    existingCandidates.some(
      (candidate) =>
        candidate.teamSide === args.candidate.teamSide &&
        candidate.playerName === args.candidate.playerName,
    )
  ) {
    return args.game;
  }

  const postgameInterviewCandidates = [...existingCandidates, args.candidate];
  return {
    ...args.game,
    postgameInterviewCandidate:
      postgameInterviewCandidates.find(
        (candidate) => candidate.perspective !== "loser",
      ) ?? null,
    postgameInterviewCandidates,
  };
}

async function attachGuaranteedPostgameInterviews(args: {
  concurrency: GameDayRecapGenerationConcurrency;
  factStore: GameDayRecapFactStore;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  qualityTier: RecapQualityTier;
  remainingTimeInMillis?: () => number;
  result: GameDayRecapResultPayload;
  runtimeConfig: GameDayRecapRuntimeConfig;
}): Promise<GameDayRecapResultPayload> {
  const expectedGamesByMatchId = new Map(
    args.factStore.games.map((game) => [game.matchId, game]),
  );
  const singleGameRequest = isSingleGameRecapRequest(args.factStore.request);
  const requestedOverrides = resolveRequestedInterviewOverridesFromRequest(
    args.factStore.request,
  );
  const games = await Promise.all(
    args.result.games.map((game) =>
      args.concurrency.interviewLimiter(async () => {
        const expectedGame = expectedGamesByMatchId.get(game.matchId);
        if (!expectedGame) {
          return removePostgameInterview(game);
        }
        const candidates = collectGuaranteedPostgameInterviewCandidates({
          game: expectedGame,
          request: args.factStore.request,
        });
        const missingSides = listMissingGuaranteedPostgameInterviewSides({
          candidates,
          game: expectedGame,
          request: args.factStore.request,
        });
        if (!candidates.length) {
          return {
            ...removePostgameInterview(game),
            postgameInterviewDiagnostics: missingSides.length
              ? missingSides.map((side) =>
                  buildPostgameInterviewDiagnostic({
                    reason: "No grounded interview candidate was available.",
                    side,
                    status: "missing_candidate",
                  }),
                )
              : [
                  buildPostgameInterviewDiagnostic({
                    reason: "No grounded interview candidate was available.",
                    side: "winner",
                    status: "missing_candidate",
                  }),
                ],
          };
        }

        const interviews: GameDayRecapResultPostgameInterview[] = [];
        const diagnostics: GameDayRecapPostgameInterviewDiagnostic[] = [];
        for (const rawCandidate of candidates) {
          const candidate = applyRequestedInterviewOverrideToCandidate(
            rawCandidate,
            requestedOverrides,
          );
          const side = candidate.perspective === "loser" ? "loser" : "winner";
          if (
            side === "loser" &&
            args.qualityTier !== "premium" &&
            !singleGameRequest
          ) {
            diagnostics.push(
              buildPostgameInterviewDiagnostic({
                reason: "Losing-side interviews are reserved for premium recaps.",
                side,
                status: "skipped",
              }),
            );
            continue;
          }

          const expectedGameForInterview = withGuaranteedPostgameInterviewCandidate(
            {
              candidate,
              game: expectedGame,
            },
          );
          const interviewResult = await generateGuaranteedPostgameInterview({
            allowSuspectRetention: singleGameRequest,
            candidate,
            expectedGame: expectedGameForInterview,
            game,
            judgeLimiter: args.concurrency.judgeLimiter,
            judgeProvider: args.judgeProvider,
            logContext: args.logContext,
            provider: args.provider,
            remainingTimeInMillis: args.remainingTimeInMillis,
            request: args.factStore.request,
            runtimeConfig: args.runtimeConfig,
          });
          if (interviewResult) {
            interviews.push(interviewResult.interview);
            diagnostics.push(
              buildPostgameInterviewDiagnostic({
                details: interviewResult.details,
                reason: interviewResult.reason,
                side,
                status: interviewResult.status,
              }),
            );
          } else {
            diagnostics.push(
              buildPostgameInterviewDiagnostic({
                reason: "Interview generation did not produce a valid grounded result.",
                side,
                status: "unavailable",
              }),
            );
          }
        }
        for (const side of missingSides) {
          diagnostics.push(
            buildPostgameInterviewDiagnostic({
              reason: "No grounded interview candidate was available.",
              side,
              status: "missing_candidate",
            }),
          );
        }

        const winnerInterview =
          interviews.find(
            (interview) => interview.teamSide === expectedGame.winner.winnerSide,
          ) ?? interviews[0] ?? null;

        return interviews.length
          ? {
              ...game,
              postgameInterview: winnerInterview ?? undefined,
              postgameInterviewDiagnostics: diagnostics,
              postgameInterviews: interviews,
            }
          : {
              ...removePostgameInterview(game),
              postgameInterviewDiagnostics: diagnostics,
            };
      }),
    ),
  );

  return {
    ...args.result,
    games,
  };
}

function buildPostgameInterviewDiagnostic(args: {
  details?: string[];
  reason: string | null;
  side: "loser" | "winner";
  status: GameDayRecapPostgameInterviewDiagnostic["status"];
}): GameDayRecapPostgameInterviewDiagnostic {
  return {
    details: args.details ?? [],
    reason: args.reason,
    side: args.side,
    status: args.status,
  };
}

async function generateGuaranteedPostgameInterview(args: {
  allowSuspectRetention: boolean;
  candidate: GameDayRecapPromptInterviewCandidate;
  expectedGame: GameDayRecapGameFactStore;
  game: GameDayRecapResultGame;
  judgeLimiter: BoundedConcurrencyLimiter;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  remainingTimeInMillis?: () => number;
  request: GameDayRecapRequestFacts;
  runtimeConfig: GameDayRecapRuntimeConfig;
}): Promise<GuaranteedPostgameInterviewResult | null> {
  const fallbackInterview = buildFallbackPostgameInterview({
    candidate: args.candidate,
    expectedGame: args.expectedGame,
    interviewIntensity: args.request.interviewIntensity,
  });
  if (
    !hasRemainingExecutionBudget(
      args.remainingTimeInMillis,
      MIN_REMAINING_MS_FOR_INTERVIEW_GENERATION,
    )
  ) {
    logGameDayRecapWarn("process.postgame_interview_skipped_budget", {
      matchId: args.game.matchId,
      remainingTimeMs: args.remainingTimeInMillis?.() ?? null,
      stage: "postgame-interview",
      targetKey: args.logContext?.targetKey ?? null,
      userId: args.logContext?.userId ?? null,
    });
    if (
      !hasRemainingExecutionBudget(
        args.remainingTimeInMillis,
        MIN_REMAINING_MS_FOR_INTERVIEW_RETRY,
      )
    ) {
      logGameDayRecapWarn("process.postgame_interview_fallback_used", {
        matchId: args.game.matchId,
        reason: "remaining_time",
        stage: "postgame-interview",
        targetKey: args.logContext?.targetKey ?? null,
        userId: args.logContext?.userId ?? null,
      });
      return {
        details: [],
        interview: fallbackInterview,
        reason: null,
        status: "generated",
      };
    }
    return validateFallbackInterview({
      allowSuspectRetention: args.allowSuspectRetention,
      expectedGame: args.expectedGame,
      fallbackInterview,
      game: args.game,
      judgeLimiter: args.judgeLimiter,
      judgeProvider: args.judgeProvider,
      logContext: args.logContext,
      request: args.request,
      runtimeConfig: args.runtimeConfig,
    });
  }
  const writerGameFacts = buildGameDayRecapWriterGameFromFactStore({
    game: args.expectedGame,
    generationApproach: args.request.generationApproach,
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const output = await args.provider.generate({
        candidate: args.candidate,
        gameFacts: writerGameFacts,
        recapGame: {
          headline: args.game.headline,
          matchId: args.game.matchId,
          writeup: args.game.writeup,
        },
        request: args.request,
        task: "postgame_interview",
      });
      const parsed = parseGameDayRecapPostgameInterview({
        input: output,
        matchId: args.game.matchId,
      });
      if (!parsed.interview) {
        logGameDayRecapWarn("process.postgame_interview_retry", {
          attempt,
          details: parsed.warning?.details ?? [],
          matchId: args.game.matchId,
          reason: parsed.warning?.reason ?? "Interview normalization failed.",
          stage: "postgame-interview",
          targetKey: args.logContext?.targetKey ?? null,
          userId: args.logContext?.userId ?? null,
        });
        continue;
      }
      const interview = withAppliedInterviewPersonalityMetadata(
        parsed.interview,
        args.candidate,
      );

      const validated = await validateStandaloneRecapGame({
        expectedGame: args.expectedGame,
        game: withPostgameInterviewForValidation(args.game, interview),
        judgeProvider: args.judgeProvider,
        judgeLimiter: args.judgeLimiter,
        logContext: args.logContext,
        request: args.request,
        runtimeConfig: args.runtimeConfig,
        stage: "postgame-interview",
      });
      if (
        validated.deterministicIssues.length === 0 &&
        validated.judgeIssues.length === 0
      ) {
        return {
          details: [],
          interview,
          reason: null,
          status: "generated",
        };
      }

      logGameDayRecapWarn("process.postgame_interview_retry", {
        attempt,
        deterministicIssues: summarizeGameDayRecapValidationIssuesForLog(
          validated.deterministicIssues,
        ),
        judgeIssues: summarizeGameDayRecapJudgeIssuesForLog(
          validated.judgeIssues,
        ),
        matchId: args.game.matchId,
        reason: "Generated interview did not pass validation.",
        stage: "postgame-interview",
        targetKey: args.logContext?.targetKey ?? null,
        userId: args.logContext?.userId ?? null,
      });
      if (
        attempt === 1 &&
        !hasRemainingExecutionBudget(
          args.remainingTimeInMillis,
          MIN_REMAINING_MS_FOR_INTERVIEW_RETRY,
        )
      ) {
        break;
      }
    } catch (error) {
      logGameDayRecapWarn("process.postgame_interview_retry", {
        attempt,
        errorMessage: error instanceof Error ? error.message : String(error),
        matchId: args.game.matchId,
        reason: "Generated interview request failed.",
        stage: "postgame-interview",
        targetKey: args.logContext?.targetKey ?? null,
        userId: args.logContext?.userId ?? null,
      });
      if (
        attempt === 1 &&
        !hasRemainingExecutionBudget(
          args.remainingTimeInMillis,
          MIN_REMAINING_MS_FOR_INTERVIEW_RETRY,
        )
      ) {
        break;
      }
    }
  }

  return validateFallbackInterview({
    allowSuspectRetention: args.allowSuspectRetention,
    expectedGame: args.expectedGame,
    fallbackInterview,
    game: args.game,
    judgeLimiter: args.judgeLimiter,
    judgeProvider: args.judgeProvider,
    logContext: args.logContext,
    request: args.request,
    runtimeConfig: args.runtimeConfig,
  });
}

async function validateFallbackInterview(args: {
  allowSuspectRetention: boolean;
  expectedGame: GameDayRecapGameFactStore;
  fallbackInterview: GameDayRecapResultPostgameInterview;
  game: GameDayRecapResultGame;
  judgeLimiter: BoundedConcurrencyLimiter;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  request: GameDayRecapRequestFacts;
  runtimeConfig: GameDayRecapRuntimeConfig;
}): Promise<GuaranteedPostgameInterviewResult | null> {
  const validatedFallback = await validateStandaloneRecapGame({
    expectedGame: args.expectedGame,
    game: withPostgameInterviewForValidation(
      args.game,
      args.fallbackInterview,
    ),
    judgeLimiter: args.judgeLimiter,
    judgeProvider: args.judgeProvider,
    logContext: args.logContext,
    request: args.request,
    runtimeConfig: args.runtimeConfig,
    stage: "postgame-interview",
  });
  if (
    validatedFallback.deterministicIssues.length === 0 &&
    validatedFallback.judgeIssues.length === 0
  ) {
    logGameDayRecapWarn("process.postgame_interview_fallback_used", {
      matchId: args.game.matchId,
      stage: "postgame-interview",
      targetKey: args.logContext?.targetKey ?? null,
      userId: args.logContext?.userId ?? null,
    });
    return {
      details: [],
      interview: args.fallbackInterview,
      reason: null,
      status: "generated",
    };
  }

  if (args.allowSuspectRetention) {
    logGameDayRecapWarn("process.postgame_interview_retained_with_warnings", {
      deterministicIssues: summarizeGameDayRecapValidationIssuesForLog(
        validatedFallback.deterministicIssues,
      ),
      judgeIssues: summarizeGameDayRecapJudgeIssuesForLog(
        validatedFallback.judgeIssues,
      ),
      matchId: args.game.matchId,
      stage: "postgame-interview",
      targetKey: args.logContext?.targetKey ?? null,
      userId: args.logContext?.userId ?? null,
    });
    return {
      details: buildRetainedPostgameInterviewWarningDetails({
        deterministicIssues: validatedFallback.deterministicIssues,
        judgeIssues: validatedFallback.judgeIssues,
      }),
      interview: args.fallbackInterview,
      reason: "Interview was kept despite validation warnings.",
      status: "suspect",
    };
  }

  logGameDayRecapWarn("process.postgame_interview_unavailable", {
    deterministicIssues: summarizeGameDayRecapValidationIssuesForLog(
      validatedFallback.deterministicIssues,
    ),
    judgeIssues: summarizeGameDayRecapJudgeIssuesForLog(
      validatedFallback.judgeIssues,
    ),
    matchId: args.game.matchId,
    stage: "postgame-interview",
    targetKey: args.logContext?.targetKey ?? null,
    userId: args.logContext?.userId ?? null,
  });
  return null;
}

function withPostgameInterviewForValidation(
  game: GameDayRecapResultGame,
  interview: GameDayRecapResultPostgameInterview,
): GameDayRecapResultGame {
  const validationGame = {
    ...removePostgameInterview(game),
    postgameInterviews: [interview],
  };
  return interview.teamSide === game.postgameInterview?.teamSide
    ? {
        ...validationGame,
        postgameInterview: interview,
      }
    : validationGame;
}

function withAppliedInterviewPersonalityMetadata(
  interview: GameDayRecapResultPostgameInterview,
  candidate: GameDayRecapPromptInterviewCandidate,
): GameDayRecapResultPostgameInterview {
  const personalityType = isInterviewPersonalityType(candidate.personalityType)
    ? candidate.personalityType
    : null;
  if (!personalityType) {
    return interview;
  }

  const personalitySource = isInterviewPersonalitySource(
    candidate.personalitySource,
  )
    ? candidate.personalitySource
    : "auto";
  return {
    ...interview,
    personalitySource,
    personalityType,
  };
}

function buildFallbackPostgameInterview(args: {
  candidate: GameDayRecapPromptInterviewCandidate;
  expectedGame: GameDayRecapGameFactStore;
  interviewIntensity: RecapInterviewIntensityValue;
}): GameDayRecapResultPostgameInterview {
  if (args.candidate.perspective === "loser") {
    return withAppliedInterviewPersonalityMetadata({
      playerName: args.candidate.playerName,
      qa: [
        {
          answer: buildFallbackLosingInterviewAnswer(
            args.candidate,
            args.interviewIntensity,
          ),
          question: "Where did this one get away from you?",
        },
        {
          answer: buildFallbackAdjustmentInterviewAnswer(
            args.candidate,
            args.interviewIntensity,
          ),
          question: "What has to change for the next game?",
        },
      ],
      teamName: args.candidate.teamName,
      teamSide: args.candidate.teamSide,
      title: `${args.candidate.playerName} on ${args.candidate.teamName}'s response`,
    }, args.candidate);
  }

  const winningRun =
    args.expectedGame.playByPlayFacts?.primaryRun?.teamSide ===
    args.candidate.teamSide
      ? args.expectedGame.playByPlayFacts.primaryRun
      : args.expectedGame.playByPlayFacts?.secondaryRun?.teamSide ===
          args.candidate.teamSide
        ? args.expectedGame.playByPlayFacts.secondaryRun
        : null;
  const qa: GameDayRecapResultPostgameInterview["qa"] = [
    {
      answer: buildFallbackInterviewStatAnswer(
        args.candidate,
        args.interviewIntensity,
      ),
      question: buildFallbackInterviewStatQuestion(args.candidate),
    },
  ];

  if (winningRun) {
    qa.push({
      answer: buildFallbackInterviewRunAnswer(
        winningRun,
        args.candidate,
        args.interviewIntensity,
      ),
      question: buildFallbackInterviewRunQuestion(winningRun),
    });
  }

  return withAppliedInterviewPersonalityMetadata({
    playerName: args.candidate.playerName,
    qa,
    teamName: args.candidate.teamName,
    teamSide: args.candidate.teamSide,
    title: `${args.candidate.playerName} on ${args.candidate.teamName}'s win`,
  }, args.candidate);
}

function buildFallbackLosingInterviewAnswer(
  candidate: GameDayRecapPromptInterviewCandidate,
  interviewIntensity: RecapInterviewIntensityValue,
): string {
  const statSummary = summarizeInterviewStatLine(candidate.statLine);
  switch (candidate.personalityType ?? "friendly") {
    case "curt":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `We let it slip. I had ${statSummary}.`,
        full_heat: `We let it slip. I had ${statSummary}. That cannot happen again.`,
        pg13: `We let it slip. I had ${statSummary}. That is on us.`,
      });
    case "friendly":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `We had our chances, but the rough stretches added up. I had ${statSummary}, and we have to turn that into winning possessions next time.`,
        full_heat: `We had enough to win and still let the game drift. I had ${statSummary}, but that is just decoration if we let them leave feeling loud.`,
        pg13: `We had enough on the table to win it. I had ${statSummary}, but we have to stop letting rough stretches hand people confidence.`,
      });
    case "rambling":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `It was one of those games where it kept feeling like one steady stretch could put us back on top, but the rough patches kept stacking up before we could truly settle. I had ${statSummary}, and we needed to string together more of the right possessions.`,
        full_heat: `It was the kind of game where the door kept swinging open just wide enough for us to reclaim it, and every time we reached for the handle we left a finger in the frame. I had ${statSummary}, but we spent too many possessions letting them believe they were authors of the ending.`,
        pg13: `It felt like the game kept offering us one clean runway back into control, and every time we started down it another sloppy patch rose up like a toll booth. I had ${statSummary}, but we needed a longer stretch of grown-up possessions.`,
      });
    case "nonsensical":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `The game got wobbly on us for a while, and once it tipped the wrong direction we never quite got both hands back on it. I had ${statSummary}, but we needed steadier trips when it got strange.`,
        full_heat: `The game turned into a shopping cart with one busted wheel, and instead of kicking it straight we kept pretending it was gliding. I had ${statSummary}, but the ugly minutes wrote the headline for us.`,
        pg13: `The game started walking around sideways on us, and instead of grabbing it by the collar we kept letting it knock lamps over. I had ${statSummary}, but we needed saner possessions when the room got weird.`,
      });
    case "excited":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `It hurts because it felt right there for us, but the game swung away in a few big moments. I had ${statSummary}, and we have to answer those stretches better next time.`,
        full_heat: `It stings because I still felt the game sitting in reach, and then we gave them just enough oxygen to start acting like kings. I had ${statSummary}, and we have to punch back harder the next time the rope gets tight.`,
        pg13: `It burns because it felt right there for us and then the game flipped on a few huge possessions. I had ${statSummary}, and we have to answer those swings like a serious team next time.`,
      });
    case "braggart":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `I still believed I could tilt it back our way, but ${statSummary} does not mean much when we let the game drift in the wrong moments.`,
        full_heat: `I still knew I was good enough to drag us back into control, but ${statSummary} is just expensive wallpaper if we let them start crowing like they solved me.`,
        pg13: `I still felt like I could flip the whole room by myself, but ${statSummary} is just window dressing if we let the game swing away from us.`,
      });
    case "swaggering":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `I still felt like we were one clean stretch away from taking the wheel back, but ${statSummary} does not shine the same in a loss.`,
        full_heat: `I still felt the game leaning toward my tempo, but ${statSummary} does not sparkle when you let the other side walk out grinning like they discovered fire.`,
        pg13: `I still felt like the game wanted to dance to our beat, but ${statSummary} loses its shine when you let the ending slip out of your hands.`,
      });
    case "earnest":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `I was just trying to give the group a lift, and I ended up with ${statSummary}, but we needed a better team response in the moments that decided it.`,
        full_heat: `I was trying to pour everything I had into the group, and it turned into ${statSummary}, but we did not meet the game with the discipline the moment demanded.`,
        pg13: `I was trying to give the group a real lift, and it turned into ${statSummary}, but we needed a sharper team response in the possessions that decided it.`,
      });
    case "stoic":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `They won the key stretches. I had ${statSummary}, but we needed cleaner possessions when the game tightened.`,
        full_heat: `They won the key stretches because we allowed it. I had ${statSummary}, but the critical possessions were not clean enough.`,
        pg13: `They won the key stretches. I had ${statSummary}, but we were not sharp enough when the game hardened.`,
      });
    case "cagey":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `There were a few stretches we will want back. I had ${statSummary}, but the bigger thing is cleaning up what we can control.`,
        full_heat: `There were a few ugly turns in that game that I am sure both teams noticed. I had ${statSummary}, but the louder lesson is in the possessions we handed away.`,
        pg13: `There were a couple stretches we will want back. I had ${statSummary}, but the bigger thing is cleaning up what we can control before people get too comfortable.`,
      });
    case "deadpan":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `They made the bigger run. I had ${statSummary}. That was not enough.`,
        full_heat: `They made the bigger run. I had ${statSummary}. Apparently that was the part we chose to waste.`,
        pg13: `They made the bigger run. I had ${statSummary}. Turns out that was still not enough.`,
      });
    case "reflective":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: `The game turned when we stopped getting clean trips in a row. I had ${statSummary}, but we needed a fuller response.`,
        full_heat: `Marcus Aurelius would probably call it a failure of discipline. We stopped stacking clean possessions, and the whole thing slid. I had ${statSummary}, but our collective response arrived late.`,
        pg13: `The game turned when we stopped stringing together clean trips. I had ${statSummary}, but the response needed more force and more composure.`,
      });
  }
}

function buildFallbackAdjustmentInterviewAnswer(
  candidate: GameDayRecapPromptInterviewCandidate,
  interviewIntensity: RecapInterviewIntensityValue,
): string {
  switch (candidate.personalityType ?? "friendly") {
    case "curt":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "Cleaner possessions. Better ending.",
        full_heat: "Cleaner possessions. Colder blood. Different ending.",
        pg13: "Cleaner possessions. More pressure. Different ending.",
      });
    case "friendly":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "We have to settle the game down sooner, clean up the rough trips, and make sure the next response comes from us.",
        full_heat: "We have to steady the game sooner, stop gifting people confidence, and answer with enough force that the whole building feels the change.",
        pg13: "We have to steady the game sooner, clean up the messy trips, and make sure the next punch lands from us.",
      });
    case "rambling":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "It starts with not letting one shaky possession invite a second and then a third, because once the game smells hesitation it starts multiplying it, so the answer is a calmer and more connected stretch earlier.",
        full_heat: "It starts with refusing to let one crooked possession grow cousins, because the moment a tight game thinks it has found fear it starts feasting, and we gave it too much to chew on tonight.",
        pg13: "It starts with not letting one bad trip sprout branches, because once a close game smells uncertainty it keeps coming back for more, and we have to shut that door earlier next time.",
      });
    case "nonsensical":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "We need straighter wheels, louder brakes, and fewer wandering possessions next time.",
        full_heat: "We need to stop decorating the runway with banana peels and then acting surprised when the landing skids into a fence.",
        pg13: "We need straighter wheels, fewer circus possessions, and a better grip on the rope when the game starts swinging.",
      });
    case "excited":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "We have to answer the swing moments faster and come back with more force the next time the game gets loud.",
        full_heat: "We have to hit the next swing harder, faster, and with enough bite that nobody on the other bench starts feeling brave.",
        pg13: "We have to answer the swing moments faster and hit back hard enough that the whole game tilts with us next time.",
      });
    case "braggart":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "The fix is simple: tighten the loose stretches and let our best players decide the ending.",
        full_heat: "The fix is simple: stop leaving the door cracked and let the real shot-makers write the obituary next time.",
        pg13: "The fix is simple: tighten the sloppy stretches and let the killers decide the ending next time.",
      });
    case "swaggering":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "We need a cleaner rhythm late and a steadier hand when the game starts wobbling.",
        full_heat: "We need a cleaner rhythm late and enough nerve to snatch the spotlight back before the other side starts mugging for it.",
        pg13: "We need a cleaner rhythm late and enough swagger to snatch the spotlight back before the other side gets too comfortable in it.",
      });
    case "earnest":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "We have to be more disciplined in the possessions that test our connection, because that is where good teams show who they are.",
        full_heat: "We have to meet those pressure possessions with a deeper kind of discipline, because talent without collective nerve is just noise.",
        pg13: "We have to be more disciplined in the possessions that test our connection, because that is where serious teams separate themselves.",
      });
    case "stoic":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "Execute better. Finish better.",
        full_heat: "Execute better. Finish better. Leave no doubt.",
        pg13: "Execute better. Finish better. End the argument earlier.",
      });
    case "cagey":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "We know what has to be cleaned up. The important part is doing it before the next close one asks the same question.",
        full_heat: "We know exactly what needs to change. I am not going to publish the answer for our opponents, but they will see it soon enough.",
        pg13: "We know what has to change. I am not going to hand out the blueprint, but it had better look different next time.",
      });
    case "deadpan":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "Fewer mistakes. More winning.",
        full_heat: "Fewer mistakes. Less charity. More winning.",
        pg13: "Fewer mistakes. More pressure. More winning.",
      });
    case "reflective":
      return pickInterviewIntensityVariant(interviewIntensity, {
        clean: "The answer is better possession discipline. Games like this usually turn on a handful of choices, and ours need to be stronger.",
        full_heat: "The answer is better possession discipline. History is usually written by the team that keeps its nerve in the tightest five minutes, and tonight we let someone else hold the pen.",
        pg13: "The answer is better possession discipline. Games like this turn on a handful of choices, and ours need more force and more clarity.",
      });
  }
}

function summarizeInterviewStatLine(
  statLine: GameDayRecapPromptInterviewCandidate["statLine"],
): string {
  const parts = [
    statLine.points > 0 ? `${statLine.points} points` : null,
    statLine.rebounds > 0 ? `${statLine.rebounds} rebounds` : null,
    statLine.assists > 0 ? `${statLine.assists} assists` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? joinNaturalLanguage(parts) : "my minutes";
}

function buildFallbackInterviewStatQuestion(
  candidate: GameDayRecapPromptInterviewCandidate,
): string {
  const statHighlights: string[] = [];
  if (candidate.statLine.points > 0) {
    statHighlights.push(`${candidate.statLine.points} points`);
  }
  if (candidate.statLine.rebounds > 0) {
    statHighlights.push(`${candidate.statLine.rebounds} rebounds`);
  }
  if (candidate.statLine.assists > 0) {
    statHighlights.push(`${candidate.statLine.assists} assists`);
  }

  if (statHighlights.length === 0) {
    return "From your perspective, what was working for you out there tonight?";
  }

  return ensureQuestion(
    `You finished with ${joinNaturalLanguage(statHighlights.slice(0, 3))}. What was working for you out there tonight`,
  );
}

function buildFallbackInterviewRunQuestion(
  run: NonNullable<GameDayRecapPlayByPlayFacts["primaryRun"]>,
): string {
  const timeRange = formatInterviewRunTimeRange(run);
  const runLabel = `${run.teamPoints}-${run.opponentPoints}`;
  if (timeRange) {
    return ensureQuestion(
      `During that ${runLabel} stretch ${timeRange}, what changed for your group`,
    );
  }

  return ensureQuestion(
    `That ${runLabel} stretch seemed to swing the game. What changed for your group there`,
  );
}

function buildFallbackInterviewStatAnswer(
  candidate: GameDayRecapPromptInterviewCandidate,
  interviewIntensity: RecapInterviewIntensityValue,
): string {
  const statParts: string[] = [];
  if (candidate.statLine.points > 0) {
    statParts.push(`${candidate.statLine.points} points`);
  }
  if (candidate.statLine.rebounds > 0) {
    statParts.push(`${candidate.statLine.rebounds} rebounds`);
  }
  if (candidate.statLine.assists > 0) {
    statParts.push(`${candidate.statLine.assists} assists`);
  }
  if (candidate.statLine.steals > 0) {
    statParts.push(`${candidate.statLine.steals} steals`);
  }
  if (candidate.statLine.blocks > 0) {
    statParts.push(`${candidate.statLine.blocks} blocks`);
  }

  const statSummary =
    statParts.length > 0
      ? applyInterviewPersonalityTone({
          candidate,
          interviewIntensity,
          kind: "stat",
          statSummary: joinNaturalLanguage(statParts.slice(0, 4)),
        })
      : applyInterviewPersonalityTone({
          candidate,
          interviewIntensity,
          kind: "stat",
          statSummary: null,
        });

  return ensureSentence(statSummary);
}

function buildFallbackInterviewRunAnswer(
  run: NonNullable<GameDayRecapPlayByPlayFacts["primaryRun"]>,
  candidate?: GameDayRecapPromptInterviewCandidate,
  interviewIntensity: RecapInterviewIntensityValue = RecapInterviewIntensity.PG13,
): string {
  const timeRange = formatInterviewRunTimeRange(run);
  return ensureSentence(
    applyInterviewPersonalityTone({
      candidate: candidate ?? null,
      interviewIntensity,
      kind: "run",
      run,
      statSummary: null,
      timeRange,
    }),
  );
}

function applyInterviewPersonalityTone(args: {
  candidate: GameDayRecapPromptInterviewCandidate | null | undefined;
  interviewIntensity: RecapInterviewIntensityValue;
  kind: "run" | "stat";
  run?: NonNullable<GameDayRecapPlayByPlayFacts["primaryRun"]>;
  statSummary: string | null;
  timeRange?: string | null;
}): string {
  const personalityType = args.candidate?.personalityType ?? "friendly";
  const interviewIntensity = normalizeFallbackInterviewIntensity(
    args.interviewIntensity,
  );

  if (args.kind === "stat") {
    switch (personalityType) {
      case "curt":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `Best player on the floor. ${args.statSummary}.`,
              full_heat: `They had no answer. ${args.statSummary}. Next question.`,
              pg13: `Best player on the floor. ${args.statSummary}. Next question.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I made the right plays.",
              full_heat: "I kept cutting the lights on them.",
              pg13: "I stayed aggressive. That was enough.",
            });
      case "rambling":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `It felt like one of those nights where every sturdy read opened another little side door, and by the time the whole hallway finished unfolding it had somehow become ${args.statSummary}.`,
              full_heat: `It felt like one of those nights where every clean read opened another trapdoor under their feet, and by the time the smoke cleared the official record had to call it ${args.statSummary}.`,
              pg13: `It felt like one of those nights where every good read opened another lane, another pass, another little crack in their foundation, and by the time the whole thing finished tipping it had turned into ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "It felt like the game kept unfolding if we stayed patient enough to let the next read introduce itself.",
              full_heat: "It felt like the game kept handing us their secrets one shaky possession at a time if we were patient enough to keep listening.",
              pg13: "It felt like the game kept opening up for us if we were patient enough not to ruin our own advantage.",
            });
      case "nonsensical":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `The game felt like steering a parade float through crosswind, and somehow it still rolled into ${args.statSummary}.`,
              full_heat: `The game turned into a velvet chainsaw recital, and the final paperwork still had the nerve to call it ${args.statSummary}.`,
              pg13: `The game felt like a thunderstorm trying to dribble, and by the end the official record swore it had become ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "The game had a sideways rhythm to it, and we finally got the wheels pointed the same direction.",
              full_heat: "The game sounded like pots and pans falling down a staircase, and eventually we found the beat hidden inside the noise.",
              pg13: "The game got weird in a hurry, and we eventually grabbed the weirdness by the steering wheel.",
            });
      case "excited":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `Man, I felt alive out there, and once the first couple reads landed it turned into ${args.statSummary}.`,
              full_heat: `Man, I was a live wire with sneakers tonight, and they were trying to catch thunder with oven mitts. ${args.statSummary}.`,
              pg13: `Man, I was on fire, the whole gym could feel it, and once I smelled the rhythm it turned into ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I felt great out there and tried to bring energy every trip.",
              full_heat: "I felt the game buzzing in my teeth, and once that happens somebody is getting run over.",
              pg13: "I felt great out there and kept trying to bring real pressure every trip.",
            });
      case "braggart":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `I knew I was the best option on the floor, and ${args.statSummary} was the receipt.`,
              full_heat: `I was the best player in the building by a disrespectful margin. They were guessing, I was dictating, and ${args.statSummary} was the paperwork.`,
              pg13: `I was unstoppable tonight. They kept seeing the same problem, and ${args.statSummary} was the invoice.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I trusted my game and kept pressing the advantage.",
              full_heat: "I knew exactly who owned the matchup. They were reacting to me from the opening tip.",
              pg13: "I knew the matchup was mine from the jump and I kept leaning on it.",
            });
      case "swaggering":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `Once the rhythm started dressing in my colors, it turned into ${args.statSummary}.`,
              full_heat: `I had the whole game wearing my cologne by halftime, and ${args.statSummary} was just the shine left on the glass.`,
              pg13: `Once the rhythm put my name on it, the whole court started moving to my tempo and it turned into ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "Once I found the groove, I kept letting the game come to me.",
              full_heat: "Once the floor started breathing at my tempo, the rest of it was fashion.",
              pg13: "Once I found the groove, I let the whole game slide into my rhythm.",
            });
      case "earnest":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `I was trying to serve the group possession by possession, and tonight that work showed up as ${args.statSummary}.`,
              full_heat: `I was trying to pour conviction into the group on every trip, and tonight that responsibility turned into ${args.statSummary}.`,
              pg13: `I was trying to give the group real force and real calm on every trip, and tonight that work turned into ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I was just trying to help the group however I could.",
              full_heat: "I was trying to meet the game with everything the group needed from me.",
              pg13: "I was just trying to help the group in every way the game asked.",
            });
      case "stoic":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `The reads were clean. It became ${args.statSummary}.`,
              full_heat: `We broke their equation a possession at a time. It became ${args.statSummary}.`,
              pg13: `We applied pressure, kept the math honest, and it became ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I stayed with the plan and took what was there.",
              full_heat: "I stayed on script until their resistance stopped mattering.",
              pg13: "I stayed with the plan and kept pressure on the weak spots.",
            });
      case "deadpan":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `They kept leaving options on the table. I took a few. ${args.statSummary}.`,
              full_heat: `They treated me like a rumor. The box score corrected that. ${args.statSummary}.`,
              pg13: `They kept offering the same mistake. I kept accepting. ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I kept playing and a few things worked out.",
              full_heat: "I kept showing up in the same spots. Apparently that was exhausting for them.",
              pg13: "I kept showing up where they did not want me. That usually helps.",
            });
      case "reflective":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `There is a Stoic line about keeping your hands on what is yours to control. Tonight the next read was in my hands, and it became ${args.statSummary}.`,
              full_heat: `Heraclitus said everything flows. Tonight their defense flowed exactly where I wanted, and that became ${args.statSummary}.`,
              pg13: `Marcus Aurelius would say the obstacle becomes the way. Tonight they were the obstacle and ${args.statSummary} became the way.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I thought the game slowed down once we trusted the next pass and the next rotation.",
              full_heat: "I thought the game revealed itself once we stopped arguing with the current and started steering it.",
              pg13: "I thought the game settled once we stopped forcing it and started trusting the next clean read.",
            });
      case "cagey":
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `I saw a couple openings and kept pulling the right thread. It came out to ${args.statSummary}.`,
              full_heat: `I knew where the leak was by the second quarter. I am not naming it for them, but it turned into ${args.statSummary}.`,
              pg13: `They showed me a few habits, and I will let them watch the film to figure out which ones turned into ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I just tried to read what they were giving us and stay patient.",
              full_heat: "I saw enough early. The rest is for our room, not theirs.",
              pg13: "I just kept reading what they were giving us and kept a few details to myself.",
            });
      case "friendly":
      default:
        return args.statSummary
          ? pickInterviewIntensityVariant(interviewIntensity, {
              clean: `I was smiling out there because the game kept rewarding the simple read, and it turned into ${args.statSummary}.`,
              full_heat: `The night opened its front door for me, I walked right through it, and it turned into ${args.statSummary}.`,
              pg13: `I felt the rhythm early, kept stepping on the gas, and it turned into ${args.statSummary}.`,
            })
          : pickInterviewIntensityVariant(interviewIntensity, {
              clean: "I just tried to stay active and make the right play every trip.",
              full_heat: "I stayed loose, stayed sharp, and kept making them pay for every late step.",
              pg13: "I stayed active, stayed loose, and kept pressing every good read I saw.",
            });
    }
  }

  const run = args.run!;
  const runLabel = `${run.teamPoints}-${run.opponentPoints}`;
  switch (personalityType) {
    case "curt":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} was us locking in.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} was the part where they ran out of answers.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} was where we broke it open.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch was us locking in.`,
            full_heat: `That ${runLabel} stretch was where they ran out of answers.`,
            pg13: `That ${runLabel} stretch was where we broke it open.`,
          });
    case "rambling":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} was the part where the game started tilting because every stop seemed to lead to another calm possession and another inch of leverage.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} was the part where the whole game started folding like wet cardboard, because every stop turned into another little sermon on why they could not live with our pace.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} was the part where the whole game started leaning our way, because every stop led to another clean hit and another crack in their confidence.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch was the point where the game started tilting because every stop seemed to lead to another composed possession.`,
            full_heat: `That ${runLabel} stretch was the point where the game started folding because every stop sounded like another board coming loose beneath them.`,
            pg13: `That ${runLabel} stretch was the point where the game started tilting because every stop seemed to lead to another clean punch.`,
          });
    case "nonsensical":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} changed the temperature of the whole room, and once it tilted warm our way we kept both hands on the thermostat.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} turned the game into a house fire with sneakers, and they spent the rest of the night trying to pat smoke back into a wall.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} changed the weather of the whole game, and once the storm leaned our way we kept steering the clouds.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch changed the temperature of the whole room, and once it tilted warm our way we stayed on it.`,
            full_heat: `That ${runLabel} stretch turned the game into smoke and panic, and they never found the windows.`,
            pg13: `That ${runLabel} stretch changed the weather of the whole game, and we stayed in command of it.`,
          });
    case "excited":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} gave us a huge burst of life, and from there the whole place felt like it belonged to us.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} was the lightning strike. After that they were just trying to stand under the same tree and pretend they were dry.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} gave us a massive jolt, and after that we rode the game like it already knew our name.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch gave us a huge burst of life and we rode it.`,
            full_heat: `That ${runLabel} stretch was the lightning bolt. After that they were just squinting at the damage.`,
            pg13: `That ${runLabel} stretch gave us a huge jolt and we kept riding it.`,
          });
    case "braggart":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} was us taking over, plain and simple.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} was the moment the game signed its name over to us. They were spectators after that.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} was us taking the game by the throat and not giving it back.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch was us taking over, plain and simple.`,
            full_heat: `That ${runLabel} stretch was the game admitting who the boss was.`,
            pg13: `That ${runLabel} stretch was us taking the game by the throat.`,
          });
    case "swaggering":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} was when the game started moving to our rhythm.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} was when the whole court started walking to our beat and they got stuck clapping on the wrong count.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} was when the game started dancing to our rhythm and they could not find the step.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch was when the game started moving to our rhythm.`,
            full_heat: `That ${runLabel} stretch was when the court started dressing in our colors.`,
            pg13: `That ${runLabel} stretch was when the game started dancing to our rhythm.`,
          });
    case "earnest":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} came from everybody staying connected on both ends.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} came from everybody honoring the work hard enough to make the other side feel every inch of it.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} came from everybody staying connected and refusing to let the pressure loosen.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch came from everybody staying connected on both ends.`,
            full_heat: `That ${runLabel} stretch came from collective nerve and collective discipline.`,
            pg13: `That ${runLabel} stretch came from everybody staying connected and leaning into the pressure.`,
          });
    case "stoic":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `We stayed patient during that ${runLabel} stretch ${args.timeRange} and kept the pressure on.`,
            full_heat: `We stayed patient during that ${runLabel} stretch ${args.timeRange} and removed their choices one possession at a time.`,
            pg13: `We stayed patient during that ${runLabel} stretch ${args.timeRange} and kept grinding the edges off them.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `We stayed patient during that ${runLabel} stretch and kept the pressure on.`,
            full_heat: `We stayed patient during that ${runLabel} stretch and removed their choices.`,
            pg13: `We stayed patient during that ${runLabel} stretch and kept grinding.`,
          });
    case "deadpan":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} helped.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} helped them understand the evening a little better.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} was fairly informative for everyone involved.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch helped.`,
            full_heat: `That ${runLabel} stretch clarified a few things.`,
            pg13: `That ${runLabel} stretch was fairly informative.`,
          });
    case "reflective":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} mattered because we stopped rushing and made them work through every trip.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} mattered because, as the old philosophers would say, form finally conquered panic and left them arguing with the scoreboard.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} mattered because we stopped rushing, trusted the order of things, and made them live inside every possession.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch mattered because we stopped rushing and made them work through every trip.`,
            full_heat: `That ${runLabel} stretch mattered because we replaced panic with order and they had no counterargument.`,
            pg13: `That ${runLabel} stretch mattered because we stopped rushing and made them live inside every possession.`,
          });
    case "cagey":
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch ${args.timeRange} came from sticking with what we liked and not forcing the game.`,
            full_heat: `That ${runLabel} stretch ${args.timeRange} came from leaning on a pressure point they still have not found on the map.`,
            pg13: `That ${runLabel} stretch ${args.timeRange} came from sticking with what we liked and quietly pressing the bruise they kept showing us.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `That ${runLabel} stretch came from sticking with what we liked and not forcing the game.`,
            full_heat: `That ${runLabel} stretch came from pressing a secret they have not earned the right to hear out loud.`,
            pg13: `That ${runLabel} stretch came from sticking with what we liked and pressing the bruise they kept handing us.`,
          });
    case "friendly":
    default:
      return args.timeRange
        ? pickInterviewIntensityVariant(interviewIntensity, {
            clean: `We stayed patient and kept the pressure on during that ${runLabel} stretch ${args.timeRange}.`,
            full_heat: `We stayed patient and kept leaning until the whole game started tilting like it knew exactly who was stronger during that ${runLabel} stretch ${args.timeRange}.`,
            pg13: `We stayed patient and kept the pressure on during that ${runLabel} stretch ${args.timeRange}, and once it tipped our way we kept our foot on the gas.`,
          })
        : pickInterviewIntensityVariant(interviewIntensity, {
            clean: `We stayed patient and kept the pressure on during that ${runLabel} stretch.`,
            full_heat: `We stayed patient and leaned until the whole game admitted who was stronger during that ${runLabel} stretch.`,
            pg13: `We stayed patient and kept the pressure on during that ${runLabel} stretch.`,
          });
  }
}

function normalizeFallbackInterviewIntensity(
  intensity: InterviewIntensity | RecapInterviewIntensityValue | null | undefined,
): InterviewIntensity {
  if (intensity === RecapInterviewIntensity.CLEAN) {
    return "clean";
  }
  if (intensity === RecapInterviewIntensity.FULL_HEAT) {
    return "full_heat";
  }
  return "pg13";
}

function pickInterviewIntensityVariant<T>(
  intensity: InterviewIntensity | RecapInterviewIntensityValue | null | undefined,
  variants: {
    clean: T;
    full_heat: T;
    pg13: T;
  },
): T {
  switch (normalizeFallbackInterviewIntensity(intensity)) {
    case "clean":
      return variants.clean;
    case "full_heat":
      return variants.full_heat;
    case "pg13":
    default:
      return variants.pg13;
  }
}

function joinNaturalLanguage(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

async function generateValidatedGameDayRecap(args: {
  concurrency: GameDayRecapGenerationConcurrency;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  payload: GameDayRecapPromptPayload;
  provider: StructuredGameDayRecapProvider;
  runtimeConfig: GameDayRecapRuntimeConfig;
}): Promise<GeneratedGameDayRecap> {
  const factStore = resolvePayloadFactStore(args.payload);
  const initialOutput = await withGameDayRecapStageTiming(
    "writer_initial",
    {
      gameCount: args.payload.games.length,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    },
    () => args.provider.generate(args.payload),
  );
  const initialNormalized = stripPostgameInterviewsFromResult(
    normalizeGameDayRecapResultForStage({
      input: initialOutput,
      stage: "writer_initial",
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    }),
  );
  const initialDeterministic = assessGameDayRecapDeterministicPayload(
    initialNormalized,
    factStore.games,
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const initialJudge = await judgeGameDayRecapResultIfEnabled({
    factStore,
    judgeLimiter: args.concurrency.judgeLimiter,
    logContext: args.logContext,
    provider: args.judgeProvider,
    result: initialDeterministic.orderedResult,
    stage: "writer",
  });
  if (
    initialDeterministic.issues.length === 0 &&
    initialJudge.blockingIssues.length === 0
  ) {
    return {
      coverageIssues: [],
      result: attachValidResultValidation(
        decorateGameDayRecapResultWithSurpriseMetadata(
          initialDeterministic.orderedResult,
          factStore.games,
        ),
      ),
    };
  }

  const retryValidationContext: GameDayRecapRetryValidationContext = {
    deterministicIssues: initialDeterministic.issues.map((issue) => ({
      feedback: issue.feedback,
      field: issue.field,
      kind: issue.kind,
      matchId: issue.matchId,
      sentence: issue.sentence,
      sentenceIndex: issue.sentenceIndex,
    })),
    judgeIssues: initialJudge.retryableIssues.map((issue) => ({
      contradictionType: issue.contradictionType,
      field: issue.field,
      matchId: issue.matchId,
      notes: issue.notes,
      sentence: issue.sentence,
      sentenceIndex: issue.sentenceIndex,
      sourceField: issue.sourceField,
      verdict: issue.verdict,
    })),
  };
  const retryOutput = await withGameDayRecapStageTiming(
    "writer_retry",
    {
      gameCount: args.payload.games.length,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    },
    () =>
      args.provider.generate(args.payload, {
        validationContext: retryValidationContext,
        validationFeedback: buildRecapValidationFeedbackLines({
          deterministicIssues: initialDeterministic.issues,
          judgeIssues: initialJudge.retryableIssues,
        }),
      }),
  );
  const retryNormalized = stripPostgameInterviewsFromResult(
    normalizeGameDayRecapResultForStage({
      input: retryOutput,
      stage: "writer_retry",
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    }),
  );
  const retryDeterministic = assessGameDayRecapDeterministicPayload(
    retryNormalized,
    factStore.games,
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const retryJudge = await judgeGameDayRecapResultIfEnabled({
    factStore,
    judgeLimiter: args.concurrency.judgeLimiter,
    logContext: args.logContext,
    provider: args.judgeProvider,
    result: retryDeterministic.orderedResult,
    stage: "retry",
  });
  if (
    retryDeterministic.issues.length === 0 &&
    retryJudge.blockingIssues.length === 0
  ) {
    return {
      coverageIssues: [],
      result: attachValidResultValidation(
        decorateGameDayRecapResultWithSurpriseMetadata(
          retryDeterministic.orderedResult,
          factStore.games,
        ),
      ),
    };
  }

  return salvageGameDayRecapResult({
    deterministicIssues: retryDeterministic.issues,
    expectedGames: factStore.games,
    judgeIssues: retryJudge.blockingIssues,
    judgeProvider: args.judgeProvider,
    judgeLimiter: args.concurrency.judgeLimiter,
    logContext: args.logContext,
    request: factStore.request,
    result: retryDeterministic.orderedResult,
    runtimeConfig: args.runtimeConfig,
  });
}

async function generatePremiumValidatedGameDayRecap(args: {
  concurrency: GameDayRecapGenerationConcurrency;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  payload: GameDayRecapPromptPayload;
  retryProvider: StructuredGameDayRecapProvider;
  runtimeConfig: GameDayRecapRuntimeConfig;
  writerProvider: StructuredGameDayRecapProvider;
}): Promise<GeneratedGameDayRecap> {
  const factStore = resolvePayloadFactStore(args.payload);
  const initialCandidates = await withGameDayRecapStageTiming(
    "premium_writer_candidates",
    {
      candidateCount: PREMIUM_RECAP_CANDIDATE_COUNT,
      gameCount: args.payload.games.length,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    },
    () =>
      Promise.all(
        Array.from(
          { length: PREMIUM_RECAP_CANDIDATE_COUNT },
          async (_value, index) =>
            evaluatePremiumRecapCandidate({
              candidateIndex: index,
              logContext: args.logContext,
              payload: args.payload,
              provider: args.writerProvider,
              runtimeConfig: args.runtimeConfig,
            }),
        ),
      ),
  );
  await judgePremiumCandidates({
    candidates: initialCandidates,
    judgeLimiter: args.concurrency.judgeLimiter,
    logContext: args.logContext,
    payload: args.payload,
    provider: args.judgeProvider,
  });
  applyPremiumCandidateDisagreementPenalties(
    initialCandidates,
    factStore.games,
  );

  const bestPassingCandidate =
    selectBestPassingPremiumCandidate(initialCandidates);
  if (bestPassingCandidate?.validatedResult) {
    return {
      coverageIssues: [],
      result: attachValidResultValidation(bestPassingCandidate.validatedResult),
    };
  }

  const retrySourceCandidate =
    selectBestRetrySourcePremiumCandidate(initialCandidates);
  const retryCandidate = await withGameDayRecapStageTiming(
    "premium_retry_candidate",
    {
      candidateCount: 1,
      gameCount: args.payload.games.length,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    },
    () =>
      evaluatePremiumRecapCandidate({
        candidateIndex: PREMIUM_RECAP_CANDIDATE_COUNT,
        logContext: args.logContext,
        payload: args.payload,
        provider: args.retryProvider,
        runtimeConfig: args.runtimeConfig,
        validationFeedback: buildPremiumRetryFeedback(retrySourceCandidate),
      }),
  );
  await judgePremiumCandidates({
    candidates: [retryCandidate],
    judgeLimiter: args.concurrency.judgeLimiter,
    logContext: args.logContext,
    payload: args.payload,
    provider: args.judgeProvider,
  });
  if (
    retryCandidate.validatedResult &&
    candidateClearsFactualBar(retryCandidate)
  ) {
    return {
      coverageIssues: [],
      result: attachValidResultValidation(retryCandidate.validatedResult),
    };
  }

  const fallbackCandidate = retryCandidate.normalizedResult
    ? retryCandidate
    : retrySourceCandidate;
  if (fallbackCandidate.normalizedResult) {
    return salvageGameDayRecapResult({
      deterministicIssues: fallbackCandidate.deterministicIssues,
      expectedGames: factStore.games,
      judgeIssues: collectBlockingJudgeIssues(
        fallbackCandidate.judgeAssessment,
      ),
      judgeProvider: args.judgeProvider,
      judgeLimiter: args.concurrency.judgeLimiter,
      logContext: args.logContext,
      request: factStore.request,
      result: fallbackCandidate.normalizedResult,
      runtimeConfig: args.runtimeConfig,
    });
  }

  throw new Error(
    fallbackCandidate.deterministicFailureMessage ??
      "Premium recap generation failed before any candidate could be normalized.",
  );
}

async function evaluatePremiumRecapCandidate(args: {
  candidateIndex: number;
  logContext?: GameDayRecapGenerationLogContext;
  payload: GameDayRecapPromptPayload;
  provider: StructuredGameDayRecapProvider;
  runtimeConfig: GameDayRecapRuntimeConfig;
  validationFeedback?: string[];
}): Promise<PremiumRecapCandidate> {
  const factStore = resolvePayloadFactStore(args.payload);
  try {
    const rawOutput = await args.provider.generate(args.payload, {
      candidateIndex: args.candidateIndex,
      validationFeedback: args.validationFeedback,
    });
    const normalizedResult = stripPostgameInterviewsFromResult(
      normalizeGameDayRecapResultForStage({
        candidateIndex: args.candidateIndex,
        input: rawOutput,
        stage: `${args.provider.stage}_candidate`,
        targetKey: args.logContext?.targetKey,
        userId: args.logContext?.userId,
      }),
    );

    try {
      return {
        candidateIndex: args.candidateIndex,
        deterministicFailureMessage: null,
        deterministicIssues: [],
        disagreementPenalty: 0,
        judgeAssessment: null,
        normalizedResult,
        validatedResult: validateGameDayRecapPayload(
          normalizedResult,
          factStore.games,
          {
            enforceBannedStylePhrases:
              args.runtimeConfig.enforceBannedStylePhrases,
          },
        ),
      };
    } catch (error) {
      if (!isGameDayRecapSemanticValidationError(error)) {
        throw error;
      }

      return {
        candidateIndex: args.candidateIndex,
        deterministicFailureMessage: error.message,
        deterministicIssues: error.issues,
        disagreementPenalty: 0,
        judgeAssessment: null,
        normalizedResult,
        validatedResult: null,
      };
    }
  } catch (error) {
    return {
      candidateIndex: args.candidateIndex,
      deterministicFailureMessage:
        error instanceof Error ? error.message : String(error),
      deterministicIssues: [],
      disagreementPenalty: 0,
      judgeAssessment: null,
      normalizedResult: null,
      validatedResult: null,
    };
  }
}

async function judgePremiumCandidates(args: {
  candidates: PremiumRecapCandidate[];
  judgeLimiter: BoundedConcurrencyLimiter;
  logContext?: GameDayRecapGenerationLogContext;
  payload: GameDayRecapPromptPayload;
  provider: StructuredGameDayRecapProvider | null;
}): Promise<void> {
  const judgeableCandidates = args.candidates.filter(
    (
      candidate,
    ): candidate is PremiumRecapCandidate & {
      validatedResult: GameDayRecapResultPayload;
    } => Boolean(candidate.validatedResult),
  );
  if (!judgeableCandidates.length) {
    return;
  }

  if (!args.provider) {
    for (const candidate of judgeableCandidates) {
      candidate.judgeAssessment = buildSkippedJudgeAssessment(
        candidate.candidateIndex,
      );
    }
    return;
  }

  const provider = args.provider;
  const factStore = resolvePayloadFactStore(args.payload);
  await withGameDayRecapStageTiming(
    "premium_candidate_judge",
    {
      candidateCount: judgeableCandidates.length,
      concurrency: "shared",
      gameCount: args.payload.games.length,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    },
    () =>
      Promise.all(
        judgeableCandidates.map(async (candidate) => {
          candidate.judgeAssessment = await judgeSingleRecapCandidate({
            candidateIndex: candidate.candidateIndex,
            factStore,
            fields: ["headline", "writeup"],
            includeInterestingness: true,
            judgeLimiter: args.judgeLimiter,
            logContext: args.logContext,
            provider,
            result: candidate.validatedResult,
            stage: "premium-candidate-selection",
          });
        }),
      ),
  );
}

function normalizeGameDayRecapJudgeSentenceVerdictRecord(
  value: unknown,
): GameDayRecapJudgeSentenceVerdictRecord {
  const record = requireRecord(value, "Game day recap judge sentence verdict");
  const containsOutcomeClaim =
    typeof record.containsOutcomeClaim === "boolean"
      ? record.containsOutcomeClaim
      : null;
  const contradictionType = asOptionalString(
    record.contradictionType,
  )?.trim() as GameDayRecapJudgeContradictionType | undefined;
  const notesText = asOptionalString(record.notes);
  const sourceFieldText = asOptionalString(record.sourceField);
  const verdict = asOptionalString(record.verdict)?.trim() as
    | GameDayRecapJudgeSentenceVerdict
    | undefined;
  if (
    containsOutcomeClaim === null ||
    !verdict ||
    !contradictionType ||
    notesText === null ||
    sourceFieldText === null
  ) {
    throw new Error("The judge sentence verdict entry was incomplete.");
  }
  const normalizedNotes = notesText.trim();
  const normalizedSourceField = sourceFieldText.trim();
  if (
    (verdict !== "supported" &&
      verdict !== "unsupported" &&
      verdict !== "uncertain" &&
      verdict !== "style_only") ||
    (contradictionType !== "none" &&
      contradictionType !== "winner" &&
      contradictionType !== "final_score" &&
      contradictionType !== "overtime" &&
      contradictionType !== "quarter_outcome" &&
      contradictionType !== "series_state" &&
      contradictionType !== "run" &&
      contradictionType !== "lead_change" &&
      contradictionType !== "ending" &&
      contradictionType !== "record" &&
      contradictionType !== "other")
  ) {
    throw new Error(
      "The judge sentence verdict entry used an unsupported verdict or contradiction type.",
    );
  }

  return {
    containsOutcomeClaim,
    contradictionType,
    notes: normalizedNotes ? normalizedNotes : null,
    sourceField: normalizedSourceField ? normalizedSourceField : null,
    verdict,
  };
}

function buildJudgeGameFactPacketIndex(
  factStore: GameDayRecapFactStore,
): Map<string, GameDayRecapJudgeGameFactPacket> {
  return new Map(
    factStore.games.map((game) => [
      game.matchId,
      buildGameDayRecapJudgeGameFactPacket(game),
    ]),
  );
}

function collectExpectedJudgeSentenceEntriesForGame(
  game: GameDayRecapResultPayload["games"][number],
  fields?: readonly GameDayRecapJudgeSentenceField[],
): GameDayRecapJudgeSentenceInventoryEntry[] {
  const allowedFields = fields ? new Set(fields) : null;
  const headlineEntry = {
    field: "headline" as const,
    key: buildJudgeSentenceKey({
      field: "headline",
      matchId: game.matchId,
      sentenceIndex: 0,
    }),
    matchId: game.matchId,
    sentence: game.headline,
    sentenceIndex: 0,
  };
  const writeupEntries = splitRecapText(game.writeup).map(
    (sentence, sentenceIndex) => ({
      field: "writeup" as const,
      key: buildJudgeSentenceKey({
        field: "writeup",
        matchId: game.matchId,
        sentenceIndex,
      }),
      matchId: game.matchId,
      sentence,
      sentenceIndex,
    }),
  );
  let interviewSentenceOffset = 0;
  const interviewEntries = (
    game.postgameInterviews?.length
      ? game.postgameInterviews
      : game.postgameInterview
        ? [game.postgameInterview]
        : []
  ).flatMap((interview) => {
    const entries = collectPostgameInterviewJudgeSentences(interview).map(
      (entry) => {
        const sentenceIndex = interviewSentenceOffset + entry.sentenceIndex;
        return {
          field: "postgameInterview" as const,
          key: buildJudgeSentenceKey({
            field: "postgameInterview",
            matchId: game.matchId,
            sentenceIndex,
          }),
          matchId: game.matchId,
          sentence: entry.sentence,
          sentenceIndex,
        };
      },
    );
    interviewSentenceOffset += entries.length;
    return entries;
  });

  return [headlineEntry, ...writeupEntries, ...interviewEntries].filter(
    (entry) => !allowedFields || allowedFields.has(entry.field),
  );
}

function buildJudgeSentenceChunks(args: {
  candidateIndex: number;
  fields?: readonly GameDayRecapJudgeSentenceField[];
  result: GameDayRecapResultPayload;
}): GameDayRecapJudgeSentenceChunk[] {
  return args.result.games.flatMap((game) => {
    const sentenceEntries = collectExpectedJudgeSentenceEntriesForGame(
      game,
      args.fields,
    );
    const chunkCount = Math.ceil(
      sentenceEntries.length / GAME_DAY_RECAP_JUDGE_SENTENCE_CHUNK_SIZE,
    );
    const chunks: GameDayRecapJudgeSentenceChunk[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const entries = sentenceEntries
        .slice(
          chunkIndex * GAME_DAY_RECAP_JUDGE_SENTENCE_CHUNK_SIZE,
          (chunkIndex + 1) * GAME_DAY_RECAP_JUDGE_SENTENCE_CHUNK_SIZE,
        )
        .map((entry, slotIndex) => ({
          ...entry,
          slotId: GAME_DAY_RECAP_JUDGE_SLOT_IDS[slotIndex]!,
        }));
      chunks.push({
        candidateIndex: args.candidateIndex,
        chunkCount,
        chunkIndex,
        entries,
        matchId: game.matchId,
      });
    }

    return chunks;
  });
}

function normalizeSentenceJudgeChunkResult(args: {
  chunk: GameDayRecapJudgeSentenceChunk;
  input: unknown;
}): GameDayRecapJudgeSentenceAssessment[] {
  const record = requireRecord(
    args.input,
    "Game day recap judge sentence chunk",
  );
  let slotVerdictsRecord: JsonRecord;
  try {
    slotVerdictsRecord = requireRecord(
      record.slotVerdicts,
      "Game day recap judge slot verdicts",
    );
  } catch {
    throw new GameDayRecapJudgeContractError([
      {
        candidateIndex: args.chunk.candidateIndex,
        chunkIndex: args.chunk.chunkIndex,
        expectedCandidateCount: 1,
        expectedSentenceCount: args.chunk.entries.length,
        kind: "invalid_sentence_chunk_shape",
        matchId: args.chunk.matchId,
        missingKeys: args.chunk.entries.map((entry) => entry.slotId),
        notes:
          "The judge result did not return a slotVerdicts object for the chunk.",
        returnedCandidateCount: 1,
        returnedSentenceCount: 0,
        unexpectedKeys: [],
      },
    ]);
  }

  const expectedSlotIds = args.chunk.entries.map((entry) => entry.slotId);
  const returnedSlotIds = Object.keys(slotVerdictsRecord);
  const missingSlotIds = expectedSlotIds.filter(
    (slotId) => !(slotId in slotVerdictsRecord),
  );
  const unexpectedSlotIds = returnedSlotIds.filter(
    (slotId) => !expectedSlotIds.includes(slotId as GameDayRecapJudgeSlotId),
  );
  const issues: GameDayRecapJudgeContractIssue[] = [];
  if (missingSlotIds.length > 0) {
    issues.push({
      candidateIndex: args.chunk.candidateIndex,
      chunkIndex: args.chunk.chunkIndex,
      expectedCandidateCount: 1,
      expectedSentenceCount: args.chunk.entries.length,
      kind: "missing_slot_verdicts",
      matchId: args.chunk.matchId,
      missingKeys: missingSlotIds,
      notes:
        "The judge omitted one or more expected slot verdicts for the chunk.",
      returnedCandidateCount: 1,
      returnedSentenceCount: returnedSlotIds.length,
      unexpectedKeys: [],
    });
  }
  if (unexpectedSlotIds.length > 0) {
    issues.push({
      candidateIndex: args.chunk.candidateIndex,
      chunkIndex: args.chunk.chunkIndex,
      expectedCandidateCount: 1,
      expectedSentenceCount: args.chunk.entries.length,
      kind: "unexpected_slot_verdicts",
      matchId: args.chunk.matchId,
      missingKeys: [],
      notes:
        "The judge returned one or more unexpected slot verdicts for the chunk.",
      returnedCandidateCount: 1,
      returnedSentenceCount: returnedSlotIds.length,
      unexpectedKeys: unexpectedSlotIds,
    });
  }

  const assessments: GameDayRecapJudgeSentenceAssessment[] = [];
  for (const entry of args.chunk.entries) {
    const verdictValue = slotVerdictsRecord[entry.slotId];
    if (verdictValue === undefined) {
      continue;
    }

    try {
      const verdictRecord =
        normalizeGameDayRecapJudgeSentenceVerdictRecord(verdictValue);
      assessments.push({
        containsOutcomeClaim: verdictRecord.containsOutcomeClaim,
        contradictionType: verdictRecord.contradictionType,
        field: entry.field,
        matchId: entry.matchId,
        notes: verdictRecord.notes,
        sentence: entry.sentence,
        sentenceIndex: entry.sentenceIndex,
        sourceField: verdictRecord.sourceField,
        verdict: verdictRecord.verdict,
      });
    } catch (error) {
      issues.push({
        candidateIndex: args.chunk.candidateIndex,
        chunkIndex: args.chunk.chunkIndex,
        expectedCandidateCount: 1,
        expectedSentenceCount: args.chunk.entries.length,
        kind: "invalid_sentence_verdict",
        matchId: args.chunk.matchId,
        missingKeys: [],
        notes:
          error instanceof Error
            ? error.message
            : "The judge sentence verdict was invalid.",
        returnedCandidateCount: 1,
        returnedSentenceCount: returnedSlotIds.length,
        unexpectedKeys: [entry.slotId],
      });
    }
  }

  if (issues.length > 0) {
    throw new GameDayRecapJudgeContractError(issues);
  }

  return assessments;
}

function normalizeInterestingnessJudgeResult(args: {
  candidateIndex: number;
  input: unknown;
  matchId: string | null;
}): number {
  const record = requireRecord(
    args.input,
    "Game day recap candidate interestingness result",
  );
  const candidateIndex = asOptionalNumber(record.candidateIndex);
  const interestingnessScore = asOptionalNumber(record.interestingnessScore);
  if (
    candidateIndex === null ||
    !Number.isInteger(candidateIndex) ||
    candidateIndex !== args.candidateIndex ||
    interestingnessScore === null
  ) {
    throw new GameDayRecapJudgeContractError([
      {
        candidateIndex: args.candidateIndex,
        chunkIndex: null,
        expectedCandidateCount: 1,
        expectedSentenceCount: 0,
        kind: "invalid_interestingness_shape",
        matchId: args.matchId,
        missingKeys: [],
        notes:
          "The interestingness judge result was missing the expected candidateIndex or interestingnessScore.",
        returnedCandidateCount: 1,
        returnedSentenceCount: 0,
        unexpectedKeys: [],
      },
    ]);
  }

  return interestingnessScore;
}

async function executeSentenceJudgeChunkWithRetry(args: {
  chunk: GameDayRecapJudgeSentenceChunk;
  factStore: GameDayRecapFactStore;
  fallbackMode: GameDayRecapJudgeFallbackMode;
  gameFacts: GameDayRecapJudgeGameFactPacket;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  stage:
    | "premium-candidate-selection"
    | "retry"
    | "style-polish"
    | "postgame-interview"
    | "salvage-post-patch"
    | "salvage-post-trim"
    | "writer";
}): Promise<GameDayRecapJudgeSentenceAssessment[]> {
  const requestPayload: GameDayRecapSentenceJudgeRequestPayload = {
    candidateIndex: args.chunk.candidateIndex,
    chunkCount: args.chunk.chunkCount,
    chunkIndex: args.chunk.chunkIndex,
    gameFacts: args.gameFacts,
    judgeKind: "sentence_factuality",
    request: args.factStore.request,
    sentenceChunk: args.chunk.entries.map((entry) => ({
      field: entry.field,
      sentence: entry.sentence,
      sentenceIndex: entry.sentenceIndex,
      slotId: entry.slotId,
    })),
  };
  const schema = toBedrockStructuredOutputSchema(
    buildGameDayRecapJudgeSentenceFactualityResultSchema({
      activeSlotIds: requestPayload.sentenceChunk.map((entry) => entry.slotId),
    }),
  );
  const budget = computeJudgeSchemaBudget({
    schema,
    sentenceVerdictCount: args.chunk.entries.length,
  });
  let firstContractFailure: GameDayRecapJudgeContractError | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    logJudgeSchemaBudget({
      budget,
      candidateIndex: args.chunk.candidateIndex,
      chunkCount: args.chunk.chunkCount,
      chunkIndex: args.chunk.chunkIndex,
      chunkSentenceCount: args.chunk.entries.length,
      fallbackMode: args.fallbackMode,
      judgeKind: "sentence_factuality",
      matchId: args.chunk.matchId,
      stage: args.stage,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    });

    const input = await args.provider.generate(requestPayload);
    try {
      const normalized = normalizeSentenceJudgeChunkResult({
        chunk: args.chunk,
        input,
      });
      if (firstContractFailure) {
        logGameDayRecapWarn("process.judge_response_repaired", {
          attempt,
          candidateIndex: args.chunk.candidateIndex,
          chunkCount: args.chunk.chunkCount,
          chunkIndex: args.chunk.chunkIndex,
          chunkSentenceCount: args.chunk.entries.length,
          fallbackMode: args.fallbackMode,
          issues: summarizeJudgeContractIssuesForLog(
            firstContractFailure.issues,
          ),
          judgeKind: "sentence_factuality",
          matchId: args.chunk.matchId,
          stage: args.stage,
          targetKey: args.logContext?.targetKey ?? null,
          userId: args.logContext?.userId ?? null,
        });
      }
      return normalized;
    } catch (error) {
      if (!(error instanceof GameDayRecapJudgeContractError)) {
        throw error;
      }

      if (attempt === 1) {
        firstContractFailure = error;
        logGameDayRecapWarn("process.judge_contract_retry", {
          attempt,
          candidateIndex: args.chunk.candidateIndex,
          chunkCount: args.chunk.chunkCount,
          chunkIndex: args.chunk.chunkIndex,
          chunkSentenceCount: args.chunk.entries.length,
          fallbackMode: args.fallbackMode,
          issues: summarizeJudgeContractIssuesForLog(error.issues),
          judgeKind: "sentence_factuality",
          matchId: args.chunk.matchId,
          stage: args.stage,
          targetKey: args.logContext?.targetKey ?? null,
          userId: args.logContext?.userId ?? null,
        });
        continue;
      }

      logGameDayRecapWarn("process.judge_contract_failed", {
        attempt,
        candidateIndex: args.chunk.candidateIndex,
        chunkCount: args.chunk.chunkCount,
        chunkIndex: args.chunk.chunkIndex,
        chunkSentenceCount: args.chunk.entries.length,
        fallbackMode: args.fallbackMode,
        issues: summarizeJudgeContractIssuesForLog(error.issues),
        judgeKind: "sentence_factuality",
        matchId: args.chunk.matchId,
        stage: args.stage,
        targetKey: args.logContext?.targetKey ?? null,
        userId: args.logContext?.userId ?? null,
      });
      throw error;
    }
  }

  throw new Error("Game day recap judge exhausted its retry budget.");
}

async function executeSentenceJudgeChunk(args: {
  chunk: GameDayRecapJudgeSentenceChunk;
  factStore: GameDayRecapFactStore;
  gameFacts: GameDayRecapJudgeGameFactPacket;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  stage:
    | "premium-candidate-selection"
    | "retry"
    | "style-polish"
    | "postgame-interview"
    | "salvage-post-patch"
    | "salvage-post-trim"
    | "writer";
}): Promise<GameDayRecapJudgeSentenceAssessment[]> {
  try {
    return await executeSentenceJudgeChunkWithRetry({
      chunk: args.chunk,
      factStore: args.factStore,
      fallbackMode: "chunk",
      gameFacts: args.gameFacts,
      logContext: args.logContext,
      provider: args.provider,
      stage: args.stage,
    });
  } catch (error) {
    if (
      args.chunk.entries.length <= 1 ||
      !isBedrockJudgeSchemaValidationError(error)
    ) {
      throw error;
    }

    logGameDayRecapWarn("process.judge_schema_fallback_to_single_sentence", {
      candidateIndex: args.chunk.candidateIndex,
      chunkCount: args.chunk.chunkCount,
      chunkIndex: args.chunk.chunkIndex,
      chunkSentenceCount: args.chunk.entries.length,
      errorMessage: error instanceof Error ? error.message : String(error),
      judgeKind: "sentence_factuality",
      matchId: args.chunk.matchId,
      stage: args.stage,
      targetKey: args.logContext?.targetKey ?? null,
      userId: args.logContext?.userId ?? null,
    });

    const assessments: GameDayRecapJudgeSentenceAssessment[] = [];
    for (
      let fallbackIndex = 0;
      fallbackIndex < args.chunk.entries.length;
      fallbackIndex += 1
    ) {
      const entry = args.chunk.entries[fallbackIndex]!;
      const singleSentenceChunk: GameDayRecapJudgeSentenceChunk = {
        candidateIndex: args.chunk.candidateIndex,
        chunkCount: args.chunk.entries.length,
        chunkIndex: fallbackIndex,
        entries: [entry],
        matchId: args.chunk.matchId,
      };

      assessments.push(
        ...(await executeSentenceJudgeChunkWithRetry({
          chunk: singleSentenceChunk,
          factStore: args.factStore,
          fallbackMode: "single_sentence",
          gameFacts: args.gameFacts,
          logContext: args.logContext,
          provider: args.provider,
          stage: args.stage,
        })),
      );
    }

    return assessments;
  }
}

async function executeInterestingnessJudgeWithRetry(args: {
  candidateIndex: number;
  factStore: GameDayRecapFactStore;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  result: GameDayRecapResultPayload;
}): Promise<number> {
  const factPacketsByMatchId = buildJudgeGameFactPacketIndex(args.factStore);
  const requestPayload: GameDayRecapInterestingnessJudgeRequestPayload = {
    candidateIndex: args.candidateIndex,
    games: args.result.games.map((game) => {
      const gameFacts = factPacketsByMatchId.get(game.matchId);
      if (!gameFacts) {
        throw new Error(
          `Game day recap judge was missing fact-store truth for match ${game.matchId}.`,
        );
      }
      return gameFacts;
    }),
    judgeKind: "candidate_interestingness",
    request: args.factStore.request,
    result: args.result,
  };
  const schema = toBedrockStructuredOutputSchema(
    buildGameDayRecapJudgeInterestingnessResultSchema(),
  );
  const budget = computeJudgeSchemaBudget({
    schema,
    sentenceVerdictCount: 0,
  });
  let firstContractFailure: GameDayRecapJudgeContractError | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    logJudgeSchemaBudget({
      budget,
      candidateIndex: args.candidateIndex,
      chunkCount: null,
      chunkIndex: null,
      chunkSentenceCount: 0,
      fallbackMode: null,
      judgeKind: "candidate_interestingness",
      matchId:
        args.result.games.length === 1 ? args.result.games[0]!.matchId : null,
      stage: "premium-candidate-selection",
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    });

    const input = await args.provider.generate(requestPayload);
    try {
      const interestingnessScore = normalizeInterestingnessJudgeResult({
        candidateIndex: args.candidateIndex,
        input,
        matchId:
          args.result.games.length === 1 ? args.result.games[0]!.matchId : null,
      });
      if (firstContractFailure) {
        logGameDayRecapWarn("process.judge_response_repaired", {
          attempt,
          candidateIndex: args.candidateIndex,
          chunkCount: null,
          chunkIndex: null,
          chunkSentenceCount: 0,
          fallbackMode: null,
          issues: summarizeJudgeContractIssuesForLog(
            firstContractFailure.issues,
          ),
          judgeKind: "candidate_interestingness",
          matchId:
            args.result.games.length === 1
              ? args.result.games[0]!.matchId
              : null,
          stage: "premium-candidate-selection",
          targetKey: args.logContext?.targetKey ?? null,
          userId: args.logContext?.userId ?? null,
        });
      }
      return interestingnessScore;
    } catch (error) {
      if (!(error instanceof GameDayRecapJudgeContractError)) {
        throw error;
      }

      if (attempt === 1) {
        firstContractFailure = error;
        logGameDayRecapWarn("process.judge_contract_retry", {
          attempt,
          candidateIndex: args.candidateIndex,
          chunkCount: null,
          chunkIndex: null,
          chunkSentenceCount: 0,
          fallbackMode: null,
          issues: summarizeJudgeContractIssuesForLog(error.issues),
          judgeKind: "candidate_interestingness",
          matchId:
            args.result.games.length === 1
              ? args.result.games[0]!.matchId
              : null,
          stage: "premium-candidate-selection",
          targetKey: args.logContext?.targetKey ?? null,
          userId: args.logContext?.userId ?? null,
        });
        continue;
      }

      logGameDayRecapWarn("process.judge_contract_failed", {
        attempt,
        candidateIndex: args.candidateIndex,
        chunkCount: null,
        chunkIndex: null,
        chunkSentenceCount: 0,
        fallbackMode: null,
        issues: summarizeJudgeContractIssuesForLog(error.issues),
        judgeKind: "candidate_interestingness",
        matchId:
          args.result.games.length === 1 ? args.result.games[0]!.matchId : null,
        stage: "premium-candidate-selection",
        targetKey: args.logContext?.targetKey ?? null,
        userId: args.logContext?.userId ?? null,
      });
      throw error;
    }
  }

  throw new Error("Game day recap judge exhausted its retry budget.");
}

async function judgeSingleRecapCandidate(args: {
  candidateIndex: number;
  factStore: GameDayRecapFactStore;
  fields?: readonly GameDayRecapJudgeSentenceField[];
  includeInterestingness: boolean;
  judgeLimiter?: BoundedConcurrencyLimiter;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  result: GameDayRecapResultPayload;
  stage:
    | "premium-candidate-selection"
    | "retry"
    | "style-polish"
    | "postgame-interview"
    | "salvage-post-patch"
    | "salvage-post-trim"
    | "writer";
}): Promise<GameDayRecapJudgeCandidateAssessment> {
  const factPacketsByMatchId = buildJudgeGameFactPacketIndex(args.factStore);
  const judgeLimiter: BoundedConcurrencyLimiter =
    args.judgeLimiter ?? ((task) => task());
  const chunks = buildJudgeSentenceChunks({
    candidateIndex: args.candidateIndex,
    fields: args.fields,
    result: args.result,
  });
  const [sentenceAssessmentGroups, interestingnessScore] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        judgeLimiter(async () => {
          const gameFacts = factPacketsByMatchId.get(chunk.matchId);
          if (!gameFacts) {
            throw new Error(
              `Game day recap judge was missing fact-store truth for match ${chunk.matchId}.`,
            );
          }

          return executeSentenceJudgeChunk({
            chunk,
            factStore: args.factStore,
            gameFacts,
            logContext: args.logContext,
            provider: args.provider,
            stage: args.stage,
          });
        }),
      ),
    ),
    args.includeInterestingness
      ? judgeLimiter(() =>
          executeInterestingnessJudgeWithRetry({
            candidateIndex: args.candidateIndex,
            factStore: args.factStore,
            logContext: args.logContext,
            provider: args.provider,
            result: args.result,
          }),
        )
      : Promise.resolve(0),
  ]);
  const sentenceAssessments = sentenceAssessmentGroups.flat();

  sentenceAssessments.sort((left, right) => {
    const comparisons = [
      left.matchId.localeCompare(right.matchId),
      left.field.localeCompare(right.field),
      left.sentenceIndex - right.sentenceIndex,
    ];
    return comparisons.find((comparison) => comparison !== 0) ?? 0;
  });

  return {
    candidateIndex: args.candidateIndex,
    interestingnessScore,
    sentences: sentenceAssessments,
  };
}

function summarizeJudgeContractIssuesForLog(
  issues: GameDayRecapJudgeContractIssue[],
): Array<Record<string, unknown>> {
  return issues.map((issue) => ({
    candidateIndex: issue.candidateIndex,
    chunkIndex: issue.chunkIndex,
    expectedCandidateCount: issue.expectedCandidateCount,
    expectedSentenceCount: issue.expectedSentenceCount,
    kind: issue.kind,
    matchId: issue.matchId,
    missingKeys: issue.missingKeys.slice(0, 8),
    notes: issue.notes,
    returnedCandidateCount: issue.returnedCandidateCount,
    returnedSentenceCount: issue.returnedSentenceCount,
    unexpectedKeys: issue.unexpectedKeys.slice(0, 8),
  }));
}

function buildJudgeValidationIssueFeedback(
  issue: Pick<
    GameDayRecapJudgeValidationIssue,
    | "contradictionType"
    | "field"
    | "matchId"
    | "notes"
    | "sentence"
    | "sourceField"
    | "verdict"
  >,
): string {
  const sourceField = issue.sourceField
    ? ` Source field: ${issue.sourceField}.`
    : "";
  const notes = issue.notes ? ` ${issue.notes}` : "";
  return `For match ${issue.matchId}, the ${issue.field} sentence "${issue.sentence}" was judged ${issue.verdict} for ${issue.contradictionType}.${sourceField}${notes}`.trim();
}

function buildJudgeValidationIssue(
  sentence: GameDayRecapJudgeSentenceAssessment,
): GameDayRecapJudgeValidationIssue {
  return {
    contradictionType: sentence.contradictionType,
    feedback: buildJudgeValidationIssueFeedback(sentence),
    field: sentence.field,
    matchId: sentence.matchId,
    notes: sentence.notes,
    sentence: sentence.sentence,
    sentenceIndex: sentence.sentenceIndex,
    sourceField: sentence.sourceField,
    verdict: sentence.verdict,
  };
}

function collectBlockingJudgeIssues(
  assessment: GameDayRecapJudgeCandidateAssessment | null,
): GameDayRecapJudgeValidationIssue[] {
  return (assessment?.sentences ?? [])
    .filter((sentence) => sentence.verdict === "unsupported")
    .map(buildJudgeValidationIssue);
}

function collectRetryableJudgeIssues(
  assessment: GameDayRecapJudgeCandidateAssessment | null,
): GameDayRecapJudgeValidationIssue[] {
  return (assessment?.sentences ?? [])
    .filter(
      (sentence) =>
        sentence.verdict === "unsupported" || sentence.verdict === "uncertain",
    )
    .map(buildJudgeValidationIssue);
}

function buildRecapValidationFeedbackLines(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  judgeIssues: GameDayRecapJudgeValidationIssue[];
}): string[] {
  return Array.from(
    new Set([
      ...args.deterministicIssues.map((issue) => issue.feedback),
      ...args.judgeIssues.map((issue) => issue.feedback),
      "Use only supplied facts. If a detail is not supported by the payload, leave it out.",
    ]),
  );
}

function buildSkippedJudgeAssessment(
  candidateIndex: number,
): GameDayRecapJudgeCandidateAssessment {
  return {
    candidateIndex,
    interestingnessScore: 0,
    sentences: [],
  };
}

async function judgeGameDayRecapResultIfEnabled(args: {
  factStore: GameDayRecapFactStore;
  fields?: readonly GameDayRecapJudgeSentenceField[];
  judgeLimiter?: BoundedConcurrencyLimiter;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider | null;
  result: GameDayRecapResultPayload;
  stage:
    | "retry"
    | "style-polish"
    | "postgame-interview"
    | "salvage-post-patch"
    | "salvage-post-trim"
    | "writer";
}): Promise<{
  assessment: GameDayRecapJudgeCandidateAssessment;
  blockingIssues: GameDayRecapJudgeValidationIssue[];
  retryableIssues: GameDayRecapJudgeValidationIssue[];
}> {
  if (!args.provider) {
    return {
      assessment: buildSkippedJudgeAssessment(0),
      blockingIssues: [],
      retryableIssues: [],
    };
  }

  return judgeGameDayRecapResult({
    ...args,
    provider: args.provider,
  });
}

async function judgeGameDayRecapResult(args: {
  factStore: GameDayRecapFactStore;
  fields?: readonly GameDayRecapJudgeSentenceField[];
  judgeLimiter?: BoundedConcurrencyLimiter;
  logContext?: GameDayRecapGenerationLogContext;
  provider: StructuredGameDayRecapProvider;
  result: GameDayRecapResultPayload;
  stage:
    | "retry"
    | "style-polish"
    | "postgame-interview"
    | "salvage-post-patch"
    | "salvage-post-trim"
    | "writer";
}): Promise<{
  assessment: GameDayRecapJudgeCandidateAssessment;
  blockingIssues: GameDayRecapJudgeValidationIssue[];
  retryableIssues: GameDayRecapJudgeValidationIssue[];
}> {
  const assessment = await withGameDayRecapStageTiming(
    "judge_candidate",
    {
      concurrency: args.judgeLimiter ? "shared" : 1,
      gameCount: args.result.games.length,
      targetKey: args.logContext?.targetKey,
      userId: args.logContext?.userId,
    },
    () =>
      judgeSingleRecapCandidate({
        candidateIndex: 0,
        factStore: args.factStore,
        fields: args.fields,
        includeInterestingness: false,
        judgeLimiter: args.judgeLimiter,
        logContext: args.logContext,
        provider: args.provider,
        result: args.result,
        stage: args.stage,
      }),
  );

  return {
    assessment,
    blockingIssues: collectBlockingJudgeIssues(assessment),
    retryableIssues: collectRetryableJudgeIssues(assessment),
  };
}

function buildJudgeSentenceKey(args: {
  field: GameDayRecapJudgeSentenceField;
  matchId: string;
  sentenceIndex: number;
}): string {
  return `${args.matchId}:${args.field}:${args.sentenceIndex}`;
}

function candidateClearsFactualBar(candidate: PremiumRecapCandidate): boolean {
  return (
    Boolean(candidate.validatedResult) &&
    Boolean(candidate.judgeAssessment) &&
    countPremiumCandidateAdjustedUnsupported(candidate) === 0 &&
    countPremiumCandidateUnsupportedHeadlineOutcomeSentences(candidate) === 0
  );
}

function countPremiumCandidateAdjustedUnsupported(
  candidate: PremiumRecapCandidate,
): number {
  return (
    countPremiumCandidateJudgeVerdicts(candidate, "unsupported") +
    candidate.disagreementPenalty
  );
}

function countPremiumCandidateJudgeVerdicts(
  candidate: PremiumRecapCandidate,
  verdict: GameDayRecapJudgeSentenceVerdict,
): number {
  return (
    candidate.judgeAssessment?.sentences.filter(
      (sentence) => sentence.verdict === verdict,
    ).length ?? 0
  );
}

function countPremiumCandidateUnsupportedHeadlineOutcomeSentences(
  candidate: PremiumRecapCandidate,
): number {
  return (
    candidate.judgeAssessment?.sentences.filter(
      (sentence) =>
        sentence.field === "headline" &&
        sentence.containsOutcomeClaim &&
        sentence.verdict === "unsupported",
    ).length ?? 0
  );
}

function premiumCandidateInterestingness(
  candidate: PremiumRecapCandidate,
): number {
  return candidate.judgeAssessment?.interestingnessScore ?? 0;
}

function comparePremiumCandidates(
  left: PremiumRecapCandidate,
  right: PremiumRecapCandidate,
): number {
  const comparisons = [
    countPremiumCandidateAdjustedUnsupported(left) -
      countPremiumCandidateAdjustedUnsupported(right),
    countPremiumCandidateJudgeVerdicts(left, "uncertain") -
      countPremiumCandidateJudgeVerdicts(right, "uncertain"),
    countPremiumCandidateUnsupportedHeadlineOutcomeSentences(left) -
      countPremiumCandidateUnsupportedHeadlineOutcomeSentences(right),
    premiumCandidateInterestingness(right) -
      premiumCandidateInterestingness(left),
    left.candidateIndex - right.candidateIndex,
  ];

  return comparisons.find((comparison) => comparison !== 0) ?? 0;
}

function selectBestPassingPremiumCandidate(
  candidates: PremiumRecapCandidate[],
): PremiumRecapCandidate | null {
  return (
    [...candidates]
      .filter(candidateClearsFactualBar)
      .sort(comparePremiumCandidates)[0] ?? null
  );
}

function selectBestRetrySourcePremiumCandidate(
  candidates: PremiumRecapCandidate[],
): PremiumRecapCandidate {
  return [...candidates].sort((left, right) => {
    const comparisons = [
      premiumCandidateHardFailureCount(left) -
        premiumCandidateHardFailureCount(right),
      comparePremiumCandidates(left, right),
    ];

    return comparisons.find((comparison) => comparison !== 0) ?? 0;
  })[0]!;
}

function premiumCandidateHardFailureCount(
  candidate: PremiumRecapCandidate,
): number {
  if (!candidate.normalizedResult) {
    return 1000;
  }

  return candidate.deterministicIssues.length;
}

function buildPremiumRetryFeedback(candidate: PremiumRecapCandidate): string[] {
  const judgeIssues = collectRetryableJudgeIssues(candidate.judgeAssessment);
  const feedbackLines = buildRecapValidationFeedbackLines({
    deterministicIssues: candidate.deterministicIssues,
    judgeIssues,
  });

  if (feedbackLines.length === 1 && candidate.deterministicFailureMessage) {
    feedbackLines.unshift(candidate.deterministicFailureMessage);
  }

  return feedbackLines;
}

function applyPremiumCandidateDisagreementPenalties(
  candidates: PremiumRecapCandidate[],
  expectedGames: GameDayRecapPromptGame[],
): void {
  void candidates;
  void expectedGames;
}

function validateGameDayRecapResult(
  input: unknown,
  expectedGames: GameDayRecapPromptGame[],
): GameDayRecapResultPayload {
  return validateGameDayRecapPayload(
    normalizeGameDayRecapResult(input),
    expectedGames,
  );
}

function normalizeGameDayRecapResult(
  input: unknown,
): GameDayRecapResultPayload {
  return normalizeGameDayRecapResultWithWarnings(input).result;
}

function normalizeGameDayRecapResultWithWarnings(
  input: unknown,
): GameDayRecapNormalizedResult {
  const record = requireRecord(input, "Game day recap result");
  const summary = requireRecord(record.summary, "Game day recap summary");
  const games = Array.isArray(record.games) ? record.games : null;
  if (!games?.length) {
    throw new Error("Game day recap result did not include any games.");
  }

  const warnings: GameDayRecapNormalizationWarning[] = [];
  const validatedGames = games.map((game) => {
    const gameRecord = requireRecord(game, "Game day recap game");
    const matchId = asOptionalString(gameRecord.matchId)?.trim();
    const headline = asOptionalString(gameRecord.headline)?.trim();
    const writeup = asOptionalString(gameRecord.writeup)?.trim();
    const evidenceTags = Array.isArray(gameRecord.evidenceTags)
      ? gameRecord.evidenceTags
      : null;

    if (!matchId || !headline || !writeup || !evidenceTags) {
      throw new Error(
        "Game day recap result contained an incomplete game entry.",
      );
    }

    const validatedTags = evidenceTags.map((tag) => {
      if (
        typeof tag !== "string" ||
        !GAME_DAY_RECAP_EVIDENCE_TAGS.includes(tag as GameDayRecapEvidenceTag)
      ) {
        throw new Error(`Unsupported recap evidence tag ${String(tag)}.`);
      }
      return tag as GameDayRecapEvidenceTag;
    });
    const postgameInterviewResult = parseGameDayRecapPostgameInterview({
      input: gameRecord.postgameInterview,
      matchId,
    });
    if (postgameInterviewResult.warning) {
      warnings.push(postgameInterviewResult.warning);
    }
    const postgameInterviewsResult = parseGameDayRecapPostgameInterviews({
      input: gameRecord.postgameInterviews,
      matchId,
    });
    warnings.push(...postgameInterviewsResult.warnings);
    const postgameInterviews = postgameInterviewsResult.interviews.length
      ? postgameInterviewsResult.interviews
      : postgameInterviewResult.interview
        ? [postgameInterviewResult.interview]
        : [];
    const postgameInterviewDiagnostics =
      parseGameDayRecapPostgameInterviewDiagnostics(
        gameRecord.postgameInterviewDiagnostics,
      );

    return {
      evidenceTags: validatedTags,
      headline,
      matchId,
      ...(postgameInterviews[0]
        ? { postgameInterview: postgameInterviews[0] }
        : {}),
      ...(postgameInterviewDiagnostics.length
        ? { postgameInterviewDiagnostics }
        : {}),
      ...(postgameInterviews.length ? { postgameInterviews } : {}),
      surpriseFactor: null,
      writeup,
    };
  });

  const headline = asOptionalString(summary.headline)?.trim();
  const lede = asOptionalString(summary.lede)?.trim();
  if (!headline || !lede) {
    throw new Error("Game day recap summary was missing a headline or lede.");
  }

  return {
    result: {
      games: validatedGames,
      summary: {
        gameOfTheDayMatchId: null,
        gameOfTheDaySurpriseFactor: null,
        headline,
        lede,
      },
    },
    warnings,
  };
}

function parseGameDayRecapPostgameInterviews(args: {
  input: unknown;
  matchId: string;
}): {
  interviews: GameDayRecapResultPostgameInterview[];
  warnings: GameDayRecapNormalizationWarning[];
} {
  if (args.input == null) {
    return {
      interviews: [],
      warnings: [],
    };
  }
  if (!Array.isArray(args.input)) {
    return {
      interviews: [],
      warnings: [
        buildInvalidPostgameInterviewWarning(args.matchId, [
          "postgameInterviews must be an array.",
        ]),
      ],
    };
  }

  const interviews: GameDayRecapResultPostgameInterview[] = [];
  const warnings: GameDayRecapNormalizationWarning[] = [];
  for (const input of args.input) {
    const parsed = parseGameDayRecapPostgameInterview({
      input,
      matchId: args.matchId,
    });
    if (parsed.interview) {
      interviews.push(parsed.interview);
    }
    if (parsed.warning) {
      warnings.push(parsed.warning);
    }
  }

  return {
    interviews,
    warnings,
  };
}

function parseGameDayRecapPostgameInterviewDiagnostics(
  input: unknown,
): GameDayRecapPostgameInterviewDiagnostic[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as JsonRecord;
    const side = asOptionalString(record.side);
    const status = asOptionalString(record.status);
    if (
      (side !== "winner" && side !== "loser") ||
      (status !== "generated" &&
        status !== "missing_candidate" &&
        status !== "skipped" &&
        status !== "suspect" &&
        status !== "unavailable")
    ) {
      return [];
    }

    return [
      {
        details: Array.isArray(record.details)
          ? record.details.filter((detail): detail is string => typeof detail === "string")
          : [],
        reason: asOptionalString(record.reason),
        side,
        status,
      },
    ];
  });
}

function parseGameDayRecapPostgameInterview(args: {
  input: unknown;
  matchId: string;
}): {
  interview: GameDayRecapResultPostgameInterview | null;
  warning: GameDayRecapNormalizationWarning | null;
} {
  if (args.input == null) {
    return {
      interview: null,
      warning: null,
    };
  }

  if (
    !args.input ||
    typeof args.input !== "object" ||
    Array.isArray(args.input)
  ) {
    return {
      interview: null,
      warning: buildInvalidPostgameInterviewWarning(args.matchId, [
        "postgameInterview must be an object.",
      ]),
    };
  }

  const record = args.input as JsonRecord;
  const details: string[] = [];
  const playerName = readRequiredInterviewStringField(
    record.playerName,
    "playerName",
    details,
  );
  const teamName = readRequiredInterviewStringField(
    record.teamName,
    "teamName",
    details,
  );
  const rawTeamSide = asOptionalString(record.teamSide)?.trim();
  const teamSide =
    rawTeamSide === "away" || rawTeamSide === "home" ? rawTeamSide : null;
  if (!teamSide) {
    details.push('teamSide must be "away" or "home".');
  }
  const title = readRequiredInterviewStringField(
    record.title,
    "title",
    details,
  );
  const personalityType = isInterviewPersonalityType(record.personalityType)
    ? record.personalityType
    : null;
  const personalitySource = personalityType &&
      isInterviewPersonalitySource(record.personalitySource)
    ? record.personalitySource
    : personalityType
      ? "auto"
      : null;
  const normalizedQa: GameDayRecapResultPostgameInterview["qa"] = [];
  if (!Array.isArray(record.qa)) {
    details.push("qa was missing or not an array.");
  } else {
    if (record.qa.length < 1 || record.qa.length > 2) {
      details.push(
        `qa must contain 1 or 2 exchanges, received ${record.qa.length}.`,
      );
    }
    for (let index = 0; index < record.qa.length; index += 1) {
      const entry = record.qa[index];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        details.push(`qa[${index}] must be an object.`);
        continue;
      }

      const exchange = entry as JsonRecord;
      const question = readRequiredInterviewStringField(
        exchange.question,
        `qa[${index}].question`,
        details,
      );
      const answer = readRequiredInterviewStringField(
        exchange.answer,
        `qa[${index}].answer`,
        details,
      );
      if (!question || !answer) {
        continue;
      }
      normalizedQa.push({
        answer,
        question,
      });
    }
  }

  if (
    details.length > 0 ||
    !playerName ||
    !teamName ||
    !teamSide ||
    !title ||
    normalizedQa.length < 1 ||
    normalizedQa.length > 2
  ) {
    return {
      interview: null,
      warning: buildInvalidPostgameInterviewWarning(args.matchId, details),
    };
  }

  return {
    interview: {
      ...(personalitySource ? { personalitySource } : {}),
      ...(personalityType ? { personalityType } : {}),
      playerName,
      qa: normalizedQa,
      teamName,
      teamSide,
      title,
    },
    warning: null,
  };
}

function readRequiredInterviewStringField(
  value: unknown,
  fieldName: string,
  details: string[],
): string | null {
  const normalized = asOptionalString(value)?.trim();
  if (!normalized) {
    details.push(`${fieldName} was missing or empty.`);
    return null;
  }

  return normalized;
}

function buildInvalidPostgameInterviewWarning(
  matchId: string,
  details: string[],
): GameDayRecapNormalizationWarning {
  return {
    details,
    kind: "invalid_postgame_interview",
    matchId,
    reason:
      details[0] ??
      "postgameInterview failed validation and was dropped from the recap.",
  };
}

function normalizeGameDayRecapResultForStage(args: {
  candidateIndex?: number;
  input: unknown;
  stage: string;
  targetKey?: string;
  userId?: string;
}): GameDayRecapResultPayload {
  const normalized = normalizeGameDayRecapResultWithWarnings(args.input);
  logGameDayRecapNormalizationWarnings({
    candidateIndex: args.candidateIndex,
    stage: args.stage,
    targetKey: args.targetKey,
    userId: args.userId,
    warnings: normalized.warnings,
  });
  return normalized.result;
}

function normalizeGameDayRecapStylePolishWriteup(input: unknown): string {
  const record = requireRecord(input, "Game day recap style polish result");
  const writeup = asOptionalString(record.writeup)?.trim();
  if (!writeup || writeup.length < 80) {
    throw new Error(
      "Game day recap style polish result was missing a writeup.",
    );
  }

  return writeup;
}

function stripPostgameInterviewsFromResult(
  result: GameDayRecapResultPayload,
): GameDayRecapResultPayload {
  return {
    ...result,
    games: result.games.map(removePostgameInterview),
  };
}

function logGameDayRecapNormalizationWarnings(args: {
  candidateIndex?: number;
  stage: string;
  targetKey?: string;
  userId?: string;
  warnings: GameDayRecapNormalizationWarning[];
}): void {
  for (const warning of args.warnings) {
    if (warning.kind !== "invalid_postgame_interview") {
      continue;
    }

    logGameDayRecapWarn("process.postgame_interview_dropped", {
      candidateIndex: args.candidateIndex ?? null,
      details: warning.details,
      matchId: warning.matchId,
      reason: warning.reason,
      stage: args.stage,
      targetKey: args.targetKey ?? null,
      userId: args.userId ?? null,
    });
  }
}

function validateGameDayRecapPayload(
  result: GameDayRecapResultPayload,
  expectedGames: GameDayRecapPromptGame[],
  options: {
    allowPartial?: boolean;
    enforceBannedStylePhrases?: boolean;
  } = {},
): GameDayRecapResultPayload {
  const assessed = assessGameDayRecapDeterministicPayload(
    result,
    expectedGames,
    options,
  );
  if (assessed.issues.length > 0) {
    throw new GameDayRecapSemanticValidationError(assessed.issues);
  }

  return decorateGameDayRecapResultWithSurpriseMetadata(
    {
      games: assessed.orderedResult.games,
      summary: result.summary,
    },
    expectedGames,
  );
}

function assessGameDayRecapDeterministicPayload(
  result: GameDayRecapResultPayload,
  expectedGames: GameDayRecapPromptGame[],
  options: {
    allowPartial?: boolean;
    enforceBannedStylePhrases?: boolean;
  } = {},
): {
  issues: GameDayRecapSemanticValidationIssue[];
  orderedResult: GameDayRecapResultPayload;
} {
  const prepDedupedResult = removeDuplicatePrepContextParaphrases(
    result,
    expectedGames,
  );
  const orderedGames = orderGameDayRecapGames(
    prepDedupedResult.games,
    expectedGames,
    options.allowPartial ?? false,
  );
  const expectedGamesByMatchId = new Map(
    expectedGames.map((game) => [game.matchId, game]),
  );
  const issues = orderedGames.flatMap((game) => {
    const expectedGame = expectedGamesByMatchId.get(game.matchId);
    return expectedGame
      ? validateRecapGameSemantics(game, expectedGame, {
          enforceBannedStylePhrases: options.enforceBannedStylePhrases ?? false,
        })
      : [];
  });

  return {
    issues,
    orderedResult: {
      games: orderedGames,
      summary: prepDedupedResult.summary,
    },
  };
}

function removeDuplicatePrepContextParaphrases(
  result: GameDayRecapResultPayload,
  expectedGames: GameDayRecapPromptGame[],
): GameDayRecapResultPayload {
  const expectedGamesByMatchId = new Map(
    expectedGames.map((game) => [game.matchId, game]),
  );

  return {
    ...result,
    games: result.games.map((game) => {
      const expectedGame = expectedGamesByMatchId.get(game.matchId);
      if (!expectedGame?.requiredContextSentences.length) {
        return game;
      }

      return {
        ...game,
        writeup: removeDuplicatePrepContextFromWriteup(
          game.writeup,
          expectedGame.requiredContextSentences,
        ),
      };
    }),
  };
}

function removeDuplicatePrepContextFromWriteup(
  writeup: string,
  requiredContextSentences: string[],
): string {
  const requiredSentenceKeys = new Set(
    requiredContextSentences.map(normalizeRecapSentenceForComparison),
  );
  const writeupSentenceKeys = new Set(
    splitRecapText(writeup).map(normalizeRecapSentenceForComparison),
  );
  const hasAllRequiredSentences = Array.from(requiredSentenceKeys).every(
    (sentence) => writeupSentenceKeys.has(sentence),
  );
  if (!hasAllRequiredSentences) {
    return writeup;
  }

  const paragraphs = writeup
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const sourceParagraphs = paragraphs.length ? paragraphs : [writeup.trim()];
  const filteredParagraphs = sourceParagraphs
    .map((paragraph) =>
      splitRecapText(paragraph)
        .filter((sentence) => {
          const normalizedSentence =
            normalizeRecapSentenceForComparison(sentence);
          return (
            requiredSentenceKeys.has(normalizedSentence) ||
            !isDuplicatePrepContextParaphrase(
              sentence,
              requiredContextSentences,
            )
          );
        })
        .join(" "),
    )
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return filteredParagraphs.length ? filteredParagraphs.join("\n\n") : writeup;
}

function isDuplicatePrepContextParaphrase(
  sentence: string,
  requiredContextSentences: string[],
): boolean {
  const normalizedSentence = sentence.toLowerCase();
  const hasFocusContext = requiredContextSentences.some((requiredSentence) =>
    /\b(?:looks|attack)\b/i.test(requiredSentence),
  );
  const hasPaceContext = requiredContextSentences.some((requiredSentence) =>
    /\bpace\b/i.test(requiredSentence),
  );

  if (
    hasFocusContext &&
    /\b(?:prepared|read|readied|focus|looks|emphasis|came to play)\b/i.test(
      sentence,
    ) &&
    /\b(?:outside|inside|balanced|neutral)\b/i.test(sentence)
  ) {
    return true;
  }

  return (
    hasPaceContext &&
    /\b(?:pace|tempo|readied|prepared)\b/i.test(sentence) &&
    /\b(?:fast|slow|normal|motion|run and gun|look inside|low post|push|patient|princeton)\b/i.test(
      normalizedSentence,
    )
  );
}

function normalizeRecapSentenceForComparison(sentence: string): string {
  return sentence
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function decorateGameDayRecapResultWithSurpriseMetadata(
  result: GameDayRecapResultPayload,
  expectedGames: GameDayRecapPromptGame[],
): GameDayRecapResultPayload {
  const expectedGamesByMatchId = new Map(
    expectedGames.map((game) => [game.matchId, game]),
  );
  const games = result.games.map((game) => ({
    ...game,
    surpriseFactor: expectedGamesByMatchId.get(game.matchId)
      ? computeSurpriseFactorForGame(expectedGamesByMatchId.get(game.matchId)!)
      : null,
  }));
  const gameOfTheDay = selectGameOfTheDay(games, expectedGamesByMatchId);

  return {
    games,
    summary: {
      ...result.summary,
      gameOfTheDayMatchId: gameOfTheDay?.matchId ?? null,
      gameOfTheDaySurpriseFactor: gameOfTheDay?.surpriseFactor ?? null,
    },
  };
}

function computeSurpriseFactorForGame(game: GameDayRecapPromptGame): number {
  const winnerSide = resolveGameWinnerSide(game);
  if (!winnerSide) {
    return 0;
  }

  const loserSide = winnerSide === "home" ? "away" : "home";
  const winner = game.teams[winnerSide];
  const loser = game.teams[loserSide];
  let score = 5;

  score += surpriseFactorMarginAdjustment(game.finalMargin);
  score += surpriseFactorOvertimeBonus(game.quarterFacts.periods.length);

  if (!game.neutral && winnerSide === "away") {
    score += 0.7;
  }

  score += surpriseFactorRatingAdjustment(
    winner.ratingTotal,
    loser.ratingTotal,
  );
  score += surpriseFactorRecordAdjustment(
    winner.recordEnteringGame,
    loser.recordEnteringGame,
  );
  score += surpriseFactorStandingsAdjustment(
    winner.conferencePosition,
    loser.conferencePosition,
  );
  score += surpriseFactorGdpAdjustment(winner.gdp, loser.gdp);
  score -=
    winner.keyAbsenceCount * 0.8 +
    loser.keyAbsenceCount * 0.8 +
    winner.foulTroubleLimitationCount * 0.25 +
    loser.foulTroubleLimitationCount * 0.25 +
    countStrategicDeemphasisFlags(winner.recentSignalFlags) * 0.35 +
    countStrategicDeemphasisFlags(loser.recentSignalFlags) * 0.35;

  return roundToOneDecimal(Math.max(0, Math.min(10, score)));
}

function selectGameOfTheDay(
  games: GameDayRecapResultPayload["games"],
  expectedGamesByMatchId: Map<string, GameDayRecapPromptGame>,
): GameDayRecapResultGame | null {
  let bestGame: GameDayRecapResultGame | null = null;

  for (const game of games) {
    if (game.surpriseFactor === null) {
      continue;
    }
    if (!bestGame) {
      bestGame = game;
      continue;
    }

    if (
      (game.surpriseFactor ?? -Infinity) >
      (bestGame.surpriseFactor ?? -Infinity)
    ) {
      bestGame = game;
      continue;
    }

    if (game.surpriseFactor !== bestGame.surpriseFactor) {
      continue;
    }

    const currentExpected = expectedGamesByMatchId.get(game.matchId);
    const bestExpected = expectedGamesByMatchId.get(bestGame.matchId);
    const currentOvertimeCount = countOvertimePeriods(currentExpected);
    const bestOvertimeCount = countOvertimePeriods(bestExpected);
    if (currentOvertimeCount > bestOvertimeCount) {
      bestGame = game;
      continue;
    }
    if (currentOvertimeCount < bestOvertimeCount) {
      continue;
    }

    const currentMargin =
      currentExpected?.finalMargin ?? Number.POSITIVE_INFINITY;
    const bestMargin = bestExpected?.finalMargin ?? Number.POSITIVE_INFINITY;
    if (currentMargin < bestMargin) {
      bestGame = game;
    }
  }

  return bestGame;
}

function resolveGameWinnerSide(
  game: GameDayRecapPromptGame,
): "away" | "home" | null {
  if (game.teams.home.score === game.teams.away.score) {
    return null;
  }

  return game.teams.home.score > game.teams.away.score ? "home" : "away";
}

function formatGameFinalScore(game: GameDayRecapPromptGame): string {
  return `${game.teams.home.score}-${game.teams.away.score}`;
}

function surpriseFactorMarginAdjustment(finalMargin: number): number {
  if (finalMargin <= 2) {
    return 1.8;
  }
  if (finalMargin <= 5) {
    return 1.2;
  }
  if (finalMargin <= 8) {
    return 0.6;
  }
  if (finalMargin <= 12) {
    return 0.1;
  }
  if (finalMargin <= 17) {
    return -0.3;
  }
  if (finalMargin <= 24) {
    return -1.1;
  }
  return -1.8;
}

function surpriseFactorOvertimeBonus(periodCount: number): number {
  const overtimeCount = Math.max(0, periodCount - 4);
  if (overtimeCount === 0) {
    return 0;
  }

  return 1.4 + Math.max(0, overtimeCount - 1) * 0.4;
}

function surpriseFactorRatingAdjustment(
  winnerRatingTotal: number | null,
  loserRatingTotal: number | null,
): number {
  if (winnerRatingTotal === null || loserRatingTotal === null) {
    return 0;
  }

  const gap = Math.abs(winnerRatingTotal - loserRatingTotal);
  if (gap === 0) {
    return 0;
  }

  if (winnerRatingTotal < loserRatingTotal) {
    return Math.min(1.4, gap / 4);
  }

  return -Math.min(0.8, gap / 8);
}

function surpriseFactorRecordAdjustment(
  winnerRecord: TeamSeasonContextPromptField,
  loserRecord: TeamSeasonContextPromptField,
): number {
  const winnerRecordValue = parsePromptRecord(winnerRecord);
  const loserRecordValue = parsePromptRecord(loserRecord);
  if (!winnerRecordValue || !loserRecordValue) {
    return 0;
  }

  const winnerPct =
    winnerRecordValue.wins /
    (winnerRecordValue.wins + winnerRecordValue.losses);
  const loserPct =
    loserRecordValue.wins / (loserRecordValue.wins + loserRecordValue.losses);
  if (!Number.isFinite(winnerPct) || !Number.isFinite(loserPct)) {
    return 0;
  }

  const gap = Math.abs(winnerPct - loserPct);
  if (gap < 0.001) {
    return 0;
  }

  if (winnerPct < loserPct) {
    return Math.min(1.5, gap * 7);
  }

  return -Math.min(1, gap * 4.5);
}

function surpriseFactorStandingsAdjustment(
  winnerConferencePosition: number | null,
  loserConferencePosition: number | null,
): number {
  if (
    winnerConferencePosition === null ||
    loserConferencePosition === null ||
    winnerConferencePosition < 1 ||
    loserConferencePosition < 1
  ) {
    return 0;
  }

  const gap = Math.abs(winnerConferencePosition - loserConferencePosition);
  if (gap < 2) {
    return 0;
  }

  if (winnerConferencePosition > loserConferencePosition) {
    return Math.min(1, gap * 0.15);
  }

  return -Math.min(0.7, gap * 0.1);
}

function surpriseFactorGdpAdjustment(
  winnerGdp: Record<string, number | string>,
  loserGdp: Record<string, number | string>,
): number {
  const winnerHits = countGdpOutcomes(winnerGdp, "hit");
  const loserMisses = countGdpOutcomes(loserGdp, "miss");

  return Math.min(1.1, (winnerHits + loserMisses) * 0.35);
}

function countGdpOutcomes(
  gdp: Record<string, number | string>,
  suffix: "hit" | "miss",
): number {
  return Object.values(gdp).filter((value) => {
    const normalizedValue = asOptionalString(value)?.trim().toLowerCase();
    return normalizedValue?.endsWith(`.${suffix}`) ?? false;
  }).length;
}

function countStrategicDeemphasisFlags(recentSignalFlags: string[]): number {
  return recentSignalFlags.includes("possible_strategic_deemphasis") ? 1 : 0;
}

function countOvertimePeriods(
  game: GameDayRecapPromptGame | undefined,
): number {
  return game ? Math.max(0, game.quarterFacts.periods.length - 4) : 0;
}

function isPlayoffRecapGame(game: GameDayRecapPromptGame): boolean {
  return (
    Boolean(game.seriesContext) ||
    classifyCompetition(game.type).competitionKey === "PLAYOFFS"
  );
}

function parsePromptRecord(
  value: TeamSeasonContextPromptField,
): { losses: number; wins: number } | null {
  const match = value?.match(/^\s*(\d+)-(\d+)\s*$/);
  if (!match) {
    return null;
  }

  const wins = Number(match[1]);
  const losses = Number(match[2]);
  if (
    !Number.isInteger(wins) ||
    !Number.isInteger(losses) ||
    wins + losses === 0
  ) {
    return null;
  }

  return { losses, wins };
}

function resolveThroughThreeQuartersState(
  expectedGame: GameDayRecapPromptGame,
): {
  awayScore: number;
  homeScore: number;
  leadingSide: "away" | "home" | "tie";
  margin: number;
} | null {
  if (
    expectedGame.quarterScores.home.length < 3 ||
    expectedGame.quarterScores.away.length < 3
  ) {
    return null;
  }

  const homeScore = expectedGame.quarterScores.home
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);
  const awayScore = expectedGame.quarterScores.away
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);

  return {
    awayScore,
    homeScore,
    leadingSide:
      homeScore === awayScore ? "tie" : homeScore > awayScore ? "home" : "away",
    margin: Math.abs(homeScore - awayScore),
  };
}

function buildSafeThroughThreeQuartersSentence(
  expectedGame: GameDayRecapPromptGame,
): string | null {
  const state = resolveThroughThreeQuartersState(expectedGame);
  if (!state) {
    return null;
  }

  return buildThroughThreeQuartersSentenceFromState(
    {
      awayScore: state.awayScore,
      homeScore: state.homeScore,
      label: "Through three quarters",
      margin: state.margin,
      period: 3,
      scoreFromLeaderPerspective:
        state.leadingSide === "away"
          ? `${state.awayScore}-${state.homeScore}`
          : `${state.homeScore}-${state.awayScore}`,
    },
    expectedGame.teams.home.name,
    expectedGame.teams.away.name,
  );
}

function resolveSingleMentionedTeamSide(
  sentence: string,
  expectedGame: GameDayRecapPromptGame,
): "away" | "home" | null {
  const mentionsHome = mentionsTeam(sentence, expectedGame.teams.home.name);
  const mentionsAway = mentionsTeam(sentence, expectedGame.teams.away.name);
  if (mentionsHome === mentionsAway) {
    return null;
  }

  return mentionsHome ? "home" : "away";
}

function orderGameDayRecapGames(
  games: GameDayRecapResultPayload["games"],
  expectedGames: GameDayRecapPromptGame[],
  allowPartial = false,
): GameDayRecapResultPayload["games"] {
  const expectedMatchIds = expectedGames.map((game) => game.matchId);
  const matchIdSet = new Set(expectedMatchIds);
  const gamesByMatchId = new Map<string, GameDayRecapResultGame>();

  for (const game of games) {
    if (!matchIdSet.has(game.matchId)) {
      throw new Error(
        "Game day recap result did not match the expected slate coverage.",
      );
    }
    if (gamesByMatchId.has(game.matchId)) {
      throw new Error(
        "Game day recap result contained duplicate match coverage.",
      );
    }
    gamesByMatchId.set(game.matchId, game);
  }

  if (!allowPartial && gamesByMatchId.size !== expectedMatchIds.length) {
    throw new Error(
      "Game day recap result did not match the expected slate coverage.",
    );
  }

  const orderedGames = expectedMatchIds.flatMap((matchId) => {
    const game = gamesByMatchId.get(matchId);
    return game ? [game] : [];
  });

  if (!allowPartial && orderedGames.length !== expectedMatchIds.length) {
    const missingMatchId = expectedMatchIds.find(
      (matchId) => !gamesByMatchId.has(matchId),
    );
    throw new Error(
      missingMatchId
        ? `Game day recap result omitted match ${missingMatchId}.`
        : "Game day recap result did not match the expected slate coverage.",
    );
  }

  return orderedGames;
}

function validateRecapGameSemantics(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
  options: {
    enforceBannedStylePhrases?: boolean;
  } = {},
): GameDayRecapSemanticValidationIssue[] {
  return [
    ...collectSemanticIssuesForField(
      game.headline,
      "headline",
      game.matchId,
      expectedGame,
      options,
    ),
    ...collectSemanticIssuesForField(
      game.writeup,
      "writeup",
      game.matchId,
      expectedGame,
      options,
    ),
    ...validatePostgameInterview(game, expectedGame, options),
    ...validateGameLevelStyle(game, expectedGame),
  ];
}

function collectSemanticIssuesForField(
  text: string,
  field: GameDayRecapSemanticValidationIssueField,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  options: {
    enforceBannedStylePhrases?: boolean;
  } = {},
): GameDayRecapSemanticValidationIssue[] {
  return splitRecapText(text).flatMap((sentence, sentenceIndex) => [
    ...validateQuarterSentence(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validateRunSentence(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validateTacticContrastSentence(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validatePlayoffRecordLanguage(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validatePlayoffStreakLanguage(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validateScoringContextLanguage(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...(options.enforceBannedStylePhrases
      ? validateBannedStylePhrases(sentence, matchId, field, sentenceIndex)
      : []),
    ...validateOneGameStreakLanguage(sentence, matchId, field, sentenceIndex),
  ]);
}

function validateQuarterSentence(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  const referencedPeriod = extractReferencedQuarter(sentence);
  if (!referencedPeriod) {
    return [];
  }
  if (/\brun\b/i.test(sentence) && extractRunClaim(sentence, expectedGame)) {
    return [];
  }

  const periodFact = expectedGame.quarterFacts.periods.find(
    (period) => period.period === referencedPeriod,
  );
  if (!periodFact) {
    return [];
  }

  const quarterWinnerVerbMatch = sentence.match(
    /\b(?:outscor(?:e|ed|es|ing)|won|take(?:s|n)?|took|claim(?:ed|s|ing)|domin(?:ate|ated|ates|ating)|control(?:led|ling|s)?)\b/i,
  );
  if (!quarterWinnerVerbMatch) {
    return [];
  }

  const issues: GameDayRecapSemanticValidationIssue[] = [];
  const periodMatch = sentence.match(
    /\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+quarter\b/i,
  );
  const scorePair = findClosestScorePair(sentence, periodMatch?.index ?? 0);
  const winnerSide = resolveExplicitQuarterWinnerSide(sentence, expectedGame);

  if (scorePair) {
    const matchesActualScore =
      (scorePair.first === periodFact.homeScore &&
        scorePair.second === periodFact.awayScore) ||
      (scorePair.first === periodFact.awayScore &&
        scorePair.second === periodFact.homeScore);
    if (!matchesActualScore) {
      issues.push({
        actualValue: `${periodFact.homeScore}-${periodFact.awayScore}`,
        feedback: `For match ${matchId}, the ${periodFact.label} score was ${periodFact.homeScore}-${periodFact.awayScore} from the home-away view (${periodFact.awayScore}-${periodFact.homeScore} from the away-home view). Do not use ${scorePair.first}-${scorePair.second}.`,
        field,
        kind: "quarter_score_mismatch",
        matchId,
        period: periodFact.period,
        reason: `${periodFact.label} was ${periodFact.homeScore}-${periodFact.awayScore}, not ${scorePair.first}-${scorePair.second}.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
      });
      return issues;
    }

    if (scorePair.first === scorePair.second) {
      issues.push({
        actualValue: `${scorePair.first}-${scorePair.second}`,
        feedback: `For match ${matchId}, the ${periodFact.label} was tied ${scorePair.first}-${scorePair.second}. Do not say either team outscored, won, or took that quarter.`,
        field,
        kind: "tied_quarter_claim",
        matchId,
        period: periodFact.period,
        reason: `${periodFact.label} was tied ${scorePair.first}-${scorePair.second}, so no team outscored the other.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
      });
      return issues;
    }
  }

  if (!winnerSide) {
    return issues;
  }

  if (periodFact.winningSide === "tie") {
    issues.push({
      actualValue: `${periodFact.homeScore}-${periodFact.awayScore}`,
      feedback: `For match ${matchId}, the ${periodFact.label} was tied ${periodFact.homeScore}-${periodFact.awayScore}. Do not say ${expectedGame.teams[winnerSide].name} won that quarter.`,
      field,
      kind: "wrong_quarter_winner",
      matchId,
      period: periodFact.period,
      reason: `${expectedGame.teams[winnerSide].name} was credited with winning a tied ${periodFact.label}.`,
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
      teamSide: winnerSide,
    });
    return issues;
  }

  if (periodFact.winningSide !== winnerSide) {
    issues.push({
      actualValue: expectedGame.teams[periodFact.winningSide].name,
      feedback: `For match ${matchId}, ${expectedGame.teams[periodFact.winningSide].name} won the ${periodFact.label} ${winnerFacingQuarterScore(periodFact, periodFact.winningSide)}. Do not say ${expectedGame.teams[winnerSide].name} won that quarter.`,
      field,
      kind: "wrong_quarter_winner",
      matchId,
      period: periodFact.period,
      reason: `${expectedGame.teams[winnerSide].name} was credited with the ${periodFact.label}, but ${expectedGame.teams[periodFact.winningSide].name} actually won it.`,
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
      teamSide: winnerSide,
    });
    return issues;
  }

  if (scorePair) {
    const expectedWinnerScore =
      winnerSide === "home" ? periodFact.homeScore : periodFact.awayScore;
    const expectedLoserScore =
      winnerSide === "home" ? periodFact.awayScore : periodFact.homeScore;
    if (
      scorePair.first !== expectedWinnerScore ||
      scorePair.second !== expectedLoserScore
    ) {
      issues.push({
        actualValue: `${expectedWinnerScore}-${expectedLoserScore}`,
        feedback: `For match ${matchId}, if you say ${expectedGame.teams[winnerSide].name} won the ${periodFact.label}, use ${expectedWinnerScore}-${expectedLoserScore}.`,
        field,
        kind: "quarter_winner_score_mismatch",
        matchId,
        period: periodFact.period,
        reason: `${expectedGame.teams[winnerSide].name} was paired with the wrong ${periodFact.label} score.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
        teamSide: winnerSide,
      });
    }
  }

  return issues;
}

function validateRunSentence(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  const runClaim = extractRunClaim(sentence, expectedGame);
  if (!runClaim) {
    return [];
  }

  const supportedRuns = collectSupportedRuns(expectedGame);
  const matchingRun = findMatchingSupportedRun(runClaim, supportedRuns);

  if (!matchingRun) {
    return [];
  }

  if (!hasRequiredRunTimingAnchors(sentence, matchingRun)) {
    return [
      {
        actualValue: formatRunTimingInstruction(matchingRun),
        feedback: `For match ${matchId}, any mentioned run must include the supplied timing anchors. ${formatRunTimingInstruction(
          matchingRun,
        )}`,
        field,
        kind: "missing_run_timing",
        matchId,
        reason: `The recap mentioned a run without the required timing anchors. ${formatRunTimingInstruction(
          matchingRun,
        )}`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
        teamSide: matchingRun.teamSide ?? undefined,
      },
    ];
  }

  if (
    matchingRun.startMarginFromTeamPerspective >= 0 &&
    containsComebackRunLanguage(sentence)
  ) {
    const startingState =
      matchingRun.startMarginFromTeamPerspective === 0 ? "tied" : "ahead";
    const teamName =
      matchingRun.teamName ??
      (matchingRun.teamSide ? expectedGame.teams[matchingRun.teamSide].name : null) ??
      "That team";

    return [
      {
        actualValue: `${teamName} started that ${matchingRun.teamPoints}-${matchingRun.opponentPoints} run ${startingState}.`,
        feedback: `For match ${matchId}, do not use comeback phrasing for the ${matchingRun.teamPoints}-${matchingRun.opponentPoints} run because ${teamName} started that run ${startingState}, not trailing. Describe it neutrally as building the lead or staying in front.`,
        field,
        kind: "unsupported_run_framing",
        matchId,
        reason: `${teamName} started that ${matchingRun.teamPoints}-${matchingRun.opponentPoints} run ${startingState}, so comeback phrasing does not fit.`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
        teamSide: matchingRun.teamSide ?? undefined,
      },
    ];
  }

  return [];
}

function validateTacticContrastSentence(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  if (
    !/\b(?:contrasting|contrast(?:ed|ing)?|opposite|polar opposite|diametrically opposite)\b/i.test(
      sentence,
    )
  ) {
    return [];
  }

  const awayOffense = expectedGame.teams.away.offStrategy?.trim() ?? null;
  const homeOffense = expectedGame.teams.home.offStrategy?.trim() ?? null;
  if (!awayOffense || !homeOffense) {
    return [];
  }
  if (
    !sentence.toLowerCase().includes(awayOffense.toLowerCase()) ||
    !sentence.toLowerCase().includes(homeOffense.toLowerCase())
  ) {
    return [];
  }

  const awayFamily = resolveOffenseStoryFamily(awayOffense);
  const homeFamily = resolveOffenseStoryFamily(homeOffense);
  if (!awayFamily || awayFamily !== homeFamily) {
    return [];
  }

  const familyLabel = awayFamily === "inside" ? "inside" : "outside";
  return [
    {
      actualValue: `${awayOffense} and ${homeOffense} both resolve to the ${familyLabel} family here.`,
      feedback: `For match ${matchId}, do not call ${awayOffense} and ${homeOffense} contrasting offenses. They sit in the same ${familyLabel} offensive family here, so describe them neutrally instead.`,
      field,
      kind: "unsupported_tactic_contrast",
      matchId,
      reason: `${awayOffense} and ${homeOffense} were described as contrasting offenses even though they live in the same ${familyLabel} family.`,
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
    },
  ];
}

function containsComebackRunLanguage(sentence: string): boolean {
  return [
    /\bshowed signs of life\b/i,
    /\bmade a push\b/i,
    /\b(?:rally|rallied|rallying|stormed|charged|clawed|fought|roared|came)\s+back\b/i,
    /\bcomeback\b/i,
    /\berased\b[^.!?]{0,40}\bdeficit\b/i,
  ].some((pattern) => pattern.test(sentence));
}

function validateOverlappingRunMentions(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  const supportedRuns = collectSupportedRuns(expectedGame);
  if (supportedRuns.length < 2) {
    return [];
  }

  const mentionedRuns = splitRecapText(game.writeup).flatMap(
    (sentence, sentenceIndex) => {
      const runClaim = extractRunClaim(sentence, expectedGame);
      const run = runClaim
        ? findMatchingSupportedRun(runClaim, supportedRuns)
        : null;
      return run ? [{ run, sentence, sentenceIndex }] : [];
    },
  );
  const uniqueMentions = new Map<string, (typeof mentionedRuns)[number]>();
  for (const mention of mentionedRuns) {
    const key = buildRunIdentityKey(mention.run);
    if (!uniqueMentions.has(key)) {
      uniqueMentions.set(key, mention);
    }
  }
  const mentions = Array.from(uniqueMentions.values());

  for (let leftIndex = 0; leftIndex < mentions.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < mentions.length;
      rightIndex += 1
    ) {
      const left = mentions[leftIndex]!;
      const right = mentions[rightIndex]!;
      if (!runsOverlapForRecapValidation(left.run, right.run)) {
        continue;
      }

      return [
        {
          actualValue: `${formatRunScore(left.run)} and ${formatRunScore(right.run)}`,
          feedback: `For match ${game.matchId}, do not mention overlapping run windows as separate swings. Keep the stronger primary run or choose only non-overlapping run facts.`,
          field: "writeup",
          kind: "overlapping_run_claims",
          matchId: game.matchId,
          reason:
            "The writeup mentioned overlapping run windows as separate game swings.",
          salvage: "patch_or_remove",
          sentence: right.sentence,
          sentenceIndex: right.sentenceIndex,
          teamSide: right.run.teamSide ?? undefined,
        },
      ];
    }
  }

  return [];
}

function findMatchingSupportedRun(
  runClaim: {
    opponentPoints: number;
    teamPoints: number;
    teamSide: "away" | "home" | null;
  },
  supportedRuns: GameDayRecapPlayByPlayRun[],
): GameDayRecapPlayByPlayRun | null {
  return (
    supportedRuns.find(
      (run) =>
        run.teamPoints === runClaim.teamPoints &&
        run.opponentPoints === runClaim.opponentPoints &&
        (!runClaim.teamSide || run.teamSide === runClaim.teamSide),
    ) ?? null
  );
}

function collectSupportedRuns(
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapPlayByPlayRun[] {
  const runs = [
    expectedGame.playByPlayFacts?.primaryRun,
    expectedGame.playByPlayFacts?.secondaryRun,
    expectedGame.playByPlayFacts?.longestUnansweredRun,
    expectedGame.playByPlayFacts?.bestCompetitiveSwingRun,
  ].filter((run): run is GameDayRecapPlayByPlayRun => Boolean(run?.teamSide));

  const deduped = new Map<string, GameDayRecapPlayByPlayRun>();
  for (const run of runs) {
    const key = [
      run.teamSide,
      run.teamPoints,
      run.opponentPoints,
      run.startQuarter,
      run.startClock,
      run.endQuarter,
      run.endClock,
    ].join("|");
    if (!deduped.has(key)) {
      deduped.set(key, run);
    }
  }

  return Array.from(deduped.values());
}

function buildRunIdentityKey(run: GameDayRecapPlayByPlayRun): string {
  return [
    run.teamSide,
    run.teamPoints,
    run.opponentPoints,
    run.startQuarter,
    run.startClock,
    run.endQuarter,
    run.endClock,
  ].join("|");
}

function formatRunScore(run: GameDayRecapPlayByPlayRun): string {
  return `${run.teamPoints}-${run.opponentPoints}`;
}

function runsOverlapForRecapValidation(
  left: GameDayRecapPlayByPlayRun,
  right: GameDayRecapPlayByPlayRun,
): boolean {
  const leftInterval = resolveRunIntervalForRecapValidation(left);
  const rightInterval = resolveRunIntervalForRecapValidation(right);
  if (!leftInterval || !rightInterval) {
    return false;
  }

  return (
    leftInterval.start < rightInterval.end &&
    rightInterval.start < leftInterval.end
  );
}

function resolveRunIntervalForRecapValidation(
  run: GameDayRecapPlayByPlayRun,
): { end: number; start: number } | null {
  if (
    run.startQuarter === null ||
    !run.startClock ||
    run.endQuarter === null ||
    !run.endClock
  ) {
    return null;
  }

  const start = resolveRunAnchorOrderingForRecapValidation(
    run.startQuarter,
    run.startClock,
  );
  const end = resolveRunAnchorOrderingForRecapValidation(
    run.endQuarter,
    run.endClock,
  );
  return {
    end: Math.max(start, end),
    start: Math.min(start, end),
  };
}

function resolveRunAnchorOrderingForRecapValidation(
  quarter: number,
  clock: string,
): number {
  const periodSeconds = quarter <= 4 ? 12 * 60 : 5 * 60;
  const periodOffset =
    quarter <= 4
      ? (quarter - 1) * 12 * 60
      : 4 * 12 * 60 + (quarter - 5) * 5 * 60;
  const remainingSeconds = parseRunClockForRecapValidation(clock);
  return periodOffset + Math.max(0, periodSeconds - remainingSeconds);
}

function parseRunClockForRecapValidation(clock: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) {
    return 0;
  }

  return (
    Number.parseInt(match[1] ?? "0", 10) * 60 +
    Number.parseInt(match[2] ?? "0", 10)
  );
}

function validatePlayoffRecordLanguage(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  if (!isPlayoffRecapGame(expectedGame)) {
    return [];
  }
  if (!containsPlayoffRecordLanguage(sentence, expectedGame)) {
    return [];
  }

  return [
    {
      actualValue: "playoff regular-season record reference",
      feedback: `For match ${matchId}, do not mention regular-season records in a playoff recap.`,
      field,
      kind: "playoff_record_language",
      matchId,
      reason: "Do not mention regular-season records in a playoff recap.",
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
    },
  ];
}

function validatePlayoffStreakLanguage(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  if (!isPlayoffRecapGame(expectedGame)) {
    return [];
  }
  if (!containsPlayoffStreakLanguage(sentence)) {
    return [];
  }

  return [
    {
      actualValue: "playoff streak reference",
      feedback: `For match ${matchId}, do not mention winning or losing streaks in a playoff recap. Use the series state instead when relevant.`,
      field,
      kind: "playoff_streak_language",
      matchId,
      reason: "Do not mention winning or losing streaks in a playoff recap.",
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
    },
  ];
}

function extractRunClaim(
  sentence: string,
  expectedGame: GameDayRecapPromptGame,
): {
  opponentPoints: number;
  teamPoints: number;
  teamSide: "away" | "home" | null;
} | null {
  const match = sentence.match(/\b(\d{1,2})-(\d{1,2})\s+run\b/i);
  if (!match) {
    return null;
  }

  return {
    opponentPoints: Number.parseInt(match[2] ?? "", 10),
    teamPoints: Number.parseInt(match[1] ?? "", 10),
    teamSide: resolveSingleMentionedTeamSide(sentence, expectedGame),
  };
}

function hasRequiredRunTimingAnchors(
  sentence: string,
  run: GameDayRecapPlayByPlayRun,
): boolean {
  if (run.startQuarter === null || !run.startClock) {
    return true;
  }

  if (
    !buildRunAnchorRegex(run.startQuarter, run.startClock, "start").test(
      sentence,
    )
  ) {
    return false;
  }

  if (
    run.endQuarter === null ||
    !run.endClock ||
    (run.endQuarter === run.startQuarter && run.endClock === run.startClock)
  ) {
    return true;
  }

  return buildRunAnchorRegex(run.endQuarter, run.endClock, "end").test(
    sentence,
  );
}

function formatRunTimingInstruction(run: GameDayRecapPlayByPlayRun): string {
  if (
    run.startQuarter !== null &&
    run.startClock &&
    run.endQuarter !== null &&
    run.endClock
  ) {
    return `Use "from ${formatRunAnchor(run.startQuarter, run.startClock)} to ${formatRunAnchor(run.endQuarter, run.endClock)}".`;
  }
  if (run.startQuarter !== null && run.startClock) {
    return `Use the supplied run start time at ${formatRunAnchor(run.startQuarter, run.startClock)}.`;
  }
  return "Use the supplied run timing anchors.";
}

function formatRunAnchor(quarter: number, clock: string): string {
  return `${clock} left in the ${formatPeriodLabel(quarter)}`;
}

function buildRunAnchorRegex(
  quarter: number,
  clock: string,
  position: "end" | "start",
): RegExp {
  const periodLabel = escapeRegExp(formatPeriodLabel(quarter));
  const anchor = `${escapeRegExp(clock)}\\s+left\\s+in\\s+(?:the\\s+)?${periodLabel}`;
  const prefix = position === "start" ? "(?:from|starting at)" : "to";
  return new RegExp(`\\b${prefix}\\s+${anchor}\\b`, "i");
}

function containsPlayoffRecordLanguage(
  sentence: string,
  expectedGame: GameDayRecapPromptGame,
): boolean {
  for (const side of ["home", "away"] as const) {
    const teamName = expectedGame.teams[side].name;
    if (!mentionsTeam(sentence, teamName)) {
      continue;
    }

    const escapedName = escapeRegExp(teamName);
    if (
      new RegExp(
        `${escapedName}[^.!?]{0,20}\\((\\d{1,2})-(\\d{1,2})\\)`,
        "i",
      ).test(sentence)
    ) {
      return true;
    }
    if (
      new RegExp(
        `${escapedName}[^.!?]{0,50}\\b(?:now\\s+at|at|to|improved\\s+to|moved\\s+to|fell\\s+to|dropped\\s+to)\\s+\\d{1,2}-\\d{1,2}\\b`,
        "i",
      ).test(sentence)
    ) {
      return true;
    }
    if (
      /\b\d{1,2}-\d{1,2}\s+on the season\b/i.test(sentence) ||
      /\bseason record\b/i.test(sentence)
    ) {
      return true;
    }
  }

  return false;
}

function validateScoringContextLanguage(
  sentence: string,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  const claimsHighScoring =
    /\b(?:high-scoring|high scoring|shootout|offensive explosion|scoring barrage|points came easy)\b/i.test(
      sentence,
    );
  const claimsLowScoring =
    /\b(?:low-scoring|low scoring|defensive grind|defensive struggle|points were scarce|rock fight)\b/i.test(
      sentence,
    );
  if (!claimsHighScoring && !claimsLowScoring) {
    return [];
  }

  const context = expectedGame.gameScoringContext;
  if (
    (claimsHighScoring && context === "high_scoring_shootout") ||
    (claimsLowScoring && context === "low_scoring_grind")
  ) {
    return [];
  }

  const actualValue = `${expectedGame.teams.home.name} ${expectedGame.teams.home.score}, ${expectedGame.teams.away.name} ${expectedGame.teams.away.score}`;
  const requiredThreshold = claimsHighScoring
    ? "both teams must score more than 100"
    : "both teams must score fewer than 80";

  return [
    {
      actualValue,
      feedback: `For match ${matchId}, only call the game ${claimsHighScoring ? "high-scoring" : "low-scoring"} when ${requiredThreshold}. Actual final: ${actualValue}.`,
      field,
      kind: "unsupported_scoring_context",
      matchId,
      reason: `The recap used ${claimsHighScoring ? "high-scoring" : "low-scoring"} framing without the configured scoring-context threshold.`,
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
    },
  ];
}

function containsPlayoffStreakLanguage(sentence: string): boolean {
  return [
    /\b(?:winning|losing)\s+streak\b/i,
    /\b(?:won|lost)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s+straight\b/i,
    /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth)\s+straight\b/i,
    /\b[WL]\d+\b/i,
  ].some((pattern) => pattern.test(sentence));
}

function validateBannedStylePhrases(
  sentence: string,
  matchId: string,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  return BANNED_RECAP_STYLE_PHRASES.flatMap((phrase) => {
    if (!sentence.toLowerCase().includes(phrase)) {
      return [];
    }

    return [
      {
        actualValue: phrase,
        feedback: `For match ${matchId}, remove the filler phrase "${phrase}" and replace it with a concrete basketball detail or drop the sentence.`,
        field,
        kind: "banned_style_phrase",
        matchId,
        reason: `The recap used the banned filler phrase "${phrase}".`,
        salvage: semanticIssueSalvageForField(field),
        sentence,
        sentenceIndex,
      },
    ];
  });
}

function validateOneGameStreakLanguage(
  sentence: string,
  matchId: string,
  field: GameDayRecapSemanticValidationIssueField,
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  if (!/\bone-game\s+(winning|losing)\s+streak\b/i.test(sentence)) {
    return [];
  }

  return [
    {
      actualValue: "one-game streak language",
      feedback: `For match ${matchId}, do not describe a one-game win or loss as a streak.`,
      field,
      kind: "one_game_streak_language",
      matchId,
      reason: "The recap called a one-game result a streak.",
      salvage: semanticIssueSalvageForField(field),
      sentence,
      sentenceIndex,
    },
  ];
}

function validateGameLevelStyle(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  return [
    ...validateDuplicateOutcomeRestatement(game, expectedGame),
    ...validateDecisiveEndingEmphasis(game, expectedGame),
    ...validateRequiredContextSentences(game, expectedGame),
    ...validateRequiredPrimaryRunMention(game, expectedGame),
    ...validateOverlappingRunMentions(game, expectedGame),
    ...validateRequiredSeriesSummaryLine(game, expectedGame),
    ...validateChoppyFactStack(game),
    ...validateDuplicatePeriodStateRestatement(game, expectedGame),
    ...validateRepetitiveSentenceStarts(game),
    ...validateShortFactSentenceCluster(game),
  ];
}

function validateRequiredContextSentences(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  const requiredContextSentences = expectedGame.requiredContextSentences ?? [];
  if (!requiredContextSentences.length) {
    return [];
  }

  const writeupSentences = splitRecapText(game.writeup);
  return requiredContextSentences.flatMap((requiredSentence) => {
    const occurrenceCount = writeupSentences.filter(
      (sentence) => sentence === requiredSentence,
    ).length;
    if (occurrenceCount >= 1) {
      return [];
    }

    return [
      {
        actualValue: requiredSentence,
        feedback: `For match ${game.matchId}, include the required context sentence "${requiredSentence}" exactly once in the writeup.`,
        field: "writeup",
        kind: "missing_required_context_sentence",
        matchId: game.matchId,
        reason:
          "The writeup omitted a required effort or game-day-prep context sentence.",
        salvage: "patch_or_remove",
        sentence: writeupSentences[0] ?? game.writeup,
        sentenceIndex: Math.min(2, writeupSentences.length),
      },
    ];
  });
}

function validatePostgameInterview(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
  _options: {
    enforceBannedStylePhrases?: boolean;
  } = {},
): GameDayRecapSemanticValidationIssue[] {
  const interviews =
    (
      game.postgameInterviews?.length
        ? game.postgameInterviews
        : game.postgameInterview
          ? [game.postgameInterview]
          : []
    ).filter(
      (
        interview,
      ): interview is GameDayRecapResultPostgameInterview => Boolean(interview),
    );
  if (!interviews.length) {
    return [];
  }

  const candidates = collectPostgameInterviewCandidates(expectedGame);
  const issues: GameDayRecapSemanticValidationIssue[] = [];

  for (const interview of interviews) {
    const candidate =
      candidates.find(
        (entry) =>
          interview.playerName === entry.playerName &&
          interview.teamName === entry.teamName &&
          interview.teamSide === entry.teamSide,
      ) ?? null;
    if (!candidate) {
      issues.push({
        actualValue: "no supported interview candidate",
        feedback: `For match ${game.matchId}, omit postgameInterview entries unless the payload includes a supported candidate for that player and team.`,
        field: "postgameInterview",
        kind: "unsupported_interview_claim",
        matchId: game.matchId,
        reason:
          "The recap included a postgameInterview block for a player who was not supplied as a supported interview candidate.",
        salvage: semanticIssueSalvageForField("postgameInterview"),
        sentence: interview.title,
        sentenceIndex: 0,
        teamSide: interview.teamSide,
      });
      continue;
    }

    let sentenceIndexOffset = 0;
    issues.push(
      ...offsetSemanticIssueSentenceIndexes(
        [
          ...collectInterviewSemanticIssues(
            interview.title,
            "postgameInterview",
            game.matchId,
            expectedGame,
          ),
          ...validateUnsupportedInterviewText(
            interview.title,
            game.matchId,
            candidate.teamSide,
            0,
          ),
        ],
        sentenceIndexOffset,
      ),
    );
    sentenceIndexOffset += 1;

    for (const exchange of interview.qa) {
      issues.push(
        ...offsetSemanticIssueSentenceIndexes(
          [
            ...collectInterviewSemanticIssues(
              exchange.question,
              "postgameInterview",
              game.matchId,
              expectedGame,
            ),
            ...validateUnsupportedInterviewText(
              exchange.question,
              game.matchId,
              candidate.teamSide,
              0,
            ),
          ],
          sentenceIndexOffset,
        ),
      );
      sentenceIndexOffset += 1;
      issues.push(
        ...offsetSemanticIssueSentenceIndexes(
          [
            ...collectInterviewSemanticIssues(
              exchange.answer,
              "postgameInterview",
              game.matchId,
              expectedGame,
            ),
            ...validateUnsupportedInterviewText(
              exchange.answer,
              game.matchId,
              candidate.teamSide,
              0,
            ),
          ],
          sentenceIndexOffset,
        ),
      );
      sentenceIndexOffset += 1;
    }
  }

  return issues;
}

function collectInterviewSemanticIssues(
  text: string,
  field: GameDayRecapSemanticValidationIssueField,
  matchId: string,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  return splitRecapText(text).flatMap((sentence, sentenceIndex) => [
    ...validatePlayoffRecordLanguage(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validatePlayoffStreakLanguage(
      sentence,
      matchId,
      expectedGame,
      field,
      sentenceIndex,
    ),
    ...validateOneGameStreakLanguage(sentence, matchId, field, sentenceIndex),
  ]);
}

function offsetSemanticIssueSentenceIndexes(
  issues: GameDayRecapSemanticValidationIssue[],
  offset: number,
): GameDayRecapSemanticValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    sentenceIndex: issue.sentenceIndex + offset,
  }));
}

function validateUnsupportedInterviewText(
  text: string,
  matchId: string,
  teamSide: "away" | "home",
  sentenceIndex: number,
): GameDayRecapSemanticValidationIssue[] {
  const unsupportedPatterns = [
    /\b(?:first|last)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:shots?|threes?|free throws?)\b/i,
    /\b(?:made|missed|hit)\s+(?:my|his|her|our)?\s*(?:first|last)?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:shots?|threes?|free throws?)\s+(?:straight|in a row)\b/i,
    /\b(?:locker room|halftime|pregame talk|coach(?:es)?\s+(?:said|told)|film room)\b/i,
  ];
  if (!unsupportedPatterns.some((pattern) => pattern.test(text))) {
    return [];
  }

  return [
    {
      actualValue: "unsupported interview detail",
      feedback: `For match ${matchId}, keep postgameInterview grounded in the supplied candidate facts. Do not invent exact shot sequences, streak counts, or locker-room details.`,
      field: "postgameInterview",
      kind: "unsupported_interview_claim",
      matchId,
      reason:
        "The postgameInterview included unsupported sequence-level or behind-the-scenes detail.",
      salvage: semanticIssueSalvageForField("postgameInterview"),
      sentence: text,
      sentenceIndex,
      teamSide,
    },
  ];
}

function validateRequiredPrimaryRunMention(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  const primaryRun = expectedGame.playByPlayFacts?.primaryRun;
  if (!primaryRun?.teamSide) {
    return [];
  }

  const writeupSentences = splitRecapText(game.writeup);
  const hasPrimaryRunMention = writeupSentences.some((sentence) => {
    const runClaim = extractRunClaim(sentence, expectedGame);
    return Boolean(
      runClaim &&
      runClaim.teamPoints === primaryRun.teamPoints &&
      runClaim.opponentPoints === primaryRun.opponentPoints &&
      (!runClaim.teamSide || runClaim.teamSide === primaryRun.teamSide),
    );
  });
  if (hasPrimaryRunMention) {
    return [];
  }

  return [
    {
      actualValue: `${primaryRun.teamPoints}-${primaryRun.opponentPoints}`,
      feedback: `For match ${game.matchId}, mention the supplied primary run ${primaryRun.teamPoints}-${primaryRun.opponentPoints} in the writeup and include its timing anchors.`,
      field: "writeup",
      kind: "missing_primary_run_mention",
      matchId: game.matchId,
      reason: "The writeup omitted the supplied primary run.",
      salvage: "patch_or_remove",
      sentence: writeupSentences[0] ?? game.writeup,
      sentenceIndex: 0,
      teamSide: primaryRun.teamSide,
    },
  ];
}

function validateChoppyFactStack(
  game: GameDayRecapResultGame,
): GameDayRecapSemanticValidationIssue[] {
  const sentences = splitRecapText(game.writeup);
  const issues: GameDayRecapSemanticValidationIssue[] = [];

  for (let index = 1; index < sentences.length; index += 1) {
    const previousSentence = sentences[index - 1];
    const currentSentence = sentences[index];
    if (!previousSentence || !currentSentence) {
      continue;
    }
    if (
      !isNoteLikeQuarterFactSentence(previousSentence) ||
      !isNoteLikeQuarterFactSentence(currentSentence)
    ) {
      continue;
    }

    issues.push({
      actualValue: "connected sports-desk prose",
      feedback: `For match ${game.matchId}, combine stacked short quarter-score fact sentences into smoother connected prose.`,
      field: "writeup",
      kind: "choppy_fact_stack",
      matchId: game.matchId,
      reason:
        "The writeup stacked multiple short quarter-score fact sentences instead of flowing as connected prose.",
      salvage: "patch_or_remove",
      sentence: currentSentence,
      sentenceIndex: index,
    });
  }

  return issues;
}

function validateDuplicatePeriodStateRestatement(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  const sentences = splitRecapText(game.writeup);
  const seenSignatures = new Set<string>();
  const issues: GameDayRecapSemanticValidationIssue[] = [];

  sentences.forEach((sentence, sentenceIndex) => {
    const signature = extractPeriodStateSignature(sentence, expectedGame);
    if (!signature) {
      return;
    }
    if (seenSignatures.has(signature)) {
      issues.push({
        actualValue: signature,
        feedback: `For match ${game.matchId}, do not restate the same quarter or period-state scoring fact in multiple sentences.`,
        field: "writeup",
        kind: "duplicate_period_state_restatement",
        matchId: game.matchId,
        reason:
          "The writeup repeated the same quarter or period-state fact without adding new detail.",
        salvage: "patch_or_remove",
        sentence,
        sentenceIndex,
      });
      return;
    }

    seenSignatures.add(signature);
  });

  return issues;
}

function validateRepetitiveSentenceStarts(
  game: GameDayRecapResultGame,
): GameDayRecapSemanticValidationIssue[] {
  const sentences = splitRecapText(game.writeup);
  const issues: GameDayRecapSemanticValidationIssue[] = [];

  for (let index = 1; index < sentences.length; index += 1) {
    const previousSentence = sentences[index - 1];
    const currentSentence = sentences[index];
    if (!previousSentence || !currentSentence) {
      continue;
    }

    const previousStart = extractSentenceStartKey(previousSentence);
    const currentStart = extractSentenceStartKey(currentSentence);
    if (
      !previousStart ||
      previousStart !== currentStart ||
      previousSentence.split(/\s+/).length > 18 ||
      currentSentence.split(/\s+/).length > 18
    ) {
      continue;
    }

    issues.push({
      actualValue: currentStart,
      feedback: `For match ${game.matchId}, vary repetitive sentence openings so the writeup reads like connected prose instead of stacked notes.`,
      field: "writeup",
      kind: "repetitive_sentence_start",
      matchId: game.matchId,
      reason:
        "The writeup repeated the same short sentence opening in consecutive sentences.",
      salvage: "patch_or_remove",
      sentence: currentSentence,
      sentenceIndex: index,
    });
  }

  return issues;
}

function validateShortFactSentenceCluster(
  game: GameDayRecapResultGame,
): GameDayRecapSemanticValidationIssue[] {
  const sentences = splitRecapText(game.writeup);
  const issues: GameDayRecapSemanticValidationIssue[] = [];

  for (let index = 2; index < sentences.length; index += 1) {
    const cluster = sentences.slice(index - 2, index + 1);
    if (
      cluster.length !== 3 ||
      !cluster.every((sentence) => isShortNoteLikeFactSentence(sentence))
    ) {
      continue;
    }

    issues.push({
      actualValue: "connected sports-desk prose",
      feedback: `For match ${game.matchId}, combine stacked short fact sentences into smoother connected prose.`,
      field: "writeup",
      kind: "short_fact_sentence_cluster",
      matchId: game.matchId,
      reason:
        "The writeup stacked multiple short note-like fact sentences in a row.",
      salvage: "patch_or_remove",
      sentence: sentences[index]!,
      sentenceIndex: index,
    });
  }

  return issues;
}

function isNoteLikeQuarterFactSentence(sentence: string): boolean {
  if (sentence.split(/\s+/).length > 16) {
    return false;
  }

  if (!/\b(?:quarter|through three quarters|halftime)\b/i.test(sentence)) {
    return false;
  }

  if (!/\b\d{1,3}-\d{1,3}\b/.test(sentence)) {
    return false;
  }

  return !/\b(?:because|after|before|while|when|but|and|although|despite|as)\b/i.test(
    sentence,
  );
}

function extractPeriodStateSignature(
  sentence: string,
  expectedGame: GameDayRecapPromptGame,
): string | null {
  const normalizedSentence = sentence.toLowerCase();
  for (const period of expectedGame.quarterFacts.periods) {
    const winnerFacingScore =
      period.winningSide === "tie"
        ? `${period.homeScore}-${period.awayScore}`
        : winnerFacingQuarterScore(period, period.winningSide);
    const signatures = [
      `${period.label}:${period.homeScore}-${period.awayScore}`,
      `${period.label}:${winnerFacingScore}`,
    ];
    if (
      normalizedSentence.includes(period.label.toLowerCase()) &&
      signatures.some((signature) =>
        normalizedSentence.includes(signature.split(":")[1]!.toLowerCase()),
      )
    ) {
      return signatures[0]!;
    }
  }

  const periodStates = buildGameDayRecapFactStorePeriodStates({
    awayTeamName: expectedGame.teams.away.name,
    homeTeamName: expectedGame.teams.home.name,
    quarterScores: expectedGame.quarterScores,
  });
  const throughThreeQuarters = periodStates.throughThreeQuarters;
  if (
    throughThreeQuarters &&
    normalizedSentence.includes("through three quarters") &&
    normalizedSentence.includes(
      `${throughThreeQuarters.homeScore}-${throughThreeQuarters.awayScore}`,
    )
  ) {
    return `through_three_quarters:${throughThreeQuarters.homeScore}-${throughThreeQuarters.awayScore}`;
  }

  const halftime = periodStates.halftime;
  if (
    halftime &&
    normalizedSentence.includes("halftime") &&
    normalizedSentence.includes(`${halftime.homeScore}-${halftime.awayScore}`)
  ) {
    return `halftime:${halftime.homeScore}-${halftime.awayScore}`;
  }

  return null;
}

function extractSentenceStartKey(sentence: string): string | null {
  const tokens = sentence
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }

  return `${tokens[0]!.toLowerCase()} ${tokens[1]!.toLowerCase()}`;
}

function isShortNoteLikeFactSentence(sentence: string): boolean {
  if (sentence.split(/\s+/).length > 16) {
    return false;
  }

  if (
    /\b(?:because|after|before|while|when|but|and|although|despite|as)\b/i.test(
      sentence,
    )
  ) {
    return false;
  }

  return (
    /\b\d{1,3}-\d{1,3}\b/.test(sentence) ||
    /\b(?:led|scored|added|finished with|won the|pulled down|held a)\b/i.test(
      sentence,
    )
  );
}

function validateRequiredSeriesSummaryLine(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  const expectedSummaryLine = expectedGame.seriesContext?.summaryLine;
  if (!expectedSummaryLine) {
    return [];
  }

  const canonicalExpectedSummaryLine =
    canonicalizeSeriesSummaryLine(expectedSummaryLine);
  if (!canonicalExpectedSummaryLine) {
    return [];
  }

  const issues: GameDayRecapSemanticValidationIssue[] = [];
  const writeupSentences = splitRecapText(game.writeup);
  const headlineSeriesClaim = extractSeriesSummaryClaim(game.headline);

  if (!headlineSeriesClaim) {
    issues.push({
      actualValue: canonicalExpectedSummaryLine,
      feedback: `For match ${game.matchId}, include the series state "${canonicalExpectedSummaryLine}" in the game headline and do not repeat it in the writeup.`,
      field: "headline",
      kind: "missing_series_summary_line",
      matchId: game.matchId,
      reason: `The headline did not include the required series state "${canonicalExpectedSummaryLine}".`,
      salvage: "drop_only",
      sentence: game.headline,
      sentenceIndex: 0,
    });
  } else if (headlineSeriesClaim !== canonicalExpectedSummaryLine) {
    issues.push({
      actualValue: canonicalExpectedSummaryLine,
      feedback: `For match ${game.matchId}, the only valid series state is "${canonicalExpectedSummaryLine}". Do not use "${headlineSeriesClaim}" in the headline.`,
      field: "headline",
      kind: "conflicting_series_summary_line",
      matchId: game.matchId,
      reason: `The headline used the conflicting series state "${headlineSeriesClaim}".`,
      salvage: "drop_only",
      sentence: game.headline,
      sentenceIndex: 0,
    });
  }

  writeupSentences.forEach((sentence, sentenceIndex) => {
    const claim = extractSeriesSummaryClaim(sentence);
    if (!claim) {
      return;
    }

    issues.push({
      actualValue: canonicalExpectedSummaryLine,
      feedback: `For match ${game.matchId}, keep the series state in the headline only. Do not repeat "${claim}" in the writeup.`,
      field: "writeup",
      kind: "conflicting_series_summary_line",
      matchId: game.matchId,
      reason: `The writeup repeated "${claim}", a series-score sentence that belongs in the headline only.`,
      salvage: "patch_or_remove",
      sentence,
      sentenceIndex,
    });
  });

  return issues;
}

function extractSeriesSummaryClaim(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/[.!?]+$/, "");
  if (/^The series is tied 1-1$/i.test(normalized)) {
    return "The series is tied 1-1.";
  }

  const evensMatch = /^(.+?) evens series 1-1$/i.exec(normalized);
  if (evensMatch?.[1]) {
    return "The series is tied 1-1.";
  }

  const gameOneLeadMatch = /^(.+?) takes Game 1, leads series 1-0$/i.exec(
    normalized,
  );
  if (gameOneLeadMatch?.[1]) {
    return `${gameOneLeadMatch[1]} leads the series 1-0.`;
  }

  const leadMatch = /^(.+?) leads the series 1-0$/i.exec(normalized);
  if (leadMatch?.[1]) {
    return `${leadMatch[1]} leads the series 1-0.`;
  }

  const headlineWinMatch = /^(.+?) wins series 2-(0|1)$/i.exec(normalized);
  if (headlineWinMatch?.[1] && headlineWinMatch?.[2]) {
    return `${headlineWinMatch[1]} wins the series 2-${headlineWinMatch[2]}.`;
  }

  const winMatch = /^(.+?) wins the series 2-(0|1)$/i.exec(normalized);
  if (winMatch?.[1] && winMatch?.[2]) {
    return `${winMatch[1]} wins the series 2-${winMatch[2]}.`;
  }

  return null;
}

function canonicalizeSeriesSummaryLine(line: string): string | null {
  return extractSeriesSummaryClaim(line);
}

function validateDuplicateOutcomeRestatement(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  return splitRecapText(game.writeup).flatMap((sentence, sentenceIndex) => {
    if (sentenceIndex === 0) {
      return [];
    }
    if (!isPlainOutcomeRestatementSentence(sentence, expectedGame)) {
      return [];
    }

    return [
      {
        actualValue: formatGameFinalScore(expectedGame),
        feedback: `For match ${game.matchId}, do not add a later throwaway sentence that simply repeats the winner and final score once the outcome is already established.`,
        field: "writeup",
        kind: "duplicate_outcome_restatement",
        matchId: game.matchId,
        reason:
          "The writeup repeated the outcome in a later sentence without adding new detail.",
        salvage: "patch_or_remove",
        sentence,
        sentenceIndex,
      },
    ];
  });
}

function validateDecisiveEndingEmphasis(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
): GameDayRecapSemanticValidationIssue[] {
  const endingFacts = expectedGame.playByPlayFacts?.endingFacts;
  const decisiveScore = endingFacts?.decisiveScore;
  if (!decisiveScore) {
    return [];
  }

  const needsEndingEmphasis = Boolean(
    decisiveScore.isBuzzerBeater ||
    endingFacts?.opponentLastChance ||
    expectedGame.finalMargin <= 3,
  );
  if (!needsEndingEmphasis) {
    return [];
  }

  const openingSentences = splitRecapText(game.writeup).slice(0, 2);
  const openingSentence = openingSentences[0] ?? "";
  const hasRequiredBuzzerbeaterMention =
    decisiveScore.isBuzzerBeater &&
    (/\bbuzzerbeater\b/i.test(game.headline) ||
      openingSentences.some((sentence) => /\bbuzzerbeater\b/i.test(sentence)));
  if (hasRequiredBuzzerbeaterMention) {
    return [];
  }

  if (
    !decisiveScore.isBuzzerBeater &&
    (isEndingFocusedText(game.headline) ||
      openingSentences.some((sentence) => isEndingFocusedText(sentence)))
  ) {
    return [];
  }

  return [
    {
      actualValue: decisiveScore.isBuzzerBeater
        ? "buzzerbeater ending"
        : "decisive ending",
      feedback: decisiveScore.isBuzzerBeater
        ? `For match ${game.matchId}, the supplied ending facts show a buzzerbeater. Mention the buzzerbeater in the headline or opening sentence.`
        : `For match ${game.matchId}, the supplied ending facts should be in the headline or opening sentence instead of being buried later in the recap.`,
      field: "writeup",
      kind: "missing_decisive_ending_emphasis",
      matchId: game.matchId,
      reason: decisiveScore.isBuzzerBeater
        ? "The recap buried a supplied buzzerbeater instead of leading with it."
        : "The recap buried the supplied decisive ending instead of leading with it.",
      salvage: "patch_or_remove",
      sentence: openingSentence || game.writeup,
      sentenceIndex: 0,
      teamSide: decisiveScore.scoringTeamSide,
    },
  ];
}

function isPlainOutcomeRestatementSentence(
  sentence: string,
  expectedGame: GameDayRecapPromptGame,
): boolean {
  const winnerSide = resolveGameWinnerSide(expectedGame);
  if (!winnerSide) {
    return false;
  }

  const loserSide = winnerSide === "home" ? "away" : "home";
  const winnerName = expectedGame.teams[winnerSide].name;
  const loserName = expectedGame.teams[loserSide].name;
  if (
    !mentionsTeam(sentence, winnerName) ||
    !mentionsTeam(sentence, loserName)
  ) {
    return false;
  }
  const scorePair = findClosestScorePair(sentence, 0);
  if (!scorePair) {
    return false;
  }
  const actualHomeAway = formatGameFinalScore(expectedGame);
  const actualAwayHome = `${expectedGame.teams.away.score}-${expectedGame.teams.home.score}`;
  const mentionedScore = `${scorePair.first}-${scorePair.second}`;
  if (mentionedScore !== actualHomeAway && mentionedScore !== actualAwayHome) {
    return false;
  }
  if (
    !new RegExp(
      `${escapeRegExp(winnerName)}[^.!?]{0,80}\\b(?:beat|beats|beating|defeat(?:ed|s|ing)?|downed|edge(?:d|s|ing)?|hold(?:s|ing)? off|held off|outlast(?:ed|s|ing)?|toppl(?:ed|es|ing)|handle(?:d|s|ing)|surviv(?:ed|es|ing)|escape(?:d|s|ing)|rout(?:ed|es|ing)|bur(?:ied|ies|ying)|won|wins|prevail(?:ed|s|ing)|close(?:d|s|ing) out|finish(?:ed|es|ing) off|stun(?:ned|s|ning)|shock(?:ed|s|ing))\\b`,
      "i",
    ).test(sentence)
  ) {
    return false;
  }
  if (
    /\b(?:buzzerbeater|at the buzzer|at the horn|no time left|00:00|go-ahead|tied it|last chance|comeback|run|quarter|overtime|missed)\b/i.test(
      sentence,
    )
  ) {
    return false;
  }

  return sentence.split(/\s+/).length <= 18;
}

function isEndingFocusedText(text: string): boolean {
  return /\b(?:buzzerbeater|at the buzzer|at the horn|no time left|00:00|walk-off|go-ahead|went ahead|tied it|last chance|tying shot|go-ahead shot|missed a tying|missed the tying|missed a go-ahead)\b/i.test(
    text,
  );
}

function mentionsTeam(sentence: string, teamName: string): boolean {
  return new RegExp(`\\b${escapeRegExp(teamName)}\\b`, "i").test(sentence);
}

function semanticIssueSalvageForField(
  field: GameDayRecapSemanticValidationIssueField,
): GameDayRecapSemanticValidationIssueSalvage {
  return field === "headline" ? "drop_only" : "patch_or_remove";
}

async function salvageGameDayRecapResult(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  expectedGames: GameDayRecapGameFactStore[];
  judgeIssues: GameDayRecapJudgeValidationIssue[];
  judgeLimiter?: BoundedConcurrencyLimiter;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  request: GameDayRecapPromptPayload["request"];
  result: GameDayRecapResultPayload;
  runtimeConfig?: GameDayRecapRuntimeConfig;
}): Promise<GeneratedGameDayRecap> {
  const runtimeConfig =
    args.runtimeConfig ?? DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG;
  const orderedGames = orderGameDayRecapGames(
    args.result.games,
    args.expectedGames,
  );
  const deterministicIssuesByMatchId = new Map<
    string,
    GameDayRecapSemanticValidationIssue[]
  >();
  const judgeIssuesByMatchId = new Map<
    string,
    GameDayRecapJudgeValidationIssue[]
  >();
  const repairActions: GameDayRecapRepairAction[] = [];
  const postPatchDeterministicIssues: GameDayRecapSemanticValidationIssue[] =
    [];
  const postPatchJudgeIssues: GameDayRecapJudgeValidationIssue[] = [];
  const postTrimDeterministicIssues: GameDayRecapSemanticValidationIssue[] = [];
  const postTrimJudgeIssues: GameDayRecapJudgeValidationIssue[] = [];

  for (const issue of args.deterministicIssues) {
    const issues = deterministicIssuesByMatchId.get(issue.matchId);
    if (issues) {
      issues.push(issue);
      continue;
    }
    deterministicIssuesByMatchId.set(issue.matchId, [issue]);
  }
  for (const issue of args.judgeIssues) {
    const issues = judgeIssuesByMatchId.get(issue.matchId);
    if (issues) {
      issues.push(issue);
      continue;
    }
    judgeIssuesByMatchId.set(issue.matchId, [issue]);
  }

  const gamesWithValidation: GameDayRecapResultPayload["games"] = [];

  for (const expectedGame of args.expectedGames) {
    const currentGame = orderedGames.find(
      (game) => game.matchId === expectedGame.matchId,
    );
    if (!currentGame) {
      continue;
    }

    const deterministicIssues =
      deterministicIssuesByMatchId.get(currentGame.matchId) ?? [];
    const judgeIssues = judgeIssuesByMatchId.get(currentGame.matchId) ?? [];
    if (!deterministicIssues.length && !judgeIssues.length) {
      gamesWithValidation.push(attachValidGameValidation(currentGame));
      continue;
    }

    const salvageOutcome = await salvageGameDayRecapGame({
      deterministicIssues,
      expectedGame,
      game: currentGame,
      judgeIssues,
      judgeLimiter: args.judgeLimiter,
      judgeProvider: args.judgeProvider,
      logContext: args.logContext,
      request: args.request,
      runtimeConfig,
    });
    repairActions.push(...salvageOutcome.repairActions);
    postPatchDeterministicIssues.push(
      ...salvageOutcome.postPatchDeterministicIssues,
    );
    postPatchJudgeIssues.push(...salvageOutcome.postPatchJudgeIssues);
    postTrimDeterministicIssues.push(
      ...salvageOutcome.postTrimDeterministicIssues,
    );
    postTrimJudgeIssues.push(...salvageOutcome.postTrimJudgeIssues);
    if (salvageOutcome.game) {
      gamesWithValidation.push(attachValidGameValidation(salvageOutcome.game));
      continue;
    }

    gamesWithValidation.push(
      attachGameValidation(
        currentGame,
        buildGameValidationPayload({
          deterministicIssues: [
            ...deterministicIssues,
            ...salvageOutcome.postPatchDeterministicIssues,
            ...salvageOutcome.postTrimDeterministicIssues,
          ],
          judgeIssues: [
            ...judgeIssues,
            ...salvageOutcome.postPatchJudgeIssues,
            ...salvageOutcome.postTrimJudgeIssues,
          ],
        }),
      ),
    );
  }

  return {
    coverageIssues: [],
    result: decorateGameDayRecapResultWithSurpriseMetadata(
      {
        games: gamesWithValidation,
        summary: args.result.summary,
      },
      args.expectedGames,
    ),
  };
}

async function salvageGameDayRecapGame(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  expectedGame: GameDayRecapGameFactStore;
  game: GameDayRecapResultGame;
  judgeIssues: GameDayRecapJudgeValidationIssue[];
  judgeLimiter?: BoundedConcurrencyLimiter;
  judgeProvider: StructuredGameDayRecapProvider | null;
  logContext?: GameDayRecapGenerationLogContext;
  request: GameDayRecapPromptPayload["request"];
  runtimeConfig: GameDayRecapRuntimeConfig;
}): Promise<GameDayRecapGameSalvageOutcome> {
  const repairActions: GameDayRecapRepairAction[] = [];
  const factStore = buildGameDayRecapFactStore({
    games: [args.expectedGame],
    request: args.request,
  });
  if (
    args.deterministicIssues.some(
      (issue) => issue.field === "headline" || issue.salvage === "drop_only",
    ) ||
    args.judgeIssues.some((issue) => issue.field === "headline")
  ) {
    return {
      game: null,
      postPatchDeterministicIssues: args.deterministicIssues,
      postPatchJudgeIssues: args.judgeIssues,
      postTrimDeterministicIssues: [],
      postTrimJudgeIssues: [],
      repairActions,
    };
  }

  const hasInterviewIssues =
    args.deterministicIssues.some(
      (issue) => issue.field === "postgameInterview",
    ) || args.judgeIssues.some((issue) => issue.field === "postgameInterview");
  const gameWithoutInterview = hasInterviewIssues
    ? removePostgameInterview(args.game)
    : args.game;
  if (hasInterviewIssues) {
    repairActions.push({
      action: "drop_postgame_interview",
      matchId: args.game.matchId,
      reason: "unsupported or structurally invalid interview content",
    });
  }

  const { game: sentencePatchedGame, replacedSentenceIndexes } =
    applyGameWriteupRepairs(
      gameWithoutInterview,
      args.expectedGame,
      args.deterministicIssues,
    );
  for (const sentenceIndex of replacedSentenceIndexes) {
    repairActions.push({
      action: "replace_sentence",
      matchId: args.game.matchId,
      reason: "deterministic sentence repair",
      sentenceIndex,
    });
  }

  const postSentencePatchDeterministic = assessGameDayRecapDeterministicPayload(
    {
      games: [sentencePatchedGame],
      summary: {
        gameOfTheDayMatchId: null,
        gameOfTheDaySurpriseFactor: null,
        headline: `${args.expectedGame.teams.home.name} vs. ${args.expectedGame.teams.away.name}`,
        lede: "Sentence-patched recap candidate",
      },
    },
    [args.expectedGame],
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const openerRebuiltGame = rebuildGameWriteupOpening({
    deterministicIssues: postSentencePatchDeterministic.issues,
    expectedGame: args.expectedGame,
    game: sentencePatchedGame,
    reason: "restore required opening structure after sentence repair",
    repairActions,
  });
  const postOpenerDeterministic = assessGameDayRecapDeterministicPayload(
    {
      games: [openerRebuiltGame],
      summary: {
        gameOfTheDayMatchId: null,
        gameOfTheDaySurpriseFactor: null,
        headline: `${args.expectedGame.teams.home.name} vs. ${args.expectedGame.teams.away.name}`,
        lede: "Patched recap candidate",
      },
    },
    [args.expectedGame],
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const postContextInsertGame = insertMissingRequiredContextSentences({
    deterministicIssues: postOpenerDeterministic.issues,
    expectedGame: args.expectedGame,
    game: openerRebuiltGame,
    reason:
      "restore required effort and preparation context after sentence repair",
    repairActions,
  });
  const postPatchDeterministic = assessGameDayRecapDeterministicPayload(
    {
      games: [postContextInsertGame],
      summary: {
        gameOfTheDayMatchId: null,
        gameOfTheDaySurpriseFactor: null,
        headline: `${args.expectedGame.teams.home.name} vs. ${args.expectedGame.teams.away.name}`,
        lede: "Patched recap candidate",
      },
    },
    [args.expectedGame],
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const postPatchJudge = await judgeGameDayRecapResultIfEnabled({
    factStore,
    judgeLimiter: args.judgeLimiter,
    logContext: args.logContext,
    provider: args.judgeProvider,
    result: postPatchDeterministic.orderedResult,
    stage: "salvage-post-patch",
  });
  const postPatchBlockingDeterministicIssues =
    postPatchDeterministic.issues.filter(
      (issue) => !isSoftStyleOnlyWriteupIssue(issue),
    );
  if (
    postPatchBlockingDeterministicIssues.length === 0 &&
    postPatchJudge.blockingIssues.length === 0
  ) {
    return {
      game: postContextInsertGame,
      postPatchDeterministicIssues: [],
      postPatchJudgeIssues: [],
      postTrimDeterministicIssues: [],
      postTrimJudgeIssues: [],
      repairActions,
    };
  }
  if (
    postPatchBlockingDeterministicIssues.some(
      (issue) => issue.field === "headline" || issue.salvage === "drop_only",
    )
  ) {
    return {
      game: null,
      postPatchDeterministicIssues: postPatchDeterministic.issues,
      postPatchJudgeIssues: postPatchJudge.blockingIssues,
      postTrimDeterministicIssues: [],
      postTrimJudgeIssues: [],
      repairActions,
    };
  }

  const trimmedGame = removeInvalidWriteupSentences(
    openerRebuiltGame,
    postPatchBlockingDeterministicIssues,
  );
  if (!trimmedGame) {
    return {
      game: null,
      postPatchDeterministicIssues: postPatchDeterministic.issues,
      postPatchJudgeIssues: postPatchJudge.blockingIssues,
      postTrimDeterministicIssues: [],
      postTrimJudgeIssues: [],
      repairActions,
    };
  }
  const invalidSentenceIndexes = collectTrimEligibleSentenceIndexes(
    postPatchDeterministic.issues,
  );
  for (const sentenceIndex of Array.from(invalidSentenceIndexes)) {
    repairActions.push({
      action: "trim_sentence",
      matchId: args.game.matchId,
      reason: "remove remaining deterministic issue sentence",
      sentenceIndex,
    });
  }
  const postTrimPreOpenerDeterministic = assessGameDayRecapDeterministicPayload(
    {
      games: [trimmedGame],
      summary: {
        gameOfTheDayMatchId: null,
        gameOfTheDaySurpriseFactor: null,
        headline: `${args.expectedGame.teams.home.name} vs. ${args.expectedGame.teams.away.name}`,
        lede: "Pre-opener-trimmed recap candidate",
      },
    },
    [args.expectedGame],
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const trimmedAndRebuiltGame = rebuildGameWriteupOpening({
    deterministicIssues: postTrimPreOpenerDeterministic.issues,
    expectedGame: args.expectedGame,
    game: trimmedGame,
    reason: "restore required opening structure after trimming",
    repairActions,
  });
  const postTrimPreContextDeterministic =
    assessGameDayRecapDeterministicPayload(
      {
        games: [trimmedAndRebuiltGame],
        summary: {
          gameOfTheDayMatchId: null,
          gameOfTheDaySurpriseFactor: null,
          headline: `${args.expectedGame.teams.home.name} vs. ${args.expectedGame.teams.away.name}`,
          lede: "Trimmed recap candidate",
        },
      },
      [args.expectedGame],
      {
        enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
      },
    );
  const trimmedRebuiltAndContextInsertedGame =
    insertMissingRequiredContextSentences({
      deterministicIssues: postTrimPreContextDeterministic.issues,
      expectedGame: args.expectedGame,
      game: trimmedAndRebuiltGame,
      reason: "restore required effort and preparation context after trimming",
      repairActions,
    });
  const postTrimDeterministic = assessGameDayRecapDeterministicPayload(
    {
      games: [trimmedRebuiltAndContextInsertedGame],
      summary: {
        gameOfTheDayMatchId: null,
        gameOfTheDaySurpriseFactor: null,
        headline: `${args.expectedGame.teams.home.name} vs. ${args.expectedGame.teams.away.name}`,
        lede: "Trimmed recap candidate",
      },
    },
    [args.expectedGame],
    {
      enforceBannedStylePhrases: args.runtimeConfig.enforceBannedStylePhrases,
    },
  );
  const postTrimJudge = await judgeGameDayRecapResultIfEnabled({
    factStore,
    judgeLimiter: args.judgeLimiter,
    logContext: args.logContext,
    provider: args.judgeProvider,
    result: postTrimDeterministic.orderedResult,
    stage: "salvage-post-trim",
  });
  const postTrimBlockingDeterministicIssues =
    postTrimDeterministic.issues.filter(
      (issue) => !isSoftStyleOnlyWriteupIssue(issue),
    );
  if (
    postTrimBlockingDeterministicIssues.length === 0 &&
    postTrimJudge.blockingIssues.length === 0
  ) {
    return {
      game: trimmedRebuiltAndContextInsertedGame,
      postPatchDeterministicIssues: [],
      postPatchJudgeIssues: [],
      postTrimDeterministicIssues: [],
      postTrimJudgeIssues: [],
      repairActions,
    };
  }

  return {
    game: null,
    postPatchDeterministicIssues: postPatchDeterministic.issues,
    postPatchJudgeIssues: postPatchJudge.blockingIssues,
    postTrimDeterministicIssues: postTrimDeterministic.issues,
    postTrimJudgeIssues: postTrimJudge.blockingIssues,
    repairActions,
  };
}

function rebuildGameWriteupOpening(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  expectedGame: GameDayRecapPromptGame;
  game: GameDayRecapResultGame;
  reason: string;
  repairActions: GameDayRecapRepairAction[];
}): GameDayRecapResultGame {
  const needsEndingEmphasis = args.deterministicIssues.some(
    (issue) => issue.kind === "missing_decisive_ending_emphasis",
  );
  if (!needsEndingEmphasis) {
    return args.game;
  }

  const sentences = splitRecapText(args.game.writeup);
  const rebuiltOpening: string[] = [];
  const endingSentence = buildSafeDecisiveEndingSentence(args.expectedGame);

  if (needsEndingEmphasis && endingSentence) {
    rebuiltOpening.push(endingSentence);
  }
  if (!rebuiltOpening.length) {
    return args.game;
  }

  const remainder = sentences.filter((sentence) => {
    if (rebuiltOpening.includes(sentence)) {
      return false;
    }
    if (needsEndingEmphasis && endingSentence && sentence === endingSentence) {
      return false;
    }
    return true;
  });
  args.repairActions.push({
    action: "rebuild_opener",
    matchId: args.game.matchId,
    reason: args.reason,
  });

  return {
    ...args.game,
    writeup: [...rebuiltOpening, ...remainder].join(" "),
  };
}

function insertMissingRequiredContextSentences(args: {
  deterministicIssues: GameDayRecapSemanticValidationIssue[];
  expectedGame: GameDayRecapPromptGame;
  game: GameDayRecapResultGame;
  reason: string;
  repairActions: GameDayRecapRepairAction[];
}): GameDayRecapResultGame {
  const requiredContextSentences =
    args.expectedGame.requiredContextSentences ?? [];
  if (!requiredContextSentences.length) {
    return args.game;
  }

  const missingSentences = new Set(
    args.deterministicIssues
      .filter((issue) => issue.kind === "missing_required_context_sentence")
      .map((issue) => issue.actualValue)
      .filter((value): value is string => Boolean(value)),
  );
  if (!missingSentences.size) {
    return args.game;
  }

  const sentences = splitRecapText(args.game.writeup);
  const existingSentences = new Set(sentences);
  const contextToInsert = requiredContextSentences.filter(
    (sentence) =>
      missingSentences.has(sentence) && !existingSentences.has(sentence),
  );
  if (!contextToInsert.length) {
    return args.game;
  }

  const insertionIndex = Math.min(2, sentences.length);
  contextToInsert.forEach((sentence, offset) => {
    args.repairActions.push({
      action: "insert_sentence",
      matchId: args.game.matchId,
      reason: args.reason,
      sentence,
      sentenceIndex: insertionIndex + offset,
    });
  });

  return {
    ...args.game,
    writeup: [
      ...sentences.slice(0, insertionIndex),
      ...contextToInsert,
      ...sentences.slice(insertionIndex),
    ].join(" "),
  };
}

function removePostgameInterview(
  game: GameDayRecapResultGame,
): GameDayRecapResultGame {
  const {
    postgameInterview: _postgameInterview,
    postgameInterviewDiagnostics: _postgameInterviewDiagnostics,
    postgameInterviews: _postgameInterviews,
    ...rest
  } = game;
  return rest;
}

function applyGameWriteupRepairs(
  game: GameDayRecapResultGame,
  expectedGame: GameDayRecapPromptGame,
  issues: GameDayRecapSemanticValidationIssue[],
): {
  game: GameDayRecapResultGame;
  replacedSentenceIndexes: number[];
} {
  const sentences = splitRecapText(game.writeup);
  const replacedSentenceIndexes: number[] = [];
  const issuesBySentence = new Map<
    number,
    GameDayRecapSemanticValidationIssue[]
  >();

  for (const issue of issues) {
    if (issue.field !== "writeup") {
      continue;
    }
    if (
      issue.kind === "missing_series_summary_line" ||
      issue.kind === "missing_decisive_ending_emphasis" ||
      issue.kind === "missing_required_context_sentence"
    ) {
      continue;
    }
    const sentenceIssues = issuesBySentence.get(issue.sentenceIndex);
    if (sentenceIssues) {
      sentenceIssues.push(issue);
      continue;
    }
    issuesBySentence.set(issue.sentenceIndex, [issue]);
  }

  for (const [sentenceIndex, sentenceIssues] of Array.from(
    issuesBySentence.entries(),
  )) {
    const replacement = buildSafeReplacementSentence(
      choosePreferredRepairIssue(sentenceIssues),
      expectedGame,
    );
    if (!replacement || !sentences[sentenceIndex]) {
      continue;
    }
    sentences[sentenceIndex] = replacement;
    replacedSentenceIndexes.push(sentenceIndex);
  }

  return {
    game: {
      ...game,
      writeup: sentences.join(" "),
    },
    replacedSentenceIndexes,
  };
}

function choosePreferredRepairIssue(
  issues: GameDayRecapSemanticValidationIssue[],
): GameDayRecapSemanticValidationIssue {
  const priorities: Record<GameDayRecapSemanticValidationIssueKind, number> = {
    banned_style_phrase: 10,
    choppy_fact_stack: 11,
    compact_streak_mismatch: 1,
    conflicting_series_summary_line: 13,
    duplicate_period_state_restatement: 12,
    duplicate_outcome_restatement: 12,
    explicit_streak_mismatch: 2,
    missing_required_context_sentence: 7,
    missing_primary_run_mention: 8,
    missing_run_timing: 9,
    missing_decisive_ending_emphasis: 9,
    missing_series_summary_line: 8,
    one_game_streak_language: 11,
    overlapping_run_claims: 8,
    playoff_record_language: 10,
    playoff_streak_language: 10,
    quarter_score_mismatch: 5,
    quarter_winner_score_mismatch: 6,
    repetitive_sentence_start: 11,
    record_mismatch: 0,
    short_fact_sentence_cluster: 11,
    through_three_quarters_mismatch: 4,
    tied_quarter_claim: 7,
    unsupported_interview_claim: 9,
    unsupported_lead_change_claim: 8,
    unsupported_run_framing: 8,
    unsupported_scoring_context: 8,
    unsupported_run_claim: 8,
    unsupported_tactic_contrast: 8,
    wrong_quarter_winner: 8,
  };

  return (
    [...issues].sort(
      (left, right) => priorities[left.kind] - priorities[right.kind],
    )[0] ?? issues[0]!
  );
}

function buildSafeReplacementSentence(
  issue: GameDayRecapSemanticValidationIssue,
  expectedGame: GameDayRecapPromptGame,
): string | null {
  switch (issue.kind) {
    case "record_mismatch": {
      if (isPlayoffRecapGame(expectedGame)) {
        return null;
      }
      const team = issue.teamSide ? expectedGame.teams[issue.teamSide] : null;
      return team?.record
        ? `${team.name} finished the game at ${team.record}.`
        : null;
    }
    case "compact_streak_mismatch": {
      const team = issue.teamSide ? expectedGame.teams[issue.teamSide] : null;
      return team?.streak
        ? formatStreakSentenceForRecap(team.name, team.streak)
        : null;
    }
    case "explicit_streak_mismatch": {
      const team = issue.teamSide ? expectedGame.teams[issue.teamSide] : null;
      return team?.streak
        ? formatStreakSentenceForRecap(team.name, team.streak)
        : null;
    }
    case "missing_series_summary_line":
      return null;
    case "conflicting_series_summary_line":
      return null;
    case "missing_required_context_sentence":
      return null;
    case "missing_decisive_ending_emphasis":
      return buildSafeDecisiveEndingSentence(expectedGame);
    case "missing_primary_run_mention":
      return buildSafePrimaryRunSentence(expectedGame);
    case "missing_run_timing":
    case "overlapping_run_claims":
    case "unsupported_scoring_context":
      return buildSafeFinalScoreSentence(expectedGame);
    case "unsupported_run_framing":
      return buildSafeMomentumSentence(expectedGame);
    case "unsupported_lead_change_claim":
    case "unsupported_run_claim":
      return buildSafeMomentumSentence(expectedGame);
    case "unsupported_tactic_contrast":
      return buildSafeTacticalComparisonSentence(expectedGame);
    case "banned_style_phrase":
    case "choppy_fact_stack":
    case "duplicate_period_state_restatement":
    case "duplicate_outcome_restatement":
    case "one_game_streak_language":
    case "playoff_record_language":
    case "playoff_streak_language":
    case "repetitive_sentence_start":
    case "short_fact_sentence_cluster":
    case "unsupported_interview_claim":
      return null;
    case "quarter_score_mismatch":
    case "quarter_winner_score_mismatch":
    case "wrong_quarter_winner":
    case "tied_quarter_claim": {
      if (!issue.period) {
        return null;
      }
      const periodFact = expectedGame.quarterFacts.periods.find(
        (period) => period.period === issue.period,
      );
      if (!periodFact) {
        return null;
      }

      if (periodFact.winningSide === "tie") {
        return `The ${periodFact.label} ended tied at ${periodFact.homeScore}-${periodFact.awayScore}.`;
      }

      return `${expectedGame.teams[periodFact.winningSide].name} won the ${periodFact.label} ${winnerFacingQuarterScore(periodFact, periodFact.winningSide)}.`;
    }
    case "through_three_quarters_mismatch":
      return buildSafeThroughThreeQuartersSentence(expectedGame);
    default:
      return null;
  }
}

function formatStreakSentenceForRecap(
  teamName: string,
  streak: string,
): string | null {
  const trimmed = streak.trim();
  const match = trimmed.match(/^([WL])(\d+)$/i);
  if (!match) {
    return null;
  }

  const direction = match[1]?.toUpperCase();
  const length = Number.parseInt(match[2] ?? "", 10);
  if (!direction || !Number.isInteger(length) || length <= 1) {
    return null;
  }

  return direction === "W"
    ? `${teamName} has won ${length} straight.`
    : `${teamName} has lost ${length} straight.`;
}

function buildSafeMomentumSentence(
  expectedGame: GameDayRecapPromptGame,
): string | null {
  const prioritySummaryLine = expectedGame.playByPlayFacts?.summaryLines.find(
    (line) =>
      /\brun\b|\blead changed hands\b|\berased a \d+-point deficit and took the lead\b/i.test(
        line,
      ),
  );
  return prioritySummaryLine ?? null;
}

function buildSafeTacticalComparisonSentence(
  expectedGame: GameDayRecapPromptGame,
): string | null {
  const awayOffense = expectedGame.teams.away.offStrategy?.trim();
  const homeOffense = expectedGame.teams.home.offStrategy?.trim();
  if (!awayOffense || !homeOffense) {
    return null;
  }

  if (awayOffense === homeOffense) {
    return `${expectedGame.teams.away.name} and ${expectedGame.teams.home.name} both stayed with ${awayOffense}.`;
  }

  return `${expectedGame.teams.away.name} worked from ${awayOffense}, while ${expectedGame.teams.home.name} countered with ${homeOffense}.`;
}

function buildSafeFinalScoreSentence(
  expectedGame: GameDayRecapPromptGame,
): string {
  const winnerSide = resolveGameWinnerSide(expectedGame);
  if (!winnerSide) {
    return `${expectedGame.teams.home.name} and ${expectedGame.teams.away.name} finished tied ${expectedGame.teams.home.score}-${expectedGame.teams.away.score}.`;
  }
  const loserSide = winnerSide === "home" ? "away" : "home";
  return `${expectedGame.teams[winnerSide].name} beat ${expectedGame.teams[loserSide].name} ${expectedGame.teams[winnerSide].score}-${expectedGame.teams[loserSide].score}.`;
}

function buildSafePrimaryRunSentence(
  expectedGame: GameDayRecapPromptGame,
): string | null {
  return (
    expectedGame.playByPlayFacts?.summaryLines.find((line) =>
      /\brun\b/i.test(line),
    ) ?? null
  );
}

function buildSafeDecisiveEndingSentence(
  expectedGame: GameDayRecapPromptGame,
): string | null {
  const endingFacts = expectedGame.playByPlayFacts?.endingFacts;
  const decisiveScore = endingFacts?.decisiveScore;
  if (!decisiveScore) {
    return null;
  }

  const winnerSide = decisiveScore.scoringTeamSide;
  const winnerName = expectedGame.teams[winnerSide].name;
  const loserSide = winnerSide === "home" ? "away" : "home";
  const winnerScore =
    winnerSide === "home" ? decisiveScore.homeScore : decisiveScore.awayScore;
  const loserScore =
    winnerSide === "home" ? decisiveScore.awayScore : decisiveScore.homeScore;
  const score = `${winnerScore}-${loserScore}`;
  const timePhrase = formatDecisiveEndingTimePhrase(
    decisiveScore.clock,
    decisiveScore.quarter,
  );

  if (decisiveScore.isBuzzerBeater) {
    return `${winnerName} won it on a buzzerbeater, going ahead ${score} at the horn.`;
  }

  if (endingFacts?.opponentLastChance) {
    return `${buildSafeDecisiveScoreClause(winnerName, decisiveScore, score, timePhrase)}, and ${buildSafeLastChanceClause(expectedGame.teams[loserSide].name, endingFacts.opponentLastChance)}.`;
  }

  return `${buildSafeDecisiveScoreClause(winnerName, decisiveScore, score, timePhrase)}.`;
}

function buildSafeDecisiveScoreClause(
  winnerName: string,
  decisiveScore: NonNullable<
    NonNullable<
      GameDayRecapPromptGame["playByPlayFacts"]
    >["endingFacts"]["decisiveScore"]
  >,
  score: string,
  timePhrase: string,
): string {
  if (decisiveScore.momentType === "go_ahead") {
    return `${winnerName} went ahead ${score} ${timePhrase}`;
  }

  return `${winnerName} pushed the lead to ${score} ${timePhrase}`;
}

function buildSafeLastChanceClause(
  loserName: string,
  lastChance: NonNullable<
    NonNullable<
      GameDayRecapPromptGame["playByPlayFacts"]
    >["endingFacts"]["opponentLastChance"]
  >,
): string {
  const timePhrase = formatLastChanceRepairTimePhrase(
    lastChance.clock,
    lastChance.quarter,
  );

  switch (lastChance.outcomeType) {
    case "missed_free_throw":
      switch (lastChance.chanceType) {
        case "go_ahead":
          return `${loserName} missed a go-ahead free throw ${timePhrase}`;
        case "tie":
          return `${loserName} missed a free throw that would have tied it ${timePhrase}`;
        case "tie_or_go_ahead":
          return `${loserName} missed a free throw on its last chance to tie or go ahead ${timePhrase}`;
      }
    case "missed_shot":
      switch (lastChance.chanceType) {
        case "go_ahead":
          return `${loserName} missed a go-ahead shot ${timePhrase}`;
        case "tie":
          return `${loserName} missed the tying shot ${timePhrase}`;
        case "tie_or_go_ahead":
          return `${loserName} missed its last chance to tie or go ahead ${timePhrase}`;
      }
    case "turnover":
      switch (lastChance.chanceType) {
        case "go_ahead":
          return `${loserName} turned it over on its last chance to go ahead ${timePhrase}`;
        case "tie":
          return `${loserName} turned it over on its last chance to tie ${timePhrase}`;
        case "tie_or_go_ahead":
          return `${loserName} turned it over on its last chance to tie or go ahead ${timePhrase}`;
      }
  }

  return `${loserName} could not convert its last chance ${timePhrase}`;
}

function formatDecisiveEndingTimePhrase(
  clock: string | null,
  period: number,
): string {
  const periodLabel = formatPeriodContextLabel(period);
  if (clock === "00:00") {
    return "with no time left";
  }

  return clock
    ? `with ${clock} left in ${periodLabel}`
    : `late in ${periodLabel}`;
}

function formatLastChanceRepairTimePhrase(
  clock: string | null,
  period: number,
): string {
  const periodLabel = formatPeriodContextLabel(period);
  if (clock === "00:00") {
    return "at the horn";
  }

  return clock
    ? `with ${clock} left in ${periodLabel}`
    : `late in ${periodLabel}`;
}

function formatPeriodContextLabel(period: number): string {
  const periodLabel = formatPeriodLabel(period);
  return period <= 4 ? `the ${periodLabel}` : periodLabel;
}

function removeInvalidWriteupSentences(
  game: GameDayRecapResultGame,
  issues: GameDayRecapSemanticValidationIssue[],
): GameDayRecapResultGame | null {
  const sentences = splitRecapText(game.writeup);
  const invalidSentenceIndexes = collectTrimEligibleSentenceIndexes(issues);
  const trimmedSentences = sentences.filter(
    (_sentence, sentenceIndex) => !invalidSentenceIndexes.has(sentenceIndex),
  );

  if (!trimmedSentences.length) {
    return null;
  }

  return {
    ...game,
    writeup: trimmedSentences.join(" "),
  };
}

function isOpenerStructureIssue(
  issue: Pick<GameDayRecapSemanticValidationIssue, "field" | "kind">,
): boolean {
  return (
    issue.field === "writeup" &&
    (issue.kind === "missing_series_summary_line" ||
      issue.kind === "missing_decisive_ending_emphasis")
  );
}

function isInsertionOnlyWriteupIssue(
  issue: Pick<GameDayRecapSemanticValidationIssue, "field" | "kind">,
): boolean {
  return (
    issue.field === "writeup" &&
    issue.kind === "missing_required_context_sentence"
  );
}

function isSoftStyleOnlyWriteupIssue(
  issue: Pick<GameDayRecapSemanticValidationIssue, "field" | "kind">,
): boolean {
  return (
    issue.field === "writeup" &&
    (issue.kind === "choppy_fact_stack" ||
      issue.kind === "duplicate_period_state_restatement" ||
      issue.kind === "repetitive_sentence_start" ||
      issue.kind === "short_fact_sentence_cluster")
  );
}

function collectTrimEligibleSentenceIndexes(
  issues: GameDayRecapSemanticValidationIssue[],
): Set<number> {
  return new Set(
    issues
      .filter(
        (issue) =>
          issue.field === "writeup" &&
          !isOpenerStructureIssue(issue) &&
          !isInsertionOnlyWriteupIssue(issue) &&
          !isSoftStyleOnlyWriteupIssue(issue),
      )
      .map((issue) => issue.sentenceIndex),
  );
}

function logPlayByPlayEndingFactsDebug(args: {
  matchId: string;
  playByPlayResult: GameDayRecapPlayByPlayLoadResult;
  targetKey?: string;
  userId?: string;
}): void {
  const debug = args.playByPlayResult.debug;
  if (!debug?.decisiveEndingQualificationReason) {
    return;
  }

  logGameDayRecapWarn("process.play_by_play_decisive_ending_selected", {
    decisiveEndingClock: debug.decisiveEndingClock,
    decisiveEndingEventText: debug.decisiveEndingEventText,
    decisiveEndingQualificationReason: debug.decisiveEndingQualificationReason,
    decisiveEndingQuarter: debug.decisiveEndingQuarter,
    matchId: args.matchId,
    targetKey: args.targetKey ?? null,
    userId: args.userId ?? null,
  });
}

function buildSafePartialRecapSummary(args: {
  droppedGameCount: number;
  request: GameDayRecapPromptPayload["request"];
  retainedGameCount: number;
}): GameDayRecapResultSummary {
  const label = args.request.leagueName?.trim() || args.request.label.trim();
  const retainedGamesLabel = args.retainedGameCount === 1 ? "game" : "games";
  const droppedGamesLabel =
    args.droppedGameCount === 1 ? "game was" : "games were";

  return {
    headline: `${label} partial roundup`,
    gameOfTheDayMatchId: null,
    gameOfTheDaySurpriseFactor: null,
    lede: `This partial recap covers ${args.retainedGameCount} validated ${retainedGamesLabel} from the requested slate after ${args.droppedGameCount} ${droppedGamesLabel} removed during factual validation.`,
  };
}

function mergeCoverageIssues(
  coverage: GameDayRecapCoveragePayload,
  coverageIssues: CoverageIssue[],
): GameDayRecapCoveragePayload {
  if (!coverageIssues.length) {
    return coverage;
  }

  const missingGames = [...coverage.missingGames, ...coverageIssues];
  return {
    availableGames: Math.max(
      0,
      coverage.availableGames - coverageIssues.length,
    ),
    missingGames,
    partial: true,
    requestedGames: coverage.requestedGames,
  };
}

function splitRecapText(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n\r]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractReferencedQuarter(sentence: string): number | null {
  const match = sentence.match(
    /\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+quarter\b/i,
  );
  const token = match?.[1]?.toLowerCase();
  if (!token) {
    return null;
  }

  switch (token) {
    case "first":
    case "1st":
      return 1;
    case "second":
    case "2nd":
      return 2;
    case "third":
    case "3rd":
      return 3;
    case "fourth":
    case "4th":
      return 4;
    default:
      return null;
  }
}

function findClosestScorePair(
  sentence: string,
  pivotIndex: number,
): { first: number; second: number } | null {
  let selected: { distance: number; first: number; second: number } | null =
    null;

  const scorePattern = /\b(\d{1,3})-(\d{1,3})\b/g;
  let match = scorePattern.exec(sentence);
  while (match) {
    const first = asOptionalNumber(match[1]);
    const second = asOptionalNumber(match[2]);
    const index = match.index ?? 0;
    if (first === null || second === null) {
      match = scorePattern.exec(sentence);
      continue;
    }

    const distance = Math.abs(index - pivotIndex);
    if (!selected || distance < selected.distance) {
      selected = { distance, first, second };
    }

    match = scorePattern.exec(sentence);
  }

  return selected
    ? {
        first: selected.first,
        second: selected.second,
      }
    : null;
}

function resolveExplicitQuarterWinnerSide(
  sentence: string,
  expectedGame: GameDayRecapPromptGame,
): "away" | "home" | null {
  for (const side of ["home", "away"] as const) {
    const teamName = expectedGame.teams[side].name;
    if (
      new RegExp(
        `${escapeRegExp(teamName)}[^.!?]{0,80}\\b(?:outscor(?:e|ed|es|ing)|won|take(?:s|n)?|took|claim(?:ed|s|ing)|domin(?:ate|ated|ates|ating)|control(?:led|ling|s)?)\\b`,
        "i",
      ).test(sentence)
    ) {
      return side;
    }
  }

  return null;
}

function winnerFacingQuarterScore(
  periodFact: GameDayRecapPromptPeriodFact,
  winnerSide: "away" | "home",
): string {
  return winnerSide === "home"
    ? `${periodFact.homeScore}-${periodFact.awayScore}`
    : `${periodFact.awayScore}-${periodFact.homeScore}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGameDayRecapSemanticValidationError(
  error: unknown,
): error is GameDayRecapSemanticValidationError {
  return error instanceof GameDayRecapSemanticValidationError;
}

export {
  buildGameDayRecapTargetKey,
  buildLeagueGameDayRecapTargetKey,
  buildSingleGameSummaryTargetKey,
  normalizeGameDayRecapRequest,
  normalizeLeagueGameDayRecapRequest,
  normalizeSingleGameSummaryRequest,
  parseGameDayRecapQueueMessage,
} from "./game-day-recap-request";

export const __testing = {
  assessGameDayRecapDeterministicPayload,
  createBoundedConcurrencyLimiter,
  DEFAULT_GAME_DAY_RECAP_RUNTIME_CONFIG,
  GAME_DAY_RECAP_EVIDENCE_TAGS,
  GAME_DAY_RECAP_PROMPT_VERSION,
  GAME_DAY_RECAP_RESULT_SCHEMA,
  SUPPORTED_STRUCTURED_OUTPUT_MODEL_PATTERNS,
  buildGameDayRecapInfoLogEntry,
  buildGameDayRecapJudgeBedrockRequest,
  buildGameDayRecapJudgeInterestingnessResultSchema,
  buildGameDayRecapJudgeSentenceFactualityResultSchema,
  buildGameDayRecapJudgeFactStore,
  buildGameDayRecapCostPayload,
  buildGameDayRecapPostgameInterviewBedrockRequest,
  buildJudgeSentenceChunks,
  computeSurpriseFactorForGame,
  buildQuarterFacts,
  buildEvidenceSignals,
  buildGameDayRecapBedrockRequest,
  buildGameDayRecapPromptPayload,
  buildGameDayPrepSummariesForRecap,
  buildRotationSummariesForRecap,
  buildSafePartialRecapSummary,
  buildGameDayRecapTargetKey,
  buildLeagueGameDayRecapTargetKey,
  buildSingleGameSummaryTargetKey,
  buildTeamSeasonContext,
  describeGameDayPrepFocusForRecap,
  describeEffortDeltaForRecap,
  derivePostgameTeamSeasonContext,
  extractStandingTeams,
  extractTopPlayers,
  formatCurrentStreak,
  formatLastFive,
  generateResolvedGameDayRecap,
  isRegularSeasonLeagueContextMatch,
  listCompletedMatchesBefore,
  mergeCoverageIssues,
  normalizeGameDayRecapRequest,
  normalizeSingleGameSummaryRequest,
  normalizeGameDayRecapResult,
  parseGameDayRecapQueueMessage,
  buildFallbackPostgameInterview,
  removeInvalidWriteupSentences,
  resolveGameDayRecapRuntimeConfig,
  resolvePlayoffSeriesContext,
  resolveConfiguredRecapModelId,
  resolveConfiguredRecapStageModelIds,
  resolveQueuedRecapModelId,
  resolveQueuedRecapStageModelIds,
  resolveGameDayRecapModelPricing,
  resolveLeagueDaySlate,
  resolveLeagueGameDaySlate,
  resolveRecapQualityTier,
  resolveSeasonCandidatesForDate,
  resolveSeasonForDate,
  salvageGameDayRecapResult,
  summarizeSeasonDiagnostics,
  judgeGameDayRecapResult,
  validateGameDayRecapResult,
};
