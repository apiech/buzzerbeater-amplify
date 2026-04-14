import type { Stack } from "aws-cdk-lib";
import { Table, type ITable } from "aws-cdk-lib/aws-dynamodb";
import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { Bucket, type IBucket } from "aws-cdk-lib/aws-s3";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";

import type { SharedInfraBindings } from "../_shared/shared-infra-contract.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type MatchStoreBackend = {
  createStack(name: string): Stack;
  clearMyTeamHighlightsData: FunctionResource;
  connectBbAccount: FunctionResource;
  disconnectBbAccount: FunctionResource;
  generateSharedPlayerCard: FunctionResource;
  getAccessibleMatch: FunctionResource;
  getAccessiblePlayByPlay: FunctionResource;
  getHomeWorkspace: FunctionResource;
  getLeagueIntel: FunctionResource;
  getLineupHelperWorkspace: FunctionResource;
  getMatchBoxscoreDetails: FunctionResource;
  getMyTeamHighlights: FunctionResource;
  getPlayerLab: FunctionResource;
  getSalaryCalculatorSeed: FunctionResource;
  getPlayerTrend: FunctionResource;
  getSalaryProjection: FunctionResource;
  listAccessibleMatches: FunctionResource;
  refreshWorkspace: FunctionResource;
  submitMyTeamHighlightsScan: FunctionResource;
};

export function configureMatchStoreIntegration(
  backend: MatchStoreBackend,
  bindings: SharedInfraBindings,
): void {
  const stack = backend.createStack("match-store-integration");
  const matchStoreBucket = Bucket.fromBucketName(
    stack,
    "ImportedMatchStoreBucket",
    bindings.matchStoreBucketName,
  );
  const matchCatalogTable = Table.fromTableName(
    stack,
    "ImportedMatchCatalogTable",
    bindings.matchCatalogTableName,
  );
  const teamMatchProjectionTable = Table.fromTableName(
    stack,
    "ImportedTeamMatchProjectionTable",
    bindings.teamMatchProjectionTableName,
  );
  const activeTrackedTeamsTable = Table.fromTableName(
    stack,
    "ImportedActiveTrackedTeamsTable",
    bindings.activeTrackedTeamsTableName,
  );
  const playerSkillSnapshotTable = Table.fromTableName(
    stack,
    "ImportedPlayerSkillSnapshotTable",
    bindings.playerSkillSnapshotTableName,
  );
  const teamMomentsTable = Table.fromTableName(
    stack,
    "ImportedTeamMomentsTable",
    bindings.teamMomentsTableName,
  );
  const teamHighlightsStatusTable = Table.fromTableName(
    stack,
    "ImportedTeamHighlightsStatusTable",
    bindings.teamHighlightsStatusTableName,
  );
  const teamHighlightsScanStateMachine = sfn.StateMachine.fromStateMachineArn(
    stack,
    "ImportedTeamHighlightsScanStateMachine",
    bindings.teamHighlightsScanStateMachineArn,
  );

  const matchStoreReadFunctions = [
    backend.listAccessibleMatches,
    backend.getAccessibleMatch,
    backend.getAccessiblePlayByPlay,
    backend.getMatchBoxscoreDetails,
  ];
  const activeTrackedTeamSyncFunctions = [
    backend.connectBbAccount,
    backend.disconnectBbAccount,
    backend.refreshWorkspace,
  ];
  const workspaceSnapshotWriteFunctions = [
    backend.connectBbAccount,
    backend.getHomeWorkspace,
    backend.getLeagueIntel,
    backend.getPlayerLab,
    backend.refreshWorkspace,
  ];
  const playerSnapshotReadFunctions = [
    backend.getLineupHelperWorkspace,
    backend.getSalaryCalculatorSeed,
    backend.getPlayerTrend,
    backend.getSalaryProjection,
    backend.generateSharedPlayerCard,
  ];
  const teamHighlightsReadFunctions = [backend.getMyTeamHighlights];
  const teamHighlightsClearFunctions = [backend.clearMyTeamHighlightsData];

  for (const resource of matchStoreReadFunctions) {
    resource.addEnvironment("MATCH_STORE_BUCKET_NAME", bindings.matchStoreBucketName);
    resource.addEnvironment(
      "MATCH_CATALOG_TABLE_NAME",
      bindings.matchCatalogTableName,
    );
    resource.addEnvironment(
      "TEAM_MATCH_PROJECTION_TABLE_NAME",
      bindings.teamMatchProjectionTableName,
    );
  }

  grantMatchStoreReadAccess(matchStoreBucket, matchCatalogTable, backend);
  teamMatchProjectionTable.grantReadData(
    backend.listAccessibleMatches.resources.lambda,
  );

  for (const resource of activeTrackedTeamSyncFunctions) {
    resource.addEnvironment(
      "ACTIVE_TRACKED_TEAMS_TABLE_NAME",
      bindings.activeTrackedTeamsTableName,
    );
    activeTrackedTeamsTable.grantReadWriteData(resource.resources.lambda);
  }

  for (const resource of workspaceSnapshotWriteFunctions) {
    resource.addEnvironment(
      "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      bindings.playerSkillSnapshotTableName,
    );
    playerSkillSnapshotTable.grantReadWriteData(resource.resources.lambda);
  }

  for (const resource of playerSnapshotReadFunctions) {
    resource.addEnvironment(
      "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      bindings.playerSkillSnapshotTableName,
    );
    playerSkillSnapshotTable.grantReadData(resource.resources.lambda);
  }

  for (const resource of teamHighlightsReadFunctions) {
    resource.addEnvironment("TEAM_MOMENTS_TABLE_NAME", bindings.teamMomentsTableName);
    resource.addEnvironment(
      "TEAM_HIGHLIGHTS_STATUS_TABLE_NAME",
      bindings.teamHighlightsStatusTableName,
    );
    teamMomentsTable.grantReadData(resource.resources.lambda);
    teamHighlightsStatusTable.grantReadData(resource.resources.lambda);
  }

  for (const resource of teamHighlightsClearFunctions) {
    resource.addEnvironment("TEAM_MOMENTS_TABLE_NAME", bindings.teamMomentsTableName);
    resource.addEnvironment(
      "TEAM_HIGHLIGHTS_STATUS_TABLE_NAME",
      bindings.teamHighlightsStatusTableName,
    );
    resource.addEnvironment(
      "TEAM_MATCH_PROJECTION_TABLE_NAME",
      bindings.teamMatchProjectionTableName,
    );
    teamMomentsTable.grantReadWriteData(resource.resources.lambda);
    teamHighlightsStatusTable.grantReadWriteData(resource.resources.lambda);
    teamMatchProjectionTable.grantReadWriteData(resource.resources.lambda);
  }

  backend.submitMyTeamHighlightsScan.addEnvironment(
    "TEAM_HIGHLIGHTS_STATUS_TABLE_NAME",
    bindings.teamHighlightsStatusTableName,
  );
  backend.submitMyTeamHighlightsScan.addEnvironment(
    "TEAM_HIGHLIGHTS_SCAN_STATE_MACHINE_ARN",
    bindings.teamHighlightsScanStateMachineArn,
  );
  teamHighlightsStatusTable.grantReadWriteData(
    backend.submitMyTeamHighlightsScan.resources.lambda,
  );
  teamHighlightsScanStateMachine.grantStartExecution(
    backend.submitMyTeamHighlightsScan.resources.lambda,
  );
}

function grantMatchStoreReadAccess(
  matchStoreBucket: IBucket,
  matchCatalogTable: ITable,
  backend: Pick<
    MatchStoreBackend,
    | "listAccessibleMatches"
    | "getAccessibleMatch"
    | "getAccessiblePlayByPlay"
    | "getMatchBoxscoreDetails"
  >,
): void {
  matchStoreBucket.grantRead(backend.listAccessibleMatches.resources.lambda);
  matchStoreBucket.grantRead(backend.getAccessibleMatch.resources.lambda);
  matchStoreBucket.grantRead(backend.getAccessiblePlayByPlay.resources.lambda);
  matchStoreBucket.grantRead(backend.getMatchBoxscoreDetails.resources.lambda);

  matchCatalogTable.grantReadData(
    backend.listAccessibleMatches.resources.lambda,
  );
  matchCatalogTable.grantReadData(backend.getAccessibleMatch.resources.lambda);
  matchCatalogTable.grantReadData(
    backend.getAccessiblePlayByPlay.resources.lambda,
  );
  matchCatalogTable.grantReadData(
    backend.getMatchBoxscoreDetails.resources.lambda,
  );
}
