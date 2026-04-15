import { gunzipSync } from "node:zlib";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  BBXmlApiClient,
  type BBXmlApiClientOptions,
} from "../../../lib/bbapi";
import { TEAM_RATING_KEYS } from "../../../lib/buzzerbeater/team-ratings";
import { resolveBbAccessKey } from "./credentials";
import {
  getBbConnection,
  getMatchBoxscore,
  listTrackedTeamsForUser,
} from "./repository";
import { assertMaintenanceInactive } from "./maintenance";
import { readStoredMatchBoxscoreDetails } from "./stored-boxscore";
import type { Schema } from "../resource";

type GraphqlEnv = Record<string, string | undefined>;
type MatchStoreRuntimeEnv = {
  MATCH_STORE_BUCKET_NAME?: string;
  MATCH_CATALOG_TABLE_NAME?: string;
  TEAM_MATCH_PROJECTION_TABLE_NAME?: string;
};

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type MatchBoxscoreDetailsResult = NonNullable<
  Schema["getMatchBoxscoreDetails"] extends { returnType: infer TReturn }
    ? TReturn
    : never
>;
type AccessibleMatchPageResult = NonNullable<
  Schema["listAccessibleMatches"] extends { returnType: infer TReturn }
    ? TReturn
    : never
>;
type MatchMetricEntry = NonNullable<
  NonNullable<MatchBoxscoreDetailsResult["homeTeam"]>["teamTotals"]
>[number];
type MatchBoxscoreTeamRatingsResult = NonNullable<
  NonNullable<MatchBoxscoreDetailsResult["homeTeam"]>["ratings"]
>;
type MatchContextResult = NonNullable<MatchBoxscoreDetailsResult["context"]>;
type MatchAttendanceResult = NonNullable<MatchBoxscoreDetailsResult["attendance"]>;
type MatchBoxscoreTeamResult = NonNullable<
  MatchBoxscoreDetailsResult["homeTeam"]
>;
type MatchBoxscorePlayerLineResult = MatchBoxscoreTeamResult["players"][number];

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
  getBbConnection: typeof getBbConnection;
  getLegacyMatchBoxscore: typeof getMatchBoxscore;
  listTrackedTeamsForUser: typeof listTrackedTeamsForUser;
  createBbClient: (
    options?: BBXmlApiClientOptions,
  ) => Pick<BBXmlApiClient, "getBoxScore" | "getBoxScoreXml">;
  resolveBbAccessKey: typeof resolveBbAccessKey;
  fetchMatchReport: (matchId: string) => Promise<string>;
  buildMatchPackage: (input: {
    boxscoreXml: string;
    matchId: string;
    reportXml: string | null;
    season?: number | null;
    teamId: string;
    userId: string;
  }) => Promise<Record<string, unknown>>;
  getCatalog: (
    env: MatchStoreEnv,
    matchId: string,
  ) => Promise<MatchCatalogRecord | null>;
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
  getBbConnection,
  getLegacyMatchBoxscore: getMatchBoxscore,
  listTrackedTeamsForUser,
  createBbClient: (options) => {
    if (!options) {
      throw new Error("createBbClient requires BB API credentials.");
    }
    return new BBXmlApiClient(options);
  },
  resolveBbAccessKey,
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
  resolveMatchStoreEnv,
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
): Promise<AccessibleMatchPageResult> {
  await assertMaintenanceInactive();

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
  const lastPageItem = page[page.length - 1];
  const nextCursor =
    page.length === 25 && lastPageItem
      ? encodeCursor(getProjectionSortKey(lastPageItem))
      : null;

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
  await assertMaintenanceInactive();

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
  await assertMaintenanceInactive();

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
    preferLive?: boolean | null;
  },
  dependencies: MatchStoreDependencies = defaultDependencies,
): Promise<MatchBoxscoreDetailsResult> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const matchId = args.matchId.trim();
  if (!matchId) {
    throw new Error("A match id is required.");
  }

  const matchStoreEnv = resolveMatchStoreEnv(args.env);
  const preferLive = args.preferLive ?? false;
  let liveFetchError: unknown = null;

  if (preferLive) {
    try {
      return await fetchLiveMatchBoxscoreDetails(
        args.env,
        userId,
        matchId,
        dependencies,
      );
    } catch (error) {
      liveFetchError = error;
    }
  }

  const catalog = await dependencies.getCatalog(matchStoreEnv, matchId);
  let fallbackPayload: MatchBoxscoreDetailsResult | null = null;
  if (catalog?.canonicalKey) {
    const matchPackage = await dependencies.getJsonObject(
      matchStoreEnv,
      catalog.canonicalKey,
    );
    const payload = buildMatchStoreBoxscorePayload(matchPackage);
    if (hasCompletePredictionRatings(payload)) {
      return payload;
    }
    fallbackPayload = payload;
  }

  const boxscore = await dependencies.getLegacyMatchBoxscore(args.env, userId, matchId);
  if (boxscore) {
    const payload = readStoredMatchBoxscoreDetails(
      boxscore.boxscoreJson,
      "MATCH_BOXSCORE_CACHE",
    );
    if (payload) {
      if (hasCompletePredictionRatings(payload)) {
        return payload;
      }
      fallbackPayload = fallbackPayload ?? payload;
    }
  }

  if (preferLive) {
    if (fallbackPayload) {
      return fallbackPayload;
    }
    throw liveFetchError;
  }

  try {
    return await fetchLiveMatchBoxscoreDetails(
      args.env,
      userId,
      matchId,
      dependencies,
    );
  } catch (error) {
    if (fallbackPayload) {
      return fallbackPayload;
    }
    throw error;
  }
}

async function fetchLiveMatchBoxscoreDetails(
  env: GraphqlEnv,
  userId: string,
  matchId: string,
  dependencies: MatchStoreDependencies,
): Promise<MatchBoxscoreDetailsResult> {
  const connection = await dependencies.getBbConnection(env, userId);
  const bbLoginName = asOptionalString(connection?.bbLoginName);
  if (!bbLoginName) {
    throw new Error(
      "A saved BuzzerBeater login is required to fetch live boxscores.",
    );
  }

  const accessKey = await dependencies.resolveBbAccessKey(env, userId);
  const liveBoxscore = await dependencies
    .createBbClient({
      username: bbLoginName,
      securityCode: accessKey,
    })
    .getBoxScore(matchId);
  const boxscore = asRecord(liveBoxscore);

  return buildNormalizedBoxscorePayload({
    matchId: asOptionalString(boxscore?.matchId) ?? matchId,
    matchType: asOptionalString(boxscore?.type),
    startTime: asOptionalString(boxscore?.startTime),
    endTime: asOptionalString(boxscore?.endTime),
    boxscore,
    source: "LIVE_BB_API",
  });
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
    homeTeamId: readTeamIdentifier(homeTeam),
    homeTeamName: asOptionalString(homeTeam.teamName),
    homeTeamScore: asOptionalNumber(homeTeam.score),
    awayTeamId: readTeamIdentifier(awayTeam),
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
): MatchBoxscoreDetailsResult {
  const match = getMatchSummary(matchPackage);

  return buildNormalizedBoxscorePayload({
    matchId: asOptionalString(matchPackage.matchId) ?? "",
    matchType: asOptionalString(match.type) ?? asOptionalString(matchPackage.type),
    startTime: asOptionalString(match.startTime),
    endTime: asOptionalString(match.endTime),
    boxscore: asRecord(matchPackage.boxscore),
    source: "CANONICAL_MATCH_STORE",
  });
}

function buildNormalizedBoxscorePayload(input: {
  matchId: string;
  matchType: string | null;
  startTime: string | null;
  endTime: string | null;
  boxscore: Record<string, unknown> | null;
  source: MatchBoxscoreDetailsResult["source"];
}): MatchBoxscoreDetailsResult {
  const homeTeam = serializeBoxscoreTeam(asRecord(input.boxscore?.homeTeam));
  const awayTeam = serializeBoxscoreTeam(asRecord(input.boxscore?.awayTeam));

  return {
    matchId: input.matchId,
    matchType: input.matchType,
    startTime: input.startTime,
    endTime: input.endTime,
    attendance: buildMatchAttendance(input.boxscore),
    homeTeam,
    awayTeam,
    context: buildMatchContext(input.boxscore),
    source: input.source,
  };
}

function buildMatchAttendance(
  boxscore: Record<string, unknown> | null,
): MatchAttendanceResult | null {
  const attendance = asRecord(boxscore?.attendance);
  if (!attendance) {
    return null;
  }

  const result = {
    bleachers: asOptionalInteger(attendance.bleachers),
    lowerTier: asOptionalInteger(attendance.lowerTier),
    courtside: asOptionalInteger(attendance.courtside),
    luxury: asOptionalInteger(attendance.luxury),
  } satisfies MatchAttendanceResult;

  return Object.values(result).some((entry) => entry !== null) ? result : null;
}

function hasCompletePredictionRatings(
  payload: MatchBoxscoreDetailsResult,
): boolean {
  return (
    hasCompletePredictionRatingSet(payload.homeTeam) &&
    hasCompletePredictionRatingSet(payload.awayTeam)
  );
}

function hasCompletePredictionRatingSet(
  team: MatchBoxscoreTeamResult | null | undefined,
): boolean {
  if (!team?.ratings) {
    return false;
  }
  return TEAM_RATING_KEYS.every((key) => Number.isFinite(team.ratings?.[key]));
}

function serializeBoxscoreTeam(
  team: Record<string, unknown> | null,
): MatchBoxscoreTeamResult | null {
  if (!team) {
    return null;
  }

  return {
    teamId: readTeamIdentifier(team),
    teamName: asOptionalString(team.teamName),
    shortName: asOptionalString(team.shortName),
    offStrategy: asOptionalString(team.offStrategy),
    defStrategy: asOptionalString(team.defStrategy),
    score: asOptionalNumber(team.score),
    partialScores: toIntegerList(team.partialScores),
    teamTotals: toNumericMetricEntries(
      asRecord(team.teamTotals) ?? asRecord(team.totals),
    ),
    ratings: toMatchBoxscoreTeamRatings(asRecord(team.ratings)),
    efficiency: toNumericMetricEntries(asRecord(team.efficiency)),
    players: toBoxscorePlayerLines(team.players),
  };
}

function toBoxscorePlayerLines(
  value: unknown,
): MatchBoxscorePlayerLineResult[] {
  return toRecordArray(value).map((player) => {
    const minutesByPosition = toNumericMetricEntries(
      asRecord(player.minutesByPosition),
    );

    return {
      playerId: asOptionalString(player.id),
      firstName: asOptionalString(player.firstName),
      lastName: asOptionalString(player.lastName),
      fullName: asOptionalString(player.fullName) ?? "Unknown player",
      isStarter: asOptionalBoolean(asRecord(player.details)?.isStarter) ?? false,
      minutes: sumMetricEntries(minutesByPosition),
      performance: toNumericMetricEntries(
        asRecord(player.performanceStats) ?? asRecord(player.performance),
      ),
      minutesByPosition,
    };
  });
}

function toNumericMetricEntries(
  values: Record<string, unknown> | null,
): MatchMetricEntry[] {
  if (!values) {
    return [];
  }

  return Object.entries(values)
    .filter(([key]) => !key.startsWith("__"))
    .flatMap(([key, rawValue]) => {
      const numberValue = asFiniteNumber(rawValue);
      if (numberValue === null) {
        return [];
      }
      return [{ key, numberValue }];
    })
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function toMatchBoxscoreTeamRatings(
  values: Record<string, unknown> | null,
): MatchBoxscoreTeamRatingsResult | null {
  if (!values) {
    return null;
  }

  const keys = Object.keys(values).filter((key) => !key.startsWith("__"));
  if (!keys.length) {
    return null;
  }

  const outsideScoring = asFiniteNumber(values.outsideScoring);
  const insideScoring = asFiniteNumber(values.insideScoring);
  const outsideDefense = asFiniteNumber(values.outsideDefense);
  const insideDefense = asFiniteNumber(values.insideDefense);
  const rebounding = asFiniteNumber(values.rebounding);
  const offensiveFlow = asFiniteNumber(values.offensiveFlow);

  if (
    outsideScoring === null ||
    insideScoring === null ||
    outsideDefense === null ||
    insideDefense === null ||
    rebounding === null ||
    offensiveFlow === null
  ) {
    return null;
  }

  return {
    outsideScoring,
    insideScoring,
    outsideDefense,
    insideDefense,
    rebounding,
    offensiveFlow,
  };
}

function toIntegerList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asOptionalNumber(entry))
    .filter((entry): entry is number => entry !== null);
}

function sumMetricEntries(entries: MatchMetricEntry[]): number {
  return entries.reduce((total, entry) => total + entry.numberValue, 0);
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = asOptionalNumber(value);
  return numeric !== null && Number.isFinite(numeric) ? numeric : null;
}

function readTeamIdentifier(
  team: Record<string, unknown> | null | undefined,
): string | null {
  return asOptionalString(team?.id) ?? asOptionalString(team?.teamId);
}

function buildMatchContext(
  boxscore: Record<string, unknown> | null,
): MatchContextResult | null {
  if (!boxscore) {
    return null;
  }

  const homeTeam = asRecord(boxscore.homeTeam);
  const awayTeam = asRecord(boxscore.awayTeam);
  return {
    homeTeamName: asOptionalString(homeTeam?.teamName),
    awayTeamName: asOptionalString(awayTeam?.teamName),
    effortDelta: asOptionalNumber(boxscore.effortDelta),
    neutral: asOptionalBoolean(boxscore.neutral),
  };
}

async function resolveAccessibleTeamIds(
  env: GraphqlEnv,
  userId: string,
  dependencies: MatchStoreDependencies,
): Promise<Set<string>> {
  const trackedTeams = await dependencies.listTrackedTeamsForUser(env, userId);
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

function resolveMatchStoreEnv(env: MatchStoreRuntimeEnv): MatchStoreEnv {
  const bucketName = env.MATCH_STORE_BUCKET_NAME;
  const catalogTableName = env.MATCH_CATALOG_TABLE_NAME;
  const projectionTableName = env.TEAM_MATCH_PROJECTION_TABLE_NAME;

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

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
    : [];
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

function asOptionalInteger(value: unknown): number | null {
  const numeric = asOptionalNumber(value);
  return numeric === null || Number.isNaN(numeric) ? null : Math.trunc(numeric);
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
