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
  assert.match(source, /<BillingPanel/);
  assert.match(source, /<PremiumFeatureGatePanel/);
});
