import assert from "node:assert/strict";
import test from "node:test";

import { parseCostAlertMessage } from "../lib/maintenance/alarm-events";

test("alarm parser recognizes auto-trip CloudWatch alarms for request-driven services", () => {
  const parsed = parseCostAlertMessage(
    JSON.stringify({
      AlarmName: "bb-bedrock-estimated-charges",
      NewStateValue: "ALARM",
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.guardrail.id, "bedrock");
  assert.equal(parsed.triggerId, "bb-bedrock-estimated-charges");
  assert.match(parsed.detail, /Bedrock estimated charges alarm/i);
});

test("alarm parser recognizes budget notifications for request-driven services", () => {
  const parsed = parseCostAlertMessage(
    JSON.stringify({
      budgetName: "bb-appsync-monthly-cost",
      budgetLimit: "20 USD",
      notificationType: "FORECASTED",
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.guardrail.id, "appsync");
  assert.equal(parsed.triggerService, "AppSync");
  assert.match(parsed.detail, /FORECASTED/i);
});

test("alarm parser ignores notify-only guardrails and malformed payloads", () => {
  assert.equal(
    parseCostAlertMessage(
      JSON.stringify({
        AlarmName: "bb-cloudwatch-estimated-charges",
        NewStateValue: "ALARM",
      }),
    ),
    null,
  );
  assert.equal(parseCostAlertMessage("not json"), null);
});
