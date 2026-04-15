import { randomUUID } from "node:crypto";

import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

import {
  createFeedbackSubmission,
  getBbConnection,
  updateFeedbackSubmission,
} from "./repository";
import { resolveUserId } from "./workspace-connection";
import type { Schema } from "../resource";

type GraphqlEnv = Record<string, string | undefined>;
type GraphqlIdentity = {
  claims?: Record<string, unknown>;
  sub?: string;
  username?: string;
};
type SubmitProductFeedbackResult = NonNullable<
  Schema["submitProductFeedback"]["returnType"]
>;
type FeedbackSubmissionKind = NonNullable<
  NonNullable<Schema["submitProductFeedback"]["args"]>["kind"]
>;

type FeedbackRuntime = {
  createFeedbackSubmission: typeof createFeedbackSubmission;
  getBbConnection: typeof getBbConnection;
  publishFeedbackNotification: (
    input: FeedbackNotificationInput,
  ) => Promise<void>;
  updateFeedbackSubmission: typeof updateFeedbackSubmission;
};

type FeedbackNotificationInput = {
  email: string | null;
  env: GraphqlEnv;
  kind: FeedbackSubmissionKind;
  message: string;
  subject: string;
  submissionId: string;
  submittedAt: string;
  teamId: string | null;
  teamName: string | null;
  userId: string;
  username: string | null;
};

const MAX_MESSAGE_LENGTH = 2000;
const MAX_SUBJECT_LENGTH = 120;
const defaultRuntime: FeedbackRuntime = {
  createFeedbackSubmission,
  getBbConnection,
  publishFeedbackNotification,
  updateFeedbackSubmission,
};

export const __testing = {
  buildNotificationMessage,
  buildNotificationSubject,
  normalizeFeedbackKind,
};

export async function submitProductFeedback(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    kind: string;
    message: string;
    subject: string;
  },
  runtime: FeedbackRuntime = defaultRuntime,
): Promise<SubmitProductFeedbackResult> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const kind = normalizeFeedbackKind(args.kind);
  const subject = normalizeRequiredString(
    args.subject,
    "Subject",
    MAX_SUBJECT_LENGTH,
  );
  const message = normalizeRequiredString(
    args.message,
    "Details",
    MAX_MESSAGE_LENGTH,
  );
  const identityMetadata = resolveIdentityMetadata(args.identity);
  const connection = await runtime.getBbConnection(args.env, userId);
  const submissionId = randomUUID();
  const submittedAt = new Date().toISOString();

  await runtime.createFeedbackSubmission(args.env, {
    email: identityMetadata.email,
    id: submissionId,
    kind,
    message,
    notificationError: null,
    notifiedAt: null,
    subject,
    submittedAt,
    teamId: connection?.teamId ?? null,
    teamName: connection?.teamName ?? null,
    userId,
    username: identityMetadata.username,
  });

  try {
    await runtime.publishFeedbackNotification({
      email: identityMetadata.email,
      env: args.env,
      kind,
      message,
      subject,
      submissionId,
      submittedAt,
      teamId: connection?.teamId ?? null,
      teamName: connection?.teamName ?? null,
      userId,
      username: identityMetadata.username,
    });

    void persistNotificationState(runtime, args.env, {
      id: submissionId,
      notificationError: null,
      notifiedAt: new Date().toISOString(),
    });

    return {
      id: submissionId,
      notified: true,
      submittedAt,
    };
  } catch (error) {
    void persistNotificationState(runtime, args.env, {
      id: submissionId,
      notificationError: readNotificationError(error),
      notifiedAt: null,
    });

    return {
      id: submissionId,
      notified: false,
      submittedAt,
    };
  }
}

async function persistNotificationState(
  runtime: FeedbackRuntime,
  env: GraphqlEnv,
  input: {
    id: string;
    notificationError: string | null;
    notifiedAt: string | null;
  },
): Promise<void> {
  try {
    await runtime.updateFeedbackSubmission(env, input);
  } catch {
    // Best-effort metadata updates should not prompt users to resubmit.
  }
}

function normalizeFeedbackKind(value: string): FeedbackSubmissionKind {
  if (value === "FEEDBACK" || value === "FEATURE_REQUEST") {
    return value;
  }

  throw new Error("Feedback type is invalid.");
}

function normalizeRequiredString(
  value: string,
  label: "Details" | "Subject",
  maxLength: number,
): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveIdentityMetadata(identity: unknown): {
  email: string | null;
  username: string | null;
} {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    return {
      email: null,
      username: null,
    };
  }

  const typedIdentity = identity as GraphqlIdentity;
  const claims = typedIdentity.claims;
  const email = normalizeOptionalString(claims?.email);
  const username =
    normalizeOptionalString(typedIdentity.username) ??
    normalizeOptionalString(claims?.["cognito:username"]) ??
    normalizeOptionalString(claims?.username) ??
    normalizeOptionalString(claims?.preferred_username) ??
    normalizeOptionalString(claims?.name);

  return {
    email,
    username,
  };
}

async function publishFeedbackNotification(
  input: FeedbackNotificationInput,
): Promise<void> {
  const topicArn = normalizeOptionalString(input.env.FEEDBACK_ALERTS_TOPIC_ARN);
  if (!topicArn) {
    throw new Error("Feedback alerts topic is not configured.");
  }

  const snsClient = new SNSClient({
    region:
      normalizeOptionalString(input.env.AWS_REGION) ??
      normalizeOptionalString(input.env.AWS_DEFAULT_REGION) ??
      "us-east-1",
  });

  await snsClient.send(
    new PublishCommand({
      Message: buildNotificationMessage(input),
      Subject: buildNotificationSubject(input.kind, input.subject),
      TopicArn: topicArn,
    }),
  );
}

function buildNotificationSubject(
  kind: FeedbackSubmissionKind,
  subject: string,
): string {
  const prefix = kind === "FEATURE_REQUEST" ? "Feature request" : "Feedback";
  return `[BB Coach] ${prefix}: ${subject}`.slice(0, 100);
}

function buildNotificationMessage(input: FeedbackNotificationInput): string {
  return [
    "A logged-in user submitted product feedback.",
    "",
    `Type: ${formatKindLabel(input.kind)}`,
    `Submitted: ${input.submittedAt}`,
    `Submission id: ${input.submissionId}`,
    `User id: ${input.userId}`,
    `Username: ${input.username ?? "Unavailable"}`,
    `Email: ${input.email ?? "Unavailable"}`,
    `Team: ${input.teamName ?? "Unavailable"}${input.teamId ? ` (${input.teamId})` : ""}`,
    "",
    `Subject: ${input.subject}`,
    "",
    "Details:",
    input.message,
  ].join("\n");
}

function formatKindLabel(value: FeedbackSubmissionKind): string {
  return value === "FEATURE_REQUEST" ? "Feature request" : "Feedback";
}

function readNotificationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
