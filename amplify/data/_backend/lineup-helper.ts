import {
  DEFENSE_OPTIONS,
  LOCATION_OPTIONS,
  OFFENSE_OPTIONS,
  buildRawPlayerSkills,
  evaluateLineup,
  evaluateRoster,
  normalizeContext,
  type CoachParrotContext,
  type CoachParrotEvaluation,
  type LineupAssignment,
  type Position,
  type RawPlayerSkills,
} from "../../../lib/coach-parrot";
import { listCanonicalPlayerSkillSnapshots } from "./canonical-player-snapshots";
import { getBbConnection, getMatchBoxscore } from "./repository";

type GraphqlEnv = Record<string, string | undefined>;

type Identity = {
  sub?: string;
  claims?: Record<string, unknown>;
};

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
  snapshotWeekKey: string | null;
  snapshotCapturedAt: string | null;
  available: boolean;
  snapshotWarning: string | null;
  skills: Record<string, number>;
};

export const __testing = {
  buildLineupHelperWorkspacePayload,
  buildLineupHelperEvaluationPayload,
};

export async function getLineupHelperWorkspace(args: {
  env: GraphqlEnv;
  identity: unknown;
}): Promise<Record<string, unknown>> {
  const userId = resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const connection = await getBbConnection(args.env, userId);
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
    roster.map((player) => buildHelperRosterPlayer(args.env, player)),
  );
  const defaultContext = await resolveDefaultContext(
    args.env,
    userId,
    asString(connection.teamId),
    toRecord(cachedWorkspace.home),
  );

  return buildLineupHelperWorkspacePayload({
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
}): Promise<Record<string, unknown>> {
  const rosterPlayers = parseHelperRoster(args.roster);
  const assignments = parseAssignments(args.assignments);
  const context = normalizeContext(toContextRecord(args.context));

  return buildLineupHelperEvaluationPayload({
    roster: rosterPlayers,
    assignments,
    context,
  });
}

export function buildLineupHelperWorkspacePayload(input: {
  generatedAt: string;
  syncedAt: string | null;
  roster: HelperRosterPlayer[];
  defaultContext: CoachParrotContext;
}): Record<string, unknown> {
  const availableRoster = input.roster.filter((player) => player.available);
  const evaluation = availableRoster.length
    ? evaluateRoster({
        roster: {
          players: availableRoster.map(toRawPlayerSkills),
        },
        context: input.defaultContext,
      })
    : null;

  return {
    generatedAt: input.generatedAt,
    syncedAt: input.syncedAt,
    roster: input.roster,
    defaultContext: input.defaultContext,
    defaultAssignments: evaluation?.chosenLineup ?? [],
    evaluation: evaluation ? serializeEvaluation(evaluation) : null,
    snapshotWarnings: input.roster
      .filter((player) => player.snapshotWarning)
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
}): Record<string, unknown> {
  const availableRoster = input.roster.filter((player) => player.available);
  const evaluation = evaluateLineup({
    roster: {
      players: availableRoster.map(toRawPlayerSkills),
    },
    lineup: input.assignments,
    context: input.context,
  });

  return serializeEvaluation(evaluation);
}

async function buildHelperRosterPlayer(
  env: GraphqlEnv,
  player: Record<string, unknown>,
): Promise<HelperRosterPlayer> {
  const playerId = asString(player.playerId);
  const fullName = asString(player.fullName) ?? "Unknown player";
  const snapshot = playerId
    ? ((await listCanonicalPlayerSkillSnapshots(env, playerId, 1))[0] ?? null)
    : null;
  const profile = toRecord(toRecord(snapshot?.payload)?.profile);
  const skills = toRecord(profile?.skills);

  if (!playerId || !snapshot || !skills) {
    return {
      playerId: playerId ?? fullName.toLowerCase().replace(/\s+/g, "-"),
      fullName,
      bestPosition: asString(player.bestPosition),
      salary: asNumber(player.salary),
      age: asNumber(player.age),
      gameShape: asString(player.gameShape),
      snapshotWeekKey: asString(snapshot?.weekKey),
      snapshotCapturedAt: asString(snapshot?.capturedAt),
      available: false,
      snapshotWarning:
        "No canonical skill snapshot is available for this player.",
      skills: {},
    };
  }

  const normalizedSkills = buildRawPlayerSkills({
    playerId,
    name: fullName,
    age: player.age ?? profile?.age,
    salary: player.salary ?? snapshot.salary,
    skills: {
      ...skills,
      gameShape: snapshot.gameShape ?? skills.gameShape,
    },
  });

  return {
    playerId,
    fullName,
    bestPosition:
      asString(player.bestPosition) ?? asString(snapshot.bestPosition),
    salary: asNumber(player.salary) ?? asNumber(snapshot.salary),
    age: asNumber(player.age) ?? asNumber(profile?.age),
    gameShape: asString(player.gameShape) ?? asString(snapshot.gameShape),
    snapshotWeekKey: asString(snapshot.weekKey),
    snapshotCapturedAt: asString(snapshot.capturedAt),
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
  teamId: string | null,
  home: Record<string, unknown> | null,
): Promise<CoachParrotContext> {
  const recentMatches = toRecordArray(home?.recentMatches);
  for (const match of recentMatches) {
    const matchId = asString(match.matchId);
    if (!matchId) {
      continue;
    }
    const boxscore = await getMatchBoxscore(env, userId, matchId);
    if (!boxscore) {
      continue;
    }

    const boxscorePayload = toRecord(boxscore.boxscoreJson);
    const homeTeam = toRecord(boxscorePayload?.homeTeam);
    const defaultLocation =
      teamId && asString(homeTeam?.id) === teamId
        ? "Home Court"
        : "Away or Neutral";

    return normalizeContext({
      offense: asString(boxscore.offStrategy) ?? "Base Offense",
      defense: asString(boxscore.defStrategy) ?? "Man to man",
      enthusiasm: 5,
      homeCourt: defaultLocation,
    });
  }

  return normalizeContext({
    offense: "Base Offense",
    defense: "Man to man",
    enthusiasm: 5,
    homeCourt: "Away or Neutral",
  });
}

function serializeEvaluation(
  evaluation: CoachParrotEvaluation,
): Record<string, unknown> {
  return {
    context: evaluation.context,
    normalizedLineup: evaluation.chosenLineup,
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

function toPositionOutput(
  value: Record<Position, number>,
): Record<string, number> {
  return {
    pg: value.PG,
    sg: value.SG,
    sf: value.SF,
    pf: value.PF,
    c: value.C,
  };
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
    snapshotWeekKey: asString(player.snapshotWeekKey),
    snapshotCapturedAt: asString(player.snapshotCapturedAt),
    available: Boolean(player.available),
    snapshotWarning: asString(player.snapshotWarning),
    skills: toNumberRecord(player.skills),
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
  };
}

function readCachedWorkspace(
  connection: Record<string, unknown> | null,
): CachedWorkspaceBundle | null {
  const cache = toRecord(connection?.workspaceCacheJson);
  if (!cache) {
    return null;
  }

  const home = toRecord(cache.home);
  const teamHub = toRecord(cache.teamHub);
  const scout = toRecord(cache.scout);
  const leagueIntel = toRecord(cache.leagueIntel);
  const playerLab = toRecord(cache.playerLab);

  if (!home || !teamHub || !scout || !leagueIntel || !playerLab) {
    return null;
  }

  return {
    connection: connection ?? {},
    home,
    teamHub,
    scout,
    leagueIntel,
    playerLab,
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

function toNumberRecord(value: unknown): Record<string, number> {
  const source = toRecord(value);
  if (!source) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(source)
      .map(([key, rawValue]) => [key, asNumber(rawValue)])
      .filter((entry): entry is [string, number] => entry[1] !== null),
  );
}

function asPosition(value: unknown): Position | null {
  const text = asString(value)?.toUpperCase();
  return text && ["PG", "SG", "SF", "PF", "C"].includes(text)
    ? (text as Position)
    : null;
}
