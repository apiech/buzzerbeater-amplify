import { Duration, Stack } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { type IFunction } from "aws-cdk-lib/aws-lambda";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type OperationalRetentionBackend = {
  createStack(name: string): Stack;
  pruneOperationalData: FunctionResource;
};

export function configureOperationalRetention(
  backend: OperationalRetentionBackend,
): void {
  const stack = backend.createStack("operational-retention");
  backend.pruneOperationalData.addEnvironment(
    "SYNC_RUN_RETENTION_DAYS",
    process.env.SYNC_RUN_RETENTION_DAYS ?? "14",
  );
  backend.pruneOperationalData.addEnvironment(
    "PREDICTION_JOB_RETENTION_DAYS",
    process.env.PREDICTION_JOB_RETENTION_DAYS ?? "30",
  );

  new events.Rule(stack, "OperationalRetentionSchedule", {
    schedule: events.Schedule.rate(Duration.days(1)),
    targets: [new targets.LambdaFunction(backend.pruneOperationalData.resources.lambda)],
  });
}
