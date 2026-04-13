import { Stack, type RemovalPolicy } from "aws-cdk-lib";
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

type PredictionBackend = {
  evaluatePredictionMatrix: FunctionResource;
  predictionSubmit: FunctionResource;
  predictionWorker: FunctionResource;
};

export function configurePredictionJobs(
  backend: PredictionBackend,
  bindings: Pick<SharedInfraBindings, "predictionEndpointName">,
  removalPolicy: RemovalPolicy,
): void {
  const workflowStack = Stack.of(backend.predictionWorker.resources.lambda);
  const workflow = createSingleLambdaWorkflow(workflowStack, {
    idPrefix: "PredictionJob",
    logGroupRemovalPolicy: removalPolicy,
    workerFunction: backend.predictionWorker.resources.lambda,
  });

  backend.predictionSubmit.addEnvironment(
    "PREDICTION_JOB_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  backend.predictionWorker.addEnvironment(
    "PREDICTION_ENDPOINT_NAME",
    bindings.predictionEndpointName,
  );
  backend.evaluatePredictionMatrix.addEnvironment(
    "PREDICTION_ENDPOINT_NAME",
    bindings.predictionEndpointName,
  );

  workflow.grantStartExecution(backend.predictionSubmit.resources.lambda);

  const workerLambda = backend.predictionWorker.resources.lambda;
  const workerStack = Stack.of(workerLambda);
  const endpointArn = workerStack.formatArn({
    resource: "endpoint",
    resourceName: bindings.predictionEndpointName,
    service: "sagemaker",
  });
  workerLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["sagemaker:InvokeEndpoint"],
      resources: [endpointArn],
    }),
  );
  backend.evaluatePredictionMatrix.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["sagemaker:InvokeEndpoint"],
      resources: [endpointArn],
    }),
  );
}
