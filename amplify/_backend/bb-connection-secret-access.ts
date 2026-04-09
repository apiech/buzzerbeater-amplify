import { Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";

import { resolveBbConnectionSecretParameterNameForSynth } from "../_shared/bb-connection-secret.js";

type FunctionResource = {
  resources: {
    lambda: IFunction;
  };
};

export function configureBbConnectionSecretAccess(
  resources: readonly FunctionResource[],
): void {
  const parameterName = resolveBbConnectionSecretParameterNameForSynth();

  for (const resource of resources) {
    const stack = Stack.of(resource.resources.lambda);
    resource.resources.lambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          stack.formatArn({
            service: "ssm",
            resource: "parameter",
            resourceName: parameterName.replace(/^\//, ""),
          }),
        ],
      }),
    );
  }
}
