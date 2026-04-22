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
  | "getArenaWorkspace"
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
  | "getManualSalaryEstimate"
  | "getPlayerLab"
  | "getPlayerTrend"
  | "getRivalsWorkspace"
  | "getSalaryCalculatorSeed"
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
  | "repairOwnerRosterData"
  | "refreshWorkspace"
  | "submitRivalsBackfill"
  | "setBbLeagueTimeZone"
  | "submitProductFeedback"
  | "submitGameDayRecap"
  | "submitLeagueHistoryBackfill"
  | "submitLeagueGameDayRecap"
  | "submitLeagueGameDayPerformances"
  | "submitMyTeamHighlightsScan"
  | "submitNextGameRecommendationJob"
  | "submitOpponentForecastJob"
  | "submitPredictionJob"
  | "submitSingleGameSummary";
type QueryInput<TName extends QueryName | MutationName> =
  Schema[TName] extends {
    args: infer TArgs;
  }
    ? TArgs
    : never;
type QueryOutput<TName extends QueryName | MutationName> =
  Schema[TName] extends {
    returnType: infer TReturn;
  }
    ? TReturn
    : never;
type OperationInput = Record<string, unknown>;

const runtime = {
  getServerDataClient,
};
const logger = {
  error: (event: string, details: Record<string, unknown>) =>
    writeAppBffLog("ERROR", event, details),
  info: (event: string, details: Record<string, unknown>) =>
    writeAppBffLog("INFO", event, details),
};

export const __testing = {
  logger,
  runtime,
};

const queryOperations = {
  evaluatePredictionMatrix: async (
    input: QueryInput<"evaluatePredictionMatrix">,
  ) =>
    (await runtime.getServerDataClient()).queries.evaluatePredictionMatrix(
      requiredInput(input),
    ),
  evaluateLineupHelper: async (input: QueryInput<"evaluateLineupHelper">) =>
    (await runtime.getServerDataClient()).queries.evaluateLineupHelper(
      requiredInput(input),
    ),
  getArenaWorkspace: async (input?: QueryInput<"getArenaWorkspace">) =>
    (await runtime.getServerDataClient()).queries.getArenaWorkspace(
      optionalInput(input),
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
  getManualSalaryEstimate: async (
    input: QueryInput<"getManualSalaryEstimate">,
  ) =>
    (await runtime.getServerDataClient()).queries.getManualSalaryEstimate(
      requiredInput(input),
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
  getSalaryCalculatorSeed: async (
    input: QueryInput<"getSalaryCalculatorSeed">,
  ) =>
    (await runtime.getServerDataClient()).queries.getSalaryCalculatorSeed(
      requiredInput(input),
    ),
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
  optimizeLineupHelper: async (input: QueryInput<"optimizeLineupHelper">) =>
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
    ).mutations.createBillingLifetimeCheckoutSession(optionalInput(input)),
  createBillingPortalSession: async (
    input?: QueryInput<"createBillingPortalSession">,
  ) =>
    (await runtime.getServerDataClient()).mutations.createBillingPortalSession(
      optionalInput(input),
    ),
  disconnectBbAccount: async () =>
    (await runtime.getServerDataClient()).mutations.disconnectBbAccount(),
  repairOwnerRosterData: async () =>
    (await runtime.getServerDataClient()).mutations.repairOwnerRosterData(),
  refreshWorkspace: async () =>
    (await runtime.getServerDataClient()).mutations.refreshWorkspace(),
  submitRivalsBackfill: async () =>
    (await runtime.getServerDataClient()).mutations.submitRivalsBackfill(),
  setBbLeagueTimeZone: async (input: QueryInput<"setBbLeagueTimeZone">) =>
    (await runtime.getServerDataClient()).mutations.setBbLeagueTimeZone(
      requiredInput(input),
    ),
  submitProductFeedback: async (input: QueryInput<"submitProductFeedback">) =>
    (await runtime.getServerDataClient()).mutations.submitProductFeedback(
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
  submitLeagueGameDayPerformances: async (
    input: QueryInput<"submitLeagueGameDayPerformances">,
  ) =>
    (
      await runtime.getServerDataClient()
    ).mutations.submitLeagueGameDayPerformances(requiredInput(input)),
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
  return runLoggedOperation("query", name, input, () =>
    (
      queryOperations[name] as (
        queryInput?: OperationInput,
      ) => Promise<OperationResult<unknown>>
    )(input),
  );
}

export async function runMutationOperation(
  name: MutationName,
  input?: OperationInput,
): Promise<OperationResult<unknown>> {
  return runLoggedOperation("mutation", name, input, () =>
    (
      mutationOperations[name] as (
        mutationInput?: OperationInput,
      ) => Promise<OperationResult<unknown>>
    )(input),
  );
}

function optionalInput<TInput extends OperationInput | undefined>(
  input?: TInput,
): Exclude<TInput, undefined> | {} {
  return (input ?? {}) as Exclude<TInput, undefined> | {};
}

function requiredInput<TInput extends OperationInput>(input?: TInput): TInput {
  if (!input || Array.isArray(input)) {
    throw new Error("Request body must be an object.");
  }

  return input;
}

async function runLoggedOperation(
  kind: "mutation" | "query",
  name: QueryName | MutationName,
  input: OperationInput | undefined,
  run: () => Promise<OperationResult<unknown>>,
): Promise<OperationResult<unknown>> {
  const startedAt = Date.now();
  const inputSummary = summarizeOperationInput(name, input);

  logger.info("appBff.operation.start", {
    kind,
    name,
    ...inputSummary,
  });

  try {
    const result = await run();
    const errorMessages = (result.errors ?? [])
      .map((error) => error.message)
      .filter((message): message is string => Boolean(message));

    logger.info("appBff.operation.completed", {
      dataPresent: result.data != null,
      elapsedMs: Date.now() - startedAt,
      errorCount: errorMessages.length,
      errorMessages,
      kind,
      name,
      ...inputSummary,
    });

    return result;
  } catch (error) {
    logger.error("appBff.operation.failed", {
      elapsedMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : null,
      kind,
      name,
      ...inputSummary,
    });
    throw error;
  }
}

function summarizeOperationInput(
  name: QueryName | MutationName,
  input: OperationInput | undefined,
): Record<string, unknown> {
  const inputKeys = Object.keys(input ?? {}).sort();

  if (name === "connectBbAccount") {
    return {
      bbLoginName:
        typeof input?.bbLoginName === "string" ? input.bbLoginName : null,
      hasAccessKey:
        typeof input?.accessKey === "string"
          ? input.accessKey.trim().length > 0
          : Boolean(input?.accessKey),
      inputKeys,
    };
  }

  return {
    inputKeys,
  };
}

function writeAppBffLog(
  level: "INFO" | "ERROR",
  event: string,
  details: Record<string, unknown>,
): void {
  const line = `[app-bff] ${JSON.stringify({
    details,
    event,
    level,
    loggedAt: new Date().toISOString(),
  })}`;

  if (level === "INFO") {
    console.log(line);
    return;
  }

  console.error(line);
}
