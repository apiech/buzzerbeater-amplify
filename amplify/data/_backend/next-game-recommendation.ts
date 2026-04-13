import { randomUUID } from "node:crypto";

import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

import {
  POSITION_SEQUENCE,
  normalizeDefensiveSwitch,
  validateDefensiveSwitch,
} from "../../../lib/coach-parrot";
import {
  predictionEndpointResponseSchema,
  predictionPlannerResponseSchema,
  type PredictionEndpointResponse,
  type PredictionPlannerResponse,
} from "../../../lib/prediction/contracts";
import { normalizePlannerEndpointInvocationError } from "../../../lib/prediction/planner-endpoint-errors";
import {
  applyPredictionRatingsContext,
  normalizePredictionRatingsFromBoxscore,
  type PredictionInputShape,
  type PredictionTeamLocation,
} from "../../../lib/prediction/normalization";
import type { TeamRatings } from "../../../lib/buzzerbeater/team-ratings";
import type { Schema } from "../resource";
import { PositionCode } from "../schema-enums";
import { requireFeatureAccess } from "./billing";
import {
  getLineupHelperWorkspace,
  optimizeLineupHelper,
} from "./lineup-helper";
import { assertMaintenanceInactive, toMaintenanceAwareErrorMessage } from "./maintenance";
import { selectBoxscorePerspective } from "./neutral-boxscore";
import { normalizeOpponentForecastResult } from "./opponent-forecast";
import {
  deleteNextGamePlannerArtifact,
  deleteNextGamePlannerArtifactRow,
  createNextGameRecommendationJob,
  getMatchBoxscore,
  getNextGameRecommendationJob,
  getNextGamePlannerArtifact,
  listNextGameRecommendationJobsByUser,
  listNextGamePlannerArtifactRowsByArtifactKey,
  listOpponentForecastJobsByUser,
  upsertNextGamePlannerArtifact,
  upsertNextGamePlannerArtifactRows,
  updateNextGameRecommendationJob,
  type NextGamePlannerArtifactRecord,
  type NextGamePlannerArtifactRowRecord,
  type NextGameRecommendationJobRecord,
  type OpponentForecastJobRecord,
} from "./repository";
import { buildExecutionName, startStateMachineExecution } from "./step-functions";
import { inflateStoredMatchBoxscore } from "./stored-boxscore";
import { getOrRefreshWorkspace, getScoutTeamSummaryForTeam } from "./workspace";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;
type RecommendationSwitch = {
  pg: PositionCode;
  sg: PositionCode;
  sf: PositionCode;
  pf: PositionCode;
  c: PositionCode;
};
type RecommendationInput = {
  enthusiasm: number;
  defensiveSwitch: RecommendationSwitch;
};

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type RecommendationSnapshot = ResolverResult<"getLatestNextGameRecommendation">;
type RecommendationResult = NonNullable<RecommendationSnapshot["result"]>;
type PlannerDetail = ResolverResult<"getNextGamePlannerDetail">;
type RecommendedGamePlan = RecommendationResult["bestExpectedPlan"];
type RecommendedLineupRow = RecommendedGamePlan["lineup"][number];
type PlannerEvaluatedScenario = RecommendationResult["evaluatedScenarios"][number];
type PlannerTacticPair = NonNullable<PlannerDetail["ourPairs"]>[number];
type PlannerMatrixView = NonNullable<PlannerDetail["views"]>[number];
type PlannerMatrixRow = PlannerMatrixView["rows"][number];
type PlannerMatrixCell = PlannerMatrixRow["cells"][number];
type LineupHelperWorkspace = ResolverResult<"getLineupHelperWorkspace">;
type LineupHelperRosterPlayer = LineupHelperWorkspace["roster"][number];
type LineupHelperEvaluation = ResolverResult<"optimizeLineupHelper">;
type ScoutWorkspaceShape = Awaited<
  ReturnType<typeof getScoutTeamSummaryForTeam>
>["scout"];
type OpponentForecastScenario = NonNullable<
  NonNullable<ResolverResult<"getLatestOpponentForecast">["result"]>["topScenarios"][number]
>;

type SubmitDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createNextGameRecommendationJob: typeof createNextGameRecommendationJob;
  getMatchBoxscore: typeof getMatchBoxscore;
  getOrRefreshWorkspace: typeof getOrRefreshWorkspace;
  getScoutTeamSummaryForTeam: typeof getScoutTeamSummaryForTeam;
  listOpponentForecastJobsByUser: typeof listOpponentForecastJobsByUser;
  requireFeatureAccess: typeof requireFeatureAccess;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: { jobId: string; userId: string },
  ) => Promise<string>;
  updateNextGameRecommendationJob: typeof updateNextGameRecommendationJob;
};

type GetLatestDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  getMatchBoxscore: typeof getMatchBoxscore;
  getOrRefreshWorkspace: typeof getOrRefreshWorkspace;
  getScoutTeamSummaryForTeam: typeof getScoutTeamSummaryForTeam;
  listNextGameRecommendationJobsByUser: typeof listNextGameRecommendationJobsByUser;
  listOpponentForecastJobsByUser: typeof listOpponentForecastJobsByUser;
};

type GetDetailDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  getNextGamePlannerArtifact: typeof getNextGamePlannerArtifact;
  listNextGamePlannerArtifactRowsByArtifactKey:
    typeof listNextGamePlannerArtifactRowsByArtifactKey;
};

type ProcessDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  deleteNextGamePlannerArtifact: typeof deleteNextGamePlannerArtifact;
  deleteNextGamePlannerArtifactRow: typeof deleteNextGamePlannerArtifactRow;
  getLineupHelperWorkspace: typeof getLineupHelperWorkspace;
  getMatchBoxscore: typeof getMatchBoxscore;
  getNextGameRecommendationJob: typeof getNextGameRecommendationJob;
  getOrRefreshWorkspace: typeof getOrRefreshWorkspace;
  getScoutTeamSummaryForTeam: typeof getScoutTeamSummaryForTeam;
  invokePredictionEndpoint: (
    endpointName: string,
    payload: JsonRecord,
  ) => Promise<PredictionEndpointResponse | PredictionPlannerResponse>;
  listNextGamePlannerArtifactRowsByArtifactKey:
    typeof listNextGamePlannerArtifactRowsByArtifactKey;
  listOpponentForecastJobsByUser: typeof listOpponentForecastJobsByUser;
  optimizeLineupHelper: typeof optimizeLineupHelper;
  upsertNextGamePlannerArtifact: typeof upsertNextGamePlannerArtifact;
  upsertNextGamePlannerArtifactRows: typeof upsertNextGamePlannerArtifactRows;
  updateNextGameRecommendationJob: typeof updateNextGameRecommendationJob;
};

type RecommendationContext = {
  nextMatch: NonNullable<ResolverResult<"getHomeWorkspace">["nextMatch"]>;
  opponentTeamId: string;
  opponentTeamName: string;
  scout: ScoutWorkspaceShape;
};

type ForecastContext = {
  job: OpponentForecastJobRecord;
  result: NonNullable<ResolverResult<"getLatestOpponentForecast">["result"]>;
  scenarios: OpponentForecastScenario[];
};

type OpponentSourceContext = {
  matchId: string;
  normalizedRatings: TeamRatings;
  teamLocation: PredictionTeamLocation;
};

type PredictorPerspective = {
  payload: JsonRecord;
  teamIsHome: boolean;
};

type PlannerSupportTier = "DIRECT" | "ESTIMATED";
type PlannerPairDefinition = {
  displayDefense: string;
  displayOffense: string;
  pairId: string;
  predictorDefense: string;
  predictorOffense: string;
  supportTier: PlannerSupportTier;
};

type PlannerScenarioContext = {
  effortChoice: string;
  evidence: string[];
  forecastPairId: string;
  label: string;
  normalizedProbability: number;
  opponentEffort: number;
  opponentPairs: Array<
    PlannerPairDefinition & {
      ratings: TeamRatings;
    }
  >;
  probability: number;
  scenarioId: string;
};

type PlannerOurPairContext = PlannerPairDefinition & {
  lineup: RecommendedLineupRow[];
  ratings: TeamRatings;
};

type CandidateScenarioResult = {
  available: boolean;
  predictedOpponentScore: number | null;
  predictedPointDiff: number | null;
  predictedTeamScore: number | null;
  scenarioId: string;
};

type Candidate = {
  defense: string;
  effortChoice: string;
  effortCost: number;
  effortValue: number;
  floorPointDiff: number;
  ceilingPointDiff: number;
  lineup: RecommendedLineupRow[];
  offense: string;
  pairId: string;
  predictedOpponentScore: number;
  predictedPointDiff: number;
  predictedTeamScore: number;
  scenarioResults: CandidateScenarioResult[];
  weightedExpectedPointDiff: number;
  winProbability: number;
};

const DEFAULT_ENTHUSIASM = 8;
const TARGET_EFFICIENT_MARGIN = 10;
const MAX_JOB_PAGES = 4;
const RECOMMENDATION_PAGE_SIZE = 50;
const PREDICTION_CONCURRENCY = 8;
const DEFAULT_PREDICTION_GDP = "N/A";
const MATRIX_DEFAULT_EFFORT = 0;
const MAX_EVALUATED_SCENARIOS = 3;
const EFFORT_CHOICES = [
  { label: "Take It Easy", value: -1, cost: 0 },
  { label: "Normal", value: 0, cost: 1 },
  { label: "Crunch Time", value: 1, cost: 2 },
] as const;

const PLANNER_OFFENSE_OPTIONS = [
  "Base",
  "Push",
  "Patient",
  "Motion",
  "RunAndGun",
  "Princeton",
  "LookInside",
  "LowPost",
  "InsideIsolation",
  "OutsideIsolation",
] as const;

const PLANNER_DEFENSE_OPTIONS = [
  "ManToMan",
  "23Zone",
  "32Zone",
  "131Zone",
  "InsideBoxAndOne",
  "OutsideBoxAndOne",
  "Press",
] as const;

const OFFENSE_TO_PREDICTOR: Record<string, string> = {
  Base: "Base",
  "Base Offense": "Base",
  Push: "Push",
  "Push the Ball": "Push",
  Patient: "Patient",
  "Look Inside": "LookInside",
  LookInside: "LookInside",
  "Low Post": "LowPost",
  LowPost: "LowPost",
  Motion: "Motion",
  "Run and Gun": "RunAndGun",
  RunAndGun: "RunAndGun",
  Princeton: "Princeton",
  InsideIsolation: "LookInside",
  OutsideIsolation: "Motion",
};

const DEFENSE_TO_PREDICTOR: Record<string, string> = {
  ManToMan: "ManToMan",
  "Man to man": "ManToMan",
  "23Zone": "23Zone",
  "2-3 Zone": "23Zone",
  "32Zone": "32Zone",
  "3-2 Zone": "32Zone",
  "131Zone": "131Zone",
  "1-3-1 Zone": "131Zone",
  Press: "Press",
  "Full Court Press": "Press",
  InsideBoxAndOne: "23Zone",
  OutsideBoxAndOne: "32Zone",
};

const defaultSubmitDependencies: SubmitDependencies = {
  assertMaintenanceInactive,
  createNextGameRecommendationJob,
  getMatchBoxscore,
  getOrRefreshWorkspace,
  getScoutTeamSummaryForTeam,
  listOpponentForecastJobsByUser,
  requireFeatureAccess,
  startWorkflowExecution: async (stateMachineArn, executionName, message) =>
    startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    }),
  updateNextGameRecommendationJob,
};

const defaultGetLatestDependencies: GetLatestDependencies = {
  assertMaintenanceInactive,
  getMatchBoxscore,
  getOrRefreshWorkspace,
  getScoutTeamSummaryForTeam,
  listNextGameRecommendationJobsByUser,
  listOpponentForecastJobsByUser,
};

const defaultGetDetailDependencies: GetDetailDependencies = {
  assertMaintenanceInactive,
  getNextGamePlannerArtifact,
  listNextGamePlannerArtifactRowsByArtifactKey,
};

const defaultProcessDependencies: ProcessDependencies = {
  assertMaintenanceInactive,
  deleteNextGamePlannerArtifact,
  deleteNextGamePlannerArtifactRow,
  getLineupHelperWorkspace,
  getMatchBoxscore,
  getNextGameRecommendationJob,
  getOrRefreshWorkspace,
  getScoutTeamSummaryForTeam,
  invokePredictionEndpoint,
  listNextGamePlannerArtifactRowsByArtifactKey,
  listOpponentForecastJobsByUser,
  optimizeLineupHelper,
  upsertNextGamePlannerArtifact,
  upsertNextGamePlannerArtifactRows,
  updateNextGameRecommendationJob,
};

export const __testing = {
  adaptPredictionResultToUserPerspective,
  buildPredictorPerspective,
  buildPlannerPairDefinitions,
  computeRecommendationStale,
  effortChoiceToOrdinal,
  jobMatchesRecommendationSettings,
  normalizeRecommendationInput,
  selectBestExpectedCandidate,
  selectSafestCandidate,
  selectBiggestWinCandidate,
  selectEfficientWinCandidate,
};

export async function submitNextGameRecommendationJob(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    input: unknown;
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

  const normalizedInput = normalizeRecommendationInput(args.input);
  const context = await resolveRecommendationContext({
    env: args.env,
    getOrRefreshWorkspace: deps.getOrRefreshWorkspace,
    getScoutTeamSummaryForTeam: deps.getScoutTeamSummaryForTeam,
    identity: args.identity,
  });
  await resolveLatestForecastContext({
    env: args.env,
    listOpponentForecastJobsByUser: deps.listOpponentForecastJobsByUser,
    opponentTeamId: context.opponentTeamId,
    userId,
  });
  await resolveOpponentSourceContext({
    env: args.env,
    getMatchBoxscore: deps.getMatchBoxscore,
    recentGames: context.scout.summary?.recentGames ?? [],
    teamId: context.opponentTeamId,
    userId,
  });

  const jobId = randomUUID();
  await deps.createNextGameRecommendationJob(args.env, {
    id: jobId,
    userId,
    matchId: context.nextMatch.matchId ?? "",
    opponentTeamId: context.opponentTeamId,
    opponentTeamName: context.opponentTeamName,
    enthusiasm: normalizedInput.enthusiasm,
    switchPg: normalizedInput.defensiveSwitch.pg,
    switchSg: normalizedInput.defensiveSwitch.sg,
    switchSf: normalizedInput.defensiveSwitch.sf,
    switchPf: normalizedInput.defensiveSwitch.pf,
    switchC: normalizedInput.defensiveSwitch.c,
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: {
      input: normalizedInput,
      matchId: context.nextMatch.matchId ?? "",
      opponentTeamId: context.opponentTeamId,
      opponentTeamName: context.opponentTeamName,
    },
    resultJson: null,
    error: null,
    executionArn: null,
  });

  try {
    const executionArn = await deps.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName("next-game-recommendation", jobId),
      { jobId, userId },
    );
    await deps.updateNextGameRecommendationJob(args.env, {
      id: jobId,
      executionArn,
    });
    return { executionArn, jobId };
  } catch (error) {
    await deps.updateNextGameRecommendationJob(args.env, {
      id: jobId,
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function getLatestNextGameRecommendation(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    input: unknown;
  },
  dependencies: Partial<GetLatestDependencies> = {},
): Promise<RecommendationSnapshot | null> {
  const deps = {
    ...defaultGetLatestDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const normalizedInput = normalizeRecommendationInput(args.input);
  const context = await resolveRecommendationContext({
    env: args.env,
    getOrRefreshWorkspace: deps.getOrRefreshWorkspace,
    getScoutTeamSummaryForTeam: deps.getScoutTeamSummaryForTeam,
    identity: args.identity,
  });
  const forecast = await resolveLatestForecastContext({
    env: args.env,
    listOpponentForecastJobsByUser: deps.listOpponentForecastJobsByUser,
    opponentTeamId: context.opponentTeamId,
    userId,
  });
  await resolveOpponentSourceContext({
    env: args.env,
    getMatchBoxscore: deps.getMatchBoxscore,
    recentGames: context.scout.summary?.recentGames ?? [],
    teamId: context.opponentTeamId,
    userId,
  });

  let nextToken: string | null = null;
  for (let pageIndex = 0; pageIndex < MAX_JOB_PAGES; pageIndex += 1) {
    const page = await deps.listNextGameRecommendationJobsByUser(args.env, userId, {
      limit: RECOMMENDATION_PAGE_SIZE,
      nextToken,
    });
    const match = page.records.find((job) =>
      jobMatchesRecommendationSettings(job, {
        defensiveSwitch: normalizedInput.defensiveSwitch,
        enthusiasm: normalizedInput.enthusiasm,
        matchId: context.nextMatch.matchId ?? "",
        opponentTeamId: context.opponentTeamId,
      }),
    );
    if (match) {
      return adaptRecommendationJob(match, {
        stale: computeRecommendationStale(
          readStoredForecastJobId(match.resultJson),
          forecast.job.id,
        ),
      });
    }
    nextToken = page.nextToken;
    if (!nextToken) {
      break;
    }
  }

  return null;
}

export async function getNextGamePlannerDetail(
  args: {
    artifactKey: string;
    env: GraphqlEnv;
    identity: unknown;
  },
  dependencies: Partial<GetDetailDependencies> = {},
): Promise<PlannerDetail | null> {
  const deps = {
    ...defaultGetDetailDependencies,
    ...dependencies,
  };
  await deps.assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const artifact = await deps.getNextGamePlannerArtifact(args.env, args.artifactKey);
  if (!artifact || artifact.userId !== userId) {
    return null;
  }

  const rows: NextGamePlannerArtifactRowRecord[] = [];
  let nextToken: string | null = null;
  do {
    const page = await deps.listNextGamePlannerArtifactRowsByArtifactKey(
      args.env,
      artifact.artifactKey,
      {
        limit: 300,
        nextToken,
      },
    );
    rows.push(...page.records);
    nextToken = page.nextToken;
  } while (nextToken);

  return buildPlannerDetailFromArtifact(artifact, rows);
}

export async function processNextGameRecommendationJob(
  args: {
    env: GraphqlEnv;
    endpointName: string;
    message?: { jobId: string; userId: string };
    messageBody?: string;
  },
  dependencies: Partial<ProcessDependencies> = {},
): Promise<void> {
  const deps = {
    ...defaultProcessDependencies,
    ...dependencies,
  };
  const message = resolveRecommendationJobMessage(args);
  const job = await deps.getNextGameRecommendationJob(args.env, message.jobId);
  if (!job || job.userId !== message.userId) {
    throw new Error(
      "Next-game recommendation job is missing or no longer belongs to the enqueued user.",
    );
  }

  const identity = { sub: message.userId };
  const normalizedInput = normalizeRecommendationRequestRecord(job.requestJson, job);
  const startedAt = new Date().toISOString();

  try {
    await deps.assertMaintenanceInactive();
    await deps.updateNextGameRecommendationJob(args.env, {
      id: job.id,
      status: "PREPARING_INPUTS",
      startedAt,
      completedAt: null,
      error: null,
    });

    const context = await resolveRecommendationContext({
      env: args.env,
      getOrRefreshWorkspace: deps.getOrRefreshWorkspace,
      getScoutTeamSummaryForTeam: deps.getScoutTeamSummaryForTeam,
      identity,
    });
    if (
      context.nextMatch.matchId !== job.matchId ||
      context.opponentTeamId !== job.opponentTeamId
    ) {
      throw new Error(
        "The scheduled next opponent changed before the recommendation job completed.",
      );
    }

    const forecast = await resolveLatestForecastContext({
      env: args.env,
      listOpponentForecastJobsByUser: deps.listOpponentForecastJobsByUser,
      opponentTeamId: context.opponentTeamId,
      userId: message.userId,
    });
    const opponentSource = await resolveOpponentSourceContext({
      env: args.env,
      getMatchBoxscore: deps.getMatchBoxscore,
      recentGames: context.scout.summary?.recentGames ?? [],
      teamId: context.opponentTeamId,
      userId: message.userId,
    });
    const lineupWorkspace = await deps.getLineupHelperWorkspace({
      env: args.env,
      identity,
    });
    const availableRoster = lineupWorkspace.roster.filter((player) => player.available);
    if (!availableRoster.length) {
      throw new Error("No available roster data is ready for lineup optimization.");
    }

    await deps.updateNextGameRecommendationJob(args.env, {
      id: job.id,
      status: "EVALUATING_CANDIDATES",
      opponentTeamName: context.opponentTeamName,
      error: null,
    });

    const ourIsHome = context.nextMatch.isHome === true;
    const ourHomeCourt = ourIsHome ? "Home Court" : "Away or Neutral";
    const rosterById = new Map(
      lineupWorkspace.roster.map((player) => [player.playerId, player]),
    );

    const plannerPairDefinitions = buildPlannerPairDefinitions();
    const ourPairContexts = await mapWithConcurrency(
      plannerPairDefinitions,
      PREDICTION_CONCURRENCY,
      async (pair) => {
        const evaluation = await deps.optimizeLineupHelper({
          algorithm: "EXACT",
          roster: availableRoster,
          context: {
            offense: toLineupHelperOffense(pair.predictorOffense),
            defense: toLineupHelperDefense(pair.predictorDefense),
            enthusiasm: normalizedInput.enthusiasm,
            homeCourt: ourHomeCourt,
            defensiveSwitch: normalizedInput.defensiveSwitch,
          },
        });

        return {
          ...pair,
          lineup: buildRecommendedLineup(evaluation, rosterById),
          ratings: normalizeTeamRatingsRecord(evaluation.rawRatings),
        };
      },
    );

    const evaluatedScenarios = buildEvaluatedScenarios(forecast.scenarios);
    const plannerScenarios = buildPlannerScenarioContexts({
      normalizedRatings: opponentSource.normalizedRatings,
      scenarios: forecast.scenarios,
      teamLocation: ourIsHome ? "AWAY" : "HOME",
    });

    const plannerRequest = buildPlannerRequest({
      opponentScenarios: plannerScenarios,
      ourIsHome,
      ourPairs: ourPairContexts,
    });
    let rawPlannerResponse: PredictionEndpointResponse | PredictionPlannerResponse;
    try {
      rawPlannerResponse = await deps.invokePredictionEndpoint(
        args.endpointName,
        plannerRequest,
      );
    } catch (error) {
      throw normalizePlannerEndpointInvocationError(error, args.endpointName);
    }
    const plannerResponse = expectPlannerResponse(rawPlannerResponse);

    const artifactKey = job.id;
    await replacePlannerArtifactRows(args.env, deps, artifactKey);
    await deps.upsertNextGamePlannerArtifact(
      args.env,
      buildPlannerArtifactRecord({
        artifactKey,
        evaluatedScenarios,
        expiresAt: job.expiresAt,
        generatedAt: new Date().toISOString(),
        job,
        matchId: context.nextMatch.matchId ?? "",
        opponentPairs: plannerScenarios[0]?.opponentPairs ?? [],
        ourPairs: ourPairContexts,
      }),
    );
    await deps.upsertNextGamePlannerArtifactRows(
      args.env,
      buildPlannerArtifactRowRecords({
        artifactKey,
        expiresAt: job.expiresAt,
        jobId: job.id,
        response: plannerResponse,
        userId: job.userId,
      }),
    );

    const candidates = buildCandidatesFromPlanEvaluations({
      evaluatedScenarios,
      ourPairs: ourPairContexts,
      planEvaluations: plannerResponse.planEvaluations,
      recommendationInput: normalizedInput,
    });

    const bestExpectedCandidate = selectBestExpectedCandidate(candidates);
    const safestCandidate = selectSafestCandidate(candidates);
    const efficientCandidate = selectEfficientWinCandidate(candidates);
    if (!bestExpectedCandidate || !safestCandidate || !efficientCandidate) {
      throw new Error("No recommendation candidates were generated.");
    }

    const primaryScenario = forecast.scenarios[0];
    if (!primaryScenario) {
      throw new Error("The latest opponent forecast did not include a primary scenario.");
    }

    const result: RecommendationResult = {
      generatedAt: new Date().toISOString(),
      matchId: context.nextMatch.matchId ?? "",
      opponentTeamId: context.opponentTeamId,
      opponentTeamName: context.opponentTeamName,
      forecastJobId: forecast.job.id,
      forecastScenarioId: primaryScenario.scenarioId,
      forecastScenarioLabel: primaryScenario.label,
      forecastScenarioProbability: primaryScenario.probability ?? 0,
      forecastModelVersion:
        forecast.job.modelVersion ?? forecast.result.modelVersion ?? "unknown",
      opponentSourceMatchId: opponentSource.matchId,
      enthusiasm: normalizedInput.enthusiasm,
      defensiveSwitch: normalizedInput.defensiveSwitch,
      stale: false,
      artifactKey,
      evaluatedScenarios,
      bestExpectedPlan: toRecommendedPlan(
        bestExpectedCandidate,
        normalizedInput,
        "BEST_EXPECTED",
      ),
      safestPlan: toRecommendedPlan(
        safestCandidate,
        normalizedInput,
        "SAFEST",
      ),
      efficientPlan: toRecommendedPlan(
        efficientCandidate,
        normalizedInput,
        "EFFICIENT_WIN",
      ),
      biggestWinPlan: toRecommendedPlan(
        bestExpectedCandidate,
        normalizedInput,
        "BIGGEST_WIN",
      ),
      efficientWinPlan: toRecommendedPlan(
        efficientCandidate,
        normalizedInput,
        "EFFICIENT_WIN",
      ),
    };

    await deps.updateNextGameRecommendationJob(args.env, {
      id: job.id,
      status: "SUCCEEDED",
      opponentTeamName: context.opponentTeamName,
      completedAt: new Date().toISOString(),
      resultJson: result,
      error: null,
    });
  } catch (error) {
    await deps.updateNextGameRecommendationJob(args.env, {
      id: job.id,
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: toMaintenanceAwareErrorMessage(error),
    });
    throw error;
  }
}

export function normalizeRecommendationInput(input: unknown): RecommendationInput {
  const record = requireRecord(input, "Next-game recommendation input");
  const defensiveSwitch = normalizeDefensiveSwitch(
    asOptionalRecord(record.defensiveSwitch) ?? {},
  );
  const switchErrors = validateDefensiveSwitch(defensiveSwitch);
  if (switchErrors.length) {
    throw new Error(switchErrors.join(" "));
  }

  return {
    enthusiasm: normalizeEnthusiasm(record.enthusiasm),
    defensiveSwitch: {
      pg: normalizePositionCode(defensiveSwitch.PG),
      sg: normalizePositionCode(defensiveSwitch.SG),
      sf: normalizePositionCode(defensiveSwitch.SF),
      pf: normalizePositionCode(defensiveSwitch.PF),
      c: normalizePositionCode(defensiveSwitch.C),
    },
  };
}

export function effortChoiceToOrdinal(value: unknown): number {
  const normalized = asOptionalString(value)?.toUpperCase();
  if (normalized === "TAKE IT EASY" || normalized === "TIE") {
    return -1;
  }
  if (normalized === "CRUNCH TIME" || normalized === "CT") {
    return 1;
  }
  return 0;
}

export function buildPredictorPerspective(args: {
  opponentDefense: string;
  opponentEffort: number;
  opponentOffense: string;
  opponentRatings: TeamRatings;
  ourDefense: string;
  ourEffort: number;
  ourIsHome: boolean;
  ourOffense: string;
  ourRatings: TeamRatings;
}): PredictorPerspective {
  const homeRatings = args.ourIsHome ? args.ourRatings : args.opponentRatings;
  const awayRatings = args.ourIsHome ? args.opponentRatings : args.ourRatings;

  const payload: JsonRecord = {
    ...toSidePredictionInput("home", homeRatings),
    ...toSidePredictionInput("away", awayRatings),
    home_offStrategy: args.ourIsHome ? args.ourOffense : args.opponentOffense,
    home_defStrategy: args.ourIsHome ? args.ourDefense : args.opponentDefense,
    away_offStrategy: args.ourIsHome ? args.opponentOffense : args.ourOffense,
    away_defStrategy: args.ourIsHome ? args.opponentDefense : args.ourDefense,
    home_gdp_focus: DEFAULT_PREDICTION_GDP,
    home_gdp_pace: DEFAULT_PREDICTION_GDP,
    away_gdp_focus: DEFAULT_PREDICTION_GDP,
    away_gdp_pace: DEFAULT_PREDICTION_GDP,
    neutral: "0",
    effortDelta: args.ourIsHome
      ? args.ourEffort - args.opponentEffort
      : args.opponentEffort - args.ourEffort,
  };

  return {
    payload,
    teamIsHome: args.ourIsHome,
  };
}

export function adaptPredictionResultToUserPerspective(
  result: Pick<PredictionEndpointResponse, "awayScore" | "homeScore" | "pointDiff">,
  teamIsHome: boolean,
): {
  predictedOpponentScore: number;
  predictedPointDiff: number;
  predictedTeamScore: number;
} {
  const homeScore = asFiniteNumber(result.homeScore) ?? 0;
  const awayScore = asFiniteNumber(result.awayScore) ?? 0;
  const pointDiff = asFiniteNumber(result.pointDiff) ?? homeScore - awayScore;

  return teamIsHome
    ? {
        predictedOpponentScore: awayScore,
        predictedPointDiff: pointDiff,
        predictedTeamScore: homeScore,
      }
    : {
        predictedOpponentScore: homeScore,
        predictedPointDiff: -pointDiff,
        predictedTeamScore: awayScore,
      };
}

export function selectBestExpectedCandidate(
  candidates: readonly Candidate[],
): Candidate | null {
  return [...candidates].sort(compareBestExpectedCandidates)[0] ?? null;
}

export function selectSafestCandidate(
  candidates: readonly Candidate[],
): Candidate | null {
  return [...candidates].sort(compareSafestCandidates)[0] ?? null;
}

export function selectBiggestWinCandidate(
  candidates: readonly Candidate[],
): Candidate | null {
  return selectBestExpectedCandidate(candidates);
}

export function selectEfficientWinCandidate(
  candidates: readonly Candidate[],
): Candidate | null {
  const targetWinners = candidates.filter(
    (candidate) =>
      candidate.weightedExpectedPointDiff >= TARGET_EFFICIENT_MARGIN &&
      candidate.floorPointDiff > 0,
  );
  if (targetWinners.length) {
    return [...targetWinners].sort(compareEfficientCandidates)[0] ?? null;
  }

  const positiveWins = candidates.filter(
    (candidate) => candidate.weightedExpectedPointDiff > 0,
  );
  if (positiveWins.length) {
    return [...positiveWins].sort(compareEfficientCandidates)[0] ?? null;
  }

  return selectBestExpectedCandidate(candidates);
}

export function computeRecommendationStale(
  storedForecastJobId: string | null,
  latestForecastJobId: string,
): boolean {
  return Boolean(storedForecastJobId && storedForecastJobId !== latestForecastJobId);
}

export function jobMatchesRecommendationSettings(
  job: Pick<
    NextGameRecommendationJobRecord,
    | "enthusiasm"
    | "matchId"
    | "opponentTeamId"
    | "switchC"
    | "switchPf"
    | "switchPg"
    | "switchSf"
    | "switchSg"
  >,
  args: {
    defensiveSwitch: RecommendationSwitch;
    enthusiasm: number;
    matchId: string;
    opponentTeamId: string;
  },
): boolean {
  return (
    job.matchId === args.matchId &&
    job.opponentTeamId === args.opponentTeamId &&
    job.enthusiasm === args.enthusiasm &&
    job.switchPg === args.defensiveSwitch.pg &&
    job.switchSg === args.defensiveSwitch.sg &&
    job.switchSf === args.defensiveSwitch.sf &&
    job.switchPf === args.defensiveSwitch.pf &&
    job.switchC === args.defensiveSwitch.c
  );
}

async function resolveRecommendationContext(args: {
  env: GraphqlEnv;
  getOrRefreshWorkspace: typeof getOrRefreshWorkspace;
  getScoutTeamSummaryForTeam: typeof getScoutTeamSummaryForTeam;
  identity: unknown;
}): Promise<RecommendationContext> {
  const workspace = await args.getOrRefreshWorkspace({
    env: args.env,
    identity: args.identity,
  });
  const nextMatch = workspace.home.nextMatch;
  if (!nextMatch?.matchId) {
    throw new Error("No next match is available right now.");
  }
  if (!nextMatch.opponentTeamId) {
    throw new Error("The next match does not have an opponent yet.");
  }

  const scoutWorkspace = await args.getScoutTeamSummaryForTeam({
    env: args.env,
    identity: args.identity,
    teamId: nextMatch.opponentTeamId,
  });
  if (!scoutWorkspace.scout.summary) {
    throw new Error("Scout data for the next opponent is not available yet.");
  }

  return {
    nextMatch,
    opponentTeamId: nextMatch.opponentTeamId,
    opponentTeamName:
      nextMatch.opponentTeamName ??
      scoutWorkspace.scout.summary.teamName ??
      "Next opponent",
    scout: scoutWorkspace.scout,
  };
}

async function resolveLatestForecastContext(args: {
  env: GraphqlEnv;
  listOpponentForecastJobsByUser: typeof listOpponentForecastJobsByUser;
  opponentTeamId: string;
  userId: string;
}): Promise<ForecastContext> {
  const page = await args.listOpponentForecastJobsByUser(args.env, args.userId, {
    limit: 50,
  });
  const match = page.records.find(
    (job) => job.teamId === args.opponentTeamId && job.status === "SUCCEEDED",
  );
  if (!match?.resultJson) {
    throw new Error("No successful opponent forecast is available for the next opponent yet.");
  }

  const result = normalizeOpponentForecastResult(
    requireRecord(match.resultJson, "stored opponent forecast result"),
  );
  const scenarios = result.topScenarios.slice(0, MAX_EVALUATED_SCENARIOS);
  if (!scenarios.length) {
    throw new Error(
      "The latest opponent forecast did not include any top scenarios.",
    );
  }

  return {
    job: match,
    result,
    scenarios,
  };
}

async function resolveOpponentSourceContext(args: {
  env: GraphqlEnv;
  getMatchBoxscore: typeof getMatchBoxscore;
  recentGames: ReadonlyArray<{
    hasBoxscore?: boolean | null;
    matchId?: string | null;
  }>;
  teamId: string;
  userId: string;
}): Promise<OpponentSourceContext> {
  for (const game of args.recentGames) {
    if (!game.matchId || !game.hasBoxscore) {
      continue;
    }

    const record = await args.getMatchBoxscore(args.env, args.userId, game.matchId);
    const boxscore = inflateStoredMatchBoxscore(record?.boxscoreJson);
    if (!boxscore) {
      continue;
    }

    const perspective = selectBoxscorePerspective(boxscore, args.teamId);
    if (!perspective.team?.ratings) {
      continue;
    }

    return {
      matchId: game.matchId,
      normalizedRatings: normalizePredictionRatingsFromBoxscore({
        sourceTeam: perspective.team as never,
        teamLocation: perspective.teamLocation as PredictionTeamLocation,
      }),
      teamLocation: perspective.teamLocation as PredictionTeamLocation,
    };
  }

  throw new Error("No usable opponent source boxscore with ratings is available yet.");
}

export function buildPlannerPairDefinitions(): PlannerPairDefinition[] {
  return PLANNER_OFFENSE_OPTIONS.flatMap((predictorOffense) =>
    PLANNER_DEFENSE_OPTIONS.map((predictorDefense) => ({
      displayDefense: toPlannerDisplayDefense(predictorDefense),
      displayOffense: toPlannerDisplayOffense(predictorOffense),
      pairId: buildPlannerPairId(predictorOffense, predictorDefense),
      predictorDefense,
      predictorOffense,
      supportTier: isPlannerPairEstimated(
        predictorOffense,
        predictorDefense,
      )
        ? "ESTIMATED"
        : "DIRECT",
    })),
  );
}

function buildPlannerPairId(offense: string, defense: string): string {
  return `${offense}__${defense}`;
}

function buildEvaluatedScenarios(
  scenarios: readonly OpponentForecastScenario[],
): PlannerEvaluatedScenario[] {
  const normalizedProbabilities = normalizeScenarioProbabilities(scenarios);
  return scenarios.map((scenario, index) => ({
    scenarioId: scenario.scenarioId,
    label: scenario.label,
    probability: normalizedProbabilities[index] ?? 0,
    offense: toPlannerDisplayOffense(toPredictorOffense(scenario.offense)),
    defense: toPlannerDisplayDefense(toPredictorDefense(scenario.defense)),
    effortChoice: asOptionalString(scenario.effortChoice) ?? "Normal",
    evidence: [...scenario.evidence],
  }));
}

function buildPlannerScenarioContexts(args: {
  normalizedRatings: TeamRatings;
  scenarios: readonly OpponentForecastScenario[];
  teamLocation: PredictionTeamLocation;
}): PlannerScenarioContext[] {
  const pairDefinitions = buildPlannerPairDefinitions();
  const normalizedProbabilities = normalizeScenarioProbabilities(args.scenarios);

  return args.scenarios.map((scenario, scenarioIndex) => ({
    effortChoice: asOptionalString(scenario.effortChoice) ?? "Normal",
    evidence: [...scenario.evidence],
    forecastPairId: buildPlannerPairId(
      toPredictorOffense(scenario.offense),
      toPredictorDefense(scenario.defense),
    ),
    label: scenario.label,
    normalizedProbability: normalizedProbabilities[scenarioIndex] ?? 0,
    opponentEffort: effortChoiceToOrdinal(scenario.effortChoice),
    opponentPairs: pairDefinitions.map((pair) => ({
      ...pair,
      ratings: applyPredictionRatingsContext({
        normalizedRatings: args.normalizedRatings,
        offenseStrategy: pair.predictorOffense,
        defenseStrategy: pair.predictorDefense,
        teamLocation: args.teamLocation,
      }),
    })),
    probability: scenario.probability ?? 0,
    scenarioId: scenario.scenarioId,
  }));
}

function buildPlannerRequest(args: {
  opponentScenarios: readonly PlannerScenarioContext[];
  ourIsHome: boolean;
  ourPairs: readonly PlannerOurPairContext[];
}): JsonRecord {
  return {
    plannerRequest: {
      effortChoices: EFFORT_CHOICES.map((choice) => ({
        cost: choice.cost,
        label: choice.label,
        value: choice.value,
      })),
      matrixOurEffort: MATRIX_DEFAULT_EFFORT,
      opponentScenarios: args.opponentScenarios.map((scenario) => ({
        effortChoice: scenario.effortChoice,
        forecastPairId: scenario.forecastPairId,
        label: scenario.label,
        opponentEffort: scenario.opponentEffort,
        opponentPairs: scenario.opponentPairs.map((pair) => ({
          defense: pair.predictorDefense,
          offense: pair.predictorOffense,
          pairId: pair.pairId,
          ratings: pair.ratings,
        })),
        probability: scenario.normalizedProbability,
        scenarioId: scenario.scenarioId,
      })),
      ourIsHome: args.ourIsHome,
      ourPairs: args.ourPairs.map((pair) => ({
        defense: pair.predictorDefense,
        offense: pair.predictorOffense,
        pairId: pair.pairId,
        ratings: pair.ratings,
      })),
    },
  };
}

function expectPlannerResponse(
  value: PredictionEndpointResponse | PredictionPlannerResponse,
): PredictionPlannerResponse {
  const parsed = predictionPlannerResponseSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      issue
        ? `Planner prediction response was invalid at ${issue.path.join(".") || "root"}: ${issue.message}`
        : "Planner prediction response was invalid.",
    );
  }
  return parsed.data;
}

async function replacePlannerArtifactRows(
  env: GraphqlEnv,
  deps: Pick<
    ProcessDependencies,
    "deleteNextGamePlannerArtifactRow" | "listNextGamePlannerArtifactRowsByArtifactKey"
  >,
  artifactKey: string,
): Promise<void> {
  let nextToken: string | null = null;
  do {
    const page = await deps.listNextGamePlannerArtifactRowsByArtifactKey(
      env,
      artifactKey,
      {
        limit: 300,
        nextToken,
      },
    );

    for (const row of page.records) {
      await deps.deleteNextGamePlannerArtifactRow(env, {
        artifactKey: row.artifactKey,
        opponentPairId: row.opponentPairId,
        viewId: row.viewId,
      });
    }

    nextToken = page.nextToken;
  } while (nextToken);
}

function buildPlannerArtifactRecord(args: {
  artifactKey: string;
  evaluatedScenarios: readonly PlannerEvaluatedScenario[];
  expiresAt: string;
  generatedAt: string;
  job: Pick<
    NextGameRecommendationJobRecord,
    "id" | "opponentTeamId" | "userId"
  >;
  matchId: string;
  opponentPairs: readonly PlannerPairDefinition[];
  ourPairs: readonly PlannerOurPairContext[];
}): NextGamePlannerArtifactRecord {
  return {
    artifactKey: args.artifactKey,
    userId: args.job.userId,
    jobId: args.job.id,
    matchId: args.matchId,
    opponentTeamId: args.job.opponentTeamId,
    generatedAt: args.generatedAt,
    evaluatedScenariosJson: [...args.evaluatedScenarios],
    ourPairsJson: args.ourPairs.map(toPlannerTacticPairRecord),
    opponentPairsJson: args.opponentPairs.map(toPlannerTacticPairRecord),
    expiryKey: "EXPIRABLE",
    expiresAt: args.expiresAt,
  };
}

function buildPlannerArtifactRowRecords(args: {
  artifactKey: string;
  expiresAt: string;
  jobId: string;
  response: PredictionPlannerResponse;
  userId: string;
}): NextGamePlannerArtifactRowRecord[] {
  const views = [args.response.expectedMatrix, ...args.response.scenarioMatrices];
  const records: NextGamePlannerArtifactRowRecord[] = [];

  views.forEach((view, viewIndex) => {
    view.rows.forEach((row, rowIndex) => {
      records.push({
        artifactKey: args.artifactKey,
        viewId: view.viewId,
        opponentPairId: row.opponentPairId,
        userId: args.userId,
        jobId: args.jobId,
        rowOrder: viewIndex * 1000 + rowIndex,
        rowJson: {
          cells: row.cells,
          label: view.label,
          opponentPairId: row.opponentPairId,
          probability: view.probability ?? null,
          scenarioId: view.scenarioId ?? null,
          viewId: view.viewId,
        },
        expiryKey: "EXPIRABLE",
        expiresAt: args.expiresAt,
      });
    });
  });

  return records;
}

function buildCandidatesFromPlanEvaluations(args: {
  evaluatedScenarios: readonly PlannerEvaluatedScenario[];
  ourPairs: readonly PlannerOurPairContext[];
  planEvaluations: PredictionPlannerResponse["planEvaluations"];
  recommendationInput: RecommendationInput;
}): Candidate[] {
  const pairById = new Map(args.ourPairs.map((pair) => [pair.pairId, pair]));
  const probabilityByScenarioId = new Map(
    args.evaluatedScenarios.map((scenario) => [scenario.scenarioId, scenario.probability]),
  );

  return args.planEvaluations.flatMap((evaluation) => {
    const pair = pairById.get(evaluation.pairId);
    if (!pair) {
      return [];
    }

    const scenarioResults = args.evaluatedScenarios.map((scenario) => {
      const match = evaluation.scenarioResults.find(
        (entry) => entry.scenarioId === scenario.scenarioId,
      );
      return {
        available: match?.available === true,
        predictedOpponentScore:
          match?.predictedOpponentScore !== null &&
          match?.predictedOpponentScore !== undefined
            ? roundScore(match.predictedOpponentScore)
            : null,
        predictedPointDiff:
          match?.predictedPointDiff !== null &&
          match?.predictedPointDiff !== undefined
            ? roundScore(match.predictedPointDiff)
            : null,
        predictedTeamScore:
          match?.predictedTeamScore !== null &&
          match?.predictedTeamScore !== undefined
            ? roundScore(match.predictedTeamScore)
            : null,
        scenarioId: scenario.scenarioId,
      } satisfies CandidateScenarioResult;
    });

    const availableResults = scenarioResults.filter(
      (result) =>
        result.available &&
        result.predictedPointDiff !== null &&
        result.predictedTeamScore !== null &&
        result.predictedOpponentScore !== null,
    );
    if (!availableResults.length) {
      return [];
    }

    const availableWeight = availableResults.reduce(
      (sum, result) => sum + (probabilityByScenarioId.get(result.scenarioId) ?? 0),
      0,
    );
    const safeWeight = availableWeight > 0 ? availableWeight : 1;
    const weightedExpectedPointDiff =
      availableResults.reduce(
        (sum, result) =>
          sum +
          (probabilityByScenarioId.get(result.scenarioId) ?? 0) *
            (result.predictedPointDiff ?? 0),
        0,
      ) / safeWeight;
    const predictedTeamScore =
      availableResults.reduce(
        (sum, result) =>
          sum +
          (probabilityByScenarioId.get(result.scenarioId) ?? 0) *
            (result.predictedTeamScore ?? 0),
        0,
      ) / safeWeight;
    const predictedOpponentScore =
      availableResults.reduce(
        (sum, result) =>
          sum +
          (probabilityByScenarioId.get(result.scenarioId) ?? 0) *
            (result.predictedOpponentScore ?? 0),
        0,
      ) / safeWeight;

    return [
      {
        defense: pair.displayDefense,
        effortChoice: evaluation.effortChoice,
        effortCost: evaluation.effortCost,
        effortValue: evaluation.effortValue,
        floorPointDiff: roundScore(
          Math.min(
            ...availableResults.map((result) => result.predictedPointDiff ?? 0),
          ),
        ),
        ceilingPointDiff: roundScore(
          Math.max(
            ...availableResults.map((result) => result.predictedPointDiff ?? 0),
          ),
        ),
        lineup: pair.lineup,
        offense: pair.displayOffense,
        pairId: pair.pairId,
        predictedOpponentScore: roundScore(predictedOpponentScore),
        predictedPointDiff: roundScore(weightedExpectedPointDiff),
        predictedTeamScore: roundScore(predictedTeamScore),
        scenarioResults,
        weightedExpectedPointDiff: roundScore(weightedExpectedPointDiff),
        winProbability: roundScore(
          scenarioResults.reduce(
            (sum, result) =>
              sum +
              ((probabilityByScenarioId.get(result.scenarioId) ?? 0) *
                ((result.predictedPointDiff ?? Number.NEGATIVE_INFINITY) > 0 ? 1 : 0)),
            0,
          ),
        ),
      } satisfies Candidate,
    ];
  });
}

function buildPlannerDetailFromArtifact(
  artifact: NextGamePlannerArtifactRecord,
  rows: readonly NextGamePlannerArtifactRowRecord[],
): PlannerDetail {
  const ourPairs = normalizePlannerPairArray(artifact.ourPairsJson);
  const opponentPairs = normalizePlannerPairArray(artifact.opponentPairsJson);
  const evaluatedScenarios = normalizePlannerEvaluatedScenarioArray(
    artifact.evaluatedScenariosJson,
  );
  const views = buildPlannerViewsFromRows(rows);

  return {
    artifactKey: artifact.artifactKey,
    generatedAt: artifact.generatedAt,
    evaluatedScenarios,
    ourPairs,
    opponentPairs,
    views,
  };
}

function buildPlannerViewsFromRows(
  rows: readonly NextGamePlannerArtifactRowRecord[],
): PlannerMatrixView[] {
  const grouped = new Map<
    string,
    {
      label: string;
      probability: number | null;
      rows: PlannerMatrixRow[];
      scenarioId: string | null;
      viewId: string;
    }
  >();

  for (const record of rows) {
    const rowRecord = requireRecord(record.rowJson, "planner artifact row");
    const viewId = asOptionalString(rowRecord.viewId) ?? record.viewId;
    const current = grouped.get(viewId) ?? {
      label: asOptionalString(rowRecord.label) ?? viewId,
      probability: asFiniteNumber(rowRecord.probability),
      rows: [],
      scenarioId: asOptionalString(rowRecord.scenarioId),
      viewId,
    };

    current.rows.push({
      opponentPairId:
        asOptionalString(rowRecord.opponentPairId) ?? record.opponentPairId,
      cells: normalizePlannerMatrixCellArray(rowRecord.cells),
    });
    grouped.set(viewId, current);
  }

  return [...grouped.values()].map((view) => ({
    label: view.label,
    probability: view.probability,
    rows: view.rows,
    scenarioId: view.scenarioId,
    viewId: view.viewId,
  }));
}

function toPlannerTacticPairRecord(
  pair: Pick<
    PlannerPairDefinition,
    "displayDefense" | "displayOffense" | "pairId" | "supportTier"
  >,
): PlannerTacticPair {
  return {
    pairId: pair.pairId,
    offense: pair.displayOffense,
    defense: pair.displayDefense,
    estimated: pair.supportTier === "ESTIMATED",
    supportTier: pair.supportTier,
  };
}

function toRecommendedPlan(
  candidate: Candidate,
  input: RecommendationInput,
  mode: RecommendedGamePlan["mode"],
): RecommendedGamePlan {
  const targetMargin = mode === "EFFICIENT_WIN" ? TARGET_EFFICIENT_MARGIN : null;
  return {
    mode,
    pairId: candidate.pairId,
    predictedPointDiff: roundScore(candidate.predictedPointDiff),
    predictedTeamScore: roundScore(candidate.predictedTeamScore),
    predictedOpponentScore: roundScore(candidate.predictedOpponentScore),
    weightedExpectedPointDiff: roundScore(candidate.weightedExpectedPointDiff),
    floorPointDiff: roundScore(candidate.floorPointDiff),
    ceilingPointDiff: roundScore(candidate.ceilingPointDiff),
    winProbability: roundScore(candidate.winProbability),
    offense: candidate.offense,
    defense: candidate.defense,
    effortChoice: candidate.effortChoice,
    enthusiasm: input.enthusiasm,
    defensiveSwitch: input.defensiveSwitch,
    meetsTargetMargin:
      mode === "EFFICIENT_WIN"
        ? candidate.predictedPointDiff >= TARGET_EFFICIENT_MARGIN
        : candidate.predictedPointDiff > 0,
    targetMargin,
    lineup: candidate.lineup,
    scenarioResults: candidate.scenarioResults,
  };
}

function buildRecommendedLineup(
  evaluation: LineupHelperEvaluation,
  rosterById: ReadonlyMap<string, LineupHelperRosterPlayer>,
): RecommendedLineupRow[] {
  const positionOrder = new Map(
    POSITION_SEQUENCE.map((position, index) => [position, index]),
  );
  return [...evaluation.normalizedLineup]
    .sort(
      (left, right) =>
        (positionOrder.get(left.position) ?? 99) -
          (positionOrder.get(right.position) ?? 99) ||
        right.minutes - left.minutes ||
        left.playerId.localeCompare(right.playerId),
    )
    .map((assignment) => ({
      playerId: assignment.playerId,
      fullName: rosterById.get(assignment.playerId)?.fullName ?? "Unknown player",
      position: normalizePositionCode(assignment.position),
      minutes: assignment.minutes,
    }));
}

function normalizeRecommendationRequestRecord(
  requestJson: unknown,
  job: Pick<
    NextGameRecommendationJobRecord,
    | "enthusiasm"
    | "switchC"
    | "switchPf"
    | "switchPg"
    | "switchSf"
    | "switchSg"
  >,
): RecommendationInput {
  const request = asOptionalRecord(requestJson);
  const input = asOptionalRecord(request?.input);
  if (input) {
    return normalizeRecommendationInput(input);
  }
  return {
    enthusiasm: normalizeEnthusiasm(job.enthusiasm),
    defensiveSwitch: {
      pg: normalizePositionCode(job.switchPg),
      sg: normalizePositionCode(job.switchSg),
      sf: normalizePositionCode(job.switchSf),
      pf: normalizePositionCode(job.switchPf),
      c: normalizePositionCode(job.switchC),
    },
  };
}

function adaptRecommendationJob(
  job: NextGameRecommendationJobRecord,
  args: { stale: boolean },
): RecommendationSnapshot {
  return {
    jobId: job.id,
    matchId: job.matchId,
    opponentTeamId: job.opponentTeamId,
    opponentTeamName: asOptionalString(job.opponentTeamName),
    enthusiasm: job.enthusiasm,
    defensiveSwitch: {
      pg: normalizePositionCode(job.switchPg),
      sg: normalizePositionCode(job.switchSg),
      sf: normalizePositionCode(job.switchSf),
      pf: normalizePositionCode(job.switchPf),
      c: normalizePositionCode(job.switchC),
    },
    executionArn: asOptionalString(job.executionArn),
    status: normalizeRecommendationStatus(job.status),
    requestedAt: job.requestedAt,
    startedAt: asOptionalString(job.startedAt),
    completedAt: asOptionalString(job.completedAt),
    error: asOptionalString(job.error),
    result: job.resultJson
      ? normalizeRecommendationResult(
          requireRecord(job.resultJson, "stored recommendation result"),
          args.stale,
        )
      : null,
  };
}

function normalizeRecommendationResult(
  input: JsonRecord,
  stale: boolean,
): RecommendationResult {
  const defensiveSwitch = normalizeRecommendationDefensiveSwitch(
    input.defensiveSwitch,
  );

  return {
    generatedAt: asOptionalString(input.generatedAt) ?? new Date().toISOString(),
    matchId: asOptionalString(input.matchId) ?? "",
    opponentTeamId: asOptionalString(input.opponentTeamId) ?? "",
    opponentTeamName: asOptionalString(input.opponentTeamName) ?? "Next opponent",
    forecastJobId: asOptionalString(input.forecastJobId) ?? "",
    forecastScenarioId: asOptionalString(input.forecastScenarioId) ?? "",
    forecastScenarioLabel: asOptionalString(input.forecastScenarioLabel) ?? "",
    forecastScenarioProbability: asFiniteNumber(input.forecastScenarioProbability) ?? 0,
    forecastModelVersion: asOptionalString(input.forecastModelVersion) ?? "unknown",
    opponentSourceMatchId: asOptionalString(input.opponentSourceMatchId) ?? "",
    enthusiasm: normalizeEnthusiasm(input.enthusiasm),
    defensiveSwitch,
    stale,
    artifactKey: asOptionalString(input.artifactKey) ?? "",
    evaluatedScenarios: normalizePlannerEvaluatedScenarioArray(
      input.evaluatedScenarios,
    ),
    bestExpectedPlan: normalizeRecommendedPlan(
      asOptionalRecord(input.bestExpectedPlan) ??
        asOptionalRecord(input.biggestWinPlan),
      defensiveSwitch,
      normalizeEnthusiasm(input.enthusiasm),
      "BEST_EXPECTED",
    ),
    safestPlan: normalizeRecommendedPlan(
      asOptionalRecord(input.safestPlan),
      defensiveSwitch,
      normalizeEnthusiasm(input.enthusiasm),
      "SAFEST",
    ),
    efficientPlan: normalizeRecommendedPlan(
      asOptionalRecord(input.efficientPlan) ??
        asOptionalRecord(input.efficientWinPlan),
      defensiveSwitch,
      normalizeEnthusiasm(input.enthusiasm),
      "EFFICIENT_WIN",
    ),
    biggestWinPlan: normalizeRecommendedPlan(
      asOptionalRecord(input.biggestWinPlan),
      defensiveSwitch,
      normalizeEnthusiasm(input.enthusiasm),
      "BIGGEST_WIN",
    ),
    efficientWinPlan: normalizeRecommendedPlan(
      asOptionalRecord(input.efficientWinPlan),
      defensiveSwitch,
      normalizeEnthusiasm(input.enthusiasm),
      "EFFICIENT_WIN",
    ),
  };
}

function normalizeRecommendedPlan(
  input: JsonRecord | null,
  fallbackSwitch: RecommendationSwitch,
  fallbackEnthusiasm: number,
  fallbackMode: RecommendedGamePlan["mode"],
): RecommendedGamePlan {
  const record = input ?? {};
  return {
    mode: normalizeRecommendationMode(record.mode, fallbackMode),
    pairId: asOptionalString(record.pairId) ?? buildPlannerPairId("Base", "ManToMan"),
    predictedPointDiff: asFiniteNumber(record.predictedPointDiff) ?? 0,
    predictedTeamScore: asFiniteNumber(record.predictedTeamScore) ?? 0,
    predictedOpponentScore: asFiniteNumber(record.predictedOpponentScore) ?? 0,
    weightedExpectedPointDiff:
      asFiniteNumber(record.weightedExpectedPointDiff) ??
      asFiniteNumber(record.predictedPointDiff) ??
      0,
    floorPointDiff:
      asFiniteNumber(record.floorPointDiff) ??
      asFiniteNumber(record.predictedPointDiff) ??
      0,
    ceilingPointDiff:
      asFiniteNumber(record.ceilingPointDiff) ??
      asFiniteNumber(record.predictedPointDiff) ??
      0,
    winProbability: asFiniteNumber(record.winProbability) ?? 0,
    offense: asOptionalString(record.offense) ?? "Base Offense",
    defense: asOptionalString(record.defense) ?? "Man to man",
    effortChoice: asOptionalString(record.effortChoice) ?? "Normal",
    enthusiasm: normalizeEnthusiasm(record.enthusiasm ?? fallbackEnthusiasm),
    defensiveSwitch: normalizeRecommendationDefensiveSwitch(
      record.defensiveSwitch,
      fallbackSwitch,
    ),
    meetsTargetMargin: asOptionalBoolean(record.meetsTargetMargin) ?? false,
    targetMargin: asFiniteInteger(record.targetMargin),
    lineup: Array.isArray(record.lineup)
      ? record.lineup.map((entry) =>
          normalizeRecommendedLineupRow(asOptionalRecord(entry)),
        )
      : [],
    scenarioResults: Array.isArray(record.scenarioResults)
      ? record.scenarioResults.map((entry) =>
          normalizePlannerPlanScenarioResult(asOptionalRecord(entry)),
        )
      : [],
  };
}

function normalizeRecommendedLineupRow(
  input: JsonRecord | null,
): RecommendedLineupRow {
  return {
    playerId: asOptionalString(input?.playerId),
    fullName: asOptionalString(input?.fullName) ?? "Unknown player",
    position: normalizePositionCode(input?.position),
    minutes: asFiniteInteger(input?.minutes) ?? 0,
  };
}

function normalizePlannerPlanScenarioResult(
  input: JsonRecord | null,
): RecommendedGamePlan["scenarioResults"][number] {
  return {
    scenarioId: asOptionalString(input?.scenarioId) ?? "",
    available: asOptionalBoolean(input?.available) ?? false,
    predictedPointDiff: asFiniteNumber(input?.predictedPointDiff),
    predictedTeamScore: asFiniteNumber(input?.predictedTeamScore),
    predictedOpponentScore: asFiniteNumber(input?.predictedOpponentScore),
  };
}

function normalizePlannerEvaluatedScenarioArray(
  value: unknown,
): PlannerEvaluatedScenario[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const record = asOptionalRecord(entry);
    return {
      scenarioId: asOptionalString(record?.scenarioId) ?? "",
      label: asOptionalString(record?.label) ?? "Scenario",
      probability: asFiniteNumber(record?.probability) ?? 0,
      offense: asOptionalString(record?.offense) ?? "Base Offense",
      defense: asOptionalString(record?.defense) ?? "Man to man",
      effortChoice: asOptionalString(record?.effortChoice) ?? "Normal",
      evidence: Array.isArray(record?.evidence)
        ? record.evidence
            .map((item) => asOptionalString(item))
            .filter((item): item is string => Boolean(item))
        : [],
    };
  });
}

function normalizePlannerPairArray(value: unknown): PlannerTacticPair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const record = asOptionalRecord(entry);
    return {
      pairId: asOptionalString(record?.pairId) ?? buildPlannerPairId("Base", "ManToMan"),
      offense: asOptionalString(record?.offense) ?? "Base Offense",
      defense: asOptionalString(record?.defense) ?? "Man to man",
      estimated: asOptionalBoolean(record?.estimated) ?? false,
      supportTier:
        record?.supportTier === "DIRECT" || record?.supportTier === "ESTIMATED"
          ? record.supportTier
          : "DIRECT",
    };
  });
}

function normalizePlannerMatrixCellArray(value: unknown): PlannerMatrixCell[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const record = asOptionalRecord(entry);
    return {
      ourPairId: asOptionalString(record?.ourPairId) ?? buildPlannerPairId("Base", "ManToMan"),
      opponentPairId:
        asOptionalString(record?.opponentPairId) ??
        buildPlannerPairId("Base", "ManToMan"),
      available: asOptionalBoolean(record?.available) ?? false,
      predictedPointDiff: asFiniteNumber(record?.predictedPointDiff),
      predictedTeamScore: asFiniteNumber(record?.predictedTeamScore),
      predictedOpponentScore: asFiniteNumber(record?.predictedOpponentScore),
    };
  });
}

function readStoredForecastJobId(resultJson: unknown): string | null {
  return asOptionalString(asOptionalRecord(resultJson)?.forecastJobId);
}

function normalizeRecommendationStatus(
  value: string,
): RecommendationSnapshot["status"] {
  switch (value) {
    case "QUEUED":
    case "PREPARING_INPUTS":
    case "EVALUATING_CANDIDATES":
    case "SUCCEEDED":
    case "FAILED":
      return value;
    default:
      return "FAILED";
  }
}

function normalizeRecommendationMode(
  value: unknown,
  fallback: RecommendedGamePlan["mode"],
): RecommendedGamePlan["mode"] {
  return value === "BIGGEST_WIN" ||
    value === "BEST_EXPECTED" ||
    value === "SAFEST" ||
    value === "EFFICIENT_WIN"
    ? value
    : fallback;
}

function normalizeRecommendationDefensiveSwitch(
  value: unknown,
  fallback?: RecommendationSwitch,
): RecommendationSwitch {
  const normalized = normalizeDefensiveSwitch(
    asOptionalRecord(value) ?? (fallback
      ? {
          PG: fallback.pg,
          SG: fallback.sg,
          SF: fallback.sf,
          PF: fallback.pf,
          C: fallback.c,
        }
      : {}),
  );
  return {
    pg: normalizePositionCode(normalized.PG),
    sg: normalizePositionCode(normalized.SG),
    sf: normalizePositionCode(normalized.SF),
    pf: normalizePositionCode(normalized.PF),
    c: normalizePositionCode(normalized.C),
  };
}

function compareBestExpectedCandidates(left: Candidate, right: Candidate): number {
  return (
    right.weightedExpectedPointDiff - left.weightedExpectedPointDiff ||
    left.effortCost - right.effortCost ||
    stableCandidateKey(left).localeCompare(stableCandidateKey(right))
  );
}

function compareSafestCandidates(left: Candidate, right: Candidate): number {
  return (
    right.floorPointDiff - left.floorPointDiff ||
    right.weightedExpectedPointDiff - left.weightedExpectedPointDiff ||
    left.effortCost - right.effortCost ||
    stableCandidateKey(left).localeCompare(stableCandidateKey(right))
  );
}

function compareEfficientCandidates(left: Candidate, right: Candidate): number {
  return (
    left.effortCost - right.effortCost ||
    left.weightedExpectedPointDiff - right.weightedExpectedPointDiff ||
    right.floorPointDiff - left.floorPointDiff ||
    stableCandidateKey(left).localeCompare(stableCandidateKey(right))
  );
}

function stableCandidateKey(candidate: Candidate): string {
  return [
    candidate.offense,
    candidate.defense,
    candidate.effortChoice,
  ].join("|");
}

function toSidePredictionInput(
  prefix: "home" | "away",
  ratings: TeamRatings,
): PredictionInputShape {
  return {
    [`${prefix}_outsideScoring`]: roundScore(ratings.outsideScoring),
    [`${prefix}_insideScoring`]: roundScore(ratings.insideScoring),
    [`${prefix}_outsideDefense`]: roundScore(ratings.outsideDefense),
    [`${prefix}_insideDefense`]: roundScore(ratings.insideDefense),
    [`${prefix}_rebounding`]: roundScore(ratings.rebounding),
    [`${prefix}_offensiveFlow`]: roundScore(ratings.offensiveFlow),
  } as unknown as PredictionInputShape;
}

function normalizeTeamRatingsRecord(value: unknown): TeamRatings {
  const record = requireRecord(value, "lineup evaluation raw ratings");
  return {
    outsideScoring: asFiniteNumber(record.outsideScoring) ?? 0,
    insideScoring: asFiniteNumber(record.insideScoring) ?? 0,
    outsideDefense: asFiniteNumber(record.outsideDefense) ?? 0,
    insideDefense: asFiniteNumber(record.insideDefense) ?? 0,
    rebounding: asFiniteNumber(record.rebounding) ?? 0,
    offensiveFlow: asFiniteNumber(record.offensiveFlow) ?? 0,
  };
}

async function invokePredictionEndpoint(
  endpointName: string,
  payload: JsonRecord,
): Promise<PredictionEndpointResponse | PredictionPlannerResponse> {
  const runtime = new SageMakerRuntimeClient({});
  let response;
  try {
    response = await runtime.send(
      new InvokeEndpointCommand({
        EndpointName: endpointName,
        ContentType: "application/json",
        Body: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (error) {
    throw normalizePlannerEndpointInvocationError(error, endpointName);
  }
  const rawBody = response.Body?.transformToString
    ? await Promise.resolve(response.Body.transformToString())
    : Buffer.from(response.Body ?? []).toString("utf-8");
  const body = rawBody ? JSON.parse(rawBody) : null;
  const parsed =
    payload.plannerRequest !== undefined
      ? predictionPlannerResponseSchema.safeParse(body)
      : predictionEndpointResponseSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      issue
        ? `SageMaker prediction response was invalid at ${issue.path.join(".") || "root"}: ${issue.message}`
        : "SageMaker prediction response was invalid.",
    );
  }
  return parsed.data;
}

async function mapWithConcurrency<TInput, TResult>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) {
        return;
      }
      results[currentIndex] = await mapper(item, currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function resolveRecommendationJobMessage(args: {
  message?: { jobId: string; userId: string };
  messageBody?: string;
}): { jobId: string; userId: string } {
  if (args.message) {
    return args.message;
  }
  if (!args.messageBody) {
    throw new Error("Next-game recommendation job payload was not provided.");
  }
  return parseRecommendationQueueMessage(args.messageBody);
}

function parseRecommendationQueueMessage(
  body: string,
): { jobId: string; userId: string } {
  const parsed = requireRecord(
    JSON.parse(body),
    "SQS next-game recommendation job message",
  );
  const jobId = asOptionalString(parsed.jobId);
  const userId = asOptionalString(parsed.userId);
  if (!jobId || !userId) {
    throw new Error(
      "Next-game recommendation queue message must include jobId and userId.",
    );
  }
  return { jobId, userId };
}

function toPlannerDisplayOffense(value: string): string {
  switch (value) {
    case "Base":
      return "Base Offense";
    case "Push":
      return "Push the Ball";
    case "LookInside":
      return "Look Inside";
    case "LowPost":
      return "Low Post";
    case "RunAndGun":
      return "Run and Gun";
    case "InsideIsolation":
      return "Inside Isolation";
    case "OutsideIsolation":
      return "Outside Isolation";
    default:
      return value;
  }
}

function toPlannerDisplayDefense(value: string): string {
  switch (value) {
    case "ManToMan":
      return "Man to man";
    case "23Zone":
      return "2-3 Zone";
    case "32Zone":
      return "3-2 Zone";
    case "131Zone":
      return "1-3-1 Zone";
    case "InsideBoxAndOne":
      return "Inside Box + 1";
    case "OutsideBoxAndOne":
      return "Outside Box + 1";
    case "Press":
      return "Full Court Press";
    default:
      return value;
  }
}

function toLineupHelperOffense(value: string): string {
  switch (value) {
    case "Base":
      return "Base Offense";
    case "Push":
      return "Push the Ball";
    case "LookInside":
    case "InsideIsolation":
      return "Look Inside";
    case "LowPost":
      return "Low Post";
    case "RunAndGun":
    case "OutsideIsolation":
      return value === "RunAndGun" ? "Run and Gun" : "Motion";
    default:
      return toPlannerDisplayOffense(value);
  }
}

function toLineupHelperDefense(value: string): string {
  switch (value) {
    case "ManToMan":
      return "Man to man";
    case "23Zone":
    case "InsideBoxAndOne":
      return "2-3 Zone";
    case "32Zone":
    case "OutsideBoxAndOne":
      return "3-2 Zone";
    case "131Zone":
      return "1-3-1 Zone";
    case "Press":
      return "Full Court Press";
    default:
      return toPlannerDisplayDefense(value);
  }
}

function isPlannerPairEstimated(offense: string, defense: string): boolean {
  return (
    offense === "InsideIsolation" ||
    offense === "OutsideIsolation" ||
    defense === "InsideBoxAndOne" ||
    defense === "OutsideBoxAndOne" ||
    defense === "Press"
  );
}

function toPredictorOffense(value: unknown): string {
  const normalized = asOptionalString(value);
  return normalized ? (OFFENSE_TO_PREDICTOR[normalized] ?? "Base") : "Base";
}

function toPredictorDefense(value: unknown): string {
  const normalized = asOptionalString(value);
  return normalized ? (DEFENSE_TO_PREDICTOR[normalized] ?? "ManToMan") : "ManToMan";
}

function normalizeEnthusiasm(value: unknown): number {
  const parsed = asFiniteNumber(value);
  if (parsed === null) {
    return DEFAULT_ENTHUSIASM;
  }
  return Math.min(15, Math.max(1, Math.round(parsed)));
}

function normalizePositionCode(value: unknown): PositionCode {
  switch (asOptionalString(value)) {
    case "PG":
      return PositionCode.PG;
    case "SG":
      return PositionCode.SG;
    case "SF":
      return PositionCode.SF;
    case "PF":
      return PositionCode.PF;
    case "C":
      return PositionCode.C;
    case null:
      return PositionCode.PG;
    default:
      return PositionCode.PG;
  }
}

function roundScore(value: number): number {
  return Number(value.toFixed(3));
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function asOptionalRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asFiniteInteger(value: unknown): number | null {
  const parsed = asFiniteNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function normalizeScenarioProbabilities(
  scenarios: ReadonlyArray<{ probability?: number | null }>,
): number[] {
  if (!scenarios.length) {
    return [];
  }

  const raw = scenarios.map((scenario) =>
    Math.max(0, asFiniteNumber(scenario.probability) ?? 0),
  );
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total > 0) {
    return raw.map((value) => value / total);
  }

  const equalWeight = 1 / scenarios.length;
  return scenarios.map(() => equalWeight);
}

function resolveUserId(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }
  const typedIdentity = identity as Identity;
  if (typeof typedIdentity.sub === "string" && typedIdentity.sub) {
    return typedIdentity.sub;
  }
  const claimsSub = typedIdentity.claims?.sub;
  return typeof claimsSub === "string" && claimsSub ? claimsSub : null;
}
