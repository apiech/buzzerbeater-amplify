import { Stack, type RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";

import type { SharedInfraBindings } from "../_shared/shared-infra-contract.js";
import { resolveSharedEnvironmentName } from "../_shared/synth-env.js";

export const leagueSeasonSimulationPlannerConcurrencyEnvName =
  "LEAGUE_SEASON_SIMULATION_PLANNER_CONCURRENCY";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type LeagueSeasonSimulationBackend = {
  getLatestLeagueSeasonSimulation: FunctionResource;
  leagueSeasonSimulationFailureFinalizer: FunctionResource;
  leagueSeasonSimulationSubmit: FunctionResource;
  leagueSeasonSimulationWorker: FunctionResource;
};

export function resolveLeagueSeasonSimulationPlannerConcurrency(
  sharedEnvironmentName: string,
): number {
  return sharedEnvironmentName.startsWith("sandbox-") ? 1 : 2;
}

export function configureLeagueSeasonSimulationJobs(
  backend: LeagueSeasonSimulationBackend,
  bindings: Pick<SharedInfraBindings, "predictionEndpointName">,
  removalPolicy: RemovalPolicy,
): void {
  const sharedEnvironmentName = resolveSharedEnvironmentName();
  const workflowStack = Stack.of(
    backend.leagueSeasonSimulationWorker.resources.lambda,
  );
  const workflow = createLeagueSeasonSimulationWorkflow(
    workflowStack,
    backend.leagueSeasonSimulationWorker.resources.lambda,
    backend.leagueSeasonSimulationFailureFinalizer.resources.lambda,
    removalPolicy,
  );

  backend.leagueSeasonSimulationSubmit.addEnvironment(
    "LEAGUE_SEASON_SIMULATION_JOB_STATE_MACHINE_ARN",
    workflow.stateMachineArn,
  );
  backend.leagueSeasonSimulationWorker.addEnvironment(
    "PREDICTION_ENDPOINT_NAME",
    bindings.predictionEndpointName,
  );
  backend.leagueSeasonSimulationWorker.addEnvironment(
    leagueSeasonSimulationPlannerConcurrencyEnvName,
    String(
      resolveLeagueSeasonSimulationPlannerConcurrency(sharedEnvironmentName),
    ),
  );

  workflow.grantStartExecution(
    backend.leagueSeasonSimulationSubmit.resources.lambda,
  );
  workflow.grantRead(backend.getLatestLeagueSeasonSimulation.resources.lambda);

  const workerLambda = backend.leagueSeasonSimulationWorker.resources.lambda;
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

function createLeagueSeasonSimulationWorkflow(
  stack: Stack,
  workerFunction: IFunction,
  failureFunction: IFunction,
  removalPolicy: RemovalPolicy,
): sfn.StateMachine {
  const logGroup = new logs.LogGroup(stack, "LeagueSeasonSimulationJobLogs", {
    removalPolicy,
    retention: logs.RetentionDays.ONE_MONTH,
  });
  const failedState = new sfn.Fail(stack, "LeagueSeasonSimulationJobFailed");
  const catchTarget = new tasks.LambdaInvoke(
    stack,
    "LeagueSeasonSimulationJobFinalizeFailure",
    {
      lambdaFunction: failureFunction,
      payloadResponseOnly: true,
    },
  ).next(failedState);

  const prepareContext = addFailureCatch(
    newWorkerActionTask(stack, workerFunction, "PrepareContext", {
      action: "PREPARE_CONTEXT",
    }),
    catchTarget,
  );
  const collectSnapshots = addFailureCatch(
    newWorkerActionTask(stack, workerFunction, "CollectSnapshotsChunk", {
      action: "COLLECT_SNAPSHOTS_CHUNK",
      nextTeamIndex: sfn.JsonPath.numberAt("$.nextTeamIndex"),
    }),
    catchTarget,
  );
  const finalizeSnapshots = addFailureCatch(
    newWorkerActionTask(stack, workerFunction, "FinalizeSnapshots", {
      action: "FINALIZE_SNAPSHOTS",
    }),
    catchTarget,
  );
  const scoreGames = addFailureCatch(
    newWorkerActionTask(stack, workerFunction, "ScoreGamesChunk", {
      action: "SCORE_GAMES_CHUNK",
      nextGameIndex: sfn.JsonPath.numberAt("$.nextGameIndex"),
    }),
    catchTarget,
  );
  const runMonteCarlo = addFailureCatch(
    newWorkerActionTask(stack, workerFunction, "RunMonteCarlo", {
      action: "RUN_MONTE_CARLO",
    }),
    catchTarget,
  );

  const snapshotChoice = new sfn.Choice(stack, "SnapshotsComplete?");
  const scoringChoice = new sfn.Choice(stack, "ScoringComplete?");

  prepareContext
    .next(collectSnapshots)
    .next(
      snapshotChoice
        .when(
          sfn.Condition.booleanEquals("$.snapshotsComplete", false),
          collectSnapshots,
        )
        .otherwise(finalizeSnapshots),
    );
  finalizeSnapshots
    .next(scoreGames)
    .next(
      scoringChoice
        .when(
          sfn.Condition.booleanEquals("$.scoringComplete", false),
          scoreGames,
        )
        .otherwise(runMonteCarlo),
    );

  const stateMachine = new sfn.StateMachine(
    stack,
    "LeagueSeasonSimulationJobStateMachine",
    {
      definitionBody: sfn.DefinitionBody.fromChainable(prepareContext),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ERROR,
      },
      stateMachineType: sfn.StateMachineType.STANDARD,
      tracingEnabled: true,
    },
  );
  stateMachine.applyRemovalPolicy(removalPolicy);
  return stateMachine;
}

function newWorkerActionTask(
  stack: Stack,
  workerFunction: IFunction,
  id: string,
  input: Record<string, unknown>,
): tasks.LambdaInvoke {
  return new tasks.LambdaInvoke(stack, `LeagueSeasonSimulationJob${id}`, {
    lambdaFunction: workerFunction,
    payload: sfn.TaskInput.fromObject({
      ...input,
      jobId: sfn.JsonPath.stringAt("$.jobId"),
      userId: sfn.JsonPath.stringAt("$.userId"),
    }),
    payloadResponseOnly: true,
  });
}

function addFailureCatch<TTask extends tasks.LambdaInvoke>(
  task: TTask,
  catchTarget: sfn.IChainable,
): TTask {
  task.addCatch(catchTarget, {
    resultPath: "$.error",
  });
  return task;
}
