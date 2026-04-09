import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { Schema } from "../resource";
import { TeamHighlightsPerspective } from "../schema-enums";
import { requireFeatureAccess } from "./billing";
import {
  assertBbCredentialReadable,
  resolveBbCredentialErrorCode,
} from "./credentials";
import { assertMaintenanceInactive } from "./maintenance";
import {
  getBbConnection,
  listTrackedTeamsForUser,
  type BbConnectionRecord,
  type TrackedTeamRecord,
} from "./repository";
import {
  buildExecutionName,
  startStateMachineExecution,
} from "./step-functions";

type GraphqlEnv = Record<string, string | undefined>;
type TeamMomentsEnv = {
  TEAM_MOMENTS_TABLE_NAME?: string;
};
type TeamHighlightsStatusEnv = {
  TEAM_HIGHLIGHTS_STATUS_TABLE_NAME?: string;
};
type TeamProjectionEnv = {
  TEAM_MATCH_PROJECTION_TABLE_NAME?: string;
};

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type TeamHighlightsResult = ResolverResult<"getMyTeamHighlights">;
type TeamHighlightsClearResult = ResolverResult<"clearMyTeamHighlightsData">;
type TeamHighlightsScanSubmitResult = ResolverResult<"submitMyTeamHighlightsScan">;
type TeamHighlightsScanState = TeamHighlightsScanSubmitResult["status"];
type TeamHighlightsSummary = TeamHighlightsResult["summary"];
type AssertBbCredentialReadableDependency = (
  env: GraphqlEnv,
  userId: string,
) => Promise<void>;
type GetBbConnectionDependency = (
  env: GraphqlEnv,
  userId: string,
) => Promise<BbConnectionRecord | null>;
type GetTeamHighlightsStatusDependency = (
  env: GraphqlEnv,
  userId: string,
  teamId: string,
) => Promise<TeamHighlightsStatusItem | null>;
type ListTrackedTeamsForUserDependency = (
  env: GraphqlEnv,
  userId: string,
) => Promise<TrackedTeamRecord[]>;
type PutTeamHighlightsStatusDependency = (
  env: GraphqlEnv,
  item: TeamHighlightsStatusItem,
) => Promise<void>;
type RequireFeatureAccessDependency = (args: {
  env: GraphqlEnv;
  featureKey: "teamHighlights";
  userId: string;
}) => Promise<unknown>;
type QueryTeamMomentsDependency = (
  env: GraphqlEnv,
  teamId: string,
) => Promise<TeamMomentItem[]>;
type QueryTeamProjectionsDependency = (
  env: TeamProjectionEnv,
  teamId: string,
) => Promise<TeamProjectionItem[]>;
type DeleteTeamHighlightsStatusDependency = (
  env: GraphqlEnv,
  userId: string,
  teamId: string,
) => Promise<void>;
type DeleteTeamMomentsDependency = (
  env: GraphqlEnv,
  items: readonly TeamMomentItem[],
) => Promise<void>;
type ClearTeamProjectionCoverageDependency = (
  env: TeamProjectionEnv,
  items: readonly TeamProjectionItem[],
) => Promise<void>;

type SubmitDependencies = {
  assertBbCredentialReadable: AssertBbCredentialReadableDependency;
  getBbConnection: GetBbConnectionDependency;
  getTeamHighlightsStatus: GetTeamHighlightsStatusDependency;
  listTrackedTeamsForUser: ListTrackedTeamsForUserDependency;
  now: () => Date;
  putTeamHighlightsStatus: PutTeamHighlightsStatusDependency;
  requireFeatureAccess: RequireFeatureAccessDependency;
  startWorkflowExecution: (
    stateMachineArn: string,
    executionName: string,
    message: TeamHighlightsScanMessage,
  ) => Promise<string>;
};

type GetDependencies = {
  getBbConnection: GetBbConnectionDependency;
  getTeamHighlightsStatus: GetTeamHighlightsStatusDependency;
  listTrackedTeamsForUser: ListTrackedTeamsForUserDependency;
  queryTeamMoments: QueryTeamMomentsDependency;
};

type ClearDependencies = {
  getBbConnection: GetBbConnectionDependency;
  getTeamHighlightsStatus: GetTeamHighlightsStatusDependency;
  listTrackedTeamsForUser: ListTrackedTeamsForUserDependency;
  queryTeamMoments: QueryTeamMomentsDependency;
  queryTeamProjections: QueryTeamProjectionsDependency;
  deleteTeamHighlightsStatus: DeleteTeamHighlightsStatusDependency;
  deleteTeamMoments: DeleteTeamMomentsDependency;
  clearTeamProjectionCoverage: ClearTeamProjectionCoverageDependency;
  requireFeatureAccess: RequireFeatureAccessDependency;
  now: () => Date;
};

type PrimaryTeam = {
  teamId: string;
  teamName: string | null;
};

type TeamHighlightsScanMessage = {
  requestedAt: string;
  teamId: string;
  userId: string;
};

type TeamHighlightsBrokenMatchItem = {
  awayTeamName?: string | null;
  boxscoreUrl: string;
  homeTeamName?: string | null;
  issue: string;
  matchId: string;
  matchType?: string | null;
  season?: number | null;
  startTime?: string | null;
};

type TeamHighlightsStatusItem = {
  brokenMatches?: TeamHighlightsBrokenMatchItem[] | null;
  completedAt?: string | null;
  currentSeason?: number | null;
  errorCode?: string | null;
  executionArn?: string | null;
  error?: string | null;
  matchesAlreadyRecorded?: number | null;
  matchesCompleted?: number | null;
  matchesDiscovered?: number | null;
  matchesEnqueuedForIngest?: number | null;
  matchesEnqueuedForMaterialize?: number | null;
  matchesFailed?: number | null;
  matchesProcessedThisRun?: number | null;
  matchesReused?: number | null;
  matchesWithMoments?: number | null;
  matchesWithoutMoments?: number | null;
  momentsWritten?: number | null;
  requestedAt: string;
  seasonsFrom?: number | null;
  seasonsTo?: number | null;
  startedAt?: string | null;
  status: TeamHighlightsScanState;
  teamId: string;
  teamName?: string | null;
  unsupportedSeasonsWarning?: string | null;
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
  viewerUrl?: string | null;
};

type TeamProjectionItem = {
  matchId: string;
  seasonStartMatchKey: string;
  teamId: string;
  highlightsLastError?: string | null;
  highlightsMomentCount?: number | null;
  highlightsRecordedAt?: string | null;
  highlightsSourceVersion?: string | null;
  highlightsStatus?: string | null;
};

const PAGE_SIZE = 25;
const MAX_BATCH_WRITE_SIZE = 25;
const TERMINAL_SCAN_STATUSES = new Set<TeamHighlightsScanState>([
  "COMPLETED_WITH_GAPS",
  "FAILED",
  "SUCCEEDED",
]);
const STALE_SCAN_MILLISECONDS = 15 * 60 * 1000;

const ddbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const defaultSubmitDependencies: SubmitDependencies = {
  assertBbCredentialReadable,
  getBbConnection,
  getTeamHighlightsStatus,
  listTrackedTeamsForUser,
  now: () => new Date(),
  putTeamHighlightsStatus,
  requireFeatureAccess,
  startWorkflowExecution: async (stateMachineArn, executionName, message) => {
    return startStateMachineExecution({
      input: message,
      name: executionName,
      stateMachineArn,
    });
  },
};

const defaultGetDependencies: GetDependencies = {
  getBbConnection,
  getTeamHighlightsStatus,
  listTrackedTeamsForUser,
  queryTeamMoments,
};

const defaultClearDependencies: ClearDependencies = {
  clearTeamProjectionCoverage,
  deleteTeamHighlightsStatus,
  deleteTeamMoments,
  getBbConnection,
  getTeamHighlightsStatus,
  listTrackedTeamsForUser,
  now: () => new Date(),
  queryTeamMoments,
  queryTeamProjections,
  requireFeatureAccess,
};

export const __testing = {
  chunkItems,
  decodeCursor,
  encodeCursor,
  filterTeamMoments,
  hasTeamHighlightsCoverage,
  normalizePerspective,
  resolveTeamHighlightsStatusTableName,
  resolveTeamMomentsTableName,
  resolveTeamProjectionTableName,
  resolvePrimaryTeam,
  summarizeTeamMoments,
};

export async function submitMyTeamHighlightsScan(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    stateMachineArn: string;
  },
  dependencies: SubmitDependencies = defaultSubmitDependencies,
): Promise<TeamHighlightsScanSubmitResult> {
  await assertMaintenanceInactive();

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
    dependencies.listTrackedTeamsForUser,
  );
  const existingStatus = await dependencies.getTeamHighlightsStatus(
    args.env,
    userId,
    team.teamId,
  );
  if (
    existingStatus &&
    !TERMINAL_SCAN_STATUSES.has(existingStatus.status) &&
    !isTeamHighlightsScanStale(existingStatus, dependencies.now())
  ) {
    return {
      executionArn: existingStatus.executionArn ?? null,
      queued: false,
      requestedAt: existingStatus.requestedAt,
      status: existingStatus.status,
      teamId: team.teamId,
      teamName: team.teamName ?? existingStatus.teamName ?? null,
    };
  }

  await dependencies.assertBbCredentialReadable(args.env, userId);

  const requestedAt = dependencies.now().toISOString();
  const queuedStatus: TeamHighlightsStatusItem = {
    executionArn: null,
    requestedAt,
    status: "QUEUED",
    teamId: team.teamId,
    teamName: team.teamName,
    updatedAt: requestedAt,
    userId,
  };

  await dependencies.putTeamHighlightsStatus(args.env, queuedStatus);

  try {
    const executionArn = await dependencies.startWorkflowExecution(
      args.stateMachineArn,
      buildExecutionName(
        "team-highlights",
        `${userId}:${team.teamId}:${requestedAt}`,
      ),
      {
      requestedAt,
      teamId: team.teamId,
      userId,
      },
    );
    await dependencies.putTeamHighlightsStatus(args.env, {
      ...queuedStatus,
      executionArn,
    });
    return {
      executionArn,
      queued: true,
      requestedAt,
      status: queuedStatus.status,
      teamId: team.teamId,
      teamName: team.teamName,
    };
  } catch (error) {
    const failedAt = dependencies.now().toISOString();
    await dependencies.putTeamHighlightsStatus(args.env, {
      ...queuedStatus,
      completedAt: failedAt,
      errorCode: resolveTeamHighlightsErrorCode(error),
      error: toErrorMessage(error),
      status: "FAILED",
      updatedAt: failedAt,
    });
    throw error;
  }
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
): Promise<TeamHighlightsResult> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const team = await resolvePrimaryTeam(
    args.env,
    userId,
    dependencies.getBbConnection,
    dependencies.listTrackedTeamsForUser,
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
  const lastPageItem = pageItems[pageItems.length - 1];
  const nextCursor =
    pageItems.length === PAGE_SIZE && lastPageItem
      ? encodeCursor(lastPageItem.momentSortKey)
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
      viewerUrl: item.viewerUrl ?? null,
    })),
    nextCursor,
    scanStatus: scanStatus
      ? {
          brokenMatches: (scanStatus.brokenMatches ?? []).map((item) => ({
            awayTeamName: item.awayTeamName ?? null,
            boxscoreUrl: item.boxscoreUrl,
            homeTeamName: item.homeTeamName ?? null,
            issue: item.issue,
            matchId: item.matchId,
            matchType: item.matchType ?? null,
            season: item.season ?? null,
            startTime: item.startTime ?? null,
          })),
          completedAt: scanStatus.completedAt ?? null,
          currentSeason: scanStatus.currentSeason ?? null,
          errorCode: scanStatus.errorCode ?? null,
          executionArn: scanStatus.executionArn ?? null,
          error: scanStatus.error ?? null,
          matchesAlreadyRecorded: scanStatus.matchesAlreadyRecorded ?? null,
          matchesCompleted: scanStatus.matchesCompleted ?? null,
          matchesDiscovered: scanStatus.matchesDiscovered ?? null,
          matchesEnqueuedForIngest: scanStatus.matchesEnqueuedForIngest ?? null,
          matchesEnqueuedForMaterialize:
            scanStatus.matchesEnqueuedForMaterialize ?? null,
          matchesFailed: scanStatus.matchesFailed ?? null,
          matchesProcessedThisRun: scanStatus.matchesProcessedThisRun ?? null,
          matchesReused: scanStatus.matchesReused ?? null,
          matchesWithMoments: scanStatus.matchesWithMoments ?? null,
          matchesWithoutMoments: scanStatus.matchesWithoutMoments ?? null,
          momentsWritten: scanStatus.momentsWritten ?? null,
          requestedAt: scanStatus.requestedAt,
          seasonsFrom: scanStatus.seasonsFrom ?? null,
          seasonsTo: scanStatus.seasonsTo ?? null,
          startedAt: scanStatus.startedAt ?? null,
          status: scanStatus.status,
          teamId: scanStatus.teamId,
          teamName: scanStatus.teamName ?? null,
          unsupportedSeasonsWarning:
            scanStatus.unsupportedSeasonsWarning ?? null,
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

export async function clearMyTeamHighlightsData(
  args: {
    env: GraphqlEnv;
    identity: unknown;
  },
  dependencies: ClearDependencies = defaultClearDependencies,
): Promise<TeamHighlightsClearResult> {
  await assertMaintenanceInactive();

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
    dependencies.listTrackedTeamsForUser,
  );
  const existingStatus = await dependencies.getTeamHighlightsStatus(
    args.env,
    userId,
    team.teamId,
  );
  if (
    existingStatus &&
    !TERMINAL_SCAN_STATUSES.has(existingStatus.status) &&
    !isTeamHighlightsScanStale(existingStatus, dependencies.now())
  ) {
    throw new Error(
      "The latest team highlights scan is still running. Wait for it to finish or become stale before clearing data.",
    );
  }

  const [moments, projections] = await Promise.all([
    dependencies.queryTeamMoments(args.env, team.teamId),
    dependencies.queryTeamProjections(args.env, team.teamId),
  ]);
  const projectionsWithCoverage = projections.filter(hasTeamHighlightsCoverage);

  await dependencies.deleteTeamMoments(args.env, moments);
  await dependencies.clearTeamProjectionCoverage(args.env, projectionsWithCoverage);
  await dependencies.deleteTeamHighlightsStatus(args.env, userId, team.teamId);

  return {
    clearedCoverageCount: projectionsWithCoverage.length,
    deletedMomentCount: moments.length,
    teamId: team.teamId,
    teamName: team.teamName ?? null,
  };
}

async function resolvePrimaryTeam(
  env: GraphqlEnv,
  userId: string,
  getBbConnectionDependency: GetBbConnectionDependency,
  listTrackedTeamsForUserDependency: ListTrackedTeamsForUserDependency,
): Promise<PrimaryTeam> {
  const [connection, trackedTeams] = await Promise.all([
    getBbConnectionDependency(env, userId),
    listTrackedTeamsForUserDependency(env, userId),
  ]);

  const primaryTrackedTeam =
    trackedTeams.find(
      (team: TrackedTeamRecord) =>
        asBoolean(team.isPrimary) && Boolean(asOptionalString(team.teamId)),
    ) ??
    trackedTeams.find(
      (team: TrackedTeamRecord) =>
        asOptionalString(team.teamId) === connection?.teamId,
    ) ??
    trackedTeams.find(
      (team: TrackedTeamRecord) => Boolean(asOptionalString(team.teamId)),
    ) ??
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

async function deleteTeamHighlightsStatus(
  env: GraphqlEnv,
  userId: string,
  teamId: string,
): Promise<void> {
  await ddbDocumentClient.send(
    new DeleteCommand({
      Key: {
        teamId,
        userId,
      },
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

async function deleteTeamMoments(
  env: GraphqlEnv,
  items: readonly TeamMomentItem[],
): Promise<void> {
  const tableName = resolveTeamMomentsTableName(env);
  for (const chunk of chunkItems(items, MAX_BATCH_WRITE_SIZE)) {
    await ddbDocumentClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map((item) => ({
            DeleteRequest: {
              Key: {
                momentSortKey: item.momentSortKey,
                teamId: item.teamId,
              },
            },
          })),
        },
      }),
    );
  }
}

async function queryTeamProjections(
  env: TeamProjectionEnv,
  teamId: string,
): Promise<TeamProjectionItem[]> {
  const items: TeamProjectionItem[] = [];
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
        TableName: resolveTeamProjectionTableName(env),
      }),
    );

    items.push(...((response.Items ?? []) as TeamProjectionItem[]));
    exclusiveStartKey =
      (response.LastEvaluatedKey as Record<string, unknown> | undefined) ??
      undefined;
  } while (exclusiveStartKey);

  return items;
}

async function clearTeamProjectionCoverage(
  env: TeamProjectionEnv,
  items: readonly TeamProjectionItem[],
): Promise<void> {
  const tableName = resolveTeamProjectionTableName(env);
  for (const item of items) {
    await ddbDocumentClient.send(
      new UpdateCommand({
        Key: {
          seasonStartMatchKey: item.seasonStartMatchKey,
          teamId: item.teamId,
        },
        TableName: tableName,
        UpdateExpression:
          "REMOVE highlightsLastError, highlightsMomentCount, highlightsRecordedAt, highlightsSourceVersion, highlightsStatus",
      }),
    );
  }
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
): TeamHighlightsSummary {
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
  if (normalized === "FOR") {
    return TeamHighlightsPerspective.FOR;
  }
  if (normalized === "AGAINST") {
    return TeamHighlightsPerspective.AGAINST;
  }
  return TeamHighlightsPerspective.BOTH;
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

function resolveTeamMomentsTableName(env: TeamMomentsEnv): string {
  const tableName = env.TEAM_MOMENTS_TABLE_NAME;
  if (!tableName) {
    throw new Error("TEAM_MOMENTS_TABLE_NAME is not configured.");
  }
  return tableName;
}

function resolveTeamHighlightsStatusTableName(
  env: TeamHighlightsStatusEnv,
): string {
  const tableName = env.TEAM_HIGHLIGHTS_STATUS_TABLE_NAME;
  if (!tableName) {
    throw new Error("TEAM_HIGHLIGHTS_STATUS_TABLE_NAME is not configured.");
  }
  return tableName;
}

function resolveTeamProjectionTableName(env: TeamProjectionEnv): string {
  const tableName = env.TEAM_MATCH_PROJECTION_TABLE_NAME;
  if (!tableName) {
    throw new Error("TEAM_MATCH_PROJECTION_TABLE_NAME is not configured.");
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

function isTeamHighlightsScanStale(
  status: TeamHighlightsStatusItem,
  now: Date,
): boolean {
  const referenceTimestamp = status.updatedAt ?? status.requestedAt;
  const parsedReference = Date.parse(referenceTimestamp);
  if (!Number.isFinite(parsedReference)) {
    return false;
  }

  return now.getTime() - parsedReference >= STALE_SCAN_MILLISECONDS;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveTeamHighlightsErrorCode(error: unknown): string {
  return resolveBbCredentialErrorCode(error) ?? "unknown";
}

function hasTeamHighlightsCoverage(item: TeamProjectionItem): boolean {
  return Boolean(
    item.highlightsLastError ??
      item.highlightsMomentCount ??
      item.highlightsRecordedAt ??
      item.highlightsSourceVersion ??
      item.highlightsStatus,
  );
}

function chunkItems<TItem>(
  items: readonly TItem[],
  size: number,
): TItem[][] {
  const chunks: TItem[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
