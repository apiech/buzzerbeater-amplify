import type { Schema } from "@/amplify/data/resource";
import { getServerDataClient } from "@/app/server/amplify-server";

type ErrorPayload = {
  message?: string;
};

type OperationResult<TData> = {
  data?: TData | null;
  errors?: ReadonlyArray<ErrorPayload> | null;
  nextToken?: string | null;
};

type QueryName =
  | "evaluatePredictionMatrix"
  | "evaluateLineupHelper"
  | "getBillingSummary"
  | "getHomeWorkspace"
  | "getLeagueHistory"
  | "getLeagueIntel"
  | "getLatestNextGameRecommendation"
  | "getNextGamePlannerDetail"
  | "getLatestOpponentForecast"
  | "getLineupHelperWorkspace"
  | "getMatchBoxscoreDetails"
  | "getMyTeamHighlights"
  | "getPlayerLab"
  | "getPlayerTrend"
  | "getRivalsWorkspace"
  | "getSalaryProjection"
  | "getScoutSchedule"
  | "getScoutTeamSummary"
  | "listAccessibleMatches"
  | "listMyBillingPayments"
  | "optimizeLineupHelper";
type MutationName =
  | "clearMyTeamHighlightsData"
  | "connectBbAccount"
  | "createBillingCheckoutSession"
  | "createBillingLifetimeCheckoutSession"
  | "createBillingPortalSession"
  | "disconnectBbAccount"
  | "refreshWorkspace"
  | "submitRivalsBackfill"
  | "setBbLeagueTimeZone"
  | "submitGameDayRecap"
  | "submitLeagueHistoryBackfill"
  | "submitLeagueGameDayRecap"
  | "submitMyTeamHighlightsScan"
  | "submitNextGameRecommendationJob"
  | "submitOpponentForecastJob"
  | "submitPredictionJob"
  | "submitSingleGameSummary";
type QueryInput<TName extends QueryName | MutationName> = Schema[TName] extends {
  args: infer TArgs;
}
  ? TArgs
  : never;
type QueryOutput<TName extends QueryName | MutationName> = Schema[TName] extends {
  returnType: infer TReturn;
}
  ? TReturn
  : never;
type OperationInput = Record<string, unknown>;

const runtime = {
  getServerDataClient,
};

export const __testing = {
  runtime,
};

const queryOperations = {
  evaluatePredictionMatrix: async (
    input: QueryInput<"evaluatePredictionMatrix">,
  ) =>
    (await runtime.getServerDataClient()).queries.evaluatePredictionMatrix(
      requiredInput(input),
    ),
  evaluateLineupHelper: async (
    input: QueryInput<"evaluateLineupHelper">,
  ) =>
    (await runtime.getServerDataClient()).queries.evaluateLineupHelper(
      requiredInput(input),
    ),
  getBillingSummary: async () =>
    (await runtime.getServerDataClient()).queries.getBillingSummary(),
  getHomeWorkspace: async (input?: QueryInput<"getHomeWorkspace">) =>
    (await runtime.getServerDataClient()).queries.getHomeWorkspace(
      optionalInput(input),
    ),
  getLeagueHistory: async (input?: QueryInput<"getLeagueHistory">) =>
    (await runtime.getServerDataClient()).queries.getLeagueHistory(
      optionalInput(input),
    ),
  getLeagueIntel: async (input?: QueryInput<"getLeagueIntel">) =>
    (
      (await runtime.getServerDataClient()).queries.getLeagueIntel as (
        queryInput?: QueryInput<"getLeagueIntel">,
      ) => Promise<OperationResult<QueryOutput<"getLeagueIntel">>>
    )(optionalInput(input)),
  getLatestNextGameRecommendation: async (
    input: QueryInput<"getLatestNextGameRecommendation">,
  ) =>
    (
      await runtime.getServerDataClient()
    ).queries.getLatestNextGameRecommendation(requiredInput(input)),
  getNextGamePlannerDetail: async (
    input: QueryInput<"getNextGamePlannerDetail">,
  ) =>
    (await runtime.getServerDataClient()).queries.getNextGamePlannerDetail(
      requiredInput(input),
    ),
  getLatestOpponentForecast: async (
    input: QueryInput<"getLatestOpponentForecast">,
  ) =>
    (await runtime.getServerDataClient()).queries.getLatestOpponentForecast(
      requiredInput(input),
    ),
  getLineupHelperWorkspace: async (
    input?: QueryInput<"getLineupHelperWorkspace">,
  ) =>
    (
      (await runtime.getServerDataClient()).queries
        .getLineupHelperWorkspace as (
        queryInput?: QueryInput<"getLineupHelperWorkspace">,
      ) => Promise<OperationResult<QueryOutput<"getLineupHelperWorkspace">>>
    )(optionalInput(input)),
  getMatchBoxscoreDetails: async (
    input: QueryInput<"getMatchBoxscoreDetails">,
  ) =>
    (await runtime.getServerDataClient()).queries.getMatchBoxscoreDetails(
      requiredInput(input),
    ),
  getMyTeamHighlights: async (input?: QueryInput<"getMyTeamHighlights">) =>
    (await runtime.getServerDataClient()).queries.getMyTeamHighlights(
      optionalInput(input),
    ),
  getPlayerLab: async (input?: QueryInput<"getPlayerLab">) =>
    (
      (await runtime.getServerDataClient()).queries.getPlayerLab as (
        queryInput?: QueryInput<"getPlayerLab">,
      ) => Promise<OperationResult<QueryOutput<"getPlayerLab">>>
    )(optionalInput(input)),
  getPlayerTrend: async (input: QueryInput<"getPlayerTrend">) =>
    (await runtime.getServerDataClient()).queries.getPlayerTrend(
      requiredInput(input),
    ),
  getRivalsWorkspace: async (input?: QueryInput<"getRivalsWorkspace">) =>
    (
      (await runtime.getServerDataClient()).queries.getRivalsWorkspace as (
        queryInput?: QueryInput<"getRivalsWorkspace">,
      ) => Promise<OperationResult<QueryOutput<"getRivalsWorkspace">>>
    )(optionalInput(input)),
  getSalaryProjection: async (input: QueryInput<"getSalaryProjection">) =>
    (await runtime.getServerDataClient()).queries.getSalaryProjection(
      requiredInput(input),
    ),
  getScoutSchedule: async (input?: QueryInput<"getScoutSchedule">) =>
    (await runtime.getServerDataClient()).queries.getScoutSchedule(
      optionalInput(input),
    ),
  getScoutTeamSummary: async (input?: QueryInput<"getScoutTeamSummary">) =>
    (await runtime.getServerDataClient()).queries.getScoutTeamSummary(
      optionalInput(input),
    ),
  listAccessibleMatches: async (input?: QueryInput<"listAccessibleMatches">) =>
    (await runtime.getServerDataClient()).queries.listAccessibleMatches(
      optionalInput(input),
    ),
  listMyBillingPayments: async (input?: QueryInput<"listMyBillingPayments">) =>
    (await runtime.getServerDataClient()).queries.listMyBillingPayments(
      optionalInput(input),
    ),
  optimizeLineupHelper: async (
    input: QueryInput<"optimizeLineupHelper">,
  ) =>
    (await runtime.getServerDataClient()).queries.optimizeLineupHelper(
      requiredInput(input),
    ),
};

const mutationOperations = {
  clearMyTeamHighlightsData: async () =>
    (await runtime.getServerDataClient()).mutations.clearMyTeamHighlightsData(),
  connectBbAccount: async (input: QueryInput<"connectBbAccount">) =>
    (await runtime.getServerDataClient()).mutations.connectBbAccount(
      requiredInput(input),
    ),
  createBillingCheckoutSession: async (
    input?: QueryInput<"createBillingCheckoutSession">,
  ) =>
    (
      await runtime.getServerDataClient()
    ).mutations.createBillingCheckoutSession(optionalInput(input)),
  createBillingLifetimeCheckoutSession: async (
    input?: QueryInput<"createBillingLifetimeCheckoutSession">,
  ) =>
    (
      await runtime.getServerDataClient()
    ).mutations.createBillingLifetimeCheckoutSession(
      optionalInput(input),
    ),
  createBillingPortalSession: async (
    input?: QueryInput<"createBillingPortalSession">,
  ) =>
    (await runtime.getServerDataClient()).mutations.createBillingPortalSession(
      optionalInput(input),
    ),
  disconnectBbAccount: async () =>
    (await runtime.getServerDataClient()).mutations.disconnectBbAccount(),
  refreshWorkspace: async () =>
    (await runtime.getServerDataClient()).mutations.refreshWorkspace(),
  submitRivalsBackfill: async () =>
    (await runtime.getServerDataClient()).mutations.submitRivalsBackfill(),
  setBbLeagueTimeZone: async (input: QueryInput<"setBbLeagueTimeZone">) =>
    (await runtime.getServerDataClient()).mutations.setBbLeagueTimeZone(
      requiredInput(input),
    ),
  submitGameDayRecap: async (input: QueryInput<"submitGameDayRecap">) =>
    (await runtime.getServerDataClient()).mutations.submitGameDayRecap(
      requiredInput(input),
    ),
  submitLeagueHistoryBackfill: async (
    input?: QueryInput<"submitLeagueHistoryBackfill">,
  ) =>
    (await runtime.getServerDataClient()).mutations.submitLeagueHistoryBackfill(
      optionalInput(input),
    ),
  submitLeagueGameDayRecap: async (
    input: QueryInput<"submitLeagueGameDayRecap">,
  ) =>
    (await runtime.getServerDataClient()).mutations.submitLeagueGameDayRecap(
      requiredInput(input),
    ),
  submitMyTeamHighlightsScan: async () =>
    (
      await runtime.getServerDataClient()
    ).mutations.submitMyTeamHighlightsScan(),
  submitNextGameRecommendationJob: async (
    input: QueryInput<"submitNextGameRecommendationJob">,
  ) =>
    (
      await runtime.getServerDataClient()
    ).mutations.submitNextGameRecommendationJob(requiredInput(input)),
  submitOpponentForecastJob: async (
    input: QueryInput<"submitOpponentForecastJob">,
  ) =>
    (await runtime.getServerDataClient()).mutations.submitOpponentForecastJob(
      requiredInput(input),
    ),
  submitPredictionJob: async (input: QueryInput<"submitPredictionJob">) =>
    (await runtime.getServerDataClient()).mutations.submitPredictionJob(
      requiredInput(input),
    ),
  submitSingleGameSummary: async (
    input: QueryInput<"submitSingleGameSummary">,
  ) =>
    (await runtime.getServerDataClient()).mutations.submitSingleGameSummary(
      requiredInput(input),
    ),
};

export function isQueryName(value: string): value is QueryName {
  return value in queryOperations;
}

export function isMutationName(value: string): value is MutationName {
  return value in mutationOperations;
}

export async function runQueryOperation(
  name: QueryName,
  input?: OperationInput,
): Promise<OperationResult<unknown>> {
  return (queryOperations[name] as (queryInput?: OperationInput) => Promise<
    OperationResult<unknown>
  >)(input);
}

export async function runMutationOperation(
  name: MutationName,
  input?: OperationInput,
): Promise<OperationResult<unknown>> {
  return (mutationOperations[name] as (
    mutationInput?: OperationInput,
  ) => Promise<OperationResult<unknown>>)(input);
}

function optionalInput<TInput extends OperationInput | undefined>(
  input?: TInput,
): Exclude<TInput, undefined> | {} {
  return (input ?? {}) as Exclude<TInput, undefined> | {};
}

function requiredInput<TInput extends OperationInput>(
  input?: TInput,
): TInput {
  if (!input || Array.isArray(input)) {
    throw new Error("Request body must be an object.");
  }

  return input;
}
