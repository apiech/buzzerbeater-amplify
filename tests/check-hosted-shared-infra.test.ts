import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as hostedCheckTesting,
} from "../scripts/check-hosted-shared-infra";

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
        branches: [
          { branchName: "dev" },
          { branchName: "main" },
        ],
      },
      "iam:simulate-principal-policy": {
        EvaluationResults: [
          { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParametersByPath", EvalDecision: "allowed" },
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

  assert.deepEqual(report.branchSummaries, [
    { branchName: "dev", environmentName: "dev" },
    { branchName: "main", environmentName: "prod" },
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
        branches: [
          { branchName: "dev" },
          { branchName: "main" },
        ],
      },
      "iam:simulate-principal-policy": {
        EvaluationResults: [
          { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParametersByPath", EvalDecision: "allowed" },
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
      "ssm:get-parameters": [
        {
          InvalidParameters: [],
        },
        {
          InvalidParameters: [
            "/buzzerbeater/ml-data-infra/prod/prediction-endpoint-name",
          ],
        },
      ],
    }),
  );

  assert.match(
    report.issues.join("\n"),
    /Shared ML infra SSM parameters are missing for 'prod'/,
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
        branches: [
          { branchName: "dev" },
          { branchName: "main" },
        ],
      },
      "iam:simulate-principal-policy": {
        EvaluationResults: [
          { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParametersByPath", EvalDecision: "allowed" },
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
      "ssm:get-parameters": [
        {
          InvalidParameters: [
            "/buzzerbeater/ml-data-infra/dev/opponent-forecast-endpoint-name",
          ],
        },
        {
          InvalidParameters: [
            "/buzzerbeater/ml-data-infra/prod/opponent-forecast-endpoint-name",
          ],
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
        branches: [
          { branchName: "dev" },
          { branchName: "main" },
        ],
      },
      "iam:simulate-principal-policy": {
        EvaluationResults: [
          { EvalActionName: "ssm:GetParameters", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParameter", EvalDecision: "allowed" },
          { EvalActionName: "ssm:GetParametersByPath", EvalDecision: "allowed" },
        ],
      },
      "service-quotas:get-service-quota": {
        Quota: {
          Value: 10,
        },
      },
      "sagemaker:list-endpoints": {
        Endpoints: [
          {
            EndpointName: "buzzerbeater-machine-learning-predictor-sandbox-karey",
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

function createRuntime(fixtures: Record<string, unknown | unknown[]>) {
  const callCounts = new Map<string, number>();

  return {
    execAwsJson(args: string[]) {
      const key = `${args[0]}:${args[1]}`;
      const fixture = fixtures[key];
      if (fixture === undefined) {
        throw new Error(`Unexpected AWS CLI call: ${key}`);
      }

      if (Array.isArray(fixture)) {
        const currentCount = callCounts.get(key) ?? 0;
        callCounts.set(key, currentCount + 1);
        const value = fixture[currentCount];
        if (value === undefined) {
          throw new Error(`Missing fixture value for ${key} call ${currentCount + 1}`);
        }
        return value;
      }

      return fixture;
    },
    write() {
      return undefined;
    },
  };
}
