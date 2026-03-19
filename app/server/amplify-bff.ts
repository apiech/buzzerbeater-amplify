import { serverDataClient } from "@/app/server/amplify-server";

type ErrorPayload = {
  message?: string;
};

type OperationResult<TData> = {
  data?: TData | null;
  errors?: ReadonlyArray<ErrorPayload> | null;
  nextToken?: string | null;
};

type QueryOperation = (
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown>>;
type MutationOperation = (
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown>>;

type QueryName = keyof typeof queryOperations;
type MutationName = keyof typeof mutationOperations;

const queryOperations = {
  evaluateLineupHelper: (input) =>
    serverDataClient.queries.evaluateLineupHelper(
      requiredInput<
        Parameters<typeof serverDataClient.queries.evaluateLineupHelper>[0]
      >(input),
    ),
  getBillingSummary: () => serverDataClient.queries.getBillingSummary(),
  getHomeWorkspace: () => serverDataClient.queries.getHomeWorkspace(),
  getLeagueHistory: (input) =>
    serverDataClient.queries.getLeagueHistory(
      optionalInput<
        Parameters<typeof serverDataClient.queries.getLeagueHistory>[0]
      >(input),
    ),
  getLeagueIntel: () => serverDataClient.queries.getLeagueIntel(),
  getLatestOpponentForecast: (input) =>
    serverDataClient.queries.getLatestOpponentForecast(
      requiredInput<
        Parameters<typeof serverDataClient.queries.getLatestOpponentForecast>[0]
      >(input),
    ),
  getLineupHelperWorkspace: () =>
    serverDataClient.queries.getLineupHelperWorkspace(),
  getLineupPlan: () => serverDataClient.queries.getLineupPlan(),
  getMatchBoxscoreDetails: (input) =>
    serverDataClient.queries.getMatchBoxscoreDetails(
      requiredInput<
        Parameters<typeof serverDataClient.queries.getMatchBoxscoreDetails>[0]
      >(input),
    ),
  getMyTeamHighlights: (input) =>
    serverDataClient.queries.getMyTeamHighlights(
      optionalInput<
        Parameters<typeof serverDataClient.queries.getMyTeamHighlights>[0]
      >(input),
    ),
  getPlayerLab: () => serverDataClient.queries.getPlayerLab(),
  getPlayerTrend: (input) =>
    serverDataClient.queries.getPlayerTrend(
      requiredInput<
        Parameters<typeof serverDataClient.queries.getPlayerTrend>[0]
      >(input),
    ),
  getRivalsWorkspace: () => serverDataClient.queries.getRivalsWorkspace(),
  getSalaryProjection: (input) =>
    serverDataClient.queries.getSalaryProjection(
      requiredInput<
        Parameters<typeof serverDataClient.queries.getSalaryProjection>[0]
      >(input),
    ),
  getScoutWorkspace: (input) =>
    serverDataClient.queries.getScoutWorkspace(
      optionalInput<
        Parameters<typeof serverDataClient.queries.getScoutWorkspace>[0]
      >(input),
    ),
  listBillingPayments: (input) =>
    serverDataClient.queries.listBillingPayments(
      optionalInput<
        Parameters<typeof serverDataClient.queries.listBillingPayments>[0]
      >(input),
    ),
  getTeamHub: () => serverDataClient.queries.getTeamHub(),
} satisfies Record<string, QueryOperation>;

const mutationOperations = {
  connectBbAccount: (input) =>
    serverDataClient.mutations.connectBbAccount(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.connectBbAccount>[0]
      >(input),
    ),
  createBillingCheckoutSession: (input) =>
    serverDataClient.mutations.createBillingCheckoutSession(
      optionalInput<
        Parameters<typeof serverDataClient.mutations.createBillingCheckoutSession>[0]
      >(input),
    ),
  createBillingLifetimeCheckoutSession: (input) =>
    serverDataClient.mutations.createBillingLifetimeCheckoutSession(
      optionalInput<
        Parameters<typeof serverDataClient.mutations.createBillingLifetimeCheckoutSession>[0]
      >(input),
    ),
  createBillingPortalSession: (input) =>
    serverDataClient.mutations.createBillingPortalSession(
      optionalInput<
        Parameters<typeof serverDataClient.mutations.createBillingPortalSession>[0]
      >(input),
    ),
  disconnectBbAccount: () => serverDataClient.mutations.disconnectBbAccount(),
  refreshWorkspace: () => serverDataClient.mutations.refreshWorkspace(),
  saveLineupScenario: (input) =>
    serverDataClient.mutations.saveLineupScenario(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.saveLineupScenario>[0]
      >(input),
    ),
  setBbLeagueTimeZone: (input) =>
    serverDataClient.mutations.setBbLeagueTimeZone(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.setBbLeagueTimeZone>[0]
      >(input),
    ),
  submitGameDayRecap: (input) =>
    serverDataClient.mutations.submitGameDayRecap(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.submitGameDayRecap>[0]
      >(input),
    ),
  submitLeagueHistoryBackfill: (input) =>
    serverDataClient.mutations.submitLeagueHistoryBackfill(
      optionalInput<
        Parameters<
          typeof serverDataClient.mutations.submitLeagueHistoryBackfill
        >[0]
      >(input),
    ),
  submitLeagueGameDayRecap: (input) =>
    serverDataClient.mutations.submitLeagueGameDayRecap(
      requiredInput<
        Parameters<
          typeof serverDataClient.mutations.submitLeagueGameDayRecap
        >[0]
      >(input),
    ),
  submitMyTeamHighlightsScan: () =>
    serverDataClient.mutations.submitMyTeamHighlightsScan(),
  submitOpponentForecastJob: (input) =>
    serverDataClient.mutations.submitOpponentForecastJob(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.submitOpponentForecastJob>[0]
      >(input),
    ),
  submitPredictionJob: (input) =>
    serverDataClient.mutations.submitPredictionJob(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.submitPredictionJob>[0]
      >(input),
    ),
  submitSingleGameSummary: (input) =>
    serverDataClient.mutations.submitSingleGameSummary(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.submitSingleGameSummary>[0]
      >(input),
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
  input?: Record<string, unknown>,
): Promise<OperationResult<unknown>> {
  return queryOperations[name](input);
}

export async function runMutationOperation(
  name: MutationName,
  input?: Record<string, unknown>,
): Promise<OperationResult<unknown>> {
  return mutationOperations[name](input);
}

function optionalInput<T extends Record<string, unknown>>(
  input?: Record<string, unknown>,
): T {
  return (input ?? {}) as T;
}

function requiredInput<T extends Record<string, unknown>>(
  input?: Record<string, unknown>,
): T {
  if (!input || Array.isArray(input)) {
    throw new Error("Request body must be an object.");
  }

  return input as T;
}
