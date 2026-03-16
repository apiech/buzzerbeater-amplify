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
  listBbConnections,
  upsertBbConnection,
  upsertBbCredential,
  updateSharedPlayerCard,
  updateSyncRun,
  upsertMatchBoxscore,
  upsertTrackedTeam,
} from "./repository";
import { resolveBbAccessKey } from "./credentials";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type WorkspaceBundle = {
  connection: BbConnectionRecord;
  home: Record<string, unknown>;
  teamHub: Record<string, unknown>;
  scout: Record<string, unknown>;
  leagueIntel: Record<string, unknown>;
  playerLab: Record<string, unknown>;
};

type MatchSummaryRecord = Record<string, unknown>;

type SharedPlayerCardResponse = {
  shareToken: string;
  shareUrl: string | null;
  title: string | null;
  note: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  payload: Record<string, unknown> | null;
};

export type ActiveTrackedTeamCredentialBackfillResult = {
  connectedUsers: number;
  usersWithProjectedCredentials: number;
  usersMissingCredentials: number;
  trackedTeamsUpdated: number;
};

type ActiveTrackedTeamCredentialContext = ActiveTrackedTeamCredentialProjection & {
  bbLoginName: string;
};

type WorkspaceDependencies = {
  getSharedPlayerCardRecord: typeof getSharedPlayerCardRecord;
  getTrackedPlayer: (
    env: GraphqlEnv,
    userId: string,
    playerId: string,
  ) => Promise<Record<string, unknown> | null>;
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
  listWeeklyPlayerSnapshots: async (env, _userId, playerId) =>
    listCanonicalPlayerSkillSnapshots(env, playerId),
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
      lastSyncError: "Both the BuzzerBeater login name and access key are required.",
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

export async function listConnectedUsers(env: GraphqlEnv): Promise<BbConnectionRecord[]> {
  const connections = await listBbConnections(env);
  return connections.filter((connection) => connection.status === "CONNECTED");
}

export async function listStaleConnectedUsers(args: {
  env: GraphqlEnv;
  staleAfterHours: number;
  maxUsers?: number;
  dedupeByTeam?: boolean;
}): Promise<BbConnectionRecord[]> {
  const connections = await listConnectedUsers(args.env);
  const staleConnections = connections
    .filter((connection) => isConnectionStale(connection, args.staleAfterHours))
    .sort((left, right) => connectionFreshnessSortKey(left) - connectionFreshnessSortKey(right));

  const selected = args.dedupeByTeam
    ? dedupeConnectionsByTeam(staleConnections)
    : staleConnections;
  const maxUsers = Math.max(1, args.maxUsers ?? staleConnections.length);
  return selected.slice(0, maxUsers);
}

export async function backfillActiveTrackedTeamCredentialProjection(
  env: GraphqlEnv,
): Promise<ActiveTrackedTeamCredentialBackfillResult> {
  const connections = await backfillRuntime.listConnectedUsers(env);
  let usersWithProjectedCredentials = 0;
  let usersMissingCredentials = 0;
  let trackedTeamsUpdated = 0;

  for (const connection of connections) {
    const credential = await backfillRuntime.getBbCredential(env, connection.userId);
    if (!credential) {
      usersMissingCredentials += 1;
      continue;
    }

    usersWithProjectedCredentials += 1;
    const credentialContext = buildActiveTrackedTeamCredentialContext(
      connection.bbLoginName,
      credential,
    );
    const activeTrackedTeams = await backfillRuntime.listActiveTrackedTeamsForUser(
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
}): Promise<SharedPlayerCardResponse> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }
  const player = await getCachedWorkspacePlayer(args.env, userId, args.playerId);
  if (!player) {
    throw new Error("The requested player is not available in the current workspace.");
  }

  const shareToken = randomUUID();
  const title = normalizeSharedCardText(args.title) ?? asString(player.fullName);
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

export async function revokePlayerCard(args: {
  env: GraphqlEnv;
  identity: unknown;
  shareToken: string;
}, dependencies: WorkspaceDependencies = defaultWorkspaceDependencies): Promise<SharedPlayerCardResponse> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const shareToken = args.shareToken.trim();
  if (!shareToken) {
    throw new Error("A shared player card token is required.");
  }

  const record = await dependencies.getSharedPlayerCardRecord(args.env, shareToken);
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
}): Promise<{ connection: BbConnectionRecord; scout: Record<string, unknown> }> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const baseWorkspace = await getOrRefreshWorkspace({
    env: args.env,
    identity: args.identity,
  });

  const requestedTeamId = args.teamId?.trim() ?? "";
  if (!requestedTeamId || requestedTeamId === (baseWorkspace.scout.teamId as string | null)) {
    return {
      connection: baseWorkspace.connection,
      scout: {
        ...baseWorkspace.scout,
        requestedTeamId: requestedTeamId || (baseWorkspace.scout.teamId as string | null) || null,
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
    ),
  };
}

export async function lookupSharedPlayerCardByToken(args: {
  env: GraphqlEnv;
  identity: unknown;
  shareToken: string;
}, dependencies: WorkspaceDependencies = defaultWorkspaceDependencies): Promise<Record<string, unknown> | null> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const shareToken = args.shareToken.trim();
  if (!shareToken) {
    throw new Error("A shared player card token is required.");
  }

  const record = await dependencies.getSharedPlayerCardRecord(args.env, shareToken);
  if (!record || record.userId !== userId || !isSharedPlayerCardActive(record)) {
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

export async function getPlayerTrend(args: {
  env: GraphqlEnv;
  identity: unknown;
  playerId: string;
}, dependencies: WorkspaceDependencies = defaultWorkspaceDependencies): Promise<Record<string, unknown>> {
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
    throw new Error("The requested player is not available in the current workspace.");
  }

  const history = snapshots
    .sort((left, right) =>
      String(
        left.capturedAt ?? left.fetchedAt ?? left.weekKey ?? "",
      ).localeCompare(
        String(right.capturedAt ?? right.fetchedAt ?? right.weekKey ?? ""),
      ),
    )
    .map((snapshot) => ({
      weekKey: asString(snapshot.weekKey),
      fetchedAt: asString(snapshot.capturedAt ?? snapshot.fetchedAt),
      salary: asNumber(snapshot.salary),
      dmi: asNumber(snapshot.dmi),
      injuryWeeks: asNumber(snapshot.injuryWeeks),
      gameShape: asString(snapshot.gameShape),
    }));

  return {
    player,
    history,
  };
}

export async function getMatchBoxscoreDetails(args: {
  env: GraphqlEnv;
  identity: unknown;
  matchId: string;
}, dependencies: WorkspaceDependencies = defaultWorkspaceDependencies): Promise<Record<string, unknown>> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const matchId = args.matchId.trim();
  if (!matchId) {
    throw new Error("A match id is required.");
  }

  const boxscore = await dependencies.getMatchBoxscore(args.env, userId, matchId);
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
    teamRatings: toRecord(boxscore.teamRatingsJson),
    opponentRatings: toRecord(boxscore.opponentRatingsJson),
    teamEfficiency: toRecord(boxscore.teamEfficiencyJson),
    opponentEfficiency: toRecord(boxscore.opponentEfficiencyJson),
    boxscore: toRecord(boxscore.boxscoreJson),
  };
}

export async function getLineupPlan(args: {
  env: GraphqlEnv;
  identity: unknown;
}): Promise<Record<string, unknown>> {
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
}): Promise<Record<string, unknown>> {
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
  const starters = toRecordArray(args.starters);
  const minuteTargets = toRecord(args.minuteTargets);

  if (!starters.length) {
    throw new Error("At least one starter must be provided.");
  }

  if (!minuteTargets) {
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

export async function getSalaryProjection(args: {
  env: GraphqlEnv;
  identity: unknown;
  playerId: string;
}, dependencies: WorkspaceDependencies = defaultWorkspaceDependencies): Promise<Record<string, unknown>> {
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
    throw new Error("The requested player is not available in the current workspace.");
  }

  return buildSalaryProjectionPayload({
    player,
    snapshots,
    teamCountryName: connection?.countryName ?? null,
  });
}

export function buildLineupPlanPayload(
  workspace: WorkspaceBundle,
): Record<string, unknown> {
  const roster = toRecordArray(toRecord(workspace.teamHub)?.roster);
  if (!roster.length) {
    throw new Error("No cached roster is available for lineup planning.");
  }

  const rankedPlayers = roster
    .map((player) => {
      const stats = toRecord(player.stats);
      const projectedStarterCount = asNumber(player.projectedStarterCount) ?? 0;
      const ppg = asNumber(stats?.ppg) ?? 0;
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
        stats,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const positions = ["PG", "SG", "SF", "PF", "C"] as const;
  const usedPlayerIds = new Set<string>();
  const recommendedStarters = positions.flatMap((position, index) => {
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
  });

  const benchOrder = rankedPlayers
    .filter((player) => player.playerId && !usedPlayerIds.has(player.playerId))
    .map((player, index) => ({
      playerId: player.playerId,
      fullName: player.fullName,
      bestPosition: player.bestPosition,
      projectedStarterCount: player.projectedStarterCount,
      score: Number(player.score.toFixed(2)),
      benchSlot: index + 1,
    }))
    .slice(0, 7);

  const minuteTargets = Object.fromEntries(
    recommendedStarters.map((player, index) => [
      player.playerId,
      suggestMinutes(player.gameShape, index),
    ]),
  );

  const home = toRecord(workspace.home);
  const homeTeam = toRecord(home?.team);
  const homeInjuries = toRecordArray(homeTeam?.injuries);
  const scout = toRecord(workspace.scout);
  const scoutSummary = toRecord(scout?.summary);
  const tendencies = toRecord(scoutSummary?.tendencies);
  const offenseTendencies = summarizeLeaningTendencies(
    toRecord(tendencies?.offense),
  );
  const defenseTendencies = summarizeLeaningTendencies(
    toRecord(tendencies?.defense),
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
    (total, player) => total + ((player.projectedStarterCount ?? 0) > 0 ? 1 : 0),
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
      fullName: asString(injury.fullName),
      injuryWeeks: asNumber(injury.injuryWeeks),
    })),
    confidence,
  };
}

export function buildSalaryProjectionPayload(args: {
  player: Record<string, unknown>;
  snapshots: Record<string, unknown>[];
  teamCountryName: string | null;
}): Record<string, unknown> {
  const player = args.player;
  const profile = toRecord(player.profileJson);
  const profileNationality = toRecord(profile?.nationality);
  const orderedSnapshots = [...args.snapshots].sort((left, right) =>
    String(left.capturedAt ?? left.fetchedAt ?? left.weekKey ?? "").localeCompare(
      String(right.capturedAt ?? right.fetchedAt ?? right.weekKey ?? ""),
    ),
  );
  const salarySeries = orderedSnapshots
    .map((snapshot) => asNumber(snapshot.salary))
    .filter((salary): salary is number => salary !== null);
  const currentSalary =
    salarySeries[salarySeries.length - 1] ??
    asNumber(player.salary) ??
    asNumber(profile?.salary);
  const deltas = salarySeries
    .slice(1)
    .map((salary, index) => salary - salarySeries[index]);
  const recentDeltas = deltas.slice(-3);
  const weeklyDelta = recentDeltas.length
    ? Math.round(
        recentDeltas.reduce((sum, value) => sum + value, 0) / recentDeltas.length,
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
    bestPosition: asString(player.bestPosition) ?? asString(profile?.bestPosition),
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
    throw new Error("No BuzzerBeater connection has been configured for this user.");
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
    const accessKey = args.credentialsOverride?.accessKey
      ?? (await resolveAccessKey(args.env, args.userId));
    const bbLoginName = args.credentialsOverride?.bbLoginName ?? connection.bbLoginName;

    const client = new BBXmlApiClient({
      username: bbLoginName,
      securityCode: accessKey,
    });

    const currentWorkspace = await client.getCurrentWorkspace();
    const nextMatch = selectNextMatch(currentWorkspace.schedule.matches, currentWorkspace.teamInfo.teamId);
    const recentMatches = selectRecentMatches(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
    );
    const currentBoxScores = await fetchRecentBoxScores(client, recentMatches);
    const nextOpponentTeamId = nextMatch ? deriveOpponentTeamId(nextMatch, currentWorkspace.teamInfo.teamId) : null;

    const opponentWorkspace = nextOpponentTeamId
      ? await fetchOpponentWorkspace(client, nextOpponentTeamId, currentWorkspace)
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
    const teamHub = buildTeamHub(currentWorkspace, currentBoxScores);
    const scout = buildScoutWorkspace(
      currentWorkspace,
      currentBoxScores,
      opponentWorkspace,
      nextOpponentTeamId,
    );
    const leagueIntel = buildLeagueIntel(currentWorkspace.standings);
    const playerLab = buildPlayerLab(currentWorkspace, currentBoxScores);

    const updatedConnection = buildConnectionRecord(args.userId, connectionForViews, {
      workspaceCacheJson: {
        home,
        teamHub,
        scout,
        leagueIntel,
        playerLab,
      },
    });
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
    await upsertCanonicalPlayerSkillSnapshot(env, snapshot);
  }

  for (const boxScore of [...currentBoxScores, ...(opponentWorkspace?.recentBoxScores ?? [])]) {
    const perspective = determinePerspective(boxScore, workspace.teamInfo.teamId, opponentWorkspace?.teamInfo.teamId ?? null);
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
    client.getTeamStats(
      opponentTeamId,
      currentWorkspace.schedule.season ?? undefined,
      "averages",
    ).catch(() => null),
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

  return boxScores.filter((boxScore): boxScore is BBApiBoxScore => boxScore !== null);
}

function buildHomeWorkspace(
  workspace: BBApiCurrentWorkspace,
  nextMatch: BBApiScheduleMatch | null,
  recentMatches: BBApiScheduleMatch[],
  currentBoxScores: BBApiBoxScore[],
  opponentWorkspace: OpponentWorkspace | null,
  connection: BbConnectionRecord,
): Record<string, unknown> {
  const cachedMatchIds = new Set(currentBoxScores.map((boxScore) => boxScore.matchId));
  return {
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
      topPlayers: buildTopPlayers(workspace.roster.players, workspace.teamStats),
    },
    nextMatch: nextMatch
      ? {
          matchId: nextMatch.id,
          startTime: nextMatch.startTime,
          type: nextMatch.type,
          opponentTeamId: deriveOpponentTeamId(nextMatch, workspace.teamInfo.teamId),
          opponentTeamName: deriveOpponentTeamName(nextMatch, workspace.teamInfo.teamId),
          isHome: isTeamHome(nextMatch, workspace.teamInfo.teamId),
        }
      : null,
    nextOpponent: opponentWorkspace
      ? {
          teamId: opponentWorkspace.teamInfo.teamId,
          teamName: opponentWorkspace.teamInfo.teamName,
          record: lookupRecord(workspace.standings, opponentWorkspace.teamInfo.teamId),
          injuries: opponentWorkspace.roster.players
            .filter((player) => (player.injuryWeeks ?? 0) > 0)
            .map((player) => ({
              playerId: player.id,
              fullName: player.fullName,
              injuryWeeks: player.injuryWeeks,
            })),
          tendencies: summarizeTendencies(opponentWorkspace.recentBoxScores, opponentWorkspace.teamInfo.teamId),
        }
      : null,
    recentMatches: recentMatches.map((match) => ({
      matchId: match.id,
      startTime: match.startTime,
      type: match.type,
      opponentTeamName: deriveOpponentTeamName(match, workspace.teamInfo.teamId),
      teamScore: deriveTeamScore(match, workspace.teamInfo.teamId),
      opponentScore: deriveOpponentScore(match, workspace.teamInfo.teamId),
      outcome: deriveOutcome(match, workspace.teamInfo.teamId),
      hasBoxscore: Boolean(match.id && cachedMatchIds.has(match.id)),
    })),
    league: buildLeagueIntel(workspace.standings),
  };
}

function buildTeamHub(
  workspace: BBApiCurrentWorkspace,
  currentBoxScores: BBApiBoxScore[],
): Record<string, unknown> {
  const starterCounts = countStarters(currentBoxScores, workspace.teamInfo.teamId);
  return {
    team: workspace.teamInfo,
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
      stats: lookupPlayerStats(workspace.teamStats, player),
    })),
  };
}

export function buildScoutWorkspace(
  currentWorkspace: BBApiCurrentWorkspace,
  currentBoxScores: BBApiBoxScore[],
  opponentWorkspace: OpponentWorkspace | null,
  requestedTeamId: string | null,
): Record<string, unknown> {
  const availableOpponents = buildAvailableOpponents(
    currentWorkspace.standings,
    currentWorkspace.teamInfo.teamId,
    opponentWorkspace?.teamInfo,
  );

  if (!opponentWorkspace) {
    return {
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
      .map((boxScore) => [boxScore.matchId as string, boxScore.effortDelta ?? null]),
  );
  const recentMatchups = buildRecentMatchups(
    currentWorkspace.schedule.matches,
    currentWorkspace.teamInfo.teamId,
    opponentWorkspace.teamInfo.teamId,
    cachedOpponentMatchIds,
  );

  return {
    teamId: opponentWorkspace.teamInfo.teamId,
    availableOpponents,
    recentMatchups,
    requestedTeamId: requestedTeamId ?? opponentWorkspace.teamInfo.teamId,
    summary: {
      teamName: opponentWorkspace.teamInfo.teamName,
      nextMatch: opponentWorkspace.nextMatch,
      record: lookupRecord(currentWorkspace.standings, opponentWorkspace.teamInfo.teamId),
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
      })),
      topPlayers: buildTopPlayers(opponentWorkspace.roster.players, opponentWorkspace.teamStats),
      recentGames: opponentWorkspace.recentMatches.map((match) => ({
        matchId: match.id,
        startTime: match.startTime,
        type: match.type,
        opponentTeamName: deriveOpponentTeamName(match, opponentWorkspace.teamInfo.teamId),
        teamScore: deriveTeamScore(match, opponentWorkspace.teamInfo.teamId),
        opponentScore: deriveOpponentScore(match, opponentWorkspace.teamInfo.teamId),
        outcome: deriveOutcome(match, opponentWorkspace.teamInfo.teamId),
        effortDelta: match.id ? (effortByMatchId.get(match.id) ?? null) : null,
        hasBoxscore: Boolean(match.id && cachedOpponentMatchIds.has(match.id)),
      })),
    },
  };
}

function buildLeagueIntel(standings: BBApiStandings | null): Record<string, unknown> {
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
): Array<Record<string, unknown>> {
  const teams = standings?.conferences
    .flatMap((conference) => conference.teams)
    .filter((team) => team.id !== currentTeamId)
    .map((team) => ({
      teamId: team.id,
      teamName: team.teamName,
      wins: team.wins,
      losses: team.losses,
      pointMargin: team.pf !== null && team.pa !== null ? team.pf - team.pa : null,
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
    .filter((match) => deriveOpponentTeamId(match, currentTeamId) === opponentTeamId)
    .filter((match) => deriveTeamScore(match, currentTeamId) !== null)
    .sort(byStartTimeDescending)
    .slice(0, 5)
    .map((match) => ({
      matchId: match.id,
      startTime: match.startTime,
      type: match.type,
      opponentTeamName: deriveOpponentTeamName(match, currentTeamId),
      teamScore: deriveTeamScore(match, currentTeamId),
      opponentScore: deriveOpponentScore(match, currentTeamId),
      outcome: deriveOutcome(match, currentTeamId),
      hasBoxscore: Boolean(match.id && cachedMatchIds.has(match.id)),
    }));
}

function buildPlayerLab(
  workspace: BBApiCurrentWorkspace,
  currentBoxScores: BBApiBoxScore[],
): Record<string, unknown> {
  const starterCounts = countStarters(currentBoxScores, workspace.teamInfo.teamId);
  return {
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
      stats: lookupPlayerStats(workspace.teamStats, player),
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
    throw new Error("Canonical player snapshots require both a player id and team id.");
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
  if (boxScore.homeTeam.id === primaryTeamId || boxScore.awayTeam.id === primaryTeamId) {
    const team = boxScore.homeTeam.id === primaryTeamId ? boxScore.homeTeam : boxScore.awayTeam;
    const opponent = team === boxScore.homeTeam ? boxScore.awayTeam : boxScore.homeTeam;
    return {
      teamId: primaryTeamId,
      opponentTeamId: opponent.id,
      opponentTeamName: opponent.teamName,
      team,
      opponent,
    };
  }

  if (secondaryTeamId && (boxScore.homeTeam.id === secondaryTeamId || boxScore.awayTeam.id === secondaryTeamId)) {
    const team = boxScore.homeTeam.id === secondaryTeamId ? boxScore.homeTeam : boxScore.awayTeam;
    const opponent = team === boxScore.homeTeam ? boxScore.awayTeam : boxScore.homeTeam;
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
  return [...matches]
    .filter((match) => deriveTeamScore(match, teamId) === null || deriveOpponentScore(match, teamId) === null)
    .sort(byStartTimeAscending)[0] ?? null;
}

function selectRecentMatches(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
): BBApiScheduleMatch[] {
  return [...matches]
    .filter((match) => deriveTeamScore(match, teamId) !== null && deriveOpponentScore(match, teamId) !== null)
    .sort(byStartTimeDescending)
    .slice(0, 5);
}

function countStarters(
  boxScores: BBApiBoxScore[],
  teamId: string | null,
): Record<string, number> {
  return boxScores.reduce<Record<string, number>>((accumulator, boxScore) => {
    const team = boxScore.homeTeam.id === teamId ? boxScore.homeTeam : boxScore.awayTeam;
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
): Record<string, unknown> {
  const offense = new Map<string, number>();
  const defense = new Map<string, number>();

  for (const boxScore of boxScores) {
    const team = boxScore.homeTeam.id === teamId ? boxScore.homeTeam : boxScore.awayTeam;
    if (team.offStrategy) {
      offense.set(team.offStrategy, (offense.get(team.offStrategy) ?? 0) + 1);
    }
    if (team.defStrategy) {
      defense.set(team.defStrategy, (defense.get(team.defStrategy) ?? 0) + 1);
    }
  }

  return {
    offense: Object.fromEntries(offense),
    defense: Object.fromEntries(defense),
  };
}

function buildTopPlayers(
  rosterPlayers: BBApiRosterPlayer[],
  teamStats: BBApiTeamStats | null,
): Array<Record<string, unknown>> {
  return rosterPlayers
    .map((player) => ({
      playerId: player.id,
      fullName: player.fullName,
      bestPosition: player.bestPosition,
      salary: player.salary,
      stats: lookupPlayerStats(teamStats, player),
    }))
    .sort((left, right) => {
      const leftPpg = asNumber(left.stats?.ppg);
      const rightPpg = asNumber(right.stats?.ppg);
      return (rightPpg ?? 0) - (leftPpg ?? 0);
    })
    .slice(0, 5);
}

function lookupPlayerStats(
  teamStats: BBApiTeamStats | null,
  player: BBApiRosterPlayer,
): Record<string, unknown> | null {
  const statsEntry = teamStats?.players.find((entry) => entry.id === player.id);
  return statsEntry?.stats ?? null;
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
  return match.homeTeam.id === teamId ? match.homeTeam.score : match.awayTeam.score;
}

function deriveOpponentScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (!teamId) {
    return null;
  }
  return match.homeTeam.id === teamId ? match.awayTeam.score : match.homeTeam.score;
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
  payload?: Record<string, unknown> | null;
}): SharedPlayerCardResponse {
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
): Record<string, unknown> {
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
): Record<string, unknown> | null {
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

function normalizeSharedCardText(value: string | null | undefined): string | null {
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

async function resolveAccessKey(env: GraphqlEnv, userId: string): Promise<string> {
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
    status: resolveConnectionField(existingConnection, updates, "status", "UNSET"),
    accessKeyLast4: resolveConnectionField(
      existingConnection,
      updates,
      "accessKeyLast4",
      null,
    ),
    teamId: resolveConnectionField(existingConnection, updates, "teamId", null),
    teamName: resolveConnectionField(existingConnection, updates, "teamName", null),
    shortName: resolveConnectionField(existingConnection, updates, "shortName", null),
    leagueId: resolveConnectionField(existingConnection, updates, "leagueId", null),
    leagueName: resolveConnectionField(
      existingConnection,
      updates,
      "leagueName",
      null,
    ),
    countryId: resolveConnectionField(existingConnection, updates, "countryId", null),
    countryName: resolveConnectionField(
      existingConnection,
      updates,
      "countryName",
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
    lastSyncAt: resolveConnectionField(existingConnection, updates, "lastSyncAt", null),
    lastSyncError: resolveConnectionField(
      existingConnection,
      updates,
      "lastSyncError",
      null,
    ),
    profileJson: resolveConnectionField(existingConnection, updates, "profileJson", null),
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

function readCachedWorkspace(connection: BbConnectionRecord): WorkspaceBundle | null {
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

  return {
    connection,
    home,
    teamHub,
    scout,
    leagueIntel,
    playerLab,
  };
}

async function getCachedWorkspacePlayer(
  env: GraphqlEnv,
  userId: string,
  playerId: string,
): Promise<Record<string, unknown> | null> {
  const connection = await getBbConnection(env, userId);
  const cachedWorkspace = connection ? readCachedWorkspace(connection) : null;
  if (!cachedWorkspace) {
    return null;
  }

  const teamHub = toRecord(cachedWorkspace.teamHub);
  const playerLab = toRecord(cachedWorkspace.playerLab);
  const candidates = [
    ...toRecordArray(teamHub?.roster),
    ...toRecordArray(playerLab?.players),
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
  tendencies: Record<string, unknown> | null,
): string | null {
  if (!tendencies) {
    return null;
  }

  const ordered = Object.entries(tendencies)
    .map(([name, value]) => ({
      name,
      count: asNumber(value) ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 2);

  if (!ordered.length) {
    return null;
  }

  return ordered.map((entry) => `${entry.name} x${entry.count}`).join(", ");
}

function classifySalaryTrend(recentDeltas: number[], weeklyDelta: number): string {
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

function isConnectionStale(
  connection: BbConnectionRecord,
  staleAfterHours: number,
): boolean {
  const lastSyncAt = connection.lastSyncAt ?? connection.connectedAt ?? null;
  if (!lastSyncAt) {
    return true;
  }

  const parsed = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return Date.now() - parsed >= staleAfterHours * 60 * 60 * 1000;
}

function connectionFreshnessSortKey(connection: BbConnectionRecord): number {
  const value = connection.lastSyncAt ?? connection.connectedAt ?? "";
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeConnectionsByTeam(
  connections: BbConnectionRecord[],
): BbConnectionRecord[] {
  const selected = new Map<string, BbConnectionRecord>();

  for (const connection of connections) {
    const key = connection.teamId ?? `user:${connection.userId}`;
    if (!selected.has(key)) {
      selected.set(key, connection);
    }
  }

  return Array.from(selected.values());
}

function byStartTimeAscending(left: BBApiScheduleMatch, right: BBApiScheduleMatch): number {
  return (left.startTime ?? "").localeCompare(right.startTime ?? "");
}

function byStartTimeDescending(left: BBApiScheduleMatch, right: BBApiScheduleMatch): number {
  return (right.startTime ?? "").localeCompare(left.startTime ?? "");
}
