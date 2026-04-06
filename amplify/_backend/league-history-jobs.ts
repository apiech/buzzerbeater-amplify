import { Stack, type RemovalPolicy } from "aws-cdk-lib";
import type { IFunction } from "aws-cdk-lib/aws-lambda";

import { createSingleLambdaWorkflow } from "./state-machine-workflow.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type LeagueHistoryJobsBackend = {
  submitLeagueHistoryBackfill: FunctionResource;
  leagueHistoryWorker: FunctionResource;
};

export function configureLeagueHistoryJobs(
  backend: LeagueHistoryJobsBackend,
  removalPolicy: RemovalPolicy,
): void {
  const stack = Stack.of(backend.leagueHistoryWorker.resources.lambda);
  const workflow = createSingleLambdaWorkflow(stack, {
    idPrefix: "LeagueHistoryBackfill",
    logGroupRemovalPolicy: removalPolicy,
    workerFunction: backend.leagueHistoryWorker.resources.lambda,
  });

  backend.submitLeagueHistoryBackfill.addEnvironment(
    "LEAGUE_HISTORY_BACKFILL_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  workflow.grantStartExecution(backend.submitLeagueHistoryBackfill.resources.lambda);
}
