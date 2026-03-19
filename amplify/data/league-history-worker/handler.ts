import { env } from "$amplify/env/league-history-worker";

import { processLeagueHistoryBackfill } from "../_backend/league-history";

type SqsRecord = {
  body: string;
  messageId: string;
};

type SqsEvent = {
  Records: SqsRecord[];
};

export const handler = async (
  event: SqsEvent,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      await processLeagueHistoryBackfill({
        env,
        messageBody: record.body,
      });
    } catch (error) {
      console.error("League history backfill failed", {
        error: error instanceof Error ? error.message : String(error),
        messageId: record.messageId,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
