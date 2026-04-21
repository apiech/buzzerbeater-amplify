import assert from "node:assert/strict";
import test from "node:test";

import { __testing as hostedCheckTesting } from "../scripts/check-hosted-shared-infra";

test("hosted readiness maps Amplify branches with the same prod logic as synth", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
          },
        },
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.deepEqual(report.branchSummaries, [
    {
      branchName: "dev",
      computeRoleArn:
        "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
      environmentName: "dev",
    },
    {
      branchName: "main",
      computeRoleArn:
        "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
      environmentName: "prod",
    },
  ]);
  assert.equal(report.issues.length, 0);
});

test("hosted readiness reports missing shared-infra parameters", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
          },
        },
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": [
        {
          InvalidParameters: [],
        },
        {
          InvalidParameters: [],
        },
        {
          InvalidParameters: [
            "/buzzerbeater/ml-data-infra/prod/prediction-endpoint-name",
            "/buzzerbeater/ml-data-infra/prod/bb-connection-encryption-secret",
            "/buzzerbeater/ml-data-infra/prod/bb-connection-encryption-secret-fingerprint",
          ],
        },
        {
          InvalidParameters: [],
        },
      ],
    }),
  );

  assert.match(
    report.issues.join("\n"),
    /Shared ML infra SSM parameters are missing for 'prod'/,
  );
  assert.match(
    report.issues.join("\n"),
    /bb-connection-encryption-secret-fingerprint/,
  );
});

test("hosted readiness warns when the optional opponent forecast endpoint binding is absent", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
          },
        },
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": [
        {
          InvalidParameters: [
            "/buzzerbeater/ml-data-infra/dev/opponent-forecast-endpoint-name",
          ],
        },
        {
          InvalidParameters: [],
        },
        {
          InvalidParameters: [
            "/buzzerbeater/ml-data-infra/prod/opponent-forecast-endpoint-name",
          ],
        },
        {
          InvalidParameters: [],
        },
      ],
    }),
  );

  assert.equal(report.issues.length, 0);
  assert.match(
    report.warnings.join("\n"),
    /Opponent forecast jobs remain disabled/,
  );
});

test("hosted readiness reports missing compute roles separately from shared-infra access", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [{ branch: {} }, { branch: {} }],
      "iam:simulate-principal-policy": {
        EvaluationResults: [
          { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          {
            EvalActionName: "ssm:GetParametersByPath",
            EvalDecision: "allowed",
          },
        ],
      },
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.match(
    report.issues.join("\n"),
    /computeRoleArn configured for SSR runtime access/,
  );
});

test("hosted readiness reports dead custom-domain redirects", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          customRules: [
            {
              source: "https://bringmeacat.com",
              status: "302",
              target: "https://www.bringmeacat.com",
            },
          ],
          environmentVariables: {
            APP_BASE_URL: "https://bringmeacat.com",
          },
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
          },
        },
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.match(
    report.issues.join("\n"),
    /redirects to 'www\.bringmeacat\.com', but no custom domain association configures that host/,
  );
  assert.match(
    report.issues.join("\n"),
    /redirects the APP_BASE_URL host 'bringmeacat\.com' to 'www\.bringmeacat\.com'/,
  );
});

test("hosted readiness reports APP_BASE_URL hosts outside Amplify custom domains", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          environmentVariables: {
            APP_BASE_URL: "https://app.example.com",
          },
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
          },
        },
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.match(
    report.issues.join("\n"),
    /APP_BASE_URL points at 'app\.example\.com', but no Amplify custom domain association configures that host/,
  );
});

test("hosted readiness verifies the configured Cognito custom auth domain", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          environmentVariables: {
            APP_BASE_URL: "https://app.example.com",
            COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID: "Z123",
            COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME: "example.com",
          },
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-domain-associations": {
        domainAssociations: [
          {
            domainName: "example.com",
            subDomains: [
              {
                subDomainSetting: {
                  prefix: "app",
                },
              },
            ],
          },
        ],
      },
      "amplify:list-branches": {
        branches: [{ branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            backend: {
              stackArn:
                "arn:aws:cloudformation:us-east-1:427377913956:stack/amplify-main/123",
            },
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "cloudformation:describe-stacks": {
        Stacks: [
          {
            Outputs: [
              {
                OutputKey: "oauthClientId",
                OutputValue: "client-123",
              },
              {
                OutputKey: "oauthRedirectSignIn",
                OutputValue:
                  "https://app.example.com/api/auth/sign-in-callback",
              },
            ],
          },
        ],
      },
      "cognito-idp:describe-user-pool-domain": {
        DomainDescription: {
          CloudFrontDistribution: "d111111abcdef8.cloudfront.net",
          Domain: "auth.example.com",
        },
      },
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "https:status": 200,
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.equal(report.authDomain, "auth.example.com");
  assert.equal(report.issues.length, 0);
});

test("hosted readiness detects branch-level Cognito custom auth domains and verifies the managed login preview URL", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            backend: {
              stackArn:
                "arn:aws:cloudformation:us-east-1:427377913956:stack/amplify-dev/123",
            },
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
            environmentVariables: {
              COGNITO_AUTH_CUSTOM_DOMAIN: "auth.dev.example.com",
              COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID: "Z123EXAMPLE",
              COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME: "example.com",
            },
          },
        },
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "cloudformation:describe-stacks": {
        Stacks: [
          {
            Outputs: [
              {
                OutputKey: "oauthClientId",
                OutputValue: "client-123",
              },
              {
                OutputKey: "oauthRedirectSignIn",
                OutputValue:
                  "https://dev.example.com/api/auth/sign-in-callback",
              },
            ],
          },
        ],
      },
      "cognito-idp:describe-user-pool-domain": {
        DomainDescription: {
          CloudFrontDistribution: "d111111abcdef8.cloudfront.net",
          Domain: "auth.dev.example.com",
        },
      },
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "https:status": 200,
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.equal(report.authDomain, "auth.dev.example.com");
  assert.equal(report.issues.length, 0);
});

test("hosted readiness reports incomplete Cognito custom auth domain configuration", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          environmentVariables: {
            APP_BASE_URL: "https://app.example.com",
            COGNITO_AUTH_CUSTOM_DOMAIN: "auth.example.com",
          },
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-domain-associations": {
        domainAssociations: [
          {
            domainName: "example.com",
            subDomains: [
              {
                subDomainSetting: {
                  prefix: "app",
                },
              },
            ],
          },
        ],
      },
      "amplify:list-branches": {
        branches: [{ branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.match(
    report.issues.join("\n"),
    /COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_NAME and COGNITO_AUTH_CUSTOM_DOMAIN_ZONE_ID must both be set/i,
  );
});

test("hosted readiness reports quota blockers when sandbox exceeds its intended allocation", () => {
  const report = hostedCheckTesting.collectHostedSharedInfraReadiness(
    {
      appId: "d2ckw6mf5kdema",
    },
    createRuntime({
      "amplify:get-app": {
        app: {
          iamServiceRoleArn:
            "arn:aws:iam::427377913956:role/service-role/AmplifySSRLoggingRole-example",
          name: "buzzerbeater-amplify",
        },
      },
      "amplify:list-branches": {
        branches: [{ branchName: "dev" }, { branchName: "main" }],
      },
      "amplify:get-branch": [
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-dev-hosted-compute",
          },
        },
        {
          branch: {
            computeRoleArn:
              "arn:aws:iam::427377913956:role/buzzerbeater-prod-hosted-compute",
          },
        },
      ],
      "iam:simulate-principal-policy": [
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
            {
              EvalActionName: "ssm:GetParametersByPath",
              EvalDecision: "allowed",
            },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
        {
          EvaluationResults: [
            { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          ],
        },
      ],
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [
          {
            EndpointName:
              "buzzerbeater-machine-learning-predictor-sandbox-karey",
            EndpointStatus: "InService",
          },
        ],
      },
      "sagemaker:describe-endpoint": {
        ProductionVariants: [
          {
            CurrentServerlessConfig: {
              MaxConcurrency: 10,
            },
          },
        ],
      },
      "ssm:get-parameters": {
        InvalidParameters: [],
      },
    }),
  );

  assert.match(
    report.issues.join("\n"),
    /currently reserves 10 concurrency, exceeding the intended 2/,
  );
});

test("hosted shared-infra guidance only targets shared ML infra parameters", () => {
  const policy = hostedCheckTesting.buildHostedSharedInfraPolicyDocument(
    "us-east-1",
  ) as {
    Statement?: Array<{ Resource?: unknown }>;
  };
  const firstStatement = policy.Statement?.[0];
  const resources = Array.isArray(firstStatement?.Resource)
    ? (firstStatement.Resource as string[])
    : [];

  assert.deepEqual(resources, [
    "arn:aws:ssm:us-east-1:427377913956:parameter/buzzerbeater/ml-data-infra/*",
  ]);
});

test("hosted compute role guidance targets the maintenance control parameter for the branch environment", () => {
  const policy = hostedCheckTesting.buildHostedComputePolicyDocument(
    "prod",
    "us-east-1",
  ) as {
    Statement?: Array<{ Resource?: unknown }>;
  };
  const firstStatement = policy.Statement?.[0];

  assert.equal(
    firstStatement?.Resource,
    "arn:aws:ssm:us-east-1:427377913956:parameter/buzzerbeater/site-control/prod/current",
  );
});

function createRuntime(fixtures: Record<string, unknown | unknown[]>) {
  const callCounts = new Map<string, number>();
  const defaultFixtures: Record<string, unknown> = {
    "amplify:list-domain-associations": {
      domainAssociations: [
        {
          domainName: "bringmeacat.com",
          subDomains: [
            {
              subDomainSetting: {
                branchName: "main",
              },
            },
            {
              subDomainSetting: {
                prefix: "dev",
                branchName: "dev",
              },
            },
          ],
        },
      ],
    },
  };

  return {
    execAwsJson(args: string[]) {
      const key = `${args[0]}:${args[1]}`;
      const fixture = fixtures[key] ?? defaultFixtures[key];
      if (fixture === undefined) {
        throw new Error(`Unexpected AWS CLI call: ${key}`);
      }

      if (Array.isArray(fixture)) {
        const currentCount = callCounts.get(key) ?? 0;
        callCounts.set(key, currentCount + 1);
        const value = fixture[currentCount];
        if (value === undefined) {
          throw new Error(
            `Missing fixture value for ${key} call ${currentCount + 1}`,
          );
        }
        return value;
      }

      return fixture;
    },
    httpsStatus() {
      const fixture = fixtures["https:status"];
      return typeof fixture === "number" ? fixture : null;
    },
    write() {
      return undefined;
    },
  };
}
