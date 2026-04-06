import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as outputsTesting,
  loadAmplifyOutputs,
} from "../app/amplify-outputs";
import {
  __testing as realtimeTesting,
  getRealtimeClient,
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
