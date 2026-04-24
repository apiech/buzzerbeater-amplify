import { Duration, Stack, type RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";

import { RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME } from "../_shared/game-day-recap-errors.js";
import type { GameDayRecapSynthConfig } from "../_shared/synth-env.js";
import { createSingleLambdaWorkflow } from "./state-machine-workflow.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type GameDayRecapBackend = {
  gameDayRecapFailureFinalizer: FunctionResource;
  gameDayRecapSubmit: FunctionResource;
  gameDayRecapWorker: FunctionResource;
  submitLeagueGameDayRecap: FunctionResource;
  submitLeagueGameDayPerformances: FunctionResource;
  submitSingleGameSummary: FunctionResource;
};

export function configureGameDayRecapJobs(
  backend: GameDayRecapBackend,
  config: GameDayRecapSynthConfig,
  removalPolicy: RemovalPolicy,
): void {
  const submitFunctions = [
    backend.gameDayRecapSubmit,
    backend.submitLeagueGameDayRecap,
    backend.submitLeagueGameDayPerformances,
    backend.submitSingleGameSummary,
  ];
  const workflowStack = Stack.of(backend.gameDayRecapWorker.resources.lambda);
  const workflow = createSingleLambdaWorkflow(workflowStack, {
    failureFunction: backend.gameDayRecapFailureFinalizer.resources.lambda,
    idPrefix: "GameDayRecapJob",
    logGroupRemovalPolicy: removalPolicy,
    retry: {
      backoffRate: 2,
      errors: [RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME],
      interval: Duration.seconds(15),
      maxAttempts: 2,
    },
    workerFunction: backend.gameDayRecapWorker.resources.lambda,
  });

  for (const submitFunction of submitFunctions) {
    submitFunction.addEnvironment(
      "GAME_DAY_RECAP_STATE_MACHINE_ARN",
      workflow.stateMachineArn,
    );
    submitFunction.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID",
      config.defaultModelId,
    );
    if (config.premiumModelId) {
      submitFunction.addEnvironment(
        "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
        config.premiumModelId,
      );
    }
    if (config.retryModelId) {
      submitFunction.addEnvironment(
        "GAME_DAY_RECAP_RETRY_MODEL_ID",
        config.retryModelId,
      );
    }
    if (config.retryPremiumModelId) {
      submitFunction.addEnvironment(
        "GAME_DAY_RECAP_RETRY_MODEL_ID_PREMIUM",
        config.retryPremiumModelId,
      );
    }
    if (config.judgeModelId) {
      submitFunction.addEnvironment(
        "GAME_DAY_RECAP_JUDGE_MODEL_ID",
        config.judgeModelId,
      );
    }
    if (config.judgePremiumModelId) {
      submitFunction.addEnvironment(
        "GAME_DAY_RECAP_JUDGE_MODEL_ID_PREMIUM",
        config.judgePremiumModelId,
      );
    }
  }
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_MODEL_ID",
    config.defaultModelId,
  );
  if (config.premiumModelId) {
    backend.gameDayRecapWorker.addEnvironment(
      "GAME_DAY_RECAP_MODEL_ID_PREMIUM",
      config.premiumModelId,
    );
  }
  if (config.retryModelId) {
    backend.gameDayRecapWorker.addEnvironment(
      "GAME_DAY_RECAP_RETRY_MODEL_ID",
      config.retryModelId,
    );
  }
  if (config.retryPremiumModelId) {
    backend.gameDayRecapWorker.addEnvironment(
      "GAME_DAY_RECAP_RETRY_MODEL_ID_PREMIUM",
      config.retryPremiumModelId,
    );
  }
  if (config.judgeModelId) {
    backend.gameDayRecapWorker.addEnvironment(
      "GAME_DAY_RECAP_JUDGE_MODEL_ID",
      config.judgeModelId,
    );
  }
  if (config.judgePremiumModelId) {
    backend.gameDayRecapWorker.addEnvironment(
      "GAME_DAY_RECAP_JUDGE_MODEL_ID_PREMIUM",
      config.judgePremiumModelId,
    );
  }
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_ENFORCE_BANNED_STYLE_PHRASES",
    String(config.enforceBannedStylePhrases),
  );
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_CONTEXT_CONCURRENCY",
    String(config.contextConcurrency),
  );
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_JUDGE_CONCURRENCY",
    String(config.judgeConcurrency),
  );
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_POLISH_CONCURRENCY",
    String(config.polishConcurrency),
  );
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_INTERVIEW_CONCURRENCY",
    String(config.interviewConcurrency),
  );
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE",
    config.fullSlatePolishMode,
  );
  backend.gameDayRecapWorker.addEnvironment(
    "GAME_DAY_RECAP_INTERVIEW_PERSONALITY_MODE",
    config.interviewPersonalityMode,
  );

  workflow.grantStartExecution(backend.gameDayRecapSubmit.resources.lambda);
  workflow.grantStartExecution(
    backend.submitLeagueGameDayRecap.resources.lambda,
  );
  workflow.grantStartExecution(
    backend.submitLeagueGameDayPerformances.resources.lambda,
  );
  workflow.grantStartExecution(
    backend.submitSingleGameSummary.resources.lambda,
  );
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
