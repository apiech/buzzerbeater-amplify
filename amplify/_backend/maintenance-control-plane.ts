import { CfnOutput, Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  FunctionUrlAuthType,
  type Function as LambdaFunction,
  type IFunction,
} from "aws-cdk-lib/aws-lambda";

import { resolveMaintenanceControlPlaneConfig } from "../_shared/synth-env.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type MaintenanceControlPlaneBackend = {
  createStack(name: string): Stack;
  maintenanceAdmin: FunctionResource;
  maintenanceAlarmTrip: FunctionResource;
};

export function configureMaintenanceControlPlane(
  backend: MaintenanceControlPlaneBackend,
  protectedFunctions: readonly FunctionResource[],
): void {
  const { environmentName, parameterName } =
    resolveMaintenanceControlPlaneConfig();
  const parameterPrefix = parameterName.replace(/\/current$/, "/*");
  const readActions = ["ssm:GetParameter"];
  const adminActions = [
    "ssm:DeleteParameter",
    "ssm:GetParameter",
    "ssm:PutParameter",
  ];

  for (const resource of [
    ...protectedFunctions,
    backend.maintenanceAdmin,
    backend.maintenanceAlarmTrip,
  ]) {
    resource.addEnvironment("MAINTENANCE_ENVIRONMENT_NAME", environmentName);
  }

  for (const resource of protectedFunctions) {
    resource.resources.lambda.addToRolePolicy(
      new PolicyStatement({
        actions: readActions,
        resources: [
          buildSsmParameterArn(resource.resources.lambda, parameterName),
        ],
      }),
    );
  }

  for (const resource of [
    backend.maintenanceAdmin,
    backend.maintenanceAlarmTrip,
  ]) {
    resource.resources.lambda.addToRolePolicy(
      new PolicyStatement({
        actions: adminActions,
        resources: [
          buildSsmParameterArn(resource.resources.lambda, parameterPrefix),
        ],
      }),
    );
  }

  const stack = backend.createStack("maintenance-control-plane");
  const adminLambda = backend.maintenanceAdmin.resources
    .lambda as LambdaFunction;
  const adminUrl = adminLambda.addFunctionUrl({
    authType: FunctionUrlAuthType.NONE,
  });

  new CfnOutput(stack, "MaintenanceAdminUrl", {
    value: adminUrl.url,
  });
}

function buildSsmParameterArn(
  lambda: IFunction,
  parameterName: string,
): string {
  return Stack.of(lambda).formatArn({
    resource: "parameter",
    resourceName: parameterName.replace(/^\//, ""),
    service: "ssm",
  });
}
