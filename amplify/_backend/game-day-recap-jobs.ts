import { Duration, type Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Function as LambdaFunction, IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type GameDayRecapBackend = {
  createStack(name: string): Stack;
  gameDayRecapSubmit: FunctionResource;
  gameDayRecapWorker: FunctionResource;
};

export function configureGameDayRecapJobs(
  backend: GameDayRecapBackend,
): void {
  const queueStack = backend.createStack("game-day-recap-jobs");
  const deadLetterQueue = new Queue(queueStack, "GameDayRecapDlq", {
    retentionPeriod: Duration.days(14),
  });
  const recapJobQueue = new Queue(queueStack, "GameDayRecapQueue", {
    visibilityTimeout: Duration.minutes(3),
    retentionPeriod: Duration.days(4),
    deadLetterQueue: {
      maxReceiveCount: 3,
      queue: deadLetterQueue,
    },
  });

  const modelId = resolveGameDayRecapModelId();
  backend.gameDayRecapSubmit.addEnvironment(
    "GAME_DAY_RECAP_QUEUE_URL",
    recapJobQueue.queueUrl,
  );
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    modelId,
  );

  recapJobQueue.grantSendMessages(backend.gameDayRecapSubmit.resources.lambda);
  recapJobQueue.grantConsumeMessages(backend.gameDayRecapWorker.resources.lambda);
  const workerLambda = backend.gameDayRecapWorker.resources.lambda as LambdaFunction;
  workerLambda.addEventSource(
    new SqsEventSource(recapJobQueue, {
      batchSize: 2,
      reportBatchItemFailures: true,
    }),
  );
  workerLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: ["*"],
    }),
  );
}

function resolveGameDayRecapModelId(): string {
  const modelId = process.env.GAME_DAY_RECAP_MODEL_ID?.trim();
  if (!modelId) {
    throw new Error(
      "GAME_DAY_RECAP_MODEL_ID must be set for recap generation.",
    );
  }
  return modelId;
}
