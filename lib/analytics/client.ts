"use client";

import posthog from "posthog-js";

import { posthogPublicConfig } from "@/config/posthog";
import {
  shouldEnablePublicSessionRecording,
  type AnalyticsRouteContext,
} from "@/lib/analytics/config";
import type {
  AnalyticsEventName,
  AnalyticsEventProperties,
  AnalyticsPersonProperties,
  AnalyticsRegisteredProperties,
} from "@/lib/analytics/events";

type PendingAuthFlow = "sign_in" | "sign_up";

const pendingAuthFlowStorageKey = "bb.analytics.pending-auth-flow";
const billingAccessStorageKey = "bb.analytics.billing-access";

let analyticsInitialized = false;
let initializedToken: string | null = null;
let sessionRecordingEnabled = false;

export type BillingAccessTrackingInput = {
  accessSource: string | null | undefined;
  planId: string | null | undefined;
  source: "account_panel" | "store";
};

export function initializeAnalytics(input: {
  environmentName: string;
}): boolean {
  const config = posthogPublicConfig;
  if (!config.enabled || !config.token) {
    return false;
  }

  if (!analyticsInitialized || initializedToken !== config.token) {
    posthog.init(config.token, {
      api_host: config.host,
      autocapture: false,
      capture_pageleave: false,
      capture_pageview: false,
      defaults: "2026-01-30",
      disable_session_recording: true,
      mask_all_element_attributes: true,
      mask_all_text: true,
      person_profiles: "identified_only",
      session_recording: {
        blockSelector: '[data-analytics-sensitive="true"]',
        maskAllInputs: true,
        maskTextSelector: '[data-analytics-mask="true"]',
      },
    });
    analyticsInitialized = true;
    initializedToken = config.token;
  }

  registerAnalyticsProperties({
    analytics_environment: input.environmentName,
    analytics_token_source: config.tokenSource ?? "unset",
    analytics_vendor: "posthog",
  });

  return true;
}

export function identifyAnalyticsUser(input: {
  environmentName: string;
  properties?: AnalyticsPersonProperties;
  userId: string;
}): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  posthog.identify(input.userId, {
    analytics_environment: input.environmentName,
    ...input.properties,
  });
}

export function setAnalyticsPersonProperties(
  properties: AnalyticsPersonProperties,
): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  posthog.setPersonProperties(properties);
}

export function registerAnalyticsProperties(
  properties: AnalyticsRegisteredProperties,
): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  posthog.register(properties);
}

export function resetAnalytics(): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  posthog.reset();
  sessionRecordingEnabled = false;
}

export function captureAnalyticsEvent<TName extends AnalyticsEventName>(
  eventName: TName,
  properties: AnalyticsEventProperties<TName>,
): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  posthog.capture(eventName, properties);
}

export function capturePageView(input: {
  environmentName: string;
  isAuthenticated: boolean;
  routeContext: AnalyticsRouteContext;
  search: string;
}): void {
  captureAnalyticsEvent("$pageview", {
    environment_name: input.environmentName,
    is_authenticated: input.isAuthenticated,
    page_category: input.routeContext.pageCategory,
    page_name: input.routeContext.pageName,
    search_present: Boolean(input.search),
    workspace_section: input.routeContext.workspaceSection,
  });
}

export function markPendingAuthFlow(flow: PendingAuthFlow): void {
  readSessionStorage()?.setItem(pendingAuthFlowStorageKey, flow);
}

export function consumePendingAuthFlow(): PendingAuthFlow | null {
  const storage = readSessionStorage();
  const pendingFlow = storage?.getItem(pendingAuthFlowStorageKey);
  if (!pendingFlow) {
    return null;
  }

  storage?.removeItem(pendingAuthFlowStorageKey);
  return pendingFlow === "sign_up" ? "sign_up" : "sign_in";
}

export function syncPublicSessionRecording(input: {
  isAuthenticated: boolean;
  pathname: string;
}): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  const shouldRecord = shouldEnablePublicSessionRecording(input);
  if (shouldRecord === sessionRecordingEnabled) {
    return;
  }

  if (shouldRecord) {
    posthog.startSessionRecording(true);
  } else {
    posthog.stopSessionRecording();
  }

  sessionRecordingEnabled = shouldRecord;
}

export function trackBillingAccessTransition(
  input: BillingAccessTrackingInput,
): void {
  const storage = readSessionStorage();
  if (!storage) {
    return;
  }

  const normalizedPlanId = normalizeDescriptorPart(input.planId) ?? "unknown";
  const normalizedAccessSource =
    normalizeDescriptorPart(input.accessSource) ?? "unknown";
  const nextDescriptor = `${normalizedPlanId}:${normalizedAccessSource}`;
  const previousDescriptor = storage.getItem(billingAccessStorageKey);

  if (previousDescriptor === nextDescriptor) {
    return;
  }

  storage.setItem(billingAccessStorageKey, nextDescriptor);
  captureAnalyticsEvent("billing_access_changed", {
    access_source: normalizedAccessSource,
    plan_id: normalizedPlanId,
    source: input.source,
  });

  if (
    previousDescriptor &&
    !previousDescriptor.startsWith("premium:") &&
    normalizedPlanId === "premium"
  ) {
    captureAnalyticsEvent("premium_access_unlocked", {
      access_source: normalizedAccessSource,
      plan_id: normalizedPlanId,
      source: input.source,
    });
  }
}

function isAnalyticsEnabled(): boolean {
  const config = posthogPublicConfig;
  return Boolean(config.enabled && config.token);
}

function readSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function normalizeDescriptorPart(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}
