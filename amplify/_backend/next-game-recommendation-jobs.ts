import { Stack, type RemovalPolicy } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";

import type { SharedInfraBindings } from "../_shared/shared-infra-contract.js";
import { createSingleLambdaWorkflow } from "./state-machine-workflow.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type NextGameRecommendationBackend = {
  nextGameRecommendationSubmit: FunctionResource;
  nextGameRecommendationWorker: FunctionResource;
};

export function configureNextGameRecommendationJobs(
  backend: NextGameRecommendationBackend,
  bindings: Pick<
    SharedInfraBindings,
    "playerSkillSnapshotTableName" | "predictionEndpointName"
  >,
  removalPolicy: RemovalPolicy,
): void {
  const workflowStack = Stack.of(backend.nextGameRecommendationWorker.resources.lambda);
  const playerSkillSnapshotTable = Table.fromTableName(
    workflowStack,
    "ImportedPlayerSkillSnapshotTableForNextGameRecommendation",
    bindings.playerSkillSnapshotTableName,
  );
  const workflow = createSingleLambdaWorkflow(workflowStack, {
    idPrefix: "NextGameRecommendationJob",
    logGroupRemovalPolicy: removalPolicy,
    workerFunction: backend.nextGameRecommendationWorker.resources.lambda,
  });

  backend.nextGameRecommendationSubmit.addEnvironment(
    "NEXT_GAME_RECOMMENDATION_JOB_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  backend.nextGameRecommendationWorker.addEnvironment(
    "PREDICTION_ENDPOINT_NAME",
    bindings.predictionEndpointName,
  );
  backend.nextGameRecommendationWorker.addEnvironment(
    "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
    bindings.playerSkillSnapshotTableName,
  );

  workflow.grantStartExecution(
    backend.nextGameRecommendationSubmit.resources.lambda,
  );
  playerSkillSnapshotTable.grantReadData(
    backend.nextGameRecommendationWorker.resources.lambda,
  );

  const workerLambda = backend.nextGameRecommendationWorker.resources.lambda;
  const workerStack = Stack.of(workerLambda);
  workerLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["sagemaker:InvokeEndpoint"],
      resources: [
        workerStack.formatArn({
          resource: "endpoint",
          resourceName: bindings.predictionEndpointName,
          service: "sagemaker",
        }),
      ],
    }),
  );
}
