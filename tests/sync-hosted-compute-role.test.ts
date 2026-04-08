import assert from "node:assert/strict";
import test from "node:test";

import { __testing as syncTesting } from "../scripts/sync-hosted-compute-role";

test("hosted compute role sync attaches the nested-stack role to the branch when missing", () => {
  const calls: string[] = [];
  const result = syncTesting.syncHostedComputeRole(
    {
      appId: "d2ckw6mf5kdema",
      branchName: "dev",
      region: "us-east-1",
    },
    {
      execAwsJson(args) {
        calls.push(`${args[0]}:${args[1]}`);
        const key = `${args[0]}:${args[1]}`;
        if (key === "amplify:get-branch") {
          return {
            branch: {
              backend: {
                stackArn:
                  "arn:aws:cloudformation:us-east-1:427377913956:stack/amplify-d2ckw6mf5kdema-dev-branch-xyz/1234",
              },
            },
          };
        }
        if (key === "cloudformation:list-stack-resources") {
          return {
            StackResourceSummaries: [
              {
                LogicalResourceId: "hostedcomputeroleABCD1234",
                PhysicalResourceId:
                  "arn:aws:cloudformation:us-east-1:427377913956:stack/amplify-d2ckw6mf5kdema-dev-branch-xyz-hostedcomputerole/5678",
                ResourceType: "AWS::CloudFormation::Stack",
              },
            ],
          };
        }
        if (key === "cloudformation:describe-stacks") {
          return {
            Stacks: [
              {
                Outputs: [
                  {
                    OutputKey: "HostedSsrComputeRoleArn",
                    OutputValue:
                      "arn:aws:iam::427377913956:role/generated-hosted-compute-role",
                  },
                ],
              },
            ],
          };
        }
        if (key === "amplify:update-branch") {
          return {
            branch: {
              computeRoleArn:
                "arn:aws:iam::427377913956:role/generated-hosted-compute-role",
            },
          };
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      write() {
        return undefined;
      },
    },
  );

  assert.equal(result.status, "attached");
  assert.equal(
    result.roleArn,
    "arn:aws:iam::427377913956:role/generated-hosted-compute-role",
  );
  assert.deepEqual(calls, [
    "amplify:get-branch",
    "cloudformation:list-stack-resources",
    "cloudformation:describe-stacks",
    "amplify:update-branch",
  ]);
});

test("hosted compute role sync is a no-op when the branch already points at the expected role", () => {
  let updateCalled = false;
  const result = syncTesting.syncHostedComputeRole(
    {
      appId: "d2ckw6mf5kdema",
      branchName: "main",
      region: "us-east-1",
    },
    {
      execAwsJson(args) {
        const key = `${args[0]}:${args[1]}`;
        if (key === "amplify:get-branch") {
          return {
            branch: {
              backend: {
                stackArn:
                  "arn:aws:cloudformation:us-east-1:427377913956:stack/amplify-d2ckw6mf5kdema-main-branch-xyz/1234",
              },
              computeRoleArn:
                "arn:aws:iam::427377913956:role/generated-hosted-compute-role",
            },
          };
        }
        if (key === "cloudformation:list-stack-resources") {
          return {
            StackResourceSummaries: [
              {
                LogicalResourceId: "hostedcomputeroleABCD1234",
                PhysicalResourceId:
                  "arn:aws:cloudformation:us-east-1:427377913956:stack/amplify-d2ckw6mf5kdema-main-branch-xyz-hostedcomputerole/5678",
                ResourceType: "AWS::CloudFormation::Stack",
              },
            ],
          };
        }
        if (key === "cloudformation:describe-stacks") {
          return {
            Stacks: [
              {
                Outputs: [
                  {
                    OutputKey: "HostedSsrComputeRoleArn",
                    OutputValue:
                      "arn:aws:iam::427377913956:role/generated-hosted-compute-role",
                  },
                ],
              },
            ],
          };
        }
        if (key === "amplify:update-branch") {
          updateCalled = true;
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      write() {
        return undefined;
      },
    },
  );

  assert.equal(result.status, "unchanged");
  assert.equal(updateCalled, false);
});
