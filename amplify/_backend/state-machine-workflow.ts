import type { RemovalPolicy, Stack } from "aws-cdk-lib";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";

type WorkflowOptions = {
  idPrefix: string;
  logGroupRemovalPolicy: RemovalPolicy;
  payload?: sfn.TaskInput;
  workerFunction: IFunction;
};

export function createSingleLambdaWorkflow(
  stack: Stack,
  options: WorkflowOptions,
): sfn.StateMachine {
  const logGroup = new logs.LogGroup(stack, `${options.idPrefix}Logs`, {
    removalPolicy: options.logGroupRemovalPolicy,
    retention: logs.RetentionDays.ONE_MONTH,
  });

  const invokeWorker = new tasks.LambdaInvoke(
    stack,
    `${options.idPrefix}InvokeWorker`,
    {
      lambdaFunction: options.workerFunction,
      payload: options.payload,
      payloadResponseOnly: true,
    },
  );
  invokeWorker.addCatch(new sfn.Fail(stack, `${options.idPrefix}Failed`), {
    resultPath: "$.error",
  });

  const stateMachine = new sfn.StateMachine(
    stack,
    `${options.idPrefix}StateMachine`,
    {
      definitionBody: sfn.DefinitionBody.fromChainable(invokeWorker),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ERROR,
      },
      stateMachineType: sfn.StateMachineType.STANDARD,
      tracingEnabled: true,
    },
  );

  stateMachine.applyRemovalPolicy(options.logGroupRemovalPolicy);
  return stateMachine;
}
