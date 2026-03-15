import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

type GraphqlEnv = Record<string, string | undefined>;

type SecretReference = {
  secretName: string;
  secretArn: string;
};

const secretsClient = new SecretsManagerClient({});
const DEFAULT_SECRET_PREFIX = "bb-connections";

export async function upsertBbConnectionSecret(
  env: GraphqlEnv,
  userId: string,
  accessKey: string,
): Promise<SecretReference> {
  const secretName = buildSecretName(env, userId);
  const secretString = JSON.stringify({ accessKey });
  try {
    await secretsClient.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: secretString,
      }),
    );
  } catch (error) {
    if (!(error instanceof ResourceExistsException)) {
      throw error;
    }
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretString,
      }),
    );
  }

  return describeBbConnectionSecret(env, userId);
}

export async function readBbConnectionSecret(
  env: GraphqlEnv,
  userId: string,
): Promise<string | null> {
  const secretName = buildSecretName(env, userId);
  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      }),
    );
    const secretString = response.SecretString;
    if (!secretString) {
      return null;
    }
    const parsed = JSON.parse(secretString) as { accessKey?: unknown };
    return typeof parsed.accessKey === "string" && parsed.accessKey
      ? parsed.accessKey
      : null;
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") {
      return null;
    }
    throw error;
  }
}

export async function describeBbConnectionSecret(
  env: GraphqlEnv,
  userId: string,
): Promise<SecretReference> {
  const secretName = buildSecretName(env, userId);
  const response = await secretsClient.send(
    new DescribeSecretCommand({
      SecretId: secretName,
    }),
  );
  const secretArn = response.ARN;
  if (!secretArn) {
    throw new Error(`Secret ${secretName} did not return an ARN.`);
  }
  return {
    secretName,
    secretArn,
  };
}

export async function deleteBbConnectionSecret(
  env: GraphqlEnv,
  userId: string,
): Promise<void> {
  const secretName = buildSecretName(env, userId);
  try {
    await secretsClient.send(
      new DeleteSecretCommand({
        SecretId: secretName,
        ForceDeleteWithoutRecovery: true,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") {
      return;
    }
    throw error;
  }
}

export async function getBbConnectionSecretReference(
  env: GraphqlEnv,
  userId: string,
): Promise<SecretReference | null> {
  try {
    return await describeBbConnectionSecret(env, userId);
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") {
      return null;
    }
    throw error;
  }
}

export function buildSecretName(env: GraphqlEnv, userId: string): string {
  const prefix =
    env.BB_CONNECTION_SECRET_PREFIX ??
    process.env.BB_CONNECTION_SECRET_PREFIX ??
    DEFAULT_SECRET_PREFIX;
  return `${prefix}/${userId}`;
}
