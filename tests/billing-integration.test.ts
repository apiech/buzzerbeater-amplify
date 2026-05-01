import assert from "node:assert/strict";
import test from "node:test";

import { __testing as billingIntegrationTesting } from "../amplify/_backend/billing-integration";

function createFunctionResource() {
  const envCalls: Array<{ name: string; value: string }> = [];
  return {
    addEnvironment(name: string, value: string) {
      envCalls.push({ name, value });
    },
    envCalls,
    resources: {
      lambda: {},
    },
  };
}

test("billing integration automatically applies billing env to every backend function resource", () => {
  const billingAdminOverride = createFunctionResource();
  const billingWebhook = createFunctionResource();
  const existingPremiumFeature = createFunctionResource();
  const futurePremiumFeature = createFunctionResource();

  billingIntegrationTesting.applyBillingEnvironmentToFunctions(
    {
      billingAdminOverride,
      billingWebhook,
      createStack: () => {
        throw new Error("createStack should not be called in this helper test");
      },
      existingPremiumFeature,
      futurePremiumFeature,
      miscNumber: 7,
      nonFunctionResource: {
        resources: {},
      },
    },
    {
      commercialModeEnabled: true,
      defaultPlanId: "premium",
    } as never,
  );

  assert.deepStrictEqual(futurePremiumFeature.envCalls, [
    {
      name: "COMMERCIAL_MODE_ENABLED",
      value: "true",
    },
    {
      name: "BILLING_DEFAULT_PLAN",
      value: "premium",
    },
  ]);
  assert.deepStrictEqual(
    existingPremiumFeature.envCalls,
    futurePremiumFeature.envCalls,
  );
});
