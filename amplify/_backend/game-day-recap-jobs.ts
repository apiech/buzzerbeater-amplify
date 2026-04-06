import { Stack, type RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";

import type { GameDayRecapSynthConfig } from "../_shared/synth-env.js";
import { createSingleLambdaWorkflow } from "./state-machine-workflow.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type GameDayRecapBackend = {
  gameDayRecapSubmit: FunctionResource;
  gameDayRecapWorker: FunctionResource;
  submitLeagueGameDayRecap: FunctionResource;
  submitSingleGameSummary: FunctionResource;
};

export function configureGameDayRecapJobs(
  backend: GameDayRecapBackend,
  config: GameDayRecapSynthConfig,
  removalPolicy: RemovalPolicy,
): void {
  const workflowStack = Stack.of(backend.gameDayRecapWorker.resources.lambda);
  const workflow = createSingleLambdaWorkflow(workflowStack, {
    idPrefix: "GameDayRecapJob",
    logGroupRemovalPolicy: removalPolicy,
    workerFunction: backend.gameDayRecapWorker.resources.lambda,
  });

  backend.gameDayRecapSubmit.addEnvironment(
    "GAME_DAY_RECAP_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  backend.gameDayRecapSubmit.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );
  if (config.premiumModelId) {
    backend.gameDayRecapSubmit.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
      config.premiumModelId,
    );
  }
  backend.submitLeagueGameDayRecap.addEnvironment(
    "GAME_DAY_RECAP_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  backend.submitLeagueGameDayRecap.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );
  if (config.premiumModelId) {
    backend.submitLeagueGameDayRecap.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
      config.premiumModelId,
    );
  }
  backend.submitSingleGameSummary.addEnvironment(
    "GAME_DAY_RECAP_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  backend.submitSingleGameSummary.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );
  if (config.premiumModelId) {
    backend.submitSingleGameSummary.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
      config.premiumModelId,
    );
  }
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );

  workflow.grantStartExecution(backend.gameDayRecapSubmit.resources.lambda);
  workflow.grantStartExecution(backend.submitLeagueGameDayRecap.resources.lambda);
  workflow.grantStartExecution(backend.submitSingleGameSummary.resources.lambda);
  const workerLambda = backend.gameDayRecapWorker.resources.lambda;
  workerLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: ["*"],
    }),
  );
  workerLambda.addToRolePolicy(
    new PolicyStatement({
      actions: [
        "aws-marketplace:Subscribe",
        "aws-marketplace:Unsubscribe",
        "aws-marketplace:ViewSubscriptions",
      ],
      resources: ["*"],
      conditions: {
        StringEquals: {
          "aws:CalledViaLast": "bedrock.amazonaws.com",
        },
      },
    }),
  );
}
