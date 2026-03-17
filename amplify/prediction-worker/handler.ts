import { env } from "$amplify/env/prediction-worker";

import { processPredictionJob } from "../data/_backend/prediction";

type SqsRecord = {
  messageId: string;
  body: string;
};

type SqsEvent = {
  Records: SqsRecord[];
};
type RuntimeEnv = Record<string, string | undefined>;

export const handler = async (
  event: SqsEvent,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  const endpointName = (env as RuntimeEnv)["PREDICTION_ENDPOINT_NAME"];
  if (!endpointName) {
    throw new Error("Prediction endpoint name environment variable was not found.");
  }

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      await processPredictionJob({
        env,
        endpointName,
        messageBody: record.body,
      });
    } catch (error) {
      console.error("Prediction job processing failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
