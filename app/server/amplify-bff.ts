import { getServerDataClient } from "@/app/server/amplify-server";

type ErrorPayload = {
  message?: string;
};

type OperationResult<TData> = {
  data?: TData | null;
  errors?: ReadonlyArray<ErrorPayload> | null;
  nextToken?: string | null;
};

type ServerDataClient = Awaited<ReturnType<typeof getServerDataClient>>;
type QueryOperation = (
  serverDataClient: ServerDataClient,
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown>>;
type MutationOperation = (
  serverDataClient: ServerDataClient,
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown>>;

type QueryName = keyof typeof queryOperations;
type MutationName = keyof typeof mutationOperations;

const queryOperations = {
  evaluateLineupHelper: (serverDataClient, input) =>
    serverDataClient.queries.evaluateLineupHelper(
      requiredInput<
        Parameters<ServerDataClient["queries"]["evaluateLineupHelper"]>[0]
      >(input),
    ),
  getBillingSummary: (serverDataClient) =>
    serverDataClient.queries.getBillingSummary(),
  getHomeWorkspace: (serverDataClient) =>
    serverDataClient.queries.getHomeWorkspace(),
  getLeagueHistory: (serverDataClient, input) =>
    serverDataClient.queries.getLeagueHistory(
      optionalInput<
        Parameters<ServerDataClient["queries"]["getLeagueHistory"]>[0]
      >(input),
    ),
  getLeagueIntel: (serverDataClient) => serverDataClient.queries.getLeagueIntel(),
  getLatestOpponentForecast: (serverDataClient, input) =>
    serverDataClient.queries.getLatestOpponentForecast(
      requiredInput<
        Parameters<ServerDataClient["queries"]["getLatestOpponentForecast"]>[0]
      >(input),
    ),
  getLineupHelperWorkspace: (serverDataClient) =>
    serverDataClient.queries.getLineupHelperWorkspace(),
  getMatchBoxscoreDetails: (serverDataClient, input) =>
    serverDataClient.queries.getMatchBoxscoreDetails(
      requiredInput<
        Parameters<ServerDataClient["queries"]["getMatchBoxscoreDetails"]>[0]
      >(input),
    ),
  getMyTeamHighlights: (serverDataClient, input) =>
    serverDataClient.queries.getMyTeamHighlights(
      optionalInput<
        Parameters<ServerDataClient["queries"]["getMyTeamHighlights"]>[0]
      >(input),
    ),
  getPlayerLab: (serverDataClient) => serverDataClient.queries.getPlayerLab(),
  getPlayerTrend: (serverDataClient, input) =>
    serverDataClient.queries.getPlayerTrend(
      requiredInput<
        Parameters<ServerDataClient["queries"]["getPlayerTrend"]>[0]
      >(input),
    ),
  getRivalsWorkspace: (serverDataClient) =>
    serverDataClient.queries.getRivalsWorkspace(),
  getSalaryProjection: (serverDataClient, input) =>
    serverDataClient.queries.getSalaryProjection(
      requiredInput<
        Parameters<ServerDataClient["queries"]["getSalaryProjection"]>[0]
      >(input),
    ),
  getScoutWorkspace: (serverDataClient, input) =>
    serverDataClient.queries.getScoutWorkspace(
      optionalInput<
        Parameters<ServerDataClient["queries"]["getScoutWorkspace"]>[0]
      >(input),
    ),
  listMyBillingPayments: (serverDataClient, input) =>
    serverDataClient.queries.listMyBillingPayments(
      optionalInput<
        Parameters<ServerDataClient["queries"]["listMyBillingPayments"]>[0]
      >(input),
    ),
  getTeamHub: (serverDataClient) => serverDataClient.queries.getTeamHub(),
} satisfies Record<string, QueryOperation>;

const mutationOperations = {
  connectBbAccount: (serverDataClient, input) =>
    serverDataClient.mutations.connectBbAccount(
      requiredInput<
        Parameters<ServerDataClient["mutations"]["connectBbAccount"]>[0]
      >(input),
    ),
  createBillingCheckoutSession: (serverDataClient, input) =>
    serverDataClient.mutations.createBillingCheckoutSession(
      optionalInput<
        Parameters<ServerDataClient["mutations"]["createBillingCheckoutSession"]>[0]
      >(input),
    ),
  createBillingLifetimeCheckoutSession: (serverDataClient, input) =>
    serverDataClient.mutations.createBillingLifetimeCheckoutSession(
      optionalInput<
        Parameters<
          ServerDataClient["mutations"]["createBillingLifetimeCheckoutSession"]
        >[0]
      >(input),
    ),
  createBillingPortalSession: (serverDataClient, input) =>
    serverDataClient.mutations.createBillingPortalSession(
      optionalInput<
        Parameters<ServerDataClient["mutations"]["createBillingPortalSession"]>[0]
      >(input),
    ),
  disconnectBbAccount: (serverDataClient) =>
    serverDataClient.mutations.disconnectBbAccount(),
  refreshWorkspace: (serverDataClient) =>
    serverDataClient.mutations.refreshWorkspace(),
  setBbLeagueTimeZone: (serverDataClient, input) =>
    serverDataClient.mutations.setBbLeagueTimeZone(
      requiredInput<
        Parameters<ServerDataClient["mutations"]["setBbLeagueTimeZone"]>[0]
      >(input),
    ),
  submitGameDayRecap: (serverDataClient, input) =>
    serverDataClient.mutations.submitGameDayRecap(
      requiredInput<
        Parameters<ServerDataClient["mutations"]["submitGameDayRecap"]>[0]
      >(input),
    ),
  submitLeagueHistoryBackfill: (serverDataClient, input) =>
    serverDataClient.mutations.submitLeagueHistoryBackfill(
      optionalInput<
        Parameters<ServerDataClient["mutations"]["submitLeagueHistoryBackfill"]>[0]
      >(input),
    ),
  submitLeagueGameDayRecap: (serverDataClient, input) =>
    serverDataClient.mutations.submitLeagueGameDayRecap(
      requiredInput<
        Parameters<ServerDataClient["mutations"]["submitLeagueGameDayRecap"]>[0]
      >(input),
    ),
  submitMyTeamHighlightsScan: (serverDataClient) =>
    serverDataClient.mutations.submitMyTeamHighlightsScan(),
  submitOpponentForecastJob: (serverDataClient, input) =>
    serverDataClient.mutations.submitOpponentForecastJob(
      requiredInput<
        Parameters<ServerDataClient["mutations"]["submitOpponentForecastJob"]>[0]
      >(input),
    ),
  submitPredictionJob: (serverDataClient, input) =>
    serverDataClient.mutations.submitPredictionJob(
      requiredInput<
        Parameters<ServerDataClient["mutations"]["submitPredictionJob"]>[0]
      >(input),
    ),
  submitSingleGameSummary: (serverDataClient, input) =>
    serverDataClient.mutations.submitSingleGameSummary(
      requiredInput<
        Parameters<ServerDataClient["mutations"]["submitSingleGameSummary"]>[0]
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
  const serverDataClient = await getServerDataClient();
  return queryOperations[name](serverDataClient, input);
}

export async function runMutationOperation(
  name: MutationName,
  input?: Record<string, unknown>,
): Promise<OperationResult<unknown>> {
  const serverDataClient = await getServerDataClient();
  return mutationOperations[name](serverDataClient, input);
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
