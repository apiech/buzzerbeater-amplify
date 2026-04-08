import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { __testing as maintenanceTesting } from "../lib/maintenance/control-plane";
import { proxy } from "../proxy";
import { GET as authGet } from "../app/api/auth/[slug]/route";
import { POST as readsPost } from "../app/api/app/reads/[name]/route";
import { PUT as themePut } from "../app/api/app/theme/route";

function installActiveMaintenance() {
  return maintenanceTesting.installRuntime({
    getParameter: async () =>
      JSON.stringify({
        activatedAt: "2026-04-08T12:00:00.000Z",
        activatedBy: "ops",
        detail: "Budget exhausted.",
        headline: "Budget exhausted",
        mode: "FULL_SITE",
        reasonCode: "BUDGET_GUARDRAIL",
        scope: "SITE",
        source: "MANUAL",
      }),
  });
}

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
    maintenanceTesting.resetCachedState();
  });
}

test("proxy redirects protected page requests to /status during maintenance", async () => {
  const restore = installActiveMaintenance();

  try {
    await withMaintenanceEnv(async () => {
      const response = await proxy(
        new NextRequest("https://app.example.com/workspace/home"),
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://app.example.com/status",
      );
    });
  } finally {
    restore();
  }
});

test("auth entrypoints redirect to /status during maintenance", async () => {
  const restore = installActiveMaintenance();

  try {
    await withMaintenanceEnv(async () => {
      const response = await authGet(
        new Request("https://app.example.com/api/auth/sign-in"),
        {
          params: Promise.resolve({
            slug: "sign-in",
          }),
        },
      );

      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        "https://app.example.com/status",
      );
    });
  } finally {
    restore();
  }
});

test("user-facing app routes return 503 maintenance payloads before auth or execution", async () => {
  const restore = installActiveMaintenance();

  try {
    await withMaintenanceEnv(async () => {
      const readsResponse = await readsPost(
        new Request(
          "https://app.example.com/api/app/reads/getCurrentPrediction",
          {
            method: "POST",
          },
        ),
        {
          params: Promise.resolve({
            name: "getCurrentPrediction",
          }),
        },
      );
      const themeResponse = await themePut(
        new Request("https://app.example.com/api/app/theme", {
          body: JSON.stringify({
            themeId: "clubhouse",
          }),
          method: "PUT",
        }),
      );

      assert.equal(readsResponse.status, 503);
      assert.equal(themeResponse.status, 503);

      const readsPayload = (await readsResponse.json()) as {
        maintenance?: {
          active?: boolean;
          state?: {
            headline?: string;
          };
        };
      };
      const themePayload = (await themeResponse.json()) as {
        maintenance?: {
          active?: boolean;
        };
      };
      const maintenance = readsPayload.maintenance;
      const maintenanceState = maintenance?.state;

      assert.equal(maintenance?.active, true);
      assert.ok(maintenanceState);
      assert.equal(maintenanceState.headline, "Budget exhausted");
      assert.equal(themePayload.maintenance?.active, true);
    });
  } finally {
    restore();
  }
});
