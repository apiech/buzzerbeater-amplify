import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
} from "../scripts/backfill-bb-connection-secret-fingerprints";

test("parseArgs defaults the environment name from the branch", () => {
  const parsed = __testing.parseArgs(["--app-id", "d2ckw6mf5kdema", "--branch", "dev"]);

  assert.equal(parsed.appId, "d2ckw6mf5kdema");
  assert.equal(parsed.branchName, "dev");
  assert.equal(parsed.environmentName, "dev");
  assert.equal(parsed.region, "us-east-1");
  assert.equal(parsed.dryRun, false);
});

test("parseArgs honors an explicit environment and dry-run mode", () => {
  const parsed = __testing.parseArgs([
    "--app-id",
    "d2ckw6mf5kdema",
    "--branch",
    "feature/foo",
    "--environment",
    "sandbox-karey",
    "--region",
    "us-west-2",
    "--dry-run",
  ]);

  assert.equal(parsed.environmentName, "sandbox-karey");
  assert.equal(parsed.region, "us-west-2");
  assert.equal(parsed.dryRun, true);
});

test("resolveEnvironmentName maps prod branches to prod", () => {
  assert.equal(
    __testing.resolveEnvironmentName({
      branchName: "main",
      environmentName: null,
    }),
    "prod",
  );
});

test("findNestedStackArn requires exactly one matching nested stack", () => {
  const stackArn = __testing.findNestedStackArn(
    [
      {
        LogicalResourceId: "data7552DF31",
        PhysicalResourceId: "arn:aws:cloudformation:us-east-1:123:stack/data/1",
        ResourceType: "AWS::CloudFormation::Stack",
      },
    ],
    (resource) =>
      resource.ResourceType === "AWS::CloudFormation::Stack" &&
      resource.LogicalResourceId?.startsWith("data") === true,
    "data nested stack",
  );

  assert.equal(stackArn, "arn:aws:cloudformation:us-east-1:123:stack/data/1");
  assert.throws(
    () =>
      __testing.findNestedStackArn([], () => true, "data nested stack"),
    /Expected exactly one data nested stack, found 0/,
  );
});

test("findOnlyDynamoTableName requires exactly one table", () => {
  assert.equal(
    __testing.findOnlyDynamoTableName(
      [
        {
          LogicalResourceId: "BbCredentialTable",
          PhysicalResourceId: "bb-credential-dev",
          ResourceType: "AWS::DynamoDB::Table",
        },
      ],
      "BbCredential nested stack",
    ),
    "bb-credential-dev",
  );

  assert.throws(
    () =>
      __testing.findOnlyDynamoTableName(
        [
          {
            LogicalResourceId: "One",
            PhysicalResourceId: "table-1",
            ResourceType: "AWS::DynamoDB::Table",
          },
          {
            LogicalResourceId: "Two",
            PhysicalResourceId: "table-2",
            ResourceType: "AWS::DynamoDB::Table",
          },
        ],
        "BbCredential nested stack",
      ),
    /Expected exactly one DynamoDB table in BbCredential nested stack, found 2/,
  );
});
