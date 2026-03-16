import assert from "node:assert/strict";
import test from "node:test";

import { hasFeature, resolvePlan } from "../lib/billing/plans";

test("hasFeature exposes premium-only billing gates", () => {
  assert.equal(hasFeature("free", "predictions"), false);
  assert.equal(hasFeature("free", "leagueWriteups"), false);
  assert.equal(hasFeature("premium", "predictions"), true);
  assert.equal(hasFeature("premium", "leagueWriteups"), true);
});

test("resolvePlan defaults to free without billing state", () => {
  assert.deepStrictEqual(resolvePlan(null), {
    accessSource: "default",
    planId: "free",
  });
});

test("resolvePlan grants premium through an active subscription", () => {
  assert.deepStrictEqual(
    resolvePlan({
      currentPeriodEndAt: "2099-03-15T00:00:00.000Z",
      stripeSubscriptionStatus: "active",
      subscriptionPlanId: "premium",
    }),
    {
      accessSource: "subscription",
      planId: "premium",
    },
  );
});

test("resolvePlan keeps canceled-at-period-end subscriptions active until the period ends", () => {
  assert.deepStrictEqual(
    resolvePlan({
      currentPeriodEndAt: "2099-03-15T00:00:00.000Z",
      stripeSubscriptionStatus: "active",
      subscriptionPlanId: "premium",
    }),
    {
      accessSource: "subscription",
      planId: "premium",
    },
  );
});

test("resolvePlan removes access for payment failures and expired periods", () => {
  assert.deepStrictEqual(
    resolvePlan({
      currentPeriodEndAt: "2099-03-15T00:00:00.000Z",
      stripeSubscriptionStatus: "past_due",
      subscriptionPlanId: "premium",
    }),
    {
      accessSource: "default",
      planId: "free",
    },
  );

  assert.deepStrictEqual(
    resolvePlan({
      currentPeriodEndAt: "2000-03-15T00:00:00.000Z",
      stripeSubscriptionStatus: "active",
      subscriptionPlanId: "premium",
    }),
    {
      accessSource: "default",
      planId: "free",
    },
  );
});

test("resolvePlan honors unexpired manual overrides", () => {
  assert.deepStrictEqual(
    resolvePlan({
      grantedPlanId: "premium",
      overrideExpiresAt: "2099-03-15T00:00:00.000Z",
      stripeSubscriptionStatus: "past_due",
      subscriptionPlanId: "free",
    }),
    {
      accessSource: "override",
      planId: "premium",
    },
  );
});

test("resolvePlan ignores expired manual overrides", () => {
  assert.deepStrictEqual(
    resolvePlan({
      grantedPlanId: "premium",
      overrideExpiresAt: "2000-03-15T00:00:00.000Z",
    }),
    {
      accessSource: "default",
      planId: "free",
    },
  );
});
