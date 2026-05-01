import { CfnOutput, type Stack } from "aws-cdk-lib";
import {
  FunctionUrlAuthType,
  type Function as LambdaFunction,
  type IFunction,
} from "aws-cdk-lib/aws-lambda";

import type { BillingSynthConfig } from "../_shared/synth-env.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type BillingBackend = Record<string, unknown> & {
  billingAdminOverride: FunctionResource;
  billingWebhook: FunctionResource;
  createStack(name: string): Stack;
};

export const __testing = {
  applyBillingEnvironmentToFunctions,
  collectFunctionResources,
};

export function configureBillingIntegration(
  backend: BillingBackend,
  config: BillingSynthConfig,
): void {
  applyBillingEnvironmentToFunctions(backend, config);

  const stack = backend.createStack("billing-integration");
  const webhookLambda = backend.billingWebhook.resources
    .lambda as LambdaFunction;
  const adminOverrideLambda = backend.billingAdminOverride.resources
    .lambda as LambdaFunction;

  const webhookUrl = webhookLambda.addFunctionUrl({
    authType: FunctionUrlAuthType.NONE,
  });
  const adminOverrideUrl = adminOverrideLambda.addFunctionUrl({
    authType: FunctionUrlAuthType.NONE,
  });

  new CfnOutput(stack, "BillingWebhookUrl", {
    value: webhookUrl.url,
  });
  new CfnOutput(stack, "BillingAdminOverrideUrl", {
    value: adminOverrideUrl.url,
  });
}

function applyBillingEnvironmentToFunctions(
  backend: Record<string, unknown>,
  config: BillingSynthConfig,
): void {
  const functionResources = collectFunctionResources(backend);
  for (const resource of functionResources) {
    resource.addEnvironment(
      "COMMERCIAL_MODE_ENABLED",
      String(config.commercialModeEnabled),
    );
  }

  if (!config.defaultPlanId) {
    return;
  }

  for (const resource of functionResources) {
    resource.addEnvironment("BILLING_DEFAULT_PLAN", config.defaultPlanId);
  }
}

function collectFunctionResources(
  backend: Record<string, unknown>,
): FunctionResource[] {
  return Object.values(backend).filter(isFunctionResource);
}

function isFunctionResource(value: unknown): value is FunctionResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (
    !("addEnvironment" in value) ||
    typeof value.addEnvironment !== "function"
  ) {
    return false;
  }

  if (!("resources" in value) || !value.resources || typeof value.resources !== "object") {
    return false;
  }

  return "lambda" in value.resources;
}
