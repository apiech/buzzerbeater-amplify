import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as outputsTesting,
  loadAmplifyOutputs,
} from "../app/amplify-outputs";
import {
  __testing as realtimeTesting,
  enableTemporaryAmplifyDebugLogging,
  getRealtimeClient,
  logRealtimeError,
} from "../app/amplify-realtime";
import {
  __testing as serverTesting,
  createAuthRouteHandlers,
  getServerDataClient,
  runWithAmplifyServerContext,
} from "../app/server/amplify-server";

test("loadAmplifyOutputs memoizes successful loader results", async (t) => {
  const fakeOutputs = {
    version: "1.4",
  } as const;
  let calls = 0;
  const restore = outputsTesting.installLoader(async () => {
    calls += 1;
    return fakeOutputs as any;
  });
  t.after(restore);

  const first = await loadAmplifyOutputs();
  const second = await loadAmplifyOutputs();

  assert.equal(calls, 1);
  assert.strictEqual(first, fakeOutputs);
  assert.strictEqual(second, fakeOutputs);
});

test("loadAmplifyOutputs retries after failures instead of caching an error", async (t) => {
  let calls = 0;
  const restore = outputsTesting.installLoader(async () => {
    calls += 1;
    throw new Error("Cannot find module './amplify_outputs.json'");
  });
  t.after(restore);

  await assert.rejects(
    () => loadAmplifyOutputs(),
    /amplify_outputs\.json is not available/i,
  );
  await assert.rejects(
    () => loadAmplifyOutputs(),
    /amplify_outputs\.json is not available/i,
  );
  assert.equal(calls, 2);
});

test("getRealtimeClient loads outputs only on first real use and memoizes the client", async (t) => {
  const fakeOutputs = {
    version: "1.4",
  } as const;
  const fakeClient = {
    models: {},
  };
  const configuredOutputs: unknown[] = [];
  let createCalls = 0;

  const restoreOutputs = outputsTesting.installLoader(async () => fakeOutputs as any);
  const restoreRealtime = realtimeTesting.installRuntime({
    configureAmplify: (outputs) => {
      configuredOutputs.push(outputs);
    },
    createRealtimeClient: () => {
      createCalls += 1;
      return fakeClient as any;
    },
  });
  t.after(restoreRealtime);
  t.after(restoreOutputs);

  const first = await getRealtimeClient();
  const second = await getRealtimeClient();

  assert.strictEqual(first, fakeClient);
  assert.strictEqual(second, fakeClient);
  assert.deepStrictEqual(configuredOutputs, [fakeOutputs]);
  assert.equal(createCalls, 1);
});

test("logRealtimeError extracts nested GraphQL error details", (t) => {
  const calls: unknown[][] = [];
  const originalConsoleError = console.error;
  realtimeTesting.resetDiagnostics();
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  t.after(() => {
    console.error = originalConsoleError;
    realtimeTesting.resetDiagnostics();
  });

  logRealtimeError("OpponentForecastJob.onCreate")({
    errors: [
      {
        errorType: "UnauthorizedException",
        message: "Not authorized to access onCreateOpponentForecastJob",
      },
    ],
  });

  assert.equal(calls.length, 1);
  assert.match(
    String(calls[0]?.[0]),
    /UnauthorizedException: Not authorized to access onCreateOpponentForecastJob/i,
  );
});

test("temporary realtime diagnostics enable DEBUG logs and restore the prior log level", (t) => {
  realtimeTesting.resetDiagnostics();
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  const originalConsoleInfo = console.info;
  const infoCalls: unknown[][] = [];
  console.info = (...args: unknown[]) => {
    infoCalls.push(args);
  };

  const fakeWindow = {
    LOG_LEVEL: "WARN",
    clearTimeout,
    setTimeout,
  } as unknown as Window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
    writable: true,
  });

  t.after(() => {
    console.info = originalConsoleInfo;
    realtimeTesting.resetDiagnostics();
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      return;
    }

    delete (globalThis as { window?: Window }).window;
  });

  const restore = enableTemporaryAmplifyDebugLogging(
    "OpponentForecastJob.subscription.setup",
    {
      durationMs: 60_000,
      metadata: { teamId: "123" },
    },
  );

  assert.equal((globalThis.window as Window & { LOG_LEVEL?: string }).LOG_LEVEL, "DEBUG");
  assert.equal(infoCalls.length, 1);

  restore();

  assert.equal((globalThis.window as Window & { LOG_LEVEL?: string }).LOG_LEVEL, "WARN");
});

test("realtime error summarizer returns null when no message is available", () => {
  assert.equal(realtimeTesting.summarizeRealtimeError({}), null);
});

test("realtime logger appends recent Amplify diagnostics to the error string", (t) => {
  realtimeTesting.resetDiagnostics();
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  const originalConsoleError = console.error;
  const originalConsoleInfo = console.info;
  const errorCalls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errorCalls.push(args);
  };
  console.info = () => {};

  const fakeWindow = {
    LOG_LEVEL: "WARN",
    clearTimeout,
    setTimeout,
  } as unknown as Window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
    writable: true,
  });

  t.after(() => {
    console.error = originalConsoleError;
    console.info = originalConsoleInfo;
    realtimeTesting.resetDiagnostics();
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      return;
    }

    delete (globalThis as { window?: Window }).window;
  });

  const restore = enableTemporaryAmplifyDebugLogging(
    "OpponentForecastJob.subscription.setup",
    {
      durationMs: 60_000,
    },
  );
  console.log(
    "[DEBUG] 10:00.0 AWSAppSyncRealTimeProvider - subscription failed with authMode: userPool",
  );

  logRealtimeError("OpponentForecastJob.onCreate")(
    { message: "Connection failed: {}" },
    {
      diagnosticContext: "OpponentForecastJob.subscription.setup",
    },
  );

  restore();

  assert.equal(errorCalls.length, 1);
  assert.match(String(errorCalls[0]?.[0]), /Recent Amplify logs:/);
  assert.match(
    String(errorCalls[0]?.[0]),
    /subscription failed with authMode: userPool/i,
  );
});

test("server runtime initializes lazily and memoizes the resolved runtime", async (t) => {
  let loads = 0;
  const fakeClient = {
    models: {},
  };
  const fakeHandler = async () => new Response("ok", { status: 200 });
  const restoreRuntime = serverTesting.installRuntimeLoader(async () => {
    loads += 1;
    return {
      createAuthRouteHandlers: () => fakeHandler as any,
      runWithAmplifyServerContext: async ({ operation }) =>
        operation({} as never),
      serverDataClient: fakeClient as any,
    };
  });
  t.after(restoreRuntime);

  const authHandler = await createAuthRouteHandlers({
    redirectOnSignInComplete: "/workspace/home",
    redirectOnSignOutComplete: "/login",
  });
  const firstClient = await getServerDataClient();
  const secondClient = await getServerDataClient();
  const result = await runWithAmplifyServerContext({
    nextServerContext: null,
    operation: async () => "ok",
  });

  assert.equal(loads, 1);
  assert.equal(typeof authHandler, "function");
  assert.strictEqual(firstClient, fakeClient);
  assert.strictEqual(secondClient, fakeClient);
  assert.equal(result, "ok");
});
