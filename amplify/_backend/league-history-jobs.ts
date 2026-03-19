import { Duration, type Stack, type RemovalPolicy } from "aws-cdk-lib";
import type { Function as LambdaFunction, IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type LeagueHistoryJobsBackend = {
  createStack(name: string): Stack;
  submitLeagueHistoryBackfill: FunctionResource;
  leagueHistoryWorker: FunctionResource;
};

export function configureLeagueHistoryJobs(
  backend: LeagueHistoryJobsBackend,
  removalPolicy: RemovalPolicy,
): void {
  const stack = backend.createStack("league-history-jobs");
  const deadLetterQueue = new Queue(stack, "LeagueHistoryBackfillDlq", {
    removalPolicy,
    retentionPeriod: Duration.days(14),
  });
  const backfillQueue = new Queue(stack, "LeagueHistoryBackfillQueue", {
    deadLetterQueue: {
      maxReceiveCount: 3,
      queue: deadLetterQueue,
    },
    removalPolicy,
    retentionPeriod: Duration.days(4),
    visibilityTimeout: Duration.minutes(6),
  });

  backend.submitLeagueHistoryBackfill.addEnvironment(
    "LEAGUE_HISTORY_BACKFILL_QUEUE_URL",
    backfillQueue.queueUrl,
  );

  backfillQueue.grantSendMessages(
    backend.submitLeagueHistoryBackfill.resources.lambda,
  );
  backfillQueue.grantConsumeMessages(backend.leagueHistoryWorker.resources.lambda);

  const workerLambda = backend.leagueHistoryWorker.resources.lambda as LambdaFunction;
  workerLambda.addEventSource(
    new SqsEventSource(backfillQueue, {
      batchSize: 5,
      reportBatchItemFailures: true,
    }),
  );
}
