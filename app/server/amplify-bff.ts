import { getServerDataClient } from "@/app/server/amplify-server";

type ErrorPayload = {
  message?: string;
};

type OperationResult<TData> = {
  data?: TData | null;
  errors?: ReadonlyArray<ErrorPayload> | null;
  nextToken?: string | null;
};

type OperationInput = Record<string, unknown>;
type QueryOperation = (
  input?: OperationInput,
) => Promise<OperationResult<unknown>>;
type MutationOperation = (
  input?: OperationInput,
) => Promise<OperationResult<unknown>>;

type QueryName = keyof typeof queryOperations;
type MutationName = keyof typeof mutationOperations;

const runtime = {
  getServerDataClient,
};

export const __testing = {
  runtime,
};

const queryOperations = {
  evaluateLineupHelper: async (input) =>
    (await runtime.getServerDataClient()).queries.evaluateLineupHelper(
      requiredInput(input) as never,
    ),
  getBillingSummary: async () => (await runtime.getServerDataClient()).queries.getBillingSummary(),
  getHomeWorkspace: async (input) =>
    (await runtime.getServerDataClient()).queries.getHomeWorkspace(
      optionalInput(input) as never,
    ),
  getLeagueHistory: async (input) =>
    (await runtime.getServerDataClient()).queries.getLeagueHistory(
      optionalInput(input) as never,
    ),
  getLeagueIntel: async (input) =>
    ((await runtime.getServerDataClient()).queries.getLeagueIntel as (
      queryInput?: OperationInput,
    ) => Promise<OperationResult<unknown>>)(optionalInput(input)),
  getLatestNextGameRecommendation: async (input) =>
    (await runtime.getServerDataClient()).queries.getLatestNextGameRecommendation(
      requiredInput(input) as never,
    ),
  getLatestOpponentForecast: async (input) =>
    (await runtime.getServerDataClient()).queries.getLatestOpponentForecast(
      requiredInput(input) as never,
    ),
  getLineupHelperWorkspace: async (input) =>
    ((await runtime.getServerDataClient()).queries.getLineupHelperWorkspace as (
      queryInput?: OperationInput,
    ) => Promise<OperationResult<unknown>>)(optionalInput(input)),
  getMatchBoxscoreDetails: async (input) =>
    (await runtime.getServerDataClient()).queries.getMatchBoxscoreDetails(
      requiredInput(input) as never,
    ),
  getMyTeamHighlights: async (input) =>
    (await runtime.getServerDataClient()).queries.getMyTeamHighlights(
      optionalInput(input) as never,
    ),
  getPlayerLab: async (input) =>
    ((await runtime.getServerDataClient()).queries.getPlayerLab as (
      queryInput?: OperationInput,
    ) => Promise<OperationResult<unknown>>)(optionalInput(input)),
  getPlayerTrend: async (input) =>
    (await runtime.getServerDataClient()).queries.getPlayerTrend(
      requiredInput(input) as never,
    ),
  getRivalsWorkspace: async () =>
    (await runtime.getServerDataClient()).queries.getRivalsWorkspace(),
  getSalaryProjection: async (input) =>
    (await runtime.getServerDataClient()).queries.getSalaryProjection(
      requiredInput(input) as never,
    ),
  getScoutSchedule: async (input) =>
    (await runtime.getServerDataClient()).queries.getScoutSchedule(
      optionalInput(input) as never,
    ),
  getScoutTeamSummary: async (input) =>
    (await runtime.getServerDataClient()).queries.getScoutTeamSummary(
      optionalInput(input) as never,
    ),
  listMyBillingPayments: async (input) =>
    (await runtime.getServerDataClient()).queries.listMyBillingPayments(
      optionalInput(input) as never,
    ),
  optimizeLineupHelper: async (input) =>
    (await runtime.getServerDataClient()).queries.optimizeLineupHelper(
      requiredInput(input) as never,
    ),
} satisfies Record<string, QueryOperation>;

const mutationOperations = {
  clearMyTeamHighlightsData: async () =>
    (await runtime.getServerDataClient()).mutations.clearMyTeamHighlightsData(),
  connectBbAccount: async (input) =>
    (await runtime.getServerDataClient()).mutations.connectBbAccount(
      requiredInput(input) as never,
    ),
  createBillingCheckoutSession: async (input) =>
    (await runtime.getServerDataClient()).mutations.createBillingCheckoutSession(
      optionalInput(input) as never,
    ),
  createBillingLifetimeCheckoutSession: async (input) =>
    (await runtime.getServerDataClient()).mutations.createBillingLifetimeCheckoutSession(
      optionalInput(input) as never,
    ),
  createBillingPortalSession: async (input) =>
    (await runtime.getServerDataClient()).mutations.createBillingPortalSession(
      optionalInput(input) as never,
    ),
  disconnectBbAccount: async () =>
    (await runtime.getServerDataClient()).mutations.disconnectBbAccount(),
  refreshWorkspace: async () =>
    (await runtime.getServerDataClient()).mutations.refreshWorkspace(),
  submitRivalsBackfill: async () =>
    (await runtime.getServerDataClient()).mutations.submitRivalsBackfill(),
  setBbLeagueTimeZone: async (input) =>
    (await runtime.getServerDataClient()).mutations.setBbLeagueTimeZone(
      requiredInput(input) as never,
    ),
  submitGameDayRecap: async (input) =>
    (await runtime.getServerDataClient()).mutations.submitGameDayRecap(
      requiredInput(input) as never,
    ),
  submitLeagueHistoryBackfill: async (input) =>
    (await runtime.getServerDataClient()).mutations.submitLeagueHistoryBackfill(
      optionalInput(input) as never,
    ),
  submitLeagueGameDayRecap: async (input) =>
    (await runtime.getServerDataClient()).mutations.submitLeagueGameDayRecap(
      requiredInput(input) as never,
    ),
  submitMyTeamHighlightsScan: async () =>
    (await runtime.getServerDataClient()).mutations.submitMyTeamHighlightsScan(),
  submitNextGameRecommendationJob: async (input) =>
    (await runtime.getServerDataClient()).mutations.submitNextGameRecommendationJob(
      requiredInput(input) as never,
    ),
  submitOpponentForecastJob: async (input) =>
    (await runtime.getServerDataClient()).mutations.submitOpponentForecastJob(
      requiredInput(input) as never,
    ),
  submitPredictionJob: async (input) =>
    (await runtime.getServerDataClient()).mutations.submitPredictionJob(
      requiredInput(input) as never,
    ),
  submitSingleGameSummary: async (input) =>
    (await runtime.getServerDataClient()).mutations.submitSingleGameSummary(
      requiredInput(input) as never,
    ),
} satisfies Record<string, MutationOperation>;

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
  return queryOperations[name](input);
}

export async function runMutationOperation(
  name: MutationName,
  input?: OperationInput,
): Promise<OperationResult<unknown>> {
  return mutationOperations[name](input);
}

function optionalInput(input?: OperationInput): OperationInput {
  return input ?? {};
}

function requiredInput(input?: OperationInput): OperationInput {
  if (!input || Array.isArray(input)) {
    throw new Error("Request body must be an object.");
  }

  return input;
}
