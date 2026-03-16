export type PlanId = "free" | "premium";

export type FeatureKey =
  | "predictions"
  | "leagueWriteups"
  | "teamHighlights";

export type BillingAccessSource =
  | "default"
  | "subscription"
  | "override"
  | "environment";

export type BillingPlanLike = {
  currentPeriodEndAt?: string | null;
  grantedPlanId?: string | null;
  overrideExpiresAt?: string | null;
  stripeSubscriptionStatus?: string | null;
  subscriptionPlanId?: string | null;
};

export type PlanResolution = {
  accessSource: BillingAccessSource;
  planId: PlanId;
};

export type ResolvePlanOptions = {
  defaultPlanId?: PlanId | null;
};

const PLAN_IDS = ["free", "premium"] as const satisfies readonly PlanId[];
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export const PLAN_FEATURES: Record<PlanId, readonly FeatureKey[]> = {
  free: [],
  premium: ["predictions", "leagueWriteups", "teamHighlights"],
};

export function hasFeature(planId: PlanId, featureKey: FeatureKey): boolean {
  return PLAN_FEATURES[planId].includes(featureKey);
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && PLAN_IDS.includes(value as PlanId);
}

export function resolvePlan(
  account: BillingPlanLike | null | undefined,
  options: ResolvePlanOptions = {},
): PlanResolution {
  const grantedPlanId = account?.grantedPlanId;
  if (isPlanId(grantedPlanId) && !isExpired(account?.overrideExpiresAt ?? null)) {
    return {
      accessSource: "override",
      planId: grantedPlanId,
    };
  }

  const subscriptionPlanId = account?.subscriptionPlanId;
  const subscriptionStatus = normalizeSubscriptionStatus(
    account?.stripeSubscriptionStatus ?? null,
  );
  if (
    isPlanId(subscriptionPlanId) &&
    ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus) &&
    !isExpired(account?.currentPeriodEndAt ?? null)
  ) {
    return {
      accessSource: "subscription",
      planId: subscriptionPlanId,
    };
  }

  if (options.defaultPlanId) {
    return {
      accessSource: "environment",
      planId: options.defaultPlanId,
    };
  }

  return {
    accessSource: "default",
    planId: "free",
  };
}

function normalizeSubscriptionStatus(value: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isExpired(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return parsed <= Date.now();
}
