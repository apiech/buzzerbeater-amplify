"use client";

import Link from "next/link";

import {
  captureAnalyticsEvent,
  markPendingAuthFlow,
} from "@/lib/analytics/client";

type LoginActionsProps = {
  authLinkClassName: string;
  commercialModeEnabled: boolean;
  preferredFlow: "sign_in" | "sign_up";
  secondaryLinkClassName: string;
};

export function LoginActions({
  authLinkClassName,
  commercialModeEnabled,
  preferredFlow,
  secondaryLinkClassName,
}: LoginActionsProps) {
  function handleAuthFlowStart(flow: "sign_in" | "sign_up") {
    markPendingAuthFlow(flow);
    captureAnalyticsEvent("auth_flow_started", {
      flow,
      source: "login_page",
    });
  }

  const authActions =
    preferredFlow === "sign_up"
      ? [
          {
            className: authLinkClassName,
            flow: "sign_up" as const,
            href: "/api/auth/sign-up",
            label: "Create account",
          },
          {
            className: secondaryLinkClassName,
            flow: "sign_in" as const,
            href: "/api/auth/sign-in",
            label: "Continue to secure sign in",
          },
        ]
      : [
          {
            className: authLinkClassName,
            flow: "sign_in" as const,
            href: "/api/auth/sign-in",
            label: "Continue to secure sign in",
          },
          {
            className: secondaryLinkClassName,
            flow: "sign_up" as const,
            href: "/api/auth/sign-up",
            label: "Create account",
          },
        ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        {authActions.map((action) => (
          <a
            key={action.flow}
            className={action.className}
            href={action.href}
            onClick={() => handleAuthFlowStart(action.flow)}
          >
            {action.label}
          </a>
        ))}
        {commercialModeEnabled ? (
          <Link
            className={secondaryLinkClassName}
            href="/store"
            onClick={() =>
              captureAnalyticsEvent("store_browse_requested", {
                source: "login_page",
              })
            }
          >
            Browse store
          </Link>
        ) : null}
      </div>
      <p className="text-ink-muted m-0 text-xs leading-6">
        You&apos;ll stay in this browser, finish secure account access on the
        account domain, and return here with your session ready.
      </p>
    </div>
  );
}
