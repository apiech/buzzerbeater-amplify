import assert from "node:assert/strict";
import test from "node:test";

import { RemovalPolicy } from "aws-cdk-lib";

import {
  __testing as synthEnvTesting,
  resolveAuthAppOrigin,
  resolveBillingConfig,
  resolveSharedEnvironmentName,
} from "../amplify/_shared/synth-env";

test("shared synth env resolves the environment name from explicit override, branch, or sandbox identity", () => {
  assert.equal(
    resolveSharedEnvironmentName(
      {
        BB_SHARED_ENVIRONMENT_NAME: "Sandbox Karey",
      },
      {
        userName: () => "ignored",
      },
    ),
    "sandbox-karey",
  );

  assert.equal(
    resolveSharedEnvironmentName(
      {
        BB_SANDBOX_IDENTIFIER: "Karey Local",
      },
      {
        userName: () => "ignored",
      },
    ),
    "sandbox-karey-local",
  );

  assert.equal(
    resolveSharedEnvironmentName(
      {
        AWS_BRANCH: "main",
      },
      {
        userName: () => "ignored",
      },
    ),
    "prod",
  );

  assert.equal(
    resolveSharedEnvironmentName(
      {},
      {
        userName: () => "Karey Local",
      },
    ),
    "sandbox-karey-local",
  );
});

test("shared synth env maps the SSM contract into runtime bindings", () => {
  const bindings = synthEnvTesting.readSharedInfraBindingsFromRuntime(
    "sandbox-karey",
    "us-east-1",
    {
      execAwsJson: () => ({
        Parameters: [
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/active-tracked-teams-table-name",
            Value: "active",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-catalog-table-name",
            Value: "catalog",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-processing-state-machine-arn",
            Value: "arn:aws:states:us-east-1:123456789012:stateMachine:match-processing",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-store-bucket-name",
            Value: "bucket",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/opponent-forecast-endpoint-name",
            Value: "opponent-endpoint",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/player-skill-snapshot-table-name",
            Value: "snapshots",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/prediction-endpoint-name",
            Value: "endpoint",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-highlights-scan-state-machine-arn",
            Value: "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-highlights-status-table-name",
            Value: "status",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-match-projection-table-name",
            Value: "projection",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-moments-table-name",
            Value: "moments",
          },
        ],
      }),
      fileExists: () => false,
      loadEnvFile: () => undefined,
      userName: () => "ignored",
    },
  );

  assert.deepEqual(bindings, {
    activeTrackedTeamsTableName: "active",
    matchCatalogTableName: "catalog",
    matchProcessingStateMachineArn:
      "arn:aws:states:us-east-1:123456789012:stateMachine:match-processing",
    matchStoreBucketName: "bucket",
    opponentForecastEndpointName: "opponent-endpoint",
    playerSkillSnapshotTableName: "snapshots",
    predictionEndpointName: "endpoint",
    teamHighlightsScanStateMachineArn:
      "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights",
    teamHighlightsStatusTableName: "status",
    teamMatchProjectionTableName: "projection",
    teamMomentsTableName: "moments",
  });
});

test("shared synth env batches SSM lookups when the contract exceeds ten parameters", () => {
  const calls: string[][] = [];

  synthEnvTesting.readSharedInfraBindingsFromRuntime(
    "sandbox-karey",
    "us-east-1",
    {
      execAwsJson: (args) => {
        calls.push(args);
        return {
          Parameters: [
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/active-tracked-teams-table-name",
              Value: "active",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-catalog-table-name",
              Value: "catalog",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-processing-state-machine-arn",
              Value: "arn:aws:states:us-east-1:123456789012:stateMachine:match-processing",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-store-bucket-name",
              Value: "bucket",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/opponent-forecast-endpoint-name",
              Value: "opponent-endpoint",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/player-skill-snapshot-table-name",
              Value: "snapshots",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/prediction-endpoint-name",
              Value: "endpoint",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-highlights-scan-state-machine-arn",
              Value: "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-highlights-status-table-name",
              Value: "status",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-match-projection-table-name",
              Value: "projection",
            },
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-moments-table-name",
              Value: "moments",
            },
          ],
        };
      },
      fileExists: () => false,
      loadEnvFile: () => undefined,
      userName: () => "ignored",
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "ssm");
  assert.equal(calls[0][1], "get-parameters");
  assert.equal(calls[1][0], "ssm");
  assert.equal(calls[1][1], "get-parameters");
  assert.equal(
    calls[0].slice(calls[0].indexOf("--names") + 1).length,
    10,
  );
  assert.equal(
    calls[1].slice(calls[1].indexOf("--names") + 1).length,
    1,
  );
});

test("shared synth env allows the optional opponent forecast endpoint binding to be absent", () => {
  const bindings = synthEnvTesting.readSharedInfraBindingsFromRuntime(
    "dev",
    "us-east-1",
    {
      execAwsJson: () => ({
        Parameters: [
          {
            Name: "/buzzerbeater/ml-data-infra/dev/active-tracked-teams-table-name",
            Value: "active",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/match-catalog-table-name",
            Value: "catalog",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/match-processing-state-machine-arn",
            Value: "arn:aws:states:us-east-1:123456789012:stateMachine:match-processing-dev",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/match-store-bucket-name",
            Value: "bucket",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/player-skill-snapshot-table-name",
            Value: "snapshots",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/prediction-endpoint-name",
            Value: "endpoint",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/team-highlights-scan-state-machine-arn",
            Value: "arn:aws:states:us-east-1:123456789012:stateMachine:team-highlights-dev",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/team-highlights-status-table-name",
            Value: "status",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/team-match-projection-table-name",
            Value: "projection",
          },
          {
            Name: "/buzzerbeater/ml-data-infra/dev/team-moments-table-name",
            Value: "moments",
          },
        ],
      }),
      fileExists: () => false,
      loadEnvFile: () => undefined,
      userName: () => "ignored",
    },
  );

  assert.equal(bindings.opponentForecastEndpointName, null);
  assert.equal(
    bindings.matchProcessingStateMachineArn,
    "arn:aws:states:us-east-1:123456789012:stateMachine:match-processing-dev",
  );
  assert.equal(bindings.predictionEndpointName, "endpoint");
});

test("shared synth env fails fast when required SSM parameters are missing", () => {
  assert.throws(
    () =>
      synthEnvTesting.readSharedInfraBindingsFromRuntime(
        "sandbox-karey",
        "us-east-1",
        {
          execAwsJson: () => ({
            Parameters: [
              {
                Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-store-bucket-name",
                Value: "bucket",
              },
            ],
          }),
          fileExists: () => false,
          loadEnvFile: () => undefined,
          userName: () => "ignored",
        },
      ),
    /Shared ML infra parameters are missing/,
  );
});

test("shared synth env surfaces actionable IAM guidance when SSM access is denied", () => {
  assert.throws(
    () =>
      synthEnvTesting.readSharedInfraBindingsFromRuntime(
        "dev",
        "us-east-1",
        {
          execAwsJson: () => {
            const error = new Error(
              "Command failed: aws ssm get-parameters --with-decryption --region us-east-1 --output json --names /buzzerbeater/ml-data-infra/dev/active-tracked-teams-table-name",
            ) as Error & { stderr?: string };
            error.stderr = [
              "An error occurred (AccessDeniedException) when calling the GetParameters operation:",
              "User is not authorized to perform: ssm:GetParameters",
            ].join(" ");
            throw error;
          },
          fileExists: () => false,
          loadEnvFile: () => undefined,
          userName: () => "ignored",
        },
      ),
    /missing shared-infra SSM read access/,
  );
});

test("shared synth env maps non-prod to destroy semantics and prod to retain semantics", () => {
  const originalEnvironmentName = process.env.BB_SHARED_ENVIRONMENT_NAME;

  try {
    process.env.BB_SHARED_ENVIRONMENT_NAME = "prod";
    synthEnvTesting.resetCachedState();
    assert.equal(
      synthEnvTesting.resolveAppResourceRemovalPolicy(),
      RemovalPolicy.RETAIN,
    );

    process.env.BB_SHARED_ENVIRONMENT_NAME = "sandbox-karey";
    synthEnvTesting.resetCachedState();
    assert.equal(
      synthEnvTesting.resolveAppResourceRemovalPolicy(),
      RemovalPolicy.DESTROY,
    );
  } finally {
    if (originalEnvironmentName === undefined) {
      delete process.env.BB_SHARED_ENVIRONMENT_NAME;
    } else {
      process.env.BB_SHARED_ENVIRONMENT_NAME = originalEnvironmentName;
    }
    synthEnvTesting.resetCachedState();
  }
});

test("auth origin resolves APP_BASE_URL for synth-time auth wiring", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  try {
    process.env.APP_BASE_URL = "https://app.example.com///";
    synthEnvTesting.resetCachedState();
    assert.equal(
      resolveAuthAppOrigin({
        execAwsJson: assert.fail,
        fileExists: () => false,
        loadEnvFile: assert.fail,
        userName: () => "ignored",
      }),
      "https://app.example.com",
    );
  } finally {
    if (originalAppBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = originalAppBaseUrl;
    }
    synthEnvTesting.resetCachedState();
  }
});

test("auth origin fails fast when APP_BASE_URL is missing", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  try {
    delete process.env.APP_BASE_URL;
    synthEnvTesting.resetCachedState();
    assert.throws(
      () =>
        resolveAuthAppOrigin({
          execAwsJson: assert.fail,
          fileExists: () => false,
          loadEnvFile: assert.fail,
          userName: () => "ignored",
        }),
      /APP_BASE_URL must be configured for auth callback URLs\./,
    );
  } finally {
    if (originalAppBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = originalAppBaseUrl;
    }
    synthEnvTesting.resetCachedState();
  }
});

test("billing config resolves offer flags and optional lifetime pricing", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  const originalSharedEnvironmentName = process.env.BB_SHARED_ENVIRONMENT_NAME;
  const originalPremiumPriceId = process.env.STRIPE_PREMIUM_PRICE_ID;
  const originalLifetimePriceId = process.env.STRIPE_LIFETIME_PRICE_ID;
  const originalPremiumOffer = process.env.BILLING_ENABLE_PREMIUM_SUBSCRIPTION;
  const originalLifetimeOffer = process.env.BILLING_ENABLE_LIFETIME_PURCHASE;

  try {
    process.env.APP_BASE_URL = "https://app.example.com";
    process.env.BB_SHARED_ENVIRONMENT_NAME = "sandbox-karey";
    process.env.STRIPE_PREMIUM_PRICE_ID = "price_premium";
    process.env.STRIPE_LIFETIME_PRICE_ID = "price_lifetime";
    process.env.BILLING_ENABLE_PREMIUM_SUBSCRIPTION = "false";
    process.env.BILLING_ENABLE_LIFETIME_PURCHASE = "true";
    synthEnvTesting.resetCachedState();

    assert.deepStrictEqual(resolveBillingConfig(), {
      appBaseUrl: "https://app.example.com",
      defaultPlanId: "premium",
      lifetimePriceId: "price_lifetime",
      lifetimePurchaseOfferEnabled: true,
      premiumPriceId: "price_premium",
      premiumSubscriptionOfferEnabled: false,
    });
  } finally {
    restoreEnv("APP_BASE_URL", originalAppBaseUrl);
    restoreEnv("BB_SHARED_ENVIRONMENT_NAME", originalSharedEnvironmentName);
    restoreEnv("STRIPE_PREMIUM_PRICE_ID", originalPremiumPriceId);
    restoreEnv("STRIPE_LIFETIME_PRICE_ID", originalLifetimePriceId);
    restoreEnv("BILLING_ENABLE_PREMIUM_SUBSCRIPTION", originalPremiumOffer);
    restoreEnv("BILLING_ENABLE_LIFETIME_PURCHASE", originalLifetimeOffer);
    synthEnvTesting.resetCachedState();
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
