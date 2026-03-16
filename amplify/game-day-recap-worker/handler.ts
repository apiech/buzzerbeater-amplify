import { env } from "$amplify/env/game-day-recap-worker";

import {
  parseGameDayRecapQueueMessage,
  processGameDayRecap,
} from "../data/_backend/game-day-recap";

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
  console.info("[game-day-recap-worker] batch.received", {
    messageIds: event.Records.map((record) => record.messageId),
    recordCount: event.Records.length,
  });
  const modelId = env.GAME_DAY_RECAP_MODEL_ID;
  if (!modelId) {
    throw new Error("GAME_DAY_RECAP_MODEL_ID environment variable was not found.");
  }

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  // Retry failed recap jobs individually instead of replaying the full SQS batch.
  for (const record of event.Records) {
    const parsedMessage = safeParseQueueMessage(record.body);
    console.info("[game-day-recap-worker] record.start", {
      messageId: record.messageId,
      requestedAt: parsedMessage?.requestedAt ?? null,
      targetKey: parsedMessage?.targetKey ?? null,
      userId: parsedMessage?.userId ?? null,
    });
    try {
      await processGameDayRecap({
        env,
        messageBody: record.body,
        modelId,
        region: env.AWS_REGION,
      });
      console.info("[game-day-recap-worker] record.succeeded", {
        messageId: record.messageId,
        targetKey: parsedMessage?.targetKey ?? null,
      });
    } catch (error) {
      console.error("Game day recap processing failed", {
        error: error instanceof Error ? error.message : String(error),
        messageId: record.messageId,
        requestedAt: parsedMessage?.requestedAt ?? null,
        targetKey: parsedMessage?.targetKey ?? null,
        userId: parsedMessage?.userId ?? null,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

function safeParseQueueMessage(messageBody: string) {
  try {
    return parseGameDayRecapQueueMessage(messageBody);
  } catch {
    return null;
  }
}
