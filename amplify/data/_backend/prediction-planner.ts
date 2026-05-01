import {
  predictionPlannerBatchResponseSchema,
  predictionPlannerResponseSchema,
  type PredictionPlannerBatchResponse,
  type PredictionPlannerResponse,
} from "../../../lib/prediction/contracts";

type JsonRecord = Record<string, unknown>;

export type PlannerInvocationRequest = {
  payload: JsonRecord;
  requestId: string;
};

export type PlannerInvocationResponse<
  TResponse = PredictionPlannerResponse,
> = {
  elapsedMs: number;
  payloadBytes: number;
  requestId: string;
  response: TResponse;
};

type PlannerBatchInvocationItem = {
  modelKey?: string;
  plannerRequest: JsonRecord;
  requestId: string;
};

export async function invokePlannerRequests<
  TResponse = PredictionPlannerResponse,
>(
  args: {
    concurrency?: number;
    endpointName: string;
    invokePredictionEndpoint: (
      endpointName: string,
      payload: JsonRecord,
    ) => Promise<unknown>;
    parseResponse?: (payload: unknown) => TResponse;
    onRequestCompleted?: (result: {
      completedCount: number;
      elapsedMs: number;
      payloadBytes: number;
      requestId: string;
      response: TResponse;
      totalCount: number;
    }) => Promise<void> | void;
    requests: readonly PlannerInvocationRequest[];
  },
): Promise<PlannerInvocationResponse<TResponse>[]> {
  const parseResponse =
    args.parseResponse ??
    ((payload: unknown) =>
      predictionPlannerResponseSchema.parse(payload) as TResponse);
  const responses = new Array<PlannerInvocationResponse<TResponse>>(
    args.requests.length,
  );
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
      const parsedResponse = parseResponse(rawResponse);
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

export async function invokePlannerBatchRequests(args: {
  batchSize: number;
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
  if (!args.requests.length) {
    return [];
  }

  if (args.batchSize <= 0) {
    throw new Error("Planner batch size must be greater than zero.");
  }

  const totalCount = args.requests.length;
  const responses = new Array<PlannerInvocationResponse>(totalCount);
  const batches = chunkPlannerRequests(args.requests, args.batchSize);
  const concurrency = Math.min(
    Math.max(1, args.concurrency ?? 1),
    batches.length,
  );
  let nextBatchIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (nextBatchIndex < batches.length) {
      const currentBatchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batches[currentBatchIndex];
      if (!batch) {
        return;
      }

      const payload = buildPlannerBatchPayload(batch.map(({ request }) => request));
      const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
      const startedAt = Date.now();
      const rawResponse = await args.invokePredictionEndpoint(
        args.endpointName,
        payload,
      );
      const parsedResponse = predictionPlannerBatchResponseSchema.parse(rawResponse);
      const elapsedMs = Date.now() - startedAt;
      const orderedBatchResponses = orderPlannerBatchResponses(
        batch.map(({ request }) => request.requestId),
        parsedResponse,
      );

      for (let index = 0; index < batch.length; index += 1) {
        const batchEntry = batch[index]!;
        const parsedItem = orderedBatchResponses[index]!;
        completedCount += 1;
        responses[batchEntry.originalIndex] = {
          elapsedMs,
          payloadBytes,
          requestId: parsedItem.requestId,
          response: parsedItem.response,
        };
        await Promise.resolve(
          args.onRequestCompleted?.({
            completedCount,
            elapsedMs,
            payloadBytes,
            requestId: parsedItem.requestId,
            response: parsedItem.response,
            totalCount,
          }),
        );
      }
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

function chunkPlannerRequests(
  requests: readonly PlannerInvocationRequest[],
  batchSize: number,
): Array<
  Array<{
    originalIndex: number;
    request: PlannerBatchInvocationItem;
  }>
> {
  const chunks: Array<
    Array<{
      originalIndex: number;
      request: PlannerBatchInvocationItem;
    }>
  > = [];
  for (let index = 0; index < requests.length; index += batchSize) {
    chunks.push(
      requests.slice(index, index + batchSize).map((request, chunkIndex) => ({
        originalIndex: index + chunkIndex,
        request: toPlannerBatchInvocationItem(request),
      })),
    );
  }
  return chunks;
}

function toPlannerBatchInvocationItem(
  request: PlannerInvocationRequest,
): PlannerBatchInvocationItem {
  const plannerRequest = request.payload.plannerRequest;
  if (
    !plannerRequest ||
    typeof plannerRequest !== "object" ||
    Array.isArray(plannerRequest)
  ) {
    throw new Error(
      `Planner batch requests require a plannerRequest object for request '${request.requestId}'.`,
    );
  }

  const modelKey =
    typeof request.payload.modelKey === "string" &&
    request.payload.modelKey.trim().length > 0
      ? request.payload.modelKey.trim()
      : undefined;

  return {
    ...(modelKey ? { modelKey } : {}),
    plannerRequest: plannerRequest as JsonRecord,
    requestId: request.requestId,
  };
}

function buildPlannerBatchPayload(
  requests: readonly PlannerBatchInvocationItem[],
): JsonRecord {
  return {
    plannerBatchRequest: {
      requests: requests.map((request) => ({
        ...(request.modelKey ? { modelKey: request.modelKey } : {}),
        plannerRequest: request.plannerRequest,
        requestId: request.requestId,
      })),
    },
  };
}

function orderPlannerBatchResponses(
  orderedRequestIds: readonly string[],
  batchResponse: PredictionPlannerBatchResponse,
): PredictionPlannerBatchResponse["responses"] {
  const responseByRequestId = new Map(
    batchResponse.responses.map((response) => [response.requestId, response]),
  );
  const orderedResponses = orderedRequestIds.flatMap((requestId) => {
    const response = responseByRequestId.get(requestId);
    return response ? [response] : [];
  });
  if (orderedResponses.length !== orderedRequestIds.length) {
    throw new Error(
      "Planner batch response did not include a response for every request id.",
    );
  }
  return orderedResponses;
}
