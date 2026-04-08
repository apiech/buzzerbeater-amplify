export type ServiceCostGuardrail = {
  alarmThresholdUsd: number;
  autoTripMaintenance: boolean;
  budgetServiceName: string;
  budgetThresholdUsd: number;
  id: string;
  label: string;
};

export const SERVICE_COST_GUARDRAILS: readonly ServiceCostGuardrail[] = [
  {
    id: "cognito",
    label: "Cognito",
    budgetServiceName: "Amazon Cognito",
    budgetThresholdUsd: 50,
    alarmThresholdUsd: 50,
    autoTripMaintenance: false,
  },
  {
    id: "amplify",
    label: "Amplify Hosting",
    budgetServiceName: "AWS Amplify",
    budgetThresholdUsd: 50,
    alarmThresholdUsd: 50,
    autoTripMaintenance: false,
  },
  {
    id: "fargate",
    label: "Fargate",
    budgetServiceName: "AWS Fargate",
    budgetThresholdUsd: 25,
    alarmThresholdUsd: 25,
    autoTripMaintenance: false,
  },
  {
    id: "bedrock",
    label: "Bedrock",
    budgetServiceName: "Amazon Bedrock",
    budgetThresholdUsd: 50,
    alarmThresholdUsd: 50,
    autoTripMaintenance: true,
  },
  {
    id: "sagemaker",
    label: "SageMaker",
    budgetServiceName: "Amazon SageMaker",
    budgetThresholdUsd: 50,
    alarmThresholdUsd: 50,
    autoTripMaintenance: true,
  },
  {
    id: "dynamodb",
    label: "DynamoDB",
    budgetServiceName: "Amazon DynamoDB",
    budgetThresholdUsd: 25,
    alarmThresholdUsd: 25,
    autoTripMaintenance: false,
  },
  {
    id: "appsync",
    label: "AppSync",
    budgetServiceName: "AWS AppSync",
    budgetThresholdUsd: 20,
    alarmThresholdUsd: 20,
    autoTripMaintenance: true,
  },
  {
    id: "lambda",
    label: "Lambda",
    budgetServiceName: "AWS Lambda",
    budgetThresholdUsd: 20,
    alarmThresholdUsd: 20,
    autoTripMaintenance: true,
  },
  {
    id: "cloudwatch",
    label: "CloudWatch Logs",
    budgetServiceName: "AmazonCloudWatch",
    budgetThresholdUsd: 20,
    alarmThresholdUsd: 20,
    autoTripMaintenance: false,
  },
] as const;

const serviceGuardrailsById = new Map(
  SERVICE_COST_GUARDRAILS.map((guardrail) => [guardrail.id, guardrail]),
);

export function findServiceCostGuardrailById(
  id: string,
): ServiceCostGuardrail | null {
  return serviceGuardrailsById.get(id) ?? null;
}

export function parseServiceGuardrailIdFromBudgetName(
  budgetName: string,
): string | null {
  const match = budgetName.match(/^bb-([a-z0-9-]+)-monthly-cost$/i);
  return match?.[1] ?? null;
}

export function parseServiceGuardrailIdFromAlarmName(
  alarmName: string,
): string | null {
  const match = alarmName.match(/^bb-([a-z0-9-]+)-estimated-charges$/i);
  return match?.[1] ?? null;
}
