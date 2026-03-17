import { env } from "$amplify/env/refresh-bb-workspaces";
import {
  SendMessageBatchCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

import {
  listStaleConnectedUsers,
} from "../_backend/workspace";

type RuntimeEnv = Record<string, string | undefined>;

export const handler = async (): Promise<{
  enqueuedUsers: number;
  staleCandidates: number;
}> => {
  const runtimeEnv = env as RuntimeEnv;
  const staleAfterHours = parsePositiveInteger(
    runtimeEnv["WORKSPACE_REFRESH_STALE_AFTER_HOURS"],
    24,
  );
  const maxUsers = parsePositiveInteger(
    runtimeEnv["WORKSPACE_REFRESH_MAX_USERS_PER_RUN"],
    50,
  );
  const dedupeByTeam = runtimeEnv["WORKSPACE_REFRESH_DEDUPE_BY_TEAM"] === "true";
  const queueUrl = runtimeEnv["REFRESH_WORKSPACE_JOB_QUEUE_URL"];
  if (!queueUrl) {
    throw new Error("REFRESH_WORKSPACE_JOB_QUEUE_URL is not configured.");
  }
  const connections = await listStaleConnectedUsers({
    env,
    staleAfterHours,
    maxUsers,
    dedupeByTeam,
  });

  if (!connections.length) {
    return {
      enqueuedUsers: 0,
      staleCandidates: 0,
    };
  }

  const sqs = new SQSClient({});
  for (let index = 0; index < connections.length; index += 10) {
    const batch = connections.slice(index, index + 10);
    const response = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((connection) => ({
          Id: connection.userId,
          MessageBody: JSON.stringify({
            userId: connection.userId,
            teamId: connection.teamId ?? null,
          }),
        })),
      }),
    );
    if ((response.Failed ?? []).length) {
      throw new Error(
        `Workspace refresh enqueue failed for ${response.Failed?.map((entry) => entry.Id ?? "unknown").join(", ")}`,
      );
    }
  }

  return {
    enqueuedUsers: connections.length,
    staleCandidates: connections.length,
  };
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
