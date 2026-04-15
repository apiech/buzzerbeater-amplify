import assert from "node:assert/strict";
import test from "node:test";

import { submitProductFeedback } from "../amplify/data/_backend/product-feedback";

test("submitProductFeedback stores identity and team context and marks successful notifications", async () => {
  let createdRecord: Record<string, unknown> | null = null;
  let updatedRecord: Record<string, unknown> | null = null;
  let publishedInput: Record<string, unknown> | null = null;

  const result = await submitProductFeedback(
    {
      env: {},
      identity: {
        claims: {
          "cognito:username": "coach-k",
          email: "coach@example.com",
        },
        sub: "user-1",
      },
      kind: "FEATURE_REQUEST",
      message: "Please add a quicker way to open feedback from the sidebar.",
      subject: "Feedback shortcut",
    },
    {
      createFeedbackSubmission: async (_env, record) => {
        createdRecord = record as Record<string, unknown>;
        return record;
      },
      getBbConnection: async () =>
        ({
          bbLoginName: "coach-k",
          status: "CONNECTED",
          teamId: "163730",
          teamName: "Visionaries",
        }) as any,
      publishFeedbackNotification: async (input) => {
        publishedInput = input as unknown as Record<string, unknown>;
      },
      updateFeedbackSubmission: async (_env, record) => {
        updatedRecord = record as Record<string, unknown>;
      },
    },
  );

  assert.ok(createdRecord);
  assert.equal(createdRecord["id"], result.id);
  assert.equal(createdRecord["userId"], "user-1");
  assert.equal(createdRecord["email"], "coach@example.com");
  assert.equal(createdRecord["username"], "coach-k");
  assert.equal(createdRecord["teamId"], "163730");
  assert.equal(createdRecord["teamName"], "Visionaries");
  assert.equal(createdRecord["subject"], "Feedback shortcut");
  assert.equal(
    createdRecord["message"],
    "Please add a quicker way to open feedback from the sidebar.",
  );
  assert.ok(publishedInput);
  assert.equal(publishedInput["submissionId"], result.id);
  assert.equal(publishedInput["teamName"], "Visionaries");
  assert.equal(result.notified, true);
  assert.ok(updatedRecord);
  assert.equal(updatedRecord["id"], result.id);
  assert.equal(updatedRecord["notificationError"], null);
  assert.equal(typeof updatedRecord["notifiedAt"], "string");
});

test("submitProductFeedback keeps the saved record when notification delivery fails", async () => {
  let createdRecord: Record<string, unknown> | null = null;
  let updatedRecord: Record<string, unknown> | null = null;

  const result = await submitProductFeedback(
    {
      env: {},
      identity: {
        claims: {
          email: "coach@example.com",
          preferred_username: "coach-k",
        },
        sub: "user-2",
      },
      kind: "FEEDBACK",
      message: "The form spacing feels cramped on mobile.",
      subject: "Mobile spacing",
    },
    {
      createFeedbackSubmission: async (_env, record) => {
        createdRecord = record as Record<string, unknown>;
        return record;
      },
      getBbConnection: async () => null,
      publishFeedbackNotification: async () => {
        throw new Error("SNS publish failed");
      },
      updateFeedbackSubmission: async (_env, record) => {
        updatedRecord = record as Record<string, unknown>;
      },
    },
  );

  assert.ok(createdRecord);
  assert.equal(createdRecord["id"], result.id);
  assert.equal(result.notified, false);
  assert.ok(updatedRecord);
  assert.equal(updatedRecord["id"], result.id);
  assert.equal(updatedRecord["notifiedAt"], null);
  assert.equal(updatedRecord["notificationError"], "SNS publish failed");
});
