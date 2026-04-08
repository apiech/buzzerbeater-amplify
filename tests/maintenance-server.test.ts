import assert from "node:assert/strict";
import test from "node:test";

import { __testing as controlPlaneTesting } from "../lib/maintenance/control-plane";
import { getServerMaintenanceState } from "../app/server/maintenance";

function withMaintenanceEnv<T>(callback: () => Promise<T>): Promise<T> {
  const previousEnvironmentName = process.env.MAINTENANCE_ENVIRONMENT_NAME;
  const previousRegion = process.env.AWS_REGION;
  process.env.MAINTENANCE_ENVIRONMENT_NAME = "dev";
  process.env.AWS_REGION = "us-east-1";

  return callback().finally(() => {
    if (previousEnvironmentName === undefined) {
      delete process.env.MAINTENANCE_ENVIRONMENT_NAME;
    } else {
      process.env.MAINTENANCE_ENVIRONMENT_NAME = previousEnvironmentName;
    }
    if (previousRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = previousRegion;
    }
    controlPlaneTesting.resetCachedState();
  });
}

test("server maintenance state fails open when the runtime probe throws", async () => {
  const restoreRuntime = controlPlaneTesting.installRuntime({
    getParameter: async () => {
      const error = new Error("Hosted compute could not resolve AWS identity.");
      throw error;
    },
  });
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    await withMaintenanceEnv(async () => {
      const state = await getServerMaintenanceState();

      assert.equal(state.active, false);
      assert.equal(state.document, null);
      assert.equal(state.environmentName, "dev");
      assert.equal(state.parameterName, "/buzzerbeater/site-control/dev/current");
      assert.equal(state.stale, true);
      assert.equal(logged.length, 1);
    });
  } finally {
    console.error = originalConsoleError;
    restoreRuntime();
  }
});
