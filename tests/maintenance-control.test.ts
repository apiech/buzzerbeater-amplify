import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as maintenanceTesting,
  activateMaintenance,
  getMaintenanceState,
} from "../lib/maintenance/control-plane";
import {
  branchToMaintenanceEnvironmentName,
  buildMaintenanceParameterName,
  resolveMaintenanceEnvironmentName,
} from "../lib/maintenance/environment";

test("maintenance environment helpers normalize hosted and sandbox environments", () => {
  assert.equal(branchToMaintenanceEnvironmentName("main"), "prod");
  assert.equal(
    resolveMaintenanceEnvironmentName(
      {
        AWS_BRANCH: "feature/Realtime Control",
      },
      {
        userName: () => "ignored",
      },
    ),
    "feature-realtime-control",
  );
  assert.equal(
    resolveMaintenanceEnvironmentName(
      {
        BB_SANDBOX_IDENTIFIER: "Karey Smith",
      },
      {
        userName: () => "ignored",
      },
    ),
    "sandbox-karey-smith",
  );
  assert.equal(
    buildMaintenanceParameterName("Dev"),
    "/buzzerbeater/site-control/dev/current",
  );
});

test("maintenance control plane rejects malformed documents", async () => {
  const restore = maintenanceTesting.installRuntime({
    getParameter: async () =>
      JSON.stringify({
        activatedAt: "2026-04-08T12:00:00.000Z",
        activatedBy: "ops",
        detail: "Invalid reason code payload.",
        headline: "Broken payload",
        mode: "FULL_SITE",
        reasonCode: "NOT_REAL",
        scope: "SITE",
        source: "MANUAL",
      }),
  });

  try {
    await assert.rejects(
      () =>
        getMaintenanceState({
          AWS_REGION: "us-east-1",
          MAINTENANCE_ENVIRONMENT_NAME: "dev",
        }),
      /invalid enum value/i,
    );
  } finally {
    restore();
  }
});

test("manual maintenance state is not overwritten by alarm automation", async () => {
  const parameterStore = new Map<string, string>();
  const restore = maintenanceTesting.installRuntime({
    deleteParameter: async (name) => {
      parameterStore.delete(name);
    },
    getParameter: async (name) => parameterStore.get(name) ?? null,
    now: () => new Date("2026-04-08T12:00:00.000Z"),
    putParameter: async (name, value) => {
      parameterStore.set(name, value);
    },
    userName: () => "karey",
  });
  const env = {
    AWS_REGION: "us-east-1",
    MAINTENANCE_ENVIRONMENT_NAME: "dev",
  };

  try {
    const manual = await activateMaintenance({
      activatedBy: "operator",
      detail: "Budget exhausted.",
      env,
      headline: "Budget exhausted",
      reasonCode: "MANUAL",
      source: "MANUAL",
    });
    const alarm = await activateMaintenance({
      activatedBy: "alarm",
      detail: "Bedrock budget alarm fired.",
      env,
      headline: "Bedrock alarm",
      reasonCode: "BUDGET_GUARDRAIL",
      source: "ALARM",
      triggerId: "bb-bedrock-estimated-charges",
      triggerService: "Bedrock",
    });

    assert.equal(manual.changed, true);
    assert.equal(alarm.changed, false);
    const document = alarm.state.document;
    assert.ok(document);
    assert.equal(document.source, "MANUAL");
    assert.equal(document.headline, "Budget exhausted");
  } finally {
    restore();
  }
});

test("maintenance control plane serves last known good state on transient SSM failures", async () => {
  let callCount = 0;
  const restore = maintenanceTesting.installRuntime({
    getParameter: async () => {
      callCount += 1;
      if (callCount === 1) {
        return JSON.stringify({
          activatedAt: "2026-04-08T12:00:00.000Z",
          activatedBy: "operator",
          detail: "Budget exhausted.",
          headline: "Budget exhausted",
          mode: "FULL_SITE",
          reasonCode: "BUDGET_GUARDRAIL",
          scope: "SITE",
          source: "MANUAL",
        });
      }

      const error = new Error("SSM unavailable.") as Error & {
        name: string;
      };
      error.name = "ServiceUnavailableException";
      throw error;
    },
  });

  try {
    const initial = await getMaintenanceState({
      AWS_REGION: "us-east-1",
      MAINTENANCE_ENVIRONMENT_NAME: "dev",
    });
    const fallback = await getMaintenanceState({
      AWS_REGION: "us-east-1",
      MAINTENANCE_ENVIRONMENT_NAME: "dev",
    });

    assert.equal(initial.active, true);
    assert.equal(initial.stale, false);
    assert.equal(fallback.active, true);
    assert.equal(fallback.stale, true);
    assert.equal(fallback.document?.headline, "Budget exhausted");
  } finally {
    restore();
  }
});
