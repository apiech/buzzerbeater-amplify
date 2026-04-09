import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  CloudFormationClient,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  buildBbConnectionSecretParameterPaths,
  buildSharedInfraParameterPaths,
  branchToEnvironmentName,
} from "../amplify/_shared/shared-infra-contract.js";
import {
  decryptValue,
  isEncryptedValueDecryptionFailure,
  resolveBbConnectionSecretState,
} from "../amplify/data/_backend/encryption.js";
import type { ActiveTrackedTeamRecord } from "../amplify/data/_backend/active-tracked-teams.js";
import type { BbCredentialRecord } from "../amplify/data/_backend/repository.js";

const DEFAULT_REGION = "us-east-1";

type ParsedArgs = {
  appId: string;
  bbCredentialTableName: string | null;
  branchName: string;
  dryRun: boolean;
  environmentName: string;
  region: string;
};

type BackfillSummary = {
  activeTrackedTeamsMissingCredential: number;
  activeTrackedTeamsScanned: number;
  activeTrackedTeamsSkippedUndecryptable: number;
  activeTrackedTeamsUpdated: number;
  bbCredentialsScanned: number;
  bbCredentialsSkippedUndecryptable: number;
  bbCredentialsUpdated: number;
  changed: boolean;
};

type AwsCliRuntime = {
  execAwsJson: (args: string[]) => unknown;
  write: (message: string) => void;
};

type BackfillRuntime = AwsCliRuntime & {
  createCloudFormationClient: (region: string) => CloudFormationClient;
  createDocumentClient: (region: string) => DynamoDBDocumentClient;
  createSsmClient: (region: string) => SSMClient;
};

const runtime: BackfillRuntime = {
  createCloudFormationClient: (region) => new CloudFormationClient({ region }),
  createDocumentClient: (region) =>
    DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    }),
  createSsmClient: (region) => new SSMClient({ region }),
  execAwsJson: (args) =>
    JSON.parse(
      execFileSync("aws", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as unknown,
  write: (message) => process.stdout.write(message),
};

export const __testing = {
  findNestedStackArn,
  findOnlyDynamoTableName,
  parseArgs,
  resolveEnvironmentName,
};

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const summary = await backfillBbConnectionSecretFingerprints(args, runtime);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): ParsedArgs {
  let appId = normalizeOptionalString(env.AWS_APP_ID);
  let bbCredentialTableName: string | null = null;
  let branchName = normalizeOptionalString(env.AWS_BRANCH);
  let environmentName = normalizeOptionalString(env.BB_SHARED_ENVIRONMENT_NAME);
  let region = normalizeOptionalString(env.AWS_REGION) ?? DEFAULT_REGION;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    switch (argument) {
      case "--app-id":
        appId = normalizeOptionalString(readOptionValue(argv, ++index, "--app-id"));
        break;
      case "--bb-credential-table-name":
        bbCredentialTableName = normalizeOptionalString(
          readOptionValue(argv, ++index, "--bb-credential-table-name"),
        );
        break;
      case "--branch":
        branchName = normalizeOptionalString(
          readOptionValue(argv, ++index, "--branch"),
        );
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--environment":
        environmentName = normalizeOptionalString(
          readOptionValue(argv, ++index, "--environment"),
        );
        break;
      case "--region":
        region =
          normalizeOptionalString(readOptionValue(argv, ++index, "--region")) ??
          DEFAULT_REGION;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!branchName) {
    throw new Error("Pass --branch <branch-name> or set AWS_BRANCH.");
  }
  if (!appId && !bbCredentialTableName) {
    throw new Error(
      "Pass --app-id <amplify-app-id> or set AWS_APP_ID when BbCredential table discovery is needed.",
    );
  }

  return {
    appId: appId ?? "",
    bbCredentialTableName,
    branchName,
    dryRun,
    environmentName: resolveEnvironmentName({
      branchName,
      environmentName,
    }),
    region,
  };
}

function resolveEnvironmentName(args: {
  branchName: string;
  environmentName: string | null;
}): string {
  return args.environmentName ?? branchToEnvironmentName(args.branchName);
}

async function backfillBbConnectionSecretFingerprints(
  args: ParsedArgs,
  runtimeImpl: BackfillRuntime,
): Promise<BackfillSummary> {
  const secretState = await resolveBbConnectionSecretState({
    AWS_REGION: args.region,
    BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME:
      buildBbConnectionSecretParameterPaths(args.environmentName).secret,
  });
  const documentClient = runtimeImpl.createDocumentClient(args.region);

  const bbCredentialTableName =
    args.bbCredentialTableName ??
    (await resolveBbCredentialTableName(
      {
        appId: args.appId,
        branchName: args.branchName,
        region: args.region,
      },
      runtimeImpl,
    ));
  const activeTrackedTeamsTableName = await resolveSharedInfraTableName(
    buildSharedInfraParameterPaths(args.environmentName).activeTrackedTeamsTableName,
    args.region,
    runtimeImpl,
  );

  const summary: BackfillSummary = {
    activeTrackedTeamsMissingCredential: 0,
    activeTrackedTeamsScanned: 0,
    activeTrackedTeamsSkippedUndecryptable: 0,
    activeTrackedTeamsUpdated: 0,
    bbCredentialsScanned: 0,
    bbCredentialsSkippedUndecryptable: 0,
    bbCredentialsUpdated: 0,
    changed: false,
  };

  runtimeImpl.write(
    [
      `Backfilling BB secret fingerprints for environment '${args.environmentName}'.`,
      `BbCredential table: ${bbCredentialTableName}`,
      `ActiveTrackedTeams table: ${activeTrackedTeamsTableName}`,
      args.dryRun ? "Mode: dry-run" : "Mode: apply",
    ].join("\n") + "\n",
  );

  for await (const credential of scanTable<BbCredentialRecord>(
    bbCredentialTableName,
    documentClient,
  )) {
    summary.bbCredentialsScanned += 1;
    if (
      credential.secretFingerprint === secretState.secretFingerprint ||
      !credential.userId
    ) {
      continue;
    }

    if (!canDecryptBbCredential(credential, secretState.secret)) {
      summary.bbCredentialsSkippedUndecryptable += 1;
      continue;
    }

    summary.bbCredentialsUpdated += 1;
    summary.changed = true;
    if (!args.dryRun) {
      await documentClient.send(
        new PutCommand({
          TableName: bbCredentialTableName,
          Item: {
            ...credential,
            secretFingerprint: secretState.secretFingerprint,
          },
        }),
      );
    }
  }

  for await (const trackedTeam of scanTable<ActiveTrackedTeamRecord>(
    activeTrackedTeamsTableName,
    documentClient,
  )) {
    summary.activeTrackedTeamsScanned += 1;
    if (!trackedTeam.active) {
      continue;
    }
    if (trackedTeam.credentialSecretFingerprint === secretState.secretFingerprint) {
      continue;
    }
    if (!hasProjectedCredential(trackedTeam)) {
      summary.activeTrackedTeamsMissingCredential += 1;
      continue;
    }
    if (!canDecryptProjectedCredential(trackedTeam, secretState.secret)) {
      summary.activeTrackedTeamsSkippedUndecryptable += 1;
      continue;
    }

    summary.activeTrackedTeamsUpdated += 1;
    summary.changed = true;
    if (!args.dryRun) {
      await documentClient.send(
        new PutCommand({
          TableName: activeTrackedTeamsTableName,
          Item: {
            ...trackedTeam,
            credentialSecretFingerprint: secretState.secretFingerprint,
          },
        }),
      );
    }
  }

  return summary;
}

async function resolveBbCredentialTableName(
  args: {
    appId: string;
    branchName: string;
    region: string;
  },
  runtimeImpl: BackfillRuntime,
): Promise<string> {
  const branch = runtimeImpl.execAwsJson([
    "amplify",
    "get-branch",
    "--app-id",
    args.appId,
    "--branch-name",
    args.branchName,
    "--region",
    args.region,
    "--output",
    "json",
  ]) as {
    branch?: {
      backend?: {
        stackArn?: string;
      };
    };
  };

  const backendStackArn = normalizeOptionalString(branch.branch?.backend?.stackArn);
  if (!backendStackArn) {
    throw new Error(
      `Amplify branch '${args.branchName}' for app '${args.appId}' does not expose a backend stack ARN.`,
    );
  }

  const cloudFormationClient = runtimeImpl.createCloudFormationClient(args.region);
  const dataStackArn = findNestedStackArn(
    await listStackResources(cloudFormationClient, backendStackArn),
    (resource) =>
      resource.ResourceType === "AWS::CloudFormation::Stack" &&
      (normalizeOptionalString(resource.LogicalResourceId)
        ?.toLowerCase()
        .startsWith("data") ??
        false),
    `data nested stack under '${backendStackArn}'`,
  );
  const bbCredentialNestedStackArn = findNestedStackArn(
    await listStackResources(cloudFormationClient, dataStackArn),
    (resource) =>
      resource.ResourceType === "AWS::CloudFormation::Stack" &&
      (normalizeOptionalString(resource.LogicalResourceId)?.includes(
        "BbCredential",
      ) ??
        false),
    `BbCredential nested stack under '${dataStackArn}'`,
  );

  return findOnlyDynamoTableName(
    await listStackResources(cloudFormationClient, bbCredentialNestedStackArn),
    `BbCredential nested stack '${bbCredentialNestedStackArn}'`,
  );
}

async function resolveSharedInfraTableName(
  parameterName: string,
  region: string,
  runtimeImpl: Pick<BackfillRuntime, "createSsmClient">,
): Promise<string> {
  const response = await runtimeImpl.createSsmClient(region).send(
    new GetParameterCommand({
      Name: parameterName,
    }),
  );
  const value = response.Parameter?.Value?.trim() || null;
  if (!value) {
    throw new Error(`SSM parameter '${parameterName}' did not contain a table name.`);
  }
  return value;
}

function findNestedStackArn(
  resources: readonly StackResourceSummary[],
  predicate: (resource: StackResourceSummary) => boolean,
  description: string,
): string {
  const matches = resources.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${description}, found ${matches.length}.`);
  }

  const stackArn = normalizeOptionalString(matches[0]?.PhysicalResourceId);
  if (!stackArn) {
    throw new Error(`The ${description} did not expose a physical stack ARN.`);
  }

  return stackArn;
}

function findOnlyDynamoTableName(
  resources: readonly StackResourceSummary[],
  description: string,
): string {
  const tables = resources.filter(
    (resource) =>
      resource.ResourceType === "AWS::DynamoDB::Table" ||
      resource.ResourceType === "Custom::AmplifyDynamoDBTable",
  );
  if (tables.length !== 1) {
    throw new Error(`Expected exactly one DynamoDB table in ${description}, found ${tables.length}.`);
  }

  const tableName = normalizeOptionalString(tables[0]?.PhysicalResourceId);
  if (!tableName) {
    throw new Error(`The DynamoDB table in ${description} did not expose a physical table name.`);
  }

  return tableName;
}

async function listStackResources(
  cloudFormationClient: CloudFormationClient,
  stackName: string,
): Promise<StackResourceSummary[]> {
  const resources: StackResourceSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await cloudFormationClient.send(
      new ListStackResourcesCommand({
        NextToken: nextToken,
        StackName: stackName,
      }),
    );
    resources.push(...(response.StackResourceSummaries ?? []));
    nextToken = response.NextToken;
  } while (nextToken);

  return resources;
}

async function* scanTable<T extends Record<string, unknown>>(
  tableName: string,
  documentClient: DynamoDBDocumentClient,
): AsyncGenerator<T> {
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await documentClient.send(
      new ScanCommand({
        ExclusiveStartKey: exclusiveStartKey,
        TableName: tableName,
      }),
    );
    for (const item of response.Items ?? []) {
      yield item as T;
    }
    exclusiveStartKey = response.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);
}

function hasProjectedCredential(record: ActiveTrackedTeamRecord): boolean {
  return Boolean(
    record.credentialCipherText &&
      record.credentialIv &&
      record.credentialAuthTag &&
      record.credentialAlgorithm,
  );
}

function canDecryptBbCredential(
  record: BbCredentialRecord,
  secret: string,
): boolean {
  try {
    decryptValue(
      {
        algorithm: record.algorithm,
        authTag: record.authTag,
        cipherText: record.cipherText,
        iv: record.iv,
      },
      secret,
    );
    return true;
  } catch (error) {
    if (isEncryptedValueDecryptionFailure(error)) {
      return false;
    }
    throw error;
  }
}

function canDecryptProjectedCredential(
  record: ActiveTrackedTeamRecord,
  secret: string,
): boolean {
  try {
    decryptValue(
      {
        algorithm: record.credentialAlgorithm!,
        authTag: record.credentialAuthTag!,
        cipherText: record.credentialCipherText!,
        iv: record.credentialIv!,
      },
      secret,
    );
    return true;
  } catch (error) {
    if (isEncryptedValueDecryptionFailure(error)) {
      return false;
    }
    throw error;
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  optionName: string,
): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
