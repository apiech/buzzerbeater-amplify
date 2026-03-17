import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import { requireFeatureAccess } from "./billing";
import { getBbConnection, listTrackedTeams } from "./repository";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type SubmitDependencies = {
  getBbConnection: typeof getBbConnection;
  getTeamHighlightsStatus: typeof getTeamHighlightsStatus;
  listTrackedTeams: typeof listTrackedTeams;
  now: () => Date;
  putTeamHighlightsStatus: typeof putTeamHighlightsStatus;
  requireFeatureAccess: typeof requireFeatureAccess;
  sendQueueMessage: (
    queueUrl: string,
    message: TeamHighlightsScanMessage,
  ) => Promise<void>;
};

type GetDependencies = {
  getBbConnection: typeof getBbConnection;
  getTeamHighlightsStatus: typeof getTeamHighlightsStatus;
  listTrackedTeams: typeof listTrackedTeams;
  queryTeamMoments: typeof queryTeamMoments;
};

type PrimaryTeam = {
  teamId: string;
  teamName: string | null;
};

type TeamHighlightsPerspective = "AGAINST" | "BOTH" | "FOR";

type TeamHighlightsScanMessage = {
  requestedAt: string;
  teamId: string;
  userId: string;
};

type TeamHighlightsStatusItem = {
  completedAt?: string | null;
  error?: string | null;
  matchesDiscovered?: number | null;
  matchesEnqueuedForIngest?: number | null;
  matchesEnqueuedForMaterialize?: number | null;
  matchesReused?: number | null;
  requestedAt: string;
  seasonsFrom?: number | null;
  seasonsTo?: number | null;
  startedAt?: string | null;
  status: string;
  teamId: string;
  teamName?: string | null;
  updatedAt?: string | null;
  userId: string;
};

type TeamMomentItem = {
  comment?: string | null;
  eventKind?: string | null;
  finalOpponentScore?: number | null;
  finalScoreAway?: number | null;
  finalScoreHome?: number | null;
  finalTeamScore?: number | null;
  freeThrowType?: string | null;
  gameclock?: number | null;
  isHome?: boolean | null;
  matchId: string;
  matchType?: string | null;
  momentId: string;
  momentSortKey: string;
  opponentId?: string | null;
  opponentName?: string | null;
  outcomeChanged?: boolean | null;
  period?: string | null;
  perspective: string;
  playerId?: string | null;
  playerName?: string | null;
  recordId: string;
  scoreAfterAway?: number | null;
  scoreAfterHome?: number | null;
  scoreBeforeAway?: number | null;
  scoreBeforeHome?: number | null;
  scoringTeamId?: string | null;
  scoringTeamName?: string | null;
  season?: number | null;
  shotDistanceFt?: number | null;
  shotResult?: string | null;
  shotType?: string | null;
  shotTypeLabel?: string | null;
  shotX?: number | null;
  shotY?: number | null;
  startTime?: string | null;
  teamId: string;
  teamName?: string | null;
  teamScoreAfter?: number | null;
  teamScoreBefore?: number | null;
  opponentScoreAfter?: number | null;
  opponentScoreBefore?: number | null;
};

const PAGE_SIZE = 25;
const TERMINAL_SCAN_STATUSES = new Set(["FAILED", "SUCCEEDED"]);

const ddbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const defaultSubmitDependencies: SubmitDependencies = {
  getBbConnection,
  getTeamHighlightsStatus,
  listTrackedTeams,
  now: () => new Date(),
  putTeamHighlightsStatus,
  requireFeatureAccess,
  sendQueueMessage: async (queueUrl, message) => {
    const sqs = new SQSClient({});
    await sqs.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(message),
        QueueUrl: queueUrl,
      }),
    );
  },
};

const defaultGetDependencies: GetDependencies = {
  getBbConnection,
  getTeamHighlightsStatus,
  listTrackedTeams,
  queryTeamMoments,
};

export const __testing = {
  decodeCursor,
  encodeCursor,
  filterTeamMoments,
  normalizePerspective,
  resolvePrimaryTeam,
  summarizeTeamMoments,
};

export async function submitMyTeamHighlightsScan(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    queueUrl: string;
  },
  dependencies: SubmitDependencies = defaultSubmitDependencies,
): Promise<{
  queued: boolean;
  requestedAt: string;
  status: string;
  teamId: string;
  teamName: string | null;
}> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  await dependencies.requireFeatureAccess({
    env: args.env,
    featureKey: "teamHighlights",
    userId,
  });

  const team = await resolvePrimaryTeam(
    args.env,
    userId,
    dependencies.getBbConnection,
    dependencies.listTrackedTeams,
  );
  const existingStatus = await dependencies.getTeamHighlightsStatus(
    args.env,
    userId,
    team.teamId,
  );
  if (existingStatus && !TERMINAL_SCAN_STATUSES.has(existingStatus.status)) {
    return {
      queued: false,
      requestedAt: existingStatus.requestedAt,
      status: existingStatus.status,
      teamId: team.teamId,
      teamName: team.teamName ?? existingStatus.teamName ?? null,
    };
  }

  const requestedAt = dependencies.now().toISOString();
  const queuedStatus: TeamHighlightsStatusItem = {
    requestedAt,
    status: "QUEUED",
    teamId: team.teamId,
    teamName: team.teamName,
    updatedAt: requestedAt,
    userId,
  };

  await dependencies.putTeamHighlightsStatus(args.env, queuedStatus);

  try {
    await dependencies.sendQueueMessage(args.queueUrl, {
      requestedAt,
      teamId: team.teamId,
      userId,
    });
  } catch (error) {
    const failedAt = dependencies.now().toISOString();
    await dependencies.putTeamHighlightsStatus(args.env, {
      ...queuedStatus,
      completedAt: failedAt,
      error: toErrorMessage(error),
      status: "FAILED",
      updatedAt: failedAt,
    });
    throw error;
  }

  return {
    queued: true,
    requestedAt,
    status: queuedStatus.status,
    teamId: team.teamId,
    teamName: team.teamName,
  };
}

export async function getMyTeamHighlights(
  args: {
    cursor?: string | null;
    env: GraphqlEnv;
    identity: unknown;
    onlyOutcomeChange?: boolean | null;
    perspective?: string | null;
  },
  dependencies: GetDependencies = defaultGetDependencies,
): Promise<Record<string, unknown>> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const team = await resolvePrimaryTeam(
    args.env,
    userId,
    dependencies.getBbConnection,
    dependencies.listTrackedTeams,
  );
  const [scanStatus, allMoments] = await Promise.all([
    dependencies.getTeamHighlightsStatus(args.env, userId, team.teamId),
    dependencies.queryTeamMoments(args.env, team.teamId),
  ]);

  const perspective = normalizePerspective(args.perspective);
  const onlyOutcomeChange = args.onlyOutcomeChange ?? true;
  const filteredMoments = filterTeamMoments(allMoments, {
    onlyOutcomeChange,
    perspective,
  });
  const decodedCursor = decodeCursor(args.cursor ?? null);
  const pageStartIndex = decodedCursor
    ? filteredMoments.findIndex((item) => item.momentSortKey === decodedCursor) + 1
    : 0;
  const pageItems =
    pageStartIndex > 0
      ? filteredMoments.slice(pageStartIndex, pageStartIndex + PAGE_SIZE)
      : filteredMoments.slice(0, PAGE_SIZE);
  const nextCursor =
    pageItems.length === PAGE_SIZE
      ? encodeCursor(pageItems[pageItems.length - 1].momentSortKey)
      : null;

  return {
    filters: {
      onlyOutcomeChange,
      perspective,
    },
    items: pageItems.map((item) => ({
      comment: item.comment ?? null,
      eventKind: item.eventKind ?? null,
      finalOpponentScore: item.finalOpponentScore ?? null,
      finalScoreAway: item.finalScoreAway ?? null,
      finalScoreHome: item.finalScoreHome ?? null,
      finalTeamScore: item.finalTeamScore ?? null,
      freeThrowType: item.freeThrowType ?? null,
      gameclock: item.gameclock ?? null,
      isHome: item.isHome ?? null,
      matchId: item.matchId,
      matchType: item.matchType ?? null,
      momentId: item.momentId,
      opponentId: item.opponentId ?? null,
      opponentName: item.opponentName ?? null,
      opponentScoreAfter: item.opponentScoreAfter ?? null,
      opponentScoreBefore: item.opponentScoreBefore ?? null,
      outcomeChanged: Boolean(item.outcomeChanged),
      period: item.period ?? null,
      perspective: normalizePerspective(item.perspective),
      playerId: item.playerId ?? null,
      playerName: item.playerName ?? null,
      recordId: item.recordId,
      scoreAfterAway: item.scoreAfterAway ?? null,
      scoreAfterHome: item.scoreAfterHome ?? null,
      scoreBeforeAway: item.scoreBeforeAway ?? null,
      scoreBeforeHome: item.scoreBeforeHome ?? null,
      scoringTeamId: item.scoringTeamId ?? null,
      scoringTeamName: item.scoringTeamName ?? null,
      season: item.season ?? null,
      shotDistanceFt: item.shotDistanceFt ?? null,
      shotResult: item.shotResult ?? null,
      shotType: item.shotType ?? null,
      shotTypeLabel: item.shotTypeLabel ?? null,
      shotX: item.shotX ?? null,
      shotY: item.shotY ?? null,
      startTime: item.startTime ?? null,
      teamId: item.teamId,
      teamName: item.teamName ?? null,
      teamScoreAfter: item.teamScoreAfter ?? null,
      teamScoreBefore: item.teamScoreBefore ?? null,
    })),
    nextCursor,
    scanStatus: scanStatus
      ? {
          completedAt: scanStatus.completedAt ?? null,
          error: scanStatus.error ?? null,
          matchesDiscovered: scanStatus.matchesDiscovered ?? null,
          matchesEnqueuedForIngest: scanStatus.matchesEnqueuedForIngest ?? null,
          matchesEnqueuedForMaterialize:
            scanStatus.matchesEnqueuedForMaterialize ?? null,
          matchesReused: scanStatus.matchesReused ?? null,
          requestedAt: scanStatus.requestedAt,
          seasonsFrom: scanStatus.seasonsFrom ?? null,
          seasonsTo: scanStatus.seasonsTo ?? null,
          startedAt: scanStatus.startedAt ?? null,
          status: scanStatus.status,
          teamId: scanStatus.teamId,
          teamName: scanStatus.teamName ?? null,
          updatedAt: scanStatus.updatedAt ?? null,
        }
      : null,
    summary: summarizeTeamMoments(allMoments, filteredMoments),
    team: {
      teamId: team.teamId,
      teamName: team.teamName,
    },
  };
}

async function resolvePrimaryTeam(
  env: GraphqlEnv,
  userId: string,
  getBbConnectionDependency: typeof getBbConnection,
  listTrackedTeamsDependency: typeof listTrackedTeams,
): Promise<PrimaryTeam> {
  const [connection, trackedTeams] = await Promise.all([
    getBbConnectionDependency(env, userId),
    listTrackedTeamsDependency(env, userId, 100),
  ]);

  const primaryTrackedTeam =
    trackedTeams.find(
      (team) =>
        asBoolean(team.isPrimary) && Boolean(asOptionalString(team.teamId)),
    ) ??
    trackedTeams.find(
      (team) => asOptionalString(team.teamId) === connection?.teamId,
    ) ??
    trackedTeams.find((team) => Boolean(asOptionalString(team.teamId))) ??
    null;

  const teamId =
    asOptionalString(primaryTrackedTeam?.teamId) ?? connection?.teamId ?? null;
  if (!teamId) {
    throw new Error("No primary team is available for team highlights.");
  }

  return {
    teamId,
    teamName:
      asOptionalString(primaryTrackedTeam?.name) ??
      asOptionalString(primaryTrackedTeam?.teamName) ??
      connection?.teamName ??
      null,
  };
}

async function getTeamHighlightsStatus(
  env: GraphqlEnv,
  userId: string,
  teamId: string,
): Promise<TeamHighlightsStatusItem | null> {
  const response = await ddbDocumentClient.send(
    new GetCommand({
      Key: {
        teamId,
        userId,
      },
      TableName: resolveTeamHighlightsStatusTableName(env),
    }),
  );
  return (response.Item as TeamHighlightsStatusItem | undefined) ?? null;
}

async function putTeamHighlightsStatus(
  env: GraphqlEnv,
  item: TeamHighlightsStatusItem,
): Promise<void> {
  await ddbDocumentClient.send(
    new PutCommand({
      Item: item,
      TableName: resolveTeamHighlightsStatusTableName(env),
    }),
  );
}

async function queryTeamMoments(
  env: GraphqlEnv,
  teamId: string,
): Promise<TeamMomentItem[]> {
  const items: TeamMomentItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await ddbDocumentClient.send(
      new QueryCommand({
        ExclusiveStartKey: exclusiveStartKey,
        ExpressionAttributeNames: {
          "#teamId": "teamId",
        },
        ExpressionAttributeValues: {
          ":teamId": teamId,
        },
        KeyConditionExpression: "#teamId = :teamId",
        ScanIndexForward: false,
        TableName: resolveTeamMomentsTableName(env),
      }),
    );

    items.push(...((response.Items ?? []) as TeamMomentItem[]));
    exclusiveStartKey =
      (response.LastEvaluatedKey as Record<string, unknown> | undefined) ??
      undefined;
  } while (exclusiveStartKey);

  return items;
}

function filterTeamMoments(
  moments: readonly TeamMomentItem[],
  options: {
    onlyOutcomeChange: boolean;
    perspective: TeamHighlightsPerspective;
  },
): TeamMomentItem[] {
  return moments.filter((moment) => {
    if (
      options.perspective !== "BOTH" &&
      normalizePerspective(moment.perspective) !== options.perspective
    ) {
      return false;
    }

    if (options.onlyOutcomeChange && !moment.outcomeChanged) {
      return false;
    }

    return true;
  });
}

function summarizeTeamMoments(
  allMoments: readonly TeamMomentItem[],
  filteredMoments: readonly TeamMomentItem[],
): Record<string, number> {
  const forMoments = allMoments.filter(
    (moment) => normalizePerspective(moment.perspective) === "FOR",
  ).length;
  const againstMoments = allMoments.filter(
    (moment) => normalizePerspective(moment.perspective) === "AGAINST",
  ).length;
  const outcomeChangeMoments = allMoments.filter(
    (moment) => Boolean(moment.outcomeChanged),
  ).length;

  return {
    againstMoments,
    filteredMoments: filteredMoments.length,
    forMoments,
    outcomeChangeMoments,
    totalMoments: allMoments.length,
  };
}

function normalizePerspective(value: unknown): TeamHighlightsPerspective {
  const normalized = asOptionalString(value)?.trim().toUpperCase();
  if (normalized === "FOR" || normalized === "AGAINST") {
    return normalized;
  }
  return "BOTH";
}

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeCursor(cursor: string | null): string | null {
  if (!cursor) {
    return null;
  }

  try {
    return Buffer.from(cursor, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function resolveTeamMomentsTableName(env: GraphqlEnv): string {
  const tableName =
    env.TEAM_MOMENTS_TABLE_NAME ?? process.env.TEAM_MOMENTS_TABLE_NAME;
  if (!tableName) {
    throw new Error("TEAM_MOMENTS_TABLE_NAME is not configured.");
  }
  return tableName;
}

function resolveTeamHighlightsStatusTableName(env: GraphqlEnv): string {
  const tableName =
    env.TEAM_HIGHLIGHTS_STATUS_TABLE_NAME ??
    process.env.TEAM_HIGHLIGHTS_STATUS_TABLE_NAME;
  if (!tableName) {
    throw new Error("TEAM_HIGHLIGHTS_STATUS_TABLE_NAME is not configured.");
  }
  return tableName;
}

function resolveUserId(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") {
    return null;
  }

  const typedIdentity = identity as Identity;
  if (typeof typedIdentity.sub === "string" && typedIdentity.sub) {
    return typedIdentity.sub;
  }

  const claimsSub = typedIdentity.claims?.sub;
  return typeof claimsSub === "string" && claimsSub ? claimsSub : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }
  return false;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
