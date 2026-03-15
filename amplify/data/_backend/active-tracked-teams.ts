import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

type GraphqlEnv = Record<string, string | undefined>;

export type ActiveTrackedTeamRecord = {
  userId: string;
  teamId: string;
  teamName?: string | null;
  bbLoginName?: string | null;
  credentialSecretArn?: string | null;
  credentialSecretName?: string | null;
  active: boolean;
  isPrimary: boolean;
  fetchedAt?: string | null;
  updatedAt: string;
};

const ddbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function upsertActiveTrackedTeam(
  env: GraphqlEnv,
  record: ActiveTrackedTeamRecord,
): Promise<void> {
  await ddbDocumentClient.send(
    new PutCommand({
      TableName: resolveActiveTrackedTeamsTableName(env),
      Item: record,
    }),
  );
}

export async function deactivateActiveTrackedTeamsForUser(
  env: GraphqlEnv,
  userId: string,
): Promise<void> {
  const response = await ddbDocumentClient.send(
    new QueryCommand({
      TableName: resolveActiveTrackedTeamsTableName(env),
      KeyConditionExpression: "#userId = :userId",
      ExpressionAttributeNames: {
        "#userId": "userId",
      },
      ExpressionAttributeValues: {
        ":userId": userId,
      },
    }),
  );

  const now = new Date().toISOString();
  for (const item of response.Items ?? []) {
    await ddbDocumentClient.send(
      new PutCommand({
        TableName: resolveActiveTrackedTeamsTableName(env),
        Item: {
          ...item,
          active: false,
          credentialSecretArn: null,
          credentialSecretName: null,
          updatedAt: now,
        },
      }),
    );
  }
}

function resolveActiveTrackedTeamsTableName(env: GraphqlEnv): string {
  const tableName =
    env.ACTIVE_TRACKED_TEAMS_TABLE_NAME ??
    process.env.ACTIVE_TRACKED_TEAMS_TABLE_NAME;
  if (!tableName) {
    throw new Error("ACTIVE_TRACKED_TEAMS_TABLE_NAME is not configured.");
  }
  return tableName;
}
