import { randomUUID } from "node:crypto";

import { BBXmlApiClient, BBXmlApiError } from "../../../lib/bbapi";
import type {
  BBApiBoxScore,
  BBApiBoxScoreTeam,
  BBApiCurrentWorkspace,
  BBApiRosterPlayer,
  BBApiScheduleMatch,
  BBApiStandings,
  BBApiTeamInfo,
  BBApiTeamStats,
} from "../../../lib/bbapi";
import {
  buildActiveTrackedTeamCredentialProjection,
  deactivateActiveTrackedTeamsForUser,
  listActiveTrackedTeamsForUser,
  type ActiveTrackedTeamCredentialProjection,
  upsertActiveTrackedTeam,
} from "./active-tracked-teams";
import {
  listCanonicalPlayerSkillSnapshots,
  upsertCanonicalPlayerSkillSnapshot,
} from "./canonical-player-snapshots";
import { encryptValue, getEncryptionSecret } from "./encryption";
import {
  buildPlayerSkillObservationSortKey,
  createSavedLineupScenario,
  type BbConnectionRecord,
  type BbCredentialRecord,
  type ConnectionStatus,
  createSharedPlayerCard,
  createSyncRun,
  deleteBbCredential,
  getBbConnection,
  getBbCredential,
  getMatchBoxscore,
  getSharedPlayerCardRecord,
  listPlayerSkillObservations,
  listConnectedBbConnections,
  listStaleConnectedBbConnections,
  type PlayerSkillObservationRecord,
  upsertBbConnection,
  upsertBbCredential,
  updateSharedPlayerCard,
  updateSyncRun,
  upsertMatchBoxscore,
  upsertPlayerSkillObservation,
  upsertTrackedTeam,
} from "./repository";
import { resolveBbAccessKey } from "./credentials";
import {
  inferLeagueTimeZone,
  normalizeLeagueTimeZone,
} from "../../../lib/league-timezones";
import type { Schema } from "../resource";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type HomeWorkspaceResult = ResolverResult<"getHomeWorkspace">;
type TeamHubWorkspaceResult = ResolverResult<"getTeamHub">;
type ScoutWorkspaceResult = ResolverResult<"getScoutWorkspace">;
type LeagueIntelWorkspaceResult = ResolverResult<"getLeagueIntel">;
type PlayerLabWorkspaceResult = ResolverResult<"getPlayerLab">;
type PlayerTrendResult = ResolverResult<"getPlayerTrend">;
type MatchBoxscoreDetailsResult = ResolverResult<"getMatchBoxscoreDetails">;
type SharedPlayerCardResult = ResolverResult<"generateSharedPlayerCard">;
type LineupPlanResult = ResolverResult<"getLineupPlan">;
type LineupScenarioResult = ResolverResult<"saveLineupScenario">;
type SalaryProjectionResult = ResolverResult<"getSalaryProjection">;

type PlayerSummaryRecord = TeamHubWorkspaceResult["roster"][number];
type TeamInfoSummary = NonNullable<TeamHubWorkspaceResult["team"]>;
type HomeNextMatchResult = NonNullable<HomeWorkspaceResult["nextMatch"]>;
type MatchSummaryRecord = HomeWorkspaceResult["recentMatches"][number];
type TendenciesSummary = NonNullable<
  NonNullable<HomeWorkspaceResult["nextOpponent"]>["tendencies"]
>;
type TrendCountEntry = TendenciesSummary["offense"][number];
type OpponentSummaryRecord = ScoutWorkspaceResult["availableOpponents"][number];
type SharedPlayerCardPayload = NonNullable<SharedPlayerCardResult["payload"]>;
type MatchMetricEntry = MatchBoxscoreDetailsResult["teamRatings"][number];
type MatchContextResult = NonNullable<MatchBoxscoreDetailsResult["context"]>;
type LineupPlanStarter = LineupPlanResult["recommendedStarters"][number];
type LineupPlanBenchPlayer = LineupPlanResult["benchOrder"][number];
type MinuteTargetEntry = LineupPlanResult["minuteTargets"][number];
type LineupScenarioStarter = LineupScenarioResult["starters"][number];
type SalaryProjectionSource = PlayerSummaryRecord & {
  profileJson?: unknown;
};

type WorkspaceBundle = {
  connection: BbConnectionRecord;
  home: HomeWorkspaceResult;
  teamHub: TeamHubWorkspaceResult;
  scout: ScoutWorkspaceResult;
  leagueIntel: LeagueIntelWorkspaceResult;
  playerLab: PlayerLabWorkspaceResult;
};

export type ActiveTrackedTeamCredentialBackfillResult = {
  connectedUsers: number;
  usersWithProjectedCredentials: number;
  usersMissingCredentials: number;
  trackedTeamsUpdated: number;
};

type ActiveTrackedTeamCredentialContext =
  ActiveTrackedTeamCredentialProjection & {
    bbLoginName: string;
  };

type WorkspaceDependencies = {
  getSharedPlayerCardRecord: typeof getSharedPlayerCardRecord;
  getTrackedPlayer: (
    env: GraphqlEnv,
    userId: string,
    playerId: string,
  ) => Promise<SalaryProjectionSource | null>;
  listWeeklyPlayerSnapshots: (
    env: GraphqlEnv,
    userId: string,
    playerId: string,
  ) => Promise<Record<string, unknown>[]>;
  getMatchBoxscore: typeof getMatchBoxscore;
  updateSharedPlayerCard: typeof updateSharedPlayerCard;
};

const SHARED_PLAYER_CARD_TTL_DAYS = 30;

const defaultWorkspaceDependencies: WorkspaceDependencies = {
  getSharedPlayerCardRecord,
  getTrackedPlayer: getCachedWorkspacePlayer,
  listWeeklyPlayerSnapshots: async (env, userId, playerId) => {
    const [observations, canonicalSnapshots] = await Promise.all([
      listPlayerSkillObservations(env, userId, playerId),
      listCanonicalPlayerSkillSnapshots(env, playerId, 104),
    ]);
    return mergePlayerSkillSnapshotHistory(observations, canonicalSnapshots);
  },
  getMatchBoxscore,
  updateSharedPlayerCard,
};

const backfillRuntime = {
  getBbCredential,
  listActiveTrackedTeamsForUser,
  listConnectedUsers,
  upsertActiveTrackedTeam,
};

export const __testing = {
  backfillRuntime,
  buildConnectionRecord,
  readCachedWorkspace,
  shouldSyncWorkspace,
};

export async function connectAccount(args: {
  env: GraphqlEnv;
  identity: unknown;
  bbLoginName: string;
  accessKey: string;
}): Promise<BbConnectionRecord> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const bbLoginName = args.bbLoginName.trim();
  const accessKey = args.accessKey.trim();
  const existingConnection = await getBbConnection(args.env, userId);

  if (!bbLoginName || !accessKey) {
    const invalidRecord = buildConnectionRecord(userId, existingConnection, {
      bbLoginName,
      status: "INVALID",
      accessKeyLast4: existingConnection?.accessKeyLast4 ?? null,
      lastSyncError:
        "Both the BuzzerBeater login name and access key are required.",
      workspaceCacheJson: null,
    });
    await upsertBbConnection(args.env, invalidRecord);
    return invalidRecord;
  }

  try {
    const client = new BBXmlApiClient({
      username: bbLoginName,
      securityCode: accessKey,
    });
    await client.login();

    const encryptionSecret = getEncryptionSecret(args.env);
    const encryptedAccessKey = encryptValue(accessKey, encryptionSecret);
    await upsertBbCredential(args.env, {
      userId,
      ...encryptedAccessKey,
    });

    const synced = await syncWorkspace({
      env: args.env,
      userId,
      connectionOverride: buildConnectionRecord(userId, existingConnection, {
        bbLoginName,
        status: "CONNECTED",
        accessKeyLast4: maskAccessKey(accessKey),
      }),
      credentialsOverride: { bbLoginName, accessKey },
      credentialOverride: {
        userId,
        ...encryptedAccessKey,
      },
    });

    return synced.connection;
  } catch (error) {
    const record = buildConnectionRecord(userId, existingConnection, {
      bbLoginName,
      status: classifyConnectionError(error),
      accessKeyLast4: existingConnection?.accessKeyLast4 ?? null,
      lastSyncError: toErrorMessage(error),
      workspaceCacheJson: null,
    });
    await upsertBbConnection(args.env, record);
    return record;
  }
}

export async function disconnectAccount(args: {
  env: GraphqlEnv;
  identity: unknown;
}): Promise<BbConnectionRecord> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const existingConnection = await getBbConnection(args.env, userId);
  if (!existingConnection) {
    return buildConnectionRecord(userId, null, {
      bbLoginName: "",
      status: "DISCONNECTED",
    });
  }

  await deleteBbCredential(args.env, userId);
  await deactivateActiveTrackedTeamsForUser(args.env, userId);
  const updated = buildConnectionRecord(userId, existingConnection, {
    bbLoginName: existingConnection.bbLoginName,
    status: "DISCONNECTED",
    accessKeyLast4: null,
    lastSyncError: null,
    workspaceCacheJson: null,
  });
  await upsertBbConnection(args.env, updated);
  return updated;
}

export async function setLeagueTimeZone(args: {
  env: GraphqlEnv;
  identity: unknown;
  leagueTimeZone: string;
}): Promise<BbConnectionRecord> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const existingConnection = await getBbConnection(args.env, userId);
  if (!existingConnection) {
    throw new Error(
      "Connect a BuzzerBeater account before setting a league time zone.",
    );
  }

  const leagueTimeZone = normalizeLeagueTimeZone(args.leagueTimeZone);
  if (!leagueTimeZone) {
    throw new Error("League time zone must be a valid IANA time zone.");
  }

  const updatedConnection = buildConnectionRecord(userId, existingConnection, {
    leagueTimeZone,
  });
  await upsertBbConnection(args.env, updatedConnection);
  return updatedConnection;
}

export async function getOrRefreshWorkspace(args: {
  env: GraphqlEnv;
  identity: unknown;
  force?: boolean;
}): Promise<WorkspaceBundle> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  return syncWorkspace({
    env: args.env,
    userId,
    force: args.force ?? false,
  });
}

export async function listConnectedUsers(
  env: GraphqlEnv,
): Promise<BbConnectionRecord[]> {
  const connections: BbConnectionRecord[] = [];
  let nextToken: string | null = null;

  do {
    const page = await listConnectedBbConnections(env, {
      limit: 100,
      nextToken,
    });
    connections.push(...page.records);
    nextToken = page.nextToken;
  } while (nextToken);

  return connections;
}

export async function listStaleConnectedUsers(args: {
  env: GraphqlEnv;
  staleAfterHours: number;
  maxUsers?: number;
  dedupeByTeam?: boolean;
}): Promise<BbConnectionRecord[]> {
  const maxUsers = Math.max(1, args.maxUsers ?? Number.MAX_SAFE_INTEGER);
  const staleBefore = new Date(
    Date.now() - args.staleAfterHours * 60 * 60 * 1000,
  ).toISOString();
  const selected = new Map<string, BbConnectionRecord>();
  const staleConnections: BbConnectionRecord[] = [];
  let nextToken: string | null = null;

  do {
    const page = await listStaleConnectedBbConnections(args.env, staleBefore, {
      limit: Math.max(25, maxUsers),
      nextToken,
    });

    for (const connection of page.records) {
      if (args.dedupeByTeam) {
        const key = connection.teamId ?? `user:${connection.userId}`;
        if (!selected.has(key)) {
          selected.set(key, connection);
        }
      } else {
        staleConnections.push(connection);
      }
    }

    if (
      (args.dedupeByTeam ? selected.size : staleConnections.length) >= maxUsers
    ) {
      break;
    }

    nextToken = page.nextToken;
  } while (nextToken);

  const orderedConnections = args.dedupeByTeam
    ? Array.from(selected.values())
    : staleConnections;
  orderedConnections.sort(
    (left, right) =>
      connectionFreshnessSortKey(left) - connectionFreshnessSortKey(right),
  );

  return orderedConnections.slice(0, maxUsers);
}

export async function backfillActiveTrackedTeamCredentialProjection(
  env: GraphqlEnv,
): Promise<ActiveTrackedTeamCredentialBackfillResult> {
  const connections = await backfillRuntime.listConnectedUsers(env);
  let usersWithProjectedCredentials = 0;
  let usersMissingCredentials = 0;
  let trackedTeamsUpdated = 0;

  for (const connection of connections) {
    const credential = await backfillRuntime.getBbCredential(
      env,
      connection.userId,
    );
    if (!credential) {
      usersMissingCredentials += 1;
      continue;
    }

    usersWithProjectedCredentials += 1;
    const credentialContext = buildActiveTrackedTeamCredentialContext(
      connection.bbLoginName,
      credential,
    );
    const activeTrackedTeams =
      await backfillRuntime.listActiveTrackedTeamsForUser(
        env,
        connection.userId,
      );

    for (const trackedTeam of activeTrackedTeams) {
      if (!trackedTeam.active) {
        continue;
      }

      await backfillRuntime.upsertActiveTrackedTeam(env, {
        ...trackedTeam,
        bbLoginName: connection.bbLoginName,
        credentialCipherText: credentialContext.credentialCipherText,
        credentialIv: credentialContext.credentialIv,
        credentialAuthTag: credentialContext.credentialAuthTag,
        credentialAlgorithm: credentialContext.credentialAlgorithm,
        updatedAt: new Date().toISOString(),
      });
      trackedTeamsUpdated += 1;
    }
  }

  return {
    connectedUsers: connections.length,
    usersWithProjectedCredentials,
    usersMissingCredentials,
    trackedTeamsUpdated,
  };
}

export async function generatePlayerCard(args: {
  env: GraphqlEnv;
  identity: unknown;
  playerId: string;
  title?: string | null;
  note?: string | null;
}): Promise<SharedPlayerCardResult> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }
  const player = await getCachedWorkspacePlayer(
    args.env,
    userId,
    args.playerId,
  );
  if (!player) {
    throw new Error(
      "The requested player is not available in the current workspace.",
    );
  }

  const shareToken = randomUUID();
  const title =
    normalizeSharedCardText(args.title) ?? asString(player.fullName);
  const note = normalizeSharedCardText(args.note);
  const expiresAt = new Date(
    Date.now() + SHARED_PLAYER_CARD_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const payload = buildSharedPlayerCardPayload(player);

  await createSharedPlayerCard(args.env, {
    shareToken,
    userId,
    playerId: args.playerId,
    title,
    note,
    expiresAt,
    revokedAt: null,
    payloadJson: payload,
  });

  return buildSharedPlayerCardResponse({
    shareToken,
    title,
    note,
    expiresAt,
    revokedAt: null,
    payload,
  });
}

export async function revokePlayerCard(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    shareToken: string;
  },
  dependencies: WorkspaceDependencies = defaultWorkspaceDependencies,
): Promise<SharedPlayerCardResult> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const shareToken = args.shareToken.trim();
  if (!shareToken) {
    throw new Error("A shared player card token is required.");
  }

  const record = await dependencies.getSharedPlayerCardRecord(
    args.env,
    shareToken,
  );
  if (!record || record.userId !== userId) {
    throw new Error("The requested shared player card was not found.");
  }

  const revokedAt = record.revokedAt ?? new Date().toISOString();
  await dependencies.updateSharedPlayerCard(args.env, {
    shareToken,
    revokedAt,
  });

  return buildSharedPlayerCardResponse({
    shareToken: record.shareToken,
    title: record.title ?? null,
    note: record.note ?? null,
    expiresAt: record.expiresAt ?? null,
    revokedAt,
    payload: sanitizeSharedPlayerCardPayload(record.payloadJson),
  });
}

export async function getScoutWorkspaceForTeam(args: {
  env: GraphqlEnv;
  identity: unknown;
  teamId?: string | null;
}): Promise<{ connection: BbConnectionRecord; scout: ScoutWorkspaceResult }> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const baseWorkspace = await getOrRefreshWorkspace({
    env: args.env,
    identity: args.identity,
  });

  const requestedTeamId = args.teamId?.trim() ?? "";
  if (
    !requestedTeamId ||
    requestedTeamId === (baseWorkspace.scout.teamId ?? null)
  ) {
    return {
      connection: baseWorkspace.connection,
      scout: {
        syncedAt: baseWorkspace.scout.syncedAt ?? null,
        teamId: baseWorkspace.scout.teamId ?? null,
        availableOpponents: baseWorkspace.scout.availableOpponents,
        recentMatchups: baseWorkspace.scout.recentMatchups,
        summary: baseWorkspace.scout.summary ?? null,
        requestedTeamId: requestedTeamId || baseWorkspace.scout.teamId || null,
        message: baseWorkspace.scout.message ?? null,
      },
    };
  }

  const accessKey = await resolveAccessKey(args.env, userId);
  const client = new BBXmlApiClient({
    username: baseWorkspace.connection.bbLoginName,
    securityCode: accessKey,
  });

  const currentWorkspace = await client.getCurrentWorkspace();
  const recentMatches = selectRecentMatches(
    currentWorkspace.schedule.matches,
    currentWorkspace.teamInfo.teamId,
  );
  const currentBoxScores = await fetchRecentBoxScores(client, recentMatches);
  const opponentWorkspace = await fetchOpponentWorkspace(
    client,
    requestedTeamId,
    currentWorkspace,
  );
  const fetchedAt = new Date().toISOString();
  const credentialContext = await loadActiveTrackedTeamCredentialContext(
    args.env,
    userId,
    baseWorkspace.connection.bbLoginName,
  );

  await persistWorkspace(
    args.env,
    userId,
    currentWorkspace,
    recentMatches,
    currentBoxScores,
    opponentWorkspace,
    fetchedAt,
    credentialContext,
  );

  return {
    connection: baseWorkspace.connection,
    scout: buildScoutWorkspace(
      currentWorkspace,
      currentBoxScores,
      opponentWorkspace,
      requestedTeamId,
      fetchedAt,
    ),
  };
}

export async function lookupSharedPlayerCardByToken(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    shareToken: string;
  },
  dependencies: WorkspaceDependencies = defaultWorkspaceDependencies,
): Promise<SharedPlayerCardResult | null> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const shareToken = args.shareToken.trim();
  if (!shareToken) {
    throw new Error("A shared player card token is required.");
  }

  const record = await dependencies.getSharedPlayerCardRecord(
    args.env,
    shareToken,
  );
  if (
    !record ||
    record.userId !== userId ||
    !isSharedPlayerCardActive(record)
  ) {
    return null;
  }

  const payload = sanitizeSharedPlayerCardPayload(record.payloadJson);
  if (!payload) {
    return null;
  }

  return buildSharedPlayerCardResponse({
    shareToken: record.shareToken,
    title: record.title ?? null,
    note: record.note ?? null,
    expiresAt: record.expiresAt ?? null,
    revokedAt: record.revokedAt ?? null,
    payload,
  });
}

export async function getPlayerTrend(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    playerId: string;
  },
  dependencies: WorkspaceDependencies = defaultWorkspaceDependencies,
): Promise<PlayerTrendResult> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const playerId = args.playerId.trim();
  if (!playerId) {
    throw new Error("A player id is required.");
  }

  const [player, snapshots] = await Promise.all([
    dependencies.getTrackedPlayer(args.env, userId, playerId),
    dependencies.listWeeklyPlayerSnapshots(args.env, userId, playerId),
  ]);

  if (!player) {
    throw new Error(
      "The requested player is not available in the current workspace.",
    );
  }

  const history = snapshots
    .sort((left, right) =>
      String(
        left.capturedAt ?? left.fetchedAt ?? left.weekKey ?? "",
      ).localeCompare(
        String(right.capturedAt ?? right.fetchedAt ?? right.weekKey ?? ""),
      ),
    )
    .map((snapshot, index) => ({
      weekKey:
        asString(snapshot.weekKey) ??
        asString(snapshot.capturedAt ?? snapshot.fetchedAt) ??
        `snapshot-${index + 1}`,
      fetchedAt: asString(snapshot.capturedAt ?? snapshot.fetchedAt),
      salary: asNumber(snapshot.salary),
      dmi: asNumber(snapshot.dmi),
      injuryWeeks: asNumber(snapshot.injuryWeeks),
      gameShape: asString(snapshot.gameShape),
    }));

  return {
    player: projectPlayerSummary(player),
    history,
  };
}

export async function getMatchBoxscoreDetails(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    matchId: string;
  },
  dependencies: WorkspaceDependencies = defaultWorkspaceDependencies,
): Promise<MatchBoxscoreDetailsResult> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const matchId = args.matchId.trim();
  if (!matchId) {
    throw new Error("A match id is required.");
  }

  const boxscore = await dependencies.getMatchBoxscore(
    args.env,
    userId,
    matchId,
  );
  if (!boxscore) {
    throw new Error("The requested match boxscore is not available in cache.");
  }

  return {
    matchId,
    opponentTeamName: asString(boxscore.opponentTeamName),
    offStrategy: asString(boxscore.offStrategy),
    defStrategy: asString(boxscore.defStrategy),
    opponentOffStrategy: asString(boxscore.opponentOffStrategy),
    opponentDefStrategy: asString(boxscore.opponentDefStrategy),
    teamRatings: toMetricEntries(toRecord(boxscore.teamRatingsJson)),
    opponentRatings: toMetricEntries(toRecord(boxscore.opponentRatingsJson)),
    teamEfficiency: toMetricEntries(toRecord(boxscore.teamEfficiencyJson)),
    opponentEfficiency: toMetricEntries(
      toRecord(boxscore.opponentEfficiencyJson),
    ),
    context: buildMatchContext(toRecord(boxscore.boxscoreJson)),
    source: "LEGACY_CACHE",
  };
}

export async function getLineupPlan(args: {
  env: GraphqlEnv;
  identity: unknown;
}): Promise<LineupPlanResult> {
  const workspace = await getOrRefreshWorkspace({
    env: args.env,
    identity: args.identity,
  });

  return buildLineupPlanPayload(workspace);
}

export async function saveLineupScenario(args: {
  env: GraphqlEnv;
  identity: unknown;
  name: string;
  starters: unknown;
  minuteTargets: unknown;
  note?: string | null;
}): Promise<LineupScenarioResult> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const name = args.name.trim();
  if (!name) {
    throw new Error("A lineup scenario name is required.");
  }

  const scenarioId = randomUUID();
  const savedAt = new Date().toISOString();
  const starters = toLineupScenarioStarters(args.starters);
  const minuteTargets = toMinuteTargetEntries(args.minuteTargets);

  if (!starters.length) {
    throw new Error("At least one starter must be provided.");
  }

  if (!minuteTargets.length) {
    throw new Error("Minute targets must be provided.");
  }

  await createSavedLineupScenario(args.env, {
    scenarioId,
    userId,
    name,
    startersJson: starters,
    minuteTargetsJson: minuteTargets,
    note: args.note?.trim() || null,
    savedAt,
  });

  return {
    scenarioId,
    name,
    savedAt,
    starters,
    minuteTargets,
    note: args.note?.trim() || null,
  };
}

export async function getSalaryProjection(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    playerId: string;
  },
  dependencies: WorkspaceDependencies = defaultWorkspaceDependencies,
): Promise<SalaryProjectionResult> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const playerId = args.playerId.trim();
  if (!playerId) {
    throw new Error("A player id is required.");
  }

  const [player, snapshots, connection] = await Promise.all([
    dependencies.getTrackedPlayer(args.env, userId, playerId),
    dependencies.listWeeklyPlayerSnapshots(args.env, userId, playerId),
    getBbConnection(args.env, userId),
  ]);

  if (!player) {
    throw new Error(
      "The requested player is not available in the current workspace.",
    );
  }

  return buildSalaryProjectionPayload({
    player,
    snapshots,
    teamCountryName: connection?.countryName ?? null,
  });
}

export function buildLineupPlanPayload(
  workspace: WorkspaceBundle,
): LineupPlanResult {
  const roster = workspace.teamHub.roster;
  if (!roster.length) {
    throw new Error("No cached roster is available for lineup planning.");
  }

  const rankedPlayers = roster
    .map((player) => {
      const projectedStarterCount = asNumber(player.projectedStarterCount) ?? 0;
      const ppg = asNumber(player.ppg) ?? 0;
      const salary = asNumber(player.salary) ?? 0;
      const dmi = asNumber(player.dmi) ?? 0;
      const injuryWeeks = asNumber(player.injuryWeeks) ?? 0;
      const shapeBonus = gameShapeScore(asString(player.gameShape));
      const position = normalizePosition(asString(player.bestPosition));
      const score =
        projectedStarterCount * 12 +
        ppg * 6 +
        shapeBonus * 5 +
        Math.min(18, salary / 1000) +
        Math.min(10, dmi / 10000) -
        injuryWeeks * 20;

      return {
        playerId: asString(player.playerId),
        fullName: asString(player.fullName) ?? "Unknown player",
        bestPosition: position ?? asString(player.bestPosition),
        salary,
        age: asNumber(player.age),
        gameShape: asString(player.gameShape),
        dmi,
        injuryWeeks,
        projectedStarterCount,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const positions = ["PG", "SG", "SF", "PF", "C"] as const;
  const usedPlayerIds = new Set<string>();
  const recommendedStarters: LineupPlanStarter[] = positions.flatMap(
    (position, index) => {
      const exact = rankedPlayers.find(
        (player) =>
          player.playerId &&
          !usedPlayerIds.has(player.playerId) &&
          player.bestPosition === position,
      );
      const fallback = rankedPlayers.find(
        (player) => player.playerId && !usedPlayerIds.has(player.playerId),
      );
      const selected = exact ?? fallback;
      if (!selected?.playerId) {
        return [];
      }

      usedPlayerIds.add(selected.playerId);
      return [
        {
          playerId: selected.playerId,
          fullName: selected.fullName,
          bestPosition: position,
          projectedStarterCount: selected.projectedStarterCount,
          salary: selected.salary,
          gameShape: selected.gameShape,
          score: Number(selected.score.toFixed(2)),
          slot: index + 1,
        },
      ];
    },
  );

  const benchOrder: LineupPlanBenchPlayer[] = rankedPlayers
    .filter((player) => player.playerId && !usedPlayerIds.has(player.playerId))
    .map((player, index) => ({
      playerId: player.playerId as string,
      fullName: player.fullName,
      bestPosition: player.bestPosition,
      projectedStarterCount: player.projectedStarterCount,
      score: Number(player.score.toFixed(2)),
      benchSlot: index + 1,
    }))
    .slice(0, 7);

  const minuteTargets = recommendedStarters.map((player, index) => ({
    playerId: player.playerId,
    minutes: suggestMinutes(player.gameShape ?? null, index),
  }));

  const homeInjuries = workspace.home.team.injuries;
  const scoutSummary = workspace.scout.summary;
  const offenseTendencies = summarizeLeaningTendencies(
    scoutSummary?.tendencies.offense ?? null,
  );
  const defenseTendencies = summarizeLeaningTendencies(
    scoutSummary?.tendencies.defense ?? null,
  );

  const rotationNotes = [
    recommendedStarters.length === 5
      ? `Locked five-man core built from roster form, box-score starts, and per-game output.`
      : "Roster depth is thin enough that the starting five is only partially confidence-backed.",
    benchOrder[0]
      ? `${benchOrder[0].fullName} is the first bench trigger if the matchup turns volatile.`
      : "No reliable bench stabilizer is available yet.",
    offenseTendencies
      ? `Scout offense leans ${offenseTendencies}; prioritize guards with stable shape and DMI.`
      : "Opponent offense trends are still sparse, so the plan leans on your internal form data.",
    defenseTendencies
      ? `Scout defense leans ${defenseTendencies}; keep your best shot creators in the opening unit.`
      : "Opponent defensive trend data is limited, so lineup confidence is moderate.",
  ].filter((note): note is string => Boolean(note));

  const matchupRationale = [
    homeInjuries.length
      ? `${homeInjuries.length} active injury alert${homeInjuries.length === 1 ? "" : "s"} are reducing lineup flexibility.`
      : "Healthy core available for a standard rotation.",
    recommendedStarters[0]
      ? `${recommendedStarters[0].fullName} grades as the lineup anchor on current form and usage.`
      : null,
    scoutSummary?.teamName
      ? `Plan tuned for ${asString(scoutSummary.teamName)} using the cached scout workspace.`
      : "Plan is based on your current roster without an explicit opponent scout target.",
  ].filter((note): note is string => Boolean(note));

  const confidenceInputs = recommendedStarters.reduce(
    (total, player) =>
      total + ((player.projectedStarterCount ?? 0) > 0 ? 1 : 0),
    0,
  );
  const confidence = Math.max(
    0.35,
    Math.min(0.92, Number(((confidenceInputs + 2) / 8).toFixed(2))),
  );

  return {
    generatedAt: new Date().toISOString(),
    recommendedStarters,
    benchOrder,
    minuteTargets,
    rotationNotes,
    matchupRationale,
    injuryAlerts: homeInjuries.map((injury) => ({
      playerId: asString(injury.playerId),
      fullName: asString(injury.fullName) ?? "Unknown player",
      injuryWeeks: asNumber(injury.injuryWeeks),
    })),
    confidence,
  };
}

export function buildSalaryProjectionPayload(args: {
  player: SalaryProjectionSource;
  snapshots: Record<string, unknown>[];
  teamCountryName: string | null;
}): SalaryProjectionResult {
  const player = args.player;
  const profile = toRecord(player.profileJson);
  const profileNationality = toRecord(profile?.nationality);
  const orderedSnapshots = collapseSnapshotsToLatestPeriod(args.snapshots);
  const salarySeries = orderedSnapshots
    .map((snapshot) => asNumber(snapshot.salary))
    .filter((salary): salary is number => salary !== null);
  const currentSalary =
    salarySeries[salarySeries.length - 1] ??
    asNumber(player.salary) ??
    asNumber(profile?.salary);
  const deltas = salarySeries.slice(1).map((salary, index) => {
    const previousSalary = salarySeries[index];
    return salary - (previousSalary ?? salary);
  });
  const recentDeltas = deltas.slice(-3);
  const weeklyDelta = recentDeltas.length
    ? Math.round(
        recentDeltas.reduce((sum, value) => sum + value, 0) /
          recentDeltas.length,
      )
    : 0;
  const projectedSalary =
    currentSalary === null ? null : Math.max(0, currentSalary + weeklyDelta);
  const trend = classifySalaryTrend(recentDeltas, weeklyDelta);
  const nationalityName =
    asString(player.nationalityName) ??
    asString(profileNationality?.name) ??
    null;
  const isFlagTarget = Boolean(
    nationalityName &&
    args.teamCountryName &&
    nationalityName.toLowerCase() === args.teamCountryName.toLowerCase(),
  );

  return {
    playerId: asString(player.playerId) ?? "",
    fullName: asString(player.fullName) ?? "Unknown player",
    bestPosition:
      asString(player.bestPosition) ?? asString(profile?.bestPosition),
    nationalityName,
    currentSalary,
    projectedSalary,
    weeklyDelta,
    trend,
    isFlagTarget,
    flagReason: isFlagTarget
      ? `${nationalityName} matches your club country for flag-chasing workflows.`
      : nationalityName && args.teamCountryName
        ? `${nationalityName} does not match ${args.teamCountryName}.`
        : "Country matching is unavailable until both roster nationality and club country are known.",
  };
}

function mergePlayerSkillSnapshotHistory(
  observations: PlayerSkillObservationRecord[],
  canonicalSnapshots: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();

  for (const snapshot of canonicalSnapshots) {
    const key = buildPlayerSnapshotHistoryKey(snapshot);
    if (key) {
      merged.set(key, snapshot);
    }
  }

  for (const observation of observations) {
    const key = buildPlayerSnapshotHistoryKey(observation);
    if (key) {
      merged.set(key, observation);
    }
  }

  return Array.from(merged.values());
}

function buildPlayerSnapshotHistoryKey(
  snapshot: Record<string, unknown>,
): string | null {
  return (
    asString(snapshot.capturedAt ?? snapshot.fetchedAt) ??
    asString(snapshot.weekKey)
  );
}

function collapseSnapshotsToLatestPeriod(
  snapshots: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const latestByPeriod = new Map<string, Record<string, unknown>>();
  const orderedSnapshots = [...snapshots].sort((left, right) =>
    String(
      left.capturedAt ?? left.fetchedAt ?? left.weekKey ?? "",
    ).localeCompare(
      String(right.capturedAt ?? right.fetchedAt ?? right.weekKey ?? ""),
    ),
  );

  for (const snapshot of orderedSnapshots) {
    const key =
      asString(snapshot.weekKey) ??
      asString(snapshot.capturedAt ?? snapshot.fetchedAt);
    if (!key) {
      continue;
    }
    latestByPeriod.set(key, snapshot);
  }

  return Array.from(latestByPeriod.values()).sort((left, right) =>
    String(
      left.capturedAt ?? left.fetchedAt ?? left.weekKey ?? "",
    ).localeCompare(
      String(right.capturedAt ?? right.fetchedAt ?? right.weekKey ?? ""),
    ),
  );
}

async function syncWorkspace(args: {
  env: GraphqlEnv;
  userId: string;
  force?: boolean;
  connectionOverride?: BbConnectionRecord;
  credentialsOverride?: { bbLoginName: string; accessKey: string };
  credentialOverride?: BbCredentialRecord;
}): Promise<WorkspaceBundle> {
  const connection =
    args.connectionOverride ?? (await getBbConnection(args.env, args.userId));

  if (!connection) {
    throw new Error(
      "No BuzzerBeater connection has been configured for this user.",
    );
  }

  const cachedWorkspace = readCachedWorkspace(connection);
  if (
    cachedWorkspace &&
    !shouldSyncWorkspace({ force: args.force ?? false, cachedWorkspace })
  ) {
    return cachedWorkspace;
  }

  const syncRun = await createSyncRun(args.env, {
    userId: args.userId,
    kind: "workspace-refresh",
    status: "SYNCING",
    startedAt: new Date().toISOString(),
    detailsJson: {
      teamId: connection.teamId ?? null,
    },
  });

  try {
    const accessKey =
      args.credentialsOverride?.accessKey ??
      (await resolveAccessKey(args.env, args.userId));
    const bbLoginName =
      args.credentialsOverride?.bbLoginName ?? connection.bbLoginName;

    const client = new BBXmlApiClient({
      username: bbLoginName,
      securityCode: accessKey,
    });

    const currentWorkspace = await client.getCurrentWorkspace();
    const nextMatch = selectNextMatch(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
    );
    const recentMatches = selectRecentMatches(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
    );
    const currentBoxScores = await fetchRecentBoxScores(client, recentMatches);
    const nextOpponentTeamId = nextMatch
      ? deriveOpponentTeamId(nextMatch, currentWorkspace.teamInfo.teamId)
      : null;

    const opponentWorkspace = nextOpponentTeamId
      ? await fetchOpponentWorkspace(
          client,
          nextOpponentTeamId,
          currentWorkspace,
        )
      : null;

    const now = new Date().toISOString();
    const connectionForViews = buildConnectionRecord(args.userId, connection, {
      bbLoginName,
      status: "CONNECTED",
      accessKeyLast4: maskAccessKey(accessKey),
      teamId: currentWorkspace.teamInfo.teamId,
      teamName: currentWorkspace.teamInfo.teamName,
      shortName: currentWorkspace.teamInfo.shortName,
      leagueId: currentWorkspace.teamInfo.league?.id ?? null,
      leagueName: currentWorkspace.teamInfo.league?.name ?? null,
      countryId: currentWorkspace.teamInfo.country?.id ?? null,
      countryName: currentWorkspace.teamInfo.country?.name ?? null,
      leagueTimeZone:
        connection.leagueTimeZone ??
        inferLeagueTimeZone({
          countryId: currentWorkspace.teamInfo.country?.id ?? null,
          countryName: currentWorkspace.teamInfo.country?.name ?? null,
        }),
      connectedAt: connection.connectedAt ?? now,
      lastValidatedAt: now,
      lastSyncAt: now,
      lastSyncError: null,
      profileJson: currentWorkspace.teamInfo,
    });
    const home = buildHomeWorkspace(
      currentWorkspace,
      nextMatch,
      recentMatches,
      currentBoxScores,
      opponentWorkspace,
      connectionForViews,
    );
    const teamHub = buildTeamHub(
      currentWorkspace,
      currentBoxScores,
      connectionForViews.lastSyncAt ?? null,
    );
    const scout = buildScoutWorkspace(
      currentWorkspace,
      currentBoxScores,
      opponentWorkspace,
      nextOpponentTeamId,
      connectionForViews.lastSyncAt ?? null,
    );
    const leagueIntel = buildLeagueIntel(currentWorkspace.standings);
    const playerLab = buildPlayerLab(
      currentWorkspace,
      currentBoxScores,
      connectionForViews.lastSyncAt ?? null,
    );

    const updatedConnection = buildConnectionRecord(
      args.userId,
      connectionForViews,
      {
        workspaceCacheJson: {
          home,
          teamHub,
          scout,
          leagueIntel,
          playerLab,
        },
      },
    );
    const credentialContext = await loadActiveTrackedTeamCredentialContext(
      args.env,
      args.userId,
      bbLoginName,
      args.credentialOverride,
    );

    await upsertBbConnection(args.env, updatedConnection);
    await persistWorkspace(
      args.env,
      args.userId,
      currentWorkspace,
      recentMatches,
      currentBoxScores,
      opponentWorkspace,
      now,
      credentialContext,
    );

    await updateSyncRun(args.env, {
      id: syncRun.id,
      status: "SUCCEEDED",
      completedAt: now,
      detailsJson: {
        nextOpponentTeamId,
      },
    });

    return {
      connection: updatedConnection,
      home,
      teamHub,
      scout,
      leagueIntel,
      playerLab,
    };
  } catch (error) {
    const now = new Date().toISOString();
    const failedConnection = buildConnectionRecord(args.userId, connection, {
      bbLoginName: connection.bbLoginName,
      status: classifyConnectionError(error),
      lastSyncAt: connection.lastSyncAt ?? null,
      lastSyncError: toErrorMessage(error),
      lastValidatedAt: connection.lastValidatedAt ?? null,
    });
    await upsertBbConnection(args.env, failedConnection);
    await updateSyncRun(args.env, {
      id: syncRun.id,
      status: "FAILED",
      completedAt: now,
      error: toErrorMessage(error),
    });
    throw error;
  }
}

async function persistWorkspace(
  env: GraphqlEnv,
  userId: string,
  workspace: BBApiCurrentWorkspace,
  recentMatches: BBApiScheduleMatch[],
  currentBoxScores: BBApiBoxScore[],
  opponentWorkspace: OpponentWorkspace | null,
  fetchedAt: string,
  connectionCredential: ActiveTrackedTeamCredentialContext,
): Promise<void> {
  const primaryTeamId = workspace.teamInfo.teamId;
  if (!primaryTeamId) {
    throw new Error("Workspace team info did not include a primary teamId.");
  }

  await upsertTrackedTeam(env, {
    userId,
    teamId: primaryTeamId,
    name: workspace.teamInfo.teamName ?? "Unknown team",
    shortName: workspace.teamInfo.shortName ?? null,
    leagueId: workspace.teamInfo.league?.id ?? null,
    leagueName: workspace.teamInfo.league?.name ?? null,
    countryId: workspace.teamInfo.country?.id ?? null,
    countryName: workspace.teamInfo.country?.name ?? null,
    rivalId: workspace.teamInfo.rival?.id ?? null,
    isPrimary: true,
    summaryJson: workspace.teamInfo,
    fetchedAt,
  });
  await upsertActiveTrackedTeam(env, {
    userId,
    teamId: primaryTeamId,
    teamName: workspace.teamInfo.teamName ?? "Unknown team",
    bbLoginName: connectionCredential.bbLoginName,
    credentialCipherText: connectionCredential.credentialCipherText,
    credentialIv: connectionCredential.credentialIv,
    credentialAuthTag: connectionCredential.credentialAuthTag,
    credentialAlgorithm: connectionCredential.credentialAlgorithm,
    active: true,
    isPrimary: true,
    fetchedAt,
    updatedAt: fetchedAt,
  });

  if (opponentWorkspace?.teamInfo.teamId) {
    await upsertTrackedTeam(env, {
      userId,
      teamId: opponentWorkspace.teamInfo.teamId,
      name: opponentWorkspace.teamInfo.teamName ?? "Unknown opponent",
      shortName: opponentWorkspace.teamInfo.shortName ?? null,
      leagueId: opponentWorkspace.teamInfo.league?.id ?? null,
      leagueName: opponentWorkspace.teamInfo.league?.name ?? null,
      countryId: opponentWorkspace.teamInfo.country?.id ?? null,
      countryName: opponentWorkspace.teamInfo.country?.name ?? null,
      rivalId: opponentWorkspace.teamInfo.rival?.id ?? null,
      isPrimary: false,
      summaryJson: opponentWorkspace.teamInfo,
      fetchedAt,
    });
    await upsertActiveTrackedTeam(env, {
      userId,
      teamId: opponentWorkspace.teamInfo.teamId,
      teamName: opponentWorkspace.teamInfo.teamName ?? "Unknown opponent",
      bbLoginName: connectionCredential.bbLoginName,
      credentialCipherText: connectionCredential.credentialCipherText,
      credentialIv: connectionCredential.credentialIv,
      credentialAuthTag: connectionCredential.credentialAuthTag,
      credentialAlgorithm: connectionCredential.credentialAlgorithm,
      active: true,
      isPrimary: false,
      fetchedAt,
      updatedAt: fetchedAt,
    });
  }

  for (const player of workspace.roster.players) {
    const snapshot = playerToCanonicalPlayerSnapshot(
      userId,
      workspace.teamInfo.teamId,
      workspace.teamInfo.teamName,
      player,
      fetchedAt,
    );
    const observation = playerToHistoricalPlayerObservation(
      userId,
      workspace.teamInfo.teamId,
      workspace.teamInfo.teamName,
      player,
      fetchedAt,
    );
    await Promise.all([
      upsertCanonicalPlayerSkillSnapshot(env, snapshot),
      upsertPlayerSkillObservation(env, observation),
    ]);
  }

  for (const boxScore of [
    ...currentBoxScores,
    ...(opponentWorkspace?.recentBoxScores ?? []),
  ]) {
    const perspective = determinePerspective(
      boxScore,
      workspace.teamInfo.teamId,
      opponentWorkspace?.teamInfo.teamId ?? null,
    );
    await upsertMatchBoxscore(env, {
      userId,
      matchId: boxScore.matchId,
      teamId: perspective.teamId,
      opponentTeamId: perspective.opponentTeamId,
      opponentTeamName: perspective.opponentTeamName,
      offStrategy: perspective.team.offStrategy ?? null,
      defStrategy: perspective.team.defStrategy ?? null,
      opponentOffStrategy: perspective.opponent.offStrategy ?? null,
      opponentDefStrategy: perspective.opponent.defStrategy ?? null,
      teamRatingsJson: perspective.team.ratings,
      opponentRatingsJson: perspective.opponent.ratings,
      teamEfficiencyJson: perspective.team.efficiency,
      opponentEfficiencyJson: perspective.opponent.efficiency,
      boxscoreJson: boxScore,
      fetchedAt,
    });
  }
}

type OpponentWorkspace = {
  teamInfo: BBApiTeamInfo;
  roster: { players: BBApiRosterPlayer[] };
  teamStats: BBApiTeamStats | null;
  nextMatch: BBApiScheduleMatch | null;
  recentMatches: BBApiScheduleMatch[];
  recentBoxScores: BBApiBoxScore[];
};

async function fetchOpponentWorkspace(
  client: BBXmlApiClient,
  opponentTeamId: string,
  currentWorkspace: BBApiCurrentWorkspace,
): Promise<OpponentWorkspace> {
  const [teamInfo, roster, teamStats, schedule] = await Promise.all([
    client.getTeamInfo(opponentTeamId),
    client.getRoster(opponentTeamId),
    client
      .getTeamStats(
        opponentTeamId,
        currentWorkspace.schedule.season ?? undefined,
        "averages",
      )
      .catch(() => null),
    client.getSchedule(
      opponentTeamId,
      currentWorkspace.schedule.season ?? undefined,
    ),
  ]);

  const recentMatches = selectRecentMatches(schedule.matches, opponentTeamId);
  const recentBoxScores = await fetchRecentBoxScores(client, recentMatches);

  return {
    teamInfo,
    roster,
    teamStats,
    nextMatch: selectNextMatch(schedule.matches, opponentTeamId),
    recentMatches,
    recentBoxScores,
  };
}

async function fetchRecentBoxScores(
  client: BBXmlApiClient,
  matches: BBApiScheduleMatch[],
): Promise<BBApiBoxScore[]> {
  const selected = matches.slice(0, 5);
  const boxScores = await Promise.all(
    selected.map(async (match) => {
      try {
        return await client.getBoxScore(match.id ?? undefined);
      } catch {
        return null;
      }
    }),
  );

  return boxScores.filter(
    (boxScore): boxScore is BBApiBoxScore => boxScore !== null,
  );
}

function buildHomeWorkspace(
  workspace: BBApiCurrentWorkspace,
  nextMatch: BBApiScheduleMatch | null,
  recentMatches: BBApiScheduleMatch[],
  currentBoxScores: BBApiBoxScore[],
  opponentWorkspace: OpponentWorkspace | null,
  connection: BbConnectionRecord,
): HomeWorkspaceResult {
  const cachedMatchIds = new Set(
    currentBoxScores.map((boxScore) => boxScore.matchId),
  );
  return {
    syncedAt: connection.lastSyncAt ?? null,
    connection,
    team: {
      teamId: workspace.teamInfo.teamId,
      teamName: workspace.teamInfo.teamName,
      shortName: workspace.teamInfo.shortName,
      record: lookupRecord(workspace.standings, workspace.teamInfo.teamId),
      injuries: workspace.roster.players
        .filter((player) => (player.injuryWeeks ?? 0) > 0)
        .map((player) => ({
          playerId: player.id,
          fullName: player.fullName,
          injuryWeeks: player.injuryWeeks,
        })),
      topPlayers: buildTopPlayers(
        workspace.roster.players,
        workspace.teamStats,
      ),
    },
    nextMatch: nextMatch
      ? buildHomeNextMatch(nextMatch, workspace.teamInfo.teamId)
      : null,
    nextOpponent: opponentWorkspace
      ? {
          teamId: opponentWorkspace.teamInfo.teamId,
          teamName: opponentWorkspace.teamInfo.teamName,
          record: lookupRecord(
            workspace.standings,
            opponentWorkspace.teamInfo.teamId,
          ),
          injuries: opponentWorkspace.roster.players
            .filter((player) => (player.injuryWeeks ?? 0) > 0)
            .map((player) => ({
              playerId: player.id,
              fullName: player.fullName,
              injuryWeeks: player.injuryWeeks,
            })),
          tendencies: summarizeTendencies(
            opponentWorkspace.recentBoxScores,
            opponentWorkspace.teamInfo.teamId,
          ),
        }
      : null,
    recentMatches: recentMatches.map((match) =>
      buildMatchSummary(
        match,
        workspace.teamInfo.teamId,
        Boolean(match.id && cachedMatchIds.has(match.id)),
      ),
    ),
    league: buildLeagueIntel(workspace.standings),
  };
}

function buildTeamHub(
  workspace: BBApiCurrentWorkspace,
  currentBoxScores: BBApiBoxScore[],
  syncedAt: string | null,
): TeamHubWorkspaceResult {
  const starterCounts = countStarters(
    currentBoxScores,
    workspace.teamInfo.teamId,
  );
  return {
    syncedAt,
    team: projectTeamInfo(workspace.teamInfo),
    roster: workspace.roster.players.map((player) => ({
      playerId: player.id,
      fullName: player.fullName,
      bestPosition: player.bestPosition,
      nationalityName: player.nationality?.name ?? null,
      salary: player.salary,
      age: player.age,
      gameShape: asString(player.skills.gameShape),
      dmi: player.dmi,
      injuryWeeks: player.injuryWeeks,
      projectedStarterCount: starterCounts[player.id ?? ""] ?? 0,
      ppg: extractPpg(workspace.teamStats, player),
    })),
  };
}

export function buildScoutWorkspace(
  currentWorkspace: BBApiCurrentWorkspace,
  currentBoxScores: BBApiBoxScore[],
  opponentWorkspace: OpponentWorkspace | null,
  requestedTeamId: string | null,
  syncedAt: string | null,
): ScoutWorkspaceResult {
  const availableOpponents = buildAvailableOpponents(
    currentWorkspace.standings,
    currentWorkspace.teamInfo.teamId,
    opponentWorkspace?.teamInfo,
  );

  if (!opponentWorkspace) {
    return {
      syncedAt,
      teamId: null,
      availableOpponents,
      recentMatchups: [],
      summary: null,
      requestedTeamId,
      message: "No upcoming opponent is available yet.",
    };
  }

  const tendencies = summarizeTendencies(
    opponentWorkspace.recentBoxScores,
    opponentWorkspace.teamInfo.teamId,
  );
  const cachedOpponentMatchIds = new Set(
    [...currentBoxScores, ...opponentWorkspace.recentBoxScores]
      .map((boxScore) => boxScore.matchId)
      .filter((matchId): matchId is string => Boolean(matchId)),
  );
  const effortByMatchId = new Map(
    opponentWorkspace.recentBoxScores
      .filter((boxScore) => Boolean(boxScore.matchId))
      .map((boxScore) => [
        boxScore.matchId as string,
        boxScore.effortDelta ?? null,
      ]),
  );
  const recentMatchups = buildRecentMatchups(
    currentWorkspace.schedule.matches,
    currentWorkspace.teamInfo.teamId,
    opponentWorkspace.teamInfo.teamId,
    cachedOpponentMatchIds,
  );

  return {
    syncedAt,
    teamId: opponentWorkspace.teamInfo.teamId,
    availableOpponents,
    recentMatchups,
    requestedTeamId: requestedTeamId ?? opponentWorkspace.teamInfo.teamId,
    summary: {
      teamName: opponentWorkspace.teamInfo.teamName,
      nextMatch: opponentWorkspace.nextMatch
        ? buildMatchSummary(
            opponentWorkspace.nextMatch,
            opponentWorkspace.teamInfo.teamId,
            Boolean(
              opponentWorkspace.nextMatch.id &&
              cachedOpponentMatchIds.has(opponentWorkspace.nextMatch.id),
            ),
            opponentWorkspace.nextMatch.id
              ? (effortByMatchId.get(opponentWorkspace.nextMatch.id) ?? null)
              : null,
          )
        : null,
      record: lookupRecord(
        currentWorkspace.standings,
        opponentWorkspace.teamInfo.teamId,
      ),
      matchupPerspective: {
        ourTeamId: currentWorkspace.teamInfo.teamId,
        opponentTeamId: opponentWorkspace.teamInfo.teamId,
      },
      tendencies,
      roster: opponentWorkspace.roster.players.map((player) => ({
        playerId: player.id,
        fullName: player.fullName,
        bestPosition: player.bestPosition,
        age: player.age,
        salary: player.salary,
        gameShape: asString(player.skills.gameShape),
        dmi: player.dmi,
        injuryWeeks: player.injuryWeeks,
        projectedStarterCount: null,
        ppg: extractPpg(opponentWorkspace.teamStats, player),
      })),
      topPlayers: buildTopPlayers(
        opponentWorkspace.roster.players,
        opponentWorkspace.teamStats,
      ),
      recentGames: opponentWorkspace.recentMatches.map((match) =>
        buildMatchSummary(
          match,
          opponentWorkspace.teamInfo.teamId,
          Boolean(match.id && cachedOpponentMatchIds.has(match.id)),
          match.id ? (effortByMatchId.get(match.id) ?? null) : null,
        ),
      ),
    },
  };
}

function buildLeagueIntel(
  standings: BBApiStandings | null,
): LeagueIntelWorkspaceResult {
  if (!standings) {
    return {
      league: null,
      standings: [],
    };
  }

  return {
    league: standings.league,
    standings: standings.conferences.map((conference) => ({
      index: conference.index,
      teams: conference.teams.map((team) => ({
        teamId: team.id,
        teamName: team.teamName,
        wins: team.wins,
        losses: team.losses,
        pointMargin:
          team.pf !== null && team.pa !== null ? team.pf - team.pa : null,
      })),
    })),
  };
}

function buildAvailableOpponents(
  standings: BBApiStandings | null,
  currentTeamId: string | null,
  selectedTeam: BBApiTeamInfo | null | undefined,
): OpponentSummaryRecord[] {
  const teams =
    standings?.conferences
      .flatMap((conference) => conference.teams)
      .filter((team) => team.id !== currentTeamId)
      .map((team) => ({
        teamId: team.id,
        teamName: team.teamName,
        wins: team.wins,
        losses: team.losses,
        pointMargin:
          team.pf !== null && team.pa !== null ? team.pf - team.pa : null,
      })) ?? [];

  if (
    selectedTeam?.teamId &&
    !teams.some((team) => team.teamId === selectedTeam.teamId)
  ) {
    teams.unshift({
      teamId: selectedTeam.teamId,
      teamName: selectedTeam.teamName,
      wins: null,
      losses: null,
      pointMargin: null,
    });
  }

  return teams.sort((left, right) =>
    String(left.teamName ?? "").localeCompare(String(right.teamName ?? "")),
  );
}

function buildRecentMatchups(
  matches: BBApiScheduleMatch[],
  currentTeamId: string | null,
  opponentTeamId: string | null,
  cachedMatchIds: Set<string>,
): MatchSummaryRecord[] {
  return matches
    .filter(
      (match) => deriveOpponentTeamId(match, currentTeamId) === opponentTeamId,
    )
    .filter((match) => deriveTeamScore(match, currentTeamId) !== null)
    .sort(byStartTimeDescending)
    .slice(0, 5)
    .map((match) =>
      buildMatchSummary(
        match,
        currentTeamId,
        Boolean(match.id && cachedMatchIds.has(match.id)),
      ),
    );
}

function buildHomeNextMatch(
  match: BBApiScheduleMatch,
  teamId: string | null,
): HomeNextMatchResult {
  return {
    matchId: match.id,
    startTime: match.startTime,
    type: match.type,
    opponentTeamId: deriveOpponentTeamId(match, teamId),
    opponentTeamName: deriveOpponentTeamName(match, teamId),
    isHome: isTeamHome(match, teamId),
  };
}

function buildMatchSummary(
  match: BBApiScheduleMatch,
  teamId: string | null,
  hasBoxscore: boolean,
  effortDelta: number | null = null,
): MatchSummaryRecord {
  return {
    matchId: match.id,
    startTime: match.startTime,
    type: match.type,
    opponentTeamName: deriveOpponentTeamName(match, teamId),
    teamScore: deriveTeamScore(match, teamId),
    opponentScore: deriveOpponentScore(match, teamId),
    outcome: deriveOutcome(match, teamId),
    effortDelta,
    hasBoxscore,
  };
}

function buildPlayerLab(
  workspace: BBApiCurrentWorkspace,
  currentBoxScores: BBApiBoxScore[],
  syncedAt: string | null,
): PlayerLabWorkspaceResult {
  const starterCounts = countStarters(
    currentBoxScores,
    workspace.teamInfo.teamId,
  );
  return {
    syncedAt,
    players: workspace.roster.players.map((player) => ({
      playerId: player.id,
      fullName: player.fullName,
      bestPosition: player.bestPosition,
      nationalityName: player.nationality?.name ?? null,
      salary: player.salary,
      age: player.age,
      gameShape: asString(player.skills.gameShape),
      dmi: player.dmi,
      injuryWeeks: player.injuryWeeks,
      projectedStarterCount: starterCounts[player.id ?? ""] ?? 0,
      ppg: extractPpg(workspace.teamStats, player),
    })),
  };
}

function playerToCanonicalPlayerSnapshot(
  userId: string,
  teamId: string | null,
  teamName: string | null,
  player: BBApiRosterPlayer,
  fetchedAt: string,
): {
  playerId: string;
  weekKey: string;
  teamId: string;
  teamName: string | null;
  sourceUserId: string;
  capturedAt: string;
  firstName: string | null;
  lastName: string | null;
  salary: number | null;
  bestPosition: string | null;
  gameShape: string | null;
  dmi: number | null;
  injuryWeeks: number | null;
  payload: Record<string, unknown>;
} {
  if (!player.id || !teamId) {
    throw new Error(
      "Canonical player snapshots require both a player id and team id.",
    );
  }

  return {
    playerId: player.id,
    weekKey: getWeekKey(new Date(fetchedAt)),
    teamId,
    teamName,
    sourceUserId: userId,
    capturedAt: fetchedAt,
    firstName: player.firstName,
    lastName: player.lastName,
    salary: player.salary,
    bestPosition: player.bestPosition,
    gameShape: asString(player.skills.gameShape),
    dmi: player.dmi,
    injuryWeeks: player.injuryWeeks,
    payload: {
      playerId: player.id,
      fullName: player.fullName,
      age: player.age,
      height: player.height,
      nationalityName: player.nationality?.name ?? null,
      profile: player,
    },
  };
}

function playerToHistoricalPlayerObservation(
  userId: string,
  teamId: string | null,
  teamName: string | null,
  player: BBApiRosterPlayer,
  fetchedAt: string,
): PlayerSkillObservationRecord {
  if (!player.id || !teamId) {
    throw new Error(
      "Historical player observations require both a player id and team id.",
    );
  }

  return {
    userId,
    playerId: player.id,
    capturedAt: fetchedAt,
    playerCapturedAtKey: buildPlayerSkillObservationSortKey(
      player.id,
      fetchedAt,
    ),
    weekKey: getWeekKey(new Date(fetchedAt)),
    teamId,
    teamName,
    fullName: player.fullName,
    bestPosition: player.bestPosition,
    salary: player.salary,
    gameShape: asString(player.skills.gameShape),
    dmi: player.dmi,
    injuryWeeks: player.injuryWeeks,
  };
}

function determinePerspective(
  boxScore: BBApiBoxScore,
  primaryTeamId: string | null,
  secondaryTeamId: string | null,
): {
  teamId: string | null;
  opponentTeamId: string | null;
  opponentTeamName: string | null;
  team: BBApiBoxScoreTeam;
  opponent: BBApiBoxScoreTeam;
} {
  if (
    boxScore.homeTeam.id === primaryTeamId ||
    boxScore.awayTeam.id === primaryTeamId
  ) {
    const team =
      boxScore.homeTeam.id === primaryTeamId
        ? boxScore.homeTeam
        : boxScore.awayTeam;
    const opponent =
      team === boxScore.homeTeam ? boxScore.awayTeam : boxScore.homeTeam;
    return {
      teamId: primaryTeamId,
      opponentTeamId: opponent.id,
      opponentTeamName: opponent.teamName,
      team,
      opponent,
    };
  }

  if (
    secondaryTeamId &&
    (boxScore.homeTeam.id === secondaryTeamId ||
      boxScore.awayTeam.id === secondaryTeamId)
  ) {
    const team =
      boxScore.homeTeam.id === secondaryTeamId
        ? boxScore.homeTeam
        : boxScore.awayTeam;
    const opponent =
      team === boxScore.homeTeam ? boxScore.awayTeam : boxScore.homeTeam;
    return {
      teamId: secondaryTeamId,
      opponentTeamId: opponent.id,
      opponentTeamName: opponent.teamName,
      team,
      opponent,
    };
  }

  return {
    teamId: boxScore.homeTeam.id,
    opponentTeamId: boxScore.awayTeam.id,
    opponentTeamName: boxScore.awayTeam.teamName,
    team: boxScore.homeTeam,
    opponent: boxScore.awayTeam,
  };
}

function selectNextMatch(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
): BBApiScheduleMatch | null {
  return (
    [...matches]
      .filter(
        (match) =>
          deriveTeamScore(match, teamId) === null ||
          deriveOpponentScore(match, teamId) === null,
      )
      .sort(byStartTimeAscending)[0] ?? null
  );
}

function selectRecentMatches(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
): BBApiScheduleMatch[] {
  return [...matches]
    .filter(
      (match) =>
        deriveTeamScore(match, teamId) !== null &&
        deriveOpponentScore(match, teamId) !== null,
    )
    .sort(byStartTimeDescending)
    .slice(0, 5);
}

function countStarters(
  boxScores: BBApiBoxScore[],
  teamId: string | null,
): Record<string, number> {
  return boxScores.reduce<Record<string, number>>((accumulator, boxScore) => {
    const team =
      boxScore.homeTeam.id === teamId ? boxScore.homeTeam : boxScore.awayTeam;
    for (const player of team.players) {
      const started = asBoolean(player.details.isStarter) ?? false;
      if (started && player.id) {
        accumulator[player.id] = (accumulator[player.id] ?? 0) + 1;
      }
    }
    return accumulator;
  }, {});
}

function summarizeTendencies(
  boxScores: BBApiBoxScore[],
  teamId: string | null,
): TendenciesSummary {
  const offense = new Map<string, number>();
  const defense = new Map<string, number>();

  for (const boxScore of boxScores) {
    const team =
      boxScore.homeTeam.id === teamId ? boxScore.homeTeam : boxScore.awayTeam;
    if (team.offStrategy) {
      offense.set(team.offStrategy, (offense.get(team.offStrategy) ?? 0) + 1);
    }
    if (team.defStrategy) {
      defense.set(team.defStrategy, (defense.get(team.defStrategy) ?? 0) + 1);
    }
  }

  return {
    offense: toTrendEntries(offense),
    defense: toTrendEntries(defense),
  };
}

function toTrendEntries(values: Map<string, number>): TrendCountEntry[] {
  return Array.from(values.entries())
    .map(([key, count]) => ({
      key,
      count,
    }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function toMetricEntries(
  values: Record<string, unknown> | null,
): MatchMetricEntry[] {
  if (!values) {
    return [];
  }

  return Object.entries(values)
    .filter(([key]) => !key.startsWith("__"))
    .map(([key, rawValue]) => {
      const numberValue = asNumber(rawValue);
      return {
        key,
        numberValue,
        textValue: numberValue === null ? asString(rawValue) : null,
      };
    })
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function buildMatchContext(
  boxscore: Record<string, unknown> | null,
): MatchContextResult | null {
  if (!boxscore) {
    return null;
  }

  const homeTeam = toRecord(boxscore.homeTeam);
  const awayTeam = toRecord(boxscore.awayTeam);
  return {
    homeTeamName: asString(homeTeam?.teamName),
    awayTeamName: asString(awayTeam?.teamName),
    effortDelta: asNumber(boxscore.effortDelta),
    neutral: asBoolean(boxscore.neutral),
  };
}

function projectTeamInfo(teamInfo: BBApiTeamInfo): TeamInfoSummary {
  return {
    teamId: teamInfo.teamId,
    teamName: teamInfo.teamName,
    shortName: teamInfo.shortName,
    ownerName: teamInfo.ownerName,
    isBot: teamInfo.isBot,
    league: teamInfo.league,
    country: teamInfo.country,
    rival: teamInfo.rival,
  };
}

function projectPlayerSummary(
  player: PlayerSummaryRecord,
): PlayerSummaryRecord {
  return {
    playerId: asString(player.playerId),
    fullName: asString(player.fullName) ?? "Unknown player",
    bestPosition: asString(player.bestPosition),
    nationalityName: asString(player.nationalityName),
    salary: asNumber(player.salary),
    age: asNumber(player.age),
    gameShape: asString(player.gameShape),
    dmi: asNumber(player.dmi),
    injuryWeeks: asNumber(player.injuryWeeks),
    projectedStarterCount: asNumber(player.projectedStarterCount),
    ppg: asNumber(player.ppg),
  };
}

function toLineupScenarioStarters(value: unknown): LineupScenarioStarter[] {
  return toRecordArray(value)
    .map((player) => ({
      playerId: asString(player.playerId) ?? "",
      fullName: asString(player.fullName) ?? "Unknown player",
      bestPosition: asString(player.bestPosition),
      projectedStarterCount: asNumber(player.projectedStarterCount),
      salary: asNumber(player.salary),
      gameShape: asString(player.gameShape),
      score: asNumber(player.score),
      slot: asNumber(player.slot),
      benchSlot: asNumber(player.benchSlot),
    }))
    .filter((player) => Boolean(player.playerId));
}

function toMinuteTargetEntries(value: unknown): MinuteTargetEntry[] {
  const source = toRecord(value);
  if (source) {
    return Object.entries(source)
      .map(([playerId, minutes]) => ({
        playerId,
        minutes: asNumber(minutes),
      }))
      .filter(
        (entry): entry is { playerId: string; minutes: number } =>
          Boolean(entry.playerId) && entry.minutes !== null,
      );
  }

  return toRecordArray(value)
    .map((entry) => ({
      playerId: asString(entry.playerId) ?? "",
      minutes: asNumber(entry.minutes),
    }))
    .filter(
      (entry): entry is { playerId: string; minutes: number } =>
        Boolean(entry.playerId) && entry.minutes !== null,
    );
}

function buildTopPlayers(
  rosterPlayers: BBApiRosterPlayer[],
  teamStats: BBApiTeamStats | null,
): PlayerSummaryRecord[] {
  return rosterPlayers
    .map((player) => ({
      playerId: player.id,
      fullName: player.fullName,
      bestPosition: player.bestPosition,
      salary: player.salary,
      ppg: extractPpg(teamStats, player),
    }))
    .sort((left, right) => {
      const leftPpg = asNumber(left.ppg);
      const rightPpg = asNumber(right.ppg);
      return (rightPpg ?? 0) - (leftPpg ?? 0);
    })
    .slice(0, 5);
}

function extractPpg(
  teamStats: BBApiTeamStats | null,
  player: BBApiRosterPlayer,
): number | null {
  const statsEntry = teamStats?.players.find((entry) => entry.id === player.id);
  return asNumber(statsEntry?.stats?.ppg);
}

function lookupRecord(
  standings: BBApiStandings | null,
  teamId: string | null,
): { wins: number | null; losses: number | null } | null {
  const team = standings?.conferences
    .flatMap((conference) => conference.teams)
    .find((entry) => entry.id === teamId);

  return team
    ? {
        wins: team.wins,
        losses: team.losses,
      }
    : null;
}

function deriveOpponentTeamId(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  if (!teamId) {
    return match.homeTeam.id;
  }
  return match.homeTeam.id === teamId ? match.awayTeam.id : match.homeTeam.id;
}

function deriveOpponentTeamName(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  if (!teamId) {
    return match.homeTeam.teamName;
  }
  return match.homeTeam.id === teamId
    ? match.awayTeam.teamName
    : match.homeTeam.teamName;
}

function deriveTeamScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (!teamId) {
    return null;
  }
  return match.homeTeam.id === teamId
    ? match.homeTeam.score
    : match.awayTeam.score;
}

function deriveOpponentScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (!teamId) {
    return null;
  }
  return match.homeTeam.id === teamId
    ? match.awayTeam.score
    : match.homeTeam.score;
}

function deriveOutcome(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  const teamScore = deriveTeamScore(match, teamId);
  const opponentScore = deriveOpponentScore(match, teamId);
  if (teamScore === null || opponentScore === null) {
    return "PENDING";
  }
  return teamScore > opponentScore ? "WIN" : "LOSS";
}

function isTeamHome(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean | null {
  if (!teamId) {
    return null;
  }
  return match.homeTeam.id === teamId;
}

function buildSharedPlayerCardResponse(input: {
  shareToken: string;
  title?: string | null;
  note?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  payload?: SharedPlayerCardPayload | null;
}): SharedPlayerCardResult {
  return {
    shareToken: input.shareToken,
    shareUrl: null,
    title: input.title ?? null,
    note: input.note ?? null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: input.revokedAt ?? null,
    payload: input.payload ?? null,
  };
}

function buildSharedPlayerCardPayload(
  player: Record<string, unknown>,
): SharedPlayerCardPayload {
  return {
    player: {
      playerId: asString(player.playerId),
      fullName: asString(player.fullName) ?? "Unknown player",
      bestPosition: asString(player.bestPosition),
      salary: asNumber(player.salary),
      nationalityName: asString(player.nationalityName),
      gameShape: asString(player.gameShape),
      dmi: asNumber(player.dmi),
      injuryWeeks: asNumber(player.injuryWeeks),
    },
  };
}

function sanitizeSharedPlayerCardPayload(
  payload: unknown,
): SharedPlayerCardPayload | null {
  const source = toRecord(payload);
  const player = toRecord(source?.player);
  if (!player) {
    return null;
  }

  return buildSharedPlayerCardPayload(player);
}

function isSharedPlayerCardActive(record: {
  expiresAt?: string | null;
  revokedAt?: string | null;
}): boolean {
  if (record.revokedAt) {
    return false;
  }

  if (!record.expiresAt) {
    return false;
  }

  const expiresAt = new Date(record.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt > Date.now();
}

function normalizeSharedCardText(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  const stringValue = asString(value);
  if (!stringValue) {
    return null;
  }
  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
  const stringValue = asString(value)?.toLowerCase();
  if (!stringValue) {
    return null;
  }
  if (["1", "true", "yes"].includes(stringValue)) {
    return true;
  }
  if (["0", "false", "no"].includes(stringValue)) {
    return false;
  }
  return null;
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

async function loadActiveTrackedTeamCredentialContext(
  env: GraphqlEnv,
  userId: string,
  bbLoginName: string,
  credentialOverride?: BbCredentialRecord,
): Promise<ActiveTrackedTeamCredentialContext> {
  const credential =
    credentialOverride ?? (await requireBbCredentialRecord(env, userId));
  return buildActiveTrackedTeamCredentialContext(bbLoginName, credential);
}

async function requireBbCredentialRecord(
  env: GraphqlEnv,
  userId: string,
): Promise<BbCredentialRecord> {
  const credential = await getBbCredential(env, userId);
  if (!credential) {
    throw new Error("No encrypted BuzzerBeater credential is available.");
  }
  return credential;
}

function buildActiveTrackedTeamCredentialContext(
  bbLoginName: string,
  credential: BbCredentialRecord,
): ActiveTrackedTeamCredentialContext {
  return {
    bbLoginName,
    ...buildActiveTrackedTeamCredentialProjection(credential),
  };
}

async function resolveAccessKey(
  env: GraphqlEnv,
  userId: string,
): Promise<string> {
  return resolveBbAccessKey(env, userId);
}

function buildConnectionRecord(
  userId: string,
  existingConnection: BbConnectionRecord | null,
  updates: Partial<BbConnectionRecord>,
): BbConnectionRecord {
  const record: Omit<BbConnectionRecord, "refreshSortAt"> = {
    userId,
    bbLoginName: resolveConnectionField(
      existingConnection,
      updates,
      "bbLoginName",
      "",
    ),
    status: resolveConnectionField(
      existingConnection,
      updates,
      "status",
      "UNSET",
    ),
    accessKeyLast4: resolveConnectionField(
      existingConnection,
      updates,
      "accessKeyLast4",
      null,
    ),
    teamId: resolveConnectionField(existingConnection, updates, "teamId", null),
    teamName: resolveConnectionField(
      existingConnection,
      updates,
      "teamName",
      null,
    ),
    shortName: resolveConnectionField(
      existingConnection,
      updates,
      "shortName",
      null,
    ),
    leagueId: resolveConnectionField(
      existingConnection,
      updates,
      "leagueId",
      null,
    ),
    leagueName: resolveConnectionField(
      existingConnection,
      updates,
      "leagueName",
      null,
    ),
    countryId: resolveConnectionField(
      existingConnection,
      updates,
      "countryId",
      null,
    ),
    countryName: resolveConnectionField(
      existingConnection,
      updates,
      "countryName",
      null,
    ),
    leagueTimeZone: resolveConnectionField(
      existingConnection,
      updates,
      "leagueTimeZone",
      null,
    ),
    connectedAt: resolveConnectionField(
      existingConnection,
      updates,
      "connectedAt",
      null,
    ),
    lastValidatedAt: resolveConnectionField(
      existingConnection,
      updates,
      "lastValidatedAt",
      null,
    ),
    lastSyncAt: resolveConnectionField(
      existingConnection,
      updates,
      "lastSyncAt",
      null,
    ),
    lastSyncError: resolveConnectionField(
      existingConnection,
      updates,
      "lastSyncError",
      null,
    ),
    profileJson: resolveConnectionField(
      existingConnection,
      updates,
      "profileJson",
      null,
    ),
    workspaceCacheJson: resolveConnectionField(
      existingConnection,
      updates,
      "workspaceCacheJson",
      null,
    ),
  };

  const requestedRefreshSortAt = Object.prototype.hasOwnProperty.call(
    updates,
    "refreshSortAt",
  )
    ? updates.refreshSortAt
    : existingConnection?.refreshSortAt;

  return {
    ...record,
    refreshSortAt:
      requestedRefreshSortAt ??
      record.lastSyncAt ??
      record.connectedAt ??
      record.lastValidatedAt ??
      existingConnection?.refreshSortAt ??
      new Date().toISOString(),
  };
}

function resolveConnectionField<Key extends keyof BbConnectionRecord>(
  existingConnection: BbConnectionRecord | null,
  updates: Partial<BbConnectionRecord>,
  key: Key,
  fallback: BbConnectionRecord[Key],
): BbConnectionRecord[Key] {
  const value = Object.prototype.hasOwnProperty.call(updates, key)
    ? updates[key]
    : existingConnection?.[key];

  return value === undefined ? fallback : value;
}

function readCachedWorkspace(
  connection: BbConnectionRecord,
): WorkspaceBundle | null {
  const cache = connection.workspaceCacheJson;
  if (!cache || typeof cache !== "object") {
    return null;
  }

  const typedCache = cache as Record<string, unknown>;
  const home = toRecord(typedCache.home);
  const teamHub = toRecord(typedCache.teamHub);
  const scout = toRecord(typedCache.scout);
  const leagueIntel = toRecord(typedCache.leagueIntel);
  const playerLab = toRecord(typedCache.playerLab);

  if (!home || !teamHub || !scout || !leagueIntel || !playerLab) {
    return null;
  }

  const syncedAt = connection.lastSyncAt ?? null;

  return {
    connection,
    home: {
      ...home,
      connection,
      syncedAt: asString(home.syncedAt) ?? syncedAt,
    } as unknown as HomeWorkspaceResult,
    teamHub: {
      ...teamHub,
      syncedAt: asString(teamHub.syncedAt) ?? syncedAt,
    } as unknown as TeamHubWorkspaceResult,
    scout: {
      ...scout,
      syncedAt: asString(scout.syncedAt) ?? syncedAt,
    } as unknown as ScoutWorkspaceResult,
    leagueIntel: leagueIntel as unknown as LeagueIntelWorkspaceResult,
    playerLab: {
      ...playerLab,
      syncedAt: asString(playerLab.syncedAt) ?? syncedAt,
    } as unknown as PlayerLabWorkspaceResult,
  };
}

async function getCachedWorkspacePlayer(
  env: GraphqlEnv,
  userId: string,
  playerId: string,
): Promise<SalaryProjectionSource | null> {
  const connection = await getBbConnection(env, userId);
  const cachedWorkspace = connection ? readCachedWorkspace(connection) : null;
  if (!cachedWorkspace) {
    return null;
  }

  const candidates = [
    ...cachedWorkspace.teamHub.roster,
    ...cachedWorkspace.playerLab.players,
  ];

  return (
    candidates.find((player) => asString(player.playerId) === playerId) ?? null
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function normalizePosition(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized.startsWith("PG")) {
    return "PG";
  }
  if (normalized.startsWith("SG")) {
    return "SG";
  }
  if (normalized.startsWith("SF")) {
    return "SF";
  }
  if (normalized.startsWith("PF")) {
    return "PF";
  }
  if (normalized === "C" || normalized.startsWith("CENTER")) {
    return "C";
  }

  return null;
}

function gameShapeScore(value: string | null): number {
  switch ((value ?? "").toLowerCase()) {
    case "proficient":
      return 4;
    case "strong":
      return 3.5;
    case "respectable":
      return 3;
    case "mediocre":
      return 2;
    case "inept":
      return 1;
    default:
      return 2.5;
  }
}

function suggestMinutes(gameShape: string | null, slotIndex: number): number {
  const baseBySlot = [36, 34, 32, 30, 28][slotIndex] ?? 24;
  const shapeModifier = Math.round((gameShapeScore(gameShape) - 2.5) * 2);
  return Math.max(18, Math.min(40, baseBySlot + shapeModifier));
}

function summarizeLeaningTendencies(
  tendencies: readonly TrendCountEntry[] | null,
): string | null {
  if (!tendencies) {
    return null;
  }

  const ordered = tendencies
    .map((entry) => ({
      name: entry.key ?? "",
      count: entry.count ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 2);

  if (!ordered.length) {
    return null;
  }

  return ordered.map((entry) => `${entry.name} x${entry.count}`).join(", ");
}

function classifySalaryTrend(
  recentDeltas: number[],
  weeklyDelta: number,
): string {
  if (!recentDeltas.length) {
    return "FLAT";
  }

  const hasPositive = recentDeltas.some((delta) => delta > 0);
  const hasNegative = recentDeltas.some((delta) => delta < 0);
  if (hasPositive && hasNegative) {
    return "VOLATILE";
  }

  if (Math.abs(weeklyDelta) < 500) {
    return "FLAT";
  }

  return weeklyDelta > 0 ? "UP" : "DOWN";
}

function classifyConnectionError(error: unknown): ConnectionStatus {
  if (error instanceof BBXmlApiError && /notauthorized/i.test(error.message)) {
    return "INVALID";
  }
  return "ERROR";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function maskAccessKey(accessKey: string): string {
  return `****${accessKey.slice(-4)}`;
}

function shouldSyncWorkspace(args: {
  force: boolean;
  cachedWorkspace: WorkspaceBundle | null;
}): boolean {
  if (args.force) {
    return true;
  }

  return args.cachedWorkspace === null;
}

function getWeekKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
  const week = Math.floor((day + start.getUTCDay()) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function connectionFreshnessSortKey(connection: BbConnectionRecord): number {
  const value = connection.lastSyncAt ?? connection.connectedAt ?? "";
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function byStartTimeAscending(
  left: BBApiScheduleMatch,
  right: BBApiScheduleMatch,
): number {
  return (left.startTime ?? "").localeCompare(right.startTime ?? "");
}

function byStartTimeDescending(
  left: BBApiScheduleMatch,
  right: BBApiScheduleMatch,
): number {
  return (right.startTime ?? "").localeCompare(left.startTime ?? "");
}
