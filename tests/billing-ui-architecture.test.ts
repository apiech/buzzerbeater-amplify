import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("dashboard app gates premium sections through the shared feature registry", () => {
  const source = readFileSync(join(repoRoot, "app", "dashboard-app.tsx"), "utf8");

  assert.match(source, /hasFeature\(billingPlanId, "predictions"\)/);
  assert.match(source, /hasFeature\(billingPlanId, "leagueWriteups"\)/);
  assert.match(source, /hasFeature\(billingPlanId, "teamHighlights"\)/);
  assert.match(source, /const commercialModeDisabled =/);
  assert.match(source, /const canUsePredictions = commercialModeDisabled/);
  assert.match(source, /const canUseLeagueWriteups = commercialModeDisabled/);
  assert.match(source, /const canUseTeamHighlights = commercialModeDisabled/);
  assert.match(source, /<BillingPanel/);
  assert.match(source, /<PremiumFeatureGatePanel/);
});

test("billing panel keeps checkout available for environment-based premium access and exposes store links", () => {
  const source = readFileSync(join(repoRoot, "app", "billing-panel.tsx"), "utf8");

  assert.match(source, /summary\.planId !== "premium" \|\| summary\.accessSource === "environment"/);
  assert.match(source, /sandbox or dev environment/);
  assert.match(source, /href="\/store"/);
  assert.match(source, /createBillingLifetimeCheckoutUrlMutation/);
  assert.match(source, /billingPaymentsQueryOptions/);
});

test("store route is public and drives billing through the new store-facing APIs", () => {
  const pageSource = readFileSync(
    join(repoRoot, "app", "store", "page.tsx"),
    "utf8",
  );
  const storefrontSource = readFileSync(
    join(repoRoot, "app", "store", "storefront.tsx"),
    "utf8",
  );

  assert.match(pageSource, /getServerCurrentUser/);
  assert.match(
    pageSource,
    /import\s+\{\s*commercialModeEnabled\s*\}\s+from\s+"@\/config\/commercial-mode"/,
  );
  assert.match(pageSource, /notFound\(\)/);
  assert.match(storefrontSource, /createBillingCheckoutUrlMutation\(returnPath\)/);
  assert.match(storefrontSource, /createBillingLifetimeCheckoutUrlMutation\(returnPath\)/);
  assert.match(storefrontSource, /createBillingPortalUrlMutation\(returnPath\)/);
  assert.match(storefrontSource, /billingSummaryQueryOptions\(\)/);
  assert.match(storefrontSource, /href="\/api\/auth\/sign-in"/);
  assert.match(storefrontSource, /href="\/api\/auth\/sign-up"/);
  assert.match(storefrontSource, /href="\/workspace\/ops"/);
});

test("billing integration wires commercial mode and environment defaults into premium-gated lambdas", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "billing-integration.ts"),
    "utf8",
  );

  assert.match(source, /getBillingSummary\.addEnvironment\(\s*"COMMERCIAL_MODE_ENABLED"/);
  assert.match(source, /nextGameRecommendationSubmit\.addEnvironment\(\s*"COMMERCIAL_MODE_ENABLED"/);
  assert.match(source, /opponentForecastSubmit\.addEnvironment\(\s*"COMMERCIAL_MODE_ENABLED"/);
  assert.match(source, /predictionSubmit\.addEnvironment\(\s*"COMMERCIAL_MODE_ENABLED"/);
  assert.match(source, /gameDayRecapSubmit\.addEnvironment\(\s*"COMMERCIAL_MODE_ENABLED"/);
  assert.match(source, /submitMyTeamHighlightsScan\.addEnvironment\(\s*"COMMERCIAL_MODE_ENABLED"/);
  assert.match(source, /clearMyTeamHighlightsData\.addEnvironment\(\s*"COMMERCIAL_MODE_ENABLED"/);
  assert.match(source, /getBillingSummary\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /nextGameRecommendationSubmit\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /opponentForecastSubmit\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /predictionSubmit\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /gameDayRecapSubmit\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /submitMyTeamHighlightsScan\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /clearMyTeamHighlightsData\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
});
