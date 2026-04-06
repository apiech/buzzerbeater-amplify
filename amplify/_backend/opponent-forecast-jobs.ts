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

type OpponentForecastBackend = {
  opponentForecastSubmit: FunctionResource;
  opponentForecastWorker: FunctionResource;
};

export function configureOpponentForecastJobs(
  backend: OpponentForecastBackend,
  bindings: Pick<
    SharedInfraBindings,
    "opponentForecastEndpointName" | "playerSkillSnapshotTableName"
  >,
  removalPolicy: RemovalPolicy,
): void {
  if (!bindings.opponentForecastEndpointName) {
    console.warn(
      [
        "Shared ML infra opponent forecast endpoint is not configured.",
        "Skipping opponent forecast job wiring until the endpoint is deployed and published to SSM.",
      ].join(" "),
    );
    return;
  }

  const workflowStack = Stack.of(backend.opponentForecastWorker.resources.lambda);
  const playerSkillSnapshotTable = Table.fromTableName(
    workflowStack,
    "ImportedPlayerSkillSnapshotTableForOpponentForecast",
    bindings.playerSkillSnapshotTableName,
  );
  const workflow = createSingleLambdaWorkflow(workflowStack, {
    idPrefix: "OpponentForecastJob",
    logGroupRemovalPolicy: removalPolicy,
    workerFunction: backend.opponentForecastWorker.resources.lambda,
  });

  backend.opponentForecastSubmit.addEnvironment(
    "OPPONENT_FORECAST_JOB_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  backend.opponentForecastWorker.addEnvironment(
    "OPPONENT_FORECAST_ENDPOINT_NAME",
    bindings.opponentForecastEndpointName,
  );
  backend.opponentForecastWorker.addEnvironment(
    "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
    bindings.playerSkillSnapshotTableName,
  );

  workflow.grantStartExecution(backend.opponentForecastSubmit.resources.lambda);
  playerSkillSnapshotTable.grantReadWriteData(
    backend.opponentForecastWorker.resources.lambda,
  );

  const workerLambda = backend.opponentForecastWorker.resources.lambda;
  const workerStack = Stack.of(workerLambda);
  workerLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["sagemaker:InvokeEndpoint"],
      resources: [
        workerStack.formatArn({
          resource: "endpoint",
          resourceName: bindings.opponentForecastEndpointName,
          service: "sagemaker",
        }),
      ],
    }),
  );
}
