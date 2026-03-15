import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

type GraphqlEnv = Record<string, string | undefined>;

export type CanonicalPlayerSkillSnapshotRecord = {
  playerId: string;
  weekKey: string;
  teamId: string;
  teamName?: string | null;
  sourceUserId?: string | null;
  capturedAt: string;
  firstName?: string | null;
  lastName?: string | null;
  salary?: number | null;
  bestPosition?: string | null;
  gameShape?: string | null;
  dmi?: number | null;
  injuryWeeks?: number | null;
  payload?: Record<string, unknown> | null;
};

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function upsertCanonicalPlayerSkillSnapshot(
  env: GraphqlEnv,
  record: CanonicalPlayerSkillSnapshotRecord,
): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: resolvePlayerSkillSnapshotTableName(env),
      Item: record,
    }),
  );
}

export async function listCanonicalPlayerSkillSnapshots(
  env: GraphqlEnv,
  playerId: string,
  limit = 12,
): Promise<CanonicalPlayerSkillSnapshotRecord[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: resolvePlayerSkillSnapshotTableName(env),
      KeyConditionExpression: "#playerId = :playerId",
      ExpressionAttributeNames: {
        "#playerId": "playerId",
      },
      ExpressionAttributeValues: {
        ":playerId": playerId,
      },
      Limit: limit,
      ScanIndexForward: false,
    }),
  );

  return (response.Items ?? []) as CanonicalPlayerSkillSnapshotRecord[];
}

function resolvePlayerSkillSnapshotTableName(env: GraphqlEnv): string {
  const tableName =
    env.PLAYER_SKILL_SNAPSHOT_TABLE_NAME ??
    process.env.PLAYER_SKILL_SNAPSHOT_TABLE_NAME;
  if (!tableName) {
    throw new Error("PLAYER_SKILL_SNAPSHOT_TABLE_NAME is not configured.");
  }
  return tableName;
}
