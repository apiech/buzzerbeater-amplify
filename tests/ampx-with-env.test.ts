import assert from "node:assert/strict";
import test from "node:test";

import {
  applySandboxDefaults,
  createWebhookUrlReporter,
  extractBillingWebhookUrl,
  resolveAwsRegion,
  resolveBillingNestedStackLogicalId,
  resolveBillingWebhookUrl,
  resolveRootStackNameFromManifest,
  resolveRootTemplateFileFromManifest,
  shouldWatchSandboxOutputs,
} from "../scripts/ampx-with-env.mjs";

type NestedStackLookupInput = {
  logicalResourceId: string;
  region: string;
  rootStackName: string;
};

type StackOutputsLookupInput = {
  region: string;
  stackName: string;
};

type ScheduledCallback = () => void;
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

test("shouldWatchSandboxOutputs only enables sandbox deploy/watch runs", () => {
  assert.equal(shouldWatchSandboxOutputs(["sandbox"]), true);
  assert.equal(shouldWatchSandboxOutputs(["sandbox", "--identifier", "dev"]), true);
  assert.equal(shouldWatchSandboxOutputs(["sandbox", "--help"]), false);
  assert.equal(shouldWatchSandboxOutputs(["sandbox", "secret", "set", "KEY"]), false);
  assert.equal(shouldWatchSandboxOutputs(["generate", "outputs"]), false);
});

test("applySandboxDefaults enables function log streaming for sandbox runs", () => {
  assert.deepStrictEqual(applySandboxDefaults(["sandbox"]), [
    "sandbox",
    "--dir-to-watch",
    ".",
    "--exclude",
    "amplify_outputs.json",
    "--exclude",
    ".amplify",
    "--exclude",
    ".next",
    "--exclude",
    "node_modules",
    "--exclude",
    "cdk.out",
    "--exclude",
    "app",
    "--exclude",
    "public",
    "--exclude",
    "tests",
    "--exclude",
    "docs",
    "--exclude",
    "bb-api-fixtures",
    "--stream-function-logs",
  ]);
  assert.deepStrictEqual(applySandboxDefaults(["sandbox", "--identifier", "dev"]), [
    "sandbox",
    "--identifier",
    "dev",
    "--dir-to-watch",
    ".",
    "--exclude",
    "amplify_outputs.json",
    "--exclude",
    ".amplify",
    "--exclude",
    ".next",
    "--exclude",
    "node_modules",
    "--exclude",
    "cdk.out",
    "--exclude",
    "app",
    "--exclude",
    "public",
    "--exclude",
    "tests",
    "--exclude",
    "docs",
    "--exclude",
    "bb-api-fixtures",
    "--stream-function-logs",
  ]);
});

test("applySandboxDefaults preserves explicit stream log choices and subcommands", () => {
  assert.deepStrictEqual(
    applySandboxDefaults(["sandbox", "--stream-function-logs=false"]),
    [
      "sandbox",
      "--stream-function-logs=false",
      "--dir-to-watch",
      ".",
      "--exclude",
      "amplify_outputs.json",
      "--exclude",
      ".amplify",
      "--exclude",
      ".next",
      "--exclude",
      "node_modules",
      "--exclude",
      "cdk.out",
      "--exclude",
      "app",
      "--exclude",
      "public",
      "--exclude",
      "tests",
      "--exclude",
      "docs",
      "--exclude",
      "bb-api-fixtures",
    ],
  );
  assert.deepStrictEqual(
    applySandboxDefaults(["sandbox", "--stream-function-logs"]),
    [
      "sandbox",
      "--stream-function-logs",
      "--dir-to-watch",
      ".",
      "--exclude",
      "amplify_outputs.json",
      "--exclude",
      ".amplify",
      "--exclude",
      ".next",
      "--exclude",
      "node_modules",
      "--exclude",
      "cdk.out",
      "--exclude",
      "app",
      "--exclude",
      "public",
      "--exclude",
      "tests",
      "--exclude",
      "docs",
      "--exclude",
      "bb-api-fixtures",
    ],
  );
  assert.deepStrictEqual(applySandboxDefaults(["sandbox", "secret", "set", "KEY"]), [
    "sandbox",
    "secret",
    "set",
    "KEY",
  ]);
});

test("applySandboxDefaults preserves explicit watch choices", () => {
  assert.deepStrictEqual(
    applySandboxDefaults(["sandbox", "--dir-to-watch", "lib", "--exclude", ".amplify"]),
    [
      "sandbox",
      "--dir-to-watch",
      "lib",
      "--exclude",
      ".amplify",
      "--stream-function-logs",
    ],
  );
});

test("resolveRootStackNameFromManifest finds the synthesized root stack", () => {
  const manifest = {
    artifacts: {
      AssetManifest: {
        type: "cdk:asset-manifest",
      },
      SandboxStack: {
        properties: {
          templateFile: "SandboxStack.template.json",
        },
        type: "aws:cloudformation:stack",
      },
    },
  };

  assert.equal(resolveRootStackNameFromManifest(manifest), "SandboxStack");
  assert.equal(
    resolveRootTemplateFileFromManifest(manifest, "SandboxStack"),
    "SandboxStack.template.json",
  );
});

test("resolveBillingNestedStackLogicalId finds the billing integration nested stack", () => {
  const rootTemplate = {
    Resources: {
      SomeOtherNestedStack: {
        Metadata: {
          "aws:cdk:path": "sandbox/other-integration.NestedStack/Resource",
        },
        Type: "AWS::CloudFormation::Stack",
      },
      BillingIntegrationNestedStack: {
        Metadata: {
          "aws:cdk:path":
            "sandbox/billing-integration.NestedStack/billing-integration.NestedStackResource",
        },
        Type: "AWS::CloudFormation::Stack",
      },
    },
  };

  assert.equal(
    resolveBillingNestedStackLogicalId(rootTemplate),
    "BillingIntegrationNestedStack",
  );
});

test("resolveAwsRegion prefers amplify outputs and falls back to env", () => {
  assert.equal(
    resolveAwsRegion(
      {
        data: {
          aws_region: "us-east-1",
        },
      },
      {
        NODE_ENV: "test",
        AWS_REGION: "us-west-2",
      } as NodeJS.ProcessEnv,
    ),
    "us-east-1",
  );

  assert.equal(
    resolveAwsRegion(
      {},
      {
        NODE_ENV: "test",
        AWS_DEFAULT_REGION: "us-west-2",
      } as NodeJS.ProcessEnv,
    ),
    "us-west-2",
  );
});

test("extractBillingWebhookUrl returns the billing webhook output", () => {
  assert.equal(
    extractBillingWebhookUrl([
      {
        OutputKey: "SomeOtherOutput",
        OutputValue: "ignore-me",
      },
      {
        OutputKey: "BillingWebhookUrl",
        OutputValue: "https://example.com/stripe-webhook",
      },
    ]),
    "https://example.com/stripe-webhook",
  );
});

test("resolveBillingWebhookUrl walks synthesized artifacts and stack outputs", async () => {
  const readJsonCalls: string[] = [];
  const describeNestedStackCalls: NestedStackLookupInput[] = [];
  const describeOutputsCalls: StackOutputsLookupInput[] = [];
  const projectRoot = "/tmp/bb-amplify";

  const webhookUrl = await resolveBillingWebhookUrl(projectRoot, {
    describeNestedStackId: async (input) => {
      describeNestedStackCalls.push(input);
      return "billing-stack-physical-id";
    },
    describeStackOutputs: async (input) => {
      describeOutputsCalls.push(input);
      return [
        {
          OutputKey: "BillingWebhookUrl",
          OutputValue: "https://example.com/stripe-webhook",
        },
      ];
    },
    env: {
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    readJson: async (filePath) => {
      readJsonCalls.push(filePath);

      if (filePath === "/tmp/bb-amplify/amplify_outputs.json") {
        return {
          auth: {
            aws_region: "us-east-1",
          },
        };
      }

      if (filePath === "/tmp/bb-amplify/.amplify/artifacts/cdk.out/manifest.json") {
        return {
          artifacts: {
            SandboxStack: {
              properties: {
                templateFile: "SandboxStack.template.json",
              },
              type: "aws:cloudformation:stack",
            },
          },
        };
      }

      if (filePath === "/tmp/bb-amplify/.amplify/artifacts/cdk.out/SandboxStack.template.json") {
        return {
          Resources: {
            BillingIntegrationNestedStack: {
              Metadata: {
                "aws:cdk:path":
                  "sandbox/billing-integration.NestedStack/billing-integration.NestedStackResource",
              },
              Type: "AWS::CloudFormation::Stack",
            },
          },
        };
      }

      throw new Error(`Unexpected JSON read: ${filePath}`);
    },
  });

  assert.equal(webhookUrl, "https://example.com/stripe-webhook");
  assert.deepStrictEqual(readJsonCalls, [
    "/tmp/bb-amplify/amplify_outputs.json",
    "/tmp/bb-amplify/.amplify/artifacts/cdk.out/manifest.json",
    "/tmp/bb-amplify/.amplify/artifacts/cdk.out/SandboxStack.template.json",
  ]);
  assert.deepStrictEqual(describeNestedStackCalls, [
    {
      logicalResourceId: "BillingIntegrationNestedStack",
      region: "us-east-1",
      rootStackName: "SandboxStack",
    },
  ]);
  assert.deepStrictEqual(describeOutputsCalls, [
    {
      region: "us-east-1",
      stackName: "billing-stack-physical-id",
    },
  ]);
});

test("createWebhookUrlReporter suppresses duplicate webhook URLs", async () => {
  const logged: string[] = [];
  const timers: Array<{ callback: ScheduledCallback; handle: TimerHandle }> = [];
  let currentUrl = "https://example.com/first";
  let nextTimerId = 0;

  const reporter = createWebhookUrlReporter({
    clearTimeout: ((timerId: TimerHandle) => {
      const index = timers.findIndex((timer) => timer.handle === timerId);
      if (index >= 0) {
        timers.splice(index, 1);
      }
    }) as typeof globalThis.clearTimeout,
    log: (message) => logged.push(message),
    lookupWebhookUrl: async () => currentUrl,
    setTimeout: ((callback: ScheduledCallback, _delay?: number) => {
      const handle = { id: nextTimerId += 1 } as unknown as TimerHandle;
      timers.push({ callback, handle });
      return handle;
    }) as typeof globalThis.setTimeout,
    warn: assert.fail,
  });

  reporter.schedule();
  timers.shift()?.callback();
  await Promise.resolve();

  reporter.schedule();
  timers.shift()?.callback();
  await Promise.resolve();

  currentUrl = "https://example.com/second";
  reporter.schedule();
  timers.shift()?.callback();
  await Promise.resolve();

  assert.deepStrictEqual(logged, [
    "Stripe webhook URL: https://example.com/first",
    "Stripe webhook URL: https://example.com/second",
  ]);
});

test("createWebhookUrlReporter warns without failing when lookup fails", async () => {
  const warnings: string[] = [];

  const reporter = createWebhookUrlReporter({
    log: assert.fail,
    lookupWebhookUrl: async () => {
      throw new Error("missing billing stack");
    },
    warn: (message) => warnings.push(message),
  });

  await reporter.reportIfChanged();

  assert.deepStrictEqual(warnings, [
    "Stripe webhook URL unavailable: missing billing stack",
  ]);
});
