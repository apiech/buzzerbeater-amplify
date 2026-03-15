import { gunzipSync } from "node:zlib";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  getBbConnection,
  getMatchBoxscore,
  listTrackedTeams,
} from "./repository";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

export type MatchIngestStatus = "PENDING" | "PARTIAL" | "SUCCEEDED" | "FAILED";

export type MatchCatalogRecord = {
  matchId: string;
  season?: number | null;
  type?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  neutral?: boolean | null;
  homeTeamId?: string | null;
  homeTeamName?: string | null;
  homeTeamScore?: number | null;
  awayTeamId?: string | null;
  awayTeamName?: string | null;
  awayTeamScore?: number | null;
  ingestStatus: MatchIngestStatus;
  parserVersion?: string | null;
  contentHash?: string | null;
  canonicalKey?: string | null;
  rawBoxscoreKey?: string | null;
  rawReportKey?: string | null;
  derivedManifestKey?: string | null;
  eventCount?: number | null;
  lastIngestedAt?: string | null;
  lastMaterializedAt?: string | null;
  lastError?: string | null;
};

export type TeamMatchProjectionRecord = {
  teamId: string;
  seasonStartMatchKey: string;
  startTimeKey?: string | null;
  startTime?: string | null;
  matchId: string;
  season?: number | null;
  type?: string | null;
  opponentTeamId?: string | null;
  opponentTeamName?: string | null;
  teamScore?: number | null;
  opponentScore?: number | null;
  outcome?: string | null;
  ingestStatus: MatchIngestStatus;
  canonicalKey?: string | null;
};

type MatchStoreEnv = {
  bucketName: string;
  catalogTableName: string;
  projectionTableName: string;
};

type MatchStoreDependencies = {
  listTrackedTeams: typeof listTrackedTeams;
  getBbConnection: typeof getBbConnection;
  getLegacyMatchBoxscore: typeof getMatchBoxscore;
  createBbClient: () => {
    getBoxScoreXml(matchId: string): Promise<string>;
  };
  fetchMatchReport: (matchId: string) => Promise<string>;
  buildMatchPackage: (input: {
    boxscoreXml: string;
    matchId: string;
    reportXml: string | null;
    season?: number | null;
    teamId: string;
    userId: string;
  }) => Promise<Record<string, unknown>>;
  getCatalog: (env: MatchStoreEnv, matchId: string) => Promise<MatchCatalogRecord | null>;
  putCatalog: (env: MatchStoreEnv, record: MatchCatalogRecord) => Promise<void>;
  putTeamProjection: (
    env: MatchStoreEnv,
    record: TeamMatchProjectionRecord,
  ) => Promise<void>;
  putTextObject: (
    env: MatchStoreEnv,
    key: string,
    value: string,
    contentType?: string,
  ) => Promise<void>;
  putJsonObject: (
    env: MatchStoreEnv,
    key: string,
    value: Record<string, unknown>,
  ) => Promise<void>;
  queryTeamProjections: (
    env: MatchStoreEnv,
    teamId: string,
  ) => Promise<TeamMatchProjectionRecord[]>;
  sendMaterializeMessage: (
    env: GraphqlEnv,
    message: { canonicalKey: string; matchId: string },
  ) => Promise<void>;
  getJsonObject: (
    env: MatchStoreEnv,
    key: string,
  ) => Promise<Record<string, unknown>>;
};

const s3Client = new S3Client({});
const ddbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const defaultDependencies: MatchStoreDependencies = {
  listTrackedTeams,
  getBbConnection,
  getLegacyMatchBoxscore: getMatchBoxscore,
  createBbClient: () => {
    throw new Error("createBbClient is not implemented for match-store ingestion.");
  },
  fetchMatchReport: async () => {
    throw new Error("fetchMatchReport is not implemented for match-store ingestion.");
  },
  buildMatchPackage: async () => {
    throw new Error("buildMatchPackage is not implemented for match-store ingestion.");
  },
  getCatalog: getCatalogRecord,
  putCatalog: async () => {
    throw new Error("putCatalog is not implemented for match-store ingestion.");
  },
  putTeamProjection: async () => {
    throw new Error("putTeamProjection is not implemented for match-store ingestion.");
  },
  putTextObject: async () => {
    throw new Error("putTextObject is not implemented for match-store ingestion.");
  },
  putJsonObject: async () => {
    throw new Error("putJsonObject is not implemented for match-store ingestion.");
  },
  queryTeamProjections: queryTeamProjectionRecords,
  sendMaterializeMessage: async () => {
    throw new Error(
      "sendMaterializeMessage is not implemented for match-store ingestion.",
    );
  },
  getJsonObject: getJsonObject,
};

export const __testing = {
  buildCatalogRecordFromPackage,
  buildProjectionRecords,
  buildMatchStoreBoxscorePayload,
  buildCanonicalMatchPayload,
  decodeCursor,
  encodeCursor,
};

export async function listAccessibleMatches(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    teamId?: string | null;
    season?: number | null;
    cursor?: string | null;
  },
  dependencies: MatchStoreDependencies = defaultDependencies,
): Promise<Record<string, unknown>> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const accessibleTeamIds = await resolveAccessibleTeamIds(args.env, userId, dependencies);
  const requestedTeamId = args.teamId?.trim() || null;
  if (requestedTeamId && !accessibleTeamIds.has(requestedTeamId)) {
    throw new Error("The requested team is not available in the current workspace.");
  }

  const matchStoreEnv = resolveMatchStoreEnv(args.env);
  const teamIdsToQuery = requestedTeamId
    ? [requestedTeamId]
    : Array.from(accessibleTeamIds);

  const deduped = new Map<string, TeamMatchProjectionRecord>();
  for (const teamId of teamIdsToQuery) {
    const projections = await dependencies.queryTeamProjections(matchStoreEnv, teamId);
    for (const projection of projections) {
      if (
        args.season !== undefined &&
        args.season !== null &&
        projection.season !== args.season
      ) {
        continue;
      }
      deduped.set(
        projection.matchId,
        choosePreferredProjection(deduped.get(projection.matchId), projection),
      );
    }
  }

  let items = Array.from(deduped.values()).sort((left, right) =>
    getProjectionSortKey(right).localeCompare(getProjectionSortKey(left)),
  );
  const decodedCursor = decodeCursor(args.cursor ?? null);
  if (decodedCursor) {
    items = items.filter((item) => getProjectionSortKey(item) < decodedCursor);
  }

  const page = items.slice(0, 25);
  const nextCursor = page.length === 25 ? encodeCursor(getProjectionSortKey(page[24])) : null;

  return {
    items: page.map((item) => ({
      matchId: item.matchId,
      season: item.season ?? null,
      type: item.type ?? null,
      startTime: item.startTime ?? null,
      teamId: item.teamId,
      opponentTeamId: item.opponentTeamId ?? null,
      opponentTeamName: item.opponentTeamName ?? null,
      teamScore: item.teamScore ?? null,
      opponentScore: item.opponentScore ?? null,
      outcome: item.outcome ?? null,
      ingestStatus: item.ingestStatus,
    })),
    nextCursor,
  };
}

export async function getAccessibleMatch(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    matchId: string;
  },
  dependencies: MatchStoreDependencies = defaultDependencies,
): Promise<Record<string, unknown>> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const matchStoreEnv = resolveMatchStoreEnv(args.env);
  const accessibleTeamIds = await resolveAccessibleTeamIds(args.env, userId, dependencies);
  const catalog = await dependencies.getCatalog(matchStoreEnv, args.matchId.trim());
  if (!catalog) {
    throw new Error("The requested match is not available.");
  }
  if (!isMatchAccessible(catalog, accessibleTeamIds)) {
    throw new Error("The requested match is not available in the current workspace.");
  }
  if (!catalog.canonicalKey) {
    throw new Error("The requested match is not yet available in canonical storage.");
  }

  const matchPackage = await dependencies.getJsonObject(matchStoreEnv, catalog.canonicalKey);
  return buildCanonicalMatchPayload(catalog, matchPackage);
}

export async function getAccessiblePlayByPlay(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    matchId: string;
  },
  dependencies: MatchStoreDependencies = defaultDependencies,
): Promise<Record<string, unknown>> {
  const match = await getAccessibleMatch(args, dependencies);
  return {
    matchId: match.matchId,
    season: match.season,
    ingestStatus: match.ingestStatus,
    match: match.match,
    playByPlay: match.playByPlay,
  };
}

export async function getMatchBoxscoreDetails(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    matchId: string;
  },
  dependencies: MatchStoreDependencies = defaultDependencies,
): Promise<Record<string, unknown>> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const matchId = args.matchId.trim();
  if (!matchId) {
    throw new Error("A match id is required.");
  }

  const accessibleTeamIds = await resolveAccessibleTeamIds(args.env, userId, dependencies);
  const catalog = await dependencies.getCatalog(resolveMatchStoreEnv(args.env), matchId);
  if (catalog && isMatchAccessible(catalog, accessibleTeamIds) && catalog.canonicalKey) {
    const matchPackage = await dependencies.getJsonObject(
      resolveMatchStoreEnv(args.env),
      catalog.canonicalKey,
    );
    return buildMatchStoreBoxscorePayload(matchPackage, accessibleTeamIds);
  }

  const boxscore = await dependencies.getLegacyMatchBoxscore(args.env, userId, matchId);
  if (!boxscore) {
    throw new Error("The requested match boxscore is not available in cache.");
  }

  return {
    matchId,
    opponentTeamName: asOptionalString(boxscore.opponentTeamName),
    offStrategy: asOptionalString(boxscore.offStrategy),
    defStrategy: asOptionalString(boxscore.defStrategy),
    opponentOffStrategy: asOptionalString(boxscore.opponentOffStrategy),
    opponentDefStrategy: asOptionalString(boxscore.opponentDefStrategy),
    teamRatings: asRecord(boxscore.teamRatingsJson),
    opponentRatings: asRecord(boxscore.opponentRatingsJson),
    teamEfficiency: asRecord(boxscore.teamEfficiencyJson),
    opponentEfficiency: asRecord(boxscore.opponentEfficiencyJson),
    boxscore: asRecord(boxscore.boxscoreJson),
    source: "LEGACY_CACHE",
  };
}

export async function ingestDiscoveredMatch(
  args: {
    env: GraphqlEnv;
    message: {
      matchId: string;
      season?: number | null;
      teamId: string;
      userId: string;
    };
  },
  dependencies: MatchStoreDependencies = defaultDependencies,
): Promise<Record<string, unknown>> {
  const matchId = args.message.matchId.trim();
  if (!matchId) {
    throw new Error("A match id is required.");
  }

  const matchStoreEnv = resolveMatchStoreEnv(args.env);
  const existingCatalog = await dependencies.getCatalog(matchStoreEnv, matchId);
  if (existingCatalog?.ingestStatus === "SUCCEEDED" && existingCatalog.canonicalKey) {
    return {
      matchId,
      status: "SKIPPED",
      canonicalKey: existingCatalog.canonicalKey,
    };
  }

  const bbClient = dependencies.createBbClient();
  const boxscoreXml = await bbClient.getBoxScoreXml(matchId);
  const reportXml = await dependencies.fetchMatchReport(matchId);
  const lastIngestedAt = new Date().toISOString();
  const rawBoxscoreKey = `raw/${matchId}/boxscore.xml`;
  const rawReportKey = `raw/${matchId}/report.xml`;

  await dependencies.putCatalog(matchStoreEnv, {
    matchId,
    season: args.message.season ?? null,
    ingestStatus: "PENDING",
    rawBoxscoreKey,
    rawReportKey,
    lastIngestedAt,
    lastError: null,
  });
  await dependencies.putTextObject(
    matchStoreEnv,
    rawBoxscoreKey,
    boxscoreXml,
    "application/xml",
  );
  await dependencies.putTextObject(
    matchStoreEnv,
    rawReportKey,
    reportXml,
    "application/xml",
  );

  let matchPackage: Record<string, unknown>;
  try {
    matchPackage = await dependencies.buildMatchPackage({
      boxscoreXml,
      matchId,
      reportXml,
      season: args.message.season ?? null,
      teamId: args.message.teamId,
      userId: args.message.userId,
    });
  } catch (error) {
    await dependencies.putCatalog(matchStoreEnv, {
      matchId,
      season: args.message.season ?? null,
      ingestStatus: "PARTIAL",
      rawBoxscoreKey,
      rawReportKey,
      lastIngestedAt,
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const canonicalKey = `canonical/${matchId}.json`;
  await dependencies.putJsonObject(matchStoreEnv, canonicalKey, matchPackage);

  const catalog = buildCatalogRecordFromPackage(matchPackage, {
    canonicalKey,
    rawBoxscoreKey,
    rawReportKey,
    status: "SUCCEEDED",
    lastIngestedAt,
  });
  await dependencies.putCatalog(matchStoreEnv, catalog);

  for (const projection of buildProjectionRecords(matchPackage, catalog)) {
    await dependencies.putTeamProjection(matchStoreEnv, projection);
  }

  await dependencies.sendMaterializeMessage(args.env, {
    canonicalKey,
    matchId,
  });

  return {
    canonicalKey,
    matchId,
    status: "SUCCEEDED",
  };
}

function buildCatalogRecordFromPackage(
  matchPackage: Record<string, unknown>,
  args: {
    canonicalKey: string;
    rawBoxscoreKey: string | null;
    rawReportKey: string | null;
    status: MatchIngestStatus;
    lastIngestedAt: string;
  },
): MatchCatalogRecord {
  const match = getMatchSummary(matchPackage);
  const homeTeam = asRecord(match.homeTeam) ?? {};
  const awayTeam = asRecord(match.awayTeam) ?? {};

  return {
    matchId: asOptionalString(matchPackage.matchId) ?? "",
    season: getSeason(matchPackage),
    type: asOptionalString(match.type),
    startTime: asOptionalString(match.startTime),
    endTime: asOptionalString(match.endTime),
    neutral: asOptionalBoolean(match.neutral),
    homeTeamId: asOptionalString(homeTeam.id),
    homeTeamName: asOptionalString(homeTeam.teamName),
    homeTeamScore: asOptionalNumber(homeTeam.score),
    awayTeamId: asOptionalString(awayTeam.id),
    awayTeamName: asOptionalString(awayTeam.teamName),
    awayTeamScore: asOptionalNumber(awayTeam.score),
    ingestStatus: args.status,
    parserVersion: asOptionalString(matchPackage.parserVersion),
    contentHash: asOptionalString(matchPackage.contentHash),
    canonicalKey: args.canonicalKey,
    rawBoxscoreKey: args.rawBoxscoreKey,
    rawReportKey: args.rawReportKey,
    eventCount: asOptionalNumber(match.eventCount),
    lastIngestedAt: args.lastIngestedAt,
    lastError: null,
  };
}

function buildProjectionRecords(
  matchPackage: Record<string, unknown>,
  catalog: MatchCatalogRecord,
): TeamMatchProjectionRecord[] {
  const match = getMatchSummary(matchPackage);
  const startTime = asOptionalString(match.startTime) ?? catalog.startTime ?? null;
  const seasonStartMatchKey = buildSeasonStartMatchKey(
    catalog.season ?? null,
    startTime,
    catalog.matchId,
  );

  return [
    {
      teamId: catalog.homeTeamId ?? "",
      seasonStartMatchKey,
      startTime,
      matchId: catalog.matchId,
      season: catalog.season ?? null,
      type: catalog.type ?? null,
      opponentTeamId: catalog.awayTeamId ?? null,
      opponentTeamName: catalog.awayTeamName ?? null,
      teamScore: catalog.homeTeamScore ?? null,
      opponentScore: catalog.awayTeamScore ?? null,
      outcome: deriveOutcome(catalog.homeTeamScore, catalog.awayTeamScore),
      ingestStatus: catalog.ingestStatus,
      canonicalKey: catalog.canonicalKey ?? null,
    },
    {
      teamId: catalog.awayTeamId ?? "",
      seasonStartMatchKey,
      startTime,
      matchId: catalog.matchId,
      season: catalog.season ?? null,
      type: catalog.type ?? null,
      opponentTeamId: catalog.homeTeamId ?? null,
      opponentTeamName: catalog.homeTeamName ?? null,
      teamScore: catalog.awayTeamScore ?? null,
      opponentScore: catalog.homeTeamScore ?? null,
      outcome: deriveOutcome(catalog.awayTeamScore, catalog.homeTeamScore),
      ingestStatus: catalog.ingestStatus,
      canonicalKey: catalog.canonicalKey ?? null,
    },
  ].filter((record) => Boolean(record.teamId));
}

function buildCanonicalMatchPayload(
  catalog: MatchCatalogRecord,
  matchPackage: Record<string, unknown>,
): Record<string, unknown> {
  return {
    matchId: catalog.matchId,
    season: catalog.season ?? null,
    ingestStatus: catalog.ingestStatus,
    parserVersion: catalog.parserVersion ?? null,
    contentHash: catalog.contentHash ?? null,
    canonicalKey: catalog.canonicalKey ?? null,
    derivedManifestKey: catalog.derivedManifestKey ?? null,
    match: getMatchSummary(matchPackage),
    boxscore: matchPackage.boxscore ?? null,
    playByPlay: matchPackage.playByPlay ?? null,
    sourceArtifacts:
      asRecord(matchPackage.sourceArtifacts) ?? asRecord(matchPackage.rawArtifacts) ?? null,
    ingestMetadata: asRecord(matchPackage.ingestMetadata) ?? null,
    source: "CANONICAL_MATCH_STORE",
  };
}

function buildMatchStoreBoxscorePayload(
  matchPackage: Record<string, unknown>,
  accessibleTeamIds: Set<string>,
): Record<string, unknown> {
  const boxscore = asRecord(matchPackage.boxscore) ?? {};
  const homeTeam = asRecord(boxscore.homeTeam) ?? {};
  const awayTeam = asRecord(boxscore.awayTeam) ?? {};
  const homeTeamId = asOptionalString(homeTeam.id);
  const awayTeamId = asOptionalString(awayTeam.id);
  const perspective =
    homeTeamId && accessibleTeamIds.has(homeTeamId)
      ? { team: homeTeam, opponent: awayTeam }
      : awayTeamId && accessibleTeamIds.has(awayTeamId)
        ? { team: awayTeam, opponent: homeTeam }
        : { team: homeTeam, opponent: awayTeam };

  return {
    matchId: asOptionalString(matchPackage.matchId) ?? "",
    opponentTeamName: asOptionalString(perspective.opponent.teamName),
    offStrategy: asOptionalString(perspective.team.offStrategy),
    defStrategy: asOptionalString(perspective.team.defStrategy),
    opponentOffStrategy: asOptionalString(perspective.opponent.offStrategy),
    opponentDefStrategy: asOptionalString(perspective.opponent.defStrategy),
    teamRatings: asRecord(perspective.team.ratings),
    opponentRatings: asRecord(perspective.opponent.ratings),
    teamEfficiency: asRecord(perspective.team.efficiency),
    opponentEfficiency: asRecord(perspective.opponent.efficiency),
    boxscore,
    source: "CANONICAL_MATCH_STORE",
  };
}

async function resolveAccessibleTeamIds(
  env: GraphqlEnv,
  userId: string,
  dependencies: MatchStoreDependencies,
): Promise<Set<string>> {
  const trackedTeams = await dependencies.listTrackedTeams(env, userId, 100);
  const connection = await dependencies.getBbConnection(env, userId);
  const teamIds = new Set<string>();
  for (const team of trackedTeams) {
    const teamId = asOptionalString(team.teamId);
    if (teamId) {
      teamIds.add(teamId);
    }
  }
  if (connection?.teamId) {
    teamIds.add(connection.teamId);
  }
  return teamIds;
}

async function getCatalogRecord(
  env: MatchStoreEnv,
  matchId: string,
): Promise<MatchCatalogRecord | null> {
  const response = await ddbDocumentClient.send(
    new GetCommand({
      TableName: env.catalogTableName,
      Key: { matchId },
    }),
  );
  return (response.Item as MatchCatalogRecord | undefined) ?? null;
}

async function queryTeamProjectionRecords(
  env: MatchStoreEnv,
  teamId: string,
): Promise<TeamMatchProjectionRecord[]> {
  const response = await ddbDocumentClient.send(
    new QueryCommand({
      TableName: env.projectionTableName,
      KeyConditionExpression: "#teamId = :teamId",
      ExpressionAttributeNames: {
        "#teamId": "teamId",
      },
      ExpressionAttributeValues: {
        ":teamId": teamId,
      },
      ScanIndexForward: false,
    }),
  );
  return (response.Items as TeamMatchProjectionRecord[] | undefined) ?? [];
}

async function getJsonObject(
  env: MatchStoreEnv,
  key: string,
): Promise<Record<string, unknown>> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: env.bucketName,
      Key: key,
    }),
  );
  const body = await response.Body?.transformToByteArray();
  if (!body) {
    throw new Error(`S3 object ${key} was empty.`);
  }

  const decoded =
    response.ContentEncoding === "gzip" || key.endsWith(".gz")
      ? gunzipSync(Buffer.from(body)).toString("utf8")
      : Buffer.from(body).toString("utf8");
  return JSON.parse(decoded) as Record<string, unknown>;
}

function resolveMatchStoreEnv(env: GraphqlEnv): MatchStoreEnv {
  const bucketName =
    env.MATCH_STORE_BUCKET_NAME ?? process.env.MATCH_STORE_BUCKET_NAME;
  const catalogTableName =
    env.MATCH_CATALOG_TABLE_NAME ?? process.env.MATCH_CATALOG_TABLE_NAME;
  const projectionTableName =
    env.TEAM_MATCH_PROJECTION_TABLE_NAME ??
    process.env.TEAM_MATCH_PROJECTION_TABLE_NAME;

  if (!bucketName || !catalogTableName || !projectionTableName) {
    throw new Error("Match store infrastructure environment variables are not configured.");
  }

  return {
    bucketName,
    catalogTableName,
    projectionTableName,
  };
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

function isMatchAccessible(
  catalog: MatchCatalogRecord,
  accessibleTeamIds: Set<string>,
): boolean {
  return (
    (catalog.homeTeamId ? accessibleTeamIds.has(catalog.homeTeamId) : false) ||
    (catalog.awayTeamId ? accessibleTeamIds.has(catalog.awayTeamId) : false)
  );
}

function deriveOutcome(
  teamScore?: number | null,
  opponentScore?: number | null,
): string | null {
  if (
    teamScore === null ||
    teamScore === undefined ||
    opponentScore === null ||
    opponentScore === undefined
  ) {
    return null;
  }
  if (teamScore > opponentScore) {
    return "W";
  }
  if (teamScore < opponentScore) {
    return "L";
  }
  return "T";
}

function buildSeasonStartMatchKey(
  season: number | null,
  startTime: string | null,
  matchId: string,
): string {
  return `${season ?? "unknown"}#${startTime ?? "unknown"}#${matchId}`;
}

function choosePreferredProjection(
  current: TeamMatchProjectionRecord | undefined,
  candidate: TeamMatchProjectionRecord,
): TeamMatchProjectionRecord {
  if (!current) {
    return candidate;
  }
  if (current.canonicalKey && !candidate.canonicalKey) {
    return current;
  }
  return candidate;
}

function getProjectionSortKey(record: TeamMatchProjectionRecord): string {
  return (
    record.seasonStartMatchKey ??
    record.startTimeKey ??
    buildSeasonStartMatchKey(record.season ?? null, record.startTime ?? null, record.matchId)
  );
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

function getMatchSummary(matchPackage: Record<string, unknown>): Record<string, unknown> {
  return (
    asRecord(matchPackage.match) ??
    asRecord(matchPackage.summary) ??
    {}
  );
}

function getSeason(matchPackage: Record<string, unknown>): number | null {
  const ingestMetadata = asRecord(matchPackage.ingestMetadata);
  const metadataSeason = asOptionalNumber(ingestMetadata?.season);
  return metadataSeason ?? asOptionalNumber(matchPackage.season);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value
      ? Number(value)
      : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return null;
}
