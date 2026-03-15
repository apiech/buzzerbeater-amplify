import { CfnOutput, Duration } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import {
  EmailSubscription,
  SmsSubscription,
} from "aws-cdk-lib/aws-sns-subscriptions";
import type { Stack } from "aws-cdk-lib";

type CostVisibilityBackend = {
  createStack(name: string): Stack;
};

type ServiceCostGuardrail = {
  alarmThresholdUsd: number;
  budgetThresholdUsd: number;
  budgetServiceName: string;
  id: string;
  label: string;
};

const SERVICE_GUARDRAILS: readonly ServiceCostGuardrail[] = [
  {
    id: "cognito",
    label: "Cognito",
    budgetServiceName: "Amazon Cognito",
    budgetThresholdUsd: 50,
    alarmThresholdUsd: 50,
  },
  {
    id: "amplify",
    label: "Amplify Hosting",
    budgetServiceName: "AWS Amplify",
    budgetThresholdUsd: 50,
    alarmThresholdUsd: 50,
  },
  {
    id: "fargate",
    label: "Fargate",
    budgetServiceName: "AWS Fargate",
    budgetThresholdUsd: 25,
    alarmThresholdUsd: 25,
  },
  {
    id: "sagemaker",
    label: "SageMaker",
    budgetServiceName: "Amazon SageMaker",
    budgetThresholdUsd: 50,
    alarmThresholdUsd: 50,
  },
  {
    id: "dynamodb",
    label: "DynamoDB",
    budgetServiceName: "Amazon DynamoDB",
    budgetThresholdUsd: 25,
    alarmThresholdUsd: 25,
  },
  {
    id: "appsync",
    label: "AppSync",
    budgetServiceName: "AWS AppSync",
    budgetThresholdUsd: 20,
    alarmThresholdUsd: 20,
  },
  {
    id: "lambda",
    label: "Lambda",
    budgetServiceName: "AWS Lambda",
    budgetThresholdUsd: 20,
    alarmThresholdUsd: 20,
  },
  {
    id: "cloudwatch",
    label: "CloudWatch Logs",
    budgetServiceName: "AmazonCloudWatch",
    budgetThresholdUsd: 20,
    alarmThresholdUsd: 20,
  },
] as const;

export function configureCostVisibility(
  backend: CostVisibilityBackend,
): void {
  const stack = backend.createStack("cost-visibility");
  const topic = new Topic(stack, "CostAlertsTopic", {
    displayName: "BuzzerBeater cost alerts",
  });

  topic.addToResourcePolicy(
    new PolicyStatement({
      principals: [
        new ServicePrincipal("budgets.amazonaws.com"),
        new ServicePrincipal("cloudwatch.amazonaws.com"),
      ],
      actions: ["sns:Publish"],
      resources: [topic.topicArn],
    }),
  );

  for (const email of parseEmailSubscriptions(process.env.COST_ALERT_EMAILS)) {
    topic.addSubscription(new EmailSubscription(email));
  }
  for (const phoneNumber of parseSmsSubscriptions(process.env.COST_ALERT_SMS_NUMBERS)) {
    topic.addSubscription(new SmsSubscription(phoneNumber));
  }

  for (const guardrail of SERVICE_GUARDRAILS) {
    new CfnBudget(stack, `${guardrail.id}MonthlyBudget`, {
      budget: {
        budgetName: `bb-${guardrail.id}-monthly-cost`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: {
          amount: guardrail.budgetThresholdUsd,
          unit: "USD",
        },
        costFilters: {
          Service: [guardrail.budgetServiceName],
        },
      },
      notificationsWithSubscribers: [
        buildBudgetNotification(topic.topicArn, 80, "ACTUAL"),
        buildBudgetNotification(topic.topicArn, 100, "FORECASTED"),
      ],
    });

    const alarm = new Alarm(stack, `${guardrail.id}EstimatedChargesAlarm`, {
      alarmName: `bb-${guardrail.id}-estimated-charges`,
      alarmDescription: `${guardrail.label} estimated monthly charges crossed the configured guardrail.`,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      threshold: guardrail.alarmThresholdUsd,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      metric: new Metric({
        namespace: "AWS/Billing",
        metricName: "EstimatedCharges",
        statistic: "Maximum",
        period: Duration.hours(6),
        region: "us-east-1",
        dimensionsMap: {
          Currency: "USD",
          ServiceName: guardrail.budgetServiceName,
        },
      }),
    });
    alarm.addAlarmAction(new SnsAction(topic));
  }

  new CfnOutput(stack, "CostAlertsTopicArn", {
    value: topic.topicArn,
    description: "SNS topic that receives service cost guardrail notifications.",
  });
}

function buildBudgetNotification(
  topicArn: string,
  threshold: number,
  notificationType: "ACTUAL" | "FORECASTED",
): CfnBudget.NotificationWithSubscribersProperty {
  return {
    notification: {
      comparisonOperator: "GREATER_THAN",
      notificationType,
      threshold,
      thresholdType: "PERCENTAGE",
    },
    subscribers: [
      {
        address: topicArn,
        subscriptionType: "SNS",
      },
    ],
  };
}

function parseEmailSubscriptions(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function parseSmsSubscriptions(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((phoneNumber) => normalizePhoneNumber(phoneNumber))
    .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber));
}

function normalizePhoneNumber(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) {
    return null;
  }

  if (digits.startsWith("+")) {
    return digits;
  }

  const numbersOnly = digits.replace(/\D/g, "");
  if (numbersOnly.length === 10) {
    return `+1${numbersOnly}`;
  }
  if (numbersOnly.length === 11 && numbersOnly.startsWith("1")) {
    return `+${numbersOnly}`;
  }

  return null;
}
