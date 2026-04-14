import {
  DEFENSE_OPTIONS,
  LOCATION_OPTIONS,
  OFFENSE_OPTIONS,
  evaluateLineup,
  evaluateRoster,
  normalizeDefensiveSwitch,
  normalizeLineupAssignments,
  normalizeContext,
  validateDefensiveSwitch,
  validateOptimizedLineup,
  type CoachParrotContext,
  type CoachParrotEvaluation,
  type LineupAssignment,
  type LineupOptimizerAlgorithm,
  type Position,
  type RawPlayerSkills,
} from "../../../lib/coach-parrot";
import {
  BBXmlApiClient,
  ownedRosterPlayerToRawPlayerSkills,
} from "../../../lib/bbapi";
import type { Schema } from "../resource";
import {
  LineupHelperAlgorithm,
  PositionCode,
} from "../schema-enums";
import {
  getOwnerTrackedPlayerProfile,
  listWorkspacePlayerHistory,
  type WorkspacePlayerHistoryRecord,
} from "./player-snapshot-access";
import { assertMaintenanceInactive } from "./maintenance";
import { getOrRepairRecentCachedMatchBoxscore } from "./cached-boxscore";
import { resolveBbAccessKey } from "./credentials";
import { selectBoxscorePerspective } from "./neutral-boxscore";
import {
  getBbConnection,
  readMatchBoxscoreCacheRecord,
  upsertMatchBoxscore,
} from "./repository";
import { readWorkspaceCachePayload } from "./workspace-cache";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type LineupHelperWorkspaceResult = ResolverResult<"getLineupHelperWorkspace">;
type LineupHelperEvaluationResult = ResolverResult<"evaluateLineupHelper">;
type LineupHelperOptimizeResult = ResolverResult<"optimizeLineupHelper">;
type HelperRosterSkills = LineupHelperWorkspaceResult["roster"][number]["skills"];
type LineupHelperPositionOutput =
  LineupHelperEvaluationResult["playerPositionOutputs"][number]["output"];

type CachedWorkspaceBundle = {
  connection: Record<string, unknown>;
  home: Record<string, unknown>;
  teamHub: Record<string, unknown>;
  scout: Record<string, unknown>;
  leagueIntel: Record<string, unknown>;
  playerLab: Record<string, unknown>;
};

type HelperRosterPlayer = {
  playerId: string;
  fullName: string;
  bestPosition: string | null;
  salary: number | null;
  age: number | null;
  gameShape: string | null;
  dmi: number | null;
  injuryWeeks: number | null;
  snapshotWeekKey: string | null;
  snapshotCapturedAt: string | null;
  available: boolean;
  snapshotWarning: string | null;
  skills: HelperRosterSkills;
};

type GetBbConnectionDependency = typeof getBbConnection;
type GetOwnerTrackedPlayerProfileDependency =
  typeof getOwnerTrackedPlayerProfile;
type ListWorkspacePlayerHistoryDependency = typeof listWorkspacePlayerHistory;
type ReadMatchBoxscoreCacheRecordDependency =
  typeof readMatchBoxscoreCacheRecord;
type ResolveBbAccessKeyDependency = typeof resolveBbAccessKey;
type UpsertMatchBoxscoreDependency = typeof upsertMatchBoxscore;

type LineupHelperDependencies = {
  createBbClient: (options: {
    securityCode: string;
    username: string;
  }) => Pick<BBXmlApiClient, "getBoxScore">;
  getBbConnection: GetBbConnectionDependency;
  getOwnerTrackedPlayerProfile: GetOwnerTrackedPlayerProfileDependency;
  listWorkspacePlayerHistory: ListWorkspacePlayerHistoryDependency;
  readMatchBoxscoreCacheRecord: ReadMatchBoxscoreCacheRecordDependency;
  resolveBbAccessKey: ResolveBbAccessKeyDependency;
  upsertMatchBoxscore: UpsertMatchBoxscoreDependency;
};

const EMPTY_HELPER_SKILLS: HelperRosterSkills = {
  js: 0,
  jr: 0,
  od: 0,
  ha: 0,
  dr: 0,
  pa: 0,
  is: 0,
  id: 0,
  rb: 0,
  sb: 0,
  st: 0,
  ft: 0,
  ex: 0,
  gs: 0,
};

const defaultLineupHelperDependencies: LineupHelperDependencies = {
  createBbClient: (options) => new BBXmlApiClient(options),
  getBbConnection,
  getOwnerTrackedPlayerProfile,
  listWorkspacePlayerHistory,
  readMatchBoxscoreCacheRecord,
  resolveBbAccessKey,
  upsertMatchBoxscore,
};

export const __testing = {
  buildHelperRosterPlayer,
  buildLineupHelperWorkspacePayload,
  buildLineupHelperEvaluationPayload,
  buildOptimizedLineupHelperEvaluationPayload,
  selectLatestHistory,
};

export async function getLineupHelperWorkspace(args: {
  env: GraphqlEnv;
  identity: unknown;
},
dependencies: LineupHelperDependencies = defaultLineupHelperDependencies,
): Promise<LineupHelperWorkspaceResult> {
  await assertMaintenanceInactive();

  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const connection = await dependencies.getBbConnection(args.env, userId);
  const cachedWorkspace = readCachedWorkspace(connection);
  if (!connection || !cachedWorkspace) {
    throw new Error(
      "No cached workspace is available. Refresh your workspace first.",
    );
  }

  const roster = toRecordArray(toRecord(cachedWorkspace.teamHub)?.roster);
  if (!roster.length) {
    throw new Error("No cached roster is available for the lineup helper.");
  }

  const helperRoster = await Promise.all(
    roster.map((player) =>
      buildHelperRosterPlayer(args.env, userId, player, dependencies),
    ),
  );
  const defaultContext = await resolveDefaultContext(
    args.env,
    userId,
    connection,
    asString(connection.teamId),
    toRecord(cachedWorkspace.home),
    dependencies,
  );

  return await buildLineupHelperWorkspacePayload({
    generatedAt: new Date().toISOString(),
    syncedAt: asString(connection.lastSyncAt),
    roster: helperRoster,
    defaultContext,
  });
}

export async function evaluateLineupHelper(args: {
  roster: unknown;
  assignments: unknown;
  context: unknown;
}): Promise<LineupHelperEvaluationResult> {
  await assertMaintenanceInactive();

  const rosterPlayers = parseHelperRoster(args.roster);
  const assignments = parseAssignments(args.assignments);
  const context = normalizeContext(toContextRecord(args.context));

  return buildLineupHelperEvaluationPayload({
    roster: rosterPlayers,
    assignments,
    context,
  });
}

export async function optimizeLineupHelper(args: {
  algorithm?: unknown;
  roster: unknown;
  context: unknown;
}): Promise<LineupHelperOptimizeResult> {
  await assertMaintenanceInactive();

  const rosterPlayers = parseHelperRoster(args.roster);
  const context = normalizeContext(toContextRecord(args.context));
  const algorithm = asLineupHelperAlgorithm(args.algorithm);

  return await buildOptimizedLineupHelperEvaluationPayload({
    algorithm,
    roster: rosterPlayers,
    context,
  });
}

export async function buildLineupHelperWorkspacePayload(input: {
  generatedAt: string;
  syncedAt: string | null;
  roster: HelperRosterPlayer[];
  defaultContext: CoachParrotContext;
}): Promise<LineupHelperWorkspaceResult> {
  const availableRoster = input.roster.filter((player) => player.available);
  const evaluation = availableRoster.length
    ? await buildOptimizedEvaluation({
        context: input.defaultContext,
        roster: availableRoster,
      })
    : null;

  return {
    generatedAt: input.generatedAt,
    syncedAt: input.syncedAt,
    roster: input.roster,
    defaultContext: serializeContext(input.defaultContext),
    defaultAssignments: evaluation
      ? serializeAssignments(evaluation.chosenLineup)
      : [],
    evaluation: evaluation ? serializeEvaluation(evaluation) : null,
    snapshotWarnings: input.roster
      .filter(
        (
          player,
        ): player is HelperRosterPlayer & {
          snapshotWarning: string;
        } => Boolean(player.snapshotWarning),
      )
      .map((player) => ({
        playerId: player.playerId,
        fullName: player.fullName,
        warning: player.snapshotWarning,
      })),
    availableOffenses: [...OFFENSE_OPTIONS],
    availableDefenses: [...DEFENSE_OPTIONS],
    availableLocations: [...LOCATION_OPTIONS],
  };
}

export function buildLineupHelperEvaluationPayload(input: {
  roster: HelperRosterPlayer[];
  assignments: LineupAssignment[];
  context: CoachParrotContext;
}): LineupHelperEvaluationResult {
  const availableRoster = input.roster.filter((player) => player.available);
  const normalizedAssignments = normalizeLineupAssignments(input.assignments);
  const defensiveSwitchErrors = validateDefensiveSwitch(input.context.defensiveSwitch);
  if (defensiveSwitchErrors.length) {
    throw new Error(defensiveSwitchErrors.join(" "));
  }
  const legality = validateOptimizedLineup({
    lineup: normalizedAssignments,
    players: availableRoster.map((player) => ({
      playerId: player.playerId,
      name: player.fullName,
    })),
  });
  if (legality.errors.length) {
    throw new Error(legality.errors.join(" "));
  }

  const evaluation = evaluateLineup({
    roster: {
      players: availableRoster.map(toRawPlayerSkills),
    },
    lineup: normalizedAssignments,
    context: input.context,
  });

  return serializeEvaluation(evaluation);
}

export async function buildOptimizedLineupHelperEvaluationPayload(input: {
  algorithm?: LineupOptimizerAlgorithm;
  roster: HelperRosterPlayer[];
  context: CoachParrotContext;
}): Promise<LineupHelperOptimizeResult> {
  const availableRoster = input.roster.filter((player) => player.available);
  const defensiveSwitchErrors = validateDefensiveSwitch(input.context.defensiveSwitch);
  if (defensiveSwitchErrors.length) {
    throw new Error(defensiveSwitchErrors.join(" "));
  }
  const evaluation = await buildOptimizedEvaluation({
    algorithm: input.algorithm,
    context: input.context,
    roster: availableRoster,
  });

  if (!evaluation) {
    throw new Error(
      "No legal lineup could be built with 6-minute increments and 42-minute player caps.",
    );
  }

  return serializeEvaluation(evaluation);
}

async function buildHelperRosterPlayer(
  env: GraphqlEnv,
  userId: string,
  player: Record<string, unknown>,
  dependencies: LineupHelperDependencies = defaultLineupHelperDependencies,
): Promise<HelperRosterPlayer> {
  const playerId = asString(player.playerId);
  const fullName = asString(player.fullName) ?? "Unknown player";
  const [history, profile] = playerId
    ? await Promise.all([
        dependencies.listWorkspacePlayerHistory(env, userId, playerId),
        dependencies.getOwnerTrackedPlayerProfile(env, userId, playerId),
      ])
    : [[], null];
  const snapshot = selectLatestHistory(history);

  if (!playerId || !profile) {
    return {
      playerId: playerId ?? fullName.toLowerCase().replace(/\s+/g, "-"),
      fullName,
      bestPosition: asString(player.bestPosition),
      salary: asNumber(player.salary),
      age: asNumber(player.age),
      gameShape: asString(player.gameShape),
      dmi: asNumber(player.dmi),
      injuryWeeks: asNumber(player.injuryWeeks),
      snapshotWeekKey: asString(snapshot?.weekKey),
      snapshotCapturedAt: asString(snapshot?.capturedAt),
      available: false,
      snapshotWarning:
        "No canonical skill snapshot is available for this player.",
      skills: EMPTY_HELPER_SKILLS,
    };
  }

  const normalizedSkills = ownedRosterPlayerToRawPlayerSkills(profile);

  return {
    playerId,
    fullName,
    bestPosition:
      asString(player.bestPosition) ??
      asString(snapshot?.bestPosition) ??
      asString(profile.bestPosition),
    salary:
      asNumber(player.salary) ??
      asNumber(snapshot?.salary) ??
      asNumber(profile.salary),
    age: asNumber(player.age) ?? asNumber(profile.age),
    gameShape: asString(player.gameShape) ?? asString(snapshot?.gameShape),
    dmi: asNumber(player.dmi) ?? asNumber(snapshot?.dmi) ?? asNumber(profile.dmi),
    injuryWeeks:
      asNumber(player.injuryWeeks) ??
      asNumber(snapshot?.injuryWeeks) ??
      asNumber(profile.injuryWeeks),
    snapshotWeekKey: asString(snapshot?.weekKey),
    snapshotCapturedAt: asString(snapshot?.capturedAt),
    available: true,
    snapshotWarning: null,
    skills: {
      js: normalizedSkills.js,
      jr: normalizedSkills.jr,
      od: normalizedSkills.od,
      ha: normalizedSkills.ha,
      dr: normalizedSkills.dr,
      pa: normalizedSkills.pa,
      is: normalizedSkills.is,
      id: normalizedSkills.id,
      rb: normalizedSkills.rb,
      sb: normalizedSkills.sb,
      st: normalizedSkills.st,
      ft: normalizedSkills.ft,
      ex: normalizedSkills.ex,
      gs: normalizedSkills.gs,
    },
  };
}

async function resolveDefaultContext(
  env: GraphqlEnv,
  userId: string,
  connection: Record<string, unknown> | null,
  teamId: string | null,
  home: Record<string, unknown> | null,
  dependencies: LineupHelperDependencies = defaultLineupHelperDependencies,
): Promise<CoachParrotContext> {
  const recentMatches = toRecordArray(home?.recentMatches);
  for (const match of recentMatches) {
    const matchId = asString(match.matchId);
    if (!matchId) {
      continue;
    }
    const cachedBoxscore = await getOrRepairRecentCachedMatchBoxscore({
      createBbClient: dependencies.createBbClient,
      env,
      getBbConnection: async () =>
        connection
          ? {
              bbLoginName: asString(connection.bbLoginName),
            }
          : null,
      matchId,
      readRecord: dependencies.readMatchBoxscoreCacheRecord,
      resolveBbAccessKey: dependencies.resolveBbAccessKey,
      upsertMatchBoxscore: dependencies.upsertMatchBoxscore,
      userId,
    });
    if (!cachedBoxscore) {
      continue;
    }

    const perspective = selectBoxscorePerspective(cachedBoxscore.boxscore, teamId);
    if (!perspective.team) {
      continue;
    }

    return normalizeContext({
      offense: asString(perspective.team.offStrategy) ?? "Base Offense",
      defense: asString(perspective.team.defStrategy) ?? "Man to man",
      enthusiasm: 5,
      homeCourt:
        perspective.teamLocation === "HOME" ? "Home Court" : "Away or Neutral",
    });
  }

  return normalizeContext({
    offense: "Base Offense",
    defense: "Man to man",
    enthusiasm: 5,
    homeCourt: "Away or Neutral",
  });
}

function selectLatestHistory(
  history: readonly WorkspacePlayerHistoryRecord[],
): WorkspacePlayerHistoryRecord | null {
  return (
    [...history].sort((left, right) =>
      String(left.capturedAt ?? left.weekKey ?? "").localeCompare(
        String(right.capturedAt ?? right.weekKey ?? ""),
      ),
    )[history.length - 1] ?? null
  );
}

function serializeEvaluation(
  evaluation: CoachParrotEvaluation,
): LineupHelperEvaluationResult {
  return {
    context: serializeContext(evaluation.context),
    normalizedLineup: serializeAssignments(evaluation.chosenLineup),
    rawRatings: evaluation.rawRatings,
    roundedRatings: evaluation.roundedRatings,
    ratingLabels: evaluation.ratingLabels,
    outputBandLabels: evaluation.outputBandLabels,
    warnings: evaluation.warnings,
    rankings: {
      pg: evaluation.rankings.PG,
      sg: evaluation.rankings.SG,
      sf: evaluation.rankings.SF,
      pf: evaluation.rankings.PF,
      c: evaluation.rankings.C,
    },
    playerPositionOutputs: Object.entries(evaluation.playerPositionOutputs).map(
      ([playerId, output]) => ({
        playerId,
        output: {
          pg: output.PG,
          sg: output.SG,
          sf: output.SF,
          pf: output.PF,
          c: output.C,
        },
      }),
    ),
    perPositionContributions: {
      outsideScoring: toPositionOutput(
        evaluation.perPositionContributions.outsideScoring,
      ),
      insideScoring: toPositionOutput(
        evaluation.perPositionContributions.insideScoring,
      ),
      outsideDefense: toPositionOutput(
        evaluation.perPositionContributions.outsideDefense,
      ),
      insideDefense: toPositionOutput(
        evaluation.perPositionContributions.insideDefense,
      ),
      rebounding: toPositionOutput(evaluation.perPositionContributions.rebounding),
      offensiveFlow: toPositionOutput(
        evaluation.perPositionContributions.offensiveFlow,
      ),
    },
    totalOutput: evaluation.totalOutput,
  };
}

async function buildOptimizedEvaluation(args: {
  algorithm?: LineupOptimizerAlgorithm;
  context: CoachParrotContext;
  roster: HelperRosterPlayer[];
}): Promise<CoachParrotEvaluation | null> {
  if (!args.roster.length) {
    return null;
  }

  try {
    return await evaluateRoster({
      algorithm: args.algorithm,
      roster: {
        players: args.roster.map(toRawPlayerSkills),
      },
      context: args.context,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unable to build a legal lineup")) {
      return null;
    }
    throw error;
  }
}

function toPositionOutput(
  value: Record<Position, number>,
): LineupHelperPositionOutput {
  return {
    pg: value.PG,
    sg: value.SG,
    sf: value.SF,
    pf: value.PF,
    c: value.C,
  };
}

function serializeContext(
  context: CoachParrotContext,
): LineupHelperEvaluationResult["context"] {
  return {
    offense: context.offense,
    defense: context.defense,
    enthusiasm: context.enthusiasm,
    homeCourt: context.homeCourt,
    defensiveSwitch: {
      pg: toPositionCode(context.defensiveSwitch.PG),
      sg: toPositionCode(context.defensiveSwitch.SG),
      sf: toPositionCode(context.defensiveSwitch.SF),
      pf: toPositionCode(context.defensiveSwitch.PF),
      c: toPositionCode(context.defensiveSwitch.C),
    },
  };
}

function serializeAssignments(
  assignments: readonly LineupAssignment[],
): LineupHelperWorkspaceResult["defaultAssignments"] {
  return assignments.map((assignment) => ({
    playerId: assignment.playerId,
    position: toPositionCode(assignment.position),
    minutes: assignment.minutes,
  }));
}

function toRawPlayerSkills(player: HelperRosterPlayer): RawPlayerSkills {
  return {
    playerId: player.playerId,
    name: player.fullName,
    js: asNumber(player.skills.js) ?? 0,
    jr: asNumber(player.skills.jr) ?? 0,
    od: asNumber(player.skills.od) ?? 0,
    ha: asNumber(player.skills.ha) ?? 0,
    dr: asNumber(player.skills.dr) ?? 0,
    pa: asNumber(player.skills.pa) ?? 0,
    is: asNumber(player.skills.is) ?? 0,
    id: asNumber(player.skills.id) ?? 0,
    rb: asNumber(player.skills.rb) ?? 0,
    sb: asNumber(player.skills.sb) ?? 0,
    st: asNumber(player.skills.st) ?? 0,
    ft: asNumber(player.skills.ft) ?? 0,
    ex: asNumber(player.skills.ex) ?? 0,
    gs: asNumber(player.skills.gs) ?? 0,
    age: player.age,
    salary: player.salary,
    metadata: {
      bestPosition: player.bestPosition,
      snapshotWeekKey: player.snapshotWeekKey,
      snapshotCapturedAt: player.snapshotCapturedAt,
    },
  };
}

function parseHelperRoster(value: unknown): HelperRosterPlayer[] {
  return toRecordArray(value).map((player) => ({
    playerId: asString(player.playerId) ?? "missing-player-id",
    fullName: asString(player.fullName) ?? "Unknown player",
    bestPosition: asString(player.bestPosition),
    salary: asNumber(player.salary),
    age: asNumber(player.age),
    gameShape: asString(player.gameShape),
    dmi: asNumber(player.dmi),
    injuryWeeks: asNumber(player.injuryWeeks),
    snapshotWeekKey: asString(player.snapshotWeekKey),
    snapshotCapturedAt: asString(player.snapshotCapturedAt),
    available: Boolean(player.available),
    snapshotWarning: asString(player.snapshotWarning),
    skills: toHelperRosterSkills(player.skills),
  }));
}

function parseAssignments(value: unknown): LineupAssignment[] {
  return toRecordArray(value)
    .map((assignment) => ({
      position: asPosition(assignment.position),
      playerId: asString(assignment.playerId) ?? "",
      minutes: asNumber(assignment.minutes) ?? 0,
    }))
    .filter(
      (assignment): assignment is LineupAssignment =>
        assignment.position !== null && Boolean(assignment.playerId),
    );
}

function toContextRecord(value: unknown): Partial<CoachParrotContext> {
  const source = toRecord(value);
  return {
    offense: asString(source?.offense) ?? undefined,
    defense: asString(source?.defense) ?? undefined,
    enthusiasm: asNumber(source?.enthusiasm) ?? undefined,
    homeCourt:
      asString(source?.homeCourt) ?? asString(source?.home_court) ?? undefined,
    defensiveSwitch: toDefensiveSwitchRecord(source?.defensiveSwitch),
  };
}

function toDefensiveSwitchRecord(
  value: unknown,
): CoachParrotContext["defensiveSwitch"] | undefined {
  const source = toRecord(value);
  if (!source) {
    return undefined;
  }
  return normalizeDefensiveSwitch(source);
}

function readCachedWorkspace(
  connection: Record<string, unknown> | null,
): CachedWorkspaceBundle | null {
  const cache = readWorkspaceCachePayload(connection?.workspaceCacheJson);
  if (!cache) {
    return null;
  }

  return {
    connection: connection ?? {},
    home: cache.home,
    teamHub: cache.teamHub,
    scout: cache.scout,
    leagueIntel: cache.leagueIntel,
    playerLab: cache.playerLab,
  };
}

function resolveUserId(identity: unknown): string | null {
  const typed = identity as Identity | null;
  if (typed?.sub) {
    return typed.sub;
  }
  const claims = typed?.claims;
  if (claims && typeof claims.sub === "string") {
    return claims.sub;
  }
  return null;
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
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = asString(value);
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
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

function toHelperRosterSkills(value: unknown): HelperRosterSkills {
  const source = toRecord(value);

  return {
    js: asNumber(source?.js) ?? 0,
    jr: asNumber(source?.jr) ?? 0,
    od: asNumber(source?.od) ?? 0,
    ha: asNumber(source?.ha) ?? 0,
    dr: asNumber(source?.dr) ?? 0,
    pa: asNumber(source?.pa) ?? 0,
    is: asNumber(source?.is) ?? 0,
    id: asNumber(source?.id) ?? 0,
    rb: asNumber(source?.rb) ?? 0,
    sb: asNumber(source?.sb) ?? 0,
    st: asNumber(source?.st) ?? 0,
    ft: asNumber(source?.ft) ?? 0,
    ex: asNumber(source?.ex) ?? 0,
    gs: asNumber(source?.gs) ?? 0,
  };
}

function asPosition(value: unknown): Position | null {
  const text = asString(value)?.toUpperCase();
  return text && ["PG", "SG", "SF", "PF", "C"].includes(text)
    ? (text as Position)
    : null;
}

function asLineupHelperAlgorithm(value: unknown): LineupOptimizerAlgorithm | undefined {
  const text = asString(value);
  if (text === LineupHelperAlgorithm.LEGACY_HEURISTIC) {
    return "LEGACY_HEURISTIC";
  }
  if (text === LineupHelperAlgorithm.EXACT) {
    return "EXACT";
  }
  return undefined;
}

function toPositionCode(position: Position): PositionCode {
  switch (position) {
    case "PG":
      return PositionCode.PG;
    case "SG":
      return PositionCode.SG;
    case "SF":
      return PositionCode.SF;
    case "PF":
      return PositionCode.PF;
    case "C":
      return PositionCode.C;
  }
}
