import { CfnOutput, Stack } from "aws-cdk-lib";
import type { CfnUserPool } from "aws-cdk-lib/aws-cognito";

type AuthControlsBackend = {
  auth: {
    resources: {
      cfnResources: {
        cfnUserPool: CfnUserPool;
      };
    };
  };
};

function hasPoliciesProperty(
  policies: CfnUserPool["policies"],
): policies is CfnUserPool.PoliciesProperty {
  return (
    policies != null && typeof policies === "object" && !("resolve" in policies)
  );
}

function hasPasswordPolicyProperty(
  passwordPolicy: CfnUserPool.PoliciesProperty["passwordPolicy"],
): passwordPolicy is CfnUserPool.PasswordPolicyProperty {
  return (
    passwordPolicy != null &&
    typeof passwordPolicy === "object" &&
    !("resolve" in passwordPolicy)
  );
}

export function configureAuthControls(backend: AuthControlsBackend): void {
  const userPool = backend.auth.resources.cfnResources.cfnUserPool;
  const existingPolicies = hasPoliciesProperty(userPool.policies)
    ? userPool.policies
    : {};
  const existingPasswordPolicy = hasPasswordPolicyProperty(
    existingPolicies.passwordPolicy,
  )
    ? existingPolicies.passwordPolicy
    : {};

  userPool.userPoolTier = "ESSENTIALS";
  userPool.policies = {
    ...existingPolicies,
    passwordPolicy: {
      ...existingPasswordPolicy,
      minimumLength: 6,
      requireLowercase: false,
      requireNumbers: false,
      requireSymbols: false,
      requireUppercase: false,
    },
  };

  new CfnOutput(Stack.of(userPool), "CognitoUserPoolTier", {
    value: "ESSENTIALS",
    description: "Pinned Cognito user pool tier for managed login auth.",
  });
}
