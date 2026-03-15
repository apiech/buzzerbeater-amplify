import { Stack } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table, type ITable } from "aws-cdk-lib/aws-dynamodb";
import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { Bucket, type IBucket } from "aws-cdk-lib/aws-s3";

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
  getMatchBoxscoreDetails: FunctionResource;
  getPlayerTrend: FunctionResource;
  getPlayerLab: FunctionResource;
  getSalaryProjection: FunctionResource;
  getScoutWorkspace: FunctionResource;
  getTeamHub: FunctionResource;
  listAccessibleMatches: FunctionResource;
  refreshBbWorkspaces: FunctionResource;
  refreshBbWorkspaceWorker: FunctionResource;
  refreshWorkspace: FunctionResource;
};

type ExternalMatchStoreConfig = {
  bucketName: string;
  catalogTableName: string;
  projectionTableName: string;
  activeTrackedTeamsTableName: string;
  playerSkillSnapshotTableName: string;
};

export function configureMatchStoreIntegration(backend: MatchStoreBackend): void {
  const stack = backend.createStack("match-store-integration");
  const externalConfig = resolveExternalMatchStoreConfig();

  const matchStoreBucket = externalConfig
    ? Bucket.fromBucketName(
        stack,
        "ImportedMatchStoreBucket",
        externalConfig.bucketName,
      )
    : new Bucket(stack, "MatchStoreBucket");
  const matchCatalogTable = externalConfig
    ? Table.fromTableName(
        stack,
        "ImportedMatchCatalogTable",
        externalConfig.catalogTableName,
      )
    : new Table(stack, "MatchCatalogTable", {
        billingMode: BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: "matchId",
          type: AttributeType.STRING,
        },
      });
  const teamMatchProjectionTable = externalConfig
    ? Table.fromTableName(
        stack,
        "ImportedTeamMatchProjectionTable",
        externalConfig.projectionTableName,
      )
    : new Table(stack, "TeamMatchProjectionTable", {
        billingMode: BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: "teamId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "seasonStartMatchKey",
          type: AttributeType.STRING,
        },
      });
  const activeTrackedTeamsTable = externalConfig
    ? Table.fromTableName(
        stack,
        "ImportedActiveTrackedTeamsTable",
        externalConfig.activeTrackedTeamsTableName,
      )
    : new Table(stack, "ActiveTrackedTeamsTable", {
        billingMode: BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: "userId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "teamId",
          type: AttributeType.STRING,
        },
      });
  const playerSkillSnapshotTable = externalConfig
    ? Table.fromTableName(
        stack,
        "ImportedPlayerSkillSnapshotTable",
        externalConfig.playerSkillSnapshotTableName,
      )
    : new Table(stack, "PlayerSkillSnapshotTable", {
        billingMode: BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: "playerId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "weekKey",
          type: AttributeType.STRING,
        },
      });

  const matchStoreBucketName =
    externalConfig?.bucketName ?? matchStoreBucket.bucketName;
  const matchCatalogTableName =
    externalConfig?.catalogTableName ?? matchCatalogTable.tableName;
  const teamMatchProjectionTableName =
    externalConfig?.projectionTableName ?? teamMatchProjectionTable.tableName;
  const activeTrackedTeamsTableName =
    externalConfig?.activeTrackedTeamsTableName ??
    activeTrackedTeamsTable.tableName;
  const playerSkillSnapshotTableName =
    externalConfig?.playerSkillSnapshotTableName ??
    playerSkillSnapshotTable.tableName;

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
    backend.getPlayerTrend,
    backend.getSalaryProjection,
    backend.generateSharedPlayerCard,
  ];

  for (const resource of matchStoreReadFunctions) {
    resource.addEnvironment("MATCH_STORE_BUCKET_NAME", matchStoreBucketName);
    resource.addEnvironment("MATCH_CATALOG_TABLE_NAME", matchCatalogTableName);
    resource.addEnvironment(
      "TEAM_MATCH_PROJECTION_TABLE_NAME",
      teamMatchProjectionTableName,
    );
  }

  grantMatchStoreReadAccess(matchStoreBucket, matchCatalogTable, backend);
  teamMatchProjectionTable.grantReadData(backend.listAccessibleMatches.resources.lambda);

  for (const resource of workspaceSyncFunctions) {
    resource.addEnvironment(
      "ACTIVE_TRACKED_TEAMS_TABLE_NAME",
      activeTrackedTeamsTableName,
    );
    resource.addEnvironment(
      "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      playerSkillSnapshotTableName,
    );
    activeTrackedTeamsTable.grantReadWriteData(resource.resources.lambda);
    playerSkillSnapshotTable.grantReadWriteData(resource.resources.lambda);
  }

  for (const resource of playerSnapshotReadFunctions) {
    resource.addEnvironment(
      "PLAYER_SKILL_SNAPSHOT_TABLE_NAME",
      playerSkillSnapshotTableName,
    );
    playerSkillSnapshotTable.grantReadData(resource.resources.lambda);
  }
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

  matchCatalogTable.grantReadData(backend.listAccessibleMatches.resources.lambda);
  matchCatalogTable.grantReadData(backend.getAccessibleMatch.resources.lambda);
  matchCatalogTable.grantReadData(backend.getAccessiblePlayByPlay.resources.lambda);
  matchCatalogTable.grantReadData(backend.getMatchBoxscoreDetails.resources.lambda);
}

function resolveExternalMatchStoreConfig(): ExternalMatchStoreConfig | null {
  const bucketName = process.env.MATCH_STORE_BUCKET_NAME;
  const catalogTableName = process.env.MATCH_CATALOG_TABLE_NAME;
  const projectionTableName = process.env.TEAM_MATCH_PROJECTION_TABLE_NAME;
  const activeTrackedTeamsTableName = process.env.ACTIVE_TRACKED_TEAMS_TABLE_NAME;
  const playerSkillSnapshotTableName = process.env.PLAYER_SKILL_SNAPSHOT_TABLE_NAME;

  const values = [
    bucketName,
    catalogTableName,
    projectionTableName,
    activeTrackedTeamsTableName,
    playerSkillSnapshotTableName,
  ];

  if (values.every((value) => !value)) {
    return null;
  }

  if (values.some((value) => !value)) {
    throw new Error(
      "When configuring the external match data plane, MATCH_STORE_BUCKET_NAME, MATCH_CATALOG_TABLE_NAME, TEAM_MATCH_PROJECTION_TABLE_NAME, ACTIVE_TRACKED_TEAMS_TABLE_NAME, and PLAYER_SKILL_SNAPSHOT_TABLE_NAME must all be set.",
    );
  }

  return {
    bucketName: bucketName!,
    catalogTableName: catalogTableName!,
    projectionTableName: projectionTableName!,
    activeTrackedTeamsTableName: activeTrackedTeamsTableName!,
    playerSkillSnapshotTableName: playerSkillSnapshotTableName!,
  };
}
