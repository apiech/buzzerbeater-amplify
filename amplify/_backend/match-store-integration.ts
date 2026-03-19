import type { Stack } from "aws-cdk-lib";
import { Table, type ITable } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { Bucket, type IBucket } from "aws-cdk-lib/aws-s3";

import type { SharedInfraBindings } from "../_shared/shared-infra-contract.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type MatchStoreBackend = {
  createStack(name: string): Stack;
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
  getPlayerTrend: FunctionResource;
  getSalaryProjection: FunctionResource;
  getScoutWorkspace: FunctionResource;
  getTeamHub: FunctionResource;
  listAccessibleMatches: FunctionResource;
  refreshBbWorkspaceWorker: FunctionResource;
  refreshBbWorkspaces: FunctionResource;
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

  const matchStoreReadFunctions = [
    backend.listAccessibleMatches,
    backend.getAccessibleMatch,
    backend.getAccessiblePlayByPlay,
    backend.getMatchBoxscoreDetails,
  ];
  const workspaceSyncFunctions = [
    backend.connectBbAccount,
    backend.disconnectBbAccount,
    backend.refreshWorkspace,
    backend.getHomeWorkspace,
    backend.getTeamHub,
    backend.getScoutWorkspace,
    backend.getLeagueIntel,
    backend.getPlayerLab,
    backend.refreshBbWorkspaces,
    backend.refreshBbWorkspaceWorker,
  ];
  const playerSnapshotReadFunctions = [
    backend.getLineupHelperWorkspace,
    backend.getPlayerTrend,
    backend.getSalaryProjection,
    backend.generateSharedPlayerCard,
  ];
  const teamHighlightsFunctions = [
    backend.getMyTeamHighlights,
    backend.submitMyTeamHighlightsScan,
  ];
  const teamHighlightsReadFunctions = [backend.getMyTeamHighlights];

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

  for (const resource of workspaceSyncFunctions) {
    resource.addEnvironment(
      "ACTIVE_TRACKED_TEAMS_TABLE_NAME",
      bindings.activeTrackedTeamsTableName,
    );
    resource.addEnvironment(
      "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      bindings.playerSkillSnapshotTableName,
    );
    activeTrackedTeamsTable.grantReadWriteData(resource.resources.lambda);
    playerSkillSnapshotTable.grantReadWriteData(resource.resources.lambda);
  }

  for (const resource of playerSnapshotReadFunctions) {
    resource.addEnvironment(
      "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      bindings.playerSkillSnapshotTableName,
    );
    playerSkillSnapshotTable.grantReadData(resource.resources.lambda);
  }

  for (const resource of teamHighlightsFunctions) {
    resource.addEnvironment(
      "ACTIVE_TRACKED_TEAMS_TABLE_NAME",
      bindings.activeTrackedTeamsTableName,
    );
    activeTrackedTeamsTable.grantReadData(resource.resources.lambda);
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

  backend.submitMyTeamHighlightsScan.addEnvironment(
    "TEAM_HIGHLIGHTS_STATUS_TABLE_NAME",
    bindings.teamHighlightsStatusTableName,
  );
  backend.submitMyTeamHighlightsScan.addEnvironment(
    "TEAM_HIGHLIGHTS_SCAN_QUEUE_URL",
    bindings.teamHighlightsScanQueueUrl,
  );
  teamHighlightsStatusTable.grantReadWriteData(
    backend.submitMyTeamHighlightsScan.resources.lambda,
  );
  grantSqsSendAccessFromQueueUrl(
    stack,
    backend.submitMyTeamHighlightsScan.resources.lambda,
    bindings.teamHighlightsScanQueueUrl,
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

function grantSqsSendAccessFromQueueUrl(
  stack: Stack,
  lambda: IFunction,
  queueUrl: string,
): void {
  const parsed = new URL(queueUrl);
  const [, accountId, queueName] = parsed.pathname.split("/");
  const regionMatch = parsed.hostname.match(/^sqs[.-]([a-z0-9-]+)\./i);
  const region = regionMatch?.[1];

  if (!accountId || !queueName || !region) {
    throw new Error(
      `Unable to resolve an SQS ARN from TEAM_HIGHLIGHTS_SCAN_QUEUE_URL: ${queueUrl}`,
    );
  }

  lambda.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [
        `arn:${stack.partition}:sqs:${region}:${accountId}:${queueName}`,
      ],
    }),
  );
}
