import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const resourceSource = readFileSync(
  join(repoRoot, "amplify", "data", "resource.ts"),
  "utf8",
);
const backendSource = readFileSync(
  join(repoRoot, "amplify", "backend.ts"),
  "utf8",
);
const notificationSource = readFileSync(
  join(repoRoot, "amplify", "_backend", "feedback-notifications.ts"),
  "utf8",
);

test("product feedback mutation is authenticated-only and backed by a provisioned function", () => {
  assert.match(
    resourceSource,
    /FeedbackSubmissionKind: a\.enum\(\["FEEDBACK", "FEATURE_REQUEST"\]\)/,
  );
  assert.match(resourceSource, /FeedbackSubmission: a[\s\S]*?\.model\(/);
  assert.match(
    resourceSource,
    /submitProductFeedback: a[\s\S]*?authorization\(\(allow\) => \[allow\.authenticated\(\)\]\)[\s\S]*?handler\(a\.handler\.function\(submitProductFeedback\)\)/,
  );
  assert.match(backendSource, /submitProductFeedback,/);
});

test("feedback notifications provision an SNS topic, email subscriptions, and lambda publish wiring", () => {
  assert.match(notificationSource, /new Topic\(/);
  assert.match(notificationSource, /new EmailSubscription\(/);
  assert.match(notificationSource, /grantPublish/);
  assert.match(notificationSource, /FEEDBACK_ALERTS_TOPIC_ARN/);
  assert.match(backendSource, /configureFeedbackNotifications/);
});
