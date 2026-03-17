import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import type { BbCredentialRecord } from "./repository";

type ActiveTrackedTeamsEnv = {
  ACTIVE_TRACKED_TEAMS_TABLE_NAME?: string;
};

export type ActiveTrackedTeamCredentialProjection = {
  credentialCipherText?: string | null;
  credentialIv?: string | null;
  credentialAuthTag?: string | null;
  credentialAlgorithm?: BbCredentialRecord["algorithm"] | null;
};

export type ActiveTrackedTeamRecord = {
  userId: string;
  teamId: string;
  teamName?: string | null;
  bbLoginName?: string | null;
  credentialCipherText?: string | null;
  credentialIv?: string | null;
  credentialAuthTag?: string | null;
  credentialAlgorithm?: BbCredentialRecord["algorithm"] | null;
  active: boolean;
  isPrimary: boolean;
  fetchedAt?: string | null;
  updatedAt: string;
};

const ddbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const runtime = {
  documentClient: ddbDocumentClient,
};

export const __testing = {
  runtime,
  resolveActiveTrackedTeamsTableName,
};

export async function upsertActiveTrackedTeam(
  env: ActiveTrackedTeamsEnv,
  record: ActiveTrackedTeamRecord,
): Promise<void> {
  await runtime.documentClient.send(
    new PutCommand({
      TableName: resolveActiveTrackedTeamsTableName(env),
      Item: record,
    }),
  );
}

export async function listActiveTrackedTeamsForUser(
  env: ActiveTrackedTeamsEnv,
  userId: string,
): Promise<ActiveTrackedTeamRecord[]> {
  const items: ActiveTrackedTeamRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await runtime.documentClient.send(
      new QueryCommand({
        TableName: resolveActiveTrackedTeamsTableName(env),
        KeyConditionExpression: "#userId = :userId",
        ExpressionAttributeNames: {
          "#userId": "userId",
        },
        ExpressionAttributeValues: {
          ":userId": userId,
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...((response.Items ?? []) as ActiveTrackedTeamRecord[]));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return items;
}

export async function deactivateActiveTrackedTeamsForUser(
  env: ActiveTrackedTeamsEnv,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  for (const item of await listActiveTrackedTeamsForUser(env, userId)) {
    await runtime.documentClient.send(
      new PutCommand({
        TableName: resolveActiveTrackedTeamsTableName(env),
        Item: {
          ...item,
          active: false,
          credentialCipherText: null,
          credentialIv: null,
          credentialAuthTag: null,
          credentialAlgorithm: null,
          updatedAt: now,
        },
      }),
    );
  }
}

export function buildActiveTrackedTeamCredentialProjection(
  credential: BbCredentialRecord | null,
): ActiveTrackedTeamCredentialProjection {
  if (!credential) {
    return {
      credentialCipherText: null,
      credentialIv: null,
      credentialAuthTag: null,
      credentialAlgorithm: null,
    };
  }

  return {
    credentialCipherText: credential.cipherText,
    credentialIv: credential.iv,
    credentialAuthTag: credential.authTag,
    credentialAlgorithm: credential.algorithm,
  };
}

function resolveActiveTrackedTeamsTableName(env: ActiveTrackedTeamsEnv): string {
  const tableName = env.ACTIVE_TRACKED_TEAMS_TABLE_NAME;
  if (!tableName) {
    throw new Error("ACTIVE_TRACKED_TEAMS_TABLE_NAME is not configured.");
  }
  return tableName;
}
