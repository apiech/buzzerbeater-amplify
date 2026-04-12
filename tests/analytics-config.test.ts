import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAnalyticsPublicConfig,
  resolveAnalyticsRouteContext,
  shouldEnablePublicSessionRecording,
} from "../lib/analytics/config";

test("resolveAnalyticsPublicConfig prefers PostHog-specific public env names", () => {
  const config = resolveAnalyticsPublicConfig({
    NEXT_PUBLIC_ANALYTICS_ID: "legacy-token",
    NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
    NEXT_PUBLIC_POSTHOG_TOKEN: "posthog-token",
  });

  assert.deepEqual(config, {
    enabled: true,
    host: "https://eu.i.posthog.com",
    token: "posthog-token",
    tokenSource: "posthog_token",
  });
});

test("resolveAnalyticsPublicConfig falls back to legacy analytics id", () => {
  const config = resolveAnalyticsPublicConfig({
    NEXT_PUBLIC_ANALYTICS_ID: "legacy-token",
  });

  assert.deepEqual(config, {
    enabled: true,
    host: "https://us.i.posthog.com",
    token: "legacy-token",
    tokenSource: "legacy_analytics_id",
  });
});

test("resolveAnalyticsRouteContext classifies workspace and public routes", () => {
  assert.deepEqual(resolveAnalyticsRouteContext("/login"), {
    pageCategory: "auth",
    pageName: "login",
    workspaceSection: null,
  });
  assert.deepEqual(resolveAnalyticsRouteContext("/store"), {
    pageCategory: "commerce",
    pageName: "store",
    workspaceSection: null,
  });
  assert.deepEqual(resolveAnalyticsRouteContext("/workspace/predictions"), {
    pageCategory: "workspace",
    pageName: "workspace-predictions",
    workspaceSection: "predictions",
  });
  assert.deepEqual(resolveAnalyticsRouteContext("/workspace/boxscores/123"), {
    pageCategory: "workspace",
    pageName: "workspace-boxscore",
    workspaceSection: "scout",
  });
});

test("shouldEnablePublicSessionRecording stays limited to unauthenticated public routes", () => {
  assert.equal(
    shouldEnablePublicSessionRecording({
      isAuthenticated: false,
      pathname: "/login",
    }),
    true,
  );
  assert.equal(
    shouldEnablePublicSessionRecording({
      isAuthenticated: false,
      pathname: "/store",
    }),
    true,
  );
  assert.equal(
    shouldEnablePublicSessionRecording({
      isAuthenticated: true,
      pathname: "/store",
    }),
    false,
  );
  assert.equal(
    shouldEnablePublicSessionRecording({
      isAuthenticated: false,
      pathname: "/workspace/home",
    }),
    false,
  );
});
