import { CfnOutput, type Stack } from "aws-cdk-lib";
import {
  FunctionUrlAuthType,
  type Function as LambdaFunction,
  type IFunction,
} from "aws-cdk-lib/aws-lambda";

import { resolvePublicAppOrigin } from "../../lib/env/public-app-origin.js";

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
  gameDayRecapSubmit: FunctionResource;
  getBillingSummary: FunctionResource;
  predictionSubmit: FunctionResource;
  submitLeagueGameDayRecap: FunctionResource;
  submitSingleGameSummary: FunctionResource;
  submitMyTeamHighlightsScan: FunctionResource;
};

export function configureBillingIntegration(backend: BillingBackend): void {
  const appBaseUrl = resolvePublicAppOrigin(process.env, {
    errorMessage: "APP_BASE_URL must be configured for Stripe billing.",
  });
  const defaultPlanId = resolveBillingDefaultPlan();
  const premiumPriceId = resolveRequiredEnv("STRIPE_PREMIUM_PRICE_ID");

  if (defaultPlanId) {
    backend.getBillingSummary.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      defaultPlanId,
    );
    backend.predictionSubmit.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      defaultPlanId,
    );
    backend.gameDayRecapSubmit.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      defaultPlanId,
    );
    backend.submitLeagueGameDayRecap.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      defaultPlanId,
    );
    backend.submitSingleGameSummary.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      defaultPlanId,
    );
    backend.submitMyTeamHighlightsScan.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      defaultPlanId,
    );
  }

  backend.createBillingCheckoutSession.addEnvironment(
    "APP_BASE_URL",
    appBaseUrl,
  );
  backend.createBillingCheckoutSession.addEnvironment(
    "STRIPE_PREMIUM_PRICE_ID",
    premiumPriceId,
  );
  backend.createBillingPortalSession.addEnvironment("APP_BASE_URL", appBaseUrl);

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

function resolveRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set for Stripe billing.`);
  }

  return value;
}

function resolveBillingDefaultPlan(): string | null {
  if (Object.hasOwn(process.env, "BILLING_DEFAULT_PLAN")) {
    const configuredValue = process.env.BILLING_DEFAULT_PLAN?.trim();
    return configuredValue ? configuredValue : null;
  }

  const branchName = (process.env.AWS_BRANCH ?? "dev").toLowerCase();
  if (
    branchName === "main" ||
    branchName === "master" ||
    branchName === "prod"
  ) {
    return null;
  }

  return "premium";
}
