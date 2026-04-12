"use client";

import Link from "next/link";

import {
  captureAnalyticsEvent,
  markPendingAuthFlow,
} from "@/lib/analytics/client";

type LoginActionsProps = {
  authLinkClassName: string;
  commercialModeEnabled: boolean;
  secondaryLinkClassName: string;
};

export function LoginActions({
  authLinkClassName,
  commercialModeEnabled,
  secondaryLinkClassName,
}: LoginActionsProps) {
  function handleAuthFlowStart(flow: "sign_in" | "sign_up") {
    markPendingAuthFlow(flow);
    captureAnalyticsEvent("auth_flow_started", {
      flow,
      source: "login_page",
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- auth routes must hard-navigate to Cognito */}
      <a
        className={authLinkClassName}
        href="/api/auth/sign-in"
        onClick={() => handleAuthFlowStart("sign_in")}
      >
        Sign in
      </a>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- auth routes must hard-navigate to Cognito */}
      <a
        className={secondaryLinkClassName}
        href="/api/auth/sign-up"
        onClick={() => handleAuthFlowStart("sign_up")}
      >
        Create account
      </a>
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
  );
}
