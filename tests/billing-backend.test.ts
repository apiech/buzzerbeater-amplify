import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  __testing as billingTesting,
  createBillingCheckoutSession,
  createBillingLifetimeCheckoutSession,
  handleStripeWebhook,
  listBillingPayments,
  setBillingOverride,
} from "../amplify/data/_backend/billing";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

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

test("buildBillingSummary applies the configured environment default plan", () => {
  const summary = billingTesting.buildBillingSummary(
    null,
    billingTesting.resolveConfiguredDefaultPlan({
      BILLING_DEFAULT_PLAN: "premium",
    }),
  );

  assert.equal(summary.planId, "premium");
  assert.equal(summary.accessSource, "environment");
});

test("resolveConfiguredDefaultPlan rejects invalid plan ids", () => {
  assert.throws(
    () =>
      billingTesting.resolveConfiguredDefaultPlan({
        BILLING_DEFAULT_PLAN: "enterprise",
      }),
    /BILLING_DEFAULT_PLAN/i,
  );
});

test("buildBillingSummary reports lifetime access and configured offer flags", () => {
  const summary = billingTesting.buildBillingSummary(
    {
      lifetimeGrantedAt: "2026-03-19T00:00:00.000Z",
      lifetimePlanId: "premium",
      stripeCustomerId: "cus_123",
    },
    {
      defaultPlanId: "free",
      offerFlags: {
        lifetimePurchaseOfferEnabled: true,
        premiumSubscriptionOfferEnabled: false,
      },
    },
  );

  assert.equal(summary.planId, "premium");
  assert.equal(summary.accessSource, "lifetime");
  assert.equal(summary.hasLifetimeAccess, true);
  assert.equal(summary.hasBillingCustomer, true);
  assert.equal(summary.lifetimePurchaseOfferEnabled, true);
  assert.equal(summary.premiumSubscriptionOfferEnabled, false);
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

test("handleStripeWebhook grants lifetime access and records the payment", async () => {
  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_lifetime",
        client_reference_id: "user-1",
        amount_total: 5000,
        created: 1_742_342_400,
        currency: "usd",
        customer: "cus_123",
        customer_details: {
          email: "coach@example.com",
        },
        metadata: {
          grantedPlanId: "premium",
          priceId: "price_lifetime",
          purchaseKind: "lifetime",
          userId: "user-1",
        },
        payment_intent: "pi_123",
        payment_status: "paid",
      },
    },
  });

  let upsertedAccount: Record<string, unknown> | null = null;
  let upsertedPayment: Record<string, unknown> | null = null;
  await handleStripeWebhook(
    {
      body,
      env: {},
      signatureHeader: signStripePayload(body, "whsec_test"),
      stripeSecretKey: "sk_test",
      webhookSecret: "whsec_test",
    },
    {
      createPaymentCheckoutSession: async () => ({
        url: "https://example.com/lifetime-checkout",
      }),
      createPortalSession: async () => ({ url: "https://example.com/portal" }),
      createSubscriptionCheckoutSession: async () => ({
        url: "https://example.com/checkout",
      }),
      getBillingAccount: async () => null,
      getStripeSubscription: async () => ({
        id: "sub_unused",
      }),
      listBillingPaymentsByUserId: async () => ({
        nextToken: null,
        records: [],
      }),
      upsertBillingAccount: async (_env, record) => {
        upsertedAccount = record as Record<string, unknown>;
      },
      upsertBillingPayment: async (_env, record) => {
        upsertedPayment = record as Record<string, unknown>;
      },
    },
  );

  assert.deepStrictEqual(upsertedAccount, {
    cancelAtPeriodEnd: null,
    currentPeriodEndAt: null,
    email: "coach@example.com",
    grantedPlanId: null,
    lifetimeGrantedAt: "2025-03-19T00:00:00.000Z",
    lifetimePlanId: "premium",
    lifetimeSourceObjectId: "cs_test_lifetime",
    overrideExpiresAt: null,
    overrideReason: null,
    stripeCustomerId: "cus_123",
    stripePriceId: "price_lifetime",
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    subscriptionPlanId: null,
    userId: "user-1",
  });
  assert.deepStrictEqual(upsertedPayment, {
    amountTotal: 5000,
    currency: "usd",
    grantedPlanId: "premium",
    occurredAt: "2025-03-19T00:00:00.000Z",
    paymentKind: "lifetime_checkout",
    providerObjectId: "cs_test_lifetime",
    providerObjectType: "checkout.session",
    status: "paid",
    stripeCheckoutSessionId: "cs_test_lifetime",
    stripeCustomerId: "cus_123",
    stripePaymentIntentId: "pi_123",
    stripePriceId: "price_lifetime",
    userId: "user-1",
  });
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

test("setBillingOverride can force free access even when the environment default is premium", async () => {
  const summary = await setBillingOverride(
    {
      env: {
        BILLING_DEFAULT_PLAN: "premium",
      },
      overrideExpiresAt: "2099-03-15T00:00:00.000Z",
      overrideReason: "free plan test",
      planId: "free",
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
      upsertBillingAccount: async () => {},
    },
  );

  assert.equal(summary.planId, "free");
  assert.equal(summary.accessSource, "override");
});

test("createBillingCheckoutSession sanitizes return paths", async () => {
  let checkoutInput: Record<string, unknown> | null = null;

  const result = await createBillingCheckoutSession(
    {
      appBaseUrl: "https://app.example.com",
      env: {
        BILLING_ENABLE_PREMIUM_SUBSCRIPTION: "true",
      },
      identity: {
        claims: {
          email: "coach@example.com",
        },
        sub: "user-1",
      },
      premiumPriceId: "price_premium",
      returnPath: "https://evil.example.com",
      stripeSecretKey: "sk_test",
    },
    {
      createPaymentCheckoutSession: async () => ({
        url: "https://example.com/lifetime-checkout",
      }),
      createPortalSession: async () => ({ url: "https://example.com/portal" }),
      createSubscriptionCheckoutSession: async (_secretKey, input) => {
        checkoutInput = input as unknown as Record<string, unknown>;
        return { url: "https://example.com/checkout" };
      },
      getBillingAccount: async () => null,
      getStripeSubscription: async () => ({
        id: "sub_unused",
      }),
      listBillingPaymentsByUserId: async () => ({
        nextToken: null,
        records: [],
      }),
      upsertBillingAccount: async () => {},
      upsertBillingPayment: async () => {},
    },
  );

  assert.equal(result.url, "https://example.com/checkout");
  assert.deepStrictEqual(checkoutInput, {
    cancelUrl: "https://app.example.com/workspace/ops?billing=cancelled",
    customerEmail: "coach@example.com",
    customerId: null,
    premiumPriceId: "price_premium",
    successUrl: "https://app.example.com/workspace/ops?billing=success",
    userId: "user-1",
  });
});

test("createBillingLifetimeCheckoutSession uses the store return path and premium grant", async () => {
  let checkoutInput: Record<string, unknown> | null = null;

  const result = await createBillingLifetimeCheckoutSession(
    {
      appBaseUrl: "https://app.example.com",
      env: {
        BILLING_ENABLE_LIFETIME_PURCHASE: "true",
      },
      identity: {
        claims: {
          email: "coach@example.com",
        },
        sub: "user-1",
      },
      lifetimePriceId: "price_lifetime",
      returnPath: "/store",
      stripeSecretKey: "sk_test",
    },
    {
      createPaymentCheckoutSession: async (_secretKey, input) => {
        checkoutInput = input as unknown as Record<string, unknown>;
        return { url: "https://example.com/lifetime-checkout" };
      },
      createPortalSession: async () => ({ url: "https://example.com/portal" }),
      createSubscriptionCheckoutSession: async () => ({
        url: "https://example.com/checkout",
      }),
      getBillingAccount: async () => ({
        userId: "user-1",
      }),
      getStripeSubscription: async () => ({
        id: "sub_unused",
      }),
      listBillingPaymentsByUserId: async () => ({
        nextToken: null,
        records: [],
      }),
      upsertBillingAccount: async () => {},
      upsertBillingPayment: async () => {},
    },
  );

  assert.equal(result.url, "https://example.com/lifetime-checkout");
  assert.deepStrictEqual(checkoutInput, {
    cancelUrl: "https://app.example.com/store?billing=cancelled",
    customerEmail: "coach@example.com",
    customerId: null,
    grantedPlanId: "premium",
    lifetimePriceId: "price_lifetime",
    successUrl: "https://app.example.com/store?billing=success",
    userId: "user-1",
  });
});

test("listBillingPayments returns owner-scoped payment history", async () => {
  const result = await listBillingPayments(
    {
      env: {},
      identity: { sub: "user-1" },
      limit: 3,
      nextToken: "token-1",
    },
    {
      createPaymentCheckoutSession: async () => ({
        url: "https://example.com/lifetime-checkout",
      }),
      createPortalSession: async () => ({ url: "https://example.com/portal" }),
      createSubscriptionCheckoutSession: async () => ({
        url: "https://example.com/checkout",
      }),
      getBillingAccount: async () => null,
      getStripeSubscription: async () => ({
        id: "sub_unused",
      }),
      listBillingPaymentsByUserId: async (_env, userId, input) => {
        assert.equal(userId, "user-1");
        assert.deepStrictEqual(input, {
          limit: 3,
          nextToken: "token-1",
        });
        return {
          nextToken: "token-2",
          records: [
            {
              amountTotal: 5000,
              currency: "usd",
              occurredAt: "2025-03-19T00:00:00.000Z",
              paymentKind: "lifetime_checkout",
              providerObjectId: "cs_test_lifetime",
              providerObjectType: "checkout.session",
              status: "paid",
              userId: "user-1",
            },
          ],
        };
      },
      upsertBillingAccount: async () => {},
      upsertBillingPayment: async () => {},
    },
  );

  assert.deepStrictEqual(result, {
    items: [
      {
        amountTotal: 5000,
        currency: "usd",
        occurredAt: "2025-03-19T00:00:00.000Z",
        paymentKind: "lifetime_checkout",
        providerObjectId: "cs_test_lifetime",
        providerObjectType: "checkout.session",
        status: "paid",
        userId: "user-1",
      },
    ],
    nextToken: "token-2",
  });
});
