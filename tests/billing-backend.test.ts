import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  __testing as billingTesting,
  handleStripeWebhook,
  setBillingOverride,
} from "../amplify/data/_backend/billing";

function signStripePayload(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const payload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("verifyStripeWebhookEvent accepts a valid Stripe signature", () => {
  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: "user-1",
      },
    },
  });

  const event = billingTesting.verifyStripeWebhookEvent({
    body,
    signatureHeader: signStripePayload(body, "whsec_test"),
    webhookSecret: "whsec_test",
  });

  assert.equal(event.type, "checkout.session.completed");
});

test("handleStripeWebhook syncs a completed checkout into BillingAccount", async () => {
  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: "user-1",
        customer: "cus_123",
        customer_details: {
          email: "coach@example.com",
        },
        subscription: "sub_123",
      },
    },
  });

  let upsertedRecord: Record<string, unknown> | null = null;
  await handleStripeWebhook(
    {
      body,
      env: {},
      signatureHeader: signStripePayload(body, "whsec_test"),
      stripeSecretKey: "sk_test",
      webhookSecret: "whsec_test",
    },
    {
      createPortalSession: async () => ({ url: "https://example.com/portal" }),
      createSubscriptionCheckoutSession: async () => ({
        url: "https://example.com/checkout",
      }),
      getBillingAccount: async () => null,
      getStripeSubscription: async () => ({
        cancel_at_period_end: false,
        current_period_end: 4_102_444_800,
        customer: "cus_123",
        id: "sub_123",
        items: {
          data: [
            {
              price: {
                id: "price_premium",
                metadata: {
                  app_plan_id: "premium",
                },
              },
            },
          ],
        },
        metadata: {
          userId: "user-1",
        },
        status: "active",
      }),
      upsertBillingAccount: async (_env, record) => {
        upsertedRecord = record as Record<string, unknown>;
      },
    },
  );

  assert.deepStrictEqual(upsertedRecord, {
    cancelAtPeriodEnd: false,
    currentPeriodEndAt: "2100-01-01T00:00:00.000Z",
    email: "coach@example.com",
    grantedPlanId: null,
    overrideExpiresAt: null,
    overrideReason: null,
    stripeCustomerId: "cus_123",
    stripePriceId: "price_premium",
    stripeSubscriptionId: "sub_123",
    stripeSubscriptionStatus: "active",
    subscriptionPlanId: "premium",
    userId: "user-1",
  });
});

test("handleStripeWebhook replays subscription updates idempotently", async () => {
  const body = JSON.stringify({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_123",
      },
    },
  });

  const records: Array<Record<string, unknown>> = [];
  const runtime = {
    createPortalSession: async () => ({ url: "https://example.com/portal" }),
    createSubscriptionCheckoutSession: async () => ({
      url: "https://example.com/checkout",
    }),
    getBillingAccount: async () => null,
    getStripeSubscription: async () => ({
      cancel_at_period_end: true,
      current_period_end: 4_102_444_800,
      customer: "cus_123",
      id: "sub_123",
      items: {
        data: [
          {
            price: {
              id: "price_premium",
              metadata: {
                app_plan_id: "premium",
              },
            },
          },
        ],
      },
      metadata: {
        userId: "user-1",
      },
      status: "active",
    }),
    upsertBillingAccount: async (_env: Record<string, string | undefined>, record: Record<string, unknown>) => {
      records.push(record);
    },
  };

  await handleStripeWebhook(
    {
      body,
      env: {},
      signatureHeader: signStripePayload(body, "whsec_test"),
      stripeSecretKey: "sk_test",
      webhookSecret: "whsec_test",
    },
    runtime,
  );
  await handleStripeWebhook(
    {
      body,
      env: {},
      signatureHeader: signStripePayload(body, "whsec_test"),
      stripeSecretKey: "sk_test",
      webhookSecret: "whsec_test",
    },
    runtime,
  );

  assert.equal(records.length, 2);
  assert.deepStrictEqual(records[0], records[1]);
});

test("setBillingOverride stores a complimentary premium plan", async () => {
  let upsertedRecord: Record<string, unknown> | null = null;

  const summary = await setBillingOverride(
    {
      env: {},
      overrideExpiresAt: "2099-03-15T00:00:00.000Z",
      overrideReason: "alpha",
      planId: "premium",
      userId: "user-1",
    },
    {
      createPortalSession: async () => ({ url: "https://example.com/portal" }),
      createSubscriptionCheckoutSession: async () => ({
        url: "https://example.com/checkout",
      }),
      getBillingAccount: async () => null,
      getStripeSubscription: async () => ({
        id: "sub_123",
      }),
      upsertBillingAccount: async (_env, record) => {
        upsertedRecord = record as Record<string, unknown>;
      },
    },
  );

  assert.equal(summary.planId, "premium");
  assert.equal(summary.accessSource, "override");
  assert.deepStrictEqual(upsertedRecord, {
    cancelAtPeriodEnd: null,
    currentPeriodEndAt: null,
    email: null,
    grantedPlanId: "premium",
    overrideExpiresAt: "2099-03-15T00:00:00.000Z",
    overrideReason: "alpha",
    stripeCustomerId: null,
    stripePriceId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    subscriptionPlanId: null,
    userId: "user-1",
  });
});
