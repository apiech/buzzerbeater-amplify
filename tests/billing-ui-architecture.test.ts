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
  assert.match(source, /<BillingPanel/);
  assert.match(source, /<PremiumFeatureGatePanel/);
});

test("billing panel keeps checkout available for environment-based premium access", () => {
  const source = readFileSync(join(repoRoot, "app", "billing-panel.tsx"), "utf8");

  assert.match(source, /summary\.planId !== "premium" \|\| summary\.accessSource === "environment"/);
  assert.match(source, /sandbox or dev environment/);
});

test("billing integration wires the environment default into premium-gated lambdas", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "billing-integration.ts"),
    "utf8",
  );

  assert.match(source, /getBillingSummary\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /predictionSubmit\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /gameDayRecapSubmit\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
  assert.match(source, /submitMyTeamHighlightsScan\.addEnvironment\(\s*"BILLING_DEFAULT_PLAN"/);
});
