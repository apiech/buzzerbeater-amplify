"use client";

import type { Schema } from "@/amplify/data/resource";

type AmplifyLikeError = {
  message?: string;
};

type AmplifyLikeResult<TData> = {
  data?: TData | null;
  errors?: AmplifyLikeError[] | null;
  nextToken?: string | null;
};
type AmplifyLikeListResult<TData> = {
  data: TData[];
  errors?: AmplifyLikeError[] | null;
  nextToken?: string | null;
};

type JsonObject = Record<string, unknown>;
type ModelListName =
  | "BbConnection"
  | "GameDayRecap"
  | "LeagueGameDayRecap"
  | "PredictionJob"
  | "SavedLineupScenario"
  | "SingleGameSummary"
  | "SyncRun";
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
type ModelListRecord<TName extends ModelListName> = Schema[TName]["type"];
type OperationResult<TName extends QueryOperationName | MutationOperationName> =
  NonNullable<Schema[TName]["returnType"]>;

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

function requestModelList<TName extends ModelListName>(
  modelName: TName,
  input: { limit?: number; nextToken?: string | null } = {},
) {
  const params = new URLSearchParams();
  if (typeof input.limit === "number") {
    params.set("limit", String(input.limit));
  }
  if (input.nextToken) {
    params.set("nextToken", input.nextToken);
  }

  const suffix = params.size ? `?${params.toString()}` : "";
  return requestOperation<ModelListRecord<TName>[]>(
    `/api/app/models/${encodeURIComponent(modelName)}${suffix}`,
  ).then(
    (result): AmplifyLikeListResult<ModelListRecord<TName>> => ({
      data: result.data ?? [],
      errors: result.errors,
      nextToken: result.nextToken,
    }),
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
  models: {
    BbConnection: {
      list: (input?: { limit?: number; nextToken?: string | null }) =>
        requestModelList("BbConnection", input),
    },
    GameDayRecap: {
      list: (input?: { limit?: number; nextToken?: string | null }) =>
        requestModelList("GameDayRecap", input),
    },
    LeagueGameDayRecap: {
      list: (input?: { limit?: number; nextToken?: string | null }) =>
        requestModelList("LeagueGameDayRecap", input),
    },
    PredictionJob: {
      list: (input?: { limit?: number; nextToken?: string | null }) =>
        requestModelList("PredictionJob", input),
    },
    SavedLineupScenario: {
      list: (input?: { limit?: number; nextToken?: string | null }) =>
        requestModelList("SavedLineupScenario", input),
    },
    SingleGameSummary: {
      list: (input?: { limit?: number; nextToken?: string | null }) =>
        requestModelList("SingleGameSummary", input),
    },
    SyncRun: {
      list: (input?: { limit?: number; nextToken?: string | null }) =>
        requestModelList("SyncRun", input),
    },
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
