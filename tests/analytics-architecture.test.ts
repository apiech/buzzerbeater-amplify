import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

function readRepoFile(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

test("analytics wiring covers providers, auth, store, and key outcome flows", () => {
  const providersSource = readRepoFile("app", "providers.tsx");
  const layoutSource = readRepoFile("app", "layout.tsx");
  const analyticsProviderSource = readRepoFile("app", "analytics-provider.tsx");
  const analyticsClientSource = readRepoFile("lib", "analytics", "client.ts");
  const analyticsEventsSource = readRepoFile("lib", "analytics", "events.ts");
  const loginActionsSource = readRepoFile("app", "login", "login-actions.tsx");
  const storefrontSource = readRepoFile("app", "store", "storefront.tsx");
  const dashboardSource = readRepoFile("app", "dashboard-app.tsx");
  const feedbackSource = readRepoFile("app", "feedback-panel.tsx");
  const highlightsSource = readRepoFile("app", "highlights-panel.tsx");
  const operationsSource = readRepoFile("app", "operations-panel.tsx");
  const predictionSource = readRepoFile("app", "prediction-panel.tsx");
  const gamePredictionSource = readRepoFile("app", "game-prediction-panel.tsx");
  const recapSource = readRepoFile("app", "recap-panel.tsx");
  const themeSource = readRepoFile("app", "ui", "theme", "theme-select.tsx");
  const workspaceNavSource = readRepoFile(
    "app",
    "ui",
    "workspace",
    "workspace-route-nav.tsx",
  );

  assert.match(providersSource, /<AnalyticsProvider\s+\{\.\.\.analytics\}>/);
  assert.match(layoutSource, /maintenanceEnvironmentName/);
  assert.match(layoutSource, /analytics=\{\{/);
  assert.match(analyticsProviderSource, /<Suspense fallback=\{null\}>/);
  assert.match(analyticsProviderSource, /AnalyticsNavigationTracker/);
  assert.match(analyticsClientSource, /setAnalyticsPersonProperties/);
  assert.match(analyticsClientSource, /registerAnalyticsProperties/);
  assert.match(analyticsEventsSource, /workspace_nav_clicked/);
  assert.match(analyticsEventsSource, /highlights_scan_completed/);
  assert.match(loginActionsSource, /markPendingAuthFlow/);
  assert.match(loginActionsSource, /auth_flow_started/);
  assert.match(storefrontSource, /billing_checkout_started/);
  assert.match(storefrontSource, /billing_checkout_returned/);
  assert.match(storefrontSource, /trackBillingAccessTransition/);
  assert.match(dashboardSource, /bb_connection_submitted/);
  assert.match(dashboardSource, /auth_signed_out/);
  assert.match(dashboardSource, /feedback_shortcut_clicked/);
  assert.match(dashboardSource, /setAnalyticsPersonProperties/);
  assert.match(feedbackSource, /product_feedback_submitted/);
  assert.match(feedbackSource, /product_feedback_submission_failed/);
  assert.match(highlightsSource, /highlights_filter_changed/);
  assert.match(highlightsSource, /highlights_scan_completed/);
  assert.match(operationsSource, /operations_refresh_requested/);
  assert.match(predictionSource, /prediction_requested/);
  assert.match(predictionSource, /prediction_completed/);
  assert.match(predictionSource, /prediction_source_loaded/);
  assert.match(gamePredictionSource, /game_prediction_matrix_requested/);
  assert.match(gamePredictionSource, /game_prediction_overview_cell_selected/);
  assert.match(gamePredictionSource, /game_prediction_pair_selected/);
  assert.match(recapSource, /recap_requested/);
  assert.match(recapSource, /recap_forum_post_copied/);
  assert.match(themeSource, /theme_changed/);
  assert.match(workspaceNavSource, /workspace_nav_clicked/);
});
