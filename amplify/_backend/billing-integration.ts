import { CfnOutput, type Stack } from "aws-cdk-lib";
import {
  FunctionUrlAuthType,
  type Function as LambdaFunction,
  type IFunction,
} from "aws-cdk-lib/aws-lambda";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type BillingBackend = {
  billingAdminOverride: FunctionResource;
  billingWebhook: FunctionResource;
  createBillingCheckoutSession: FunctionResource;
  createBillingPortalSession: FunctionResource;
  createStack(name: string): Stack;
};

export function configureBillingIntegration(backend: BillingBackend): void {
  const appBaseUrl = resolveRequiredEnv("APP_BASE_URL");
  const premiumPriceId = resolveRequiredEnv("STRIPE_PREMIUM_PRICE_ID");

  backend.createBillingCheckoutSession.addEnvironment("APP_BASE_URL", appBaseUrl);
  backend.createBillingCheckoutSession.addEnvironment(
    "STRIPE_PREMIUM_PRICE_ID",
    premiumPriceId,
  );
  backend.createBillingPortalSession.addEnvironment("APP_BASE_URL", appBaseUrl);

  const stack = backend.createStack("billing-integration");
  const webhookLambda = backend.billingWebhook.resources.lambda as LambdaFunction;
  const adminOverrideLambda =
    backend.billingAdminOverride.resources.lambda as LambdaFunction;

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

function resolveRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set for Stripe billing.`);
  }

  return value;
}
