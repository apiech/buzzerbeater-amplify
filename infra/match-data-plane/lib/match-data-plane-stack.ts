import { join } from "node:path";

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

type MatchDataPlaneStackProps = StackProps & {
  imageTag: string;
  encryptionSecret: string;
};

export class MatchDataPlaneStack extends Stack {
  constructor(scope: Construct, id: string, props: MatchDataPlaneStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "MatchDataPlaneVpc", {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, "MatchDataPlaneCluster", {
      vpc,
    });

    const bucket = new s3.Bucket(this, "MatchStoreBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const matchCatalogTable = new dynamodb.Table(this, "MatchCatalogTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "matchId",
        type: dynamodb.AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const teamMatchProjectionTable = new dynamodb.Table(
      this,
      "TeamMatchProjectionTable",
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: "teamId",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "seasonStartMatchKey",
          type: dynamodb.AttributeType.STRING,
        },
        removalPolicy: RemovalPolicy.RETAIN,
      },
    );

    const activeTrackedTeamsTable = new dynamodb.Table(
      this,
      "ActiveTrackedTeamsTable",
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: "userId",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "teamId",
          type: dynamodb.AttributeType.STRING,
        },
        removalPolicy: RemovalPolicy.RETAIN,
      },
    );

    const playerSkillSnapshotTable = new dynamodb.Table(
      this,
      "PlayerSkillSnapshotTable",
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        partitionKey: {
          name: "playerId",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: "weekKey",
          type: dynamodb.AttributeType.STRING,
        },
        removalPolicy: RemovalPolicy.RETAIN,
      },
    );

    const ingestDlq = new sqs.Queue(this, "MatchIngestDlq", {
      retentionPeriod: Duration.days(14),
    });
    const ingestQueue = new sqs.Queue(this, "MatchIngestQueue", {
      visibilityTimeout: Duration.minutes(10),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: ingestDlq,
      },
    });

    const materializeDlq = new sqs.Queue(this, "MatchMaterializeDlq", {
      retentionPeriod: Duration.days(14),
    });
    const materializeQueue = new sqs.Queue(this, "MatchMaterializeQueue", {
      visibilityTimeout: Duration.minutes(10),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: materializeDlq,
      },
    });

    const repository = new ecr.Repository(this, "MatchDataPlaneRepository", {
      repositoryName: "bb-match-data-plane",
      imageScanOnPush: true,
    });

    const commonEnvironment = {
      MATCH_STORE_BUCKET_NAME: bucket.bucketName,
      MATCH_CATALOG_TABLE_NAME: matchCatalogTable.tableName,
      TEAM_MATCH_PROJECTION_TABLE_NAME: teamMatchProjectionTable.tableName,
      ACTIVE_TRACKED_TEAMS_TABLE_NAME: activeTrackedTeamsTable.tableName,
      MATCH_INGEST_QUEUE_URL: ingestQueue.queueUrl,
      MATCH_MATERIALIZE_QUEUE_URL: materializeQueue.queueUrl,
      PLAYER_SKILL_SNAPSHOT_TABLE_NAME: playerSkillSnapshotTable.tableName,
      MATCH_STORE_LATEST_MANIFEST_KEY: "derived/manifests/latest.json",
      BB_CONNECTION_ENCRYPTION_SECRET: props.encryptionSecret,
    };

    const logGroup = new logs.LogGroup(this, "MatchDataPlaneLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const discoveryTask = this.createTaskDefinition(
      "DiscoverTask",
      repository,
      props.imageTag,
      logGroup,
      commonEnvironment,
      ["discover"],
    );
    const playerSnapshotTask = this.createTaskDefinition(
      "PlayerSnapshotTask",
      repository,
      props.imageTag,
      logGroup,
      commonEnvironment,
      ["snapshot-players"],
    );
    activeTrackedTeamsTable.grantReadData(discoveryTask.taskRole);
    activeTrackedTeamsTable.grantReadData(playerSnapshotTask.taskRole);
    playerSkillSnapshotTable.grantReadWriteData(playerSnapshotTask.taskRole);

    ingestQueue.grantSendMessages(discoveryTask.taskRole);

    const ingestFunction = new lambda.DockerImageFunction(
      this,
      "MatchIngestWorker",
      {
        code: lambda.DockerImageCode.fromImageAsset(
          join(__dirname, "..", "..", "..", ".."),
          {
            file: "bb-machine-learning/apps/match_data_plane/Dockerfile.lambda",
            cmd: ["apps.match_data_plane.lambda_handlers.ingest_handler"],
            exclude: ["bb-amplify", "bb-amplify/**", ".git", ".git/**"],
          },
        ),
        timeout: Duration.minutes(5),
        memorySize: 2048,
        environment: commonEnvironment,
      },
    );
    const materializeFunction = new lambda.DockerImageFunction(
      this,
      "MatchMaterializeWorker",
      {
        code: lambda.DockerImageCode.fromImageAsset(
          join(__dirname, "..", "..", "..", ".."),
          {
            file: "bb-machine-learning/apps/match_data_plane/Dockerfile.lambda",
            cmd: ["apps.match_data_plane.lambda_handlers.materialize_handler"],
            exclude: ["bb-amplify", "bb-amplify/**", ".git", ".git/**"],
          },
        ),
        timeout: Duration.minutes(5),
        memorySize: 2048,
        environment: commonEnvironment,
      },
    );

    bucket.grantReadWrite(ingestFunction);
    bucket.grantReadWrite(materializeFunction);
    matchCatalogTable.grantReadWriteData(ingestFunction);
    matchCatalogTable.grantReadWriteData(materializeFunction);
    teamMatchProjectionTable.grantReadWriteData(ingestFunction);
    activeTrackedTeamsTable.grantReadData(ingestFunction);
    playerSkillSnapshotTable.grantReadWriteData(materializeFunction);
    ingestQueue.grantConsumeMessages(ingestFunction);
    materializeQueue.grantSendMessages(ingestFunction);
    materializeQueue.grantConsumeMessages(materializeFunction);

    ingestFunction.addEventSource(
      new SqsEventSource(ingestQueue, {
        batchSize: 5,
        maxConcurrency: 5,
        reportBatchItemFailures: true,
      }),
    );
    materializeFunction.addEventSource(
      new SqsEventSource(materializeQueue, {
        batchSize: 5,
        maxConcurrency: 5,
        reportBatchItemFailures: true,
      }),
    );

    // EventBridge Rules use UTC. `10:00` lines up with 6:00 AM America/New_York during DST.
    new events.Rule(this, "MatchDiscoverySchedule", {
      schedule: events.Schedule.cron({
        weekDay: "WED,THU,FRI,SAT,SUN",
        hour: "10",
        minute: "0",
      }),
      targets: [
        new targets.EcsTask({
          cluster,
          taskDefinition: discoveryTask,
          subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
          assignPublicIp: true,
        }),
      ],
    });

    new events.Rule(this, "PlayerSnapshotSchedule", {
      schedule: events.Schedule.cron({
        weekDay: "MON",
        hour: "10",
        minute: "0",
      }),
      targets: [
        new targets.EcsTask({
          cluster,
          taskDefinition: playerSnapshotTask,
          subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
          assignPublicIp: true,
        }),
      ],
    });

    new CfnOutput(this, "MatchStoreBucketName", {
      value: bucket.bucketName,
    });
    new CfnOutput(this, "MatchCatalogTableName", {
      value: matchCatalogTable.tableName,
    });
    new CfnOutput(this, "TeamMatchProjectionTableName", {
      value: teamMatchProjectionTable.tableName,
    });
    new CfnOutput(this, "ActiveTrackedTeamsTableName", {
      value: activeTrackedTeamsTable.tableName,
    });
    new CfnOutput(this, "PlayerSkillSnapshotTableName", {
      value: playerSkillSnapshotTable.tableName,
    });
    new CfnOutput(this, "MatchIngestQueueUrl", {
      value: ingestQueue.queueUrl,
    });
    new CfnOutput(this, "MatchMaterializeQueueUrl", {
      value: materializeQueue.queueUrl,
    });
    new CfnOutput(this, "MatchDataPlaneRepositoryUri", {
      value: repository.repositoryUri,
    });
  }

  private createTaskDefinition(
    id: string,
    repository: ecr.Repository,
    imageTag: string,
    logGroup: logs.LogGroup,
    environment: Record<string, string>,
    command: string[],
  ): ecs.FargateTaskDefinition {
    const taskDefinition = new ecs.FargateTaskDefinition(this, id, {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    taskDefinition.addContainer("match-data", {
      image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
      command,
      environment,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "match-data-plane",
        logGroup,
      }),
    });

    return taskDefinition;
  }
}
