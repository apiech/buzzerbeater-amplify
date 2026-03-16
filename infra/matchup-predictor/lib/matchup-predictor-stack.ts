import { join } from "node:path";

import {
  BundlingOutput,
  CfnOutput,
  DockerImage,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import * as sagemaker from "aws-cdk-lib/aws-sagemaker";
import type { Construct } from "constructs";

export type MatchupPredictorStage = "dev" | "prod";

type MatchupPredictorStackProps = StackProps & {
  stage: MatchupPredictorStage;
  modelVersion?: string;
  modelTarballPath?: string;
};

const ENDPOINT_MEMORY_SIZE_MB = 2048;
const ENDPOINT_MAX_CONCURRENCY = 10;

export class MatchupPredictorStack extends Stack {
  constructor(scope: Construct, id: string, props: MatchupPredictorStackProps) {
    super(scope, id, props);

    const machineLearningRoot = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "bb-machine-learning",
    );
    const endpointName = `bb-matchup-predictor-${props.stage}`;

    const servingImage = new DockerImageAsset(this, "ServingImage", {
      directory: machineLearningRoot,
      file: "apps/matchup_predictor/serverless/Dockerfile.sagemaker",
      platform: Platform.LINUX_AMD64,
      exclude: [
        ".git",
        ".venv-codex",
        ".venv-codex312",
        "venv",
        "__pycache__",
        "tests",
      ],
    });

    const modelTarball = props.modelTarballPath
      ? new s3assets.Asset(this, "ModelTarball", {
          path: props.modelTarballPath,
        })
      : new s3assets.Asset(this, "ModelTarball", {
          path: machineLearningRoot,
          bundling: {
            image: DockerImage.fromRegistry("python:3.12-slim"),
            outputType: BundlingOutput.ARCHIVED,
            workingDirectory: "/asset-input",
            command: [
              "python",
              "-m",
              "apps.matchup_predictor.serverless.build_cdk_asset",
              "--output-dir",
              "/asset-output",
              ...(props.modelVersion
                ? ["--version", props.modelVersion]
                : []),
            ],
          },
        });

    const logGroup = new logs.LogGroup(this, "EndpointLogGroup", {
      logGroupName: `/aws/sagemaker/Endpoints/${endpointName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("sagemaker.amazonaws.com"),
    });
    const executionRolePolicy = new iam.Policy(this, "ExecutionRolePolicy", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:BatchGetImage",
            "ecr:DescribeImages",
            "ecr:GetDownloadUrlForLayer",
          ],
          resources: [servingImage.repository.repositoryArn],
        }),
        new iam.PolicyStatement({
          actions: ["ecr:GetAuthorizationToken"],
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          actions: ["s3:GetBucket*", "s3:List*"],
          resources: [modelTarball.bucket.bucketArn],
        }),
        new iam.PolicyStatement({
          actions: ["s3:GetObject*"],
          resources: [modelTarball.bucket.arnForObjects(modelTarball.s3ObjectKey)],
        }),
        new iam.PolicyStatement({
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
        }),
      ],
    });
    executionRolePolicy.attachToRole(executionRole);
    const assetNameSuffix = `${modelTarball.assetHash.slice(0, 8)}-${servingImage.assetHash.slice(0, 8)}`;
    const predictorModelName = `bb-matchup-predictor-${props.stage}-mdl-${assetNameSuffix}`;
    const endpointConfigName = `bb-matchup-predictor-${props.stage}-cfg-${assetNameSuffix}`;

    const model = new sagemaker.CfnModel(this, "PredictorModel", {
      modelName: predictorModelName,
      executionRoleArn: executionRole.roleArn,
      primaryContainer: {
        image: servingImage.imageUri,
        modelDataUrl: modelTarball.s3ObjectUrl,
      },
    });
    model.addDependency(executionRolePolicy.node.defaultChild as iam.CfnPolicy);

    const endpointConfig = new sagemaker.CfnEndpointConfig(
      this,
      "EndpointConfig",
      {
        endpointConfigName,
        productionVariants: [
          {
            modelName: model.attrModelName,
            variantName: "AllTraffic",
            serverlessConfig: {
              maxConcurrency: ENDPOINT_MAX_CONCURRENCY,
              memorySizeInMb: ENDPOINT_MEMORY_SIZE_MB,
            },
          },
        ],
      },
    );

    const endpoint = new sagemaker.CfnEndpoint(this, "Endpoint", {
      endpointName,
      endpointConfigName: endpointConfig.attrEndpointConfigName,
    });
    endpoint.addDependency(endpointConfig);
    endpointConfig.addDependency(model);

    new CfnOutput(this, "MatchupPredictorEndpointName", {
      value: endpointName,
    });
    new CfnOutput(this, "MatchupPredictorEndpointArn", {
      value: this.formatArn({
        service: "sagemaker",
        resource: "endpoint",
        resourceName: endpointName,
      }),
    });
  }
}
