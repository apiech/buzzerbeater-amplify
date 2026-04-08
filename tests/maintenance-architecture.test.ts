import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("cost guardrails include Bedrock auto-trip wiring and subscribe the alarm-trip lambda", () => {
  const guardrailSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "cost-guardrails.ts"),
    "utf8",
  );
  const visibilitySource = readFileSync(
    join(repoRoot, "amplify", "_backend", "cost-visibility.ts"),
    "utf8",
  );

  assert.match(guardrailSource, /id: "bedrock"/);
  assert.match(guardrailSource, /autoTripMaintenance: true/);
  assert.match(visibilitySource, /LambdaSubscription/);
  assert.match(visibilitySource, /maintenanceAlarmTrip/);
});

test("maintenance control plane wiring sets Function URL output and SSM permissions", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "maintenance-control-plane.ts"),
    "utf8",
  );

  assert.match(source, /MAINTENANCE_ENVIRONMENT_NAME/);
  assert.match(source, /FunctionUrlAuthType\.NONE/);
  assert.match(source, /ssm:GetParameter/);
  assert.match(source, /ssm:PutParameter/);
  assert.match(source, /ssm:DeleteParameter/);
  assert.match(source, /MaintenanceAdminUrl/);
});

test("hosted compute role wiring provisions an Amplify compute principal with maintenance SSM read access", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "hosted-compute-role.ts"),
    "utf8",
  );

  assert.match(source, /amplify\.amazonaws\.com/);
  assert.match(source, /ssm:GetParameter/);
  assert.match(source, /HostedSsrComputeRoleArn/);
  assert.match(source, /AwsCustomResource/);
  assert.match(source, /amplify:UpdateBranch/);
  assert.match(source, /iam:PassRole/);
});
