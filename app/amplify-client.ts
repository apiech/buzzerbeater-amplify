"use client";

import type { Schema } from "@/amplify/data/resource";
import type {
  BbConnectionRecord,
  OperationsActivity,
  PaginatedResult,
  PredictionJobRecord,
  RecapHistoryRecord,
  SavedLineupScenarioRecord,
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
  | "getRecapHistory"
  | "getSavedLineupScenarios";
type QueryOperationName =
  | "evaluateLineupHelper"
  | "getBillingSummary"
  | "getHomeWorkspace"
  | "getLeagueIntel"
  | "getLineupHelperWorkspace"
  | "getLineupPlan"
  | "getMatchBoxscoreDetails"
  | "getMyTeamHighlights"
  | "getPlayerLab"
  | "getPlayerTrend"
  | "getSalaryProjection"
  | "getScoutWorkspace"
  | "getTeamHub";
type MutationOperationName =
  | "connectBbAccount"
  | "createBillingCheckoutSession"
  | "createBillingPortalSession"
  | "disconnectBbAccount"
  | "refreshWorkspace"
  | "saveLineupScenario"
  | "setBbLeagueTimeZone"
  | "submitGameDayRecap"
  | "submitLeagueGameDayRecap"
  | "submitMyTeamHighlightsScan"
  | "submitPredictionJob"
  | "submitSingleGameSummary";
type OperationResult<TName extends QueryOperationName | MutationOperationName> =
  NonNullable<Schema[TName]["returnType"]>;
type ReadResult<TName extends ReadOperationName> =
  TName extends "getCurrentBbConnection" ? BbConnectionRecord | null
  : TName extends "getOperationsActivity" ? OperationsActivity
  : TName extends "getPredictionHistory" ? PaginatedResult<PredictionJobRecord>
  : TName extends "getRecapHistory" ? PaginatedResult<RecapHistoryRecord>
  : TName extends "getSavedLineupScenarios"
    ? PaginatedResult<SavedLineupScenarioRecord>
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
    getRecapHistory: (input?: {
      limit?: number;
      nextToken?: string | null;
    }) => requestRead("getRecapHistory", input),
    getSavedLineupScenarios: (input?: {
      limit?: number;
      nextToken?: string | null;
    }) => requestRead("getSavedLineupScenarios", input),
  },
  mutations: {
    connectBbAccount: (input: JsonObject) =>
      requestMutation("connectBbAccount", input),
    createBillingCheckoutSession: () =>
      requestMutation("createBillingCheckoutSession"),
    createBillingPortalSession: () =>
      requestMutation("createBillingPortalSession"),
    disconnectBbAccount: () => requestMutation("disconnectBbAccount"),
    refreshWorkspace: () => requestMutation("refreshWorkspace"),
    saveLineupScenario: (input: JsonObject) =>
      requestMutation("saveLineupScenario", input),
    setBbLeagueTimeZone: (input: JsonObject) =>
      requestMutation("setBbLeagueTimeZone", input),
    submitGameDayRecap: (input: JsonObject) =>
      requestMutation("submitGameDayRecap", input),
    submitLeagueGameDayRecap: (input: JsonObject) =>
      requestMutation("submitLeagueGameDayRecap", input),
    submitMyTeamHighlightsScan: () =>
      requestMutation("submitMyTeamHighlightsScan"),
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
    getLeagueIntel: () => requestQuery("getLeagueIntel"),
    getLineupHelperWorkspace: () => requestQuery("getLineupHelperWorkspace"),
    getLineupPlan: () => requestQuery("getLineupPlan"),
    getMatchBoxscoreDetails: (input: JsonObject) =>
      requestQuery("getMatchBoxscoreDetails", input),
    getMyTeamHighlights: (input: JsonObject) =>
      requestQuery("getMyTeamHighlights", input),
    getPlayerLab: () => requestQuery("getPlayerLab"),
    getPlayerTrend: (input: JsonObject) =>
      requestQuery("getPlayerTrend", input),
    getSalaryProjection: (input: JsonObject) =>
      requestQuery("getSalaryProjection", input),
    getScoutWorkspace: (input?: JsonObject) =>
      requestQuery("getScoutWorkspace", input),
    getTeamHub: () => requestQuery("getTeamHub"),
  },
};
