"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  captureAnalyticsEvent,
  capturePageView,
  consumePendingAuthFlow,
  identifyAnalyticsUser,
  initializeAnalytics,
  registerAnalyticsProperties,
  syncPublicSessionRecording,
} from "@/lib/analytics/client";
import { resolveAnalyticsRouteContext } from "@/lib/analytics/config";

export type AnalyticsProviderProps = {
  children: React.ReactNode;
  environmentName: string;
  isAuthenticated: boolean;
  userId: string | null;
};

export function AnalyticsProvider({
  children,
  environmentName,
  isAuthenticated,
  userId,
}: AnalyticsProviderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedPageKeyRef = useRef<string | null>(null);
  const search = searchParams.toString();
  const pageKey = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    initializeAnalytics({ environmentName });
  }, [environmentName]);

  useEffect(() => {
    registerAnalyticsProperties({
      is_authenticated: isAuthenticated,
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      return;
    }

    identifyAnalyticsUser({
      environmentName,
      properties: {
        analytics_environment: environmentName,
      },
      userId,
    });

    const pendingAuthFlow = consumePendingAuthFlow();
    if (!pendingAuthFlow) {
      return;
    }

    captureAnalyticsEvent("auth_flow_completed", {
      environment_name: environmentName,
      flow: pendingAuthFlow,
    });
  }, [environmentName, isAuthenticated, userId]);

  useEffect(() => {
    syncPublicSessionRecording({
      isAuthenticated,
      pathname,
    });
  }, [isAuthenticated, pathname]);

  useEffect(() => {
    if (lastTrackedPageKeyRef.current === pageKey) {
      return;
    }

    lastTrackedPageKeyRef.current = pageKey;
    const routeContext = resolveAnalyticsRouteContext(pathname);

    capturePageView({
      environmentName,
      isAuthenticated,
      routeContext,
      search,
    });

    if (
      routeContext.pageCategory === "workspace" &&
      routeContext.workspaceSection
    ) {
      captureAnalyticsEvent("workspace_section_viewed", {
        environment_name: environmentName,
        page_name: routeContext.pageName,
        workspace_section: routeContext.workspaceSection,
      });
    }
  }, [environmentName, isAuthenticated, pageKey, pathname, search]);

  return children;
}
