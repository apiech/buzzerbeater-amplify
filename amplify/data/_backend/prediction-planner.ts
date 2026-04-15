import {
  predictionPlannerResponseSchema,
  type PredictionPlannerResponse,
} from "../../../lib/prediction/contracts";

type JsonRecord = Record<string, unknown>;

export type PlannerInvocationRequest = {
  payload: JsonRecord;
  requestId: string;
};

export type PlannerInvocationResponse = {
  elapsedMs: number;
  payloadBytes: number;
  requestId: string;
  response: PredictionPlannerResponse;
};

export async function invokePlannerRequests(args: {
  concurrency?: number;
  endpointName: string;
  invokePredictionEndpoint: (
    endpointName: string,
    payload: JsonRecord,
  ) => Promise<unknown>;
  onRequestCompleted?: (result: {
    completedCount: number;
    elapsedMs: number;
    payloadBytes: number;
    requestId: string;
    response: PredictionPlannerResponse;
    totalCount: number;
  }) => Promise<void> | void;
  requests: readonly PlannerInvocationRequest[];
}): Promise<PlannerInvocationResponse[]> {
  const responses = new Array<PlannerInvocationResponse>(args.requests.length);
  const totalCount = args.requests.length;
  const concurrency = Math.min(
    Math.max(1, args.concurrency ?? 1),
    totalCount || 1,
  );
  let nextIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (nextIndex < totalCount) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const request = args.requests[currentIndex];
      if (!request) {
        return;
      }

      const payloadBytes = Buffer.byteLength(JSON.stringify(request.payload));
      const startedAt = Date.now();
      const rawResponse = await args.invokePredictionEndpoint(
        args.endpointName,
        request.payload,
      );
      const parsedResponse = predictionPlannerResponseSchema.parse(rawResponse);
      const elapsedMs = Date.now() - startedAt;
      completedCount += 1;

      responses[currentIndex] = {
        elapsedMs,
        payloadBytes,
        requestId: request.requestId,
        response: parsedResponse,
      };

      await Promise.resolve(
        args.onRequestCompleted?.({
          completedCount,
          elapsedMs,
          payloadBytes,
          requestId: request.requestId,
          response: parsedResponse,
          totalCount,
        }),
      );
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return responses;
}

export function mergePlannerResponses(args: {
  orderedRequestIds: readonly string[];
  responses: readonly PlannerInvocationResponse[];
}): PredictionPlannerResponse {
  const responseByRequestId = new Map(
    args.responses.map((response) => [response.requestId, response]),
  );
  const orderedResponses = args.orderedRequestIds.flatMap((requestId) => {
    const response = responseByRequestId.get(requestId);
    return response ? [response.response] : [];
  });
  const firstResponse = orderedResponses[0];
  if (!firstResponse) {
    throw new Error("Planner batch merge requires at least one planner response.");
  }

  return {
    expectedMatrix: mergePlannerMatrixViews(
      orderedResponses.map((response) => response.expectedMatrix),
    ),
    modelKey: firstResponse.modelKey,
    modelVersion: firstResponse.modelVersion,
    planEvaluations: orderedResponses.flatMap(
      (response) => response.planEvaluations,
    ),
    scenarioMatrices: mergePlannerMatrixCollections(
      orderedResponses.map((response) => response.scenarioMatrices),
    ),
  };
}

function mergePlannerMatrixCollections(
  matricesByResponse: readonly PredictionPlannerResponse["scenarioMatrices"][],
): PredictionPlannerResponse["scenarioMatrices"] {
  const viewIds: string[] = [];
  const matricesByViewId = new Map<
    string,
    Array<PredictionPlannerResponse["scenarioMatrices"][number]>
  >();

  for (const responseMatrices of matricesByResponse) {
    for (const view of responseMatrices) {
      if (!matricesByViewId.has(view.viewId)) {
        viewIds.push(view.viewId);
        matricesByViewId.set(view.viewId, []);
      }
      matricesByViewId.get(view.viewId)?.push(view);
    }
  }

  return viewIds.flatMap((viewId) => {
    const views = matricesByViewId.get(viewId);
    return views?.length ? [mergePlannerMatrixViews(views)] : [];
  });
}

function mergePlannerMatrixViews(
  views: readonly [
    PredictionPlannerResponse["expectedMatrix"],
    ...PredictionPlannerResponse["expectedMatrix"][],
  ] | readonly PredictionPlannerResponse["expectedMatrix"][],
): PredictionPlannerResponse["expectedMatrix"] {
  const firstView = views[0];
  if (!firstView) {
    throw new Error("Planner matrix merge requires at least one view.");
  }

  const rowOrder = firstView.rows.map((row) => row.opponentPairId);
  const mergedRows = new Map(
    rowOrder.map((opponentPairId) => [
      opponentPairId,
      {
        cells: [] as PredictionPlannerResponse["expectedMatrix"]["rows"][number]["cells"],
        opponentPairId,
      },
    ]),
  );

  for (const view of views) {
    for (const row of view.rows) {
      if (!mergedRows.has(row.opponentPairId)) {
        rowOrder.push(row.opponentPairId);
        mergedRows.set(row.opponentPairId, {
          cells: [],
          opponentPairId: row.opponentPairId,
        });
      }
      mergedRows.get(row.opponentPairId)?.cells.push(...row.cells);
    }
  }

  return {
    label: firstView.label,
    probability: firstView.probability ?? null,
    rows: rowOrder.flatMap((opponentPairId) => {
      const row = mergedRows.get(opponentPairId);
      return row ? [row] : [];
    }),
    scenarioId: firstView.scenarioId ?? null,
    viewId: firstView.viewId,
  };
}
