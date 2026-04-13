"use client";

import type { Schema } from "@/amplify/data/resource";
import type {
  BbConnectionRecord,
  CurrentPredictionPreview,
  OperationsActivity,
  PaginatedResult,
  RecapHistoryRecord,
} from "@/app/types";

type AmplifyLikeError = {
  message?: string;
};

type MaintenancePayload = {
  maintenance?: {
    active?: boolean;
    state?: {
      detail?: string;
      headline?: string;
      reasonCode?: string;
    };
  };
};

type AmplifyLikeResult<TData> = {
  data?: TData | null;
  errors?: AmplifyLikeError[] | null;
  maintenance?: MaintenancePayload["maintenance"];
  nextToken?: string | null;
};

type ReadOperationName =
  | "getCurrentBbConnection"
  | "getCurrentPrediction"
  | "getOperationsActivity"
  | "getRecapHistory";
type QueryOperationName =
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
type MutationOperationName =
  | "clearMyTeamHighlightsData"
  | "connectBbAccount"
  | "createBillingCheckoutSession"
  | "createBillingLifetimeCheckoutSession"
  | "createBillingPortalSession"
  | "disconnectBbAccount"
  | "refreshWorkspace"
  | "setBbLeagueTimeZone"
  | "submitGameDayRecap"
  | "submitRivalsBackfill"
  | "submitLeagueHistoryBackfill"
  | "submitLeagueGameDayRecap"
  | "submitMyTeamHighlightsScan"
  | "submitNextGameRecommendationJob"
  | "submitOpponentForecastJob"
  | "submitPredictionJob"
  | "submitSingleGameSummary";
type OperationResult<TName extends QueryOperationName | MutationOperationName> =
  NonNullable<Schema[TName]["returnType"]>;
type OperationInput<TName extends QueryOperationName | MutationOperationName> =
  Schema[TName] extends { args: infer TArgs } ? TArgs : never;
type ReadResult<TName extends ReadOperationName> =
  TName extends "getCurrentBbConnection"
    ? BbConnectionRecord | null
    : TName extends "getCurrentPrediction"
      ? CurrentPredictionPreview | null
      : TName extends "getOperationsActivity"
        ? OperationsActivity
        : TName extends "getRecapHistory"
          ? PaginatedResult<RecapHistoryRecord>
          : never;
type ReadInput<TName extends ReadOperationName> =
  TName extends "getCurrentBbConnection"
    ? undefined
    : TName extends "getCurrentPrediction"
      ? undefined
      : TName extends "getOperationsActivity"
        ? { limit?: number }
        : TName extends "getRecapHistory"
          ? { limit?: number; nextToken?: string | null }
          : never;

async function requestOperation<TData>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<AmplifyLikeResult<TData>> {
  try {
    const response = await fetch(input, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload) {
      return payload as AmplifyLikeResult<TData>;
    }

    if (response.status === 503 && isMaintenancePayload(payload)) {
      redirectToStatusPage();
      return payload as AmplifyLikeResult<TData>;
    }

    return {
      data: null,
      errors: [
        {
          message:
            readErrorMessage(payload) ||
            response.statusText ||
            "The request failed without a detailed error message.",
        },
      ],
    };
  } catch (error) {
    return {
      data: null,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function isMaintenancePayload(value: unknown): value is MaintenancePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maintenance = (value as MaintenancePayload).maintenance;
  return maintenance?.active === true;
}

function redirectToStatusPage(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (window.location.pathname === "/status") {
    return;
  }

  window.location.assign("/status");
}

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const firstError = Array.isArray((payload as { errors?: unknown }).errors)
    ? (payload as { errors: Array<{ message?: unknown }> }).errors[0]
    : null;
  if (typeof firstError?.message === "string" && firstError.message.trim()) {
    return firstError.message.trim();
  }

  if (typeof (payload as { message?: unknown }).message === "string") {
    return (payload as { message: string }).message.trim();
  }

  return null;
}

function requestRead<TName extends ReadOperationName>(
  name: TName,
  input?: ReadInput<TName>,
) {
  return requestOperation<ReadResult<TName>>(
    `/api/app/reads/${encodeURIComponent(name)}`,
    {
      body: input ? JSON.stringify(input) : undefined,
      method: "POST",
    },
  );
}

function requestQuery<TName extends QueryOperationName>(
  name: TName,
  input?: OperationInput<TName>,
) {
  return requestOperation<OperationResult<TName>>(
    `/api/app/queries/${encodeURIComponent(name)}`,
    {
      body: input ? JSON.stringify(input) : undefined,
      method: "POST",
    },
  );
}

function requestMutation<TName extends MutationOperationName>(
  name: TName,
  input?: OperationInput<TName>,
) {
  return requestOperation<OperationResult<TName>>(
    `/api/app/mutations/${encodeURIComponent(name)}`,
    {
      body: input ? JSON.stringify(input) : undefined,
      method: "POST",
    },
  );
}

export const client = {
  reads: {
    getCurrentBbConnection: () => requestRead("getCurrentBbConnection"),
    getCurrentPrediction: () => requestRead("getCurrentPrediction"),
    getOperationsActivity: (input?: { limit?: number }) =>
      requestRead("getOperationsActivity", input),
    getRecapHistory: (input?: { limit?: number; nextToken?: string | null }) =>
      requestRead("getRecapHistory", input),
  },
  mutations: {
    clearMyTeamHighlightsData: () =>
      requestMutation("clearMyTeamHighlightsData"),
    connectBbAccount: (input: OperationInput<"connectBbAccount">) =>
      requestMutation("connectBbAccount", input),
    createBillingCheckoutSession: (
      input?: OperationInput<"createBillingCheckoutSession">,
    ) =>
      requestMutation("createBillingCheckoutSession", input),
    createBillingLifetimeCheckoutSession: (
      input?: OperationInput<"createBillingLifetimeCheckoutSession">,
    ) =>
      requestMutation("createBillingLifetimeCheckoutSession", input),
    createBillingPortalSession: (
      input?: OperationInput<"createBillingPortalSession">,
    ) =>
      requestMutation("createBillingPortalSession", input),
    disconnectBbAccount: () => requestMutation("disconnectBbAccount"),
    refreshWorkspace: () => requestMutation("refreshWorkspace"),
    setBbLeagueTimeZone: (input: OperationInput<"setBbLeagueTimeZone">) =>
      requestMutation("setBbLeagueTimeZone", input),
    submitGameDayRecap: (input: OperationInput<"submitGameDayRecap">) =>
      requestMutation("submitGameDayRecap", input),
    submitRivalsBackfill: () => requestMutation("submitRivalsBackfill"),
    submitLeagueHistoryBackfill: (
      input?: OperationInput<"submitLeagueHistoryBackfill">,
    ) =>
      requestMutation("submitLeagueHistoryBackfill", input),
    submitLeagueGameDayRecap: (
      input: OperationInput<"submitLeagueGameDayRecap">,
    ) =>
      requestMutation("submitLeagueGameDayRecap", input),
    submitMyTeamHighlightsScan: () =>
      requestMutation("submitMyTeamHighlightsScan"),
    submitNextGameRecommendationJob: (
      input: OperationInput<"submitNextGameRecommendationJob">,
    ) =>
      requestMutation("submitNextGameRecommendationJob", input),
    submitOpponentForecastJob: (
      input: OperationInput<"submitOpponentForecastJob">,
    ) =>
      requestMutation("submitOpponentForecastJob", input),
    submitPredictionJob: (input: OperationInput<"submitPredictionJob">) =>
      requestMutation("submitPredictionJob", input),
    submitSingleGameSummary: (input: OperationInput<"submitSingleGameSummary">) =>
      requestMutation("submitSingleGameSummary", input),
  },
  queries: {
    evaluatePredictionMatrix: (
      input: OperationInput<"evaluatePredictionMatrix">,
    ) =>
      requestQuery("evaluatePredictionMatrix", input),
    evaluateLineupHelper: (input: OperationInput<"evaluateLineupHelper">) =>
      requestQuery("evaluateLineupHelper", input),
    getBillingSummary: () => requestQuery("getBillingSummary"),
    getHomeWorkspace: (input?: OperationInput<"getHomeWorkspace">) =>
      requestQuery("getHomeWorkspace", input),
    getLeagueHistory: (input?: OperationInput<"getLeagueHistory">) =>
      requestQuery("getLeagueHistory", input),
    getLeagueIntel: (input?: OperationInput<"getLeagueIntel">) =>
      requestQuery("getLeagueIntel", input),
    getLatestNextGameRecommendation: (
      input: OperationInput<"getLatestNextGameRecommendation">,
    ) =>
      requestQuery("getLatestNextGameRecommendation", input),
    getNextGamePlannerDetail: (
      input: OperationInput<"getNextGamePlannerDetail">,
    ) =>
      requestQuery("getNextGamePlannerDetail", input),
    getLatestOpponentForecast: (
      input: OperationInput<"getLatestOpponentForecast">,
    ) =>
      requestQuery("getLatestOpponentForecast", input),
    getLineupHelperWorkspace: (
      input?: OperationInput<"getLineupHelperWorkspace">,
    ) =>
      requestQuery("getLineupHelperWorkspace", input),
    getMatchBoxscoreDetails: (
      input: OperationInput<"getMatchBoxscoreDetails">,
    ) =>
      requestQuery("getMatchBoxscoreDetails", input),
    getMyTeamHighlights: (input: OperationInput<"getMyTeamHighlights">) =>
      requestQuery("getMyTeamHighlights", input),
    getPlayerLab: (input?: OperationInput<"getPlayerLab">) =>
      requestQuery("getPlayerLab", input),
    getPlayerTrend: (input: OperationInput<"getPlayerTrend">) =>
      requestQuery("getPlayerTrend", input),
    getRivalsWorkspace: (input?: OperationInput<"getRivalsWorkspace">) =>
      requestQuery("getRivalsWorkspace", input),
    getSalaryProjection: (input: OperationInput<"getSalaryProjection">) =>
      requestQuery("getSalaryProjection", input),
    getScoutSchedule: (input?: OperationInput<"getScoutSchedule">) =>
      requestQuery("getScoutSchedule", input),
    getScoutTeamSummary: (input?: OperationInput<"getScoutTeamSummary">) =>
      requestQuery("getScoutTeamSummary", input),
    listAccessibleMatches: (input?: OperationInput<"listAccessibleMatches">) =>
      requestQuery("listAccessibleMatches", input),
    listMyBillingPayments: (input?: OperationInput<"listMyBillingPayments">) =>
      requestQuery("listMyBillingPayments", input),
    optimizeLineupHelper: (input: OperationInput<"optimizeLineupHelper">) =>
      requestQuery("optimizeLineupHelper", input),
  },
};
