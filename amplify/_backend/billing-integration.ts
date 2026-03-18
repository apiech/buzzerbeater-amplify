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
  submitMyTeamHighlightsScan: FunctionResource;
  submitSingleGameSummary: FunctionResource;
};

export function configureBillingIntegration(
  backend: BillingBackend,
  config: BillingSynthConfig,
): void {
  if (config.defaultPlanId) {
    backend.getBillingSummary.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.predictionSubmit.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.gameDayRecapSubmit.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.submitLeagueGameDayRecap.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.submitSingleGameSummary.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.submitMyTeamHighlightsScan.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
  }

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
