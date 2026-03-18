import { createHmac, timingSafeEqual } from "node:crypto";

import {
  getBillingAccount,
  upsertBillingAccount,
  type BillingAccountRecord,
} from "./repository";
import {
  hasFeature,
  isPlanId,
  resolvePlan,
  type BillingAccessSource,
  type FeatureKey,
  type PlanId,
} from "../../../lib/billing/plans";

type GraphqlEnv = Record<string, string | undefined>;

type GraphqlIdentity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type BillingSummary = {
  accessSource: BillingAccessSource;
  cancelAtPeriodEnd: boolean;
  currentPeriodEndAt: string | null;
  hasBillingCustomer: boolean;
  planId: PlanId;
  subscriptionStatus: string | null;
};

type CheckoutSession = {
  client_reference_id?: string | null;
  customer?: string | null | { id?: string | null };
  customer_details?: {
    email?: string | null;
  } | null;
  metadata?: Record<string, string | undefined> | null;
  subscription?: string | null | { id?: string | null };
};

type Invoice = {
  customer?: string | null | { id?: string | null };
  customer_email?: string | null;
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
  upsertBillingAccount: typeof upsertBillingAccount;
};

const WEBHOOK_TOLERANCE_SECONDS = 300;

const defaultRuntime: StripeRuntime = {
  createPortalSession,
  createSubscriptionCheckoutSession,
  getBillingAccount,
  getStripeSubscription,
  upsertBillingAccount,
};

export type { BillingSummary };

export const __testing = {
  buildBillingSummary,
  resolveConfiguredDefaultPlan,
  verifyStripeWebhookEvent,
};

export async function getBillingSummary(args: {
  env: GraphqlEnv;
  identity: unknown;
}, runtime: StripeRuntime = defaultRuntime): Promise<BillingSummary> {
  const userId = requireUserId(args.identity);
  const billingAccount = await runtime.getBillingAccount(args.env, userId);
  return buildBillingSummary(billingAccount, resolveConfiguredDefaultPlan(args.env));
}

export async function createBillingCheckoutSession(args: {
  appBaseUrl: string;
  env: GraphqlEnv;
  identity: unknown;
  premiumPriceId: string;
  stripeSecretKey: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<{ url: string }> {
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

  return runtime.createSubscriptionCheckoutSession(args.stripeSecretKey, {
    cancelUrl: buildAppUrl(args.appBaseUrl, "/workspace/ops?billing=cancelled"),
    customerEmail: email,
    customerId: billingAccount?.stripeCustomerId ?? null,
    premiumPriceId: args.premiumPriceId,
    successUrl: buildAppUrl(args.appBaseUrl, "/workspace/ops?billing=success"),
    userId,
  });
}

export async function createBillingPortalSession(args: {
  appBaseUrl: string;
  env: GraphqlEnv;
  identity: unknown;
  stripeSecretKey: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<{ url: string }> {
  const userId = requireUserId(args.identity);
  const billingAccount = await runtime.getBillingAccount(args.env, userId);
  const customerId = billingAccount?.stripeCustomerId?.trim();
  if (!customerId) {
    throw new Error("No Stripe customer is associated with this account yet.");
  }

  return runtime.createPortalSession(args.stripeSecretKey, {
    customerId,
    returnUrl: buildAppUrl(args.appBaseUrl, "/workspace/ops"),
  });
}

export async function requireFeatureAccess(args: {
  env: GraphqlEnv;
  featureKey: FeatureKey;
  userId: string;
}, runtime: StripeRuntime = defaultRuntime): Promise<PlanId> {
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
  return buildBillingSummary(nextRecord, resolveConfiguredDefaultPlan(args.env));
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
  defaultPlanId: PlanId | null = null,
): BillingSummary {
  const planResolution = resolvePlan(billingAccount, { defaultPlanId });
  return {
    accessSource: planResolution.accessSource,
    cancelAtPeriodEnd: Boolean(billingAccount?.cancelAtPeriodEnd),
    currentPeriodEndAt: billingAccount?.currentPeriodEndAt ?? null,
    hasBillingCustomer: Boolean(billingAccount?.stripeCustomerId),
    planId: planResolution.planId,
    subscriptionStatus: billingAccount?.stripeSubscriptionStatus ?? null,
  };
}

function resolveConfiguredDefaultPlan(env: GraphqlEnv): PlanId | null {
  const configuredValue = normalizeOptionalString(env.BILLING_DEFAULT_PLAN ?? null);
  if (!configuredValue) {
    return null;
  }

  if (!isPlanId(configuredValue)) {
    throw new Error("BILLING_DEFAULT_PLAN must be set to a recognized plan id.");
  }

  return configuredValue;
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
  const userId = normalizeOptionalString(
    asOptionalString(session.client_reference_id) ??
      asOptionalString(readStringMap(session.metadata)?.userId) ??
      null,
  );
  const email = normalizeOptionalString(asOptionalString(session.customer_details?.email) ?? null);
  const subscriptionId = normalizeOptionalString(readStripeId(session.subscription));

  if (subscriptionId) {
    await syncFromSubscriptionObject(args, { id: subscriptionId }, userId, email, runtime);
    return;
  }

  if (!userId) {
    return;
  }

  const existing = await runtime.getBillingAccount(args.env, userId);
  await runtime.upsertBillingAccount(args.env, {
    cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? null,
    currentPeriodEndAt: existing?.currentPeriodEndAt ?? null,
    email: email ?? existing?.email ?? null,
    grantedPlanId: existing?.grantedPlanId ?? null,
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

async function syncFromInvoice(
  args: {
    body: string;
    env: GraphqlEnv;
    signatureHeader: string | null;
    stripeSecretKey: string;
    webhookSecret: string;
  },
  invoice: Invoice,
  runtime: StripeRuntime,
): Promise<void> {
  const subscriptionId = normalizeOptionalString(readStripeId(invoice.subscription));
  if (!subscriptionId) {
    return;
  }

  await syncFromSubscriptionObject(
    args,
    { id: subscriptionId },
    null,
    normalizeOptionalString(asOptionalString(invoice.customer_email) ?? null),
    runtime,
  );
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
): Promise<void> {
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

  await runtime.upsertBillingAccount(args.env, {
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    currentPeriodEndAt: fromUnixTimestamp(subscription.current_period_end),
    email: fallbackEmail ?? existing?.email ?? null,
    grantedPlanId: existing?.grantedPlanId ?? null,
    overrideExpiresAt: existing?.overrideExpiresAt ?? null,
    overrideReason: existing?.overrideReason ?? null,
    stripeCustomerId:
      normalizeOptionalString(readStripeId(subscription.customer)) ??
      existing?.stripeCustomerId ??
      null,
    stripePriceId: normalizeOptionalString(price?.id ?? null) ?? existing?.stripePriceId ?? null,
    stripeSubscriptionId: normalizeOptionalString(subscription.id ?? null) ?? subscriptionId,
    stripeSubscriptionStatus: normalizeOptionalString(subscription.status ?? null),
    subscriptionPlanId: planId ?? existing?.subscriptionPlanId ?? null,
    userId,
  });
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

function normalizeOptionalString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePlanId(value: string | null): PlanId | null {
  return isPlanId(value) ? value : null;
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
