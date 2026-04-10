import { randomUUID } from "node:crypto";

import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

import {
  DEFENSE_OPTIONS,
  OFFENSE_OPTIONS,
  POSITION_SEQUENCE,
  normalizeDefensiveSwitch,
  validateDefensiveSwitch,
} from "../../../lib/coach-parrot";
import {
  predictionEndpointResponseSchema,
  type PredictionEndpointResponse,
} from "../../../lib/prediction/contracts";
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
  createNextGameRecommendationJob,
  getMatchBoxscore,
  getNextGameRecommendationJob,
  listNextGameRecommendationJobsByUser,
  listOpponentForecastJobsByUser,
  updateNextGameRecommendationJob,
  type NextGameRecommendationJobRecord,
  type OpponentForecastJobRecord,
} from "./repository";
import { buildExecutionName, startStateMachineExecution } from "./step-functions";
import { getOrRefreshWorkspace, getScoutWorkspaceForTeam } from "./workspace";

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
type RecommendedGamePlan = RecommendationResult["biggestWinPlan"];
type RecommendedLineupRow = RecommendedGamePlan["lineup"][number];
type LineupHelperWorkspace = ResolverResult<"getLineupHelperWorkspace">;
type LineupHelperRosterPlayer = LineupHelperWorkspace["roster"][number];
type LineupHelperEvaluation = ResolverResult<"optimizeLineupHelper">;
type OpponentForecastScenario = NonNullable<
  NonNullable<ResolverResult<"getLatestOpponentForecast">["result"]>["topScenarios"][number]
>;

type SubmitDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  createNextGameRecommendationJob: typeof createNextGameRecommendationJob;
  getMatchBoxscore: typeof getMatchBoxscore;
  getOrRefreshWorkspace: typeof getOrRefreshWorkspace;
  getScoutWorkspaceForTeam: typeof getScoutWorkspaceForTeam;
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
  getScoutWorkspaceForTeam: typeof getScoutWorkspaceForTeam;
  listNextGameRecommendationJobsByUser: typeof listNextGameRecommendationJobsByUser;
  listOpponentForecastJobsByUser: typeof listOpponentForecastJobsByUser;
};

type ProcessDependencies = {
  assertMaintenanceInactive: () => Promise<void>;
  getLineupHelperWorkspace: typeof getLineupHelperWorkspace;
  getMatchBoxscore: typeof getMatchBoxscore;
  getNextGameRecommendationJob: typeof getNextGameRecommendationJob;
  getOrRefreshWorkspace: typeof getOrRefreshWorkspace;
  getScoutWorkspaceForTeam: typeof getScoutWorkspaceForTeam;
  invokePredictionEndpoint: (
    endpointName: string,
    payload: JsonRecord,
  ) => Promise<PredictionEndpointResponse>;
  listOpponentForecastJobsByUser: typeof listOpponentForecastJobsByUser;
  optimizeLineupHelper: typeof optimizeLineupHelper;
  updateNextGameRecommendationJob: typeof updateNextGameRecommendationJob;
};

type RecommendationContext = {
  nextMatch: NonNullable<ResolverResult<"getHomeWorkspace">["nextMatch"]>;
  opponentTeamId: string;
  opponentTeamName: string;
  scout: ResolverResult<"getScoutWorkspace">;
};

type ForecastContext = {
  job: OpponentForecastJobRecord;
  result: NonNullable<ResolverResult<"getLatestOpponentForecast">["result"]>;
  primaryScenario: OpponentForecastScenario;
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

type Candidate = {
  defense: string;
  effortChoice: string;
  effortCost: number;
  effortValue: number;
  lineup: RecommendedLineupRow[];
  offense: string;
  predictedOpponentScore: number;
  predictedPointDiff: number;
  predictedTeamScore: number;
};

const DEFAULT_ENTHUSIASM = 8;
const TARGET_EFFICIENT_MARGIN = 10;
const MAX_JOB_PAGES = 4;
const RECOMMENDATION_PAGE_SIZE = 50;
const PREDICTION_CONCURRENCY = 8;
const DEFAULT_PREDICTION_GDP = "N/A";
const EFFORT_CHOICES = [
  { label: "Take It Easy", value: -1, cost: 0 },
  { label: "Normal", value: 0, cost: 1 },
  { label: "Crunch Time", value: 1, cost: 2 },
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
  getScoutWorkspaceForTeam,
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
  getScoutWorkspaceForTeam,
  listNextGameRecommendationJobsByUser,
  listOpponentForecastJobsByUser,
};

const defaultProcessDependencies: ProcessDependencies = {
  assertMaintenanceInactive,
  getLineupHelperWorkspace,
  getMatchBoxscore,
  getNextGameRecommendationJob,
  getOrRefreshWorkspace,
  getScoutWorkspaceForTeam,
  invokePredictionEndpoint,
  listOpponentForecastJobsByUser,
  optimizeLineupHelper,
  updateNextGameRecommendationJob,
};

export const __testing = {
  adaptPredictionResultToUserPerspective,
  buildPredictorPerspective,
  computeRecommendationStale,
  effortChoiceToOrdinal,
  jobMatchesRecommendationSettings,
  normalizeRecommendationInput,
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
    getScoutWorkspaceForTeam: deps.getScoutWorkspaceForTeam,
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
      matchId: context.nextMatch.matchId,
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
    getScoutWorkspaceForTeam: deps.getScoutWorkspaceForTeam,
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
      getScoutWorkspaceForTeam: deps.getScoutWorkspaceForTeam,
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
    const opponentRatings = applyPredictionRatingsContext({
      normalizedRatings: opponentSource.normalizedRatings,
      offenseStrategy: toPredictorOffense(forecast.primaryScenario.offense),
      defenseStrategy: toPredictorDefense(forecast.primaryScenario.defense),
      teamLocation: ourIsHome ? "AWAY" : "HOME",
    });
    const opponentEffort = effortChoiceToOrdinal(
      forecast.primaryScenario.effortChoice,
    );
    const rosterById = new Map(
      lineupWorkspace.roster.map((player) => [player.playerId, player]),
    );

    const pairEvaluations = await mapWithConcurrency(
      OFFENSE_OPTIONS.flatMap((offense) =>
        DEFENSE_OPTIONS.map((defense) => ({ defense, offense })),
      ),
      PREDICTION_CONCURRENCY,
      async ({ defense, offense }) => {
        const evaluation = await deps.optimizeLineupHelper({
          algorithm: "EXACT",
          roster: availableRoster,
          context: {
            offense,
            defense,
            enthusiasm: normalizedInput.enthusiasm,
            homeCourt: ourHomeCourt,
            defensiveSwitch: normalizedInput.defensiveSwitch,
          },
        });

        return {
          defense,
          evaluation,
          lineup: buildRecommendedLineup(evaluation, rosterById),
          offense,
        };
      },
    );

    const candidates = await mapWithConcurrency(
      pairEvaluations.flatMap((pair) =>
        EFFORT_CHOICES.map((effort) => ({ ...pair, effort })),
      ),
      PREDICTION_CONCURRENCY,
      async ({ defense, effort, evaluation, lineup, offense }) => {
        const perspective = buildPredictorPerspective({
          opponentDefense: toPredictorDefense(forecast.primaryScenario.defense),
          opponentEffort,
          opponentOffense: toPredictorOffense(forecast.primaryScenario.offense),
          opponentRatings,
          ourDefense: toPredictorDefense(defense),
          ourEffort: effort.value,
          ourIsHome,
          ourOffense: toPredictorOffense(offense),
          ourRatings: normalizeTeamRatingsRecord(evaluation.rawRatings),
        });
        const prediction = await deps.invokePredictionEndpoint(
          args.endpointName,
          perspective.payload,
        );
        const result = adaptPredictionResultToUserPerspective(
          prediction,
          perspective.teamIsHome,
        );

        return {
          defense,
          effortChoice: effort.label,
          effortCost: effort.cost,
          effortValue: effort.value,
          lineup,
          offense,
          predictedOpponentScore: result.predictedOpponentScore,
          predictedPointDiff: result.predictedPointDiff,
          predictedTeamScore: result.predictedTeamScore,
        } satisfies Candidate;
      },
    );

    const biggestWinCandidate = selectBiggestWinCandidate(candidates);
    const efficientWinCandidate = selectEfficientWinCandidate(candidates);
    if (!biggestWinCandidate || !efficientWinCandidate) {
      throw new Error("No recommendation candidates were generated.");
    }

    const result: RecommendationResult = {
      generatedAt: new Date().toISOString(),
      matchId: context.nextMatch.matchId ?? "",
      opponentTeamId: context.opponentTeamId,
      opponentTeamName: context.opponentTeamName,
      forecastJobId: forecast.job.id,
      forecastScenarioId: forecast.primaryScenario.scenarioId,
      forecastScenarioLabel: forecast.primaryScenario.label,
      forecastScenarioProbability: forecast.primaryScenario.probability ?? 0,
      forecastModelVersion:
        forecast.job.modelVersion ?? forecast.result.modelVersion ?? "unknown",
      opponentSourceMatchId: opponentSource.matchId,
      enthusiasm: normalizedInput.enthusiasm,
      defensiveSwitch: normalizedInput.defensiveSwitch,
      stale: false,
      biggestWinPlan: toRecommendedPlan(
        biggestWinCandidate,
        normalizedInput,
        "BIGGEST_WIN",
      ),
      efficientWinPlan: toRecommendedPlan(
        efficientWinCandidate,
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

export function selectBiggestWinCandidate(
  candidates: readonly Candidate[],
): Candidate | null {
  return [...candidates].sort(compareBiggestWinCandidates)[0] ?? null;
}

export function selectEfficientWinCandidate(
  candidates: readonly Candidate[],
): Candidate | null {
  const targetWinners = candidates.filter(
    (candidate) => candidate.predictedPointDiff >= TARGET_EFFICIENT_MARGIN,
  );
  if (targetWinners.length) {
    return [...targetWinners].sort(compareEfficientCandidates)[0] ?? null;
  }

  const positiveWins = candidates.filter(
    (candidate) => candidate.predictedPointDiff > 0,
  );
  if (positiveWins.length) {
    return [...positiveWins].sort(compareEfficientCandidates)[0] ?? null;
  }

  return selectBiggestWinCandidate(candidates);
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
  getScoutWorkspaceForTeam: typeof getScoutWorkspaceForTeam;
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

  const scoutWorkspace = await args.getScoutWorkspaceForTeam({
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
  const primaryScenario = result.topScenarios[0];
  if (!primaryScenario) {
    throw new Error("The latest opponent forecast did not include a primary scenario.");
  }

  return {
    job: match,
    result,
    primaryScenario,
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
    const boxscore = asOptionalRecord(record?.boxscoreJson);
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

function toRecommendedPlan(
  candidate: Candidate,
  input: RecommendationInput,
  mode: RecommendedGamePlan["mode"],
): RecommendedGamePlan {
  const targetMargin = mode === "EFFICIENT_WIN" ? TARGET_EFFICIENT_MARGIN : null;
  return {
    mode,
    predictedPointDiff: roundScore(candidate.predictedPointDiff),
    predictedTeamScore: roundScore(candidate.predictedTeamScore),
    predictedOpponentScore: roundScore(candidate.predictedOpponentScore),
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
    predictedPointDiff: asFiniteNumber(record.predictedPointDiff) ?? 0,
    predictedTeamScore: asFiniteNumber(record.predictedTeamScore) ?? 0,
    predictedOpponentScore: asFiniteNumber(record.predictedOpponentScore) ?? 0,
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
  return value === "BIGGEST_WIN" || value === "EFFICIENT_WIN" ? value : fallback;
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

function compareBiggestWinCandidates(left: Candidate, right: Candidate): number {
  return (
    right.predictedPointDiff - left.predictedPointDiff ||
    left.effortCost - right.effortCost ||
    stableCandidateKey(left).localeCompare(stableCandidateKey(right))
  );
}

function compareEfficientCandidates(left: Candidate, right: Candidate): number {
  return (
    left.predictedPointDiff - right.predictedPointDiff ||
    left.effortCost - right.effortCost ||
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
): Promise<PredictionEndpointResponse> {
  const runtime = new SageMakerRuntimeClient({});
  const response = await runtime.send(
    new InvokeEndpointCommand({
      EndpointName: endpointName,
      ContentType: "application/json",
      Body: Buffer.from(JSON.stringify(payload)),
    }),
  );
  const rawBody = response.Body?.transformToString
    ? await Promise.resolve(response.Body.transformToString())
    : Buffer.from(response.Body ?? []).toString("utf-8");
  const parsed = predictionEndpointResponseSchema.safeParse(
    rawBody ? JSON.parse(rawBody) : null,
  );
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
