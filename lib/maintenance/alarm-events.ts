import {
  findServiceCostGuardrailById,
  parseServiceGuardrailIdFromAlarmName,
  parseServiceGuardrailIdFromBudgetName,
  type ServiceCostGuardrail,
} from "../../amplify/_backend/cost-guardrails";

export type ParsedCostAlert = {
  detail: string;
  guardrail: ServiceCostGuardrail;
  triggerId: string;
  triggerService: string;
};

export function parseCostAlertMessage(message: string): ParsedCostAlert | null {
  const payload = parseJsonRecord(message);
  if (!payload) {
    return null;
  }

  return (
    parseCloudWatchAlarmMessage(payload) ??
    parseBudgetNotificationMessage(payload) ??
    null
  );
}

function parseBudgetNotificationMessage(
  payload: Record<string, unknown>,
): ParsedCostAlert | null {
  const budgetName =
    readString(payload, "budgetName") ??
    readString(payload, "BudgetName") ??
    readString(payload, "budget_name");
  if (!budgetName) {
    return null;
  }

  const serviceId = parseServiceGuardrailIdFromBudgetName(budgetName);
  if (!serviceId) {
    return null;
  }

  const guardrail = findServiceCostGuardrailById(serviceId);
  if (!guardrail?.autoTripMaintenance) {
    return null;
  }

  const notificationType =
    readString(payload, "notificationType") ??
    readString(payload, "NotificationType") ??
    "BUDGET";
  const limit =
    readString(payload, "budgetLimit") ??
    readString(payload, "BudgetLimit") ??
    `${guardrail.budgetThresholdUsd} USD`;

  return {
    detail: `${guardrail.label} budget notification ${notificationType} reached the ${limit} guardrail.`,
    guardrail,
    triggerId: budgetName,
    triggerService: guardrail.label,
  };
}

function parseCloudWatchAlarmMessage(
  payload: Record<string, unknown>,
): ParsedCostAlert | null {
  const alarmName = readString(payload, "AlarmName");
  const stateValue = readString(payload, "NewStateValue");
  if (!alarmName || stateValue !== "ALARM") {
    return null;
  }

  const serviceId = parseServiceGuardrailIdFromAlarmName(alarmName);
  if (!serviceId) {
    return null;
  }

  const guardrail = findServiceCostGuardrailById(serviceId);
  if (!guardrail?.autoTripMaintenance) {
    return null;
  }

  return {
    detail: `${guardrail.label} estimated charges alarm ${alarmName} entered ALARM.`,
    guardrail,
    triggerId: alarmName,
    triggerService: guardrail.label,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
