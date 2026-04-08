import { createHmac, timingSafeEqual } from "node:crypto";

import {
  getBillingAccount,
  listBillingPaymentsByUserId,
  upsertBillingAccount,
  upsertBillingPayment,
  type BillingAccountRecord,
  type BillingPaymentRecord,
} from "./repository";
import {
  hasFeature,
  isPlanId,
  resolvePlan,
  type BillingAccessSource,
  type FeatureKey,
  type PlanId,
} from "../../../lib/billing/plans";
import { resolveCommercialModeEnabled } from "../../../lib/billing/commercial-mode";
import { assertMaintenanceInactive } from "./maintenance";

type GraphqlEnv = Record<string, string | undefined>;

type GraphqlIdentity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type BillingOfferFlags = {
  lifetimePurchaseOfferEnabled: boolean;
  premiumSubscriptionOfferEnabled: boolean;
};

type BillingSummary = {
  accessSource: BillingAccessSource;
  cancelAtPeriodEnd: boolean;
  currentPeriodEndAt: string | null;
  hasBillingCustomer: boolean;
  hasLifetimeAccess: boolean;
  lifetimeGrantedAt: string | null;
  lifetimePurchaseOfferEnabled: boolean;
  planId: PlanId;
  premiumSubscriptionOfferEnabled: boolean;
  subscriptionStatus: string | null;
};

type BillingPaymentsPage = {
  items: BillingPaymentRecord[];
  nextToken: string | null;
};

type CheckoutSession = {
  amount_total?: number | null;
  client_reference_id?: string | null;
  created?: number | null;
  currency?: string | null;
  customer?: string | null | { id?: string | null };
  customer_details?: {
    email?: string | null;
  } | null;
  id?: string | null;
  metadata?: Record<string, string | undefined> | null;
  payment_intent?: string | null | { id?: string | null };
  payment_status?: string | null;
  subscription?: string | null | { id?: string | null };
};

type Invoice = {
  amount_due?: number | null;
  amount_paid?: number | null;
  created?: number | null;
  currency?: string | null;
  customer?: string | null | { id?: string | null };
  customer_email?: string | null;
  id?: string | null;
  status?: string | null;
  subscription?: string | null | { id?: string | null };
};

type StripePrice = {
  id?: string | null;
  metadata?: Record<string, string | undefined> | null;
};

type StripeSubscription = {
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null;
  customer?: string | null | { id?: string | null };
  id?: string | null;
  items?: {
    data?: Array<{
      price?: StripePrice | null;
    }>;
  } | null;
  metadata?: Record<string, string | undefined> | null;
  status?: string | null;
};

type StripeWebhookEvent = {
  data?: {
    object?: unknown;
  };
  type?: string;
};

type StripeRuntime = {
  createPaymentCheckoutSession: (
    secretKey: string,
    input: {
      cancelUrl: string;
      customerEmail: string | null;
      customerId: string | null;
      grantedPlanId: PlanId;
      lifetimePriceId: string;
      successUrl: string;
      userId: string;
    },
  ) => Promise<{ url: string }>;
  createPortalSession: (
    secretKey: string,
    input: {
      customerId: string;
      returnUrl: string;
    },
  ) => Promise<{ url: string }>;
  createSubscriptionCheckoutSession: (
    secretKey: string,
    input: {
      cancelUrl: string;
      customerEmail: string | null;
      customerId: string | null;
      premiumPriceId: string;
      successUrl: string;
      userId: string;
    },
  ) => Promise<{ url: string }>;
  getBillingAccount: typeof getBillingAccount;
  getStripeSubscription: (
    secretKey: string,
    subscriptionId: string,
  ) => Promise<StripeSubscription>;
  listBillingPaymentsByUserId: typeof listBillingPaymentsByUserId;
  upsertBillingAccount: typeof upsertBillingAccount;
  upsertBillingPayment: typeof upsertBillingPayment;
};

type BuildBillingSummaryOptions = {
  defaultPlanId?: PlanId | null;
  offerFlags?: BillingOfferFlags;
};

type SubscriptionSyncResult = {
  planId: PlanId | null;
  priceId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  userId: string;
};

const WEBHOOK_TOLERANCE_SECONDS = 300;
const DEFAULT_BILLING_RETURN_PATH = "/workspace/ops";
const MAX_BILLING_PAYMENT_PAGE_SIZE = 50;

const defaultRuntime: StripeRuntime = {
  createPaymentCheckoutSession,
  createPortalSession,
  createSubscriptionCheckoutSession,
  getBillingAccount,
  getStripeSubscription,
  listBillingPaymentsByUserId,
  upsertBillingAccount,
  upsertBillingPayment,
};

export type { BillingPaymentsPage, BillingSummary };

export const __testing = {
  appendQueryParam,
  buildBillingSummary,
  resolveBillingOfferFlags,
  resolveConfiguredDefaultPlan,
  sanitizeReturnPath,
  verifyStripeWebhookEvent,
};

export async function getBillingSummary(args: {
  env: GraphqlEnv;
  identity: unknown;
}, runtime: StripeRuntime = defaultRuntime): Promise<BillingSummary> {
  await assertMaintenanceInactive();

  const userId = requireUserId(args.identity);
  const billingAccount = await runtime.getBillingAccount(args.env, userId);
  return buildBillingSummary(billingAccount, {
    defaultPlanId: resolveConfiguredDefaultPlan(args.env),
    offerFlags: resolveBillingOfferFlags(args.env),
  });
}

export async function listBillingPayments(args: {
  env: GraphqlEnv;
  identity: unknown;
  limit?: number | null;
  nextToken?: string | null;
}, runtime: StripeRuntime = defaultRuntime): Promise<BillingPaymentsPage> {
  await assertMaintenanceInactive();

  const userId = requireUserId(args.identity);
  const page = await runtime.listBillingPaymentsByUserId(args.env, userId, {
    limit: clampBillingPaymentLimit(args.limit),
    nextToken: normalizeOptionalString(args.nextToken ?? null),
  });

  return {
    items: page.records,
    nextToken: page.nextToken,
  };
}

export async function createBillingCheckoutSession(args: {
  appBaseUrl: string;
  env: GraphqlEnv;
  identity: unknown;
  premiumPriceId: string;
  returnPath?: string | null;
  stripeSecretKey: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<{ url: string }> {
  await assertMaintenanceInactive();

  const offerFlags = resolveBillingOfferFlags(args.env);
  if (!offerFlags.premiumSubscriptionOfferEnabled) {
    throw new Error("Premium subscriptions are not available right now.");
  }

  const userId = requireUserId(args.identity);
  const email = resolveUserEmail(args.identity);
  const billingAccount = await runtime.getBillingAccount(args.env, userId);

  if (hasNonTerminalSubscription(billingAccount)) {
    throw new Error(
      "Billing is already active for this account. Use the billing portal to manage it.",
    );
  }

  if (!billingAccount?.stripeCustomerId && !email) {
    throw new Error("Your account email is unavailable for billing setup.");
  }

  const returnPath = sanitizeReturnPath(args.returnPath ?? null);

  return runtime.createSubscriptionCheckoutSession(args.stripeSecretKey, {
    cancelUrl: buildAppUrl(
      args.appBaseUrl,
      appendQueryParam(returnPath, "billing", "cancelled"),
    ),
    customerEmail: email,
    customerId: billingAccount?.stripeCustomerId ?? null,
    premiumPriceId: args.premiumPriceId,
    successUrl: buildAppUrl(
      args.appBaseUrl,
      appendQueryParam(returnPath, "billing", "success"),
    ),
    userId,
  });
}

export async function createBillingLifetimeCheckoutSession(args: {
  appBaseUrl: string;
  env: GraphqlEnv;
  identity: unknown;
  lifetimePriceId: string;
  returnPath?: string | null;
  stripeSecretKey: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<{ url: string }> {
  await assertMaintenanceInactive();

  const offerFlags = resolveBillingOfferFlags(args.env);
  if (!offerFlags.lifetimePurchaseOfferEnabled) {
    throw new Error("Lifetime purchases are not available right now.");
  }

  const userId = requireUserId(args.identity);
  const email = resolveUserEmail(args.identity);
  const billingAccount = await runtime.getBillingAccount(args.env, userId);

  if (hasLifetimeAccessGrant(billingAccount)) {
    throw new Error("Lifetime access has already been granted for this account.");
  }

  if (!billingAccount?.stripeCustomerId && !email) {
    throw new Error("Your account email is unavailable for billing setup.");
  }

  const returnPath = sanitizeReturnPath(args.returnPath ?? null);

  return runtime.createPaymentCheckoutSession(args.stripeSecretKey, {
    cancelUrl: buildAppUrl(
      args.appBaseUrl,
      appendQueryParam(returnPath, "billing", "cancelled"),
    ),
    customerEmail: email,
    customerId: billingAccount?.stripeCustomerId ?? null,
    grantedPlanId: "premium",
    lifetimePriceId: args.lifetimePriceId,
    successUrl: buildAppUrl(
      args.appBaseUrl,
      appendQueryParam(returnPath, "billing", "success"),
    ),
    userId,
  });
}

export async function createBillingPortalSession(args: {
  appBaseUrl: string;
  env: GraphqlEnv;
  identity: unknown;
  returnPath?: string | null;
  stripeSecretKey: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<{ url: string }> {
  await assertMaintenanceInactive();

  const userId = requireUserId(args.identity);
  const billingAccount = await runtime.getBillingAccount(args.env, userId);
  const customerId = billingAccount?.stripeCustomerId?.trim();
  if (!customerId) {
    throw new Error("No Stripe customer is associated with this account yet.");
  }

  return runtime.createPortalSession(args.stripeSecretKey, {
    customerId,
    returnUrl: buildAppUrl(
      args.appBaseUrl,
      sanitizeReturnPath(args.returnPath ?? null),
    ),
  });
}

export async function requireFeatureAccess(args: {
  env: GraphqlEnv;
  featureKey: FeatureKey;
  userId: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<PlanId> {
  if (!resolveCommercialModeEnabled(args.env)) {
    return "free";
  }

  const billingAccount = await runtime.getBillingAccount(args.env, args.userId);
  const { planId } = resolvePlan(billingAccount, {
    defaultPlanId: resolveConfiguredDefaultPlan(args.env),
  });
  if (hasFeature(planId, args.featureKey)) {
    return planId;
  }

  throw new Error(buildFeatureAccessError(args.featureKey));
}

export async function setBillingOverride(args: {
  env: GraphqlEnv;
  overrideExpiresAt?: string | null;
  overrideReason?: string | null;
  planId?: PlanId | null;
  userId: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<BillingSummary> {
  const existing = await runtime.getBillingAccount(args.env, args.userId);
  const nextPlanId = args.planId ?? null;
  if (nextPlanId !== null && !isPlanId(nextPlanId)) {
    throw new Error("Billing override planId must be a recognized plan.");
  }

  const overrideExpiresAt =
    nextPlanId === null ? null : normalizeOptionalDateTime(args.overrideExpiresAt ?? null);

  const nextRecord: BillingAccountRecord = {
    cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? null,
    currentPeriodEndAt: existing?.currentPeriodEndAt ?? null,
    email: existing?.email ?? null,
    grantedPlanId: nextPlanId,
    ...buildPreservedLifetimeFields(existing),
    overrideExpiresAt,
    overrideReason: nextPlanId ? normalizeOptionalString(args.overrideReason ?? null) : null,
    stripeCustomerId: existing?.stripeCustomerId ?? null,
    stripePriceId: existing?.stripePriceId ?? null,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
    stripeSubscriptionStatus: existing?.stripeSubscriptionStatus ?? null,
    subscriptionPlanId: existing?.subscriptionPlanId ?? null,
    userId: args.userId,
  };

  await runtime.upsertBillingAccount(args.env, nextRecord);
  return buildBillingSummary(nextRecord, {
    defaultPlanId: resolveConfiguredDefaultPlan(args.env),
    offerFlags: resolveBillingOfferFlags(args.env),
  });
}

export async function handleStripeWebhook(args: {
  body: string;
  env: GraphqlEnv;
  signatureHeader: string | null;
  stripeSecretKey: string;
  webhookSecret: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<void> {
  const event = verifyStripeWebhookEvent({
    body: args.body,
    signatureHeader: args.signatureHeader,
    webhookSecret: args.webhookSecret,
  });
  const eventType = event.type ?? "";
  const object = event.data?.object;

  switch (eventType) {
    case "checkout.session.completed":
      await syncFromCheckoutSession(
        args,
        requireRecord(object, "Stripe checkout session") as CheckoutSession,
        runtime,
      );
      return;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncFromSubscriptionObject(
        args,
        requireRecord(object, "Stripe subscription"),
        null,
        null,
        runtime,
      );
      return;
    case "invoice.paid":
    case "invoice.payment_failed":
      await syncFromInvoice(
        args,
        eventType,
        requireRecord(object, "Stripe invoice") as Invoice,
        runtime,
      );
      return;
    default:
      return;
  }
}

export function verifyStripeWebhookEvent(args: {
  body: string;
  signatureHeader: string | null;
  webhookSecret: string;
}): StripeWebhookEvent {
  const signatureHeader = args.signatureHeader?.trim();
  if (!signatureHeader) {
    throw new Error("Stripe signature header is missing.");
  }

  const signatureParts = parseStripeSignature(signatureHeader);
  if (!signatureParts.timestamp || !signatureParts.signatures.length) {
    throw new Error("Stripe signature header is malformed.");
  }

  const timestamp = Number(signatureParts.timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Stripe signature timestamp is invalid.");
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Stripe webhook signature is outside the replay tolerance.");
  }

  const payload = `${signatureParts.timestamp}.${args.body}`;
  const expectedSignature = createHmac("sha256", args.webhookSecret)
    .update(payload)
    .digest("hex");

  const signatureMatches = signatureParts.signatures.some((signature) =>
    secureCompareHex(signature, expectedSignature),
  );
  if (!signatureMatches) {
    throw new Error("Stripe webhook signature verification failed.");
  }

  return requireRecord(JSON.parse(args.body), "Stripe event") as StripeWebhookEvent;
}

export function buildBillingSummary(
  billingAccount: BillingAccountRecord | null | undefined,
  options: BuildBillingSummaryOptions | PlanId | null = {},
): BillingSummary {
  const normalizedOptions =
    typeof options === "string" || options === null
      ? { defaultPlanId: options }
      : options;
  const offerFlags = normalizedOptions.offerFlags ?? resolveBillingOfferFlags({});
  const planResolution = resolvePlan(billingAccount, {
    defaultPlanId: normalizedOptions.defaultPlanId ?? null,
  });
  return {
    accessSource: planResolution.accessSource,
    cancelAtPeriodEnd: Boolean(billingAccount?.cancelAtPeriodEnd),
    currentPeriodEndAt: billingAccount?.currentPeriodEndAt ?? null,
    hasBillingCustomer: Boolean(billingAccount?.stripeCustomerId),
    hasLifetimeAccess: hasLifetimeAccessGrant(billingAccount),
    lifetimeGrantedAt: billingAccount?.lifetimeGrantedAt ?? null,
    lifetimePurchaseOfferEnabled: offerFlags.lifetimePurchaseOfferEnabled,
    planId: planResolution.planId,
    premiumSubscriptionOfferEnabled: offerFlags.premiumSubscriptionOfferEnabled,
    subscriptionStatus: billingAccount?.stripeSubscriptionStatus ?? null,
  };
}

function resolveConfiguredDefaultPlan(env: GraphqlEnv): PlanId | null {
  if (!resolveCommercialModeEnabled(env)) {
    return null;
  }

  const configuredValue = normalizeOptionalString(env.BILLING_DEFAULT_PLAN ?? null);
  if (!configuredValue) {
    return null;
  }

  if (!isPlanId(configuredValue)) {
    throw new Error("BILLING_DEFAULT_PLAN must be set to a recognized plan id.");
  }

  return configuredValue;
}

function resolveBillingOfferFlags(env: GraphqlEnv): BillingOfferFlags {
  if (!resolveCommercialModeEnabled(env)) {
    return {
      lifetimePurchaseOfferEnabled: false,
      premiumSubscriptionOfferEnabled: false,
    };
  }

  return {
    lifetimePurchaseOfferEnabled: parseBooleanEnv(
      env.BILLING_ENABLE_LIFETIME_PURCHASE,
      false,
    ),
    premiumSubscriptionOfferEnabled: parseBooleanEnv(
      env.BILLING_ENABLE_PREMIUM_SUBSCRIPTION,
      true,
    ),
  };
}

async function syncFromCheckoutSession(
  args: {
    body: string;
    env: GraphqlEnv;
    signatureHeader: string | null;
    stripeSecretKey: string;
    webhookSecret: string;
  },
  session: CheckoutSession,
  runtime: StripeRuntime,
): Promise<void> {
  const metadata = readStringMap(session.metadata);
  const userId = normalizeOptionalString(
    asOptionalString(session.client_reference_id) ??
      asOptionalString(metadata?.userId) ??
      null,
  );
  const email = normalizeOptionalString(
    asOptionalString(session.customer_details?.email) ?? null,
  );
  const subscriptionId = normalizeOptionalString(readStripeId(session.subscription));

  if (subscriptionId) {
    await syncFromSubscriptionObject(args, { id: subscriptionId }, userId, email, runtime);
    return;
  }

  if (!userId) {
    return;
  }

  const purchaseKind = normalizeOptionalString(metadata?.purchaseKind ?? null);
  if (purchaseKind === "lifetime") {
    await syncLifetimeCheckout(args.env, session, userId, email, metadata, runtime);
    return;
  }

  const existing = await runtime.getBillingAccount(args.env, userId);
  await runtime.upsertBillingAccount(args.env, {
    cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? null,
    currentPeriodEndAt: existing?.currentPeriodEndAt ?? null,
    email: email ?? existing?.email ?? null,
    grantedPlanId: existing?.grantedPlanId ?? null,
    ...buildPreservedLifetimeFields(existing),
    overrideExpiresAt: existing?.overrideExpiresAt ?? null,
    overrideReason: existing?.overrideReason ?? null,
    stripeCustomerId:
      normalizeOptionalString(readStripeId(session.customer)) ??
      existing?.stripeCustomerId ??
      null,
    stripePriceId: existing?.stripePriceId ?? null,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
    stripeSubscriptionStatus: existing?.stripeSubscriptionStatus ?? null,
    subscriptionPlanId: existing?.subscriptionPlanId ?? null,
    userId,
  });
}

async function syncLifetimeCheckout(
  env: GraphqlEnv,
  session: CheckoutSession,
  userId: string,
  email: string | null,
  metadata: Record<string, string | undefined> | null,
  runtime: StripeRuntime,
): Promise<void> {
  const paymentStatus = normalizeOptionalString(session.payment_status ?? null);
  if (paymentStatus !== "paid") {
    return;
  }

  const grantedPlanId = normalizePlanId(metadata?.grantedPlanId ?? null);
  if (!grantedPlanId) {
    throw new Error("Stripe lifetime checkout did not include a recognized grantedPlanId.");
  }

  const existing = await runtime.getBillingAccount(env, userId);
  const checkoutSessionId = normalizeOptionalString(session.id ?? null);
  const occurredAt = fromUnixTimestamp(session.created) ?? new Date().toISOString();
  const stripeCustomerId =
    normalizeOptionalString(readStripeId(session.customer)) ??
    existing?.stripeCustomerId ??
    null;
  const stripePriceId = normalizeOptionalString(metadata?.priceId ?? null);

  await runtime.upsertBillingAccount(env, {
    cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? null,
    currentPeriodEndAt: existing?.currentPeriodEndAt ?? null,
    email: email ?? existing?.email ?? null,
    grantedPlanId: existing?.grantedPlanId ?? null,
    lifetimeGrantedAt: existing?.lifetimeGrantedAt ?? occurredAt,
    lifetimePlanId: grantedPlanId,
    lifetimeSourceObjectId:
      checkoutSessionId ?? existing?.lifetimeSourceObjectId ?? undefined,
    overrideExpiresAt: existing?.overrideExpiresAt ?? null,
    overrideReason: existing?.overrideReason ?? null,
    stripeCustomerId,
    stripePriceId: stripePriceId ?? existing?.stripePriceId ?? null,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
    stripeSubscriptionStatus: existing?.stripeSubscriptionStatus ?? null,
    subscriptionPlanId: existing?.subscriptionPlanId ?? null,
    userId,
  });

  if (!checkoutSessionId) {
    return;
  }

  await runtime.upsertBillingPayment(env, {
    amountTotal: normalizeOptionalInteger(session.amount_total),
    currency: normalizeOptionalString(session.currency ?? null),
    grantedPlanId,
    occurredAt,
    paymentKind: "lifetime_checkout",
    providerObjectId: checkoutSessionId,
    providerObjectType: "checkout.session",
    status: paymentStatus,
    stripeCheckoutSessionId: checkoutSessionId,
    stripeCustomerId,
    stripePaymentIntentId: normalizeOptionalString(readStripeId(session.payment_intent)),
    stripePriceId,
    userId,
  });
}

async function syncFromInvoice(
  args: {
    body: string;
    env: GraphqlEnv;
    signatureHeader: string | null;
    stripeSecretKey: string;
    webhookSecret: string;
  },
  eventType: string,
  invoice: Invoice,
  runtime: StripeRuntime,
): Promise<void> {
  const subscriptionId = normalizeOptionalString(readStripeId(invoice.subscription));
  if (!subscriptionId) {
    return;
  }

  const syncResult = await syncFromSubscriptionObject(
    args,
    { id: subscriptionId },
    null,
    normalizeOptionalString(asOptionalString(invoice.customer_email) ?? null),
    runtime,
  );

  const invoiceId = normalizeOptionalString(invoice.id ?? null);
  if (!invoiceId) {
    return;
  }

  await runtime.upsertBillingPayment(args.env, {
    amountTotal: normalizeOptionalInteger(invoice.amount_paid ?? invoice.amount_due),
    currency: normalizeOptionalString(invoice.currency ?? null),
    grantedPlanId: syncResult.planId,
    occurredAt: fromUnixTimestamp(invoice.created) ?? new Date().toISOString(),
    paymentKind: "subscription_invoice",
    providerObjectId: invoiceId,
    providerObjectType: "invoice",
    status:
      eventType === "invoice.paid"
        ? "paid"
        : normalizeOptionalString(invoice.status ?? null) ?? "payment_failed",
    stripeCustomerId: syncResult.stripeCustomerId,
    stripeInvoiceId: invoiceId,
    stripePriceId: syncResult.priceId,
    stripeSubscriptionId: syncResult.stripeSubscriptionId,
    userId: syncResult.userId,
  });
}

async function syncFromSubscriptionObject(
  args: {
    body: string;
    env: GraphqlEnv;
    signatureHeader: string | null;
    stripeSecretKey: string;
    webhookSecret: string;
  },
  subscriptionLike: Record<string, unknown>,
  fallbackUserId: string | null,
  fallbackEmail: string | null,
  runtime: StripeRuntime,
): Promise<SubscriptionSyncResult> {
  const subscriptionId = normalizeOptionalString(readStripeId(subscriptionLike.id));
  if (!subscriptionId) {
    throw new Error("Stripe subscription event did not include an id.");
  }

  const subscription = await runtime.getStripeSubscription(args.stripeSecretKey, subscriptionId);
  const metadata = readStringMap(subscription.metadata);
  const userId = normalizeOptionalString(metadata?.userId ?? fallbackUserId);
  if (!userId) {
    throw new Error("Stripe subscription metadata did not include a userId.");
  }

  const existing = await runtime.getBillingAccount(args.env, userId);
  const price = subscription.items?.data?.[0]?.price ?? null;
  const planId = normalizePlanId(price?.metadata?.app_plan_id ?? null);
  const priceId = normalizeOptionalString(price?.id ?? null);
  const stripeCustomerId =
    normalizeOptionalString(readStripeId(subscription.customer)) ??
    existing?.stripeCustomerId ??
    null;

  await runtime.upsertBillingAccount(args.env, {
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    currentPeriodEndAt: fromUnixTimestamp(subscription.current_period_end),
    email: fallbackEmail ?? existing?.email ?? null,
    grantedPlanId: existing?.grantedPlanId ?? null,
    ...buildPreservedLifetimeFields(existing),
    overrideExpiresAt: existing?.overrideExpiresAt ?? null,
    overrideReason: existing?.overrideReason ?? null,
    stripeCustomerId,
    stripePriceId: priceId ?? existing?.stripePriceId ?? null,
    stripeSubscriptionId: normalizeOptionalString(subscription.id ?? null) ?? subscriptionId,
    stripeSubscriptionStatus: normalizeOptionalString(subscription.status ?? null),
    subscriptionPlanId: planId ?? existing?.subscriptionPlanId ?? null,
    userId,
  });

  return {
    planId,
    priceId,
    stripeCustomerId,
    stripeSubscriptionId:
      normalizeOptionalString(subscription.id ?? null) ?? subscriptionId,
    userId,
  };
}

function buildFeatureAccessError(featureKey: FeatureKey): string {
  switch (featureKey) {
    case "leagueWriteups":
      return "Premium is required to generate league writeups.";
    case "predictions":
      return "Premium is required to use the prediction engine.";
    case "teamHighlights":
      return "Premium is required to scan team highlights.";
    default:
      return "Your current plan does not include this feature.";
  }
}

function buildAppUrl(appBaseUrl: string, path: string): string {
  const base = appBaseUrl.trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("Cannot buildAppUrl without app base url. is APP_BASE_URL configured?");
  }

  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function sanitizeReturnPath(value: string | null): string {
  const normalized = normalizeOptionalString(value);
  if (
    !normalized ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("://")
  ) {
    return DEFAULT_BILLING_RETURN_PATH;
  }

  return normalized;
}

function appendQueryParam(path: string, key: string, value: string): string {
  const url = new URL(path, "https://app.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function createPortalSession(
  secretKey: string,
  input: {
    customerId: string;
    returnUrl: string;
  },
): Promise<{ url: string }> {
  const params = new URLSearchParams();
  params.set("customer", input.customerId);
  params.set("return_url", input.returnUrl);

  return stripeFormRequest(secretKey, "/billing_portal/sessions", params);
}

async function createSubscriptionCheckoutSession(
  secretKey: string,
  input: {
    cancelUrl: string;
    customerEmail: string | null;
    customerId: string | null;
    premiumPriceId: string;
    successUrl: string;
    userId: string;
  },
): Promise<{ url: string }> {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", input.premiumPriceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.userId);
  params.set("metadata[userId]", input.userId);
  params.set("subscription_data[metadata][userId]", input.userId);

  if (input.customerId) {
    params.set("customer", input.customerId);
  } else if (input.customerEmail) {
    params.set("customer_email", input.customerEmail);
  }

  return stripeFormRequest(secretKey, "/checkout/sessions", params);
}

async function createPaymentCheckoutSession(
  secretKey: string,
  input: {
    cancelUrl: string;
    customerEmail: string | null;
    customerId: string | null;
    grantedPlanId: PlanId;
    lifetimePriceId: string;
    successUrl: string;
    userId: string;
  },
): Promise<{ url: string }> {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("line_items[0][price]", input.lifetimePriceId);
  params.set("line_items[0][quantity]", "1");
  params.set("payment_method_types[0]", "card");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.userId);
  params.set("metadata[userId]", input.userId);
  params.set("metadata[purchaseKind]", "lifetime");
  params.set("metadata[grantedPlanId]", input.grantedPlanId);
  params.set("metadata[priceId]", input.lifetimePriceId);

  if (input.customerId) {
    params.set("customer", input.customerId);
  } else if (input.customerEmail) {
    params.set("customer_email", input.customerEmail);
  }

  return stripeFormRequest(secretKey, "/checkout/sessions", params);
}

function fromUnixTimestamp(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function hasNonTerminalSubscription(account: BillingAccountRecord | null): boolean {
  const status = account?.stripeSubscriptionStatus?.trim().toLowerCase();
  return Boolean(
    account?.stripeSubscriptionId &&
      status &&
      !["canceled", "incomplete_expired"].includes(status),
  );
}

function hasLifetimeAccessGrant(
  account: BillingAccountRecord | null | undefined,
): boolean {
  return isPlanId(account?.lifetimePlanId ?? null);
}

function buildPreservedLifetimeFields(
  account: BillingAccountRecord | null | undefined,
): Partial<
  Pick<
    BillingAccountRecord,
    "lifetimeGrantedAt" | "lifetimePlanId" | "lifetimeSourceObjectId"
  >
> {
  return {
    ...(account?.lifetimeGrantedAt
      ? { lifetimeGrantedAt: account.lifetimeGrantedAt }
      : {}),
    ...(account?.lifetimePlanId ? { lifetimePlanId: account.lifetimePlanId } : {}),
    ...(account?.lifetimeSourceObjectId
      ? { lifetimeSourceObjectId: account.lifetimeSourceObjectId }
      : {}),
  };
}

function normalizeOptionalDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Override expiry must be a valid ISO datetime.");
  }

  return new Date(parsed).toISOString();
}

function normalizeOptionalInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePlanId(value: string | null): PlanId | null {
  return isPlanId(value) ? value : null;
}

function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = normalizeOptionalString(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function clampBillingPaymentLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  return Math.max(1, Math.min(MAX_BILLING_PAYMENT_PAGE_SIZE, Math.trunc(value)));
}

function parseStripeSignature(header: string): {
  signatures: string[];
  timestamp: string | null;
} {
  const values = {
    signatures: [] as string[],
    timestamp: null as string | null,
  };

  for (const segment of header.split(",")) {
    const [key, rawValue] = segment.split("=", 2);
    const value = rawValue?.trim() ?? "";
    if (key === "t") {
      values.timestamp = value;
      continue;
    }

    if (key === "v1" && value) {
      values.signatures.push(value);
    }
  }

  return values;
}

function readStringMap(
  value: unknown,
): Record<string, string | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, string | undefined>;
}

function readStripeId(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return asOptionalString((value as { id?: unknown }).id) ?? null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object.`);
  }

  return value as Record<string, unknown>;
}

function requireUserId(identity: unknown): string {
  const userId = resolveUserId(identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }
  return userId;
}

function resolveUserEmail(identity: unknown): string | null {
  const claims =
    identity && typeof identity === "object" && !Array.isArray(identity)
      ? (identity as GraphqlIdentity).claims
      : null;
  const email = claims && typeof claims.email === "string" ? claims.email : null;
  return normalizeOptionalString(email);
}

function resolveUserId(identity: unknown): string | null {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    return null;
  }

  const record = identity as GraphqlIdentity;
  const sub = record.sub;
  if (typeof sub === "string" && sub.trim()) {
    return sub;
  }

  return null;
}

function secureCompareHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function stripeFormRequest<TResponse extends { url: string }>(
  secretKey: string,
  path: string,
  params: URLSearchParams,
): Promise<TResponse> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    body: params.toString(),
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    url?: string;
  };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error?.message ?? "Stripe request failed.");
  }

  return payload as TResponse;
}

async function getStripeSubscription(
  secretKey: string,
  subscriptionId: string,
): Promise<StripeSubscription> {
  const params = new URLSearchParams();
  params.append("expand[]", "items.data.price");

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
      method: "GET",
    },
  );

  const payload = (await response.json()) as StripeSubscription & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Unable to load the Stripe subscription.");
  }

  return payload;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
