import { Duration, Stack } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Function as LambdaFunction, type IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";

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

const DEFAULT_STALE_AFTER_HOURS = "24";
const DEFAULT_MAX_USERS_PER_RUN = "50";
const DEFAULT_DEDUPE_BY_TEAM = "false";
const DEFAULT_WORKER_CONCURRENCY = 5;

export function configureRefreshJobs(backend: RefreshJobsBackend): void {
  const stack = backend.createStack("refresh-jobs");
  const deadLetterQueue = new Queue(stack, "WorkspaceRefreshJobDlq", {
    retentionPeriod: Duration.days(14),
  });
  const refreshQueue = new Queue(stack, "WorkspaceRefreshJobQueue", {
    visibilityTimeout: Duration.minutes(5),
    retentionPeriod: Duration.days(4),
    deadLetterQueue: {
      maxReceiveCount: 3,
      queue: deadLetterQueue,
    },
  });

  backend.refreshBbWorkspaces.addEnvironment(
    "REFRESH_WORKSPACE_JOB_QUEUE_URL",
    refreshQueue.queueUrl,
  );
  backend.refreshBbWorkspaces.addEnvironment(
    "WORKSPACE_REFRESH_STALE_AFTER_HOURS",
    process.env.WORKSPACE_REFRESH_STALE_AFTER_HOURS ?? DEFAULT_STALE_AFTER_HOURS,
  );
  backend.refreshBbWorkspaces.addEnvironment(
    "WORKSPACE_REFRESH_MAX_USERS_PER_RUN",
    process.env.WORKSPACE_REFRESH_MAX_USERS_PER_RUN ?? DEFAULT_MAX_USERS_PER_RUN,
  );
  backend.refreshBbWorkspaces.addEnvironment(
    "WORKSPACE_REFRESH_DEDUPE_BY_TEAM",
    process.env.WORKSPACE_REFRESH_DEDUPE_BY_TEAM ?? DEFAULT_DEDUPE_BY_TEAM,
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
    process.env.WORKSPACE_REFRESH_STALE_AFTER_HOURS ?? DEFAULT_STALE_AFTER_HOURS,
  );
  workerLambda.addEnvironment(
    "WORKSPACE_REFRESH_MAX_USERS_PER_RUN",
    process.env.WORKSPACE_REFRESH_MAX_USERS_PER_RUN ?? DEFAULT_MAX_USERS_PER_RUN,
  );

  // Keep the schedule in the Lambda's owning stack to avoid a nested-stack cycle.
  const scheduleStack = Stack.of(backend.refreshBbWorkspaces.resources.lambda);
  new events.Rule(scheduleStack, "WorkspaceRefreshSchedule", {
    schedule: events.Schedule.rate(Duration.hours(6)),
    targets: [new targets.LambdaFunction(backend.refreshBbWorkspaces.resources.lambda)],
  });
}
