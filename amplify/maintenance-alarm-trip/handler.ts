import { env } from "$amplify/env/maintenance-alarm-trip";

import { activateMaintenance } from "../../lib/maintenance/control-plane";
import { parseCostAlertMessage } from "../../lib/maintenance/alarm-events";

type SnsEvent = {
  Records?: Array<{
    Sns?: {
      Message?: string;
    };
  }>;
};

export const handler = async (
  event: SnsEvent,
): Promise<{ processedRecords: number; trippedCount: number }> => {
  let processedRecords = 0;
  let trippedCount = 0;

  for (const record of event.Records ?? []) {
    processedRecords += 1;
    const message = record.Sns?.Message;
    if (!message) {
      continue;
    }

    const parsedAlert = parseCostAlertMessage(message);
    if (!parsedAlert) {
      continue;
    }

    const result = await activateMaintenance({
      activatedBy: "maintenance-alarm-trip",
      detail: parsedAlert.detail,
      env,
      headline: `${parsedAlert.guardrail.label} budget protection triggered`,
      reasonCode: "BUDGET_GUARDRAIL",
      source: "ALARM",
      triggerId: parsedAlert.triggerId,
      triggerService: parsedAlert.triggerService,
    });
    if (result.changed) {
      trippedCount += 1;
    }
  }

  return {
    processedRecords,
    trippedCount,
  };
};
