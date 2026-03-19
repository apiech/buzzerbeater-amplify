import { Duration, Stack, type RemovalPolicy } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Function as LambdaFunction, IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";

import type { SharedInfraBindings } from "../_shared/shared-infra-contract.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type OpponentForecastBackend = {
  createStack(name: string): Stack;
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

  const queueStack = backend.createStack("opponent-forecast-jobs");
  const playerSkillSnapshotTable = Table.fromTableName(
    queueStack,
    "ImportedPlayerSkillSnapshotTableForOpponentForecast",
    bindings.playerSkillSnapshotTableName,
  );
  const deadLetterQueue = new Queue(queueStack, "OpponentForecastJobDlq", {
    removalPolicy,
    retentionPeriod: Duration.days(14),
  });
  const opponentForecastJobQueue = new Queue(
    queueStack,
    "OpponentForecastJobQueue",
    {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: deadLetterQueue,
      },
      removalPolicy,
      retentionPeriod: Duration.days(4),
      visibilityTimeout: Duration.minutes(4),
    },
  );

  backend.opponentForecastSubmit.addEnvironment(
    "OPPONENT_FORECAST_JOB_QUEUE_URL",
    opponentForecastJobQueue.queueUrl,
  );
  backend.opponentForecastWorker.addEnvironment(
    "OPPONENT_FORECAST_ENDPOINT_NAME",
    bindings.opponentForecastEndpointName,
  );
  backend.opponentForecastWorker.addEnvironment(
    "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
    bindings.playerSkillSnapshotTableName,
  );

  opponentForecastJobQueue.grantSendMessages(
    backend.opponentForecastSubmit.resources.lambda,
  );
  opponentForecastJobQueue.grantConsumeMessages(
    backend.opponentForecastWorker.resources.lambda,
  );
  playerSkillSnapshotTable.grantReadWriteData(
    backend.opponentForecastWorker.resources.lambda,
  );

  const workerLambda = backend.opponentForecastWorker.resources.lambda as LambdaFunction;
  workerLambda.addEventSource(
    new SqsEventSource(opponentForecastJobQueue, {
      batchSize: 3,
      reportBatchItemFailures: true,
    }),
  );

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
