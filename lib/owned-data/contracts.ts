import { z } from "zod";

import { parseLegacyJsonField } from "../json-parsing";

export const WORKSPACE_CACHE_VERSION = 5;

const CONNECTION_STATUS_VALUES = [
  "UNSET",
  "CONNECTED",
  "INVALID",
  "ERROR",
  "DISCONNECTED",
] as const;

const nullableStringSchema = z.string().nullable().optional();
const nullableNumberSchema = z.number().finite().nullable().optional();
const connectionStatusSchema = z.enum(CONNECTION_STATUS_VALUES);

function strictObject<TShape extends z.ZodRawShape>(shape: TShape) {
  return z.object(shape).strict();
}

function formatIssuePath(
  path: readonly (string | number)[],
  label: string,
): string {
  if (!path.length) {
    return label;
  }

  return path.reduce<string>((current, segment) => {
    if (typeof segment === "number") {
      return `${current}[${segment}]`;
    }
    return current ? `${current}.${segment}` : segment;
  }, "");
}

export function describeOwnedContractIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = formatIssuePath(issue.path, "value");

    if (issue.code === "unrecognized_keys") {
      return `${path} contains unsupported key(s): ${issue.keys.sort().join(", ")}`;
    }

    return `${path}: ${issue.message}`;
  });
}

function createOwnedContractError(label: string, error: z.ZodError): Error {
  return new Error(
    `${label} does not match the owned data contract: ${describeOwnedContractIssues(
      error,
    ).join("; ")}`,
  );
}

function assertOwnedContract<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  label: string,
): z.infer<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw createOwnedContractError(label, parsed.error);
  }

  return parsed.data;
}

const namedReferenceShape = {
  id: nullableStringSchema,
  name: nullableStringSchema,
} as const;

export const namedReferenceSchema = strictObject(namedReferenceShape);
export const nullableNamedReferenceSchema = namedReferenceSchema
  .nullable()
  .optional();

export const teamRecordSummarySchema = strictObject({
  wins: nullableNumberSchema,
  losses: nullableNumberSchema,
})
  .nullable()
  .optional();

export const injurySummarySchema = strictObject({
  playerId: nullableStringSchema,
  fullName: z.string(),
  injuryWeeks: nullableNumberSchema,
});

export const trendCountEntrySchema = strictObject({
  count: z.number().finite(),
  key: z.string(),
});

export const tendenciesSummarySchema = strictObject({
  defense: z.array(trendCountEntrySchema),
  offense: z.array(trendCountEntrySchema),
});

export const playerSummarySchema = strictObject({
  age: nullableNumberSchema,
  bestPosition: nullableStringSchema,
  dmi: nullableNumberSchema,
  fullName: z.string(),
  gameShape: nullableStringSchema,
  injuryWeeks: nullableNumberSchema,
  interviewPersonalitySource: nullableStringSchema,
  interviewPersonalityType: nullableStringSchema,
  nationalityName: nullableStringSchema,
  playerId: nullableStringSchema,
  ppg: nullableNumberSchema,
  projectedStarterCount: nullableNumberSchema,
  recentAvgMinutes: nullableNumberSchema,
  recentStartCount: nullableNumberSchema,
  salary: nullableNumberSchema,
});

export const matchSummarySchema = strictObject({
  effortDelta: nullableNumberSchema,
  hasBoxscore: z.boolean(),
  matchId: nullableStringSchema,
  opponentScore: nullableNumberSchema,
  opponentTeamName: nullableStringSchema,
  outcome: nullableStringSchema,
  startTime: nullableStringSchema,
  teamScore: nullableNumberSchema,
  type: nullableStringSchema,
});

export const scoutScheduleCompetitionOptionSchema = strictObject({
  count: z.number().finite(),
  key: z.string(),
  label: z.string(),
  selectedByDefault: z.boolean(),
});

export const scoutScheduleRowSchema = strictObject({
  competitionKey: z.string(),
  competitionLabel: z.string(),
  hasBoxscore: z.boolean(),
  isTvGame: z.boolean(),
  matchId: nullableStringSchema,
  opponentBbStatsTotal: nullableNumberSchema,
  opponentDefense: nullableStringSchema,
  opponentOffense: nullableStringSchema,
  opponentScore: nullableNumberSchema,
  opponentTeamId: nullableStringSchema,
  opponentTeamName: nullableStringSchema,
  outcome: nullableStringSchema,
  season: z.number().finite(),
  seriousness: nullableStringSchema,
  seriousnessReason: nullableStringSchema,
  seriousnessScore: nullableNumberSchema,
  stageLabel: nullableStringSchema,
  startTime: nullableStringSchema,
  teamBbStatsTotal: nullableNumberSchema,
  teamDefense: nullableStringSchema,
  teamOffense: nullableStringSchema,
  teamScore: nullableNumberSchema,
  type: nullableStringSchema,
  venue: nullableStringSchema,
});

export const scoutScheduleSummarySchema = strictObject({
  completedGames: z.number().finite(),
  missingBoxscores: z.number().finite(),
  seriousGames: z.number().finite(),
  totalGames: z.number().finite(),
  upcomingGames: z.number().finite(),
});

export const scoutScheduleSchema = strictObject({
  availableSeasons: z.array(z.number().finite()),
  competitionOptions: z.array(scoutScheduleCompetitionOptionSchema),
  rows: z.array(scoutScheduleRowSchema),
  selectedCompetitionKeys: z.array(z.string()),
  selectedSeason: nullableNumberSchema,
  summary: scoutScheduleSummarySchema,
})
  .nullable()
  .optional();

export const homeNextMatchSchema = strictObject({
  isHome: z.boolean(),
  matchId: nullableStringSchema,
  opponentTeamId: nullableStringSchema,
  opponentTeamName: nullableStringSchema,
  startTime: nullableStringSchema,
  type: nullableStringSchema,
})
  .nullable()
  .optional();

export const homeWorkspaceTeamSchema = strictObject({
  injuries: z.array(injurySummarySchema),
  record: teamRecordSummarySchema,
  shortName: nullableStringSchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
  topPlayers: z.array(playerSummarySchema),
});

export const homeWorkspaceOpponentSchema = strictObject({
  injuries: z.array(injurySummarySchema),
  record: teamRecordSummarySchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
  tendencies: tendenciesSummarySchema,
})
  .nullable()
  .optional();

export const leagueTeamStandingSchema = strictObject({
  losses: nullableNumberSchema,
  pointMargin: nullableNumberSchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
  wins: nullableNumberSchema,
});

export const leagueConferenceStandingSchema = strictObject({
  index: z.number().finite(),
  teams: z.array(leagueTeamStandingSchema),
});

export const leagueComparisonMetricTripletSchema = strictObject({
  team: nullableNumberSchema,
  opponent: nullableNumberSchema,
  diff: nullableNumberSchema,
})
  .nullable()
  .optional();

const leagueComparisonRowShape = {
  conferenceIndex: z.number().finite(),
  standingsIndex: z.number().finite(),
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
} as const;

export const leagueOffenseRowSchema = strictObject({
  ...leagueComparisonRowShape,
  assists: leagueComparisonMetricTripletSchema,
  effectiveFgPct: leagueComparisonMetricTripletSchema,
  fgPct: leagueComparisonMetricTripletSchema,
  ftPct: leagueComparisonMetricTripletSchema,
  gamesPlayed: nullableNumberSchema,
  offensiveRebounds: leagueComparisonMetricTripletSchema,
  points: leagueComparisonMetricTripletSchema,
  threePtPct: leagueComparisonMetricTripletSchema,
});

export const leagueDefenseRowSchema = strictObject({
  ...leagueComparisonRowShape,
  blocks: leagueComparisonMetricTripletSchema,
  fouls: leagueComparisonMetricTripletSchema,
  gamesPlayed: nullableNumberSchema,
  steals: leagueComparisonMetricTripletSchema,
  totalRebounds: leagueComparisonMetricTripletSchema,
  turnovers: leagueComparisonMetricTripletSchema,
});

export const leaguePayrollRowSchema = strictObject({
  ...leagueComparisonRowShape,
  averageSalary: nullableNumberSchema,
  payrollRanks6To10: nullableNumberSchema,
  playerCount: nullableNumberSchema,
  standardDeviation: nullableNumberSchema,
  top10Payroll: nullableNumberSchema,
  top5Payroll: nullableNumberSchema,
  top8Payroll: nullableNumberSchema,
  totalPayroll: nullableNumberSchema,
});

export const leagueArenaRowSchema = strictObject({
  ...leagueComparisonRowShape,
  bleachers: nullableNumberSchema,
  courtside: nullableNumberSchema,
  lowerTier: nullableNumberSchema,
  luxuryBoxes: nullableNumberSchema,
  totalCapacity: nullableNumberSchema,
});

export const leagueComparisonsSchema = strictObject({
  arena: z.array(leagueArenaRowSchema),
  builtAt: z.string(),
  defense: z.array(leagueDefenseRowSchema),
  incompleteTeamCount: z.number().finite(),
  offense: z.array(leagueOffenseRowSchema),
  payroll: z.array(leaguePayrollRowSchema),
  season: nullableNumberSchema,
})
  .nullable()
  .optional();

export const leagueIntelWorkspaceSchema = strictObject({
  comparisons: leagueComparisonsSchema,
  league: nullableNamedReferenceSchema,
  standings: z.array(leagueConferenceStandingSchema),
});

export const storedTeamInfoSchema = strictObject({
  country: nullableNamedReferenceSchema,
  isBot: z.boolean(),
  league: nullableNamedReferenceSchema,
  ownerName: nullableStringSchema,
  rival: nullableNamedReferenceSchema,
  shortName: nullableStringSchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
});

export const teamInfoSummarySchema = strictObject({
  country: nullableNamedReferenceSchema,
  isBot: z.boolean(),
  league: nullableNamedReferenceSchema,
  ownerName: nullableStringSchema,
  rival: nullableNamedReferenceSchema,
  shortName: nullableStringSchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
});

export const workspaceCacheConnectionSchema = strictObject({
  accessKeyLast4: nullableStringSchema,
  bbLoginName: z.string(),
  connectedAt: nullableStringSchema,
  countryId: nullableStringSchema,
  countryName: nullableStringSchema,
  lastSyncAt: nullableStringSchema,
  lastSyncError: nullableStringSchema,
  lastValidatedAt: nullableStringSchema,
  leagueId: nullableStringSchema,
  leagueName: nullableStringSchema,
  leagueTimeZone: nullableStringSchema,
  profileJson: storedTeamInfoSchema.nullable().optional(),
  status: connectionStatusSchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
});

export const cachedHomeWorkspaceSchema = strictObject({
  connection: workspaceCacheConnectionSchema,
  league: leagueIntelWorkspaceSchema,
  nextMatch: homeNextMatchSchema,
  nextOpponent: homeWorkspaceOpponentSchema,
  nextScoutMatch: homeNextMatchSchema,
  recentMatches: z.array(matchSummarySchema),
  syncedAt: nullableStringSchema,
  team: homeWorkspaceTeamSchema,
});

export const teamHubWorkspaceSchema = strictObject({
  roster: z.array(playerSummarySchema),
  syncedAt: nullableStringSchema,
  team: teamInfoSummarySchema,
});

export const opponentSummarySchema = strictObject({
  losses: nullableNumberSchema,
  pointMargin: nullableNumberSchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
  wins: nullableNumberSchema,
});

export const scoutMatchupPerspectiveSchema = strictObject({
  opponentTeamId: nullableStringSchema,
  ourTeamId: nullableStringSchema,
});

export const scoutWorkspaceSummarySchema = strictObject({
  matchupPerspective: scoutMatchupPerspectiveSchema,
  nextMatch: matchSummarySchema.nullable().optional(),
  recentGames: z.array(matchSummarySchema),
  record: teamRecordSummarySchema,
  roster: z.array(playerSummarySchema),
  tendencies: tendenciesSummarySchema,
  teamName: nullableStringSchema,
  topPlayers: z.array(playerSummarySchema),
})
  .nullable()
  .optional();

export const scoutWorkspaceSchema = strictObject({
  availableOpponents: z.array(opponentSummarySchema),
  message: nullableStringSchema,
  recentMatchups: z.array(matchSummarySchema),
  requestedTeamId: nullableStringSchema,
  schedule: scoutScheduleSchema,
  summary: scoutWorkspaceSummarySchema,
  syncedAt: nullableStringSchema,
  teamId: nullableStringSchema,
});

export const playerLabWorkspaceSchema = strictObject({
  players: z.array(playerSummarySchema),
  syncedAt: nullableStringSchema,
});

export const arenaSectionAttendanceSchema = strictObject({
  bleachers: nullableNumberSchema,
  courtside: nullableNumberSchema,
  lowerTier: nullableNumberSchema,
  luxury: nullableNumberSchema,
});

export const arenaSeatStateSchema = strictObject({
  capacity: nullableNumberSchema,
  maxPrice: z.number().finite(),
  minPrice: z.number().finite(),
  nextPrice: nullableNumberSchema,
  price: nullableNumberSchema,
  section: z.string(),
});

export const arenaExpansionSectionSchema = strictObject({
  capacityDelta: nullableNumberSchema,
  section: z.string(),
});

export const arenaExpansionSummarySchema = strictObject({
  daysLeft: nullableNumberSchema,
  sections: z.array(arenaExpansionSectionSchema),
})
  .nullable()
  .optional();

export const arenaEconomyTransactionSchema = strictObject({
  amount: nullableNumberSchema,
  date: nullableStringSchema,
  description: nullableStringSchema,
  kind: nullableStringSchema,
  rawAmount: nullableStringSchema,
  rawDate: nullableStringSchema,
  rawType: nullableStringSchema,
});

export const arenaEconomySummarySchema = strictObject({
  availableBalance: nullableNumberSchema,
  cash: nullableNumberSchema,
  transactions: z.array(arenaEconomyTransactionSchema),
});

export const arenaOverviewSchema = strictObject({
  expansion: arenaExpansionSummarySchema,
  name: nullableStringSchema,
  seats: z.array(arenaSeatStateSchema),
})
  .nullable()
  .optional();

export const arenaHomeGameSectionSampleSchema = strictObject({
  attendance: nullableNumberSchema,
  capacity: nullableNumberSchema,
  occupancyPct: nullableNumberSchema,
  price: nullableNumberSchema,
  realizedRevenue: nullableNumberSchema,
  section: z.string(),
  usedMatchedSnapshot: z.boolean(),
});

export const arenaHomeGameSampleSchema = strictObject({
  competitionKey: nullableStringSchema,
  competitionLabel: z.string(),
  estimatedRealizedGate: nullableNumberSchema,
  matchedSnapshotCapturedAt: nullableStringSchema,
  matchId: z.string(),
  opponentTeamId: nullableStringSchema,
  opponentTeamName: nullableStringSchema,
  sections: z.array(arenaHomeGameSectionSampleSchema),
  startTime: nullableStringSchema,
  type: nullableStringSchema,
});

export const arenaPriceRecommendationSectionSchema = strictObject({
  confidence: z.number().finite(),
  currentPrice: nullableNumberSchema,
  delta: nullableNumberSchema,
  projectedAttendance: nullableNumberSchema,
  projectedRevenue: nullableNumberSchema,
  reason: z.string(),
  recommendedPrice: nullableNumberSchema,
  section: z.string(),
  weightedOccupancyPct: nullableNumberSchema,
});

export const arenaPriceRecommendationSchema = strictObject({
  heuristicDisclaimer: z.string(),
  overallConfidence: z.number().finite(),
  projectedCurrentRevenue: nullableNumberSchema,
  projectedRecommendedRevenue: nullableNumberSchema,
  projectedRevenueDelta: nullableNumberSchema,
  sections: z.array(arenaPriceRecommendationSectionSchema),
})
  .nullable()
  .optional();

export const arenaWorkspaceDiagnosticsSchema = strictObject({
  comparableGameCount: z.number().finite(),
  lowConfidenceReasons: z.array(z.string()),
  matchedSnapshotCount: z.number().finite(),
});

export const arenaWorkspaceSchema = strictObject({
  arena: arenaOverviewSchema,
  diagnostics: arenaWorkspaceDiagnosticsSchema,
  economy: arenaEconomySummarySchema.nullable().optional(),
  nextHomeMatch: homeNextMatchSchema,
  recommendation: arenaPriceRecommendationSchema,
  recentHomeGames: z.array(arenaHomeGameSampleSchema),
  syncedAt: nullableStringSchema,
});

const storedWorkspaceCachePayloadSchema = strictObject({
  arena: arenaWorkspaceSchema.nullable().optional(),
  home: cachedHomeWorkspaceSchema,
  leagueIntel: leagueIntelWorkspaceSchema,
  playerLab: playerLabWorkspaceSchema,
  scout: scoutWorkspaceSchema,
  teamHub: teamHubWorkspaceSchema,
  version: z.number().finite(),
});

export const workspaceCachePayloadSchema = strictObject({
  arena: arenaWorkspaceSchema,
  home: cachedHomeWorkspaceSchema,
  leagueIntel: leagueIntelWorkspaceSchema,
  playerLab: playerLabWorkspaceSchema,
  scout: scoutWorkspaceSchema,
  teamHub: teamHubWorkspaceSchema,
  version: z.literal(WORKSPACE_CACHE_VERSION),
});

export const connectionResultSchema = strictObject({
  accessKeyLast4: nullableStringSchema,
  bbLoginName: z.string(),
  connectedAt: nullableStringSchema,
  countryId: nullableStringSchema,
  countryName: nullableStringSchema,
  lastSyncAt: nullableStringSchema,
  lastSyncError: nullableStringSchema,
  lastValidatedAt: nullableStringSchema,
  leagueId: nullableStringSchema,
  leagueName: nullableStringSchema,
  leagueTimeZone: nullableStringSchema,
  profileJson: storedTeamInfoSchema.nullable().optional(),
  status: connectionStatusSchema,
  teamId: nullableStringSchema,
  teamName: nullableStringSchema,
  workspaceCacheJson: z.lazy(() => workspaceCachePayloadSchema).nullable().optional(),
});

export const homeWorkspaceSchema = strictObject({
  connection: connectionResultSchema,
  league: leagueIntelWorkspaceSchema,
  nextMatch: homeNextMatchSchema,
  nextOpponent: homeWorkspaceOpponentSchema,
  nextScoutMatch: homeNextMatchSchema,
  recentMatches: z.array(matchSummarySchema),
  syncedAt: nullableStringSchema,
  team: homeWorkspaceTeamSchema,
});

export const storedRequiredNamedReferenceSchema = strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const storedOwnedRosterPlayerSkillsSchema = strictObject({
  block: z.number().finite(),
  driving: z.number().finite(),
  experience: z.number().finite(),
  freeThrow: z.number().finite(),
  gameShape: z.number().finite(),
  handling: z.number().finite(),
  insideDef: z.number().finite(),
  insideShot: z.number().finite(),
  jumpShot: z.number().finite(),
  outsideDef: z.number().finite(),
  passing: z.number().finite(),
  potential: z.number().finite(),
  range: z.number().finite(),
  rebound: z.number().finite(),
  stamina: z.number().finite(),
});

export const storedOwnedRosterPlayerSchema = strictObject({
  age: z.number().finite(),
  bestPosition: z.string().min(1),
  dmi: z.number().finite(),
  firstName: z.string().min(1),
  fullName: z.string().min(1),
  height: z.number().finite(),
  id: z.string().min(1),
  injuryWeeks: z.number().finite(),
  lastName: z.string().min(1),
  nationality: storedRequiredNamedReferenceSchema,
  salary: z.number().finite(),
  skills: storedOwnedRosterPlayerSkillsSchema,
});

export const sharedPlayerCardPayloadPlayerSchema = strictObject({
  bestPosition: nullableStringSchema,
  dmi: nullableNumberSchema,
  fullName: z.string(),
  gameShape: nullableStringSchema,
  injuryWeeks: nullableNumberSchema,
  nationalityName: nullableStringSchema,
  playerId: nullableStringSchema,
  salary: nullableNumberSchema,
});

export const sharedPlayerCardPayloadSchema = strictObject({
  player: sharedPlayerCardPayloadPlayerSchema,
});

export type ConnectionResultShape = z.infer<typeof connectionResultSchema>;
export type HomeWorkspaceShape = z.infer<typeof homeWorkspaceSchema>;
export type SharedPlayerCardPayloadShape = z.infer<
  typeof sharedPlayerCardPayloadSchema
>;
export type StoredOwnedRosterPlayerShape = z.infer<
  typeof storedOwnedRosterPlayerSchema
>;
export type StoredTeamInfoShape = z.infer<typeof storedTeamInfoSchema>;
export type WorkspaceCacheConnectionShape = z.infer<
  typeof workspaceCacheConnectionSchema
>;
export type WorkspaceCachePayloadShape = z.infer<
  typeof workspaceCachePayloadSchema
>;

export function assertConnectionResult(
  value: unknown,
  label: string,
): ConnectionResultShape {
  return assertOwnedContract(connectionResultSchema, value, label);
}

export function assertHomeWorkspace(
  value: unknown,
  label: string,
): HomeWorkspaceShape {
  return assertOwnedContract(homeWorkspaceSchema, value, label);
}

export function assertSharedPlayerCardPayload(
  value: unknown,
  label: string,
): SharedPlayerCardPayloadShape {
  return assertOwnedContract(sharedPlayerCardPayloadSchema, value, label);
}

export function readSharedPlayerCardPayload(
  value: unknown,
): SharedPlayerCardPayloadShape | null {
  const parsed = sharedPlayerCardPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function assertStoredOwnedRosterPlayer(
  value: unknown,
  label: string,
): StoredOwnedRosterPlayerShape {
  return assertOwnedContract(storedOwnedRosterPlayerSchema, value, label);
}

export function readStoredOwnedRosterPlayer(
  value: unknown,
): StoredOwnedRosterPlayerShape | null {
  const parsed = storedOwnedRosterPlayerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function assertStoredTeamInfo(
  value: unknown,
  label: string,
): StoredTeamInfoShape {
  return assertOwnedContract(storedTeamInfoSchema, value, label);
}

export function assertWorkspaceCacheConnection(
  value: unknown,
  label: string,
): WorkspaceCacheConnectionShape {
  return assertOwnedContract(workspaceCacheConnectionSchema, value, label);
}

export function readStoredTeamInfo(value: unknown): StoredTeamInfoShape | null {
  const parsed = storedTeamInfoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function assertWorkspaceCachePayload(
  value: unknown,
  label: string,
): WorkspaceCachePayloadShape {
  return assertOwnedContract(workspaceCachePayloadSchema, value, label);
}

export function readWorkspaceCachePayloadContract(
  value: unknown,
): WorkspaceCachePayloadShape | null {
  const stored = parseLegacyJsonField(storedWorkspaceCachePayloadSchema, value);
  if (!stored) {
    return null;
  }

  const parsed = workspaceCachePayloadSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
