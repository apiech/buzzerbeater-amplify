"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import {
  createBillingCheckoutUrl,
  createBillingLifetimeCheckoutUrl,
  createBillingPortalUrl,
  fetchBillingSummary,
} from "@/app/billing-client";
import type { BillingSummary } from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";

type StorefrontProps = {
  billingNotice: string | null;
  isSignedIn: boolean;
  viewerLabel: string | null;
};

const cardGridClassName = "grid gap-4 lg:grid-cols-2";
const storeLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";
const bodyCopyClassName = "text-sm leading-7 text-ink-muted";

export function Storefront({
  billingNotice,
  isSignedIn,
  viewerLabel,
}: StorefrontProps) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(isSignedIn);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStartingSubscription, setIsStartingSubscription] = useState(false);
  const [isStartingLifetime, setIsStartingLifetime] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isSignedIn) {
      setSummary(null);
      setSummaryError(null);
      setIsLoadingSummary(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoadingSummary(true);
    setSummaryError(null);

    void fetchBillingSummary()
      .then((nextSummary) => {
        if (!cancelled) {
          setSummary(nextSummary);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSummaryError(formatClientError(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSummary(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  async function handleSubscriptionCheckout(): Promise<void> {
    setActionError(null);
    setIsStartingSubscription(true);

    try {
      window.location.assign(await createBillingCheckoutUrl("/store"));
    } catch (error) {
      setActionError(formatClientError(error));
      setIsStartingSubscription(false);
    }
  }

  async function handleLifetimeCheckout(): Promise<void> {
    setActionError(null);
    setIsStartingLifetime(true);

    try {
      window.location.assign(await createBillingLifetimeCheckoutUrl("/store"));
    } catch (error) {
      setActionError(formatClientError(error));
      setIsStartingLifetime(false);
    }
  }

  async function handlePortal(): Promise<void> {
    setActionError(null);
    setIsOpeningPortal(true);

    try {
      window.location.assign(await createBillingPortalUrl("/store"));
    } catch (error) {
      setActionError(formatClientError(error));
      setIsOpeningPortal(false);
    }
  }

  const subscriptionEnabled = summary?.premiumSubscriptionOfferEnabled ?? true;
  const lifetimeEnabled = summary?.lifetimePurchaseOfferEnabled ?? false;
  const hasLifetimeAccess = Boolean(summary?.hasLifetimeAccess);
  const shouldOfferSubscription = Boolean(
    isSignedIn &&
    summary?.premiumSubscriptionOfferEnabled &&
    !summary.hasLifetimeAccess &&
    (summary.planId !== "premium" || summary.accessSource === "environment"),
  );
  const shouldOfferLifetime = Boolean(
    isSignedIn &&
    summary?.lifetimePurchaseOfferEnabled &&
    !summary.hasLifetimeAccess,
  );
  const showNoOffers = !subscriptionEnabled && !lifetimeEnabled;

  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <Panel as="section" className="grid gap-6">
        <div className="grid gap-4">
          <p className="text-accent text-[0.76rem] font-bold tracking-[0.18em] uppercase">
            Store
          </p>
          <SectionHeading
            description="Premium access is feature-based: subscriptions and lifetime purchases unlock the same gated capabilities, while the free workspace stays readable."
            eyebrow="Commerce"
            title="Support the project and unlock premium tools"
          />
          <p className={bodyCopyClassName}>
            Monthly Premium unlocks recurring access. Lifetime Access is a
            one-time Stripe Checkout flow where the amount is configured in
            Stripe and permanent premium access is granted after payment.
          </p>
          {viewerLabel ? (
            <p className={bodyCopyClassName}>
              Signed in as{" "}
              <span className="text-ink font-semibold">{viewerLabel}</span>.
            </p>
          ) : (
            <p className={bodyCopyClassName}>
              Browse the offers here, then sign in before starting Checkout.
            </p>
          )}
        </div>

        {billingNotice === "success" ? (
          <Alert>
            Stripe returned to the store after a successful billing action. Your
            account access will reflect the webhook sync shortly.
          </Alert>
        ) : null}
        {billingNotice === "cancelled" ? (
          <Alert>Your Stripe Checkout session was cancelled.</Alert>
        ) : null}
        {summaryError ? <Alert>{summaryError}</Alert> : null}
        {actionError ? <Alert>{actionError}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          {isSignedIn ? (
            <>
              <Link className={storeLinkClassName} href="/workspace/ops">
                Open billing panel
              </Link>
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
          ) : (
            <>
              <Link className={storeLinkClassName} href="/login">
                Sign in to buy
              </Link>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- auth routes must hard-navigate to Cognito */}
              <a className={storeLinkClassName} href="/api/auth/sign-up">
                Create account
              </a>
            </>
          )}
        </div>
      </Panel>

      {isSignedIn ? (
        <Panel as="section" className="grid gap-3">
          <SectionHeading
            description="Resolved from overrides, lifetime entitlements, Stripe subscription state, and the current environment default."
            eyebrow="Status"
            title="Current access"
          />
          {isLoadingSummary ? (
            <p className={bodyCopyClassName}>
              Checking your current billing access.
            </p>
          ) : summary ? (
            <p className={bodyCopyClassName}>
              Current plan:{" "}
              <span className="text-ink font-semibold">
                {summary.planId === "premium" ? "Premium" : "Free"}
              </span>
              {" • "}Access source:{" "}
              <span className="text-ink font-semibold">
                {describeAccessSource(summary.accessSource)}
              </span>
              {summary.hasLifetimeAccess && summary.lifetimeGrantedAt
                ? ` • Lifetime granted ${formatTimestamp(summary.lifetimeGrantedAt)}`
                : ""}
            </p>
          ) : (
            <p className={bodyCopyClassName}>
              Billing status is unavailable right now.
            </p>
          )}
        </Panel>
      ) : null}

      {showNoOffers ? (
        <Panel as="section">
          <SectionHeading
            description="The backend has both store offers disabled in this environment."
            eyebrow="Unavailable"
            title="Offers are unavailable right now"
          />
        </Panel>
      ) : (
        <section className={cardGridClassName}>
          <OfferCard
            actions={
              isSignedIn ? (
                shouldOfferSubscription ? (
                  <Button
                    loading={isStartingSubscription}
                    onClick={() => void handleSubscriptionCheckout()}
                  >
                    Start monthly Premium
                  </Button>
                ) : summary?.hasLifetimeAccess ? (
                  <p className={bodyCopyClassName}>
                    Lifetime access already covers premium features.
                  </p>
                ) : summary?.planId === "premium" &&
                  summary.accessSource !== "environment" ? (
                  <p className={bodyCopyClassName}>
                    Monthly Premium is already active on this account.
                  </p>
                ) : subscriptionEnabled ? (
                  <p className={bodyCopyClassName}>
                    Monthly Premium is available once your billing status loads.
                  </p>
                ) : (
                  <p className={bodyCopyClassName}>
                    Monthly Premium is disabled in this environment.
                  </p>
                )
              ) : (
                <Link className={storeLinkClassName} href="/login">
                  Sign in for monthly Premium
                </Link>
              )
            }
            description="Recurring Stripe subscription for premium feature gating. Good default if you want recurring support and reversible billing."
            eyebrow="Subscription"
            title="Monthly Premium"
          >
            <p className={bodyCopyClassName}>
              {subscriptionEnabled
                ? "Unlock predictions, league writeups, and future premium-only tools with a Stripe-hosted monthly subscription."
                : "This environment has the monthly offer turned off right now."}
            </p>
          </OfferCard>

          <OfferCard
            actions={
              isSignedIn ? (
                shouldOfferLifetime ? (
                  <Button
                    loading={isStartingLifetime}
                    onClick={() => void handleLifetimeCheckout()}
                    variant="secondary"
                  >
                    Buy lifetime access
                  </Button>
                ) : hasLifetimeAccess ? (
                  <p className={bodyCopyClassName}>
                    Lifetime access is already owned on this account.
                  </p>
                ) : lifetimeEnabled ? (
                  <p className={bodyCopyClassName}>
                    Lifetime access will appear here once your billing status
                    finishes loading.
                  </p>
                ) : (
                  <p className={bodyCopyClassName}>
                    Lifetime access is not enabled in this environment yet.
                  </p>
                )
              ) : (
                <Link className={storeLinkClassName} href="/login">
                  Sign in for lifetime access
                </Link>
              )
            }
            description="One Stripe Checkout payment that permanently grants premium access. The amount is configured on the Stripe side."
            eyebrow="One-time"
            title="Lifetime Access"
          >
            <p className={bodyCopyClassName}>
              {lifetimeEnabled || !isSignedIn
                ? "Use Stripe Checkout to make a one-time purchase and permanently unlock the premium plan on this account."
                : "This offer is disabled until the lifetime Stripe price is configured and enabled."}
            </p>
          </OfferCard>
        </section>
      )}
    </main>
  );
}

function OfferCard({
  actions,
  children,
  description,
  eyebrow,
  title,
}: {
  actions: ReactNode;
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <Panel as="section" className="grid gap-4">
      <SectionHeading
        actions={actions}
        description={description}
        eyebrow={eyebrow}
        title={title}
      />
      {children}
    </Panel>
  );
}

function describeAccessSource(
  accessSource: BillingSummary["accessSource"],
): string {
  switch (accessSource) {
    case "environment":
      return "sandbox/dev default";
    case "lifetime":
      return "lifetime purchase";
    case "override":
      return "manual override";
    case "subscription":
      return "subscription";
    default:
      return "free default";
  }
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatClientError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "The billing action failed without a detailed error message.";
}
