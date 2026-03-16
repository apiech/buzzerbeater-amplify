import { env } from "$amplify/env/game-day-recap-worker";

import { processGameDayRecap } from "../data/_backend/game-day-recap";

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
  const modelId = env.GAME_DAY_RECAP_MODEL_ID;
  if (!modelId) {
    throw new Error("GAME_DAY_RECAP_MODEL_ID environment variable was not found.");
  }

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await processGameDayRecap({
        env,
        messageBody: record.body,
        modelId,
        region: env.AWS_REGION,
      });
    } catch (error) {
      console.error("Game day recap processing failed", {
        error: error instanceof Error ? error.message : String(error),
        messageId: record.messageId,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
