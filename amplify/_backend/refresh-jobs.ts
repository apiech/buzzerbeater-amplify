import { Duration, Stack, type RemovalPolicy } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import type { Function as LambdaFunction, IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";

import type { RefreshJobsSynthConfig } from "../_shared/synth-env.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type RefreshJobsBackend = {
  createStack(name: string): Stack;
  refreshBbWorkspaces: FunctionResource;
  refreshBbWorkspaceWorker: FunctionResource;
};

const DEFAULT_WORKER_CONCURRENCY = 5;

export function configureRefreshJobs(
  backend: RefreshJobsBackend,
  config: RefreshJobsSynthConfig,
  removalPolicy: RemovalPolicy,
): void {
  const stack = backend.createStack("refresh-jobs");
  const deadLetterQueue = new Queue(stack, "WorkspaceRefreshJobDlq", {
    removalPolicy,
    retentionPeriod: Duration.days(14),
  });
  const refreshQueue = new Queue(stack, "WorkspaceRefreshJobQueue", {
    deadLetterQueue: {
      maxReceiveCount: 3,
      queue: deadLetterQueue,
    },
    removalPolicy,
    retentionPeriod: Duration.days(4),
    visibilityTimeout: Duration.minutes(5),
  });

  backend.refreshBbWorkspaces.addEnvironment(
    "REFRESH_WORKSPACE_JOB_QUEUE_URL",
    refreshQueue.queueUrl,
  );
  backend.refreshBbWorkspaces.addEnvironment(
    "WORKSPACE_REFRESH_STALE_AFTER_HOURS",
    config.staleAfterHours,
  );
  backend.refreshBbWorkspaces.addEnvironment(
    "WORKSPACE_REFRESH_MAX_USERS_PER_RUN",
    config.maxUsersPerRun,
  );
  backend.refreshBbWorkspaces.addEnvironment(
    "WORKSPACE_REFRESH_DEDUPE_BY_TEAM",
    config.dedupeByTeam,
  );

  refreshQueue.grantSendMessages(backend.refreshBbWorkspaces.resources.lambda);
  refreshQueue.grantConsumeMessages(backend.refreshBbWorkspaceWorker.resources.lambda);

  const workerLambda = backend.refreshBbWorkspaceWorker.resources.lambda as LambdaFunction;
  workerLambda.addEventSource(
    new SqsEventSource(refreshQueue, {
      batchSize: 5,
      maxConcurrency: DEFAULT_WORKER_CONCURRENCY,
      reportBatchItemFailures: true,
    }),
  );
  workerLambda.addEnvironment(
    "WORKSPACE_REFRESH_STALE_AFTER_HOURS",
    config.staleAfterHours,
  );
  workerLambda.addEnvironment(
    "WORKSPACE_REFRESH_MAX_USERS_PER_RUN",
    config.maxUsersPerRun,
  );

  const scheduleStack = Stack.of(backend.refreshBbWorkspaces.resources.lambda);
  new events.Rule(scheduleStack, "WorkspaceRefreshSchedule", {
    schedule: events.Schedule.rate(Duration.hours(6)),
    targets: [new targets.LambdaFunction(backend.refreshBbWorkspaces.resources.lambda)],
  });
}
