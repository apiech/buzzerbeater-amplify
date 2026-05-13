import { createHash, randomUUID } from "node:crypto";

import {
  BBXmlApiClient,
  resolveEffectiveCurrentSeason,
  resolveLatestSeasonId,
  type BBApiBoxScore,
  type BBApiSchedule,
  type BBApiScheduleMatch,
  type BBApiSeasons,
  type BBApiStandings,
} from "../../../lib/bbapi";
import {
  TEAM_RATING_KEYS,
  type TeamRatingKey,
  type TeamRatings,
} from "../../../lib/buzzerbeater/team-ratings";
import {
  normalizePredictionRatingsFromBoxscore,
  type PredictionTeamLocation,
} from "../../../lib/prediction/normalization";
import {
  predictionPlannerExpectedOnlyResponseSchema,
} from "../../../lib/prediction/contracts";
import type { Schema } from "../resource";
import { requireFeatureAccess } from "./billing";
import { getNormalizedCachedMatchBoxscore } from "./cached-boxscore";
import { resolveBbAccessKey } from "./credentials";
import {
  assertMaintenanceInactive,
  toMaintenanceAwareErrorMessage,
} from "./maintenance";
import {
  isLeagueRegularSeasonCompetition,
  isScrimmageLike,
  matchIncludesTeam,
} from "./match-importance";
import { buildPlannerPairDefinitions } from "./next-game-recommendation";
import { selectBoxscorePerspective } from "./neutral-boxscore";
import { invokePlannerRequests } from "./prediction-planner";
import {
  invokePredictionRuntimeEndpoint,
  isPredictionRuntimeResponseTooLargeError,
} from "./prediction-runtime";
import {
  createLeagueSeasonSimulationJob,
  getLeagueSeasonSimulationArtifact,
  getBbConnection,
  getLeagueSeasonSimulationJob,
  getMatchBoxscore,
  listLeagueSeasonSimulationArtifactsByJobId,
  listLeagueSeasonSimulationJobsByUser,
  updateLeagueSeasonSimulationJob,
  upsertLeagueSeasonSimulationArtifact,
  upsertMatchBoxscore,
  type LeagueSeasonSimulationArtifactRecord,
  type LeagueSeasonSimulationJobRecord,
} from "./repository";
import {
  buildExecutionName,
  describeStateMachineExecution,
  startStateMachineExecution,
  type StateMachineExecutionDescription,
} from "./step-functions";
import { toStoredMatchBoxscore } from "./stored-boxscore";
import { resolveUserId } from "./workspace-connection";

type GraphqlEnv = Record<string, string | undefined>;

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type SimulationSnapshot = ResolverResult<"getLatestLeagueSeasonSimulation">;
type SimulationProgress = NonNullable<SimulationSnapshot["progress"]>;
type SimulationPhaseKey = SimulationProgress["phaseKey"];
type SimulationCompletedPhase = SimulationProgress["completedPhases"][number];
type SimulationProgressContext = NonNullable<SimulationProgress["context"]>;
type SimulationResult = NonNullable<SimulationSnapshot["result"]>;
type SimulationConferenceResult = SimulationResult["conferences"][number];
type SimulationTeamResult = SimulationConferenceResult["teams"][number];
type SimulationGameResult = SimulationResult["remainingGames"][number];
type SimulationFinishProbability = SimulationTeamResult["finishProbabilities"][number];
type SimulationStoredRequest = NonNullable<
  Schema["LeagueSeasonSimulationJob"]["type"]["requestJson"]
>;
type SimulationStoredProgress = NonNullable<
  Schema["LeagueSeasonSimulationJob"]["type"]["progressJson"]
>;
type SimulationStoredResult = NonNullable<
  Schema["LeagueSeasonSimulationJob"]["type"]["resultJson"]
>;

type SeasonSimulationRatingModifier = Partial<
  Record<TeamRatingKey, number | null>
>;

type SeasonSimulationTeamModifier = {
  ratings: SeasonSimulationRatingModifier;
  teamId: string;
};

type BbClient = Pick<
  BBXmlApiClient,
  "getBoxScore" | "getSchedule" | "getSeasons" | "getStandings"
>;

type TeamStanding = {
  conferenceIndex: number;
  currentLosses: number;
  currentPointMargin: number;
  currentWins: number;
  stableRank: number;
  teamId: string;
  teamName: string | null;
};

type RemainingLeagueGame = {
  awayTeamId: string;
  awayTeamName: string | null;
  homeTeamId: string;
  homeTeamName: string | null;
  matchId: string;
  startTime: string | null;
};

type LeagueSeasonSlateCoverageIssue = {
  currentGames: number;
  expectedGames: number;
  remainingGames: number;
  teamId: string;
  teamName: string | null;
  totalGames: number;
};

type LeagueSeasonSlateCoverage = {
  expectedGamesPerTeam: number;
  issues: LeagueSeasonSlateCoverageIssue[];
  teamCount: number;
};

type SnapshotCandidate = {
  boxscore: BBApiBoxScore;
  matchId: string;
  normalizedRatings: TeamRatings;
  normalizedScalar: number;
  predictorDefense: string;
  predictorOffense: string;
  season: number;
  startTime: string | null;
};

type SelectedTeamSnapshot = TeamStanding & {
  candidateGameCount: number;
  candidates: SnapshotCandidate[];
  normalizedRatings: TeamRatings | null;
  sourceDefense: string;
  sourceOffense: string;
  sampleWarning: string | null;
  selectionStrategy:
    | "BEST_AVAILABLE"
    | "CURRENT_SEASON_15TH_PERCENTILE"
    | "LEAGUE_AVERAGE_FALLBACK"
    | "MULTI_SEASON_THIRD_BEST";
  sourceMatchId: string | null;
  sourceSeason: number | null;
  sourceStartTime: string | null;
};

type PersistedTeamSnapshot = Omit<SelectedTeamSnapshot, "candidates"> & {
  effectiveRatings?: TeamRatings | null;
  ratingModifiers?: TeamRatings | null;
};

type ScoredRemainingGame = RemainingLeagueGame & {
  awayTeamIndex: number;
  expectedAwayScore: number;
  expectedHomeScore: number;
  expectedMargin: number;
  awayDefense: string;
  awayOffense: string;
  homeTeamIndex: number;
  homeDefense: string;
  homeOffense: string;
  homeWinProbability: number;
  modelVersion: string | null;
};

type LeagueSeasonSimulationWorkerActionName =
  | "PREPARE_CONTEXT"
  | "COLLECT_SNAPSHOTS_CHUNK"
  | "FINALIZE_SNAPSHOTS"
  | "SCORE_GAMES_CHUNK"
  | "RUN_MONTE_CARLO";

type LeagueSeasonSimulationWorkerEvent = {
  action: LeagueSeasonSimulationWorkerActionName;
  jobId: string;
  nextGameIndex?: number | null;
  nextTeamIndex?: number | null;
  userId: string;
};

type LeagueSeasonSimulationWorkerResult = {
  jobId: string;
  nextGameIndex?: number;
  nextTeamIndex?: number;
  scoringComplete?: boolean;
  snapshotsComplete?: boolean;
  userId: string;
};

type LeagueSeasonSimulationFailureEvent = {
  error?: unknown;
  jobId: string;
  userId: string;
};

type SimulationContextArtifact = {
  candidateGameCount: number;
  currentSeason: number;
  leagueId: string;
  leagueName: string | null;
  remainingGames: RemainingLeagueGame[];
  teamCount: number;
  teams: TeamStanding[];
};

type SimulationArtifactType =
  | "CONTEXT"
  | "SNAPSHOT"
  | "FINALIZED_SNAPSHOT"
  | "SCORED_GAME";

type DeterministicExpectedOutcomes = {
  expectedLosses: number[];
  expectedPointMargins: number[];
  expectedWins: number[];
};

type SeasonSimulationPlannerPair = {
  defense: string;
  offense: string;
  pairId: string;
  ratings: TeamRatings;
};

type SeasonSimulationPlannerSelection = {
  awayPair: SeasonSimulationPlannerPair;
  cell: {
    available: boolean;
    predictedOpponentScore: number | null;
    predictedPointDiff: number | null;
    predictedTeamScore: number | null;
  };
  homePair: SeasonSimulationPlannerPair;
};

type SimulationTeamAccumulator = {
  finishCounts: number[];
  finishTotal: number;
  firstPlaceCount: number;
  sampledWins: number[];
};

type SubmitDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: (options: {
    securityCode: string;
    username: string;
  }) => Pick<BBXmlApiClient, "getSchedule" | "getSeasons">;
  createLeagueSeasonSimulationJob: typeof createLeagueSeasonSimulationJob;
  getBbConnection: typeof getBbConnection;
  requireFeatureAccess: typeof requireFeatureAccess;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: { jobId: string; userId: string },
  ) => Promise<string>;
  updateLeagueSeasonSimulationJob: typeof updateLeagueSeasonSimulationJob;
};

type GetLatestDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createBbClient: SubmitDependencies["createBbClient"];
  describeWorkflowExecution: (
    executionArn: string,
  ) => Promise<StateMachineExecutionDescription>;
  getBbConnection: typeof getBbConnection;
  getLeagueSeasonSimulationJob: typeof getLeagueSeasonSimulationJob;
  listLeagueSeasonSimulationJobsByUser: typeof listLeagueSeasonSimulationJobsByUser;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  updateLeagueSeasonSimulationJob: typeof updateLeagueSeasonSimulationJob;
};

type ProcessDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  artifactStore: LeagueSeasonSimulationArtifactStore;
  createBbClient: (options: {
    securityCode: string;
    username: string;
  }) => BbClient;
  getBbConnection: typeof getBbConnection;
  getLeagueSeasonSimulationJob: typeof getLeagueSeasonSimulationJob;
  getMatchBoxscore: typeof getMatchBoxscore;
  invokePredictionRuntime: (
    endpointName: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  rng: () => number;
  updateLeagueSeasonSimulationJob: typeof updateLeagueSeasonSimulationJob;
  upsertMatchBoxscore: typeof upsertMatchBoxscore;
};

type LeagueSeasonSimulationArtifactStore = {
  get: typeof getLeagueSeasonSimulationArtifact;
  listByJobId: typeof listLeagueSeasonSimulationArtifactsByJobId;
  upsert: typeof upsertLeagueSeasonSimulationArtifact;
};

type SimulationArtifactWriteArgsBase = {
  deps: Pick<ProcessDependencies, "artifactStore">;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
  key: string;
  order: number;
};

type SimulationArtifactWriteArgs =
  | (SimulationArtifactWriteArgsBase & {
      payload: SimulationContextArtifact;
      type: "CONTEXT";
    })
  | (SimulationArtifactWriteArgsBase & {
      payload: PersistedTeamSnapshot;
      type: "FINALIZED_SNAPSHOT" | "SNAPSHOT";
    })
  | (SimulationArtifactWriteArgsBase & {
      payload: ScoredRemainingGame;
      type: "SCORED_GAME";
    });

type SeasonSimulationRuntimeConfig = {
  plannerBatchConcurrency: number;
};

const SIMULATION_PHASES: SimulationPhaseKey[] = [
  "QUEUED",
  "RESOLVING_CONTEXT",
  "COLLECTING_SNAPSHOTS",
  "SCORING_GAMES",
  "RUNNING_SIMULATIONS",
  "SUCCEEDED",
  "FAILED",
];

const MAX_SNAPSHOT_CANDIDATES = 10;
const SNAPSHOT_SELECTION_INDEX = 2;
const SNAPSHOT_CHUNK_SIZE = 2;
const SCORING_CHUNK_SIZE = 6;
const MIN_SAFE_REMAINING_TIME_MS = 20_000;
const MAX_FUTURE_REGRESSION = 0.2;
const DEFAULT_RESIDUAL_SIGMA = 10;
const DEFAULT_SIMULATION_COUNT = 10_000;
const DEFAULT_PLANNER_BATCH_CONCURRENCY = 2;
const EXPECTED_REGULAR_SEASON_GAMES_PER_TEAM = 22;
const LEAGUE_SEASON_SIMULATION_PLANNER_CONCURRENCY_ENV_NAME =
  "LEAGUE_SEASON_SIMULATION_PLANNER_CONCURRENCY";
const SEASON_SIMULATION_RESPONSE_TOO_LARGE_ERROR_MESSAGE =
  "Season projection returned more predictor detail than the service can carry. The projection request needs the lean planner response path.";
const DEFAULT_NEUTRAL_RATINGS: TeamRatings = {
  insideDefense: 10,
  insideScoring: 10,
  offensiveFlow: 10,
  outsideDefense: 10,
  outsideScoring: 10,
  rebounding: 10,
};

const OFFENSE_TO_PREDICTOR: Record<string, string> = {
  Base: "Base",
  "Base Offense": "Base",
  "Inside Isolation": "InsideIsolation",
  "Look Inside": "LookInside",
  "Low Post": "LowPost",
  "Outside Isolation": "OutsideIsolation",
  LookInside: "LookInside",
  LowPost: "LowPost",
  Motion: "Motion",
  Patient: "Patient",
  Princeton: "Princeton",
  Push: "Push",
  "Push the Ball": "Push",
  "Run and Gun": "RunAndGun",
  RunAndGun: "RunAndGun",
  InsideIsolation: "InsideIsolation",
  OutsideIsolation: "OutsideIsolation",
};

const DEFENSE_TO_PREDICTOR: Record<string, string> = {
  "1-3-1 Zone": "131Zone",
  "2-3 Zone": "23Zone",
  "3-2 Zone": "32Zone",
  "Full Court Press": "Press",
  "Man to man": "ManToMan",
  "Man-to-man": "ManToMan",
  "Press Zone": "Press",
  "Box-and-one (Inside)": "InsideBoxAndOne",
  "Box-and-one (Outside)": "OutsideBoxAndOne",
  "131Zone": "131Zone",
  "23Zone": "23Zone",
  "32Zone": "32Zone",
  InsideBoxAndOne: "InsideBoxAndOne",
  ManToMan: "ManToMan",
  OutsideBoxAndOne: "OutsideBoxAndOne",
  Press: "Press",
};

const defaultSubmitDependencies: SubmitDependencies = {
  assertMaintenanceInactive,
  createBbClient: (options) => new BBXmlApiClient(options),
  createLeagueSeasonSimulationJob,
  getBbConnection,
  requireFeatureAccess,
  resolveBbAccessKey,
  startWorkflowExecution: async (stateMachineArn, executionName, message) =>
    startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    }),
  updateLeagueSeasonSimulationJob,
};

const defaultGetLatestDependencies: GetLatestDependencies = {
  assertMaintenanceInactive,
  createBbClient: defaultSubmitDependencies.createBbClient,
  describeWorkflowExecution: async (executionArn) =>
    describeStateMachineExecution({ executionArn }),
  getBbConnection,
  getLeagueSeasonSimulationJob,
  listLeagueSeasonSimulationJobsByUser,
  resolveBbAccessKey,
  updateLeagueSeasonSimulationJob,
};

const defaultProcessDependencies: ProcessDependencies = {
  assertMaintenanceInactive,
  artifactStore: {
    get: getLeagueSeasonSimulationArtifact,
    listByJobId: listLeagueSeasonSimulationArtifactsByJobId,
    upsert: upsertLeagueSeasonSimulationArtifact,
  },
  createBbClient: (options) => new BBXmlApiClient(options),
  getBbConnection,
  getLeagueSeasonSimulationJob,
  getMatchBoxscore,
  invokePredictionRuntime: async (endpointName, payload) =>
    invokePredictionRuntimeEndpoint({
      endpointName,
      payload,
    }),
  resolveBbAccessKey,
  rng: () => Math.random(),
  updateLeagueSeasonSimulationJob,
  upsertMatchBoxscore,
};

export async function submitLeagueSeasonSimulationJob(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    leagueId?: string | null;
    snapshotModifiers?: unknown;
    stateMachineArn: string;
  },
  dependencies: Partial<SubmitDependencies> = {},
): Promise<{ executionArn: string; jobId: string }> {
  const deps = {
    ...defaultSubmitDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  await deps.requireFeatureAccess({
    env: args.env,
    featureKey: "predictions",
    userId,
  });

  const connection = await deps.getBbConnection(args.env, userId);
  const requestedLeagueId = normalizeOptionalString(args.leagueId);
  const connectedLeagueId = normalizeOptionalString(connection?.leagueId);
  const leagueId = requestedLeagueId ?? connectedLeagueId;
  if (!leagueId) {
    throw new Error("A league ID is required to submit a season projection.");
  }
  const teamId = normalizeRequiredString(
    connection?.teamId,
    "A connected team id",
  );
  const bbLoginName = normalizeRequiredString(
    connection?.bbLoginName,
    "A connected BuzzerBeater login",
  );
  const accessKey = await deps.resolveBbAccessKey(args.env, userId);
  const currentSeason = await resolveCurrentLeagueSeason({
    client: deps.createBbClient({
      securityCode: accessKey,
      username: bbLoginName,
    }),
    teamId,
  });
  const jobId = randomUUID();
  const requestedAt = new Date().toISOString();
  const snapshotModifiers = normalizeTeamModifiers(args.snapshotModifiers);
  const scenarioKey = buildScenarioKey(snapshotModifiers);
  const requestJson: SimulationStoredRequest = {
    leagueId,
    scenarioKey,
    season: currentSeason,
    snapshotModifiers,
    teamId,
    teamName: connection?.teamName ?? null,
  };

  await deps.createLeagueSeasonSimulationJob(args.env, {
    completedAt: null,
    error: null,
    executionArn: null,
    id: jobId,
    leagueId,
    leagueName:
      leagueId === connectedLeagueId
        ? normalizeOptionalString(connection?.leagueName)
        : null,
    progressJson: buildQueuedProgress(requestedAt),
    requestJson,
    requestedAt,
    resultJson: null,
    scenarioKey,
    season: currentSeason,
    startedAt: null,
    status: "QUEUED",
    teamId,
    teamName: connection?.teamName ?? null,
    userId,
  });

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName("league-season-simulation", jobId),
      { jobId, userId },
    );
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      executionArn,
      id: jobId,
    });
    return {
      executionArn,
      jobId,
    };
  } catch (error) {
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      id: jobId,
      progressJson: buildFailedProgress({
        currentProgress: buildQueuedProgress(requestedAt),
        errorMessage:
          error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }),
      status: "FAILED",
    });
    throw error;
  }
}

export async function getLatestLeagueSeasonSimulation(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    jobId?: string | null;
    leagueId?: string | null;
  },
  dependencies: Partial<GetLatestDependencies> = {},
): Promise<SimulationSnapshot | null> {
  const deps = {
    ...defaultGetLatestDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const requestedJobId = normalizeOptionalString(args.jobId);
  if (requestedJobId) {
    const job = await deps.getLeagueSeasonSimulationJob(args.env, requestedJobId);
    if (!job || job.userId !== userId) {
      return null;
    }
    const reconciled = await reconcileActiveSimulationExecution({
      deps,
      env: args.env,
      job,
    });
    return adaptSimulationJob(reconciled);
  }

  const connection = await deps.getBbConnection(args.env, userId);
  const leagueId =
    normalizeOptionalString(args.leagueId) ??
    normalizeOptionalString(connection?.leagueId);
  const bbLoginName = normalizeOptionalString(connection?.bbLoginName);
  if (!leagueId || !bbLoginName) {
    return null;
  }

  const accessKey = await deps.resolveBbAccessKey(args.env, userId);
  const currentSeason = await resolveCurrentLeagueSeason({
    client: deps.createBbClient({
      securityCode: accessKey,
      username: bbLoginName,
    }),
    teamId: normalizeRequiredString(connection?.teamId, "A connected team id"),
  });

  const jobs = await deps.listLeagueSeasonSimulationJobsByUser(args.env, userId, {
    limit: 20,
  });
  const match = jobs.records.find(
    (job) =>
      job.leagueId === leagueId &&
      job.season === currentSeason &&
      getJobScenarioKey(job) === "baseline",
  );
  if (!match) {
    return null;
  }

  const reconciled = await reconcileActiveSimulationExecution({
    deps,
    env: args.env,
    job: match,
  });
  return adaptSimulationJob(reconciled);
}

export async function processLeagueSeasonSimulationWorkerAction(
  args: {
    endpointName: string;
    env: GraphqlEnv;
    event: LeagueSeasonSimulationWorkerEvent;
    remainingTimeInMillis?: () => number;
  },
  dependencies: Partial<ProcessDependencies> = {},
): Promise<LeagueSeasonSimulationWorkerResult> {
  const deps = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = normalizeSimulationWorkerEvent(args.event);
  const job = await loadSimulationJobForUser({
    deps,
    env: args.env,
    jobId: message.jobId,
    userId: message.userId,
  });

  switch (message.action) {
    case "PREPARE_CONTEXT":
      return prepareLeagueSeasonSimulationContext({
        deps,
        env: args.env,
        job,
      });
    case "COLLECT_SNAPSHOTS_CHUNK":
      return collectLeagueSeasonSimulationSnapshotsChunk({
        deps,
        env: args.env,
        job,
        nextTeamIndex: message.nextTeamIndex ?? 0,
        remainingTimeInMillis: args.remainingTimeInMillis,
      });
    case "FINALIZE_SNAPSHOTS":
      return finalizeLeagueSeasonSimulationSnapshots({
        deps,
        env: args.env,
        job,
      });
    case "SCORE_GAMES_CHUNK":
      return scoreLeagueSeasonSimulationGamesChunk({
        deps,
        endpointName: args.endpointName,
        env: args.env,
        job,
        nextGameIndex: message.nextGameIndex ?? 0,
        remainingTimeInMillis: args.remainingTimeInMillis,
      });
    case "RUN_MONTE_CARLO":
      return runLeagueSeasonSimulationMonteCarlo({
        deps,
        env: args.env,
        job,
      });
  }
}

export async function finalizeLeagueSeasonSimulationWorkflowFailure(
  args: {
    env: GraphqlEnv;
    event: LeagueSeasonSimulationFailureEvent;
  },
  dependencies: Partial<Pick<
    ProcessDependencies,
    "getLeagueSeasonSimulationJob" | "updateLeagueSeasonSimulationJob"
  >> = {},
): Promise<{ updated: boolean }> {
  const deps = {
    getLeagueSeasonSimulationJob,
    updateLeagueSeasonSimulationJob,
    ...dependencies,
  };
  const job = await deps.getLeagueSeasonSimulationJob(
    args.env,
    args.event.jobId,
  );
  if (
    !job ||
    job.userId !== args.event.userId ||
    isTerminalSimulationStatus(job.status)
  ) {
    return { updated: false };
  }

  const completedAt = new Date().toISOString();
  const errorMessage = extractWorkflowFailureMessage(args.event.error);
  await deps.updateLeagueSeasonSimulationJob(args.env, {
    completedAt,
    error: errorMessage,
    id: job.id,
    progressJson: buildFailedProgress({
      currentProgress: job.progressJson ?? buildQueuedProgress(job.requestedAt),
      errorMessage,
      updatedAt: completedAt,
    }),
    status: "FAILED",
  });
  return { updated: true };
}

async function prepareLeagueSeasonSimulationContext(args: {
  deps: ProcessDependencies;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
}): Promise<LeagueSeasonSimulationWorkerResult> {
  await args.deps.assertMaintenanceInactive();
  const startedAt = new Date().toISOString();
  const resolvingProgress = advanceProgress({
    currentPhaseStartedAt: startedAt,
    currentProgress: args.job.progressJson ?? buildQueuedProgress(args.job.requestedAt),
    nextPhaseKey: "RESOLVING_CONTEXT",
    summary: "Resolving league context, standings, and schedule data.",
    updatedAt: startedAt,
  });
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    completedAt: null,
    error: null,
    id: args.job.id,
    progressJson: resolvingProgress,
    startedAt: args.job.startedAt ?? startedAt,
    status: "RESOLVING_CONTEXT",
  });

  const connection = await args.deps.getBbConnection(args.env, args.job.userId);
  const bbLoginName = normalizeRequiredString(
    connection?.bbLoginName,
    "A connected BuzzerBeater login",
  );
  const accessKey = await args.deps.resolveBbAccessKey(
    args.env,
    args.job.userId,
  );
  const bb = args.deps.createBbClient({
    securityCode: accessKey,
    username: bbLoginName,
  });
  const seasons = await bb.getSeasons();
  const latestSeason = resolveLatestSeasonId(seasons);
  const schedule = await bb.getSchedule(args.job.teamId, latestSeason);
  const currentSeason = resolveEffectiveCurrentSeason({
    fallbackSeason: latestSeason,
    schedule,
  });
  const effectiveSeason = args.job.season ?? currentSeason;
  const standings = await bb.getStandings(args.job.leagueId, effectiveSeason);
  const teams = flattenStandings(standings);
  const teamSchedules = await fetchLeagueSchedules({
    bb,
    season: effectiveSeason,
    teams,
  });
  const remainingGames = buildRemainingRegularSeasonLeagueGames({
    schedulesByTeamId: teamSchedules,
  });
  const slateCoverage = buildLeagueSeasonSlateCoverage({
    remainingGames,
    teams,
  });
  if (slateCoverage.issues.length) {
    const errorMessage = formatLeagueSeasonSlateCoverageError(slateCoverage);
    const completedAt = new Date().toISOString();
    await args.deps.updateLeagueSeasonSimulationJob(args.env, {
      completedAt,
      error: errorMessage,
      id: args.job.id,
      progressJson: buildFailedProgress({
        currentProgress: resolvingProgress,
        errorMessage,
        updatedAt: completedAt,
      }),
      status: "FAILED",
    });
    throw new Error(errorMessage);
  }
  const context: SimulationContextArtifact = {
    candidateGameCount: 0,
    currentSeason: effectiveSeason,
    leagueId: args.job.leagueId,
    leagueName: standings.league?.name ?? args.job.leagueName ?? null,
    remainingGames,
    teamCount: teams.length,
    teams,
  };
  await writeSimulationArtifact({
    deps: args.deps,
    env: args.env,
    job: args.job,
    order: 0,
    payload: context,
    type: "CONTEXT",
    key: "context",
  });

  const now = new Date().toISOString();
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    id: args.job.id,
    leagueName: context.leagueName,
    progressJson: advanceProgress({
      completedUnits: 0,
      context: buildProgressContext({
        candidateGameCount: 0,
        currentSeason: effectiveSeason,
        lowSampleTeamCount: 0,
        remainingGameCount: remainingGames.length,
        scoredGameCount: 0,
        teamCount: teams.length,
      }),
      currentPhaseStartedAt: now,
      currentProgress: resolvingProgress,
      nextPhaseKey: "COLLECTING_SNAPSHOTS",
      summary: `Collecting historical team snapshots for ${teams.length} league teams.`,
      totalUnits: teams.length,
      unitLabel: "teams",
      updatedAt: now,
    }),
    status: "COLLECTING_SNAPSHOTS",
  });

  return {
    jobId: args.job.id,
    nextTeamIndex: 0,
    snapshotsComplete: teams.length === 0,
    userId: args.job.userId,
  };
}

async function collectLeagueSeasonSimulationSnapshotsChunk(args: {
  deps: ProcessDependencies;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
  nextTeamIndex: number;
  remainingTimeInMillis?: () => number;
}): Promise<LeagueSeasonSimulationWorkerResult> {
  await args.deps.assertMaintenanceInactive();
  const context = await loadSimulationContextArtifact(args);
  const connection = await args.deps.getBbConnection(args.env, args.job.userId);
  const bbLoginName = normalizeRequiredString(
    connection?.bbLoginName,
    "A connected BuzzerBeater login",
  );
  const accessKey = await args.deps.resolveBbAccessKey(
    args.env,
    args.job.userId,
  );
  const bb = args.deps.createBbClient({
    securityCode: accessKey,
    username: bbLoginName,
  });
  const seasons = await bb.getSeasons();
  let index = clampIndex(args.nextTeamIndex, context.teams.length);
  const maxIndex = Math.min(context.teams.length, index + SNAPSHOT_CHUNK_SIZE);

  for (; index < maxIndex; index += 1) {
    const team = context.teams[index]!;
    const existing = await args.deps.artifactStore.get(args.env, {
      artifactKey: team.teamId,
      artifactType: "SNAPSHOT",
      jobId: args.job.id,
    });
    if (!existing) {
      const snapshot = await buildSelectedTeamSnapshot({
        bb,
        currentSeason: context.currentSeason,
        env: args.env,
        seasons,
        team,
        userId: args.job.userId,
        getMatchBoxscore: args.deps.getMatchBoxscore,
        upsertMatchBoxscore: args.deps.upsertMatchBoxscore,
      });
      await writeSimulationArtifact({
        deps: args.deps,
        env: args.env,
        job: args.job,
        key: team.teamId,
        order: 1_000 + index,
        payload: toPersistedTeamSnapshot(snapshot),
        type: "SNAPSHOT",
      });
    }

    if (shouldYieldForRemainingTime(args.remainingTimeInMillis)) {
      index += 1;
      break;
    }
  }

  const snapshots = await loadPersistedSnapshots(args, "SNAPSHOT");
  const now = new Date().toISOString();
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    id: args.job.id,
    progressJson: advanceProgress({
      completedUnits: snapshots.length,
      context: buildProgressContext({
        candidateGameCount: snapshots.reduce(
          (sum, snapshot) => sum + snapshot.candidateGameCount,
          0,
        ),
        currentSeason: context.currentSeason,
        lowSampleTeamCount: snapshots.filter((snapshot) =>
          Boolean(snapshot.sampleWarning),
        ).length,
        remainingGameCount: context.remainingGames.length,
        scoredGameCount: 0,
        teamCount: context.teams.length,
      }),
      currentProgress:
        args.job.progressJson ?? buildQueuedProgress(args.job.requestedAt),
      nextPhaseKey: "COLLECTING_SNAPSHOTS",
      summary: `Collecting historical team snapshots for ${context.teams.length} league teams.`,
      totalUnits: context.teams.length,
      unitLabel: "teams",
      updatedAt: now,
    }),
    status: "COLLECTING_SNAPSHOTS",
  });

  return {
    jobId: args.job.id,
    nextTeamIndex: index,
    snapshotsComplete: snapshots.length >= context.teams.length,
    userId: args.job.userId,
  };
}

async function finalizeLeagueSeasonSimulationSnapshots(args: {
  deps: ProcessDependencies;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
}): Promise<LeagueSeasonSimulationWorkerResult> {
  await args.deps.assertMaintenanceInactive();
  const context = await loadSimulationContextArtifact(args);
  const snapshots = await loadPersistedSnapshots(args, "SNAPSHOT");
  if (snapshots.length < context.teams.length) {
    throw new Error("Cannot finalize league simulation snapshots before every team snapshot is collected.");
  }

  const baselineLeagueAverage = computeLeagueAverageRatings(snapshots);
  const finalizedSnapshots = applySnapshotModifiers({
    modifiers: readJobSnapshotModifiers(args.job),
    snapshots: finalizeFallbackSnapshots(snapshots, baselineLeagueAverage),
    teams: context.teams,
  });
  for (let index = 0; index < finalizedSnapshots.length; index += 1) {
    const snapshot = finalizedSnapshots[index]!;
    await writeSimulationArtifact({
      deps: args.deps,
      env: args.env,
      job: args.job,
      key: snapshot.teamId,
      order: 2_000 + index,
      payload: snapshot,
      type: "FINALIZED_SNAPSHOT",
    });
  }

  const now = new Date().toISOString();
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    id: args.job.id,
    progressJson: advanceProgress({
      completedUnits: 0,
      context: buildProgressContext({
        candidateGameCount: finalizedSnapshots.reduce(
          (sum, snapshot) => sum + snapshot.candidateGameCount,
          0,
        ),
        currentSeason: context.currentSeason,
        lowSampleTeamCount: finalizedSnapshots.filter((snapshot) =>
          Boolean(snapshot.sampleWarning),
        ).length,
        remainingGameCount: context.remainingGames.length,
        scoredGameCount: 0,
        teamCount: context.teams.length,
      }),
      currentPhaseStartedAt: now,
      currentProgress:
        args.job.progressJson ?? buildQueuedProgress(args.job.requestedAt),
      nextPhaseKey: "SCORING_GAMES",
      summary:
        context.remainingGames.length > 0
          ? `Scoring ${context.remainingGames.length} remaining regular-season games with minimax tactic matrices.`
          : "Finalizing projected standings without remaining regular-season league games.",
      totalUnits: Math.max(context.remainingGames.length, 1),
      unitLabel: "games",
      updatedAt: now,
    }),
    status: "SCORING_GAMES",
  });

  return {
    jobId: args.job.id,
    nextGameIndex: 0,
    scoringComplete: context.remainingGames.length === 0,
    userId: args.job.userId,
  };
}

async function scoreLeagueSeasonSimulationGamesChunk(args: {
  deps: ProcessDependencies;
  endpointName: string;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
  nextGameIndex: number;
  remainingTimeInMillis?: () => number;
}): Promise<LeagueSeasonSimulationWorkerResult> {
  await args.deps.assertMaintenanceInactive();
  const runtimeConfig = resolveSeasonSimulationRuntimeConfig(args.env);
  const context = await loadSimulationContextArtifact(args);
  const snapshots = await loadPersistedSnapshots(args, "FINALIZED_SNAPSHOT");
  const leagueAverage = computeLeagueAverageRatings(snapshots);
  let index = clampIndex(args.nextGameIndex, context.remainingGames.length);
  const maxIndex = Math.min(context.remainingGames.length, index + SCORING_CHUNK_SIZE);

  for (; index < maxIndex; index += 1) {
    const game = context.remainingGames[index]!;
    const existing = await args.deps.artifactStore.get(args.env, {
      artifactKey: game.matchId,
      artifactType: "SCORED_GAME",
      jobId: args.job.id,
    });
    if (!existing) {
      const [scoredGame] = await scoreRemainingGames({
        endpointName: args.endpointName,
        gameIndexes: [index],
        games: context.remainingGames,
        invokePredictionRuntime: args.deps.invokePredictionRuntime,
        leagueAverage,
        plannerBatchConcurrency: runtimeConfig.plannerBatchConcurrency,
        residualSigma: DEFAULT_RESIDUAL_SIGMA,
        snapshots,
        updateProgress: async () => undefined,
      });
      if (!scoredGame) {
        throw new Error(`No score was produced for remaining game '${game.matchId}'.`);
      }
      await writeSimulationArtifact({
        deps: args.deps,
        env: args.env,
        job: args.job,
        key: game.matchId,
        order: 3_000 + index,
        payload: scoredGame,
        type: "SCORED_GAME",
      });
    }

    if (shouldYieldForRemainingTime(args.remainingTimeInMillis)) {
      index += 1;
      break;
    }
  }

  const scoredGames = await loadScoredGameArtifacts(args);
  const now = new Date().toISOString();
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    id: args.job.id,
    progressJson: advanceProgress({
      completedUnits: scoredGames.length,
      context: buildProgressContext({
        candidateGameCount: snapshots.reduce(
          (sum, snapshot) => sum + snapshot.candidateGameCount,
          0,
        ),
        currentSeason: context.currentSeason,
        lowSampleTeamCount: snapshots.filter((snapshot) =>
          Boolean(snapshot.sampleWarning),
        ).length,
        remainingGameCount: context.remainingGames.length,
        scoredGameCount: scoredGames.length,
        teamCount: context.teams.length,
      }),
      currentProgress:
        args.job.progressJson ?? buildQueuedProgress(args.job.requestedAt),
      nextPhaseKey: "SCORING_GAMES",
      summary:
        context.remainingGames.length > 0
          ? `Scoring ${context.remainingGames.length} remaining regular-season games with minimax tactic matrices. ${scoredGames.length} of ${context.remainingGames.length} games.`
          : "Finalizing projected standings without remaining regular-season league games.",
      totalUnits: Math.max(context.remainingGames.length, 1),
      unitLabel: "games",
      updatedAt: now,
    }),
    status: "SCORING_GAMES",
  });

  return {
    jobId: args.job.id,
    nextGameIndex: index,
    scoringComplete: scoredGames.length >= context.remainingGames.length,
    userId: args.job.userId,
  };
}

async function runLeagueSeasonSimulationMonteCarlo(args: {
  deps: ProcessDependencies;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
}): Promise<LeagueSeasonSimulationWorkerResult> {
  await args.deps.assertMaintenanceInactive();
  const context = await loadSimulationContextArtifact(args);
  const snapshots = await loadPersistedSnapshots(args, "FINALIZED_SNAPSHOT");
  const scoredGames = await loadScoredGameArtifacts(args);
  if (scoredGames.length < context.remainingGames.length) {
    throw new Error("Cannot run league season Monte Carlo before every remaining game is scored.");
  }

  const deterministicExpectations = buildDeterministicExpectedOutcomes({
    scoredGames,
    snapshots,
  });
  const simulationStartedAt = new Date().toISOString();
  const simulationProgress = advanceProgress({
    completedUnits: 0,
    context: buildProgressContext({
      candidateGameCount: snapshots.reduce(
        (sum, snapshot) => sum + snapshot.candidateGameCount,
        0,
      ),
      currentSeason: context.currentSeason,
      lowSampleTeamCount: snapshots.filter((snapshot) =>
        Boolean(snapshot.sampleWarning),
      ).length,
      remainingGameCount: context.remainingGames.length,
      scoredGameCount: scoredGames.length,
      teamCount: context.teams.length,
    }),
    currentPhaseStartedAt: simulationStartedAt,
    currentProgress:
      args.job.progressJson ?? buildQueuedProgress(args.job.requestedAt),
    nextPhaseKey: "RUNNING_SIMULATIONS",
    summary: `Running ${numberFormatter.format(DEFAULT_SIMULATION_COUNT)} Monte Carlo simulations.`,
    totalUnits: DEFAULT_SIMULATION_COUNT,
    unitLabel: "sims",
    updatedAt: simulationStartedAt,
  });
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    id: args.job.id,
    progressJson: simulationProgress,
    status: "RUNNING_SIMULATIONS",
  });

  const result = runSeasonMonteCarlo({
    deterministicExpectations,
    leagueId: context.leagueId,
    leagueName: context.leagueName,
    random: createSeededRng(args.job.id),
    residualSigma: DEFAULT_RESIDUAL_SIGMA,
    scenarioKey: getJobScenarioKey(args.job),
    scoredGames,
    season: context.currentSeason,
    simulationCount: DEFAULT_SIMULATION_COUNT,
    snapshots,
  });

  const completedAt = new Date().toISOString();
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    completedAt,
    error: null,
    id: args.job.id,
    leagueName: result.leagueName,
    progressJson: buildCompletedProgress({
      currentProgress: simulationProgress,
      result,
      updatedAt: completedAt,
    }),
    resultJson: result,
    status: "SUCCEEDED",
  });

  return {
    jobId: args.job.id,
    userId: args.job.userId,
  };
}

export async function processLeagueSeasonSimulationJob(
  args: {
    endpointName: string;
    env: GraphqlEnv;
    message?: { jobId: string; userId: string };
    messageBody?: string;
  },
  dependencies: Partial<ProcessDependencies> = {},
): Promise<void> {
  const deps = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveSimulationJobMessage(args);
  const job = await deps.getLeagueSeasonSimulationJob(args.env, message.jobId);
  if (!job || job.userId !== message.userId) {
    throw new Error(
      "League season simulation job is missing or no longer belongs to the enqueued user.",
    );
  }

  const startedAt = new Date().toISOString();

  try {
    await deps.assertMaintenanceInactive();
    const runtimeConfig = resolveSeasonSimulationRuntimeConfig(args.env);

    const resolvingProgress = advanceProgress({
      currentPhaseStartedAt: startedAt,
      currentProgress: job.progressJson ?? buildQueuedProgress(job.requestedAt),
      nextPhaseKey: "RESOLVING_CONTEXT",
      summary: "Resolving league context, standings, and schedule data.",
      updatedAt: startedAt,
    });
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      completedAt: null,
      error: null,
      id: job.id,
      progressJson: resolvingProgress,
      startedAt,
      status: "RESOLVING_CONTEXT",
    });

    const connection = await deps.getBbConnection(args.env, message.userId);
    const bbLoginName = normalizeRequiredString(
      connection?.bbLoginName,
      "A connected BuzzerBeater login",
    );
    const accessKey = await deps.resolveBbAccessKey(args.env, message.userId);
    const bb = deps.createBbClient({
      securityCode: accessKey,
      username: bbLoginName,
    });
    const seasons = await bb.getSeasons();
    const latestSeason = resolveLatestSeasonId(seasons);
    const schedule = await bb.getSchedule(job.teamId, latestSeason);
    const currentSeason = resolveEffectiveCurrentSeason({
      fallbackSeason: latestSeason,
      schedule,
    });
    const effectiveSeason = job.season ?? currentSeason;
    const standings = await bb.getStandings(job.leagueId, effectiveSeason);
    const teams = flattenStandings(standings);

    const snapshotStart = new Date().toISOString();
    const snapshotProgress = advanceProgress({
      context: {
        candidateGameCount: 0,
        currentSeason: effectiveSeason,
        lowSampleTeamCount: 0,
        remainingGameCount: 0,
        scoredGameCount: 0,
        simulationCount: DEFAULT_SIMULATION_COUNT,
        teamCount: teams.length,
      },
      currentPhaseStartedAt: snapshotStart,
      currentProgress: resolvingProgress,
      nextPhaseKey: "COLLECTING_SNAPSHOTS",
      summary: `Collecting historical team snapshots for ${teams.length} league teams.`,
      totalUnits: teams.length,
      unitLabel: "teams",
      updatedAt: snapshotStart,
    });
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      id: job.id,
      progressJson: snapshotProgress,
      status: "COLLECTING_SNAPSHOTS",
    });

    const teamSchedules = await fetchLeagueSchedules({
      bb,
      season: effectiveSeason,
      teams,
    });
    const remainingGames = buildRemainingRegularSeasonLeagueGames({
      schedulesByTeamId: teamSchedules,
    });
    assertCompleteLeagueSeasonSlateCoverage({
      remainingGames,
      teams,
    });

    const selectedSnapshots = await mapWithConcurrency(
      teams,
      4,
      async (team, index) => {
        const snapshot = await buildSelectedTeamSnapshot({
          bb,
          currentSeason: effectiveSeason,
          env: args.env,
          seasons,
          team,
          userId: message.userId,
          getMatchBoxscore: deps.getMatchBoxscore,
          upsertMatchBoxscore: deps.upsertMatchBoxscore,
        });
        await deps.updateLeagueSeasonSimulationJob(args.env, {
          id: job.id,
          progressJson: advanceProgress({
            completedUnits: index + 1,
            context: {
              candidateGameCount: 0,
              currentSeason: effectiveSeason,
              lowSampleTeamCount: 0,
              remainingGameCount: remainingGames.length,
              scoredGameCount: 0,
              simulationCount: DEFAULT_SIMULATION_COUNT,
              teamCount: teams.length,
            },
            currentProgress: snapshotProgress,
            nextPhaseKey: "COLLECTING_SNAPSHOTS",
            summary: `Collecting historical team snapshots for ${teams.length} league teams.`,
            totalUnits: teams.length,
            unitLabel: "teams",
            updatedAt: new Date().toISOString(),
          }),
        });
        return snapshot;
      },
    );

    const baselineLeagueAverage = computeLeagueAverageRatings(selectedSnapshots);
    const finalizedSnapshots = applySnapshotModifiers({
      modifiers: readJobSnapshotModifiers(job),
      snapshots: finalizeFallbackSnapshots(
        selectedSnapshots,
        baselineLeagueAverage,
      ),
      teams,
    });
    const leagueAverage = computeLeagueAverageRatings(finalizedSnapshots);
    const scoringStartedAt = new Date().toISOString();
    const scoringProgress = advanceProgress({
      context: {
        candidateGameCount: finalizedSnapshots.reduce(
          (sum, snapshot) => sum + snapshot.candidateGameCount,
          0,
        ),
        currentSeason: effectiveSeason,
        lowSampleTeamCount: finalizedSnapshots.filter((snapshot) =>
          Boolean(snapshot.sampleWarning),
        ).length,
        remainingGameCount: remainingGames.length,
        scoredGameCount: 0,
        simulationCount: DEFAULT_SIMULATION_COUNT,
        teamCount: teams.length,
      },
      currentPhaseStartedAt: scoringStartedAt,
      currentProgress: snapshotProgress,
      nextPhaseKey: "SCORING_GAMES",
      summary:
        remainingGames.length > 0
          ? `Scoring ${remainingGames.length} remaining regular-season games with minimax tactic matrices.`
          : "Finalizing projected standings without remaining regular-season league games.",
      totalUnits: Math.max(remainingGames.length, 1),
      unitLabel: "games",
      updatedAt: scoringStartedAt,
    });
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      id: job.id,
      progressJson: scoringProgress,
      status: "SCORING_GAMES",
    });

    const scoredGames = await scoreRemainingGames({
      endpointName: args.endpointName,
      games: remainingGames,
      invokePredictionRuntime: deps.invokePredictionRuntime,
      leagueAverage,
      plannerBatchConcurrency: runtimeConfig.plannerBatchConcurrency,
      residualSigma: DEFAULT_RESIDUAL_SIGMA,
      snapshots: finalizedSnapshots,
      updateProgress: async (completedUnits) => {
        await deps.updateLeagueSeasonSimulationJob(args.env, {
          id: job.id,
          progressJson: advanceProgress({
            completedUnits,
            context: {
              candidateGameCount: finalizedSnapshots.reduce(
                (sum, snapshot) => sum + snapshot.candidateGameCount,
                0,
              ),
              currentSeason: effectiveSeason,
              lowSampleTeamCount: finalizedSnapshots.filter((snapshot) =>
                Boolean(snapshot.sampleWarning),
              ).length,
              remainingGameCount: remainingGames.length,
              scoredGameCount: completedUnits,
              simulationCount: DEFAULT_SIMULATION_COUNT,
              teamCount: teams.length,
            },
            currentProgress: scoringProgress,
            nextPhaseKey: "SCORING_GAMES",
            summary:
              remainingGames.length > 0
                ? `Scoring ${remainingGames.length} remaining regular-season games with minimax tactic matrices.`
                : "Finalizing projected standings without remaining regular-season league games.",
            totalUnits: Math.max(remainingGames.length, 1),
            unitLabel: "games",
            updatedAt: new Date().toISOString(),
          }),
        });
      },
    });
    const deterministicExpectations = buildDeterministicExpectedOutcomes({
      scoredGames,
      snapshots: finalizedSnapshots,
    });

    const simulationStartedAt = new Date().toISOString();
    const simulationProgress = advanceProgress({
      context: {
        candidateGameCount: finalizedSnapshots.reduce(
          (sum, snapshot) => sum + snapshot.candidateGameCount,
          0,
        ),
        currentSeason: effectiveSeason,
        lowSampleTeamCount: finalizedSnapshots.filter((snapshot) =>
          Boolean(snapshot.sampleWarning),
        ).length,
        remainingGameCount: remainingGames.length,
        scoredGameCount: scoredGames.length,
        simulationCount: DEFAULT_SIMULATION_COUNT,
        teamCount: teams.length,
      },
      currentPhaseStartedAt: simulationStartedAt,
      currentProgress: scoringProgress,
      nextPhaseKey: "RUNNING_SIMULATIONS",
      summary: `Running ${numberFormatter.format(DEFAULT_SIMULATION_COUNT)} Monte Carlo simulations.`,
      totalUnits: DEFAULT_SIMULATION_COUNT,
      unitLabel: "sims",
      updatedAt: simulationStartedAt,
    });
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      id: job.id,
      progressJson: simulationProgress,
      status: "RUNNING_SIMULATIONS",
    });

    const result = runSeasonMonteCarlo({
      deterministicExpectations,
      leagueId: job.leagueId,
      leagueName: standings.league?.name ?? job.leagueName ?? null,
      random: deps.rng,
      residualSigma: DEFAULT_RESIDUAL_SIGMA,
      scenarioKey: getJobScenarioKey(job),
      scoredGames,
      season: effectiveSeason,
      simulationCount: DEFAULT_SIMULATION_COUNT,
      snapshots: finalizedSnapshots,
    });

    const completedAt = new Date().toISOString();
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      completedAt,
      error: null,
      id: job.id,
      leagueName: result.leagueName,
      progressJson: buildCompletedProgress({
        currentProgress: simulationProgress,
        result,
        updatedAt: completedAt,
      }),
      resultJson: result,
      status: "SUCCEEDED",
    });
  } catch (error) {
    const normalizedError = normalizeSeasonSimulationProcessError(error);
    if (isPredictionRuntimeResponseTooLargeError(error)) {
      console.error("[league-season-simulation] predictor_response_too_large", {
        errorMessage:
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : error instanceof Error
              ? error.message
              : String(error),
        jobId: job.id,
        userId: job.userId,
      });
    }
    await deps.updateLeagueSeasonSimulationJob(args.env, {
      completedAt: new Date().toISOString(),
      error: toMaintenanceAwareErrorMessage(normalizedError),
      id: job.id,
      progressJson: buildFailedProgress({
        currentProgress:
          job.progressJson ?? buildQueuedProgress(job.requestedAt),
        errorMessage: toMaintenanceAwareErrorMessage(normalizedError),
        updatedAt: new Date().toISOString(),
      }),
      status: "FAILED",
    });
    throw normalizedError;
  }
}

async function fetchLeagueSchedules(args: {
  bb: Pick<BBXmlApiClient, "getSchedule">;
  season: number;
  teams: TeamStanding[];
}): Promise<Map<string, BBApiSchedule>> {
  const entries = await mapWithConcurrency(args.teams, 4, async (team) => {
    try {
      return [team.teamId, await args.bb.getSchedule(team.teamId, args.season)] as const;
    } catch {
      return [
        team.teamId,
        {
          matches: [],
          retrievedAt: null,
          season: args.season,
          teamId: team.teamId,
          version: "unavailable",
        } satisfies BBApiSchedule,
      ] as const;
    }
  });
  return new Map(entries);
}

async function buildSelectedTeamSnapshot(args: {
  bb: BbClient;
  currentSeason: number;
  env: GraphqlEnv;
  getMatchBoxscore: typeof getMatchBoxscore;
  seasons: BBApiSeasons;
  team: TeamStanding;
  upsertMatchBoxscore: typeof upsertMatchBoxscore;
  userId: string;
}): Promise<SelectedTeamSnapshot> {
  const candidates = await collectSnapshotCandidates({
    bb: args.bb,
    currentSeason: args.currentSeason,
    env: args.env,
    getMatchBoxscore: args.getMatchBoxscore,
    seasons: args.seasons,
    teamId: args.team.teamId,
    upsertMatchBoxscore: args.upsertMatchBoxscore,
    userId: args.userId,
  });
  const selected = selectPreferredSeasonSimulationSnapshotCandidate({
    candidates,
    currentSeason: args.currentSeason,
  });

  return {
    ...args.team,
    candidateGameCount: candidates.length,
    candidates,
    normalizedRatings: selected.candidate?.normalizedRatings ?? null,
    sourceDefense: selected.candidate?.predictorDefense ?? "ManToMan",
    sourceOffense: selected.candidate?.predictorOffense ?? "Base",
    sampleWarning: buildSnapshotSampleWarning(candidates.length),
    selectionStrategy: selected.strategy,
    sourceMatchId: selected.candidate?.matchId ?? null,
    sourceSeason: selected.candidate?.season ?? null,
    sourceStartTime: selected.candidate?.startTime ?? null,
  };
}

async function collectSnapshotCandidates(args: {
  bb: BbClient;
  currentSeason: number;
  env: GraphqlEnv;
  getMatchBoxscore: typeof getMatchBoxscore;
  seasons: BBApiSeasons;
  teamId: string;
  upsertMatchBoxscore: typeof upsertMatchBoxscore;
  userId: string;
}): Promise<SnapshotCandidate[]> {
  const orderedSeasons = buildSeasonBackfillOrder(
    args.currentSeason,
    args.seasons,
  );
  const candidates: SnapshotCandidate[] = [];

  for (const season of orderedSeasons) {
    if (candidates.length >= MAX_SNAPSHOT_CANDIDATES) {
      break;
    }

    let schedule: BBApiSchedule | null = null;
    try {
      schedule = await args.bb.getSchedule(args.teamId, season);
    } catch {
      schedule = null;
    }

    if (!schedule) {
      continue;
    }

    const matches = [...schedule.matches]
      .filter((match) => isUsableSnapshotMatch(match, args.teamId))
      .sort(compareMatchesByStartTimeDescending);
    for (const match of matches) {
      if (candidates.length >= MAX_SNAPSHOT_CANDIDATES) {
        break;
      }

      const matchId = normalizeOptionalString(match.id);
      if (!matchId) {
        continue;
      }

      const boxscore = await loadOrFetchBoxscore({
        bb: args.bb,
        env: args.env,
        getMatchBoxscore: args.getMatchBoxscore,
        matchId,
        upsertMatchBoxscore: args.upsertMatchBoxscore,
        userId: args.userId,
      });
      if (!boxscore) {
        continue;
      }

      const perspective = selectBoxscorePerspective(boxscore, args.teamId);
      if (!perspective.team?.ratings) {
        continue;
      }

      try {
        const teamLocation = resolvePredictionTeamLocation({
          boxscore,
          teamLocation: perspective.teamLocation as PredictionTeamLocation,
        });
        const normalizedRatings = normalizePredictionRatingsFromBoxscore({
          sourceTeam: perspective.team as never,
          teamLocation,
        });
        candidates.push({
          boxscore,
          matchId,
          normalizedRatings,
          normalizedScalar: sumRatings(normalizedRatings),
          predictorDefense: toPredictorDefense(perspective.team.defStrategy),
          predictorOffense: toPredictorOffense(perspective.team.offStrategy),
          season,
          startTime: boxscore.startTime ?? match.startTime ?? null,
        });
      } catch {
        continue;
      }
    }
  }

  return candidates.sort((left, right) =>
    right.normalizedScalar - left.normalizedScalar ||
    compareNullableTimestamps(right.startTime, left.startTime) ||
    left.matchId.localeCompare(right.matchId),
  );
}

async function loadOrFetchBoxscore(args: {
  bb: Pick<BBXmlApiClient, "getBoxScore">;
  env: GraphqlEnv;
  getMatchBoxscore: typeof getMatchBoxscore;
  matchId: string;
  upsertMatchBoxscore: typeof upsertMatchBoxscore;
  userId: string;
}): Promise<BBApiBoxScore | null> {
  const cached = await getNormalizedCachedMatchBoxscore({
    env: args.env,
    getRecord: args.getMatchBoxscore,
    matchId: args.matchId,
    userId: args.userId,
  });
  if (cached) {
    return cached.boxscore;
  }

  try {
    const live = await args.bb.getBoxScore(args.matchId);
    const stored = toStoredMatchBoxscore({
      boxscore: live,
      source: "MATCH_BOXSCORE_CACHE",
    });
    if (stored) {
      await args.upsertMatchBoxscore(args.env, {
        boxscoreJson: stored,
        fetchedAt: live.retrievedAt ?? new Date().toISOString(),
        matchId: stored.matchId,
        userId: args.userId,
      });
    }
    return live;
  } catch {
    return null;
  }
}

function computeLeagueAverageRatings(
  snapshots: readonly PersistedTeamSnapshot[],
): TeamRatings {
  const usable = snapshots
    .map((snapshot) => getSnapshotEffectiveRatings(snapshot))
    .filter((ratings): ratings is TeamRatings => Boolean(ratings));
  if (!usable.length) {
    return { ...DEFAULT_NEUTRAL_RATINGS };
  }

  const totals = createZeroRatings();
  for (const ratings of usable) {
    for (const key of TEAM_RATING_KEYS) {
      totals[key] += ratings[key];
    }
  }

  const result = createZeroRatings();
  for (const key of TEAM_RATING_KEYS) {
    result[key] = totals[key] / usable.length;
  }
  return result;
}

function applySnapshotModifiers(args: {
  modifiers: readonly SeasonSimulationTeamModifier[];
  snapshots: readonly PersistedTeamSnapshot[];
  teams: readonly TeamStanding[];
}): PersistedTeamSnapshot[] {
  const teamIds = new Set(args.teams.map((team) => team.teamId));
  const modifierByTeamId = new Map(
    args.modifiers.map((modifier) => [modifier.teamId, modifier] as const),
  );
  const unknownTeamIds = Array.from(modifierByTeamId.keys()).filter(
    (teamId) => !teamIds.has(teamId),
  );
  if (unknownTeamIds.length) {
    throw new Error(
      `Snapshot modifiers referenced unknown league team id${unknownTeamIds.length === 1 ? "" : "s"}: ${unknownTeamIds.join(", ")}.`,
    );
  }

  return args.snapshots.map((snapshot) => {
    const baselineRatings = snapshot.normalizedRatings
      ? { ...snapshot.normalizedRatings }
      : null;
    const ratingModifiers = normalizeRatingModifiers(
      modifierByTeamId.get(snapshot.teamId)?.ratings,
    );
    return {
      ...snapshot,
      effectiveRatings: baselineRatings
        ? addRatingModifiers(baselineRatings, ratingModifiers)
        : null,
      normalizedRatings: baselineRatings,
      ratingModifiers,
    };
  });
}

function addRatingModifiers(
  ratings: TeamRatings,
  modifiers: TeamRatings,
): TeamRatings {
  const adjusted = createZeroRatings();
  for (const key of TEAM_RATING_KEYS) {
    adjusted[key] = Math.max(0, ratings[key] + modifiers[key]);
  }
  return adjusted;
}

function getSnapshotEffectiveRatings(
  snapshot: PersistedTeamSnapshot,
): TeamRatings | null {
  return snapshot.effectiveRatings ?? snapshot.normalizedRatings ?? null;
}

function finalizeFallbackSnapshots(
  snapshots: readonly PersistedTeamSnapshot[],
  leagueAverage: TeamRatings,
): PersistedTeamSnapshot[] {
  return snapshots.map((snapshot) => {
    if (snapshot.normalizedRatings) {
      return snapshot;
    }

    return {
      ...snapshot,
      normalizedRatings: { ...leagueAverage },
      sourceDefense: snapshot.sourceDefense || "ManToMan",
      sourceOffense: snapshot.sourceOffense || "Base",
      sampleWarning:
        snapshot.sampleWarning ??
        "No usable historical games were found, so this projection falls back to league-average ratings.",
    };
  });
}

function buildDeterministicExpectedOutcomes(args: {
  scoredGames: readonly ScoredRemainingGame[];
  snapshots: readonly PersistedTeamSnapshot[];
}): DeterministicExpectedOutcomes {
  const expectedWins = args.snapshots.map((snapshot) => snapshot.currentWins);
  const expectedLosses = args.snapshots.map((snapshot) => snapshot.currentLosses);
  const expectedPointMargins = args.snapshots.map(
    (snapshot) => snapshot.currentPointMargin,
  );

  for (const game of args.scoredGames) {
    expectedWins[game.homeTeamIndex] =
      (expectedWins[game.homeTeamIndex] ?? 0) + game.homeWinProbability;
    expectedWins[game.awayTeamIndex] =
      (expectedWins[game.awayTeamIndex] ?? 0) + (1 - game.homeWinProbability);
    expectedLosses[game.homeTeamIndex] =
      (expectedLosses[game.homeTeamIndex] ?? 0) + (1 - game.homeWinProbability);
    expectedLosses[game.awayTeamIndex] =
      (expectedLosses[game.awayTeamIndex] ?? 0) + game.homeWinProbability;
    expectedPointMargins[game.homeTeamIndex] =
      (expectedPointMargins[game.homeTeamIndex] ?? 0) + game.expectedMargin;
    expectedPointMargins[game.awayTeamIndex] =
      (expectedPointMargins[game.awayTeamIndex] ?? 0) - game.expectedMargin;
  }

  return {
    expectedLosses,
    expectedPointMargins,
    expectedWins,
  };
}

async function scoreRemainingGames(args: {
  endpointName: string;
  games: readonly RemainingLeagueGame[];
  gameIndexes?: readonly number[];
  invokePredictionRuntime: ProcessDependencies["invokePredictionRuntime"];
  leagueAverage: TeamRatings;
  plannerBatchConcurrency: number;
  residualSigma: number;
  snapshots: readonly PersistedTeamSnapshot[];
  updateProgress: (completedUnits: number) => Promise<void>;
}): Promise<ScoredRemainingGame[]> {
  const snapshotByTeamId = new Map(
    args.snapshots.map((snapshot, index) => [snapshot.teamId, { index, snapshot }] as const),
  );
  const teamRemainingOrder = buildTeamRemainingOrder(args.games);
  const pairDefinitions = buildPlannerPairDefinitions();
  const plannerRequests = args.games.map((game) => {
    const homeRecord = snapshotByTeamId.get(game.homeTeamId);
    const awayRecord = snapshotByTeamId.get(game.awayTeamId);
    if (!homeRecord || !awayRecord) {
      throw new Error("A remaining game could not be matched to league team snapshots.");
    }

    const homeRegressionRatio = computeFutureRegressionRatio({
      gameIndex:
        teamRemainingOrder.byTeamId.get(game.homeTeamId)?.get(game.matchId) ?? 0,
      totalGames: teamRemainingOrder.countByTeamId.get(game.homeTeamId) ?? 1,
    });
    const awayRegressionRatio = computeFutureRegressionRatio({
      gameIndex:
        teamRemainingOrder.byTeamId.get(game.awayTeamId)?.get(game.matchId) ?? 0,
      totalGames: teamRemainingOrder.countByTeamId.get(game.awayTeamId) ?? 1,
    });
    const homeNormalized = regressRatingsTowardAverage(
      getSnapshotEffectiveRatings(homeRecord.snapshot) ?? args.leagueAverage,
      args.leagueAverage,
      homeRegressionRatio,
    );
    const awayNormalized = regressRatingsTowardAverage(
      getSnapshotEffectiveRatings(awayRecord.snapshot) ?? args.leagueAverage,
      args.leagueAverage,
      awayRegressionRatio,
    );
    const homePairs = buildSeasonSimulationPlannerPairs({
      normalizedRatings: homeNormalized,
      pairDefinitions,
    });
    const awayPairs = buildSeasonSimulationPlannerPairs({
      normalizedRatings: awayNormalized,
      pairDefinitions,
    });
    const forecastAwayPairId = buildPlannerPairId(
      awayRecord.snapshot.sourceOffense,
      awayRecord.snapshot.sourceDefense,
    );
    return {
      awayPairs,
      awayTeamIndex: awayRecord.index,
      forecastAwayPairId,
      game,
      homePairs,
      homeTeamIndex: homeRecord.index,
      requestId: game.matchId,
      requestPayload: buildSeasonSimulationPlannerRequest({
        awayPairs,
        forecastAwayPairId,
        homePairs,
      }),
    };
  });

  const selectedPlannerRequests = args.gameIndexes
    ? args.gameIndexes
        .map((index) => plannerRequests[index])
        .filter(
          (request): request is (typeof plannerRequests)[number] =>
            Boolean(request),
        )
    : plannerRequests;

  const scoredResponses = await invokePlannerRequests({
    concurrency: args.plannerBatchConcurrency,
    endpointName: args.endpointName,
    invokePredictionEndpoint: args.invokePredictionRuntime,
    parseResponse: (payload) =>
      predictionPlannerExpectedOnlyResponseSchema.parse(payload),
    onRequestCompleted: async (result) => {
      await args.updateProgress(result.completedCount);
    },
    requests: selectedPlannerRequests.map((request) => ({
      payload: request.requestPayload,
      requestId: request.requestId,
    })),
  });
  const responseByRequestId = new Map(
    scoredResponses.map((response) => [response.requestId, response] as const),
  );

  return selectedPlannerRequests.map((request) => {
    const response = responseByRequestId.get(request.requestId);
    if (!response) {
      throw new Error(
        `Missing planner response for remaining game '${request.requestId}'.`,
      );
    }

    const minimaxResult =
      selectMinimaxPlannerResult({
        awayPairs: request.awayPairs,
        homePairs: request.homePairs,
        view: response.response.expectedMatrix,
      }) ??
      selectFirstAvailablePlannerResult({
        awayPairs: request.awayPairs,
        homePairs: request.homePairs,
        view: response.response.expectedMatrix,
      });
    if (!minimaxResult) {
      throw new Error(
        `No usable planner matrix cells were returned for remaining game '${request.requestId}'.`,
      );
    }

    const expectedMargin = minimaxResult.cell.predictedPointDiff ?? 0;
    return {
      ...request.game,
      awayDefense: minimaxResult.awayPair.defense,
      awayOffense: minimaxResult.awayPair.offense,
      awayTeamIndex: request.awayTeamIndex,
      expectedAwayScore: minimaxResult.cell.predictedOpponentScore ?? 0,
      expectedHomeScore: minimaxResult.cell.predictedTeamScore ?? 0,
      expectedMargin,
      homeDefense: minimaxResult.homePair.defense,
      homeOffense: minimaxResult.homePair.offense,
      homeTeamIndex: request.homeTeamIndex,
      homeWinProbability: computeHomeWinProbability(
        expectedMargin,
        args.residualSigma,
      ),
      modelVersion:
        normalizeOptionalString(response.response.modelVersion) ??
        normalizeOptionalString(response.response.modelKey),
    };
  });
}

function buildSeasonSimulationPlannerPairs(args: {
  normalizedRatings: TeamRatings;
  pairDefinitions: ReturnType<typeof buildPlannerPairDefinitions>;
}): SeasonSimulationPlannerPair[] {
  return args.pairDefinitions.map((pair) => ({
    defense: pair.predictorDefense,
    offense: pair.predictorOffense,
    pairId: pair.pairId,
    ratings: { ...args.normalizedRatings },
  }));
}

function buildSeasonSimulationPlannerRequest(args: {
  awayPairs: readonly SeasonSimulationPlannerPair[];
  forecastAwayPairId: string;
  homePairs: readonly SeasonSimulationPlannerPair[];
}): Record<string, unknown> {
  const fallbackAwayPairId = args.awayPairs[0]?.pairId ?? "Base__ManToMan";
  const forecastAwayPairId = args.awayPairs.some(
    (pair) => pair.pairId === args.forecastAwayPairId,
  )
    ? args.forecastAwayPairId
    : fallbackAwayPairId;
  return {
    plannerRequest: {
      effortChoices: [
        {
          cost: 1,
          label: "Normal",
          value: 0,
        },
      ],
      matrixOurEffort: 0,
      neutralSite: false,
      opponentScenarios: [
        {
          forecastPairId: forecastAwayPairId,
          label: "Remaining matchup",
          opponentEffort: 0,
          opponentPairs: args.awayPairs.map((pair) => ({
            defense: pair.defense,
            offense: pair.offense,
            pairId: pair.pairId,
            ratings: pair.ratings,
          })),
          probability: 1,
          scenarioId: "remaining-matchup",
        },
      ],
      ourIsHome: true,
      responseMode: "EXPECTED_ONLY",
      ourPairs: args.homePairs.map((pair) => ({
        defense: pair.defense,
        offense: pair.offense,
        pairId: pair.pairId,
        ratings: pair.ratings,
      })),
    },
  };
}

function buildPlannerPairId(offense: string, defense: string): string {
  return `${offense}__${defense}`;
}

function normalizeSeasonSimulationProcessError(error: unknown): Error {
  if (isPredictionRuntimeResponseTooLargeError(error)) {
    const normalized = new Error(
      SEASON_SIMULATION_RESPONSE_TOO_LARGE_ERROR_MESSAGE,
    ) as Error & { cause?: Error };
    if (error instanceof Error) {
      normalized.cause = error;
    }
    return normalized;
  }

  return error instanceof Error ? error : new Error(String(error));
}

function selectMinimaxPlannerResult(args: {
  awayPairs: readonly SeasonSimulationPlannerPair[];
  homePairs: readonly SeasonSimulationPlannerPair[];
  view: {
    rows: ReadonlyArray<{
      cells: ReadonlyArray<{
        available: boolean;
        ourPairId: string;
        opponentPairId: string;
        predictedOpponentScore: number | null;
        predictedPointDiff: number | null;
        predictedTeamScore: number | null;
      }>;
      opponentPairId: string;
    }>;
  };
}): SeasonSimulationPlannerSelection | null {
  if (!args.homePairs.length || !args.awayPairs.length) {
    return null;
  }

  const rowsByAwayPairId = new Map(
    args.view.rows.map((row) => [row.opponentPairId, row] as const),
  );
  let recommendation:
    | (SeasonSimulationPlannerSelection & {
        averageMargin: number;
        worstCaseMargin: number;
      })
    | null = null;

  for (const homePair of args.homePairs) {
    let worstCase: SeasonSimulationPlannerSelection | null = null;
    let marginSum = 0;
    let marginCount = 0;

    for (const awayPair of args.awayPairs) {
      const row = rowsByAwayPairId.get(awayPair.pairId);
      const cell =
        row?.cells.find((candidate) => candidate.ourPairId === homePair.pairId) ??
        null;
      if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
        continue;
      }

      marginSum += cell.predictedPointDiff;
      marginCount += 1;
      if (
        !worstCase ||
        cell.predictedPointDiff <
          (worstCase.cell.predictedPointDiff ?? Number.POSITIVE_INFINITY)
      ) {
        worstCase = {
          awayPair,
          cell,
          homePair,
        };
      }
    }

    if (!worstCase || marginCount === 0) {
      continue;
    }

    const worstCaseMargin =
      worstCase.cell.predictedPointDiff ?? Number.NEGATIVE_INFINITY;
    const averageMargin = marginSum / marginCount;
    if (
      !recommendation ||
      worstCaseMargin > recommendation.worstCaseMargin ||
      (worstCaseMargin === recommendation.worstCaseMargin &&
        averageMargin > recommendation.averageMargin)
    ) {
      recommendation = {
        ...worstCase,
        averageMargin,
        worstCaseMargin,
      };
    }
  }

  return recommendation
    ? {
        awayPair: recommendation.awayPair,
        cell: recommendation.cell,
        homePair: recommendation.homePair,
      }
    : null;
}

function selectFirstAvailablePlannerResult(args: {
  awayPairs: readonly SeasonSimulationPlannerPair[];
  homePairs: readonly SeasonSimulationPlannerPair[];
  view: {
    rows: ReadonlyArray<{
      cells: ReadonlyArray<{
        available: boolean;
        ourPairId: string;
        opponentPairId: string;
        predictedOpponentScore: number | null;
        predictedPointDiff: number | null;
        predictedTeamScore: number | null;
      }>;
      opponentPairId: string;
    }>;
  };
}): SeasonSimulationPlannerSelection | null {
  const homePairById = new Map(
    args.homePairs.map((pair) => [pair.pairId, pair] as const),
  );
  const awayPairById = new Map(
    args.awayPairs.map((pair) => [pair.pairId, pair] as const),
  );

  for (const row of args.view.rows) {
    const awayPair = awayPairById.get(row.opponentPairId);
    if (!awayPair) {
      continue;
    }
    for (const cell of row.cells) {
      if (!cell.available || typeof cell.predictedPointDiff !== "number") {
        continue;
      }
      const homePair = homePairById.get(cell.ourPairId);
      if (!homePair) {
        continue;
      }
      return {
        awayPair,
        cell,
        homePair,
      };
    }
  }

  return null;
}

export function runSeasonMonteCarlo(args: {
  deterministicExpectations: DeterministicExpectedOutcomes;
  leagueId: string;
  leagueName: string | null;
  random: () => number;
  residualSigma: number;
  scenarioKey: string;
  scoredGames: readonly ScoredRemainingGame[];
  season: number;
  simulationCount: number;
  snapshots: readonly PersistedTeamSnapshot[];
}): SimulationStoredResult {
  const normalSample = createNormalSampler(args.random);
  const conferenceTeamIndexes = groupTeamIndexesByConference(args.snapshots);
  const accumulators = args.snapshots.map<SimulationTeamAccumulator>(
    (snapshot) => ({
      finishCounts: Array(
        Math.max(
          1,
          conferenceTeamIndexes.get(snapshot.conferenceIndex)?.length ?? 1,
        ),
      ).fill(0),
      finishTotal: 0,
      firstPlaceCount: 0,
      sampledWins: [],
    }),
  );
  const baseWins = args.snapshots.map((snapshot) => snapshot.currentWins);
  const baseLosses = args.snapshots.map((snapshot) => snapshot.currentLosses);
  const baseMargins = args.snapshots.map((snapshot) => snapshot.currentPointMargin);
  const conferenceGroups = Array.from(conferenceTeamIndexes.values());

  for (let simulationIndex = 0; simulationIndex < args.simulationCount; simulationIndex += 1) {
    const wins = [...baseWins];
    const losses = [...baseLosses];
    const margins = [...baseMargins];

    for (const game of args.scoredGames) {
      const sampledMargin =
        game.expectedMargin + args.residualSigma * normalSample();
      if (sampledMargin >= 0) {
        wins[game.homeTeamIndex] = (wins[game.homeTeamIndex] ?? 0) + 1;
        losses[game.awayTeamIndex] = (losses[game.awayTeamIndex] ?? 0) + 1;
      } else {
        wins[game.awayTeamIndex] = (wins[game.awayTeamIndex] ?? 0) + 1;
        losses[game.homeTeamIndex] = (losses[game.homeTeamIndex] ?? 0) + 1;
      }
      margins[game.homeTeamIndex] =
        (margins[game.homeTeamIndex] ?? 0) + sampledMargin;
      margins[game.awayTeamIndex] =
        (margins[game.awayTeamIndex] ?? 0) - sampledMargin;
    }

    for (const indexes of conferenceGroups) {
      const rankedIndexes = rankConferenceTeamIndexes({
        pointMargins: margins,
        stableRanks: args.snapshots.map((snapshot) => snapshot.stableRank),
        teamIndexes: indexes,
        wins,
      });

      for (let finishIndex = 0; finishIndex < rankedIndexes.length; finishIndex += 1) {
        const teamIndex = rankedIndexes[finishIndex]!;
        const accumulator = accumulators[teamIndex]!;
        accumulator.finishCounts[finishIndex] =
          (accumulator.finishCounts[finishIndex] ?? 0) + 1;
        accumulator.finishTotal += finishIndex + 1;
        if (finishIndex === 0) {
          accumulator.firstPlaceCount += 1;
        }
      }
    }

    for (let teamIndex = 0; teamIndex < args.snapshots.length; teamIndex += 1) {
      const accumulator = accumulators[teamIndex]!;
      accumulator.sampledWins.push(wins[teamIndex] ?? 0);
    }
  }

  const conferences = new Map<number, SimulationTeamResult[]>();
  for (let index = 0; index < args.snapshots.length; index += 1) {
    const snapshot = args.snapshots[index]!;
    const accumulator = accumulators[index]!;
    const finishProbabilities = accumulator.finishCounts.map(
      (count, finishIndex): SimulationFinishProbability => ({
        place: finishIndex + 1,
        probability: count / args.simulationCount,
      }),
    );
    const teamResult: SimulationTeamResult = {
      averageFinish: accumulator.finishTotal / args.simulationCount,
      currentLosses: snapshot.currentLosses,
      currentPointMargin: snapshot.currentPointMargin,
      currentWins: snapshot.currentWins,
      expectedLosses: args.deterministicExpectations.expectedLosses[index] ?? 0,
      expectedPointMargin:
        args.deterministicExpectations.expectedPointMargins[index] ?? 0,
      expectedWins: args.deterministicExpectations.expectedWins[index] ?? 0,
      finishProbabilities,
      firstPlaceProbability:
        accumulator.firstPlaceCount / args.simulationCount,
      snapshot: {
        candidateGameCount: snapshot.candidateGameCount,
        defense: snapshot.sourceDefense,
        effectiveRatings: getSnapshotEffectiveRatings(snapshot),
        offense: snapshot.sourceOffense,
        ratingModifiers: normalizeRatingModifiers(snapshot.ratingModifiers),
        ratings: snapshot.normalizedRatings,
        sampleWarning: snapshot.sampleWarning,
        selectionStrategy: snapshot.selectionStrategy,
        sourceMatchId: snapshot.sourceMatchId,
        sourceSeason: snapshot.sourceSeason,
        sourceStartTime: snapshot.sourceStartTime,
        teamId: snapshot.teamId,
        teamName: snapshot.teamName,
      },
      standingsIndex: snapshot.stableRank,
      teamId: snapshot.teamId,
      teamName: snapshot.teamName,
      winsP10: computeWinsPercentile(accumulator.sampledWins, 0.1),
      winsP50: computeWinsPercentile(accumulator.sampledWins, 0.5),
      winsP90: computeWinsPercentile(accumulator.sampledWins, 0.9),
    };
    const existing = conferences.get(snapshot.conferenceIndex) ?? [];
    existing.push(teamResult);
    conferences.set(snapshot.conferenceIndex, existing);
  }

  return {
    conferences: Array.from(conferences.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([conferenceIndex, teams]) => ({
        conferenceIndex,
        teams: [...teams].sort(
          (left, right) =>
            right.expectedWins - left.expectedWins ||
            right.expectedPointMargin - left.expectedPointMargin ||
            left.standingsIndex - right.standingsIndex,
        ),
      })),
    generatedAt: new Date().toISOString(),
    leagueId: args.leagueId,
    leagueName: args.leagueName,
    lowSampleTeamCount: args.snapshots.filter((snapshot) =>
      Boolean(snapshot.sampleWarning),
    ).length,
    modelVersion:
      args.scoredGames.find((game) => Boolean(game.modelVersion))?.modelVersion ??
      "season-sim-v1",
    remainingGames: args.scoredGames.map<SimulationGameResult>((game) => ({
      awayDefense: game.awayDefense,
      awayOffense: game.awayOffense,
      awayTeamId: game.awayTeamId,
      awayTeamName: game.awayTeamName,
      expectedAwayScore: game.expectedAwayScore,
      expectedHomeScore: game.expectedHomeScore,
      expectedMargin: game.expectedMargin,
      homeDefense: game.homeDefense,
      homeOffense: game.homeOffense,
      homeTeamId: game.homeTeamId,
      homeTeamName: game.homeTeamName,
      homeWinProbability: game.homeWinProbability,
      matchId: game.matchId,
      startTime: game.startTime,
    })),
    residualSigma: args.residualSigma,
    scenarioKey: args.scenarioKey,
    season: args.season,
    simulationCount: args.simulationCount,
  };
}

export function buildSeasonBackfillOrder(
  currentSeason: number,
  seasons: Pick<BBApiSeasons, "seasons">,
): number[] {
  const ordered = new Set<number>([currentSeason]);
  for (const season of seasons.seasons) {
    const id = asFiniteInteger(season.id);
    if (id !== null && id <= currentSeason) {
      ordered.add(id);
    }
  }
  return Array.from(ordered).sort((left, right) => right - left);
}

export function buildRemainingRegularSeasonLeagueGames(args: {
  schedulesByTeamId: Map<string, BBApiSchedule>;
}): RemainingLeagueGame[] {
  const byMatchId = new Map<string, RemainingLeagueGame>();
  const schedules = Array.from(args.schedulesByTeamId.values());
  for (const schedule of schedules) {
    for (const match of schedule.matches) {
      if (!isRemainingRegularSeasonLeagueMatch(match)) {
        continue;
      }
      const matchId = normalizeOptionalString(match.id);
      const homeTeamId = normalizeOptionalString(match.homeTeam.id);
      const awayTeamId = normalizeOptionalString(match.awayTeam.id);
      if (!matchId || !homeTeamId || !awayTeamId) {
        continue;
      }
      const existing = byMatchId.get(matchId);
      byMatchId.set(matchId, {
        awayTeamId,
        awayTeamName:
          normalizeOptionalString(existing?.awayTeamName) ??
          normalizeOptionalString(match.awayTeam.teamName),
        homeTeamId,
        homeTeamName:
          normalizeOptionalString(existing?.homeTeamName) ??
          normalizeOptionalString(match.homeTeam.teamName),
        matchId,
        startTime:
          normalizeOptionalString(existing?.startTime) ??
          normalizeOptionalString(match.startTime),
      });
    }
  }

  return Array.from(byMatchId.values()).sort((left, right) =>
    compareNullableTimestamps(left.startTime, right.startTime),
  );
}

function buildLeagueSeasonSlateCoverage(args: {
  expectedGamesPerTeam?: number;
  remainingGames: readonly RemainingLeagueGame[];
  teams: readonly TeamStanding[];
}): LeagueSeasonSlateCoverage {
  const expectedGamesPerTeam =
    args.expectedGamesPerTeam ?? EXPECTED_REGULAR_SEASON_GAMES_PER_TEAM;
  const remainingGamesByTeamId = new Map<string, number>(
    args.teams.map((team) => [team.teamId, 0] as const),
  );

  for (const game of args.remainingGames) {
    if (remainingGamesByTeamId.has(game.homeTeamId)) {
      remainingGamesByTeamId.set(
        game.homeTeamId,
        (remainingGamesByTeamId.get(game.homeTeamId) ?? 0) + 1,
      );
    }
    if (remainingGamesByTeamId.has(game.awayTeamId)) {
      remainingGamesByTeamId.set(
        game.awayTeamId,
        (remainingGamesByTeamId.get(game.awayTeamId) ?? 0) + 1,
      );
    }
  }

  const issues = args.teams
    .map<LeagueSeasonSlateCoverageIssue>((team) => {
      const currentGames = Math.max(0, team.currentWins + team.currentLosses);
      const remainingGames = remainingGamesByTeamId.get(team.teamId) ?? 0;
      return {
        currentGames,
        expectedGames: expectedGamesPerTeam,
        remainingGames,
        teamId: team.teamId,
        teamName: team.teamName,
        totalGames: currentGames + remainingGames,
      };
    })
    .filter((issue) => issue.totalGames !== expectedGamesPerTeam);

  return {
    expectedGamesPerTeam,
    issues,
    teamCount: args.teams.length,
  };
}

function assertCompleteLeagueSeasonSlateCoverage(args: {
  expectedGamesPerTeam?: number;
  remainingGames: readonly RemainingLeagueGame[];
  teams: readonly TeamStanding[];
}): void {
  const coverage = buildLeagueSeasonSlateCoverage(args);
  if (coverage.issues.length) {
    throw new Error(formatLeagueSeasonSlateCoverageError(coverage));
  }
}

function formatLeagueSeasonSlateCoverageError(
  coverage: LeagueSeasonSlateCoverage,
): string {
  const sample = coverage.issues
    .slice(0, 5)
    .map((issue) => {
      const label = issue.teamName
        ? `${issue.teamName} (${issue.teamId})`
        : issue.teamId;
      return `${label}: ${issue.currentGames} current + ${issue.remainingGames} remaining = ${issue.totalGames}`;
    })
    .join("; ");
  const suffix =
    coverage.issues.length > 5
      ? `; ${coverage.issues.length - 5} more teams`
      : "";
  return `League season simulation slate coverage is incomplete. Expected ${coverage.expectedGamesPerTeam} regular-season games per team, but ${coverage.issues.length} of ${coverage.teamCount} teams did not match. ${sample}${suffix}`;
}

export function selectSeasonSimulationSnapshotCandidate(
  candidates: readonly SnapshotCandidate[],
): SnapshotCandidate | null {
  if (!candidates.length) {
    return null;
  }
  return candidates[SNAPSHOT_SELECTION_INDEX] ?? candidates[0] ?? null;
}

export function selectPreferredSeasonSimulationSnapshotCandidate(args: {
  candidates: readonly SnapshotCandidate[];
  currentSeason: number;
}): {
  candidate: SnapshotCandidate | null;
  strategy:
    | "BEST_AVAILABLE"
    | "CURRENT_SEASON_15TH_PERCENTILE"
    | "LEAGUE_AVERAGE_FALLBACK"
    | "MULTI_SEASON_THIRD_BEST";
} {
  const currentSeasonCandidates = args.candidates
    .filter((candidate) => candidate.season === args.currentSeason)
    .sort(
      (left, right) =>
        left.normalizedScalar - right.normalizedScalar ||
        compareNullableTimestamps(left.startTime, right.startTime) ||
        left.matchId.localeCompare(right.matchId),
    );
  if (currentSeasonCandidates.length >= 3) {
    const percentileIndex = Math.max(
      0,
      Math.ceil(currentSeasonCandidates.length * 0.15) - 1,
    );
    return {
      candidate: currentSeasonCandidates[percentileIndex] ?? null,
      strategy: "CURRENT_SEASON_15TH_PERCENTILE",
    };
  }

  const fallbackCandidate = selectSeasonSimulationSnapshotCandidate(args.candidates);
  if (!fallbackCandidate) {
    return {
      candidate: null,
      strategy: "LEAGUE_AVERAGE_FALLBACK",
    };
  }

  return {
    candidate: fallbackCandidate,
    strategy:
      args.candidates.length >= 3 ? "MULTI_SEASON_THIRD_BEST" : "BEST_AVAILABLE",
  };
}

export function computeFutureRegressionRatio(args: {
  gameIndex: number;
  totalGames: number;
}): number {
  if (args.totalGames <= 1 || args.gameIndex <= 0) {
    return 0;
  }

  const span = Math.max(1, args.totalGames - 1);
  return Math.min(MAX_FUTURE_REGRESSION, (args.gameIndex / span) * MAX_FUTURE_REGRESSION);
}

export function rankConferenceTeamIndexes(args: {
  pointMargins: readonly number[];
  stableRanks: readonly number[];
  teamIndexes: readonly number[];
  wins: readonly number[];
}): number[] {
  return [...args.teamIndexes].sort(
    (left, right) =>
      (args.wins[right] ?? 0) - (args.wins[left] ?? 0) ||
      (args.pointMargins[right] ?? 0) - (args.pointMargins[left] ?? 0) ||
      (args.stableRanks[left] ?? 0) - (args.stableRanks[right] ?? 0),
  );
}

function buildQueuedProgress(requestedAt: string): SimulationStoredProgress {
  return {
    completedPhases: [],
    completedUnits: null,
    context: null,
    currentPhaseStartedAt: requestedAt,
    phaseCount: SIMULATION_PHASES.length,
    phaseIndex: 0,
    phaseKey: "QUEUED",
    summary: "Waiting for the season simulator worker.",
    totalUnits: null,
    unitLabel: null,
    updatedAt: requestedAt,
  };
}

function advanceProgress(args: {
  completedUnits?: number | null;
  context?: SimulationProgressContext | null;
  currentPhaseStartedAt?: string | null;
  currentProgress: SimulationStoredProgress;
  nextPhaseKey: SimulationPhaseKey;
  summary: string;
  totalUnits?: number | null;
  unitLabel?: string | null;
  updatedAt: string;
}): SimulationStoredProgress {
  const nextPhaseIndex = Math.max(
    0,
    SIMULATION_PHASES.indexOf(args.nextPhaseKey),
  );
  const previousPhaseKey = args.currentProgress.phaseKey;
  const completedPhases = [...args.currentProgress.completedPhases];

  if (
    previousPhaseKey !== "QUEUED" &&
    previousPhaseKey !== "FAILED" &&
    previousPhaseKey !== "SUCCEEDED" &&
    previousPhaseKey !== args.nextPhaseKey &&
    args.currentProgress.currentPhaseStartedAt
  ) {
    completedPhases.push({
      completedAt: args.updatedAt,
      durationMs: Math.max(
        0,
        Date.parse(args.updatedAt) -
          Date.parse(args.currentProgress.currentPhaseStartedAt),
      ),
      phaseKey: previousPhaseKey,
      startedAt: args.currentProgress.currentPhaseStartedAt,
      summary: args.currentProgress.summary,
    } satisfies SimulationCompletedPhase);
  }

  return {
    completedPhases,
    completedUnits:
      args.completedUnits ?? args.currentProgress.completedUnits ?? null,
    context:
      args.context === undefined ? args.currentProgress.context ?? null : args.context,
    currentPhaseStartedAt:
      args.nextPhaseKey === args.currentProgress.phaseKey
        ? args.currentProgress.currentPhaseStartedAt
        : args.currentPhaseStartedAt ?? args.updatedAt,
    phaseCount: SIMULATION_PHASES.length,
    phaseIndex: nextPhaseIndex,
    phaseKey: args.nextPhaseKey,
    summary: args.summary,
    totalUnits: args.totalUnits ?? args.currentProgress.totalUnits ?? null,
    unitLabel: args.unitLabel ?? args.currentProgress.unitLabel ?? null,
    updatedAt: args.updatedAt,
  };
}

function buildCompletedProgress(args: {
  currentProgress: SimulationStoredProgress;
  result: SimulationStoredResult;
  updatedAt: string;
}): SimulationStoredProgress {
  const completed = advanceProgress({
    context: {
      candidateGameCount: args.result.conferences.reduce(
        (sum, conference) =>
          sum +
          conference.teams.reduce(
            (teamSum, team) => teamSum + team.snapshot.candidateGameCount,
            0,
          ),
        0,
      ),
      currentSeason: args.result.season,
      lowSampleTeamCount: args.result.lowSampleTeamCount,
      remainingGameCount: args.result.remainingGames.length,
      scoredGameCount: args.result.remainingGames.length,
      simulationCount: args.result.simulationCount,
      teamCount: args.result.conferences.reduce(
        (sum, conference) => sum + conference.teams.length,
        0,
      ),
    },
    currentProgress: args.currentProgress,
    nextPhaseKey: "SUCCEEDED",
    summary: "Projected final standings are ready.",
    updatedAt: args.updatedAt,
  });

  return {
    ...completed,
    completedUnits: args.result.simulationCount,
    currentPhaseStartedAt: null,
    totalUnits: args.result.simulationCount,
    unitLabel: "sims",
  };
}

function buildFailedProgress(args: {
  currentProgress: SimulationStoredProgress;
  errorMessage: string;
  updatedAt: string;
}): SimulationStoredProgress {
  const failed = advanceProgress({
    currentProgress: args.currentProgress,
    nextPhaseKey: "FAILED",
    summary: args.errorMessage,
    updatedAt: args.updatedAt,
  });
  return {
    ...failed,
    currentPhaseStartedAt: null,
  };
}

function adaptSimulationJob(job: LeagueSeasonSimulationJobRecord): SimulationSnapshot {
  return {
    completedAt: job.completedAt ?? null,
    error: job.error ?? null,
    executionArn: job.executionArn ?? null,
    jobId: job.id,
    leagueId: job.leagueId,
    leagueName: job.leagueName ?? null,
    progress:
      job.progressJson ??
      buildProgressFromStatus({
        completedAt: job.completedAt ?? null,
        requestedAt: job.requestedAt,
        startedAt: job.startedAt ?? null,
        status: job.status,
      }),
    requestedAt: job.requestedAt,
    result: job.resultJson ?? null,
    season: job.season,
    status: normalizeSimulationStatus(job.status),
    teamId: job.teamId,
    teamName: job.teamName ?? null,
  };
}

function buildProgressFromStatus(args: {
  completedAt: string | null;
  requestedAt: string;
  startedAt: string | null;
  status: string;
}): SimulationStoredProgress {
  const normalizedStatus = normalizeSimulationStatus(args.status);
  if (normalizedStatus === "QUEUED") {
    return buildQueuedProgress(args.requestedAt);
  }

  return {
    completedPhases: [],
    completedUnits: null,
    context: null,
    currentPhaseStartedAt:
      normalizedStatus === "FAILED" || normalizedStatus === "SUCCEEDED"
        ? null
        : args.startedAt ?? args.requestedAt,
    phaseCount: SIMULATION_PHASES.length,
    phaseIndex: Math.max(0, SIMULATION_PHASES.indexOf(normalizedStatus)),
    phaseKey: normalizedStatus,
    summary:
      normalizedStatus === "FAILED"
        ? "The most recent simulation run failed."
        : normalizedStatus === "SUCCEEDED"
          ? "Projected final standings are ready."
          : "Season simulation is still running.",
    totalUnits: null,
    unitLabel: null,
    updatedAt: args.completedAt ?? args.startedAt ?? args.requestedAt,
  };
}

async function reconcileActiveSimulationExecution(args: {
  deps: GetLatestDependencies;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
}): Promise<LeagueSeasonSimulationJobRecord> {
  if (
    isTerminalSimulationStatus(args.job.status) ||
    !normalizeOptionalString(args.job.executionArn)
  ) {
    return args.job;
  }

  let execution: StateMachineExecutionDescription;
  try {
    execution = await args.deps.describeWorkflowExecution(args.job.executionArn!);
  } catch {
    return args.job;
  }

  if (!isTerminalWorkflowExecutionStatus(execution.status)) {
    return args.job;
  }

  const completedAt = execution.stopDate ?? new Date().toISOString();
  const errorMessage =
    execution.status === "SUCCEEDED"
      ? "Workflow execution finished before the simulation result was persisted."
      : normalizeWorkflowExecutionFailureMessage(execution);
  const reconciled: LeagueSeasonSimulationJobRecord = {
    ...args.job,
    completedAt,
    error: errorMessage,
    progressJson: buildFailedProgress({
      currentProgress:
        args.job.progressJson ?? buildQueuedProgress(args.job.requestedAt),
      errorMessage,
      updatedAt: completedAt,
    }),
    status: "FAILED",
  };
  await args.deps.updateLeagueSeasonSimulationJob(args.env, {
    completedAt: reconciled.completedAt,
    error: reconciled.error,
    id: reconciled.id,
    progressJson: reconciled.progressJson,
    status: reconciled.status,
  });
  return reconciled;
}

async function loadSimulationJobForUser(args: {
  deps: Pick<ProcessDependencies, "getLeagueSeasonSimulationJob">;
  env: GraphqlEnv;
  jobId: string;
  userId: string;
}): Promise<LeagueSeasonSimulationJobRecord> {
  const job = await args.deps.getLeagueSeasonSimulationJob(args.env, args.jobId);
  if (!job || job.userId !== args.userId) {
    throw new Error(
      "League season simulation job is missing or no longer belongs to the enqueued user.",
    );
  }
  return job;
}

function normalizeSimulationWorkerEvent(
  event: LeagueSeasonSimulationWorkerEvent,
): LeagueSeasonSimulationWorkerEvent {
  const jobId = normalizeOptionalString(event.jobId);
  const userId = normalizeOptionalString(event.userId);
  if (!jobId || !userId) {
    throw new Error("League season simulation worker payload is invalid.");
  }
  return {
    action: event.action,
    jobId,
    nextGameIndex: asFiniteInteger(event.nextGameIndex) ?? null,
    nextTeamIndex: asFiniteInteger(event.nextTeamIndex) ?? null,
    userId,
  };
}

async function loadSimulationContextArtifact(args: {
  deps: Pick<ProcessDependencies, "artifactStore">;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
}): Promise<SimulationContextArtifact> {
  const artifact = await args.deps.artifactStore.get(args.env, {
    artifactKey: "context",
    artifactType: "CONTEXT",
    jobId: args.job.id,
  });
  if (!artifact) {
    throw new Error("League season simulation context artifact is missing.");
  }
  if (!artifact.contextPayload) {
    throw new Error(
      "League season simulation context artifact payload is missing.",
    );
  }
  return normalizeSimulationContextArtifact(artifact.contextPayload);
}

async function loadPersistedSnapshots(
  args: {
    deps: Pick<ProcessDependencies, "artifactStore">;
    env: GraphqlEnv;
    job: LeagueSeasonSimulationJobRecord;
  },
  artifactType: "SNAPSHOT" | "FINALIZED_SNAPSHOT",
): Promise<PersistedTeamSnapshot[]> {
  const artifacts = await listAllSimulationArtifactsByType(args, artifactType);
  return artifacts.map((artifact) => {
    if (!artifact.snapshotPayload) {
      throw new Error(
        "League season simulation snapshot artifact payload is missing.",
      );
    }
    return normalizePersistedTeamSnapshot(artifact.snapshotPayload);
  });
}

async function loadScoredGameArtifacts(args: {
  deps: Pick<ProcessDependencies, "artifactStore">;
  env: GraphqlEnv;
  job: LeagueSeasonSimulationJobRecord;
}): Promise<ScoredRemainingGame[]> {
  const artifacts = await listAllSimulationArtifactsByType(args, "SCORED_GAME");
  return artifacts.map((artifact) => {
    if (!artifact.scoredGamePayload) {
      throw new Error(
        "League season simulation scored game artifact payload is missing.",
      );
    }
    return normalizeScoredRemainingGame(artifact.scoredGamePayload);
  });
}

async function listAllSimulationArtifactsByType(
  args: {
    deps: Pick<ProcessDependencies, "artifactStore">;
    env: GraphqlEnv;
    job: LeagueSeasonSimulationJobRecord;
  },
  artifactType: SimulationArtifactType,
): Promise<LeagueSeasonSimulationArtifactRecord[]> {
  const records: LeagueSeasonSimulationArtifactRecord[] = [];
  let nextToken: string | null = null;
  do {
    const page = await args.deps.artifactStore.listByJobId(
      args.env,
      args.job.id,
      {
        limit: 200,
        nextToken,
      },
    );
    records.push(
      ...page.records.filter((record) => record.artifactType === artifactType),
    );
    nextToken = page.nextToken;
  } while (nextToken);

  return records.sort((left, right) => left.artifactOrder - right.artifactOrder);
}

async function writeSimulationArtifact(
  args: SimulationArtifactWriteArgs,
): Promise<void> {
  await args.deps.artifactStore.upsert(args.env, {
    artifactKey: args.key,
    artifactOrder: args.order,
    artifactType: args.type,
    ...buildSimulationArtifactPayloadFields(args),
    expiresAt: args.job.expiresAt,
    expiryKey: args.job.expiryKey,
    jobId: args.job.id,
    userId: args.job.userId,
  });
}

function buildSimulationArtifactPayloadFields(
  args: SimulationArtifactWriteArgs,
): Pick<
  LeagueSeasonSimulationArtifactRecord,
  "contextPayload" | "scoredGamePayload" | "snapshotPayload"
> {
  if (args.type === "CONTEXT") {
    return { contextPayload: args.payload };
  }
  if (args.type === "SCORED_GAME") {
    return { scoredGamePayload: args.payload };
  }
  return { snapshotPayload: args.payload };
}

function buildProgressContext(args: {
  candidateGameCount: number;
  currentSeason: number;
  lowSampleTeamCount: number;
  remainingGameCount: number;
  scoredGameCount: number;
  teamCount: number;
}): SimulationProgressContext {
  return {
    ...args,
    simulationCount: DEFAULT_SIMULATION_COUNT,
  };
}

function toPersistedTeamSnapshot(
  snapshot: SelectedTeamSnapshot,
): PersistedTeamSnapshot {
  const { candidates: _candidates, ...persisted } = snapshot;
  return persisted;
}

function normalizeSimulationContextArtifact(
  value: unknown,
): SimulationContextArtifact {
  const record = requireRecord(value, "league season simulation context");
  return {
    candidateGameCount: asFiniteInteger(record.candidateGameCount) ?? 0,
    currentSeason: asFiniteInteger(record.currentSeason) ?? 0,
    leagueId: normalizeRequiredString(record.leagueId, "A context league id"),
    leagueName: normalizeOptionalString(record.leagueName),
    remainingGames: requireArray(record.remainingGames).map(
      normalizeRemainingLeagueGame,
    ),
    teamCount: asFiniteInteger(record.teamCount) ?? 0,
    teams: requireArray(record.teams).map(normalizeTeamStanding),
  };
}

function normalizePersistedTeamSnapshot(value: unknown): PersistedTeamSnapshot {
  const record = requireRecord(value, "league season simulation snapshot");
  return {
    ...normalizeTeamStanding(record),
    candidateGameCount: asFiniteInteger(record.candidateGameCount) ?? 0,
    effectiveRatings: normalizeTeamRatings(record.effectiveRatings),
    normalizedRatings: normalizeTeamRatings(record.normalizedRatings),
    ratingModifiers: normalizeRatingModifiers(record.ratingModifiers),
    sampleWarning: normalizeOptionalString(record.sampleWarning),
    selectionStrategy: normalizeSnapshotSelectionStrategy(
      record.selectionStrategy,
    ),
    sourceDefense:
      normalizeOptionalString(record.sourceDefense) ?? "ManToMan",
    sourceMatchId: normalizeOptionalString(record.sourceMatchId),
    sourceOffense: normalizeOptionalString(record.sourceOffense) ?? "Base",
    sourceSeason: asFiniteInteger(record.sourceSeason),
    sourceStartTime: normalizeOptionalString(record.sourceStartTime),
  };
}

function normalizeScoredRemainingGame(value: unknown): ScoredRemainingGame {
  const record = requireRecord(value, "league season simulation scored game");
  return {
    ...normalizeRemainingLeagueGame(record),
    awayDefense: normalizeOptionalString(record.awayDefense) ?? "ManToMan",
    awayOffense: normalizeOptionalString(record.awayOffense) ?? "Base",
    awayTeamIndex: asFiniteInteger(record.awayTeamIndex) ?? 0,
    expectedAwayScore: asFiniteNumber(record.expectedAwayScore) ?? 0,
    expectedHomeScore: asFiniteNumber(record.expectedHomeScore) ?? 0,
    expectedMargin: asFiniteNumber(record.expectedMargin) ?? 0,
    homeDefense: normalizeOptionalString(record.homeDefense) ?? "ManToMan",
    homeOffense: normalizeOptionalString(record.homeOffense) ?? "Base",
    homeTeamIndex: asFiniteInteger(record.homeTeamIndex) ?? 0,
    homeWinProbability: asFiniteNumber(record.homeWinProbability) ?? 0.5,
    modelVersion: normalizeOptionalString(record.modelVersion),
  };
}

function normalizeTeamStanding(value: unknown): TeamStanding {
  const record = requireRecord(value, "league team standing");
  return {
    conferenceIndex: asFiniteInteger(record.conferenceIndex) ?? 0,
    currentLosses: asFiniteInteger(record.currentLosses) ?? 0,
    currentPointMargin: asFiniteNumber(record.currentPointMargin) ?? 0,
    currentWins: asFiniteInteger(record.currentWins) ?? 0,
    stableRank: asFiniteInteger(record.stableRank) ?? 0,
    teamId: normalizeRequiredString(record.teamId, "A team id"),
    teamName: normalizeOptionalString(record.teamName),
  };
}

function normalizeRemainingLeagueGame(value: unknown): RemainingLeagueGame {
  const record = requireRecord(value, "remaining league game");
  return {
    awayTeamId: normalizeRequiredString(record.awayTeamId, "An away team id"),
    awayTeamName: normalizeOptionalString(record.awayTeamName),
    homeTeamId: normalizeRequiredString(record.homeTeamId, "A home team id"),
    homeTeamName: normalizeOptionalString(record.homeTeamName),
    matchId: normalizeRequiredString(record.matchId, "A match id"),
    startTime: normalizeOptionalString(record.startTime),
  };
}

function normalizeTeamRatings(value: unknown): TeamRatings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const ratings = createZeroRatings();
  for (const key of TEAM_RATING_KEYS) {
    const rating = asFiniteNumber(record[key]);
    if (rating === null) {
      return null;
    }
    ratings[key] = rating;
  }
  return ratings;
}

function normalizeTeamModifiers(value: unknown): SeasonSimulationTeamModifier[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("snapshotModifiers must be an array.");
  }

  const byTeamId = new Map<string, SeasonSimulationTeamModifier>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Each snapshot modifier must be an object.");
    }
    const record = entry as Record<string, unknown>;
    const teamId = normalizeOptionalString(record.teamId);
    if (!teamId) {
      throw new Error("Each snapshot modifier must include a teamId.");
    }
    const ratings = normalizeRatingModifiers(record.ratings);
    if (hasNonZeroModifier(ratings)) {
      byTeamId.set(teamId, { ratings, teamId });
    } else {
      byTeamId.delete(teamId);
    }
  }

  return Array.from(byTeamId.values()).sort((left, right) =>
    left.teamId.localeCompare(right.teamId),
  );
}

function normalizeRatingModifiers(value: unknown): TeamRatings {
  if (value === undefined || value === null) {
    return createZeroRatings();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Snapshot modifier ratings must be an object.");
  }

  const record = value as Record<string, unknown>;
  const modifiers = createZeroRatings();
  for (const key of TEAM_RATING_KEYS) {
    const raw = record[key];
    if (raw === undefined || raw === null || raw === "") {
      modifiers[key] = 0;
      continue;
    }
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Snapshot modifier '${key}' must be a finite number.`);
    }
    modifiers[key] = parsed;
  }
  return modifiers;
}

function hasNonZeroModifier(modifiers: TeamRatings): boolean {
  return TEAM_RATING_KEYS.some((key) => modifiers[key] !== 0);
}

function buildScenarioKey(
  modifiers: readonly SeasonSimulationTeamModifier[],
): string {
  if (!modifiers.length) {
    return "baseline";
  }
  const canonical = JSON.stringify(
    modifiers.map((modifier) => ({
      ratings: Object.fromEntries(
        TEAM_RATING_KEYS.map((key) => [key, modifier.ratings[key] ?? 0]),
      ),
      teamId: modifier.teamId,
    })),
  );
  return `scenario-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

function readJobSnapshotModifiers(
  job: LeagueSeasonSimulationJobRecord,
): SeasonSimulationTeamModifier[] {
  return normalizeTeamModifiers(job.requestJson?.snapshotModifiers ?? []);
}

function getJobScenarioKey(job: LeagueSeasonSimulationJobRecord): string {
  return (
    normalizeOptionalString(job.scenarioKey) ??
    normalizeOptionalString(job.requestJson?.scenarioKey) ??
    "baseline"
  );
}

function normalizeSnapshotSelectionStrategy(
  value: unknown,
): PersistedTeamSnapshot["selectionStrategy"] {
  switch (value) {
    case "BEST_AVAILABLE":
    case "CURRENT_SEASON_15TH_PERCENTILE":
    case "LEAGUE_AVERAGE_FALLBACK":
    case "MULTI_SEASON_THIRD_BEST":
      return value;
    default:
      return "BEST_AVAILABLE";
  }
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function shouldYieldForRemainingTime(
  remainingTimeInMillis: (() => number) | undefined,
): boolean {
  return Boolean(
    remainingTimeInMillis &&
      remainingTimeInMillis() <= MIN_SAFE_REMAINING_TIME_MS,
  );
}

function clampIndex(value: number | null | undefined, length: number): number {
  const index = typeof value === "number" && Number.isInteger(value) ? value : 0;
  return Math.min(Math.max(0, index), Math.max(0, length));
}

function createSeededRng(seed: string): () => number {
  const digest = createHash("sha256").update(seed).digest();
  let state = digest.readUInt32LE(0) || 0x9e3779b9;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isTerminalSimulationStatus(
  status: LeagueSeasonSimulationJobRecord["status"],
): boolean {
  return status === "SUCCEEDED" || status === "FAILED";
}

function isTerminalWorkflowExecutionStatus(status: string): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "TIMED_OUT" ||
    status === "ABORTED"
  );
}

function normalizeWorkflowExecutionFailureMessage(
  execution: StateMachineExecutionDescription,
): string {
  const details = [execution.error, execution.cause]
    .map(normalizeOptionalString)
    .filter((value): value is string => Boolean(value));
  if (!details.length) {
    return `League season simulation workflow ended with status ${execution.status}.`;
  }
  return details.join(": ");
}

function extractWorkflowFailureMessage(error: unknown): string {
  if (!error) {
    return "League season simulation workflow failed.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const errorName = normalizeOptionalString(record.Error);
    const cause = normalizeOptionalString(record.Cause);
    if (errorName || cause) {
      return [errorName, cause].filter(Boolean).join(": ");
    }
  }
  return String(error);
}

function buildTeamRemainingOrder(games: readonly RemainingLeagueGame[]): {
  byTeamId: Map<string, Map<string, number>>;
  countByTeamId: Map<string, number>;
} {
  const byTeamId = new Map<string, Map<string, number>>();
  const countByTeamId = new Map<string, number>();

  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      const order = byTeamId.get(teamId) ?? new Map<string, number>();
      order.set(game.matchId, order.size);
      byTeamId.set(teamId, order);
      countByTeamId.set(teamId, order.size);
    }
  }

  return {
    byTeamId,
    countByTeamId,
  };
}

function groupTeamIndexesByConference(
  snapshots: readonly PersistedTeamSnapshot[],
): Map<number, number[]> {
  const grouped = new Map<number, number[]>();
  snapshots.forEach((snapshot, index) => {
    const current = grouped.get(snapshot.conferenceIndex) ?? [];
    current.push(index);
    grouped.set(snapshot.conferenceIndex, current);
  });
  return grouped;
}

function flattenStandings(standings: BBApiStandings): TeamStanding[] {
  return standings.conferences.flatMap((conference, conferenceIndex) =>
    conference.teams
      .filter((team) => normalizeOptionalString(team.id))
      .map((team, standingsIndex) => ({
        conferenceIndex: conference.index ?? conferenceIndex,
        currentLosses: asFiniteInteger(team.losses) ?? 0,
        currentPointMargin: (asFiniteNumber(team.pf) ?? 0) - (asFiniteNumber(team.pa) ?? 0),
        currentWins: asFiniteInteger(team.wins) ?? 0,
        stableRank: standingsIndex,
        teamId: normalizeRequiredString(team.id, "A standings team id"),
        teamName: normalizeOptionalString(team.teamName),
      })),
  );
}

function createZeroRatings(): TeamRatings {
  return {
    insideDefense: 0,
    insideScoring: 0,
    offensiveFlow: 0,
    outsideDefense: 0,
    outsideScoring: 0,
    rebounding: 0,
  };
}

function regressRatingsTowardAverage(
  ratings: TeamRatings,
  leagueAverage: TeamRatings,
  ratio: number,
): TeamRatings {
  const adjusted = createZeroRatings();
  for (const key of TEAM_RATING_KEYS) {
    adjusted[key] = ratings[key] * (1 - ratio) + leagueAverage[key] * ratio;
  }
  return adjusted;
}

function resolveSimulationJobMessage(args: {
  message?: { jobId: string; userId: string };
  messageBody?: string;
}): { jobId: string; userId: string } {
  if (args.message) {
    return args.message;
  }
  if (!args.messageBody) {
    throw new Error("League season simulation job payload was not provided.");
  }

  const parsed = safeJsonParse(args.messageBody);
  const jobId = normalizeOptionalString(parsed?.jobId);
  const userId = normalizeOptionalString(parsed?.userId);
  if (!jobId || !userId) {
    throw new Error("League season simulation job payload is invalid.");
  }
  return {
    jobId,
    userId,
  };
}

function isUsableSnapshotMatch(
  match: BBApiScheduleMatch,
  teamId: string,
): boolean {
  return (
    isCompletedMatch(match) &&
    matchIncludesTeam(match, teamId) &&
    !isScrimmageLike(match.type)
  );
}

function isRemainingRegularSeasonLeagueMatch(match: BBApiScheduleMatch): boolean {
  return Boolean(
    isLeagueRegularSeasonCompetition(match.type) &&
      !isCompletedMatch(match),
  );
}

function isCompletedMatch(match: BBApiScheduleMatch): boolean {
  return (
    typeof match.homeTeam.score === "number" &&
    typeof match.awayTeam.score === "number"
  );
}

function resolvePredictionTeamLocation(args: {
  boxscore: BBApiBoxScore;
  teamLocation: PredictionTeamLocation;
}): PredictionTeamLocation {
  return args.boxscore.neutral ? "AWAY" : args.teamLocation;
}

function buildSnapshotSampleWarning(candidateCount: number): string | null {
  if (candidateCount === 0) {
    return "No usable historical games were found, so this projection falls back to league-average ratings.";
  }
  if (candidateCount < 3) {
    return `Very sparse sample: only ${candidateCount} usable historical game${candidateCount === 1 ? "" : "s"} were found, so the simulator uses the best available snapshot.`;
  }
  if (candidateCount < MAX_SNAPSHOT_CANDIDATES) {
    return `Small historical sample: only ${candidateCount} usable historical games were found across the available seasons.`;
  }
  return null;
}

function computeHomeWinProbability(expectedMargin: number, sigma: number): number {
  if (!Number.isFinite(sigma) || sigma <= 0) {
    if (expectedMargin > 0) {
      return 1;
    }
    if (expectedMargin < 0) {
      return 0;
    }
    return 0.5;
  }
  return normalCdf(expectedMargin / sigma);
}

function computeWinsPercentile(
  sampledWins: readonly number[],
  percentile: number,
): number {
  if (!sampledWins.length) {
    return 0;
  }

  const normalizedPercentile = Math.min(Math.max(percentile, 0), 1);
  const sorted = [...sampledWins].sort((left, right) => left - right);
  const position = (sorted.length - 1) * normalizedPercentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = sorted[lowerIndex] ?? 0;
  const upperValue = sorted[upperIndex] ?? lowerValue;
  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  const ratio = position - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * ratio;
}

function createNormalSampler(random: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }

    let u = 0;
    let v = 0;
    while (u === 0) {
      u = random();
    }
    while (v === 0) {
      v = random();
    }
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absolute);
  const polynomial =
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);
  return sign * (1 - polynomial * Math.exp(-absolute * absolute));
}

function toPredictorOffense(value: unknown): string {
  const normalized = normalizeOptionalString(value);
  return normalized ? (OFFENSE_TO_PREDICTOR[normalized] ?? "Base") : "Base";
}

function toPredictorDefense(value: unknown): string {
  const normalized = normalizeOptionalString(value);
  return normalized ? (DEFENSE_TO_PREDICTOR[normalized] ?? "ManToMan") : "ManToMan";
}

function sumRatings(ratings: TeamRatings): number {
  return TEAM_RATING_KEYS.reduce((sum, key) => sum + ratings[key], 0);
}

function resolveSeasonSimulationRuntimeConfig(
  env: GraphqlEnv,
): SeasonSimulationRuntimeConfig {
  return {
    plannerBatchConcurrency: parsePositiveIntegerRuntimeEnv(
      env[LEAGUE_SEASON_SIMULATION_PLANNER_CONCURRENCY_ENV_NAME],
      DEFAULT_PLANNER_BATCH_CONCURRENCY,
    ),
  };
}

async function resolveCurrentLeagueSeason(args: {
  client: Pick<BBXmlApiClient, "getSchedule" | "getSeasons">;
  teamId: string;
}): Promise<number> {
  const latestSeason = resolveLatestSeasonId(await args.client.getSeasons());
  const schedule = await args.client.getSchedule(args.teamId, latestSeason);
  return resolveEffectiveCurrentSeason({
    fallbackSeason: latestSeason,
    schedule,
  });
}

function parsePositiveIntegerRuntimeEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSimulationStatus(value: string): SimulationSnapshot["status"] {
  switch (value) {
    case "QUEUED":
    case "RESOLVING_CONTEXT":
    case "COLLECTING_SNAPSHOTS":
    case "SCORING_GAMES":
    case "RUNNING_SIMULATIONS":
    case "SUCCEEDED":
    case "FAILED":
      return value;
    default:
      return "FAILED";
  }
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (concurrency <= 1) {
    const results: TResult[] = [];
    for (let index = 0; index < items.length; index += 1) {
      results.push(await mapper(items[index]!, index));
    }
    return results;
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) {
          return;
        }
        results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
      }
    }),
  );

  return results;
}

function compareMatchesByStartTimeDescending(
  left: BBApiScheduleMatch,
  right: BBApiScheduleMatch,
): number {
  return compareNullableTimestamps(right.startTime, left.startTime);
}

function compareNullableTimestamps(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftValue = left ? Date.parse(left) : Number.NaN;
  const rightValue = right ? Date.parse(right) : Number.NaN;
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return leftValue - rightValue;
  }
  if (Number.isFinite(leftValue)) {
    return -1;
  }
  if (Number.isFinite(rightValue)) {
    return 1;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function safeJsonParse(
  value: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function asFiniteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const numberFormatter = new Intl.NumberFormat("en-US");

export const __testing = {
  buildDeterministicExpectedOutcomes,
  buildLeagueSeasonSlateCoverage,
  buildRemainingRegularSeasonLeagueGames,
  buildSeasonSimulationPlannerRequest,
  buildSeasonBackfillOrder,
  computeFutureRegressionRatio,
  computeHomeWinProbability,
  rankConferenceTeamIndexes,
  resolveSeasonSimulationRuntimeConfig,
  runSeasonMonteCarlo,
  selectPreferredSeasonSimulationSnapshotCandidate,
  selectSeasonSimulationSnapshotCandidate,
  selectMinimaxPlannerResult,
};
