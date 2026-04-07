import { Duration, Stack } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { type IFunction } from "aws-cdk-lib/aws-lambda";

import type { OperationalRetentionSynthConfig } from "../_shared/synth-env.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type OperationalRetentionBackend = {
  pruneOperationalData: FunctionResource;
};

export function configureOperationalRetention(
  backend: OperationalRetentionBackend,
  config: OperationalRetentionSynthConfig,
): void {
  const stack = Stack.of(backend.pruneOperationalData.resources.lambda);
  backend.pruneOperationalData.addEnvironment(
    "SYNC_RUN_RETENTION_DAYS",
    config.syncRunRetentionDays,
  );

  new events.Rule(stack, "OperationalRetentionSchedule", {
    schedule: events.Schedule.rate(Duration.days(1)),
    targets: [new targets.LambdaFunction(backend.pruneOperationalData.resources.lambda)],
  });
}
