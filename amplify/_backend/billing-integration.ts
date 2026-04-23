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
  clearMyTeamHighlightsData: FunctionResource;
  createBillingCheckoutSession: FunctionResource;
  createBillingPortalSession: FunctionResource;
  createStack(name: string): Stack;
  evaluatePredictionMatrix: FunctionResource;
  gameDayRecapSubmit: FunctionResource;
  getBillingSummary: FunctionResource;
  nextGameRecommendationSubmit: FunctionResource;
  opponentForecastSubmit: FunctionResource;
  predictionSubmit: FunctionResource;
  setTrackedPlayerInterviewPersonality: FunctionResource;
  submitLeagueGameDayRecap: FunctionResource;
  submitMyTeamHighlightsScan: FunctionResource;
  submitSingleGameSummary: FunctionResource;
};

export function configureBillingIntegration(
  backend: BillingBackend,
  config: BillingSynthConfig,
): void {
  backend.getBillingSummary.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.nextGameRecommendationSubmit.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.predictionSubmit.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.evaluatePredictionMatrix.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.gameDayRecapSubmit.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.opponentForecastSubmit.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.submitLeagueGameDayRecap.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.submitSingleGameSummary.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.submitMyTeamHighlightsScan.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.clearMyTeamHighlightsData.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );
  backend.setTrackedPlayerInterviewPersonality.addEnvironment(
    "COMMERCIAL_MODE_ENABLED",
    String(config.commercialModeEnabled),
  );

  if (config.defaultPlanId) {
    backend.getBillingSummary.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.nextGameRecommendationSubmit.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.predictionSubmit.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.evaluatePredictionMatrix.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.gameDayRecapSubmit.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.opponentForecastSubmit.addEnvironment(
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
    backend.clearMyTeamHighlightsData.addEnvironment(
      "BILLING_DEFAULT_PLAN",
      config.defaultPlanId,
    );
    backend.setTrackedPlayerInterviewPersonality.addEnvironment(
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
