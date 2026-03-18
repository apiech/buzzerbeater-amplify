import { Duration, type RemovalPolicy, type Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Function as LambdaFunction, IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";

import type { GameDayRecapSynthConfig } from "../_shared/synth-env.js";

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
  submitLeagueGameDayRecap: FunctionResource;
  submitSingleGameSummary: FunctionResource;
};

export function configureGameDayRecapJobs(
  backend: GameDayRecapBackend,
  config: GameDayRecapSynthConfig,
  removalPolicy: RemovalPolicy,
): void {
  const queueStack = backend.createStack("game-day-recap-jobs");
  const deadLetterQueue = new Queue(queueStack, "GameDayRecapDlq", {
    removalPolicy,
    retentionPeriod: Duration.days(14),
  });
  const recapJobQueue = new Queue(queueStack, "GameDayRecapQueue", {
    deadLetterQueue: {
      maxReceiveCount: 3,
      queue: deadLetterQueue,
    },
    removalPolicy,
    retentionPeriod: Duration.days(4),
    visibilityTimeout: Duration.minutes(3),
  });

  backend.gameDayRecapSubmit.addEnvironment(
    "GAME_DAY_RECAP_QUEUE_URL",
    recapJobQueue.queueUrl,
  );
  backend.gameDayRecapSubmit.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );
  if (config.premiumModelId) {
    backend.gameDayRecapSubmit.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
      config.premiumModelId,
    );
  }
  backend.submitLeagueGameDayRecap.addEnvironment(
    "GAME_DAY_RECAP_QUEUE_URL",
    recapJobQueue.queueUrl,
  );
  backend.submitLeagueGameDayRecap.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );
  if (config.premiumModelId) {
    backend.submitLeagueGameDayRecap.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
      config.premiumModelId,
    );
  }
  backend.submitSingleGameSummary.addEnvironment(
    "GAME_DAY_RECAP_QUEUE_URL",
    recapJobQueue.queueUrl,
  );
  backend.submitSingleGameSummary.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );
  if (config.premiumModelId) {
    backend.submitSingleGameSummary.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
      config.premiumModelId,
    );
  }
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );

  recapJobQueue.grantSendMessages(backend.gameDayRecapSubmit.resources.lambda);
  recapJobQueue.grantSendMessages(
    backend.submitLeagueGameDayRecap.resources.lambda,
  );
  recapJobQueue.grantSendMessages(
    backend.submitSingleGameSummary.resources.lambda,
  );
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
  workerLambda.addToRolePolicy(
    new PolicyStatement({
      actions: [
        "aws-marketplace:Subscribe",
        "aws-marketplace:Unsubscribe",
        "aws-marketplace:ViewSubscriptions",
      ],
      resources: ["*"],
      conditions: {
        StringEquals: {
          "aws:CalledViaLast": "bedrock.amazonaws.com",
        },
      },
    }),
  );
}
