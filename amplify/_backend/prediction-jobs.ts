import { Duration, Stack, type RemovalPolicy } from "aws-cdk-lib";
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

type PredictionBackend = {
  createStack(name: string): Stack;
  predictionSubmit: FunctionResource;
  predictionWorker: FunctionResource;
};

export function configurePredictionJobs(
  backend: PredictionBackend,
  bindings: Pick<SharedInfraBindings, "predictionEndpointName">,
  removalPolicy: RemovalPolicy,
): void {
  const queueStack = backend.createStack("prediction-jobs");
  const deadLetterQueue = new Queue(queueStack, "PredictionJobDlq", {
    removalPolicy,
    retentionPeriod: Duration.days(14),
  });
  const predictionJobQueue = new Queue(queueStack, "PredictionJobQueue", {
    deadLetterQueue: {
      maxReceiveCount: 3,
      queue: deadLetterQueue,
    },
    removalPolicy,
    retentionPeriod: Duration.days(4),
    visibilityTimeout: Duration.minutes(3),
  });

  backend.predictionSubmit.addEnvironment(
    "PREDICTION_JOB_QUEUE_URL",
    predictionJobQueue.queueUrl,
  );
  backend.predictionWorker.addEnvironment(
    "PREDICTION_ENDPOINT_NAME",
    bindings.predictionEndpointName,
  );

  predictionJobQueue.grantSendMessages(backend.predictionSubmit.resources.lambda);
  predictionJobQueue.grantConsumeMessages(backend.predictionWorker.resources.lambda);
  const workerLambda = backend.predictionWorker.resources.lambda as LambdaFunction;
  workerLambda.addEventSource(
    new SqsEventSource(predictionJobQueue, {
      batchSize: 5,
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
          resourceName: bindings.predictionEndpointName,
          service: "sagemaker",
        }),
      ],
    }),
  );
}
