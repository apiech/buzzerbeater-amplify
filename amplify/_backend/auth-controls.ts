import { CfnOutput, Stack } from "aws-cdk-lib";
import { CfnUserPool } from "aws-cdk-lib/aws-cognito";

type AuthControlsBackend = {
  auth: {
    resources: {
      cfnResources: {
        cfnUserPool: CfnUserPool;
      };
    };
  };
};

export function configureAuthControls(backend: AuthControlsBackend): void {
  const userPool = backend.auth.resources.cfnResources.cfnUserPool;
  userPool.userPoolTier = "LITE";

  new CfnOutput(Stack.of(userPool), "CognitoUserPoolTier", {
    value: "LITE",
    description: "Pinned Cognito user pool tier for low-cost auth.",
  });
}
