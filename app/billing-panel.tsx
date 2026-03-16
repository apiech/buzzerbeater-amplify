"use client";

import { useState } from "react";

import {
  createBillingCheckoutUrl,
  createBillingPortalUrl,
} from "@/app/billing-client";
import type { BillingSummary } from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";

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

const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";

export function BillingPanel({
  error,
  isLoading,
  summary,
}: BillingPanelProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  async function handleCheckout(): Promise<void> {
    setActionError(null);
    setIsStartingCheckout(true);

    try {
      window.location.assign(await createBillingCheckoutUrl());
    } catch (checkoutError) {
      setActionError(formatClientError(checkoutError));
      setIsStartingCheckout(false);
    }
  }

  async function handlePortal(): Promise<void> {
    setActionError(null);
    setIsOpeningPortal(true);

    try {
      window.location.assign(await createBillingPortalUrl());
    } catch (portalError) {
      setActionError(formatClientError(portalError));
      setIsOpeningPortal(false);
    }
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <>
            {summary?.planId !== "premium" ? (
              <Button
                loading={isStartingCheckout}
                onClick={() => void handleCheckout()}
              >
                Upgrade to Premium
              </Button>
            ) : null}
            {summary?.hasBillingCustomer ? (
              <Button
                loading={isOpeningPortal}
                onClick={() => void handlePortal()}
                variant="secondary"
              >
                Manage billing
              </Button>
            ) : null}
          </>
        }
        description="Subscriptions control premium access. Core free features stay available without a paid plan."
        eyebrow="Billing"
        title="Plan and billing"
      />

      {error ? <Alert>{error}</Alert> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}

      {isLoading && !summary ? (
        <p className={statusCopyClassName}>Checking your billing status.</p>
      ) : summary ? (
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
            detail={
              summary.hasBillingCustomer
                ? "Portal access is ready for payment updates and cancellation."
                : "No Stripe customer exists yet for this account."
            }
            label="Customer record"
            value={summary.hasBillingCustomer ? "Available" : "Not created"}
          />
          <StatCard
            detail={
              summary.planId === "premium"
                ? "Premium features are unlocked."
                : "Upgrade when you want predictions and league writeups."
            }
            label="Premium access"
            value={summary.planId === "premium" ? "Enabled" : "Disabled"}
          />
        </div>
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
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  async function handleCheckout(): Promise<void> {
    setActionError(null);
    setIsStartingCheckout(true);

    try {
      window.location.assign(await createBillingCheckoutUrl());
    } catch (checkoutError) {
      setActionError(formatClientError(checkoutError));
      setIsStartingCheckout(false);
    }
  }

  async function handlePortal(): Promise<void> {
    setActionError(null);
    setIsOpeningPortal(true);

    try {
      window.location.assign(await createBillingPortalUrl());
    } catch (portalError) {
      setActionError(formatClientError(portalError));
      setIsOpeningPortal(false);
    }
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <>
            <Button
              loading={isStartingCheckout}
              onClick={() => void handleCheckout()}
            >
              Upgrade to Premium
            </Button>
            {billingSummary?.hasBillingCustomer ? (
              <Button
                loading={isOpeningPortal}
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
          : "Upgrade to unlock this feature on your account."}
      </p>
    </Panel>
  );
}

function describeAccessSource(accessSource: BillingSummary["accessSource"]): string {
  switch (accessSource) {
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

function humanizePlanId(planId: BillingSummary["planId"]): string {
  return planId === "premium" ? "Premium" : "Free";
}

function humanizeSubscriptionStatus(status: string | null | undefined): string {
  if (!status) {
    return "No subscription";
  }

  return status
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
