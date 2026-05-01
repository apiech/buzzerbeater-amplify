import { randomUUID } from "node:crypto";

import {
  BBXmlApiClient,
  BBXmlApiError,
  assertOwnedRoster,
  formatRosterGameShapeLabel,
  ownedRosterPlayerToRawPlayerSkills,
} from "../../../lib/bbapi";
import {
  readSharedPlayerCardPayload,
  type ConnectionResultShape,
} from "../../../lib/owned-data/contracts";
import type {
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiBoxScoreTeam,
  BBApiCurrentWorkspace,
  BBApiNamedReference,
  BBApiOwnedRosterPlayer,
  BBApiRosterPlayer,
  BBApiSchedule,
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
  deactivateActiveTrackedTeamsForUser,
  listActiveTrackedTeamsForUser,
  upsertActiveTrackedTeam,
} from "./active-tracked-teams";
import {
  buildArenaPricingSnapshotRecord,
  buildArenaWorkspace,
  selectNextHomeMatch,
} from "./arena-pricing";
import {
  buildLeagueComparisons,
  type LeagueComparisonTeamSnapshot,
} from "./league-comparisons";
import { encryptValue, resolveBbConnectionSecretState } from "./encryption";
import {
  listWorkspacePlayerHistory,
  storeCanonicalPlayerSkillSnapshot,
  type CanonicalPlayerSkillSnapshotRecord,
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
  getRivalsBackfill,
  getMatchBoxscore,
  getTrackedPlayer as getTrackedPlayerRecord,
  getSharedPlayerCardRecord,
  listArenaPricingSnapshotsByUserId,
  type PlayerSkillObservationRecord,
  type TrackedPlayerRecord,
  upsertArenaPricingSnapshot,
  upsertBbConnection,
  upsertBbCredential,
  updateSharedPlayerCard,
  updateSyncRun,
  upsertMatchBoxscore,
  upsertPlayerSkillObservation,
  upsertTrackedPlayer,
  upsertTrackedTeam,
} from "./repository";
import {
  inferLeagueTimeZone,
  normalizeLeagueTimeZone,
} from "../../../lib/league-timezones";
import {
  buildInterviewPersonalitySeed,
  isInterviewPersonalitySource,
  isInterviewPersonalityType,
  resolveDeterministicInterviewPersonality,
  type InterviewPersonalitySource,
  type InterviewPersonalityType,
} from "../../../lib/interview-personalities";
import type { Schema } from "../resource";
import {
  buildCompetitiveRecentSample,
  matchIncludesTeam,
  normalizeScheduleType,
  type CompetitiveRecentSample,
} from "./match-importance";
import {
  buildOpponentCompetitionProfile,
  type ForecastSampleSelection,
  type OpponentCompetitionProfile,
} from "./opponent-competition-profile";
import { assertMaintenanceInactive } from "./maintenance";
import { requireFeatureAccess } from "./billing";
import {
  buildWorkspaceCachePayload,
  readWorkspaceCachePayload,
  type WorkspaceCachePayload,
} from "./workspace-cache";
import {
  projectCurrentConnectionResult,
  projectEmbeddedConnectionResult,
} from "./connection-projection";
import { getNormalizedCachedMatchBoxscore } from "./cached-boxscore";
import { toStoredMatchBoxscore } from "./stored-boxscore";
import {
  buildConnectionRecord,
  loadActiveTrackedTeamCredentialContext,
  resolveAccessKey,
  resolveUserId,
  type ActiveTrackedTeamCredentialContext,
} from "./workspace-connection";
import {
  elapsedMs,
  logWorkspaceError,
  logWorkspaceInfo,
  logWorkspaceWarn,
  toLoggableError,
} from "./workspace-request-logging";
import { syncRivalryMatchFactsFromSchedule } from "./rivals";

type GraphqlEnv = Record<string, string | undefined>;

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type HomeWorkspaceResult = ResolverResult<"getHomeWorkspace">;
type ScoutTeamSummaryResult = ResolverResult<"getScoutTeamSummary">;
type NamedReference = Schema["NamedReference"]["type"];
type PlayerSummaryRecord = ResolverResult<"getPlayerLab">["players"][number];
type StoredOwnedRosterPlayer = Schema["StoredOwnedRosterPlayer"]["type"];
type StoredTeamInfo = Schema["StoredTeamInfo"]["type"];
type TeamInfoSummary = Schema["TeamInfoSummary"]["type"];
type TeamHubWorkspaceResult = Schema["TeamHubWorkspace"]["type"];
type ScoutWorkspaceResult = ScoutTeamSummaryResult;
type ScoutScheduleResult = NonNullable<ScoutWorkspaceResult["schedule"]>;
type LeagueIntelWorkspaceResult = Schema["LeagueIntelWorkspace"]["type"];
type LeagueIntelFreshnessStatus = NonNullable<
  LeagueIntelWorkspaceResult["freshnessStatus"]
>;
type PlayerLabWorkspaceResult = Schema["PlayerLabWorkspace"]["type"];
type ArenaWorkspaceResult = Schema["ArenaWorkspace"]["type"];
type PlayerTrendResult = ResolverResult<"getPlayerTrend">;
type SharedPlayerCardResult = ResolverResult<"generateSharedPlayerCard">;
type SalaryProjectionResult = ResolverResult<"getSalaryProjection">;
type TrackedPlayerInterviewPersonalitySelectionResult =
  ResolverResult<"setTrackedPlayerInterviewPersonality">;

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
type CachedHomeWorkspace = NonNullable<WorkspaceCachePayload["home"]>;
type CachedTeamHubWorkspace = NonNullable<WorkspaceCachePayload["teamHub"]>;
type CachedScoutWorkspace = NonNullable<WorkspaceCachePayload["scout"]>;
type CachedLeagueIntelWorkspace = NonNullable<WorkspaceCachePayload["leagueIntel"]>;
type CachedPlayerLabWorkspace = NonNullable<WorkspaceCachePayload["playerLab"]>;
type CachedArenaWorkspace = NonNullable<WorkspaceCachePayload["arena"]>;

export type WorkspaceBundle = {
  connectionRecord: BbConnectionRecord;
  home: HomeWorkspaceResult;
  teamHub: TeamHubWorkspaceResult;
  scout: ScoutWorkspaceResult;
  leagueIntel: LeagueIntelWorkspaceResult;
  playerLab: PlayerLabWorkspaceResult;
  arena: ArenaWorkspaceResult;
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

type OwnerRosterRepairDependencies = {
  createClient: (args: {
    accessKey: string;
    bbLoginName: string;
  }) => Pick<BBXmlApiClient, "getRoster">;
  getBbConnection: (
    env: GraphqlEnv,
    userId: string,
  ) => Promise<BbConnectionRecord | null>;
  getTrackedPlayer: (
    env: GraphqlEnv,
    userId: string,
    playerId: string,
  ) => Promise<TrackedPlayerRecord | null>;
  resolveAccessKey: (env: GraphqlEnv, userId: string) => Promise<string>;
  storeCanonicalPlayerSkillSnapshot: (
    env: GraphqlEnv,
    record: CanonicalPlayerSkillSnapshotRecord,
  ) => Promise<void>;
  upsertBbConnection: (
    env: GraphqlEnv,
    record: BbConnectionRecord,
  ) => Promise<void>;
  upsertPlayerSkillObservation: (
    env: GraphqlEnv,
    record: PlayerSkillObservationRecord,
  ) => Promise<void>;
  upsertTrackedPlayer: (
    env: GraphqlEnv,
    record: TrackedPlayerRecord,
  ) => Promise<void>;
};

const SHARED_PLAYER_CARD_TTL_DAYS = 30;
const WORKSPACE_PLAYER_PERSIST_CONCURRENCY = 4;
const WORKSPACE_BOXSCORE_PERSIST_CONCURRENCY = 4;
const WORKSPACE_ACTIVE_TRACKED_TEAM_SYNC_CONCURRENCY = 4;
const PLAYER_LAB_PERSONALITY_LOAD_CONCURRENCY = 6;

const defaultWorkspaceDependencies: WorkspaceDependencies = {
  getSharedPlayerCardRecord,
  getTrackedPlayer: async (env, userId, playerId) =>
    ((await getTrackedPlayerRecord(env, userId, playerId)) ??
      (await getCachedWorkspacePlayer(env, userId, playerId))) as SalaryProjectionSource | null,
  listWorkspacePlayerHistory,
  updateSharedPlayerCard,
};

const defaultOwnerRosterRepairDependencies: OwnerRosterRepairDependencies = {
  createClient: ({ accessKey, bbLoginName }) =>
    new BBXmlApiClient({
      username: bbLoginName,
      securityCode: accessKey,
    }),
  getBbConnection,
  getTrackedPlayer: getTrackedPlayerRecord,
  resolveAccessKey,
  storeCanonicalPlayerSkillSnapshot,
  upsertBbConnection,
  upsertPlayerSkillObservation,
  upsertTrackedPlayer,
};

const LIVE_LEAGUE_DATA_UNAVAILABLE_MESSAGE =
  "Live league standings are unavailable right now. League tables and projections stay hidden until a fresh refresh succeeds.";
const LIVE_LEAGUE_SEASON_MISMATCH_MESSAGE =
  "Live league standings did not match the current season. League tables and projections stay hidden until a fresh refresh succeeds.";

export type WorkspaceRefreshMeta = {
  cacheState: "forced" | "hit" | "miss";
  cacheAgeMs?: number | null;
  cacheKind?: "workspace_bundle";
  cachedAt?: string | null;
  matchId?: string | null;
  nextOpponentTeamId: string | null;
  opponentTeamName?: string | null;
  reason?: string | null;
  usedCachedWorkspace: boolean;
};

type ScoutTeamSummaryMeta = {
  recentBoxscoreCount: number;
  recentMatchCount: number;
  requestedTeamId: string | null;
  resolvedTeamId: string | null;
  usedCachedBaseWorkspace: boolean;
};

type BoxscoreHydrationMetrics = {
  cacheHitBoxscoreCount: number;
  completedMatchCount: number;
  hydratedBoxscoreCount: number;
  liveFetchRequestedCount: number;
  liveFetchedBoxscoreCount: number;
};

type HydratedBoxscoreBatch = {
  boxScores: BBApiBoxScore[];
  metrics: BoxscoreHydrationMetrics;
};

type ScoutScheduleStepMetrics = {
  baseWorkspaceMs: number;
  boxscoreHydrationMs: number;
  competitionProfileMs: number;
  currentWorkspaceMs: number;
  seasonsFetchMs: number;
  selectedSeasonScheduleFetchMs: number;
};

type ScoutScheduleMeta = BoxscoreHydrationMetrics & {
  competitionFilterCount: number;
  currentSeason: number | null;
  requestedTeamId: string | null;
  resolvedTeamId: string | null;
  scheduleRowCount: number;
  selectedSeason: number | null;
  selectedSeasonMatchCount: number;
  stepMetrics: ScoutScheduleStepMetrics;
  usedCachedBaseWorkspace: boolean;
};

export const __testing = {
  buildMatchInProgressScoutFallback,
  buildConnectionRecord,
  buildHomeCorePlayers,
  buildLeagueIntel,
  buildHomeWorkspace,
  buildTeamHubRosterFromOwnedRoster,
  countStarters,
  fetchLeagueComparisonTeamSnapshots,
  matchIncludesTeam,
  patchWorkspaceCacheLeagueIntel,
  patchWorkspaceCacheTeamHubRoster,
  resolveScoutTeamId,
  selectCompletedMatches,
  selectNextMatch,
  selectNextScoutMatch,
  selectRecentMatches,
  readCachedWorkspace,
  shouldRefreshLeagueComparisons,
  shouldSyncWorkspace,
};

export async function connectAccount(args: {
  env: GraphqlEnv;
  identity: unknown;
  bbLoginName: string;
  accessKey: string;
}): Promise<ConnectionResultShape> {
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
    return projectCurrentConnectionResult(invalidRecord, "connectAccount result");
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

    return projectCurrentConnectionResult(
      synced.workspace.connectionRecord,
      "connectAccount result",
    );
  } catch (error) {
    const record = buildConnectionRecord(userId, existingConnection, {
      bbLoginName,
      status: classifyConnectionError(error),
      accessKeyLast4: existingConnection?.accessKeyLast4 ?? null,
      lastSyncError: toErrorMessage(error),
      workspaceCacheJson: null,
    });
    await upsertBbConnection(args.env, record);
    return projectCurrentConnectionResult(record, "connectAccount result");
  }
}

export async function disconnectAccount(args: {
  env: GraphqlEnv;
  identity: unknown;
}): Promise<ConnectionResultShape> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const existingConnection = await getBbConnection(args.env, userId);
  if (!existingConnection) {
    return projectCurrentConnectionResult(
      buildConnectionRecord(userId, null, {
        bbLoginName: "",
        status: "DISCONNECTED",
      }),
      "disconnectAccount result",
    );
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
  return projectCurrentConnectionResult(updated, "disconnectAccount result");
}

export async function setLeagueTimeZone(args: {
  env: GraphqlEnv;
  identity: unknown;
  leagueTimeZone: string;
}): Promise<ConnectionResultShape> {
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
  return projectCurrentConnectionResult(
    updatedConnection,
    "setLeagueTimeZone result",
  );
}

export async function setTrackedPlayerInterviewPersonality(args: {
  env: GraphqlEnv;
  identity: unknown;
  personalityType: string | null | undefined;
  playerId: string;
}): Promise<TrackedPlayerInterviewPersonalitySelectionResult> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  await requireFeatureAccess({
    env: args.env,
    featureKey: "leagueWriteups",
    userId,
  });

  const playerId = args.playerId.trim();
  if (!playerId) {
    throw new Error("A player id is required.");
  }

  const trackedPlayer = await getTrackedPlayerRecord(args.env, userId, playerId);
  if (!trackedPlayer) {
    throw new Error(
      "Refresh the Players workspace before editing a player's interview voice.",
    );
  }

  const normalizedRequestedType =
    typeof args.personalityType === "string"
      ? args.personalityType.trim().toLowerCase()
      : null;
  if (
    normalizedRequestedType !== null &&
    normalizedRequestedType !== "" &&
    !isInterviewPersonalityType(normalizedRequestedType)
  ) {
    throw new Error("The selected interview voice is not supported.");
  }

  const personality = resolveInterviewPersonalityState({
    existingRecord:
      normalizedRequestedType && isInterviewPersonalityType(normalizedRequestedType)
        ? {
            interviewPersonalitySource: "user_override",
            interviewPersonalityType: normalizedRequestedType,
          }
        : null,
    playerId: trackedPlayer.playerId,
    playerName: trackedPlayer.fullName,
    teamName: trackedPlayer.teamName,
  });
  const source =
    normalizedRequestedType && isInterviewPersonalityType(normalizedRequestedType)
      ? "user_override"
      : personality.source;
  const type =
    normalizedRequestedType && isInterviewPersonalityType(normalizedRequestedType)
      ? normalizedRequestedType
      : personality.type;

  await upsertTrackedPlayer(args.env, {
    ...trackedPlayer,
    interviewPersonalitySource: source,
    interviewPersonalityType: type,
  });

  return {
    interviewPersonalitySource: source,
    interviewPersonalityType: type,
    playerId,
  };
}

export async function repairOwnerRosterData(
  args: {
    env: GraphqlEnv;
    identity: unknown;
  },
  dependencies: Partial<OwnerRosterRepairDependencies> = {},
): Promise<{
  completedAt: string;
  repairedPlayerCount: number;
}> {
  const resolvedDependencies: OwnerRosterRepairDependencies = {
    ...defaultOwnerRosterRepairDependencies,
    ...dependencies,
  };
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const connection = await resolvedDependencies.getBbConnection(args.env, userId);
  if (!connection) {
    throw new Error(
      "Connect a BuzzerBeater account before repairing roster data.",
    );
  }

  const cachedWorkspace = readWorkspaceCachePayload(connection.workspaceCacheJson);
  if (!cachedWorkspace?.teamHub) {
    throw new Error(
      "No cached workspace is available yet. Refresh your workspace before repairing roster data.",
    );
  }

  const bbLoginName = connection.bbLoginName?.trim();
  if (!bbLoginName) {
    throw new Error("The saved BuzzerBeater login is unavailable.");
  }

  const accessKey = await resolvedDependencies.resolveAccessKey(
    args.env,
    userId,
  );
  const client = resolvedDependencies.createClient({
    accessKey,
    bbLoginName,
  });
  const roster = assertOwnedRoster(
    await client.getRoster(connection.teamId ?? undefined),
    "Owned roster.aspx response",
  );
  const completedAt = new Date().toISOString();
  const teamId = connection.teamId ?? cachedWorkspace.teamHub.team.teamId ?? null;
  const teamName =
    connection.teamName ?? cachedWorkspace.teamHub.team.teamName ?? null;

  if (!teamId) {
    throw new Error("Roster repair requires a resolved owner team id.");
  }

  await mapWithConcurrency(
    roster.players,
    WORKSPACE_PLAYER_PERSIST_CONCURRENCY,
    async (player) => {
      const existingTrackedPlayer = player.id
        ? await resolvedDependencies.getTrackedPlayer(
            args.env,
            userId,
            player.id,
          )
        : null;
      const trackedPlayer = playerToTrackedPlayerRecord(
        userId,
        teamId,
        teamName,
        player,
        completedAt,
        existingTrackedPlayer,
      );
      const snapshot = playerToCanonicalPlayerSnapshot(
        userId,
        teamId,
        teamName,
        player,
        completedAt,
      );
      const observation = playerToHistoricalPlayerObservation(
        userId,
        teamId,
        teamName,
        player,
        completedAt,
      );
      await Promise.all([
        resolvedDependencies.storeCanonicalPlayerSkillSnapshot(args.env, snapshot),
        resolvedDependencies.upsertPlayerSkillObservation(args.env, observation),
        resolvedDependencies.upsertTrackedPlayer(args.env, trackedPlayer),
      ]);
    },
  );

  const updatedConnection = buildConnectionRecord(userId, connection, {
    workspaceCacheJson: patchWorkspaceCacheTeamHubRoster(
      cachedWorkspace,
      buildTeamHubRosterFromOwnedRoster(
        roster.players,
        cachedWorkspace.teamHub.roster,
      ),
    ),
  });
  await resolvedDependencies.upsertBbConnection(args.env, updatedConnection);

  return {
    completedAt,
    repairedPlayerCount: roster.players.length,
  };
}

export async function getOrRefreshWorkspace(args: {
  env: GraphqlEnv;
  identity: unknown;
  force?: boolean;
  syncActiveTrackedTeams?: boolean;
}): Promise<WorkspaceBundle> {
  return (
    await getOrRefreshWorkspaceWithMeta({
      env: args.env,
      force: args.force,
      identity: args.identity,
      syncActiveTrackedTeams: args.syncActiveTrackedTeams,
    })
  ).workspace;
}

export async function getOrRefreshWorkspaceWithMeta(args: {
  env: GraphqlEnv;
  identity: unknown;
  force?: boolean;
  syncActiveTrackedTeams?: boolean;
}): Promise<{
  meta: WorkspaceRefreshMeta;
  workspace: WorkspaceBundle;
}> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const syncedWorkspace = await syncWorkspace({
    env: args.env,
    userId,
    force: args.force ?? false,
    syncActiveTrackedTeams: args.syncActiveTrackedTeams ?? false,
  });

  return {
    ...syncedWorkspace,
    workspace: await withPlayerLabInterviewPersonalities({
      env: args.env,
      userId,
      workspace: syncedWorkspace.workspace,
    }),
  };
}

export async function getLeagueIntelWorkspace(args: {
  env: GraphqlEnv;
  force?: boolean;
  identity: unknown;
}): Promise<LeagueIntelWorkspaceResult> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const force = args.force ?? false;
  const { meta, workspace } = await getOrRefreshWorkspaceWithMeta({
    env: args.env,
    force,
    identity: args.identity,
    syncActiveTrackedTeams: false,
  });

  const connection = workspace.connectionRecord;
  if (meta.usedCachedWorkspace) {
    logWorkspaceWarn("getLeagueIntel.cached_workspace_unavailable", {
      cacheState: meta.cacheState,
      force,
      lastSyncAt: connection.lastSyncAt ?? null,
      lastSyncError: connection.lastSyncError ?? null,
      usedCachedWorkspace: true,
      userId,
    });
    return buildUnavailableLeagueIntel({
      league: workspace.leagueIntel.league ?? null,
      message: LIVE_LEAGUE_DATA_UNAVAILABLE_MESSAGE,
      season: workspace.leagueIntel.season ?? null,
    });
  }

  if (workspace.leagueIntel.freshnessStatus === "UNAVAILABLE") {
    logWorkspaceWarn("getLeagueIntel.live_unavailable", {
      force,
      freshnessMessage: workspace.leagueIntel.freshnessMessage ?? null,
      lastSyncAt: connection.lastSyncAt ?? null,
      season: workspace.leagueIntel.season ?? null,
      userId,
    });
    return workspace.leagueIntel;
  }

  if (!workspace.leagueIntel.standings.length) {
    return workspace.leagueIntel;
  }

  if (
    !shouldRefreshLeagueComparisons({
      comparisons: workspace.leagueIntel.comparisons ?? null,
      force,
      lastSyncAt: connection.lastSyncAt ?? null,
    })
  ) {
    return workspace.leagueIntel;
  }

  const bbLoginName = connection.bbLoginName?.trim();
  if (!bbLoginName) {
    throw new Error("The saved BuzzerBeater login is unavailable.");
  }

  const accessKey = await resolveAccessKey(args.env, userId);
  const client = new BBXmlApiClient({
    securityCode: accessKey,
    username: bbLoginName,
  });
  const builtAt = new Date().toISOString();
  const teamSnapshots = await fetchLeagueComparisonTeamSnapshots(
    client,
    workspace.leagueIntel.standings,
  );
  const enrichedLeagueIntel = {
    ...workspace.leagueIntel,
    comparisons: buildLeagueComparisons({
      builtAt,
      teamSnapshots,
    }),
  } satisfies LeagueIntelWorkspaceResult;

  const cachedWorkspace = readWorkspaceCachePayload(connection.workspaceCacheJson);
  if (cachedWorkspace) {
    const updatedConnection = buildConnectionRecord(userId, connection, {
      workspaceCacheJson: patchWorkspaceCacheLeagueIntel(
        cachedWorkspace,
        enrichedLeagueIntel,
      ),
    });
    await upsertBbConnection(args.env, updatedConnection);
  }

  return enrichedLeagueIntel;
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
    payload: readStoredSharedPlayerCardPayload(record.payloadJson),
  });
}

async function _getScoutWorkspaceForTeam(args: {
  competitionKeys?: string[] | null;
  env: GraphqlEnv;
  force?: boolean;
  identity: unknown;
  season?: number | null;
  teamId?: string | null;
}): Promise<{
  competitionProfile: OpponentCompetitionProfile | null;
  connection: BbConnectionRecord;
  scout: ScoutWorkspaceResult;
}> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const baseWorkspace = await getOrRefreshWorkspace({
    env: args.env,
    force: args.force ?? false,
    identity: args.identity,
    syncActiveTrackedTeams: false,
  });

  const requestedTeamId = normalizeScoutRequestedTeamId(args.teamId);
  const resolvedTeamId = resolveScoutTeamId(baseWorkspace, requestedTeamId);
  if (!resolvedTeamId) {
      return {
        competitionProfile: null,
        connection: baseWorkspace.connectionRecord,
        scout: buildScoutFallback(baseWorkspace, requestedTeamId),
      };
  }

  const accessKey = await resolveAccessKey(args.env, userId);
  const client = new BBXmlApiClient({
    username: baseWorkspace.connectionRecord.bbLoginName,
    securityCode: accessKey,
  });
  try {
    const currentWorkspace = await client.getCurrentWorkspace();
    const recentMatches = selectRecentMatches(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
    );
    const currentBoxScores = await fetchRecentBoxScores(client, recentMatches);
    const opponentWorkspace = await fetchOpponentWorkspace(
      args.env,
      userId,
      client,
      resolvedTeamId,
      currentWorkspace,
      {
        competitionKeys: args.competitionKeys ?? null,
        selectedSeason: args.season ?? null,
      },
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
      competitionProfile: opponentWorkspace?.competitionProfile ?? null,
      connection: baseWorkspace.connectionRecord,
      scout: buildScoutWorkspace(
        currentWorkspace,
        currentBoxScores,
        opponentWorkspace,
        resolvedTeamId,
        fetchedAt,
      ),
    };
  } catch (error) {
    if (isMatchInProgressWorkspaceError(error)) {
      logWorkspaceWarn("getScoutTeamSummary.match_in_progress_fallback", {
        requestedTeamId: requestedTeamId || null,
        resolvedTeamId,
        userId,
        ...toLoggableError(error),
      });
      return {
        competitionProfile: null,
        connection: baseWorkspace.connectionRecord,
        scout: buildMatchInProgressScoutFallback(
          baseWorkspace,
          requestedTeamId,
          resolvedTeamId,
        ),
      };
    }
    throw error;
  }
}

export async function getScoutTeamSummaryForTeam(args: {
  env: GraphqlEnv;
  force?: boolean;
  identity: unknown;
  teamId?: string | null;
}): Promise<{
  connection: BbConnectionRecord;
  scout: ScoutTeamSummaryResult;
}> {
  const { connection, scout } = await getScoutTeamSummaryForTeamWithMeta({
    env: args.env,
    force: args.force,
    identity: args.identity,
    teamId: args.teamId,
  });
  return { connection, scout };
}

export async function getScoutTeamSummaryForTeamWithMeta(args: {
  env: GraphqlEnv;
  force?: boolean;
  identity: unknown;
  teamId?: string | null;
}): Promise<{
  connection: BbConnectionRecord;
  meta: ScoutTeamSummaryMeta;
  scout: ScoutTeamSummaryResult;
}> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const {
    meta: baseWorkspaceMeta,
    workspace: baseWorkspace,
  } = await getOrRefreshWorkspaceWithMeta({
    env: args.env,
    force: args.force ?? false,
    identity: args.identity,
    syncActiveTrackedTeams: false,
  });

  const requestedTeamId = normalizeScoutRequestedTeamId(args.teamId);
  const resolvedTeamId = resolveScoutTeamId(baseWorkspace, requestedTeamId);
  if (!resolvedTeamId) {
    return {
      connection: baseWorkspace.connectionRecord,
      meta: {
        recentBoxscoreCount: 0,
        recentMatchCount: 0,
        requestedTeamId: requestedTeamId || null,
        resolvedTeamId: null,
        usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
      },
      scout: buildScoutFallback(baseWorkspace, requestedTeamId),
    };
  }

  const accessKey = await resolveAccessKey(args.env, userId);
  const client = new BBXmlApiClient({
    username: baseWorkspace.connectionRecord.bbLoginName,
    securityCode: accessKey,
  });
  try {
    const currentWorkspace = await client.getCurrentWorkspace();
    const recentMatches = selectRecentMatches(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
    );
    const currentBoxScores = await fetchRecentBoxScores(client, recentMatches);
    const opponentWorkspace = await fetchHomeOpponentWorkspace(
      args.env,
      userId,
      client,
      resolvedTeamId,
      currentWorkspace,
    );
    const fetchedAt = new Date().toISOString();
    const scout = buildScoutWorkspace(
      currentWorkspace,
      currentBoxScores,
      opponentWorkspace,
      resolvedTeamId,
      fetchedAt,
    );

    return {
      connection: baseWorkspace.connectionRecord,
      meta: {
        recentBoxscoreCount: opponentWorkspace.recentBoxScores.length,
        recentMatchCount: opponentWorkspace.recentMatches.length,
        requestedTeamId: requestedTeamId || null,
        resolvedTeamId,
        usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
      },
      scout,
    };
  } catch (error) {
    if (isMatchInProgressWorkspaceError(error)) {
      const scout = buildMatchInProgressScoutFallback(
        baseWorkspace,
        requestedTeamId,
        resolvedTeamId,
      );
      logWorkspaceWarn("getScoutTeamSummary.match_in_progress_fallback", {
        recentMatchCount: scout.summary?.recentGames.length ?? 0,
        requestedTeamId: requestedTeamId || null,
        resolvedTeamId,
        usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
        userId,
        ...toLoggableError(error),
      });
      return {
        connection: baseWorkspace.connectionRecord,
        meta: {
          recentBoxscoreCount:
            scout.summary?.recentGames.filter((match) => match.hasBoxscore)
              .length ?? 0,
          recentMatchCount: scout.summary?.recentGames.length ?? 0,
          requestedTeamId: requestedTeamId || null,
          resolvedTeamId,
          usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
        },
        scout,
      };
    }
    throw error;
  }
}

export async function getScoutScheduleForTeam(args: {
  competitionKeys?: string[] | null;
  env: GraphqlEnv;
  force?: boolean;
  identity: unknown;
  season?: number | null;
  teamId?: string | null;
}): Promise<ScoutScheduleResult | null> {
  const { schedule } = await getScoutScheduleForTeamWithMeta({
    competitionKeys: args.competitionKeys,
    env: args.env,
    force: args.force,
    identity: args.identity,
    season: args.season,
    teamId: args.teamId,
  });
  return schedule;
}

export async function getScoutScheduleForTeamWithMeta(args: {
  competitionKeys?: string[] | null;
  env: GraphqlEnv;
  force?: boolean;
  identity: unknown;
  season?: number | null;
  teamId?: string | null;
}): Promise<{
  competitionProfile: OpponentCompetitionProfile | null;
  meta: ScoutScheduleMeta;
  schedule: ScoutScheduleResult | null;
}> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const requestStartedAt = Date.now();
  const baseWorkspaceStartedAt = Date.now();
  const {
    meta: baseWorkspaceMeta,
    workspace: baseWorkspace,
  } = await getOrRefreshWorkspaceWithMeta({
    env: args.env,
    force: args.force ?? false,
    identity: args.identity,
    syncActiveTrackedTeams: false,
  });
  const baseWorkspaceMs = elapsedMs(baseWorkspaceStartedAt);
  logWorkspaceInfo("getScoutSchedule.base_workspace.ready", {
    baseWorkspaceMs,
    elapsedMs: elapsedMs(requestStartedAt),
    force: args.force ?? false,
    usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
    userId,
  });

  const requestedTeamId = normalizeScoutRequestedTeamId(args.teamId);
  const resolvedTeamId = resolveScoutTeamId(baseWorkspace, requestedTeamId);
  if (!resolvedTeamId) {
    return {
      competitionProfile: null,
      meta: {
        cacheHitBoxscoreCount: 0,
        competitionFilterCount: args.competitionKeys?.length ?? 0,
        completedMatchCount: 0,
        currentSeason: null,
        hydratedBoxscoreCount: 0,
        liveFetchedBoxscoreCount: 0,
        liveFetchRequestedCount: 0,
        requestedTeamId: requestedTeamId || null,
        resolvedTeamId: null,
        scheduleRowCount: 0,
        selectedSeason: args.season ?? null,
        selectedSeasonMatchCount: 0,
        stepMetrics: {
          baseWorkspaceMs,
          boxscoreHydrationMs: 0,
          competitionProfileMs: 0,
          currentWorkspaceMs: 0,
          seasonsFetchMs: 0,
          selectedSeasonScheduleFetchMs: 0,
        },
        usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
      },
      schedule: null,
    };
  }

  const accessKey = await resolveAccessKey(args.env, userId);
  const client = new BBXmlApiClient({
    username: baseWorkspace.connectionRecord.bbLoginName,
    securityCode: accessKey,
  });
  const currentWorkspaceStartedAt = Date.now();
  try {
    const currentWorkspace = await client.getCurrentWorkspace();
    const currentWorkspaceMs = elapsedMs(currentWorkspaceStartedAt);
    logWorkspaceInfo("getScoutSchedule.current_workspace.ready", {
      currentSeason: currentWorkspace.schedule.season ?? null,
      currentWorkspaceMs,
      elapsedMs: elapsedMs(requestStartedAt),
      resolvedTeamId,
      userId,
    });

    const scheduleResult = await fetchOpponentSchedule({
      client,
      competitionKeys: args.competitionKeys ?? null,
      currentSeason: currentWorkspace.schedule.season ?? null,
      env: args.env,
      opponentTeamId: resolvedTeamId,
      selectedSeason: args.season ?? null,
      userId,
    });

    return {
      competitionProfile: scheduleResult.competitionProfile,
      meta: {
        ...scheduleResult.meta,
        currentSeason: currentWorkspace.schedule.season ?? null,
        requestedTeamId: requestedTeamId || null,
        resolvedTeamId,
        stepMetrics: {
          ...scheduleResult.meta.stepMetrics,
          baseWorkspaceMs,
          currentWorkspaceMs,
        },
        usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
      },
      schedule: scheduleResult.schedule,
    };
  } catch (error) {
    if (isMatchInProgressWorkspaceError(error)) {
      const currentWorkspaceMs = elapsedMs(currentWorkspaceStartedAt);
      const fallbackSchedule =
        resolvedTeamId === (baseWorkspace.scout.teamId ?? null)
          ? (baseWorkspace.scout.schedule ?? null)
          : null;
      logWorkspaceWarn("getScoutSchedule.match_in_progress_fallback", {
        competitionFilterCount: args.competitionKeys?.length ?? 0,
        currentWorkspaceMs,
        elapsedMs: elapsedMs(requestStartedAt),
        requestedTeamId: requestedTeamId || null,
        resolvedTeamId,
        scheduleRowCount: fallbackSchedule?.rows.length ?? 0,
        selectedSeason: args.season ?? fallbackSchedule?.selectedSeason ?? null,
        usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
        userId,
        ...toLoggableError(error),
      });
      return {
        competitionProfile: null,
        meta: {
          cacheHitBoxscoreCount: 0,
          competitionFilterCount: args.competitionKeys?.length ?? 0,
          completedMatchCount: 0,
          currentSeason: null,
          hydratedBoxscoreCount: 0,
          liveFetchedBoxscoreCount: 0,
          liveFetchRequestedCount: 0,
          requestedTeamId: requestedTeamId || null,
          resolvedTeamId,
          scheduleRowCount: fallbackSchedule?.rows.length ?? 0,
          selectedSeason: args.season ?? fallbackSchedule?.selectedSeason ?? null,
          selectedSeasonMatchCount: fallbackSchedule?.rows.length ?? 0,
          stepMetrics: {
            baseWorkspaceMs,
            boxscoreHydrationMs: 0,
            competitionProfileMs: 0,
            currentWorkspaceMs,
            seasonsFetchMs: 0,
            selectedSeasonScheduleFetchMs: 0,
          },
          usedCachedBaseWorkspace: baseWorkspaceMeta.usedCachedWorkspace,
        },
        schedule: fallbackSchedule,
      };
    }
    throw error;
  }
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

  const payload = readStoredSharedPlayerCardPayload(record.payloadJson);
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
}): Promise<{
  meta: WorkspaceRefreshMeta;
  workspace: WorkspaceBundle;
}> {
  const syncStartedAt = Date.now();
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
    const cacheMeta = buildWorkspaceCacheMeta(cachedWorkspace);
    logWorkspaceInfo("syncWorkspace.cache_hit", {
      ...cacheMeta,
      elapsedMs: elapsedMs(syncStartedAt),
      force: args.force ?? false,
      userId: args.userId,
    });
    return {
      meta: {
        ...cacheMeta,
        cacheState: "hit",
        usedCachedWorkspace: true,
      },
      workspace: cachedWorkspace,
    };
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
    logWorkspaceInfo("syncWorkspace.start", {
      force: args.force ?? false,
      syncActiveTrackedTeams: args.syncActiveTrackedTeams ?? false,
      userId: args.userId,
    });
    const accessKey =
      args.credentialsOverride?.accessKey ??
      (await resolveAccessKey(args.env, args.userId));
    const bbLoginName =
      args.credentialsOverride?.bbLoginName ?? connection.bbLoginName;

    const client = new BBXmlApiClient({
      username: bbLoginName,
      securityCode: accessKey,
    });

    const currentWorkspaceStartedAt = Date.now();
    const currentWorkspace = await client.getCurrentWorkspace();
    logWorkspaceInfo("syncWorkspace.current_workspace.ready", {
      elapsedMs: elapsedMs(syncStartedAt),
      stepMs: elapsedMs(currentWorkspaceStartedAt),
      teamId: currentWorkspace.teamInfo.teamId ?? null,
      userId: args.userId,
    });
    const nextMatch = selectNextMatch(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
    );
    const nextHomeMatch = selectNextHomeMatch(
      currentWorkspace.schedule.matches,
      currentWorkspace.teamInfo.teamId,
    );
    const nextScoutMatch = selectNextScoutMatch(
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
    const homeCoreBoxScoresStartedAt = Date.now();
    const homeCoreBoxScores = await fetchRecentBoxScores(client, homeCoreMatches);
    const homeCoreBoxScoreByMatchId = new Map(
      homeCoreBoxScores
        .filter((boxScore) => Boolean(boxScore.matchId))
        .map((boxScore) => [boxScore.matchId as string, boxScore]),
    );
    const currentBoxScores = recentMatches
      .map((match) => (match.id ? (homeCoreBoxScoreByMatchId.get(match.id) ?? null) : null))
      .filter((boxScore): boxScore is BBApiBoxScore => boxScore !== null);
    logWorkspaceInfo("syncWorkspace.home_core_boxscores.ready", {
      elapsedMs: elapsedMs(syncStartedAt),
      homeCoreBoxscoreCount: homeCoreBoxScores.length,
      recentBoxscoreCount: currentBoxScores.length,
      stepMs: elapsedMs(homeCoreBoxScoresStartedAt),
      userId: args.userId,
    });
    const nextOpponentTeamId = nextMatch
      ? deriveOpponentTeamId(nextMatch, currentWorkspace.teamInfo.teamId)
      : null;

    const nextOpponentStartedAt = Date.now();
    const opponentWorkspace = nextOpponentTeamId
      ? await fetchHomeOpponentWorkspace(
          args.env,
          args.userId,
          client,
          nextOpponentTeamId,
          currentWorkspace,
        )
      : null;
    logWorkspaceInfo("syncWorkspace.home_opponent.ready", {
      elapsedMs: elapsedMs(syncStartedAt),
      nextOpponentTeamId,
      recentBoxscoreCount: opponentWorkspace?.recentBoxScores.length ?? 0,
      recentMatchCount: opponentWorkspace?.recentMatches.length ?? 0,
      stepMs: elapsedMs(nextOpponentStartedAt),
      userId: args.userId,
    });

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
      profileJson: projectTeamInfo(currentWorkspace.teamInfo),
    });
    const home = buildHomeWorkspace(
      currentWorkspace,
      nextMatch,
      nextScoutMatch,
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
    const leagueIntel = buildLeagueIntel({
      currentSeason: currentWorkspace.currentSeason,
      standings: currentWorkspace.standings,
    });
    const playerLab = buildPlayerLab(
      currentWorkspace,
      currentBoxScores,
      connectionForViews.lastSyncAt ?? null,
    );
    const historicalArenaSnapshots = await listArenaPricingSnapshotsByUserId(
      args.env,
      args.userId,
    );
    const arena = buildArenaWorkspace({
      referenceBoxScores: currentBoxScores,
      referenceMatches: currentWorkspace.schedule.matches,
      snapshots: historicalArenaSnapshots,
      syncedAt: connectionForViews.lastSyncAt ?? null,
      workspace: currentWorkspace,
    });

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
          arena,
        }),
      },
    );
    await upsertBbConnection(args.env, updatedConnection);
    const persistWorkspaceStartedAt = Date.now();
    const persistedWorkspace = await persistWorkspace(
      args.env,
      args.userId,
      currentWorkspace,
      recentMatches,
      currentBoxScores,
      opponentWorkspace,
      now,
    );
    logWorkspaceInfo("syncWorkspace.persist_workspace.ready", {
      elapsedMs: elapsedMs(syncStartedAt),
      persistedBoxscoreCount: persistedWorkspace.persistedBoxscoreCount,
      persistedPlayerCount: persistedWorkspace.persistedPlayerCount,
      persistedTeamCount: persistedWorkspace.persistedTeamCount,
      stepMs: elapsedMs(persistWorkspaceStartedAt),
      userId: args.userId,
    });
    await upsertArenaPricingSnapshot(
      args.env,
      buildArenaPricingSnapshotRecord({
        capturedAt: now,
        nextHomeMatch,
        userId: args.userId,
        workspace: currentWorkspace,
      }),
    );
    if (currentWorkspace.teamInfo.teamId) {
      const rivalsSyncStartedAt = Date.now();
      try {
        const rivalsStatus = await getRivalsBackfill(
          args.env,
          args.userId,
          currentWorkspace.teamInfo.teamId,
        );
        if (rivalsStatus?.status === "SUCCEEDED") {
          const factCount = await syncRivalryMatchFactsFromSchedule({
            env: args.env,
            matches: currentWorkspace.schedule.matches,
            season: currentWorkspace.schedule.season ?? null,
            teamId: currentWorkspace.teamInfo.teamId,
            userId: args.userId,
          });
          logWorkspaceInfo("syncWorkspace.rivalry_facts.ready", {
            elapsedMs: elapsedMs(syncStartedAt),
            factCount,
            stepMs: elapsedMs(rivalsSyncStartedAt),
            userId: args.userId,
          });
        }
      } catch (error) {
        logWorkspaceWarn("syncWorkspace.rivalry_facts.failed", {
          elapsedMs: elapsedMs(syncStartedAt),
          stepMs: elapsedMs(rivalsSyncStartedAt),
          userId: args.userId,
          ...toLoggableError(error),
        });
      }
    }
    if (args.syncActiveTrackedTeams) {
      const credentialContext = await loadActiveTrackedTeamCredentialContext(
        args.env,
        args.userId,
        bbLoginName,
        args.credentialOverride,
      );
      const syncTrackedTeamsStartedAt = Date.now();
      await syncOwnedActiveTrackedTeams(
        args.env,
        args.userId,
        currentWorkspace,
        now,
        credentialContext,
      );
      logWorkspaceInfo("syncWorkspace.active_tracked_teams.ready", {
        elapsedMs: elapsedMs(syncStartedAt),
        stepMs: elapsedMs(syncTrackedTeamsStartedAt),
        userId: args.userId,
      });
    }

    await updateSyncRun(args.env, {
      id: syncRun.id,
      status: "SUCCEEDED",
      completedAt: now,
      detailsJson: {
        nextOpponentTeamId,
      },
    });

    logWorkspaceInfo("syncWorkspace.completed", {
      elapsedMs: elapsedMs(syncStartedAt),
      force: args.force ?? false,
      nextOpponentTeamId,
      syncedAt: now,
      userId: args.userId,
    });

    return {
      meta: {
        cacheState: args.force ? "forced" : "miss",
        nextOpponentTeamId,
        usedCachedWorkspace: false,
      },
      workspace: {
        connectionRecord: updatedConnection,
        home,
        teamHub,
        scout,
        leagueIntel,
        playerLab,
        arena,
      },
    };
  } catch (error) {
    if (cachedWorkspace && isMatchInProgressWorkspaceError(error)) {
      const now = new Date().toISOString();
      const lastSyncError = buildMatchInProgressWorkspaceWarning();
      const fallbackHomeConnection = projectEmbeddedConnectionResult(
        {
          ...projectHomeWorkspaceConnection(
            connection,
            cachedWorkspace.home.connection,
            "match-in-progress fallback home connection base",
          ),
          lastSyncError,
          status: "CONNECTED",
        },
        "match-in-progress fallback home connection",
      );
      const fallbackConnection = buildConnectionRecord(args.userId, connection, {
        accessKeyLast4: fallbackHomeConnection.accessKeyLast4,
        bbLoginName: fallbackHomeConnection.bbLoginName,
        connectedAt: fallbackHomeConnection.connectedAt,
        countryId: fallbackHomeConnection.countryId,
        countryName: fallbackHomeConnection.countryName,
        lastSyncAt: fallbackHomeConnection.lastSyncAt,
        lastSyncError,
        leagueId: fallbackHomeConnection.leagueId,
        leagueName: fallbackHomeConnection.leagueName,
        leagueTimeZone: fallbackHomeConnection.leagueTimeZone,
        lastValidatedAt: fallbackHomeConnection.lastValidatedAt,
        profileJson: fallbackHomeConnection.profileJson,
        status: "CONNECTED",
        teamId: fallbackHomeConnection.teamId,
        teamName: fallbackHomeConnection.teamName,
      });
      await upsertBbConnection(args.env, fallbackConnection);
      await updateSyncRun(args.env, {
        id: syncRun.id,
        status: "SUCCEEDED",
        completedAt: now,
        detailsJson: {
          degradedReason: "MATCH_IN_PROGRESS",
          nextOpponentTeamId: cachedWorkspace.home.nextMatch?.opponentTeamId ?? null,
          usedCachedWorkspace: true,
        },
      });
      const cacheMeta = buildWorkspaceCacheMeta(cachedWorkspace);
      logWorkspaceWarn("syncWorkspace.match_in_progress_fallback", {
        ...cacheMeta,
        elapsedMs: elapsedMs(syncStartedAt),
        force: args.force ?? false,
        userId: args.userId,
        ...toLoggableError(error),
      });
      return {
        meta: {
          ...cacheMeta,
          cacheState: args.force ? "forced" : "hit",
          usedCachedWorkspace: true,
        },
        workspace: {
          ...cachedWorkspace,
          connectionRecord: fallbackConnection,
          home: {
            ...cachedWorkspace.home,
            connection: fallbackHomeConnection,
          },
        },
      };
    }

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
    logWorkspaceError("syncWorkspace.failed", {
      elapsedMs: elapsedMs(syncStartedAt),
      force: args.force ?? false,
      userId: args.userId,
      ...toLoggableError(error),
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
): Promise<{
  persistedBoxscoreCount: number;
  persistedPlayerCount: number;
  persistedTeamCount: number;
}> {
  const primaryTeamId = workspace.teamInfo.teamId;
  if (!primaryTeamId) {
    throw new Error("Workspace team info did not include a primary teamId.");
  }

  const trackedTeamsToPersist = [
    {
      userId,
      teamId: primaryTeamId,
      name: workspace.teamInfo.teamName ?? "Unknown team",
      arenaName: workspace.arena.name ?? null,
      shortName: workspace.teamInfo.shortName ?? null,
      leagueId: workspace.teamInfo.league?.id ?? null,
      leagueName: workspace.teamInfo.league?.name ?? null,
      countryId: workspace.teamInfo.country?.id ?? null,
      countryName: workspace.teamInfo.country?.name ?? null,
      rivalId: workspace.teamInfo.rival?.id ?? null,
      isPrimary: true,
      summaryJson: projectTeamInfo(workspace.teamInfo),
      fetchedAt,
    },
    ...(opponentWorkspace?.teamInfo.teamId
      ? [
          {
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
            summaryJson: projectTeamInfo(opponentWorkspace.teamInfo),
            fetchedAt,
          },
        ]
      : []),
  ];
  await Promise.all(
    trackedTeamsToPersist.map((trackedTeam) => upsertTrackedTeam(env, trackedTeam)),
  );

  await mapWithConcurrency(
    workspace.roster.players,
    WORKSPACE_PLAYER_PERSIST_CONCURRENCY,
    async (player) => {
      const existingTrackedPlayer = player.id
        ? await getTrackedPlayerRecord(env, userId, player.id)
        : null;
      const trackedPlayer = playerToTrackedPlayerRecord(
        userId,
        workspace.teamInfo.teamId,
        workspace.teamInfo.teamName,
        player,
        fetchedAt,
        existingTrackedPlayer,
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
    },
  );

  const boxScoresToPersist = Array.from(
    new Map(
      [...currentBoxScores, ...(opponentWorkspace?.hydratedBoxScores ?? [])]
        .filter((boxScore) => Boolean(boxScore.matchId))
        .map((boxScore) => [boxScore.matchId as string, boxScore]),
    ).values(),
  );
  await mapWithConcurrency(
    boxScoresToPersist,
    WORKSPACE_BOXSCORE_PERSIST_CONCURRENCY,
    async (boxScore) => {
      const storedBoxscore = toStoredMatchBoxscore({
        boxscore: boxScore,
        source: "WORKSPACE_CACHE",
      });
      if (!storedBoxscore) {
        return;
      }

      await upsertMatchBoxscore(env, {
        userId,
        matchId: storedBoxscore.matchId,
        boxscoreJson: storedBoxscore,
        fetchedAt,
      });
    },
  );

  return {
    persistedBoxscoreCount: boxScoresToPersist.length,
    persistedPlayerCount: workspace.roster.players.length,
    persistedTeamCount: trackedTeamsToPersist.length,
  };
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

  const inactiveTeams = existingTeams.filter(
    (trackedTeam) => trackedTeam.teamId !== primaryTeamId,
  );
  await mapWithConcurrency(
    inactiveTeams,
    WORKSPACE_ACTIVE_TRACKED_TEAM_SYNC_CONCURRENCY,
    async (trackedTeam) => {
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
    },
  );
}

type OpponentWorkspace = {
  competitionProfile: OpponentCompetitionProfile | null;
  forecastSample: ForecastSampleSelection | null;
  hydratedBoxScores: BBApiBoxScore[];
  teamInfo: BBApiTeamInfo;
  roster: { players: BBApiRosterPlayer[] };
  schedule: ScoutScheduleResult | null;
  teamStats: BBApiTeamStats | null;
  nextMatch: BBApiScheduleMatch | null;
  recentMatches: BBApiScheduleMatch[];
  recentBoxScores: BBApiBoxScore[];
};

function normalizeScoutRequestedTeamId(teamId?: string | null): string {
  return teamId?.trim() ?? "";
}

function resolveScoutTeamId(
  baseWorkspace: WorkspaceBundle,
  requestedTeamId: string,
): string {
  return (
    requestedTeamId ||
    baseWorkspace.home.nextScoutMatch?.opponentTeamId ||
    baseWorkspace.scout.teamId ||
    ""
  );
}

function isMatchInProgressWorkspaceError(error: unknown): boolean {
  return (
    error instanceof BBXmlApiError &&
    /match[\s_-]*in[\s_-]*progress/i.test(error.message)
  );
}

function buildMatchInProgressWorkspaceWarning(): string {
  return "A live BuzzerBeater match is in progress, so we're showing your last saved club snapshot until the current game window ends.";
}

function buildScoutFallback(
  baseWorkspace: WorkspaceBundle,
  requestedTeamId: string,
): ScoutTeamSummaryResult {
  return {
    syncedAt: baseWorkspace.scout.syncedAt ?? null,
    teamId: baseWorkspace.scout.teamId ?? null,
    availableOpponents: baseWorkspace.scout.availableOpponents,
    recentMatchups: baseWorkspace.scout.recentMatchups,
    schedule: null,
    summary: baseWorkspace.scout.summary ?? null,
    requestedTeamId: requestedTeamId || baseWorkspace.scout.requestedTeamId || null,
    message: baseWorkspace.scout.message ?? null,
  };
}

function buildMatchInProgressScoutFallback(
  baseWorkspace: WorkspaceBundle,
  requestedTeamId: string,
  resolvedTeamId: string,
): ScoutTeamSummaryResult {
  const cachedScoutTeamId =
    baseWorkspace.scout.teamId ?? baseWorkspace.home.nextMatch?.opponentTeamId ?? null;
  const nextScoutOpponentTeamId = baseWorkspace.home.nextScoutMatch?.opponentTeamId ?? null;
  const liveOpponentTeamId = baseWorkspace.home.nextMatch?.opponentTeamId ?? null;
  const rolledForwardToNextScheduledOpponent = Boolean(
    !requestedTeamId &&
      nextScoutOpponentTeamId &&
      nextScoutOpponentTeamId === resolvedTeamId &&
      nextScoutOpponentTeamId !== liveOpponentTeamId,
  );
  const opponentName =
    baseWorkspace.scout.availableOpponents.find(
      (opponent) => opponent.teamId === resolvedTeamId,
    )?.teamName ?? baseWorkspace.scout.summary?.teamName ?? "this opponent";
  const nextScoutOpponentName =
    baseWorkspace.home.nextScoutMatch?.opponentTeamName ?? opponentName;

  if (resolvedTeamId && resolvedTeamId === cachedScoutTeamId) {
    return {
      ...buildScoutFallback(baseWorkspace, requestedTeamId),
      message: rolledForwardToNextScheduledOpponent
        ? `A live BuzzerBeater match is in progress, so this page is showing the last ready scout snapshot for your next scheduled opponent, ${nextScoutOpponentName}, until the current game window ends.`
        : requestedTeamId
          ? `A live BuzzerBeater match is in progress, so this page is showing the last ready scout snapshot for ${opponentName} until the game window ends.`
          : "A live BuzzerBeater match is in progress, so this page is showing the last ready scout snapshot for your next opponent until the game window ends.",
      requestedTeamId:
        requestedTeamId || resolvedTeamId || baseWorkspace.scout.requestedTeamId || null,
      teamId: resolvedTeamId,
    };
  }

  return {
    syncedAt: baseWorkspace.scout.syncedAt ?? baseWorkspace.home.syncedAt ?? null,
    teamId: resolvedTeamId || null,
    availableOpponents: baseWorkspace.scout.availableOpponents,
    recentMatchups: [],
    schedule: null,
    summary: null,
    requestedTeamId: requestedTeamId || resolvedTeamId || null,
    message: rolledForwardToNextScheduledOpponent
      ? `A live BuzzerBeater match is in progress, so a fresh scout view for your next scheduled opponent, ${nextScoutOpponentName}, is unavailable until the current game window ends.`
      : `A live BuzzerBeater match is in progress, so a fresh scout view for ${opponentName} is unavailable until the game window ends. Try again after the live game window closes.`,
  };
}

async function fetchHomeOpponentWorkspace(
  env: GraphqlEnv,
  userId: string,
  client: BBXmlApiClient,
  opponentTeamId: string,
  currentWorkspace: BBApiCurrentWorkspace,
): Promise<OpponentWorkspace> {
  const currentSeason = currentWorkspace.schedule.season ?? undefined;
  const emptySchedule: BBApiSchedule = {
    matches: [],
    retrievedAt: null,
    season: currentWorkspace.schedule.season ?? null,
    teamId: opponentTeamId,
    version: "1",
  };
  const [teamInfo, roster, teamStats, schedule] = await Promise.all([
    client.getTeamInfo(opponentTeamId),
    client.getRoster(opponentTeamId),
    client
      .getTeamStats(opponentTeamId, currentSeason, "averages")
      .catch(() => null),
    client.getSchedule(opponentTeamId, currentSeason).catch(() => emptySchedule),
  ]);
  const recentMatches = selectRecentMatches(schedule.matches, opponentTeamId);
  const recentBoxScoreBatch = await hydrateCompletedBoxScoresForMatches({
    client,
    env,
    matches: recentMatches,
    teamId: opponentTeamId,
    userId,
  });

  return {
    competitionProfile: null,
    forecastSample: null,
    hydratedBoxScores: recentBoxScoreBatch.boxScores,
    teamInfo,
    roster,
    schedule: null,
    teamStats,
    nextMatch: selectNextMatch(schedule.matches, opponentTeamId),
    recentMatches,
    recentBoxScores: recentBoxScoreBatch.boxScores,
  };
}

async function fetchOpponentWorkspace(
  env: GraphqlEnv,
  userId: string,
  client: BBXmlApiClient,
  opponentTeamId: string,
  currentWorkspace: BBApiCurrentWorkspace,
  options: {
    competitionKeys: string[] | null;
    selectedSeason: number | null;
  },
): Promise<OpponentWorkspace> {
  const seasonsResponse = await client.getSeasons().catch(() => ({
    seasons: [{ finish: null, id: currentWorkspace.schedule.season ?? null, start: null }],
    version: "1",
  }));
  const availableSeasons = seasonsResponse.seasons
    .map((season) => season.id)
    .filter((seasonId): seasonId is number => Number.isInteger(seasonId))
    .sort((left, right) => right - left);
  const latestSeason =
    availableSeasons[0] ?? currentWorkspace.schedule.season ?? null;
  const selectedSeason =
    options.selectedSeason !== null &&
    availableSeasons.includes(options.selectedSeason)
      ? options.selectedSeason
      : latestSeason;
  const forecastSeasons = [latestSeason, availableSeasons[1] ?? null, selectedSeason]
    .filter((season): season is number => Number.isInteger(season));
  const scheduleResults = await Promise.all(
    Array.from(new Set(forecastSeasons)).map(async (season) => {
      try {
        const schedule = await client.getSchedule(opponentTeamId, season);
        return { schedule, season };
      } catch {
        return null;
      }
    }),
  );
  const scheduleBySeason = new Map<number, BBApiSchedule>(
    scheduleResults
      .filter(
        (result): result is { schedule: BBApiSchedule; season: number } =>
          result !== null,
      )
      .map((result) => [result.season, result.schedule]),
  );
  const referenceSeason = latestSeason ?? selectedSeason;
  const referenceSchedule = referenceSeason
    ? (scheduleBySeason.get(referenceSeason) ?? null)
    : null;

  const [teamInfo, roster, teamStats] = await Promise.all([
    client.getTeamInfo(opponentTeamId),
    client.getRoster(opponentTeamId),
    client
      .getTeamStats(
        opponentTeamId,
        latestSeason ?? currentWorkspace.schedule.season ?? undefined,
        "averages",
      )
      .catch(() => null),
  ]);
  const hydratedSeasons = await Promise.all(
    Array.from(scheduleBySeason.entries()).map(async ([season, schedule]) => ({
      boxScoreBatch: await hydrateCompletedBoxScoresForMatches({
        client,
        env,
        matches: schedule.matches,
        teamId: opponentTeamId,
        userId,
      }),
      matches: schedule.matches,
      season,
    })),
  );
  const competitionProfile = buildOpponentCompetitionProfile({
    availableSeasons,
    competitionKeys: options.competitionKeys,
    seasons: hydratedSeasons.map((season) => ({
      boxScores: season.boxScoreBatch.boxScores,
      matches: season.matches,
      season: season.season,
    })),
    selectedSeason,
    teamId: opponentTeamId,
  });
  const hydratedBoxScoreMap = new Map<string, BBApiBoxScore>();
  for (const season of hydratedSeasons) {
    for (const boxScore of season.boxScoreBatch.boxScores) {
      if (boxScore.matchId) {
        hydratedBoxScoreMap.set(boxScore.matchId, boxScore);
      }
    }
  }
  const recentMatches = referenceSchedule
    ? selectRecentMatches(referenceSchedule.matches, opponentTeamId)
    : [];
  const recentBoxScores = recentMatches
    .map((match) => (match.id ? (hydratedBoxScoreMap.get(match.id) ?? null) : null))
    .filter((boxScore): boxScore is BBApiBoxScore => boxScore !== null);

  return {
    competitionProfile,
    forecastSample: competitionProfile.forecastSample,
    hydratedBoxScores: Array.from(hydratedBoxScoreMap.values()),
    teamInfo,
    roster,
    schedule: toScoutScheduleResult(competitionProfile),
    teamStats,
    nextMatch: referenceSchedule
      ? selectNextMatch(referenceSchedule.matches, opponentTeamId)
      : null,
    recentMatches,
    recentBoxScores,
  };
}

async function fetchOpponentSchedule(args: {
  client: BBXmlApiClient;
  competitionKeys: string[] | null;
  currentSeason: number | null;
  env: GraphqlEnv;
  opponentTeamId: string;
  selectedSeason: number | null;
  userId: string;
}): Promise<{
  competitionProfile: OpponentCompetitionProfile;
  meta: Omit<
    ScoutScheduleMeta,
    "currentSeason" | "requestedTeamId" | "resolvedTeamId" | "usedCachedBaseWorkspace"
  >;
  schedule: ScoutScheduleResult | null;
}> {
  const seasonsFetchStartedAt = Date.now();
  const seasonsResponse = await args.client.getSeasons().catch(() => ({
    seasons: [{ finish: null, id: args.currentSeason ?? null, start: null }],
    version: "1",
  }));
  const seasonsFetchMs = elapsedMs(seasonsFetchStartedAt);
  const availableSeasons = seasonsResponse.seasons
    .map((season) => season.id)
    .filter((seasonId): seasonId is number => Number.isInteger(seasonId))
    .sort((left, right) => right - left);
  const latestSeason = availableSeasons[0] ?? args.currentSeason ?? null;
  const selectedSeason =
    args.selectedSeason !== null &&
    availableSeasons.includes(args.selectedSeason)
      ? args.selectedSeason
      : latestSeason;
  logWorkspaceInfo("getScoutSchedule.seasons.ready", {
    availableSeasonCount: availableSeasons.length,
    currentSeason: args.currentSeason,
    opponentTeamId: args.opponentTeamId,
    selectedSeason,
    seasonsFetchMs,
    userId: args.userId,
  });
  const uniqueSeasonIds = Array.from(
    new Set(
      [latestSeason, availableSeasons[1] ?? null, selectedSeason].filter(
        (season): season is number => Number.isInteger(season),
      ),
    ),
  );
  const selectedSeasonScheduleFetchStartedAt = Date.now();
  const scheduleResults = await Promise.all(
    uniqueSeasonIds.map(async (season) => {
      try {
        const schedule = await args.client.getSchedule(args.opponentTeamId, season);
        return { schedule, season };
      } catch {
        return null;
      }
    }),
  );
  const selectedSeasonScheduleFetchMs = elapsedMs(
    selectedSeasonScheduleFetchStartedAt,
  );
  logWorkspaceInfo("getScoutSchedule.season_schedules.ready", {
    opponentTeamId: args.opponentTeamId,
    requestedSeasonCount: uniqueSeasonIds.length,
    selectedSeason,
    selectedSeasonMatchCount:
      scheduleResults.find(
        (result): result is { schedule: BBApiSchedule; season: number } =>
          result !== null && result.season === selectedSeason,
      )?.schedule.matches.length ?? 0,
    selectedSeasonScheduleFetchMs,
    userId: args.userId,
  });
  const selectedSeasonSchedule =
    scheduleResults.find(
      (result): result is { schedule: BBApiSchedule; season: number } =>
        result !== null && result.season === selectedSeason,
    )?.schedule ?? null;
  const boxscoreHydrationStartedAt = Date.now();
  const hydratedSeasons = await Promise.all(
    scheduleResults
      .filter(
        (result): result is { schedule: BBApiSchedule; season: number } =>
          result !== null,
      )
      .map(async ({ schedule, season }) => ({
        boxScoreBatch: await hydrateCompletedBoxScoresForMatches({
          client: args.client,
          env: args.env,
          matches: schedule.matches,
          teamId: args.opponentTeamId,
          userId: args.userId,
        }),
        matches: schedule.matches,
        season,
      })),
  );
  const boxscoreHydrationMs = elapsedMs(boxscoreHydrationStartedAt);
  const hydrationMetrics = hydratedSeasons.reduce<BoxscoreHydrationMetrics>(
    (current, season) => ({
      cacheHitBoxscoreCount:
        current.cacheHitBoxscoreCount +
        season.boxScoreBatch.metrics.cacheHitBoxscoreCount,
      completedMatchCount:
        current.completedMatchCount + season.boxScoreBatch.metrics.completedMatchCount,
      hydratedBoxscoreCount:
        current.hydratedBoxscoreCount +
        season.boxScoreBatch.metrics.hydratedBoxscoreCount,
      liveFetchedBoxscoreCount:
        current.liveFetchedBoxscoreCount +
        season.boxScoreBatch.metrics.liveFetchedBoxscoreCount,
      liveFetchRequestedCount:
        current.liveFetchRequestedCount +
        season.boxScoreBatch.metrics.liveFetchRequestedCount,
    }),
    {
      cacheHitBoxscoreCount: 0,
      completedMatchCount: 0,
      hydratedBoxscoreCount: 0,
      liveFetchedBoxscoreCount: 0,
      liveFetchRequestedCount: 0,
    },
  );
  logWorkspaceInfo("getScoutSchedule.boxscore_hydration.ready", {
    boxscoreHydrationMs,
    cacheHitBoxscoreCount: hydrationMetrics.cacheHitBoxscoreCount,
    hydratedBoxscoreCount: hydrationMetrics.hydratedBoxscoreCount,
    liveFetchedBoxscoreCount: hydrationMetrics.liveFetchedBoxscoreCount,
    liveFetchRequestedCount: hydrationMetrics.liveFetchRequestedCount,
    opponentTeamId: args.opponentTeamId,
    userId: args.userId,
  });

  const competitionProfileStartedAt = Date.now();
  const competitionProfile = buildOpponentCompetitionProfile({
    availableSeasons,
    competitionKeys: args.competitionKeys,
    seasons: hydratedSeasons.map((season) => ({
      boxScores: season.boxScoreBatch.boxScores,
      matches: season.matches,
      season: season.season,
    })),
    selectedSeason,
    teamId: args.opponentTeamId,
  });
  const competitionProfileMs = elapsedMs(competitionProfileStartedAt);
  logWorkspaceInfo("getScoutSchedule.competition_profile.ready", {
    competitionProfileMs,
    opponentTeamId: args.opponentTeamId,
    scheduleRowCount: competitionProfile.rows.length,
    selectedSeason,
    userId: args.userId,
  });
  const selectedSeasonCompletedMatchCount = selectedSeasonSchedule
    ? countCompletedScheduleMatches(
        selectedSeasonSchedule.matches,
        args.opponentTeamId,
      )
    : 0;

  return {
    competitionProfile,
    meta: {
      ...hydrationMetrics,
      competitionFilterCount: args.competitionKeys?.length ?? 0,
      scheduleRowCount: competitionProfile.rows.length,
      selectedSeason,
      selectedSeasonMatchCount: selectedSeasonSchedule?.matches.length ?? 0,
      stepMetrics: {
        baseWorkspaceMs: 0,
        boxscoreHydrationMs,
        competitionProfileMs,
        currentWorkspaceMs: 0,
        seasonsFetchMs,
        selectedSeasonScheduleFetchMs,
      },
      completedMatchCount: selectedSeasonCompletedMatchCount,
    },
    schedule: toScoutScheduleResult(competitionProfile),
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

async function hydrateCompletedBoxScoresForMatches(args: {
  client: BBXmlApiClient;
  env: GraphqlEnv;
  matches: BBApiScheduleMatch[];
  teamId: string | null;
  userId: string;
}): Promise<HydratedBoxscoreBatch> {
  const completedMatchIds = Array.from(
    new Set(
      args.matches
        .filter((match) => isCompletedScheduleMatch(match, args.teamId))
        .map((match) => match.id)
        .filter((matchId): matchId is string => Boolean(matchId)),
    ),
  );
  if (!completedMatchIds.length) {
    return {
      boxScores: [],
      metrics: {
        cacheHitBoxscoreCount: 0,
        completedMatchCount: 0,
        hydratedBoxscoreCount: 0,
        liveFetchedBoxscoreCount: 0,
        liveFetchRequestedCount: 0,
      },
    };
  }

  const boxScoresByMatchId = new Map<string, BBApiBoxScore>();
  const missingMatchIds: string[] = [];

  const normalizedCachedBoxscores = await Promise.all(
    completedMatchIds.map((matchId) =>
      getNormalizedCachedMatchBoxscore({
        env: args.env,
        getRecord: getMatchBoxscore,
        matchId,
        userId: args.userId,
      }),
    ),
  );

  completedMatchIds.forEach((matchId, index) => {
    const cachedBoxscore = normalizedCachedBoxscores[index];
    if (cachedBoxscore) {
      boxScoresByMatchId.set(matchId, cachedBoxscore.boxscore);
      return;
    }
    missingMatchIds.push(matchId);
  });

  const fetchedBoxScores = await fetchBoxScoresWithConcurrency(
    args.client,
    missingMatchIds,
    4,
  );
  for (const boxScore of fetchedBoxScores) {
    if (!boxScore.matchId) {
      continue;
    }
    const storedBoxscore = toStoredMatchBoxscore({
      boxscore: boxScore,
      source: "WORKSPACE_CACHE",
    });
    boxScoresByMatchId.set(boxScore.matchId, boxScore);
    if (!storedBoxscore) {
      continue;
    }
    await upsertMatchBoxscore(args.env, {
      boxscoreJson: storedBoxscore,
      fetchedAt: boxScore.retrievedAt ?? new Date().toISOString(),
      matchId: storedBoxscore.matchId,
      userId: args.userId,
    });
  }

  const boxScores = completedMatchIds
    .map((matchId) => boxScoresByMatchId.get(matchId) ?? null)
    .filter((boxScore): boxScore is BBApiBoxScore => boxScore !== null);

  return {
    boxScores,
    metrics: {
      cacheHitBoxscoreCount: completedMatchIds.length - missingMatchIds.length,
      completedMatchCount: completedMatchIds.length,
      hydratedBoxscoreCount: boxScores.length,
      liveFetchedBoxscoreCount: fetchedBoxScores.length,
      liveFetchRequestedCount: missingMatchIds.length,
    },
  };
}

async function fetchBoxScoresWithConcurrency(
  client: BBXmlApiClient,
  matchIds: string[],
  concurrency: number,
): Promise<BBApiBoxScore[]> {
  const results = await mapWithConcurrency(
    matchIds,
    concurrency,
    async (matchId) => {
      try {
        return await client.getBoxScore(matchId);
      } catch {
        return null;
      }
    },
  );

  return results.filter(
    (boxScore): boxScore is BBApiBoxScore => boxScore !== null,
  );
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  const resolvedConcurrency = Math.max(1, concurrency);

  for (let index = 0; index < items.length; index += resolvedConcurrency) {
    const chunk = items.slice(index, index + resolvedConcurrency);
    const chunkResults = await Promise.all(
      chunk.map((item, chunkIndex) => mapper(item, index + chunkIndex)),
    );
    results.push(...chunkResults);
  }

  return results;
}

function toScoutScheduleResult(
  profile: OpponentCompetitionProfile,
): ScoutScheduleResult {
  return {
    availableSeasons: profile.availableSeasons,
    competitionOptions: profile.competitionOptions.map((option) => ({
      count: option.count,
      key: option.key,
      label: option.label,
      selectedByDefault: option.selectedByDefault,
    })),
    rows: profile.rows,
    selectedCompetitionKeys: profile.selectedCompetitionKeys,
    selectedSeason: profile.selectedSeason,
    summary: profile.summary,
  };
}

function buildHomeWorkspace(
  workspace: BBApiCurrentWorkspace,
  nextMatch: BBApiScheduleMatch | null,
  nextScoutMatch: BBApiScheduleMatch | null,
  recentMatches: BBApiScheduleMatch[],
  currentBoxScores: BBApiBoxScore[],
  homeCoreMatches: BBApiScheduleMatch[],
  homeCoreBoxScores: BBApiBoxScore[],
  opponentWorkspace: OpponentWorkspace | null,
  connectionRecord: BbConnectionRecord,
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
    syncedAt: connectionRecord.lastSyncAt ?? null,
    connection: projectHomeWorkspaceConnection(
      connectionRecord,
      null,
      "home workspace connection",
    ),
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
    nextScoutMatch: nextScoutMatch
      ? buildHomeNextMatch(nextScoutMatch, workspace.teamInfo.teamId)
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
    league: buildLeagueIntel({
      currentSeason: workspace.currentSeason,
      standings: workspace.standings,
    }),
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

function buildTeamHubRosterFromOwnedRoster(
  players: readonly BBApiOwnedRosterPlayer[],
  existingRoster: readonly PlayerSummaryRecord[],
): PlayerSummaryRecord[] {
  const existingRosterByPlayerId = new Map(
    existingRoster
      .map((player) => [asString(player.playerId), player] as const)
      .filter((entry): entry is [string, PlayerSummaryRecord] => Boolean(entry[0])),
  );

  return players.map((player) => {
    const existing = existingRosterByPlayerId.get(player.id ?? "");
    return {
      playerId: player.id,
      fullName: player.fullName,
      bestPosition: player.bestPosition,
      nationalityName: player.nationality?.name ?? null,
      salary: player.salary,
      age: player.age,
      gameShape: formatRosterGameShapeLabel(player.skills.gameShape),
      dmi: player.dmi,
      injuryWeeks: player.injuryWeeks,
      projectedStarterCount: asNumber(existing?.projectedStarterCount),
      ppg: asNumber(existing?.ppg),
      recentAvgMinutes: asNumber(existing?.recentAvgMinutes),
      recentStartCount: asNumber(existing?.recentStartCount),
    };
  });
}

function patchWorkspaceCacheTeamHubRoster(
  cache: WorkspaceCachePayload,
  roster: PlayerSummaryRecord[],
): WorkspaceCachePayload {
  return buildWorkspaceCachePayload({
    home: cache.home,
    teamHub: {
      ...cache.teamHub,
      roster,
    },
    scout: cache.scout,
    leagueIntel: cache.leagueIntel,
    playerLab: cache.playerLab,
    arena: cache.arena,
  });
}

function patchWorkspaceCacheLeagueIntel(
  cache: WorkspaceCachePayload,
  leagueIntel: LeagueIntelWorkspaceResult,
): WorkspaceCachePayload {
  return buildWorkspaceCachePayload({
    home: cache.home,
    teamHub: cache.teamHub,
    scout: cache.scout,
    leagueIntel,
    playerLab: cache.playerLab,
    arena: cache.arena,
  });
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
      schedule: null,
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
    schedule: opponentWorkspace.schedule ?? null,
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

function buildUnavailableLeagueIntel(args: {
  league: NamedReference | null;
  message?: string | null;
  season: number | null;
}): LeagueIntelWorkspaceResult {
  return {
    comparisons: null,
    freshnessMessage: args.message ?? LIVE_LEAGUE_DATA_UNAVAILABLE_MESSAGE,
    freshnessStatus: "UNAVAILABLE",
    league: args.league,
    season: args.season,
    standings: [],
  };
}

function buildLeagueIntel(args: {
  currentSeason: number | null | undefined;
  standings: BBApiStandings | null;
}): LeagueIntelWorkspaceResult {
  const currentSeason = asFiniteInteger(args.currentSeason) ?? null;
  if (!args.standings) {
    return buildUnavailableLeagueIntel({
      league: null,
      season: currentSeason,
    });
  }

  const projectedLeague = projectNamedReference(args.standings.league);
  if (
    currentSeason !== null &&
    args.standings.season !== null &&
    args.standings.season !== currentSeason
  ) {
    return buildUnavailableLeagueIntel({
      league: projectedLeague,
      message: LIVE_LEAGUE_SEASON_MISMATCH_MESSAGE,
      season: currentSeason,
    });
  }

  return {
    comparisons: null,
    freshnessMessage: null,
    freshnessStatus: "FRESH",
    league: projectedLeague,
    season: args.standings.season ?? currentSeason,
    standings: args.standings.conferences.map((conference) => ({
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

async function fetchLeagueComparisonTeamSnapshots(
  client: BBXmlApiClient,
  standings: LeagueIntelWorkspaceResult["standings"],
): Promise<LeagueComparisonTeamSnapshot[]> {
  let standingsIndex = 0;
  const teams = standings.flatMap((conference) =>
    conference.teams.map((team) => ({
      conferenceIndex: conference.index,
      losses: team.losses ?? null,
      standingsIndex: standingsIndex++,
      teamId: team.teamId ?? null,
      teamName: team.teamName ?? null,
      wins: team.wins ?? null,
    })),
  );

  return mapWithConcurrency(teams, 4, async (team) => {
    if (!team.teamId) {
      return {
        arena: null,
        conferenceIndex: team.conferenceIndex,
        incomplete: true,
        losses: team.losses,
        rosterPlayers: null,
        standingsIndex: team.standingsIndex,
        teamId: team.teamId,
        teamName: team.teamName,
        teamStats: null,
        wins: team.wins,
      } satisfies LeagueComparisonTeamSnapshot;
    }

    const [teamStatsResult, rosterResult, arenaResult] = await Promise.allSettled([
      client.getTeamStats(team.teamId, undefined, "averages"),
      client.getRoster(team.teamId),
      client.getArena(team.teamId),
    ]);

    return {
      arena: arenaResult.status === "fulfilled" ? arenaResult.value : null,
      conferenceIndex: team.conferenceIndex,
      incomplete:
        teamStatsResult.status === "rejected" ||
        rosterResult.status === "rejected" ||
        arenaResult.status === "rejected",
      losses: team.losses,
      rosterPlayers:
        rosterResult.status === "fulfilled" ? rosterResult.value.players : null,
      standingsIndex: team.standingsIndex,
      teamId: team.teamId,
      teamName: team.teamName,
      teamStats:
        teamStatsResult.status === "fulfilled" ? teamStatsResult.value : null,
      wins: team.wins,
    } satisfies LeagueComparisonTeamSnapshot;
  });
}

function shouldRefreshLeagueComparisons(args: {
  comparisons: LeagueIntelWorkspaceResult["comparisons"] | null;
  force: boolean;
  lastSyncAt: string | null;
}): boolean {
  if (args.force || !args.comparisons) {
    return true;
  }

  if (!args.comparisons.builtAt) {
    return true;
  }

  const builtAtMs = Date.parse(args.comparisons.builtAt);
  if (Number.isNaN(builtAtMs)) {
    return true;
  }

  if (
    args.lastSyncAt &&
    Date.parse(args.lastSyncAt) > builtAtMs
  ) {
    return true;
  }

  return false;
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
      interviewPersonalitySource: null,
      interviewPersonalityType: null,
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

function resolveInterviewPersonalityState(args: {
  existingRecord?: Pick<
    TrackedPlayerRecord,
    "interviewPersonalitySource" | "interviewPersonalityType"
  > | null;
  playerId?: string | null;
  playerName: string;
  teamName?: string | null;
}): {
  source: InterviewPersonalitySource;
  type: InterviewPersonalityType;
} {
  const storedType = args.existingRecord?.interviewPersonalityType ?? null;
  const storedSource = args.existingRecord?.interviewPersonalitySource ?? null;
  if (
    isInterviewPersonalityType(storedType) &&
    isInterviewPersonalitySource(storedSource)
  ) {
    return {
      source: storedSource,
      type: storedType,
    };
  }

  return {
    source: "auto",
    type: resolveDeterministicInterviewPersonality(
      buildInterviewPersonalitySeed({
        playerId: args.playerId,
        playerName: args.playerName,
        teamName: args.teamName,
      }),
    ),
  };
}

function applyInterviewPersonalityToPlayerSummary(
  player: PlayerSummaryRecord,
  personality: {
    source: InterviewPersonalitySource;
    type: InterviewPersonalityType;
  },
): PlayerSummaryRecord {
  return {
    ...player,
    interviewPersonalitySource: personality.source,
    interviewPersonalityType: personality.type,
  };
}

async function withPlayerLabInterviewPersonalities(args: {
  env: GraphqlEnv;
  userId: string;
  workspace: WorkspaceBundle;
}): Promise<WorkspaceBundle> {
  const players = await mapWithConcurrency(
    args.workspace.playerLab.players,
    PLAYER_LAB_PERSONALITY_LOAD_CONCURRENCY,
    async (player) => {
      const playerId = asString(player.playerId);
      const trackedPlayer = playerId
        ? await getTrackedPlayerRecord(args.env, args.userId, playerId)
        : null;
      const personality = resolveInterviewPersonalityState({
        existingRecord: trackedPlayer,
        playerId,
        playerName: asString(player.fullName) ?? "Unknown player",
        teamName: trackedPlayer?.teamName ?? args.workspace.home.team.teamName,
      });

      if (
        trackedPlayer &&
        (!isInterviewPersonalityType(trackedPlayer.interviewPersonalityType) ||
          !isInterviewPersonalitySource(
            trackedPlayer.interviewPersonalitySource,
          ))
      ) {
        await upsertTrackedPlayer(args.env, {
          ...trackedPlayer,
          interviewPersonalitySource: personality.source,
          interviewPersonalityType: personality.type,
        });
      }

      return applyInterviewPersonalityToPlayerSummary(player, personality);
    },
  );

  return {
    ...args.workspace,
    playerLab: {
      ...args.workspace.playerLab,
      players,
    },
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
  existingRecord: Pick<
    TrackedPlayerRecord,
    "interviewPersonalitySource" | "interviewPersonalityType"
  > | null = null,
): TrackedPlayerRecord {
  if (!player.id || !teamId) {
    throw new Error("Tracked player records require both a player id and team id.");
  }

  const profileJson = projectStoredOwnedRosterPlayer(player);
  const interviewPersonality = resolveInterviewPersonalityState({
    existingRecord,
    playerId: player.id,
    playerName: player.fullName,
    teamName,
  });

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
    interviewPersonalityType: interviewPersonality.type,
    interviewPersonalitySource: interviewPersonality.source,
    profileJson,
    fetchedAt,
  };
}

function projectStoredOwnedRosterPlayer(
  player: BBApiOwnedRosterPlayer,
): StoredOwnedRosterPlayer {
  return {
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    fullName: player.fullName,
    salary: player.salary,
    bestPosition: player.bestPosition,
    age: player.age,
    height: player.height,
    dmi: player.dmi,
    injuryWeeks: player.injuryWeeks,
    nationality: {
      id: player.nationality?.id ?? "unknown",
      name: player.nationality?.name ?? "Unknown",
    },
    skills: {
      block: player.skills.block,
      driving: player.skills.driving,
      experience: player.skills.experience,
      freeThrow: player.skills.freeThrow,
      gameShape: player.skills.gameShape,
      handling: player.skills.handling,
      insideDef: player.skills.insideDef,
      insideShot: player.skills.insideShot,
      jumpShot: player.skills.jumpShot,
      outsideDef: player.skills.outsideDef,
      passing: player.skills.passing,
      potential: player.skills.potential,
      range: player.skills.range,
      rebound: player.skills.rebound,
      stamina: player.skills.stamina,
    },
  } satisfies StoredOwnedRosterPlayer;
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

function selectNextScoutMatch(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
  nowIso: string = new Date().toISOString(),
): BBApiScheduleMatch | null {
  return (
    [...matches]
      .filter((match) => isClubMatchForTeam(match, teamId))
      .filter(
        (match) =>
          deriveTeamScore(match, teamId) === null ||
          deriveOpponentScore(match, teamId) === null,
      )
      .filter((match) => Boolean(match.startTime) && String(match.startTime) > nowIso)
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

function isCompletedScheduleMatch(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean {
  return (
    isClubMatchForTeam(match, teamId) &&
    deriveTeamScore(match, teamId) !== null &&
    deriveOpponentScore(match, teamId) !== null
  );
}

function countCompletedScheduleMatches(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
): number {
  return matches.filter((match) => isCompletedScheduleMatch(match, teamId)).length;
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
      const started = asBoolean(toRecord(player.details)?.isStarter) ?? false;
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

function projectTeamInfo(
  teamInfo: BBApiTeamInfo,
): TeamInfoSummary & StoredTeamInfo {
  const projected = {
    teamId: teamInfo.teamId,
    teamName: teamInfo.teamName,
    shortName: teamInfo.shortName,
    ownerName: teamInfo.ownerName,
    isBot: teamInfo.isBot,
    league: projectNamedReference(teamInfo.league),
    country: projectNamedReference(teamInfo.country),
    rival: projectNamedReference(teamInfo.rival),
  } satisfies TeamInfoSummary & StoredTeamInfo;

  return projected;
}

function projectNamedReference(
  reference: BBApiNamedReference | null,
): NamedReference | null {
  if (!reference) {
    return null;
  }

  return {
    id: reference.id ?? null,
    name: reference.name ?? null,
  } satisfies NamedReference;
}

function projectPlayerSummary(
  player: PlayerSummaryRecord,
): PlayerSummaryRecord {
  return {
    playerId: asString(player.playerId),
    fullName: asString(player.fullName) ?? "Unknown player",
    bestPosition: asString(player.bestPosition),
    interviewPersonalitySource: asString(player.interviewPersonalitySource),
    interviewPersonalityType: asString(player.interviewPersonalityType),
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
      current.recentStartCount +=
        asBoolean(toRecord(player.details)?.isStarter) ? 1 : 0;
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
  for (const minutes of Object.values(toRecord(player.minutesByPosition) ?? {})) {
    if (typeof minutes === "number" && Number.isFinite(minutes)) {
      total += minutes;
    }
  }
  return total;
}

function calculateRecentActivityScore(player: BBApiBoxScorePlayer): number {
  const performanceStats = player.performanceStats ?? {};
  const pts = asNumber(performanceStats.pts) ?? 0;
  const reb = asNumber(performanceStats.reb) ?? 0;
  const ast = asNumber(performanceStats.ast) ?? 0;
  const stl = asNumber(performanceStats.stl) ?? 0;
  const blk = asNumber(performanceStats.blk) ?? 0;
  const turnovers = asNumber(performanceStats.to) ?? 0;

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

function readStoredSharedPlayerCardPayload(
  payload: unknown,
): SharedPlayerCardPayload | null {
  return readSharedPlayerCardPayload(payload);
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

function asFiniteInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
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

function readCachedWorkspace(
  connection: BbConnectionRecord,
): WorkspaceBundle | null {
  const cache = readWorkspaceCachePayload(connection.workspaceCacheJson);
  if (!cache) {
    return null;
  }
  const { home, teamHub, scout, leagueIntel, playerLab, arena } = cache;

  const syncedAt = connection.lastSyncAt ?? null;

  return {
    connectionRecord: connection,
    home: rehydrateHomeWorkspace(home, connection, syncedAt),
    teamHub: rehydrateTeamHubWorkspace(teamHub, syncedAt),
    scout: rehydrateScoutWorkspace(scout, syncedAt),
    leagueIntel: rehydrateLeagueIntelWorkspace(leagueIntel),
    playerLab: rehydratePlayerLabWorkspace(playerLab, syncedAt),
    arena: rehydrateArenaWorkspace(arena, syncedAt),
  };
}

function rehydrateHomeWorkspace(
  home: CachedHomeWorkspace,
  connectionRecord: BbConnectionRecord,
  syncedAt: string | null,
): HomeWorkspaceResult {
  return {
    syncedAt: asString(home.syncedAt) ?? syncedAt,
    connection: projectHomeWorkspaceConnection(
      connectionRecord,
      home.connection,
      "cached home workspace connection",
    ),
    team: home.team,
    nextMatch: home.nextMatch ?? null,
    nextScoutMatch: home.nextScoutMatch ?? null,
    nextOpponent: home.nextOpponent ?? null,
    recentMatches: home.recentMatches,
    league: rehydrateLeagueIntelWorkspace(home.league),
  } satisfies HomeWorkspaceResult;
}

function projectHomeWorkspaceConnection(
  connectionRecord: BbConnectionRecord,
  cachedConnection: CachedHomeWorkspace["connection"] | null,
  label: string,
): ConnectionResultShape {
  return projectEmbeddedConnectionResult(
    {
      accessKeyLast4:
        connectionRecord.accessKeyLast4 ?? cachedConnection?.accessKeyLast4 ?? null,
      bbLoginName: connectionRecord.bbLoginName || cachedConnection?.bbLoginName || "",
      connectedAt:
        connectionRecord.connectedAt ?? cachedConnection?.connectedAt ?? null,
      countryId: connectionRecord.countryId ?? cachedConnection?.countryId ?? null,
      countryName:
        connectionRecord.countryName ?? cachedConnection?.countryName ?? null,
      lastSyncAt:
        connectionRecord.lastSyncAt ?? cachedConnection?.lastSyncAt ?? null,
      lastSyncError:
        connectionRecord.lastSyncError ?? cachedConnection?.lastSyncError ?? null,
      lastValidatedAt:
        connectionRecord.lastValidatedAt ??
        cachedConnection?.lastValidatedAt ??
        null,
      leagueId: connectionRecord.leagueId ?? cachedConnection?.leagueId ?? null,
      leagueName:
        connectionRecord.leagueName ?? cachedConnection?.leagueName ?? null,
      leagueTimeZone:
        connectionRecord.leagueTimeZone ??
        cachedConnection?.leagueTimeZone ??
        null,
      profileJson:
        connectionRecord.profileJson ?? cachedConnection?.profileJson ?? null,
      status: connectionRecord.status ?? cachedConnection?.status ?? "UNSET",
      teamId: connectionRecord.teamId ?? cachedConnection?.teamId ?? null,
      teamName: connectionRecord.teamName ?? cachedConnection?.teamName ?? null,
    },
    label,
  );
}

function rehydrateTeamHubWorkspace(
  teamHub: CachedTeamHubWorkspace,
  syncedAt: string | null,
): TeamHubWorkspaceResult {
  return {
    syncedAt: asString(teamHub.syncedAt) ?? syncedAt,
    team: teamHub.team,
    roster: teamHub.roster,
  } satisfies TeamHubWorkspaceResult;
}

function rehydrateScoutWorkspace(
  scout: CachedScoutWorkspace,
  syncedAt: string | null,
): ScoutWorkspaceResult {
  return {
    syncedAt: asString(scout.syncedAt) ?? syncedAt,
    teamId: scout.teamId ?? null,
    availableOpponents: scout.availableOpponents,
    recentMatchups: scout.recentMatchups,
    schedule: scout.schedule ?? null,
    summary: scout.summary ?? null,
    requestedTeamId: scout.requestedTeamId ?? null,
    message: scout.message ?? null,
  } satisfies ScoutWorkspaceResult;
}

function rehydrateLeagueIntelWorkspace(
  leagueIntel: CachedLeagueIntelWorkspace,
): LeagueIntelWorkspaceResult {
  const season =
    asFiniteInteger(leagueIntel.season) ??
    asFiniteInteger(leagueIntel.comparisons?.season) ??
    null;
  const freshnessStatus: LeagueIntelFreshnessStatus =
    leagueIntel.freshnessStatus === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : leagueIntel.standings.length
        ? "FRESH"
        : "UNAVAILABLE";

  return {
    comparisons: leagueIntel.comparisons ?? null,
    freshnessMessage:
      freshnessStatus === "UNAVAILABLE"
        ? asString(leagueIntel.freshnessMessage) ??
          LIVE_LEAGUE_DATA_UNAVAILABLE_MESSAGE
        : null,
    freshnessStatus,
    league: leagueIntel.league ?? null,
    season,
    standings: leagueIntel.standings,
  } satisfies LeagueIntelWorkspaceResult;
}

function rehydratePlayerLabWorkspace(
  playerLab: CachedPlayerLabWorkspace,
  syncedAt: string | null,
): PlayerLabWorkspaceResult {
  return {
    syncedAt: asString(playerLab.syncedAt) ?? syncedAt,
    players: playerLab.players,
  } satisfies PlayerLabWorkspaceResult;
}

function rehydrateArenaWorkspace(
  arena: CachedArenaWorkspace,
  syncedAt: string | null,
): ArenaWorkspaceResult {
  return {
    syncedAt: asString(arena.syncedAt) ?? syncedAt,
    nextHomeMatch: arena.nextHomeMatch ?? null,
    arena: arena.arena,
    economy: arena.economy,
    recentHomeGames: arena.recentHomeGames,
    recommendation: arena.recommendation,
    diagnostics: arena.diagnostics,
  } satisfies ArenaWorkspaceResult;
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

function buildWorkspaceCacheMeta(
  workspace: WorkspaceBundle,
): Pick<
  WorkspaceRefreshMeta,
  | "cacheAgeMs"
  | "cacheKind"
  | "cachedAt"
  | "matchId"
  | "nextOpponentTeamId"
  | "opponentTeamName"
  | "reason"
> {
  const cachedAt =
    workspace.home.syncedAt ??
    workspace.teamHub.syncedAt ??
    workspace.scout.syncedAt ??
    workspace.playerLab.syncedAt ??
    workspace.connectionRecord.lastSyncAt ??
    null;

  return {
    cacheAgeMs: computeCacheAgeMs(cachedAt),
    cacheKind: "workspace_bundle",
    cachedAt,
    matchId: workspace.home.nextMatch?.matchId ?? null,
    nextOpponentTeamId: workspace.home.nextMatch?.opponentTeamId ?? null,
    opponentTeamName: workspace.home.nextMatch?.opponentTeamName ?? null,
    reason: "force=false and cached workspace exists",
  };
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

function computeCacheAgeMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, Date.now() - parsed);
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
