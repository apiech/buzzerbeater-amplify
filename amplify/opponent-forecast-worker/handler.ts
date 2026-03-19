import { env } from "$amplify/env/opponent-forecast-worker";

import { processOpponentForecastJob } from "../data/_backend/opponent-forecast";

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
  const endpointName = (env as RuntimeEnv)["OPPONENT_FORECAST_ENDPOINT_NAME"];
  if (!endpointName) {
    throw new Error(
      "Opponent forecast endpoint name environment variable was not found.",
    );
  }

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      await processOpponentForecastJob({
        env,
        endpointName,
        messageBody: record.body,
      });
    } catch (error) {
      console.error("Opponent forecast job processing failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
