"use client";

import type { Schema } from "@/amplify/data/resource";
import type {
  BbConnectionRecord,
  OperationsActivity,
  PaginatedResult,
  PredictionJobRecord,
  RecapHistoryRecord,
} from "@/app/types";

type AmplifyLikeError = {
  message?: string;
};

type AmplifyLikeResult<TData> = {
  data?: TData | null;
  errors?: AmplifyLikeError[] | null;
  nextToken?: string | null;
};

type JsonObject = Record<string, unknown>;
type ReadOperationName =
  | "getCurrentBbConnection"
  | "getOperationsActivity"
  | "getPredictionHistory"
  | "getRecapHistory";
type QueryOperationName =
  | "evaluateLineupHelper"
  | "getBillingSummary"
  | "getHomeWorkspace"
  | "getLeagueHistory"
  | "getLeagueIntel"
  | "getLatestOpponentForecast"
  | "getLineupHelperWorkspace"
  | "getMatchBoxscoreDetails"
  | "getMyTeamHighlights"
  | "getPlayerLab"
  | "getPlayerTrend"
  | "getRivalsWorkspace"
  | "getSalaryProjection"
  | "getScoutWorkspace"
  | "listMyBillingPayments"
  | "getTeamHub";
type MutationOperationName =
  | "connectBbAccount"
  | "createBillingCheckoutSession"
  | "createBillingLifetimeCheckoutSession"
  | "createBillingPortalSession"
  | "disconnectBbAccount"
  | "refreshWorkspace"
  | "setBbLeagueTimeZone"
  | "submitGameDayRecap"
  | "submitLeagueHistoryBackfill"
  | "submitLeagueGameDayRecap"
  | "submitMyTeamHighlightsScan"
  | "submitOpponentForecastJob"
  | "submitPredictionJob"
  | "submitSingleGameSummary";
type OperationResult<TName extends QueryOperationName | MutationOperationName> =
  NonNullable<Schema[TName]["returnType"]>;
type ReadResult<TName extends ReadOperationName> =
  TName extends "getCurrentBbConnection"
    ? BbConnectionRecord | null
    : TName extends "getOperationsActivity"
      ? OperationsActivity
      : TName extends "getPredictionHistory"
        ? PaginatedResult<PredictionJobRecord>
        : TName extends "getRecapHistory"
          ? PaginatedResult<RecapHistoryRecord>
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
  input?: JsonObject,
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
  input?: JsonObject,
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
  input?: JsonObject,
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
    getOperationsActivity: (input?: { limit?: number }) =>
      requestRead("getOperationsActivity", input),
    getPredictionHistory: (input?: {
      limit?: number;
      nextToken?: string | null;
    }) => requestRead("getPredictionHistory", input),
    getRecapHistory: (input?: { limit?: number; nextToken?: string | null }) =>
      requestRead("getRecapHistory", input),
  },
  mutations: {
    connectBbAccount: (input: JsonObject) =>
      requestMutation("connectBbAccount", input),
    createBillingCheckoutSession: (input?: JsonObject) =>
      requestMutation("createBillingCheckoutSession", input),
    createBillingLifetimeCheckoutSession: (input?: JsonObject) =>
      requestMutation("createBillingLifetimeCheckoutSession", input),
    createBillingPortalSession: (input?: JsonObject) =>
      requestMutation("createBillingPortalSession", input),
    disconnectBbAccount: () => requestMutation("disconnectBbAccount"),
    refreshWorkspace: () => requestMutation("refreshWorkspace"),
    setBbLeagueTimeZone: (input: JsonObject) =>
      requestMutation("setBbLeagueTimeZone", input),
    submitGameDayRecap: (input: JsonObject) =>
      requestMutation("submitGameDayRecap", input),
    submitLeagueHistoryBackfill: (input?: JsonObject) =>
      requestMutation("submitLeagueHistoryBackfill", input),
    submitLeagueGameDayRecap: (input: JsonObject) =>
      requestMutation("submitLeagueGameDayRecap", input),
    submitMyTeamHighlightsScan: () =>
      requestMutation("submitMyTeamHighlightsScan"),
    submitOpponentForecastJob: (input: JsonObject) =>
      requestMutation("submitOpponentForecastJob", input),
    submitPredictionJob: (input: JsonObject) =>
      requestMutation("submitPredictionJob", input),
    submitSingleGameSummary: (input: JsonObject) =>
      requestMutation("submitSingleGameSummary", input),
  },
  queries: {
    evaluateLineupHelper: (input: JsonObject) =>
      requestQuery("evaluateLineupHelper", input),
    getBillingSummary: () => requestQuery("getBillingSummary"),
    getHomeWorkspace: () => requestQuery("getHomeWorkspace"),
    getLeagueHistory: (input?: JsonObject) =>
      requestQuery("getLeagueHistory", input),
    getLeagueIntel: () => requestQuery("getLeagueIntel"),
    getLatestOpponentForecast: (input: JsonObject) =>
      requestQuery("getLatestOpponentForecast", input),
    getLineupHelperWorkspace: () => requestQuery("getLineupHelperWorkspace"),
    getMatchBoxscoreDetails: (input: JsonObject) =>
      requestQuery("getMatchBoxscoreDetails", input),
    getMyTeamHighlights: (input: JsonObject) =>
      requestQuery("getMyTeamHighlights", input),
    getPlayerLab: () => requestQuery("getPlayerLab"),
    getPlayerTrend: (input: JsonObject) =>
      requestQuery("getPlayerTrend", input),
    getRivalsWorkspace: () => requestQuery("getRivalsWorkspace"),
    getSalaryProjection: (input: JsonObject) =>
      requestQuery("getSalaryProjection", input),
    getScoutWorkspace: (input?: JsonObject) =>
      requestQuery("getScoutWorkspace", input),
    listMyBillingPayments: (input?: JsonObject) =>
      requestQuery("listMyBillingPayments", input),
    getTeamHub: () => requestQuery("getTeamHub"),
  },
};
