import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as predictionRuntimeTesting,
  invokePredictionRuntimeEndpoint,
} from "../amplify/data/_backend/prediction-runtime";

test("invokePredictionRuntimeEndpoint retries throttled invokes before succeeding", async () => {
  let attempts = 0;

  const result = await invokePredictionRuntimeEndpoint(
    {
      endpointName: "prediction-endpoint",
      payload: { requestId: "req-1" },
    },
    {
      client: {
        send: async () => {
          attempts += 1;
          if (attempts < 3) {
            const error = new Error("UnknownError");
            error.name = "ThrottlingException";
            throw error;
          }

          return {
            Body: {
              transformToString: async () => JSON.stringify({ ok: true }),
            },
          } as any;
        },
      },
      sleep: async () => {},
    },
  );

  assert.equal(attempts, 3);
  assert.deepStrictEqual(result, { ok: true });
});

test("invokePredictionRuntimeEndpoint surfaces a friendly message after repeated throttling", async () => {
  await assert.rejects(
    () =>
      invokePredictionRuntimeEndpoint(
        {
          endpointName: "prediction-endpoint",
          payload: { requestId: "req-2" },
        },
        {
          client: {
            send: async () => {
              const error = new Error("UnknownError");
              error.name = "ThrottlingException";
              throw error;
            },
          },
          sleep: async () => {},
        },
      ),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        predictionRuntimeTesting.PREDICTION_RUNTIME_CAPACITY_ERROR_MESSAGE,
      );
      return true;
    },
  );
});

test("invokePredictionRuntimeEndpoint normalizes SageMaker payload-limit failures", async () => {
  await assert.rejects(
    () =>
      invokePredictionRuntimeEndpoint(
        {
          endpointName: "prediction-endpoint",
          payload: { requestId: "req-3" },
        },
        {
          client: {
            send: async () => {
              throw new Error(
                "Received response from model with status code 200. However, the response payload from the container is 16618430 bytes, which has exceeded the maximum limit of 4 MB.",
              );
            },
          },
          sleep: async () => {},
        },
      ),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        predictionRuntimeTesting.PREDICTION_RUNTIME_RESPONSE_TOO_LARGE_ERROR_MESSAGE,
      );
      assert.equal(
        predictionRuntimeTesting.isPredictionRuntimeResponseTooLargeError(error),
        true,
      );
      return true;
    },
  );
});
