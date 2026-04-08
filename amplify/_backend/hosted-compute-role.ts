import { CfnOutput, type Stack } from "aws-cdk-lib";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

import {
  resolveHostedBranchConfig,
  resolveMaintenanceControlPlaneConfig,
} from "../_shared/synth-env.js";

type HostedComputeRoleBackend = {
  createStack(name: string): Stack;
};

const hostedComputeRoleOutputKey = "HostedSsrComputeRoleArn";

export const __testing = {
  hostedComputeRoleOutputKey,
};

export function configureHostedComputeRole(
  backend: HostedComputeRoleBackend,
): void {
  const hostedBranch = resolveHostedBranchConfig();
  if (!hostedBranch) {
    return;
  }

  const { parameterName } = resolveMaintenanceControlPlaneConfig();
  const stack = backend.createStack("hosted-compute-role");
  const role = new Role(stack, "HostedSsrComputeRole", {
    assumedBy: new ServicePrincipal("amplify.amazonaws.com"),
    description: [
      "Least-privilege SSR compute role for Amplify Hosting.",
      `App ${hostedBranch.appId}, branch ${hostedBranch.branchName}.`,
    ].join(" "),
  });

  role.addToPolicy(
    new PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [buildSsmParameterArn(stack, parameterName)],
    }),
  );

  const branchArn = [
    "arn:aws:amplify:",
    stack.region,
    ":",
    stack.account,
    ":apps/",
    hostedBranch.appId,
    "/branches/",
    hostedBranch.branchName,
  ].join("");
  new AwsCustomResource(stack, "HostedSsrComputeRoleAttachment", {
    installLatestAwsSdk: false,
    onCreate: {
      action: "updateBranch",
      parameters: {
        appId: hostedBranch.appId,
        branchName: hostedBranch.branchName,
        computeRoleArn: role.roleArn,
      },
      physicalResourceId: PhysicalResourceId.of(
        `hosted-ssr-compute-role-${hostedBranch.branchName}`,
      ),
      service: "Amplify",
    },
    onUpdate: {
      action: "updateBranch",
      parameters: {
        appId: hostedBranch.appId,
        branchName: hostedBranch.branchName,
        computeRoleArn: role.roleArn,
      },
      physicalResourceId: PhysicalResourceId.of(
        `hosted-ssr-compute-role-${hostedBranch.branchName}`,
      ),
      service: "Amplify",
    },
    policy: AwsCustomResourcePolicy.fromStatements([
      new PolicyStatement({
        actions: ["amplify:UpdateBranch"],
        resources: [branchArn],
      }),
      new PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [role.roleArn],
      }),
    ]),
  });

  new CfnOutput(stack, hostedComputeRoleOutputKey, {
    value: role.roleArn,
  });
  new CfnOutput(stack, "HostedSsrComputeRoleEnvironmentName", {
    value: hostedBranch.environmentName,
  });
}

function buildSsmParameterArn(stack: Stack, parameterName: string): string {
  return stack.formatArn({
    resource: "parameter",
    resourceName: parameterName.replace(/^\//, ""),
    service: "ssm",
  });
}
