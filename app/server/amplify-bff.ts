import { serverDataClient } from "@/app/server/amplify-server";

type ErrorPayload = {
  message?: string;
};

type OperationResult<TData> = {
  data?: TData | null;
  errors?: ReadonlyArray<ErrorPayload> | null;
  nextToken?: string | null;
};

type ModelListOperation = (
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown[]>>;
type QueryOperation = (
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown>>;
type MutationOperation = (
  input?: Record<string, unknown>,
) => Promise<OperationResult<unknown>>;

type ModelName = keyof typeof modelListOperations;
type QueryName = keyof typeof queryOperations;
type MutationName = keyof typeof mutationOperations;

const modelListOperations = {
  BbConnection: (input) => serverDataClient.models.BbConnection.list(input),
  GameDayRecap: (input) => serverDataClient.models.GameDayRecap.list(input),
  LeagueGameDayRecap: (input) =>
    serverDataClient.models.LeagueGameDayRecap.list(input),
  PredictionJob: (input) => serverDataClient.models.PredictionJob.list(input),
  SavedLineupScenario: (input) =>
    serverDataClient.models.SavedLineupScenario.list(input),
  SingleGameSummary: (input) =>
    serverDataClient.models.SingleGameSummary.list(input),
  SyncRun: (input) => serverDataClient.models.SyncRun.list(input),
} satisfies Record<string, ModelListOperation>;

const queryOperations = {
  evaluateLineupHelper: (input) =>
    serverDataClient.queries.evaluateLineupHelper(
      requiredInput<
        Parameters<typeof serverDataClient.queries.evaluateLineupHelper>[0]
      >(input),
    ),
  getBillingSummary: () => serverDataClient.queries.getBillingSummary(),
  getHomeWorkspace: () => serverDataClient.queries.getHomeWorkspace(),
  getLeagueIntel: () => serverDataClient.queries.getLeagueIntel(),
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
  getTeamHub: () => serverDataClient.queries.getTeamHub(),
} satisfies Record<string, QueryOperation>;

const mutationOperations = {
  connectBbAccount: (input) =>
    serverDataClient.mutations.connectBbAccount(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.connectBbAccount>[0]
      >(input),
    ),
  createBillingCheckoutSession: () =>
    serverDataClient.mutations.createBillingCheckoutSession(),
  createBillingPortalSession: () =>
    serverDataClient.mutations.createBillingPortalSession(),
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
  submitLeagueGameDayRecap: (input) =>
    serverDataClient.mutations.submitLeagueGameDayRecap(
      requiredInput<
        Parameters<typeof serverDataClient.mutations.submitLeagueGameDayRecap>[0]
      >(input),
    ),
  submitMyTeamHighlightsScan: () =>
    serverDataClient.mutations.submitMyTeamHighlightsScan(),
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

export function isModelName(value: string): value is ModelName {
  return value in modelListOperations;
}

export function isQueryName(value: string): value is QueryName {
  return value in queryOperations;
}

export function isMutationName(value: string): value is MutationName {
  return value in mutationOperations;
}

export async function listModelRecords(
  name: ModelName,
  input?: Record<string, unknown>,
): Promise<OperationResult<unknown[]>> {
  return modelListOperations[name](input);
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
