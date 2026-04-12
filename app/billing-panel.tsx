"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  billingPaymentsQueryOptions,
  createBillingCheckoutUrlMutation,
  createBillingLifetimeCheckoutUrlMutation,
  createBillingPortalUrlMutation,
} from "@/app/dashboard/workspace-query-client";
import type { BillingPaymentEntry, BillingSummary } from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  captureAnalyticsEvent,
  trackBillingAccessTransition,
} from "@/lib/analytics/client";

type BillingPanelProps = {
  error: string | null;
  isLoading: boolean;
  summary: BillingSummary | null;
};

type PremiumFeatureGatePanelProps = {
  billingSummary: BillingSummary | null;
  error: string | null;
  featureName: string;
  isLoading: boolean;
  message: string;
};

const billingReturnPath = "/workspace/ops";
const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const storeLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";
const paymentListClassName = "grid gap-3";
const paymentItemClassName =
  "grid gap-2 rounded-3xl border border-black/8 bg-white/65 p-4";

export function BillingPanel({ error, isLoading, summary }: BillingPanelProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const checkoutMutation = useMutation({
    mutationFn: () => createBillingCheckoutUrlMutation(billingReturnPath),
  });
  const lifetimeCheckoutMutation = useMutation({
    mutationFn: () =>
      createBillingLifetimeCheckoutUrlMutation(billingReturnPath),
  });
  const portalMutation = useMutation({
    mutationFn: () => createBillingPortalUrlMutation(billingReturnPath),
  });
  const paymentsQuery = useQuery({
    ...billingPaymentsQueryOptions({ limit: 5 }),
    enabled: Boolean(summary),
    placeholderData: (previousData) => previousData,
  });
  const payments = paymentsQuery.data?.items ?? [];
  const paymentsError = readQueryError(paymentsQuery.error);
  const isLoadingPayments = paymentsQuery.isPending;
  const isStartingCheckout = checkoutMutation.isPending;
  const isStartingLifetimeCheckout = lifetimeCheckoutMutation.isPending;
  const isOpeningPortal = portalMutation.isPending;

  async function handleCheckout(): Promise<void> {
    setActionError(null);
    captureAnalyticsEvent("billing_checkout_started", {
      offer_type: "subscription",
      source: "account_panel",
    });

    try {
      window.location.assign(await checkoutMutation.mutateAsync());
    } catch (checkoutError) {
      captureAnalyticsEvent("billing_checkout_failed", {
        offer_type: "subscription",
        source: "account_panel",
      });
      setActionError(formatClientError(checkoutError));
    }
  }

  async function handleLifetimeCheckout(): Promise<void> {
    setActionError(null);
    captureAnalyticsEvent("billing_checkout_started", {
      offer_type: "lifetime",
      source: "account_panel",
    });

    try {
      window.location.assign(await lifetimeCheckoutMutation.mutateAsync());
    } catch (checkoutError) {
      captureAnalyticsEvent("billing_checkout_failed", {
        offer_type: "lifetime",
        source: "account_panel",
      });
      setActionError(formatClientError(checkoutError));
    }
  }

  async function handlePortal(): Promise<void> {
    setActionError(null);
    captureAnalyticsEvent("billing_portal_opened", {
      source: "account_panel",
    });

    try {
      window.location.assign(await portalMutation.mutateAsync());
    } catch (portalError) {
      setActionError(formatClientError(portalError));
    }
  }

  useEffect(() => {
    if (!summary) {
      return;
    }

    trackBillingAccessTransition({
      accessSource: summary.accessSource,
      planId: summary.planId,
      source: "account_panel",
    });
  }, [summary?.accessSource, summary?.planId, summary]);

  return (
    <Panel>
      <SectionHeading
        actions={
          <>
            <Link className={storeLinkClassName} href="/store">
              Visit store
            </Link>
            {shouldOfferSubscription(summary) ? (
              <Button
                loading={isStartingCheckout}
                onClick={() => void handleCheckout()}
              >
                Start monthly plan
              </Button>
            ) : null}
            {shouldOfferLifetime(summary) ? (
              <Button
                loading={isStartingLifetimeCheckout}
                onClick={() => void handleLifetimeCheckout()}
                variant="secondary"
              >
                Buy lifetime access
              </Button>
            ) : null}
            {summary?.hasBillingCustomer ? (
              <Button
                loading={isOpeningPortal}
                onClick={() => void handlePortal()}
                variant="ghost"
              >
                Manage billing
              </Button>
            ) : null}
          </>
        }
        description="Use the store to browse offers. This account panel shows the resolved plan, current subscription state, and recent Stripe activity."
        eyebrow="Billing"
        title="Plan and billing"
      />

      {error ? <Alert>{error}</Alert> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}

      {isLoading && !summary ? (
        <p className={statusCopyClassName}>Checking your billing status.</p>
      ) : summary ? (
        <>
          <div className={summaryGridClassName}>
            <StatCard
              detail={describeAccessSource(summary.accessSource)}
              label="Current plan"
              value={humanizePlanId(summary.planId)}
            />
            <StatCard
              detail={describeSubscription(summary)}
              label="Subscription"
              value={humanizeSubscriptionStatus(summary.subscriptionStatus)}
            />
            <StatCard
              detail={describeLifetimeAccess(summary)}
              label="Lifetime access"
              value={summary.hasLifetimeAccess ? "Owned" : "Not owned"}
            />
            <StatCard
              detail={
                summary.hasBillingCustomer
                  ? "Portal access is ready for payment updates and cancellation."
                  : "No Stripe customer exists yet for this account."
              }
              label="Customer record"
              value={summary.hasBillingCustomer ? "Available" : "Not created"}
            />
          </div>

          <div className="mt-6 grid gap-4">
            <SectionHeading
              description="Immutable Stripe-backed payment activity recorded for this account."
              eyebrow="History"
              title="Recent billing activity"
            />
            {paymentsError ? <Alert>{paymentsError}</Alert> : null}
            {isLoadingPayments ? (
              <p className={statusCopyClassName}>
                Loading recent billing activity.
              </p>
            ) : payments.length ? (
              <div className={paymentListClassName}>
                {payments.map((payment) => (
                  <article
                    className={paymentItemClassName}
                    key={`${payment.providerObjectType}:${payment.providerObjectId}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <p className="text-ink text-sm font-semibold">
                          {humanizePaymentKind(payment.paymentKind)}
                        </p>
                        <p className={statusCopyClassName}>
                          {formatTimestamp(payment.occurredAt)}
                        </p>
                      </div>
                      <p className="text-ink text-sm font-semibold">
                        {formatPaymentAmount(payment)}
                      </p>
                    </div>
                    <p className={statusCopyClassName}>
                      Status: {humanizeStatus(payment.status)}
                      {payment.grantedPlanId
                        ? ` • Granted ${humanizePlanId(payment.grantedPlanId)}`
                        : ""}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className={statusCopyClassName}>
                No Stripe payment activity has been recorded yet.
              </p>
            )}
          </div>
        </>
      ) : (
        <p className={statusCopyClassName}>
          Billing information is not available yet.
        </p>
      )}
    </Panel>
  );
}

export function PremiumFeatureGatePanel({
  billingSummary,
  error,
  featureName,
  isLoading,
  message,
}: PremiumFeatureGatePanelProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const portalMutation = useMutation({
    mutationFn: () => createBillingPortalUrlMutation(billingReturnPath),
  });

  async function handlePortal(): Promise<void> {
    setActionError(null);

    try {
      window.location.assign(await portalMutation.mutateAsync());
    } catch (portalError) {
      setActionError(formatClientError(portalError));
    }
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <>
            <Link className={storeLinkClassName} href="/store">
              View plans
            </Link>
            {billingSummary?.hasBillingCustomer ? (
              <Button
                loading={portalMutation.isPending}
                onClick={() => void handlePortal()}
                variant="secondary"
              >
                Manage billing
              </Button>
            ) : null}
          </>
        }
        description={message}
        eyebrow="Premium feature"
        title={`${featureName} requires Premium`}
      />

      {error ? <Alert>{error}</Alert> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}
      <p className={statusCopyClassName}>
        {isLoading
          ? "Checking your current plan access."
          : "Browse the available billing options in the store to unlock this feature."}
      </p>
    </Panel>
  );
}

function describeAccessSource(
  accessSource: BillingSummary["accessSource"],
): string {
  switch (accessSource) {
    case "environment":
      return "Premium access is currently granted by the sandbox or dev environment.";
    case "lifetime":
      return "Premium access is permanently granted by a completed lifetime purchase.";
    case "override":
      return "Access is currently granted by a manual override.";
    case "subscription":
      return "Access comes from your Stripe subscription.";
    default:
      return "You are on the default free plan.";
  }
}

function describeSubscription(summary: BillingSummary): string {
  if (!summary.currentPeriodEndAt) {
    return "No billing period is active.";
  }

  const formattedDate = formatTimestamp(summary.currentPeriodEndAt);
  if (summary.cancelAtPeriodEnd) {
    return `Access stays active until ${formattedDate}.`;
  }

  return `Current billing period ends ${formattedDate}.`;
}

function describeLifetimeAccess(summary: BillingSummary): string {
  if (!summary.hasLifetimeAccess) {
    return summary.lifetimePurchaseOfferEnabled
      ? "Lifetime access is available in the store."
      : "No lifetime offer is currently available.";
  }

  if (!summary.lifetimeGrantedAt) {
    return "Lifetime premium access has been granted.";
  }

  return `Granted on ${formatTimestamp(summary.lifetimeGrantedAt)}.`;
}

function humanizePlanId(planId: BillingSummary["planId"] | string): string {
  return planId === "premium" ? "Premium" : "Free";
}

function shouldOfferSubscription(summary: BillingSummary | null): boolean {
  if (!summary?.premiumSubscriptionOfferEnabled) {
    return false;
  }

  if (summary.hasLifetimeAccess) {
    return false;
  }

  return summary.planId !== "premium" || summary.accessSource === "environment";
}

function shouldOfferLifetime(summary: BillingSummary | null): boolean {
  return Boolean(
    summary?.lifetimePurchaseOfferEnabled && !summary.hasLifetimeAccess,
  );
}

function humanizePaymentKind(paymentKind: string): string {
  switch (paymentKind) {
    case "lifetime_checkout":
      return "Lifetime access purchase";
    case "subscription_invoice":
      return "Premium subscription invoice";
    default:
      return paymentKind;
  }
}

function formatPaymentAmount(payment: BillingPaymentEntry): string {
  if (typeof payment.amountTotal !== "number") {
    return "Amount unavailable";
  }

  const currency = payment.currency?.toUpperCase() ?? "USD";
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(payment.amountTotal / 100);
}

function humanizeStatus(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  return value
    .split(/[_\s]+/)
    .map((segment) =>
      segment ? `${segment[0]!.toUpperCase()}${segment.slice(1)}` : segment,
    )
    .join(" ");
}

function humanizeSubscriptionStatus(status: string | null | undefined): string {
  if (!status) {
    return "No subscription";
  }

  return humanizeStatus(status);
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function readQueryError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.trim();
  return message.length ? message : null;
}

function formatClientError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "The billing action failed without a detailed error message.";
}
