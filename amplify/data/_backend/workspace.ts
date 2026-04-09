import { randomUUID } from "node:crypto";

import {
  BBXmlApiClient,
  BBXmlApiError,
  formatRosterGameShapeLabel,
  ownedRosterPlayerToRawPlayerSkills,
} from "../../../lib/bbapi";
import type {
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiBoxScoreTeam,
  BBApiCurrentWorkspace,
  BBApiOwnedRosterPlayer,
  BBApiRosterPlayer,
  BBApiScheduleMatch,
  BBApiStandings,
  BBApiTeamInfo,
  BBApiTeamStats,
} from "../../../lib/bbapi";
import {
  rankRoster,
  type RawPlayerSkills,
} from "../../../lib/coach-parrot";
import {
  buildActiveTrackedTeamCredentialProjection,
  deactivateActiveTrackedTeamsForUser,
  listActiveTrackedTeamsForUser,
  type ActiveTrackedTeamCredentialProjection,
  upsertActiveTrackedTeam,
} from "./active-tracked-teams";
import { encryptValue, resolveBbConnectionSecretState } from "./encryption";
import {
  listWorkspacePlayerHistory,
  storeCanonicalPlayerSkillSnapshot,
} from "./player-snapshot-access";
import {
  buildPlayerSkillObservationSortKey,
  type BbConnectionRecord,
  type BbCredentialRecord,
  type ConnectionStatus,
  createSharedPlayerCard,
  createSyncRun,
  deleteBbCredential,
  getBbConnection,
  getBbCredential,
  getTrackedPlayer as getTrackedPlayerRecord,
  getSharedPlayerCardRecord,
  type PlayerSkillObservationRecord,
  upsertBbConnection,
  upsertBbCredential,
  updateSharedPlayerCard,
  updateSyncRun,
  upsertMatchBoxscore,
  upsertPlayerSkillObservation,
  upsertTrackedPlayer,
  upsertTrackedTeam,
} from "./repository";
import { resolveBbAccessKey } from "./credentials";
import {
  inferLeagueTimeZone,
  normalizeLeagueTimeZone,
} from "../../../lib/league-timezones";
import type { Schema } from "../resource";
import {
  buildCompetitiveRecentSample,
  matchIncludesTeam,
  normalizeScheduleType,
  type CompetitiveRecentSample,
} from "./match-importance";
import { assertMaintenanceInactive } from "./maintenance";
import {
  buildWorkspaceCachePayload,
  readWorkspaceCachePayload,
} from "./workspace-cache";

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
type SharedPlayerCardResult = ResolverResult<"generateSharedPlayerCard">;
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
type SalaryProjectionSource = PlayerSummaryRecord & {
  profileJson?: unknown;
};

export type WorkspaceBundle = {
  connection: BbConnectionRecord;
  home: HomeWorkspaceResult;
  teamHub: TeamHubWorkspaceResult;
  scout: ScoutWorkspaceResult;
  leagueIntel: LeagueIntelWorkspaceResult;
  playerLab: PlayerLabWorkspaceResult;
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
  listWorkspacePlayerHistory: (
    env: GraphqlEnv,
    userId: string,
    playerId: string,
  ) => Promise<Record<string, unknown>[]>;
  updateSharedPlayerCard: typeof updateSharedPlayerCard;
};

const SHARED_PLAYER_CARD_TTL_DAYS = 30;

const defaultWorkspaceDependencies: WorkspaceDependencies = {
  getSharedPlayerCardRecord,
  getTrackedPlayer: async (env, userId, playerId) =>
    ((await getTrackedPlayerRecord(env, userId, playerId)) ??
      (await getCachedWorkspacePlayer(env, userId, playerId))) as SalaryProjectionSource | null,
  listWorkspacePlayerHistory,
  updateSharedPlayerCard,
};

export const __testing = {
  buildConnectionRecord,
  buildHomeCorePlayers,
  matchIncludesTeam,
  selectCompletedMatches,
  selectNextMatch,
  selectRecentMatches,
  readCachedWorkspace,
  shouldSyncWorkspace,
};

export async function connectAccount(args: {
  env: GraphqlEnv;
  identity: unknown;
  bbLoginName: string;
  accessKey: string;
}): Promise<BbConnectionRecord> {
  await assertMaintenanceInactive();

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

    const encryptionState = await resolveBbConnectionSecretState(args.env);
    const encryptedAccessKey = encryptValue(accessKey, encryptionState.secret);
    await upsertBbCredential(args.env, {
      userId,
      ...encryptedAccessKey,
      secretFingerprint: encryptionState.secretFingerprint,
    });

    const synced = await syncWorkspace({
      env: args.env,
      userId,
      force: true,
      syncActiveTrackedTeams: true,
      connectionOverride: buildConnectionRecord(userId, existingConnection, {
        bbLoginName,
        status: "CONNECTED",
        accessKeyLast4: maskAccessKey(accessKey),
      }),
      credentialsOverride: { bbLoginName, accessKey },
      credentialOverride: {
        userId,
        ...encryptedAccessKey,
        secretFingerprint: encryptionState.secretFingerprint,
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
  await assertMaintenanceInactive();

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
  await assertMaintenanceInactive();

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
  syncActiveTrackedTeams?: boolean;
}): Promise<WorkspaceBundle> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  return syncWorkspace({
    env: args.env,
    userId,
    force: args.force ?? false,
    syncActiveTrackedTeams: args.syncActiveTrackedTeams ?? false,
  });
}

export async function generatePlayerCard(args: {
  env: GraphqlEnv;
  identity: unknown;
  playerId: string;
  title?: string | null;
  note?: string | null;
}): Promise<SharedPlayerCardResult> {
  await assertMaintenanceInactive();

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
  await assertMaintenanceInactive();

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
  await assertMaintenanceInactive();

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

  await persistWorkspace(
    args.env,
    userId,
    currentWorkspace,
    recentMatches,
    currentBoxScores,
    opponentWorkspace,
    fetchedAt,
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
  await assertMaintenanceInactive();

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
  await assertMaintenanceInactive();

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
    dependencies.listWorkspacePlayerHistory(args.env, userId, playerId),
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

export async function getSalaryProjection(
  args: {
    env: GraphqlEnv;
    identity: unknown;
    playerId: string;
  },
  dependencies: WorkspaceDependencies = defaultWorkspaceDependencies,
): Promise<SalaryProjectionResult> {
  await assertMaintenanceInactive();

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
    dependencies.listWorkspacePlayerHistory(args.env, userId, playerId),
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
  syncActiveTrackedTeams?: boolean;
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
    const homeCoreMatches = selectCompletedMatches(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
      12,
    );
    const currentBoxScores = await fetchRecentBoxScores(client, recentMatches);
    const homeCoreBoxScores = await fetchRecentBoxScores(client, homeCoreMatches);
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
      homeCoreMatches,
      homeCoreBoxScores,
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
        workspaceCacheJson: buildWorkspaceCachePayload({
          home,
          teamHub,
          scout,
          leagueIntel,
          playerLab,
        }),
      },
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
    );
    if (args.syncActiveTrackedTeams) {
      const credentialContext = await loadActiveTrackedTeamCredentialContext(
        args.env,
        args.userId,
        bbLoginName,
        args.credentialOverride,
      );
      await syncOwnedActiveTrackedTeams(
        args.env,
        args.userId,
        currentWorkspace,
        now,
        credentialContext,
      );
    }

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
  }

  for (const player of workspace.roster.players) {
    const trackedPlayer = playerToTrackedPlayerRecord(
      userId,
      workspace.teamInfo.teamId,
      workspace.teamInfo.teamName,
      player,
      fetchedAt,
    );
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
      storeCanonicalPlayerSkillSnapshot(env, snapshot),
      upsertPlayerSkillObservation(env, observation),
      upsertTrackedPlayer(env, trackedPlayer),
    ]);
  }

  for (const boxScore of [
    ...currentBoxScores,
    ...(opponentWorkspace?.recentBoxScores ?? []),
  ]) {
    await upsertMatchBoxscore(env, {
      userId,
      matchId: boxScore.matchId,
      boxscoreJson: boxScore,
      fetchedAt,
    });
  }
}

async function syncOwnedActiveTrackedTeams(
  env: GraphqlEnv,
  userId: string,
  workspace: BBApiCurrentWorkspace,
  fetchedAt: string,
  connectionCredential: ActiveTrackedTeamCredentialContext,
): Promise<void> {
  const primaryTeamId = workspace.teamInfo.teamId;
  if (!primaryTeamId) {
    throw new Error("Workspace team info did not include a primary teamId.");
  }

  const existingTeams = await listActiveTrackedTeamsForUser(env, userId);
  const activePrimaryRecord = {
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
  };

  await upsertActiveTrackedTeam(env, activePrimaryRecord);

  for (const trackedTeam of existingTeams) {
    if (trackedTeam.teamId === primaryTeamId) {
      continue;
    }

    await upsertActiveTrackedTeam(env, {
      ...trackedTeam,
      active: false,
      bbLoginName: null,
      credentialCipherText: null,
      credentialIv: null,
      credentialAuthTag: null,
      credentialAlgorithm: null,
      isPrimary: false,
      updatedAt: fetchedAt,
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
  const boxScores = await Promise.all(
    matches.map(async (match) => {
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
  homeCoreMatches: BBApiScheduleMatch[],
  homeCoreBoxScores: BBApiBoxScore[],
  opponentWorkspace: OpponentWorkspace | null,
  connection: BbConnectionRecord,
): HomeWorkspaceResult {
  const cachedMatchIds = new Set(
    currentBoxScores.map((boxScore) => boxScore.matchId),
  );
  const competitiveSample = buildCompetitiveRecentSample({
    matches: homeCoreMatches,
    boxScores: homeCoreBoxScores,
    teamId: workspace.teamInfo.teamId,
    rawLookback: 12,
    maxIncludedGames: 5,
  });
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
      topPlayers: buildHomeCorePlayers({
        rosterPlayers: workspace.roster.players,
        teamStats: workspace.teamStats,
        competitiveSample,
        teamId: workspace.teamInfo.teamId,
      }),
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
      gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
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
        gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
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
    .filter((match) => isClubMatchForTeam(match, currentTeamId))
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

function isClubMatchForTeam(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean {
  return matchIncludesTeam(match, teamId) && !isNonClubScheduleType(match.type);
}

function isNonClubScheduleType(type: string | null | undefined): boolean {
  const normalized = normalizeScheduleType(type);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("allstar") ||
    normalized.includes("all-star") ||
    normalized.startsWith("nationalteam") ||
    normalized.startsWith("nt.")
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
      gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
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
  player: BBApiOwnedRosterPlayer,
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
  gameShape: string;
  dmi: number;
  injuryWeeks: number;
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
    gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
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
  player: BBApiOwnedRosterPlayer,
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
    gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
    dmi: player.dmi,
    injuryWeeks: player.injuryWeeks,
  };
}

function playerToTrackedPlayerRecord(
  userId: string,
  teamId: string | null,
  teamName: string | null,
  player: BBApiOwnedRosterPlayer,
  fetchedAt: string,
): Record<string, unknown> {
  if (!player.id || !teamId) {
    throw new Error("Tracked player records require both a player id and team id.");
  }

  return {
    userId,
    playerId: player.id,
    teamId,
    teamName,
    firstName: player.firstName,
    lastName: player.lastName,
    fullName: player.fullName,
    bestPosition: player.bestPosition,
    salary: player.salary,
    age: player.age,
    height: player.height,
    nationalityName: player.nationality?.name ?? null,
    gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
    dmi: player.dmi,
    injuryWeeks: player.injuryWeeks,
    profileJson: player,
    fetchedAt,
  };
}

function selectNextMatch(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
): BBApiScheduleMatch | null {
  return (
    [...matches]
      .filter((match) => isClubMatchForTeam(match, teamId))
      .filter(
        (match) =>
          deriveTeamScore(match, teamId) === null ||
          deriveOpponentScore(match, teamId) === null,
      )
      .sort(byStartTimeAscending)[0] ?? null
  );
}

function selectCompletedMatches(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
  limit: number,
): BBApiScheduleMatch[] {
  return [...matches]
    .filter((match) => isClubMatchForTeam(match, teamId))
    .filter(
      (match) =>
        deriveTeamScore(match, teamId) !== null &&
        deriveOpponentScore(match, teamId) !== null,
    )
    .sort(byStartTimeDescending)
    .slice(0, limit);
}

function selectRecentMatches(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
): BBApiScheduleMatch[] {
  return selectCompletedMatches(matches, teamId, 5);
}

function countStarters(
  boxScores: BBApiBoxScore[],
  teamId: string | null,
): Record<string, number> {
  return boxScores.reduce<Record<string, number>>((accumulator, boxScore) => {
    const team = resolveBoxScoreTeamForTeam(boxScore, teamId);
    if (!team) {
      return accumulator;
    }
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
    const team = resolveBoxScoreTeamForTeam(boxScore, teamId);
    if (!team) {
      continue;
    }
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
    recentAvgMinutes: asNumber(player.recentAvgMinutes),
    recentStartCount: asNumber(player.recentStartCount),
  };
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

function buildHomeCorePlayers(args: {
  rosterPlayers: BBApiOwnedRosterPlayer[];
  teamStats: BBApiTeamStats | null;
  competitiveSample: CompetitiveRecentSample;
  teamId: string | null;
}): PlayerSummaryRecord[] {
  const usageByPlayerId = summarizeRecentUsage(
    args.competitiveSample,
    args.teamId,
  );
  const useUsageSignals = args.competitiveSample.includedGames.length >= 2;
  const playerKeys = args.rosterPlayers.map((player) => ({
    key: getPlayerKey(player),
    player,
  }));
  const salaryNorm = buildNormalizedValueMap(
    playerKeys.map(({ key, player }) => ({
      key,
      value: player.salary,
    })),
  );
  const dmiNorm = buildNormalizedValueMap(
    playerKeys.map(({ key, player }) => ({
      key,
      value: player.dmi,
    })),
  );
  const gameShapeNorm = buildNormalizedValueMap(
    playerKeys.map(({ key, player }) => ({
      key,
      value: player.skills.gameShape,
    })),
  );
  const scoredPlayers = playerKeys.map(({ key, player }) => {
    const rawSkills = {
      ...ownedRosterPlayerToRawPlayerSkills(player),
      playerId: key,
      name: player.fullName,
    };
    return {
      key,
      player,
      rawSkills,
      recognizedSkillCount: countRecognizedSkillValues(rawSkills),
    };
  });
  const skillEligiblePlayers = scoredPlayers.filter(
    (entry) => entry.recognizedSkillCount >= 8,
  );
  const skillOutputs = skillEligiblePlayers.length
    ? rankRoster({
        roster: {
          players: skillEligiblePlayers.map((entry) => entry.rawSkills),
        },
        context: {
          offense: "Base Offense",
          defense: "Man to man",
          enthusiasm: 5,
          homeCourt: "Away or Neutral",
        },
      }).playerOutputs
    : {};
  const skillTalentNorm = buildNormalizedValueMap(
    skillEligiblePlayers.map((entry) => ({
      key: entry.key,
      value: averageTopTwoOutputs(skillOutputs[entry.key] ?? null),
    })),
  );
  const minuteNorm = buildNormalizedValueMap(
    playerKeys.map(({ key }) => ({
      key,
      value: useUsageSignals
        ? (usageByPlayerId.get(key)?.recentAvgMinutes ?? 0)
        : null,
    })),
  );
  const startNorm = buildNormalizedValueMap(
    playerKeys.map(({ key }) => ({
      key,
      value: useUsageSignals
        ? (usageByPlayerId.get(key)?.recentStartCount ?? 0)
        : null,
    })),
  );
  const activityNorm = buildNormalizedValueMap(
    playerKeys.map(({ key }) => ({
      key,
      value: useUsageSignals
        ? (usageByPlayerId.get(key)?.recentActivityScore ?? 0)
        : null,
    })),
  );
  const gamesPlayedNorm = buildNormalizedValueMap(
    playerKeys.map(({ key }) => ({
      key,
      value: useUsageSignals
        ? (usageByPlayerId.get(key)?.recentGamesPlayed ?? 0)
        : null,
    })),
  );

  return scoredPlayers
    .map(({ key, player }) => {
      const usage = usageByPlayerId.get(key) ?? {
        recentActivityScore: 0,
        recentAvgMinutes: 0,
        recentGamesPlayed: 0,
        recentStartCount: 0,
      };
      const talentScore = skillTalentNorm.get(key) ?? salaryNorm.get(key) ?? null;
      const formScore = averageAvailable([
        gameShapeNorm.get(key) ?? null,
        dmiNorm.get(key) ?? null,
      ]);
      const usageScore = useUsageSignals
        ? computeWeightedAverage([
            { value: minuteNorm.get(key) ?? null, weight: 40 },
            { value: startNorm.get(key) ?? null, weight: 25 },
            { value: activityNorm.get(key) ?? null, weight: 20 },
            { value: gamesPlayedNorm.get(key) ?? null, weight: 15 },
          ])
        : null;
      const fallbackCoreScore = computeWeightedAverage([
        { value: talentScore, weight: 60 },
        { value: formScore, weight: 25 },
        { value: salaryNorm.get(key) ?? null, weight: 15 },
      ]);
      const sparseUsagePenalty = useUsageSignals
        ? usage.recentGamesPlayed === 0
          ? 0.5
          : usage.recentAvgMinutes < 10
            ? 0.3
            : usage.recentAvgMinutes < 20
              ? 0.12
              : 0
        : 0;
      const entrenchedStarterBoost = useUsageSignals
        ? Math.min(0.08, usage.recentStartCount * 0.02)
        : 0;
      const coreScore =
        (useUsageSignals
          ? computeWeightedAverage([
              { value: usageScore, weight: 80 },
              { value: talentScore, weight: 10 },
              { value: formScore, weight: 10 },
            ])
          : fallbackCoreScore) +
        entrenchedStarterBoost -
        sparseUsagePenalty -
        injuryPenalty(player.injuryWeeks);

      return {
        summary: {
          playerId: player.id,
          fullName: player.fullName,
          bestPosition: player.bestPosition,
          nationalityName: player.nationality?.name ?? null,
          salary: player.salary,
          age: player.age,
          gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
          dmi: player.dmi,
          injuryWeeks: player.injuryWeeks,
          projectedStarterCount: null,
          ppg: extractPpg(args.teamStats, player),
          recentAvgMinutes: useUsageSignals
            ? roundToOneDecimal(usage.recentAvgMinutes)
            : null,
          recentStartCount: useUsageSignals ? usage.recentStartCount : null,
        },
        coreScore,
      };
    })
    .sort((left, right) => {
      if (right.coreScore !== left.coreScore) {
        return right.coreScore - left.coreScore;
      }
      return (
        (right.summary.recentAvgMinutes ?? 0) -
          (left.summary.recentAvgMinutes ?? 0) ||
        (right.summary.salary ?? 0) - (left.summary.salary ?? 0) ||
        left.summary.fullName.localeCompare(right.summary.fullName)
      );
    })
    .slice(0, 5)
    .map((entry) => entry.summary);
}

function summarizeRecentUsage(
  competitiveSample: CompetitiveRecentSample,
  teamId: string | null,
): Map<
  string,
  {
    recentAvgMinutes: number;
    recentStartCount: number;
    recentGamesPlayed: number;
    recentActivityScore: number;
  }
> {
  const usageByPlayerId = new Map<
    string,
    {
      totalMinutes: number;
      totalActivityScore: number;
      recentStartCount: number;
      recentGamesPlayed: number;
    }
  >();
  const gamesConsidered = competitiveSample.includedGames.length;
  if (!gamesConsidered || !teamId) {
    return new Map();
  }

  for (const includedGame of competitiveSample.includedGames) {
    const team = resolveBoxScoreTeamForTeam(includedGame.boxScore, teamId);
    if (!team) {
      continue;
    }

    for (const player of team.players) {
      if (!player.id) {
        continue;
      }

      const minutes = totalMinutesPlayed(player);
      const current = usageByPlayerId.get(player.id) ?? {
        totalMinutes: 0,
        totalActivityScore: 0,
        recentStartCount: 0,
        recentGamesPlayed: 0,
      };
      current.totalMinutes += minutes;
      current.totalActivityScore += calculateRecentActivityScore(player);
      current.recentStartCount += asBoolean(player.details.isStarter) ? 1 : 0;
      current.recentGamesPlayed += minutes > 0 ? 1 : 0;
      usageByPlayerId.set(player.id, current);
    }
  }

  return new Map(
    Array.from(usageByPlayerId.entries()).map(([playerId, summary]) => [
      playerId,
      {
        recentAvgMinutes: summary.totalMinutes / gamesConsidered,
        recentStartCount: summary.recentStartCount,
        recentGamesPlayed: summary.recentGamesPlayed,
        recentActivityScore: summary.totalActivityScore / gamesConsidered,
      },
    ]),
  );
}

function resolveBoxScoreTeamForTeam(
  boxScore: BBApiBoxScore,
  teamId: string | null,
): BBApiBoxScoreTeam | null {
  if (!teamId) {
    return null;
  }

  if (boxScore.homeTeam.id === teamId) {
    return boxScore.homeTeam;
  }
  if (boxScore.awayTeam.id === teamId) {
    return boxScore.awayTeam;
  }

  return null;
}

function totalMinutesPlayed(player: BBApiBoxScorePlayer): number {
  let total = 0;
  for (const minutes of Object.values(player.minutesByPosition)) {
    if (typeof minutes === "number" && Number.isFinite(minutes)) {
      total += minutes;
    }
  }
  return total;
}

function calculateRecentActivityScore(player: BBApiBoxScorePlayer): number {
  const pts = asNumber(player.performance.pts) ?? 0;
  const reb = asNumber(player.performance.reb) ?? 0;
  const ast = asNumber(player.performance.ast) ?? 0;
  const stl = asNumber(player.performance.stl) ?? 0;
  const blk = asNumber(player.performance.blk) ?? 0;
  const turnovers = asNumber(player.performance.to) ?? 0;

  return pts + 0.7 * reb + 0.7 * ast + 1.5 * (stl + blk) - turnovers;
}

function averageTopTwoOutputs(
  outputs: Record<string, number> | null,
): number | null {
  if (!outputs) {
    return null;
  }

  const ordered = Object.values(outputs).sort((left, right) => right - left);
  if (!ordered.length) {
    return null;
  }
  if (ordered.length === 1) {
    return ordered[0] ?? null;
  }

  return ((ordered[0] ?? 0) + (ordered[1] ?? 0)) / 2;
}

function countRecognizedSkillValues(player: RawPlayerSkills): number {
  return [
    player.js,
    player.jr,
    player.od,
    player.ha,
    player.dr,
    player.pa,
    player.is,
    player.id,
    player.rb,
    player.sb,
    player.st,
    player.ft,
    player.ex,
    player.gs,
  ].filter((value) => value > 0).length;
}

function buildNormalizedValueMap(
  entries: Array<{ key: string; value: number | null | undefined }>,
): Map<string, number> {
  const availableEntries = entries.filter(
    (entry): entry is { key: string; value: number } =>
      typeof entry.value === "number" && Number.isFinite(entry.value),
  );
  if (!availableEntries.length) {
    return new Map();
  }

  const values = availableEntries.map((entry) => entry.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return new Map(
    availableEntries.map((entry) => [
      entry.key,
      max === min ? 0.5 : (entry.value - min) / (max - min),
    ]),
  );
}

function averageAvailable(values: Array<number | null | undefined>): number | null {
  const availableValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (!availableValues.length) {
    return null;
  }

  return (
    availableValues.reduce((sum, value) => sum + value, 0) /
    availableValues.length
  );
}

function computeWeightedAverage(
  buckets: Array<{ value: number | null; weight: number }>,
): number {
  const availableBuckets = buckets.filter(
    (bucket): bucket is { value: number; weight: number } =>
      bucket.value !== null && Number.isFinite(bucket.value),
  );
  if (!availableBuckets.length) {
    return 0;
  }

  const weightedTotal = availableBuckets.reduce(
    (sum, bucket) => sum + bucket.value * bucket.weight,
    0,
  );
  const totalWeight = availableBuckets.reduce(
    (sum, bucket) => sum + bucket.weight,
    0,
  );
  return totalWeight > 0 ? weightedTotal / totalWeight : 0;
}

function injuryPenalty(injuryWeeks: number | null): number {
  if ((injuryWeeks ?? 0) >= 2) {
    return 0.6;
  }
  if (injuryWeeks === 1) {
    return 0.35;
  }
  return 0;
}

function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function getPlayerKey(player: BBApiOwnedRosterPlayer): string {
  return player.id;
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
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }
  return match.homeTeam.id === teamId ? match.awayTeam.id : match.homeTeam.id;
}

function deriveOpponentTeamName(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  if (!matchIncludesTeam(match, teamId)) {
    return null;
  }
  return match.homeTeam.id === teamId
    ? match.awayTeam.teamName
    : match.homeTeam.teamName;
}

function deriveTeamScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (!matchIncludesTeam(match, teamId)) {
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
  if (!matchIncludesTeam(match, teamId)) {
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
  if (!matchIncludesTeam(match, teamId)) {
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
  return {
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
  const cache = readWorkspaceCachePayload(connection.workspaceCacheJson);
  if (!cache) {
    return null;
  }
  const { home, teamHub, scout, leagueIntel, playerLab } = cache;

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
