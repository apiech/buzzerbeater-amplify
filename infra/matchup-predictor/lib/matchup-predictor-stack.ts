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
    servingImage.repository.grantPull(executionRole);
    modelTarball.grantRead(executionRole);
    logGroup.grantWrite(executionRole);

    const model = new sagemaker.CfnModel(this, "PredictorModel", {
      executionRoleArn: executionRole.roleArn,
      primaryContainer: {
        image: servingImage.imageUri,
        modelDataUrl: modelTarball.s3ObjectUrl,
      },
    });

    const endpointConfig = new sagemaker.CfnEndpointConfig(
      this,
      "EndpointConfig",
      {
        productionVariants: [
          {
            modelName: model.ref,
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
      endpointConfigName: endpointConfig.ref,
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
