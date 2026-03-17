import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

type PlayerSkillSnapshotEnv = {
  PLAYER_SKILL_SNAPSHOT_TABLE_NAME?: string;
};

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

export const __testing = {
  resolvePlayerSkillSnapshotTableName,
};

export async function upsertCanonicalPlayerSkillSnapshot(
  env: PlayerSkillSnapshotEnv,
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
  env: PlayerSkillSnapshotEnv,
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

function resolvePlayerSkillSnapshotTableName(env: PlayerSkillSnapshotEnv): string {
  const tableName = env.PLAYER_SKILL_SNAPSHOT_TABLE_NAME;
  if (!tableName) {
    throw new Error("PLAYER_SKILL_SNAPSHOT_TABLE_NAME is not configured.");
  }
  return tableName;
}
