import assert from "node:assert/strict";
import test from "node:test";

import { RemovalPolicy } from "aws-cdk-lib";

import {
  __testing as synthEnvTesting,
  resolveAuthAppOrigin,
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
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/match-store-bucket-name",
            Value: "bucket",
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
            Name: "/buzzerbeater/ml-data-infra/sandbox-karey/team-highlights-scan-queue-url",
            Value: "https://queue.example.com/123/team-highlights",
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
    matchStoreBucketName: "bucket",
    playerSkillSnapshotTableName: "snapshots",
    predictionEndpointName: "endpoint",
    teamHighlightsScanQueueUrl: "https://queue.example.com/123/team-highlights",
    teamHighlightsStatusTableName: "status",
    teamMatchProjectionTableName: "projection",
    teamMomentsTableName: "moments",
  });
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
