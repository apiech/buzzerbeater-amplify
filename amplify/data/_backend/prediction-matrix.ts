import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

import { predictionPlannerResponseSchema } from "../../../lib/prediction/contracts";
import { normalizePredictionModelKey } from "../../../lib/prediction/model-selection";
import { normalizePlannerEndpointInvocationError } from "../../../lib/prediction/planner-endpoint-errors";
import { applyPredictionRatingsContext } from "../../../lib/prediction/normalization";
import { requireFeatureAccess } from "./billing";
import { assertMaintenanceInactive } from "./maintenance";
import {
  buildPlannerPairDefinitions,
  effortChoiceToOrdinal,
} from "./next-game-recommendation";

type GraphqlEnv = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;
type PredictionVenue = "TEAM_A_HOME" | "NEUTRAL" | "TEAM_B_HOME";
type TeamLocation = "HOME" | "AWAY";

type PredictionMatrixRequest = {
  modelKey?: string | null;
  teamA: PredictionMatrixSideInput;
  teamB: PredictionMatrixSideInput;
  venue: PredictionVenue;
};

type PredictionMatrixSideInput = {
  defense: string;
  effortChoice: string;
  offense: string;
  ratings: TeamRatingsInput;
  teamId: string | null;
  teamName: string | null;
};

type TeamRatingsInput = {
  insideDefense: number;
  insideScoring: number;
  offensiveFlow: number;
  outsideDefense: number;
  outsideScoring: number;
  rebounding: number;
};

type PredictionMatrixTacticPairResult = {
  defense: string;
  estimated: boolean;
  offense: string;
  pairId: string;
  supportTier: "DIRECT" | "ESTIMATED";
};

type PredictionMatrixSideSummaryResult = {
  defense: string;
  effortChoice: string;
  offense: string;
  teamId: string | null;
  teamName: string | null;
};

type PredictionMatrixCellResult = {
  available: boolean;
  bestEffortChoice: string | null;
  predictedPointDiff: number | null;
  predictedTeamAScore: number | null;
  predictedTeamBScore: number | null;
  teamAPairId: string;
  teamBPairId: string;
};

type PredictionMatrixRowResult = {
  cells: PredictionMatrixCellResult[];
  teamBPairId: string;
};

type PredictionMatrixViewResult = {
  label: string;
  probability: number | null;
  rows: PredictionMatrixRowResult[];
  scenarioId: string | null;
  viewId: string;
};

type PredictionMatrixResult = {
  generatedAt: string;
  modelKey: string | null;
  modelVersion: string;
  selectedTeamAPairId: string | null;
  selectedTeamBPairId: string | null;
  teamAPairs: PredictionMatrixTacticPairResult[];
  teamASide: PredictionMatrixSideSummaryResult;
  teamBPairs: PredictionMatrixTacticPairResult[];
  teamBSide: PredictionMatrixSideSummaryResult;
  venue: PredictionVenue;
  views: PredictionMatrixViewResult[];
};

type PlannerPairContext = ReturnType<typeof buildPlannerPairDefinitions>[number] & {
  ratings: TeamRatingsInput;
};

type EvaluatePredictionMatrixDependencies = {
  assertMaintenanceInactive: typeof assertMaintenanceInactive;
  invokePredictionEndpoint: (
    endpointName: string,
    payload: JsonRecord,
  ) => Promise<JsonRecord>;
  requireFeatureAccess: typeof requireFeatureAccess;
};

const defaultDependencies: EvaluatePredictionMatrixDependencies = {
  assertMaintenanceInactive,
  invokePredictionEndpoint,
  requireFeatureAccess,
};

export async function evaluatePredictionMatrix(
  args: {
    endpointName: string;
    env: GraphqlEnv;
    identity: unknown;
    request: unknown;
  },
  dependencies: Partial<EvaluatePredictionMatrixDependencies> = {},
): Promise<PredictionMatrixResult> {
  const runtimeDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  await runtimeDependencies.assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  await runtimeDependencies.requireFeatureAccess({
    env: args.env,
    featureKey: "predictions",
    userId,
  });

  const request = normalizePredictionMatrixRequest(args.request);
  const teamALocation = request.venue === "TEAM_A_HOME" ? "HOME" : "AWAY";
  const teamBLocation = request.venue === "TEAM_B_HOME" ? "HOME" : "AWAY";
  const teamAPairs = buildPlannerPairContexts(request.teamA.ratings, teamALocation);
  const teamBPairs = buildPlannerPairContexts(request.teamB.ratings, teamBLocation);
  const selectedTeamAPairId = resolveSelectedPairId(teamAPairs, request.teamA);
  const selectedTeamBPairId = resolveSelectedPairId(teamBPairs, request.teamB);

  const plannerRequest = buildPlannerRequest({
    modelKey: request.modelKey ?? null,
    selectedTeamBPairId,
    ourIsHome: request.venue !== "TEAM_B_HOME",
    neutralSite: request.venue === "NEUTRAL",
    teamAEffortChoice: request.teamA.effortChoice,
    teamAPairs,
    teamBEffortChoice: request.teamB.effortChoice,
    teamBPairs,
  });
  let plannerResponse: unknown;
  try {
    plannerResponse = await runtimeDependencies.invokePredictionEndpoint(
      args.endpointName,
      plannerRequest,
    );
  } catch (error) {
    throw normalizePlannerEndpointInvocationError(error, args.endpointName);
  }
  const response = predictionPlannerResponseSchema.parse(plannerResponse);

  return {
    generatedAt: new Date().toISOString(),
    modelKey: response.modelKey ?? request.modelKey ?? null,
    modelVersion: response.modelVersion,
    selectedTeamAPairId,
    selectedTeamBPairId,
    teamAPairs: teamAPairs.map((pair) => ({
      defense: pair.displayDefense,
      estimated: pair.supportTier === "ESTIMATED",
      offense: pair.displayOffense,
      pairId: pair.pairId,
      supportTier: pair.supportTier,
    })),
    teamASide: {
      defense: request.teamA.defense,
      effortChoice: request.teamA.effortChoice,
      offense: request.teamA.offense,
      teamId: request.teamA.teamId,
      teamName: request.teamA.teamName,
    },
    teamBPairs: teamBPairs.map((pair) => ({
      defense: pair.displayDefense,
      estimated: pair.supportTier === "ESTIMATED",
      offense: pair.displayOffense,
      pairId: pair.pairId,
      supportTier: pair.supportTier,
    })),
    teamBSide: {
      defense: request.teamB.defense,
      effortChoice: request.teamB.effortChoice,
      offense: request.teamB.offense,
      teamId: request.teamB.teamId,
      teamName: request.teamB.teamName,
    },
    venue: request.venue,
    views: [response.expectedMatrix].map((view) => ({
      label: view.label,
      probability: view.probability ?? null,
      rows: view.rows.map((row) => ({
        cells: row.cells.map((cell) => ({
          available: cell.available,
          bestEffortChoice: cell.bestEffortChoice ?? null,
          predictedPointDiff: cell.predictedPointDiff ?? null,
          predictedTeamAScore: cell.predictedTeamScore ?? null,
          predictedTeamBScore: cell.predictedOpponentScore ?? null,
          teamAPairId: cell.ourPairId,
          teamBPairId: cell.opponentPairId,
        })),
        teamBPairId: row.opponentPairId,
      })),
      scenarioId: view.scenarioId ?? null,
      viewId: view.viewId,
    })),
  };
}

function buildPlannerPairContexts(
  ratings: TeamRatingsInput,
  teamLocation: TeamLocation,
): PlannerPairContext[] {
  return buildPlannerPairDefinitions().map((pair) => ({
    ...pair,
    ratings: applyPredictionRatingsContext({
      normalizedRatings: ratings,
      offenseStrategy: pair.predictorOffense,
      defenseStrategy: pair.predictorDefense,
      teamLocation,
    }),
  }));
}

function buildPlannerRequest(args: {
  modelKey?: string | null;
  neutralSite: boolean;
  ourIsHome: boolean;
  selectedTeamBPairId: string | null;
  teamAEffortChoice: string;
  teamAPairs: readonly PlannerPairContext[];
  teamBEffortChoice: string;
  teamBPairs: readonly PlannerPairContext[];
}): JsonRecord {
  return {
    ...(args.modelKey ? { modelKey: args.modelKey } : {}),
    plannerRequest: {
      effortChoices: [
        {
          cost: 0,
          label: normalizeEffortChoiceLabel(args.teamAEffortChoice),
          value: effortChoiceToOrdinal(args.teamAEffortChoice),
        },
      ],
      matrixOurEffort: effortChoiceToOrdinal(args.teamAEffortChoice),
      opponentScenarios: [
        {
          effortChoice: normalizeEffortChoiceLabel(args.teamBEffortChoice),
          forecastPairId:
            args.selectedTeamBPairId ??
            args.teamBPairs[0]?.pairId ??
            "Base__ManToMan",
          label: "Current opponent setup",
          opponentEffort: effortChoiceToOrdinal(args.teamBEffortChoice),
          opponentPairs: args.teamBPairs.map((pair) => ({
            defense: pair.predictorDefense,
            offense: pair.predictorOffense,
            pairId: pair.pairId,
            ratings: pair.ratings,
          })),
          probability: 1,
          scenarioId: "current",
        },
      ],
      neutralSite: args.neutralSite,
      ourIsHome: args.ourIsHome,
      ourPairs: args.teamAPairs.map((pair) => ({
        defense: pair.predictorDefense,
        offense: pair.predictorOffense,
        pairId: pair.pairId,
        ratings: pair.ratings,
      })),
    },
  };
}

function resolveSelectedPairId(
  pairs: readonly PlannerPairContext[],
  side: PredictionMatrixSideInput,
): string | null {
  return (
    pairs.find(
      (pair) =>
        [
          normalizeTacticToken(pair.displayOffense),
          normalizeTacticToken(pair.predictorOffense),
        ].includes(normalizeTacticToken(side.offense)) &&
        [
          normalizeTacticToken(pair.displayDefense),
          normalizeTacticToken(pair.predictorDefense),
        ].includes(normalizeTacticToken(side.defense)),
    )?.pairId ?? null
  );
}

function normalizePredictionMatrixRequest(input: unknown): PredictionMatrixRequest {
  const record = requireRecord(parseJsonInput(input), "Prediction matrix request");
  return {
    modelKey: normalizePredictionModelKey(asOptionalString(record.modelKey)),
    teamA: normalizePredictionMatrixSide(record.teamA, "Team A"),
    teamB: normalizePredictionMatrixSide(record.teamB, "Team B"),
    venue: normalizePredictionVenue(record.venue),
  };
}

function normalizePredictionMatrixSide(
  value: unknown,
  fallbackName: string,
): PredictionMatrixSideInput {
  const record = requireRecord(value, `${fallbackName} input`);
  return {
    defense: normalizeDisplayValue(record.defense, "Man to man"),
    effortChoice: normalizeEffortChoiceLabel(record.effortChoice),
    offense: normalizeDisplayValue(record.offense, "Base Offense"),
    ratings: normalizeTeamRatings(requireRecord(record.ratings, `${fallbackName} ratings`)),
    teamId: asOptionalString(record.teamId),
    teamName: asOptionalString(record.teamName) ?? fallbackName,
  };
}

function normalizeTeamRatings(input: JsonRecord): TeamRatingsInput {
  return {
    outsideScoring: requireNumber(input.outsideScoring, "outsideScoring"),
    insideScoring: requireNumber(input.insideScoring, "insideScoring"),
    outsideDefense: requireNumber(input.outsideDefense, "outsideDefense"),
    insideDefense: requireNumber(input.insideDefense, "insideDefense"),
    rebounding: requireNumber(input.rebounding, "rebounding"),
    offensiveFlow: requireNumber(input.offensiveFlow, "offensiveFlow"),
  };
}

function normalizePredictionVenue(value: unknown): PredictionVenue {
  const normalizedValue = asOptionalString(value);
  if (normalizedValue === "TEAM_A_HOME") {
    return "TEAM_A_HOME";
  }
  if (normalizedValue === "TEAM_B_HOME") {
    return "TEAM_B_HOME";
  }
  return "NEUTRAL";
}

function normalizeDisplayValue(value: unknown, fallback: string): string {
  return asOptionalString(value) ?? fallback;
}

function normalizeEffortChoiceLabel(value: unknown): string {
  switch (normalizeComparableValue(value)) {
    case "take it easy":
    case "tie":
      return "Take It Easy";
    case "crunch time":
    case "ct":
      return "Crunch Time";
    default:
      return "Normal";
  }
}

function normalizeComparableValue(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeTacticToken(value: unknown): string {
  return normalizeComparableValue(value).replace(/[^a-z0-9]/g, "");
}

function resolveUserId(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }
  const sub = (identity as { sub?: unknown }).sub;
  return typeof sub === "string" && sub.trim() ? sub : null;
}

async function invokePredictionEndpoint(
  endpointName: string,
  payload: JsonRecord,
): Promise<JsonRecord> {
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
  const parsed = rawBody ? JSON.parse(rawBody) : null;
  return requireRecord(parsed, "prediction matrix response");
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonInput(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
