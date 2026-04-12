import { Stack, type RemovalPolicy } from "aws-cdk-lib";
import type { IFunction } from "aws-cdk-lib/aws-lambda";

import { createSingleLambdaWorkflow } from "./state-machine-workflow.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type RivalsJobsBackend = {
  rivalsWorker: FunctionResource;
  submitRivalsBackfill: FunctionResource;
};

export function configureRivalsJobs(
  backend: RivalsJobsBackend,
  removalPolicy: RemovalPolicy,
): void {
  const stack = Stack.of(backend.rivalsWorker.resources.lambda);
  const workflow = createSingleLambdaWorkflow(stack, {
    idPrefix: "RivalsBackfill",
    logGroupRemovalPolicy: removalPolicy,
    workerFunction: backend.rivalsWorker.resources.lambda,
  });

  backend.submitRivalsBackfill.addEnvironment(
    "RIVALS_BACKFILL_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  workflow.grantStartExecution(backend.submitRivalsBackfill.resources.lambda);
}
