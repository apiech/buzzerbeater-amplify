import type { SQSEvent, SQSBatchResponse } from "aws-lambda";

import { env } from "$amplify/env/refresh-bb-workspace-worker";

import { getOrRefreshWorkspace } from "../_backend/workspace";

export const handler = async (
  event: SQSEvent,
): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const message = parseMessage(record.body);
      await getOrRefreshWorkspace({
        env,
        identity: { sub: message.userId },
        force: true,
        syncActiveTrackedTeams: true,
      });
    } catch (error) {
      console.error("Queued BB workspace refresh failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  return { batchItemFailures };
};

function parseMessage(body: string): { userId: string } {
  const parsed = JSON.parse(body) as { userId?: string };
  if (typeof parsed.userId !== "string" || !parsed.userId.trim()) {
    throw new Error("Refresh workspace queue messages must include a userId.");
  }
  return {
    userId: parsed.userId,
  };
}
