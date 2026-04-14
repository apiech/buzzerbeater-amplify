import type {
  BBApiArena,
  BBApiCurrentWorkspace,
  BBApiEconomy,
  BBApiEconomyTransaction,
  BBApiBoxScore,
  BBApiScheduleMatch,
} from "../../../lib/bbapi";
import { classifyCompetition } from "./match-importance";
import type { ArenaPricingSnapshotRecord } from "./repository";
import type { Schema } from "../resource";

type ArenaWorkspaceResult = NonNullable<Schema["getArenaWorkspace"]["returnType"]>;
type ArenaSeatStateResult = NonNullable<
  NonNullable<ArenaWorkspaceResult["arena"]>["seats"]
>[number];
type ArenaExpansionSummaryResult = NonNullable<
  NonNullable<ArenaWorkspaceResult["arena"]>["expansion"]
>;
type ArenaEconomySummaryResult = NonNullable<ArenaWorkspaceResult["economy"]>;
type ArenaHomeGameSampleResult = ArenaWorkspaceResult["recentHomeGames"][number];
type ArenaHomeGameSectionSampleResult = ArenaHomeGameSampleResult["sections"][number];
type ArenaRecommendationResult = NonNullable<ArenaWorkspaceResult["recommendation"]>;
type ArenaRecommendationSectionResult = ArenaRecommendationResult["sections"][number];
type ArenaDiagnosticsResult = ArenaWorkspaceResult["diagnostics"];
type ArenaPricingSnapshotSeat = NonNullable<
  ArenaPricingSnapshotRecord["seats"]
>[number];

export const ARENA_SECTION_ORDER = [
  "bleachers",
  "lowerTier",
  "courtside",
  "luxury",
] as const;

export type ArenaSectionKey = (typeof ARENA_SECTION_ORDER)[number];

export const ARENA_PRICE_BOUNDS: Record<
  ArenaSectionKey,
  { max: number; min: number }
> = {
  bleachers: { min: 5, max: 20 },
  lowerTier: { min: 18, max: 70 },
  courtside: { min: 50, max: 200 },
  luxury: { min: 400, max: 1600 },
};

const ELASTICITY_BY_SECTION: Record<ArenaSectionKey, number> = {
  bleachers: 1.2,
  lowerTier: 1.0,
  courtside: 0.7,
  luxury: 0.4,
};

const MATCH_FAMILY_WEIGHTS = {
  otherCompetitive: 0.7,
  otherWhenTargetScrimmage: 0.5,
  scrimmage: 0.35,
  sameFamily: 1,
} as const;

const HEURISTIC_DISCLAIMER =
  "Heuristic estimate based on recent home attendance and ticket sensitivity, not a direct BB simulation.";
const SNAPSHOT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export function selectNextHomeMatch(
  matches: BBApiScheduleMatch[],
  teamId: string | null,
): BBApiScheduleMatch | null {
  return (
    [...matches]
      .filter((match) => isClubMatchForTeam(match, teamId))
      .filter((match) => isTeamHome(match, teamId))
      .filter(
        (match) =>
          deriveTeamScore(match, teamId) === null ||
          deriveOpponentScore(match, teamId) === null,
      )
      .sort(byStartTimeAscending)[0] ?? null
  );
}

export function buildArenaPricingSnapshotRecord(args: {
  capturedAt: string;
  nextHomeMatch: BBApiScheduleMatch | null;
  userId: string;
  workspace: BBApiCurrentWorkspace;
}): ArenaPricingSnapshotRecord {
  const economy = buildArenaEconomySummary(args.workspace.economy);

  return {
    userId: args.userId,
    capturedAt: args.capturedAt,
    nextHomeMatchId: args.nextHomeMatch?.id ?? null,
    nextHomeMatchStartTime: args.nextHomeMatch?.startTime ?? null,
    arenaName: args.workspace.arena.name ?? null,
    seats: buildArenaSeatStates(args.workspace.arena),
    expansion: buildArenaExpansionSummary(args.workspace.arena),
    cash: economy.cash,
    availableBalance: economy.availableBalance,
    transactions: economy.transactions,
  };
}

export function buildArenaWorkspace(args: {
  referenceBoxScores: BBApiBoxScore[];
  referenceMatches: BBApiScheduleMatch[];
  snapshots: ArenaPricingSnapshotRecord[];
  syncedAt: string | null;
  workspace: BBApiCurrentWorkspace;
}): ArenaWorkspaceResult {
  const nextHomeMatch = selectNextHomeMatch(
    args.workspace.schedule.matches,
    args.workspace.teamInfo.teamId,
  );
  const recentHomeGames = buildRecentHomeGameSamples({
    arena: args.workspace.arena,
    boxScores: args.referenceBoxScores,
    matches: args.referenceMatches,
    snapshots: args.snapshots,
    teamId: args.workspace.teamInfo.teamId,
  });
  const diagnostics = buildArenaDiagnostics({
    nextHomeMatch,
    recentHomeGames,
  });

  return {
    syncedAt: args.syncedAt,
    nextHomeMatch: nextHomeMatch
      ? {
          matchId: nextHomeMatch.id,
          startTime: nextHomeMatch.startTime,
          type: nextHomeMatch.type,
          opponentTeamId: deriveOpponentTeamId(nextHomeMatch, args.workspace.teamInfo.teamId),
          opponentTeamName: deriveOpponentTeamName(
            nextHomeMatch,
            args.workspace.teamInfo.teamId,
          ),
          isHome: true,
        }
      : null,
    arena: {
      name: args.workspace.arena.name,
      seats: buildArenaSeatStates(args.workspace.arena),
      expansion: buildArenaExpansionSummary(args.workspace.arena),
    },
    economy: buildArenaEconomySummary(args.workspace.economy),
    recentHomeGames,
    recommendation: buildArenaRecommendation({
      arena: args.workspace.arena,
      diagnostics,
      nextHomeMatch,
      recentHomeGames,
    }),
    diagnostics,
  };
}

function buildArenaSeatStates(arena: BBApiArena): ArenaSeatStateResult[] {
  return ARENA_SECTION_ORDER.map((section) => {
    const seat = arena.seats[section];
    const bounds = ARENA_PRICE_BOUNDS[section];
    return {
      section,
      capacity: asInteger(seat?.capacity),
      price: asInteger(seat?.price),
      nextPrice: asInteger(seat?.nextPrice),
      minPrice: bounds.min,
      maxPrice: bounds.max,
    };
  });
}

function buildArenaExpansionSummary(
  arena: BBApiArena,
): ArenaExpansionSummaryResult | null {
  if (!arena.expansion) {
    return null;
  }

  return {
    daysLeft: asInteger(arena.expansion.daysLeft),
    sections: ARENA_SECTION_ORDER.flatMap((section) => {
      const capacityDelta = asInteger(arena.expansion?.sections?.[section]);
      return capacityDelta === null
        ? []
        : [{ section, capacityDelta }];
    }),
  };
}

function buildArenaEconomySummary(
  economy: BBApiEconomy,
): ArenaEconomySummaryResult {
  return {
    cash: asInteger(economy.fields.cash),
    availableBalance: asInteger(economy.fields.availableBalance),
    transactions: [...economy.transactions]
      .map((transaction) => buildArenaTransaction(transaction))
      .sort((left, right) =>
        String(right.date ?? "").localeCompare(String(left.date ?? "")),
      ),
  };
}

function buildArenaTransaction(
  transaction: BBApiEconomyTransaction,
): ArenaEconomySummaryResult["transactions"][number] {
  const description =
    asString(transaction.fields.description) ??
    asString(transaction.fields.label) ??
    asString(transaction.kind) ??
    "Unknown transaction";

  return {
    kind: asString(transaction.kind),
    amount: asNumber(transaction.amount),
    date: asString(transaction.date),
    description,
    rawType: asString(transaction.attributes.type) ?? asString(transaction.kind),
    rawAmount:
      asString(transaction.attributes.amount) ??
      (transaction.amount === null || transaction.amount === undefined
        ? null
        : String(transaction.amount)),
    rawDate: asString(transaction.attributes.date) ?? asString(transaction.date),
  };
}

function buildRecentHomeGameSamples(args: {
  arena: BBApiArena;
  boxScores: BBApiBoxScore[];
  matches: BBApiScheduleMatch[];
  snapshots: ArenaPricingSnapshotRecord[];
  teamId: string | null;
}): ArenaHomeGameSampleResult[] {
  const boxScoreByMatchId = new Map(
    args.boxScores
      .filter((boxScore) => Boolean(boxScore.matchId))
      .map((boxScore) => [boxScore.matchId as string, boxScore]),
  );

  return [...args.matches]
    .filter((match) => isClubMatchForTeam(match, args.teamId))
    .filter((match) => isTeamHome(match, args.teamId))
    .filter(
      (match) =>
        deriveTeamScore(match, args.teamId) !== null &&
        deriveOpponentScore(match, args.teamId) !== null,
    )
    .sort(byStartTimeDescending)
    .slice(0, 6)
    .flatMap((match) => {
      if (!match.id) {
        return [];
      }

      const boxScore = boxScoreByMatchId.get(match.id);
      if (!boxScore) {
        return [];
      }

      const matchedSnapshot = matchArenaPricingSnapshot({
        match,
        snapshots: args.snapshots,
      });
      const currentSeatBySection = buildSeatMap(buildArenaSeatStates(args.arena));
      const snapshotSeatBySection = matchedSnapshot
        ? buildSnapshotSeatMap(matchedSnapshot.seats ?? [])
        : null;
      const sections = ARENA_SECTION_ORDER.map((section) =>
        buildHomeGameSectionSample({
          currentSeat: currentSeatBySection.get(section) ?? null,
          section,
          snapshotSeat: snapshotSeatBySection?.get(section) ?? null,
          boxScore,
        }),
      );

      const estimatedRealizedGate = matchedSnapshot
        ? sumNumberValues(
            sections.map((section) => section.realizedRevenue),
          )
        : null;
      const competition = classifyCompetition(match.type);

      return [
        {
          matchId: match.id,
          startTime: match.startTime,
          type: match.type,
          opponentTeamId: deriveOpponentTeamId(match, args.teamId),
          opponentTeamName: deriveOpponentTeamName(match, args.teamId),
          competitionKey: competition.competitionKey,
          competitionLabel: competition.competitionLabel,
          sections,
          estimatedRealizedGate,
          matchedSnapshotCapturedAt: matchedSnapshot?.capturedAt ?? null,
        },
      ];
    });
}

function buildHomeGameSectionSample(args: {
  boxScore: BBApiBoxScore;
  currentSeat: ArenaSeatStateResult | null;
  section: ArenaSectionKey;
  snapshotSeat: ArenaPricingSnapshotSeat | null;
}): ArenaHomeGameSectionSampleResult {
  const attendance = asInteger(args.boxScore.attendance?.[args.section]);
  const capacity = asInteger(args.snapshotSeat?.capacity) ?? asInteger(args.currentSeat?.capacity);
  const price = asInteger(args.snapshotSeat?.price) ?? asInteger(args.currentSeat?.price);
  const occupancyPct =
    attendance !== null && capacity !== null && capacity > 0
      ? roundTo((attendance / capacity) * 100, 1)
      : null;
  const realizedRevenue =
    attendance !== null && price !== null ? attendance * price : null;

  return {
    section: args.section,
    attendance,
    capacity,
    price,
    occupancyPct,
    realizedRevenue,
    usedMatchedSnapshot: Boolean(args.snapshotSeat),
  };
}

function buildArenaDiagnostics(args: {
  nextHomeMatch: BBApiScheduleMatch | null;
  recentHomeGames: ArenaHomeGameSampleResult[];
}): ArenaDiagnosticsResult {
  const lowConfidenceReasons: string[] = [];
  const matchedSnapshotCount = args.recentHomeGames.filter((game) =>
    Boolean(game.matchedSnapshotCapturedAt),
  ).length;
  const targetCompetitionKey = args.nextHomeMatch
    ? classifyCompetition(args.nextHomeMatch.type).competitionKey
    : null;
  const sameFamilyCount = targetCompetitionKey
    ? args.recentHomeGames.filter(
        (game) => game.competitionKey === targetCompetitionKey,
      ).length
    : 0;

  if (args.recentHomeGames.length < 3) {
    lowConfidenceReasons.push(
      "Fewer than three recent home games are available for comparison.",
    );
  }
  if (matchedSnapshotCount < 2) {
    lowConfidenceReasons.push(
      "Historical pregame arena snapshots are sparse, so realized gate estimates are less reliable.",
    );
  }
  if (targetCompetitionKey && sameFamilyCount === 0) {
    lowConfidenceReasons.push(
      "No recent home games from the same competition family were available.",
    );
  }

  return {
    comparableGameCount: args.recentHomeGames.length,
    matchedSnapshotCount,
    lowConfidenceReasons,
  };
}

function buildArenaRecommendation(args: {
  arena: BBApiArena;
  diagnostics: ArenaDiagnosticsResult;
  nextHomeMatch: BBApiScheduleMatch | null;
  recentHomeGames: ArenaHomeGameSampleResult[];
}): ArenaRecommendationResult | null {
  const currentSeatBySection = buildSeatMap(buildArenaSeatStates(args.arena));
  const targetCompetitionKey = args.nextHomeMatch
    ? classifyCompetition(args.nextHomeMatch.type).competitionKey
    : null;
  const overallConfidence = computeOverallConfidence({
    comparableGameCount: args.diagnostics.comparableGameCount,
    lowConfidenceReasons: args.diagnostics.lowConfidenceReasons,
    matchedSnapshotCount: args.diagnostics.matchedSnapshotCount,
  });

  const weightedMetricsBySection = new Map<
    ArenaSectionKey,
    {
      count: number;
      matchedSnapshotCount: number;
      weightedOccupancyPct: number | null;
    }
  >();
  const recommendationBySection = new Map<
    ArenaSectionKey,
    ArenaRecommendationSectionResult
  >();

  for (const section of ARENA_SECTION_ORDER) {
    const currentSeat = currentSeatBySection.get(section) ?? null;
    const currentPrice =
      asInteger(currentSeat?.price) ??
      asInteger(currentSeat?.nextPrice) ??
      ARENA_PRICE_BOUNDS[section].min;
    const metrics = buildWeightedSectionMetrics({
      recentHomeGames: args.recentHomeGames,
      section,
      targetCompetitionKey,
    });
    weightedMetricsBySection.set(section, metrics);

    const recommendedPrice = buildRecommendedPrice({
      currentPrice,
      occupancyPct: metrics.weightedOccupancyPct,
      section,
    });
    const currentCapacity = asInteger(currentSeat?.capacity);
    const projected = buildProjectedOutcome({
      capacity: currentCapacity,
      currentPrice,
      occupancyPct: metrics.weightedOccupancyPct,
      recommendedPrice,
      section,
    });

    recommendationBySection.set(section, {
      section,
      currentPrice,
      recommendedPrice,
      delta: recommendedPrice - currentPrice,
      reason: buildRecommendationReason({
        occupancyPct: metrics.weightedOccupancyPct,
        section,
      }),
      confidence: computeSectionConfidence({
        overallConfidence,
        sampleCount: metrics.count,
        matchedSnapshotCount: metrics.matchedSnapshotCount,
      }),
      weightedOccupancyPct: metrics.weightedOccupancyPct,
      projectedAttendance: projected.projectedAttendance,
      projectedRevenue: projected.projectedRevenue,
    });
  }

  applyCrossSectionGuardrail({
    recommendationBySection,
    weightedMetricsBySection,
  });

  const sections = ARENA_SECTION_ORDER.map(
    (section) => recommendationBySection.get(section) as ArenaRecommendationSectionResult,
  );

  return {
    overallConfidence,
    heuristicDisclaimer: HEURISTIC_DISCLAIMER,
    projectedCurrentRevenue: sumNumberValues(
      sections.map((section) =>
        estimateCurrentRevenue({
          arena: args.arena,
          currentPrice: section.currentPrice ?? null,
          occupancyPct: section.weightedOccupancyPct ?? null,
          section: section.section as ArenaSectionKey,
        }),
      ),
    ),
    projectedRecommendedRevenue: sumNumberValues(
      sections.map((section) => section.projectedRevenue),
    ),
    projectedRevenueDelta: differenceOrNull(
      sumNumberValues(
        sections.map((section) => section.projectedRevenue),
      ),
      sumNumberValues(
        sections.map((section) =>
          estimateCurrentRevenue({
            arena: args.arena,
            currentPrice: section.currentPrice ?? null,
            occupancyPct: section.weightedOccupancyPct ?? null,
            section: section.section as ArenaSectionKey,
          }),
        ),
      ),
    ),
    sections,
  };
}

function buildWeightedSectionMetrics(args: {
  recentHomeGames: ArenaHomeGameSampleResult[];
  section: ArenaSectionKey;
  targetCompetitionKey: string | null;
}): {
  count: number;
  matchedSnapshotCount: number;
  weightedOccupancyPct: number | null;
} {
  let weightedSum = 0;
  let weightTotal = 0;
  let count = 0;
  let matchedSnapshotCount = 0;

  for (const game of args.recentHomeGames) {
    const sample = game.sections.find((section) => section.section === args.section);
    const occupancyPct = sample?.occupancyPct ?? null;
    if (!sample || occupancyPct === null) {
      continue;
    }
    const weight = resolveComparableWeight({
      sampleCompetitionKey: game.competitionKey,
      targetCompetitionKey: args.targetCompetitionKey,
    });
    weightedSum += occupancyPct * weight;
    weightTotal += weight;
    count += 1;
    if (sample.usedMatchedSnapshot) {
      matchedSnapshotCount += 1;
    }
  }

  return {
    count,
    matchedSnapshotCount,
    weightedOccupancyPct:
      count > 0 && weightTotal > 0 ? roundTo(weightedSum / weightTotal, 1) : null,
  };
}

function buildRecommendedPrice(args: {
  currentPrice: number;
  occupancyPct: number | null;
  section: ArenaSectionKey;
}): number {
  const bounds = ARENA_PRICE_BOUNDS[args.section];
  if (args.occupancyPct === null) {
    return args.currentPrice;
  }

  let nextPrice = args.currentPrice;
  if (args.occupancyPct >= 98) {
    nextPrice = args.currentPrice * 1.05;
  } else if (args.occupancyPct >= 93) {
    nextPrice = args.currentPrice * 1.03;
  } else if (args.occupancyPct >= 85) {
    nextPrice = args.currentPrice;
  } else if (args.occupancyPct >= 70) {
    nextPrice = args.currentPrice * 0.95;
  } else {
    nextPrice = args.currentPrice * 0.9;
  }

  return clampWholeDollar(nextPrice, bounds);
}

function buildRecommendationReason(args: {
  occupancyPct: number | null;
  section: ArenaSectionKey;
}): string {
  if (args.occupancyPct === null) {
    return "Held because there is not enough recent home attendance data for this section.";
  }
  if (args.occupancyPct >= 98) {
    return `Raised because recent ${args.section} demand is effectively sold out at ${formatPercent(args.occupancyPct)} occupancy.`;
  }
  if (args.occupancyPct >= 93) {
    return `Raised modestly because recent ${args.section} demand has stayed strong at ${formatPercent(args.occupancyPct)} occupancy.`;
  }
  if (args.occupancyPct >= 85) {
    return `Held because recent ${args.section} demand is balanced at ${formatPercent(args.occupancyPct)} occupancy.`;
  }
  if (args.occupancyPct >= 70) {
    return `Trimmed because recent ${args.section} demand has softened to ${formatPercent(args.occupancyPct)} occupancy.`;
  }
  return `Cut because recent ${args.section} demand has been weak at ${formatPercent(args.occupancyPct)} occupancy.`;
}

function applyCrossSectionGuardrail(args: {
  recommendationBySection: Map<ArenaSectionKey, ArenaRecommendationSectionResult>;
  weightedMetricsBySection: Map<
    ArenaSectionKey,
    {
      count: number;
      matchedSnapshotCount: number;
      weightedOccupancyPct: number | null;
    }
  >;
}): void {
  const pairs: Array<[ArenaSectionKey, ArenaSectionKey]> = [
    ["bleachers", "lowerTier"],
    ["lowerTier", "courtside"],
    ["courtside", "luxury"],
  ];

  for (const [cheaperSection, pricierSection] of pairs) {
    const cheaperMetrics = args.weightedMetricsBySection.get(cheaperSection);
    const pricierMetrics = args.weightedMetricsBySection.get(pricierSection);
    const cheaperRecommendation = args.recommendationBySection.get(cheaperSection);
    const pricierRecommendation = args.recommendationBySection.get(pricierSection);

    if (
      !cheaperMetrics ||
      !pricierMetrics ||
      !cheaperRecommendation ||
      !pricierRecommendation
    ) {
      continue;
    }

    if (
      cheaperMetrics.weightedOccupancyPct !== null &&
      pricierMetrics.weightedOccupancyPct !== null &&
      cheaperMetrics.weightedOccupancyPct >= 98 &&
      pricierMetrics.weightedOccupancyPct < 80
    ) {
      const cheaperRecommendedPrice = cheaperRecommendation.recommendedPrice ?? null;
      const cheaperCurrentPrice = cheaperRecommendation.currentPrice ?? null;
      if (
        cheaperRecommendedPrice !== null &&
        cheaperCurrentPrice !== null &&
        cheaperRecommendedPrice > cheaperCurrentPrice
      ) {
        cheaperRecommendation.recommendedPrice = cheaperCurrentPrice;
        cheaperRecommendation.delta = 0;
        cheaperRecommendation.reason =
          `${cheaperRecommendation.reason} Held after the adjacent-section guardrail because ${pricierSection} demand remains under 80%.`;
      }

      const pricierCurrentPrice = pricierRecommendation.currentPrice ?? null;
      const pricierRecommendedPrice = pricierRecommendation.recommendedPrice ?? null;
      if (pricierCurrentPrice !== null) {
        const guardedPrice = clampWholeDollar(
          pricierCurrentPrice * 0.95,
          ARENA_PRICE_BOUNDS[pricierSection],
        );
        if (
          pricierRecommendedPrice === null ||
          guardedPrice < pricierRecommendedPrice
        ) {
          pricierRecommendation.recommendedPrice = guardedPrice;
          pricierRecommendation.delta = guardedPrice - pricierCurrentPrice;
          pricierRecommendation.reason =
            `${pricierRecommendation.reason} Lowered further by the adjacent-section guardrail because ${cheaperSection} is sold out while ${pricierSection} is under 80% occupied.`;
        }
      }
    }
  }
}

function buildProjectedOutcome(args: {
  capacity: number | null;
  currentPrice: number;
  occupancyPct: number | null;
  recommendedPrice: number;
  section: ArenaSectionKey;
}): { projectedAttendance: number | null; projectedRevenue: number | null } {
  if (args.capacity === null || args.occupancyPct === null || args.currentPrice <= 0) {
    return {
      projectedAttendance: null,
      projectedRevenue: null,
    };
  }

  const baselineOccupancy = clamp(args.occupancyPct / 100, 0, 1);
  const priceChangePct =
    (args.recommendedPrice - args.currentPrice) / args.currentPrice;
  const adjustedOccupancy = clamp(
    baselineOccupancy * (1 - ELASTICITY_BY_SECTION[args.section] * priceChangePct),
    0,
    1,
  );
  const projectedAttendance = Math.round(args.capacity * adjustedOccupancy);

  return {
    projectedAttendance,
    projectedRevenue: projectedAttendance * args.recommendedPrice,
  };
}

function estimateCurrentRevenue(args: {
  arena: BBApiArena;
  currentPrice: number | null;
  occupancyPct: number | null;
  section: ArenaSectionKey;
}): number | null {
  const seat = args.arena.seats[args.section];
  const capacity = asInteger(seat?.capacity);
  if (
    capacity === null ||
    args.currentPrice === null ||
    args.occupancyPct === null
  ) {
    return null;
  }

  return Math.round(capacity * clamp(args.occupancyPct / 100, 0, 1)) * args.currentPrice;
}

function computeOverallConfidence(args: {
  comparableGameCount: number;
  lowConfidenceReasons: readonly string[];
  matchedSnapshotCount: number;
}): number {
  const score =
    0.3 +
    Math.min(args.comparableGameCount, 6) * 0.07 +
    Math.min(args.matchedSnapshotCount, 6) * 0.04 -
    args.lowConfidenceReasons.length * 0.03;

  return roundTo(clamp(score, 0.25, 0.92), 2);
}

function computeSectionConfidence(args: {
  matchedSnapshotCount: number;
  overallConfidence: number;
  sampleCount: number;
}): number {
  const adjustment =
    Math.min(args.sampleCount, 6) * 0.02 + Math.min(args.matchedSnapshotCount, 6) * 0.01;
  return roundTo(clamp(args.overallConfidence - 0.08 + adjustment, 0.2, 0.95), 2);
}

function resolveComparableWeight(args: {
  sampleCompetitionKey: string | null | undefined;
  targetCompetitionKey: string | null;
}): number {
  if (!args.targetCompetitionKey || !args.sampleCompetitionKey) {
    return MATCH_FAMILY_WEIGHTS.otherCompetitive;
  }
  if (args.sampleCompetitionKey === args.targetCompetitionKey) {
    return MATCH_FAMILY_WEIGHTS.sameFamily;
  }
  if (args.targetCompetitionKey === "SCRIMMAGE") {
    return MATCH_FAMILY_WEIGHTS.otherWhenTargetScrimmage;
  }
  if (args.sampleCompetitionKey === "SCRIMMAGE") {
    return MATCH_FAMILY_WEIGHTS.scrimmage;
  }
  return MATCH_FAMILY_WEIGHTS.otherCompetitive;
}

function matchArenaPricingSnapshot(args: {
  match: BBApiScheduleMatch;
  snapshots: ArenaPricingSnapshotRecord[];
}): ArenaPricingSnapshotRecord | null {
  if (!args.match.startTime) {
    return null;
  }

  const matchTime = Date.parse(args.match.startTime);
  if (Number.isNaN(matchTime)) {
    return null;
  }

  const eligibleSnapshots = args.snapshots.filter((snapshot) => {
    if (!snapshot.capturedAt) {
      return false;
    }
    const capturedAt = Date.parse(snapshot.capturedAt);
    return (
      !Number.isNaN(capturedAt) &&
      capturedAt <= matchTime &&
      matchTime - capturedAt <= SNAPSHOT_LOOKBACK_MS
    );
  });

  const preferredSnapshot =
    eligibleSnapshots
      .filter((snapshot) => snapshot.nextHomeMatchId === args.match.id)
      .sort(byCapturedAtDescending)[0] ?? null;

  if (preferredSnapshot) {
    return preferredSnapshot;
  }

  return eligibleSnapshots.sort(byCapturedAtDescending)[0] ?? null;
}

function buildSeatMap(
  seats: ArenaSeatStateResult[],
): Map<ArenaSectionKey, ArenaSeatStateResult> {
  return new Map(
    seats.map((seat) => [seat.section as ArenaSectionKey, seat]),
  );
}

function buildSnapshotSeatMap(
  seats: readonly ArenaPricingSnapshotSeat[],
): Map<ArenaSectionKey, ArenaPricingSnapshotSeat> {
  return new Map(
    seats
      .map((seat) => [asString(seat.section), seat] as const)
      .filter(
        (entry): entry is [ArenaSectionKey, ArenaPricingSnapshotSeat] =>
          Boolean(entry[0]) && ARENA_SECTION_ORDER.includes(entry[0] as ArenaSectionKey),
      ),
  );
}

function differenceOrNull(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null || right === null) {
    return null;
  }
  return left - right;
}

function sumNumberValues(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let count = 0;

  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    total += value;
    count += 1;
  }

  return count > 0 ? total : null;
}

function clampWholeDollar(
  value: number,
  bounds: { max: number; min: number },
): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function formatPercent(value: number): string {
  return `${roundTo(value, 1)}%`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Number(value))
      ? Number(value)
      : null;
}

function asInteger(value: unknown): number | null {
  const numeric = asNumber(value);
  return numeric === null ? null : Math.round(numeric);
}

function deriveOpponentTeamId(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  if (match.homeTeam.id === teamId) {
    return match.awayTeam.id;
  }
  if (match.awayTeam.id === teamId) {
    return match.homeTeam.id;
  }
  return null;
}

function deriveOpponentTeamName(
  match: BBApiScheduleMatch,
  teamId: string | null,
): string | null {
  if (match.homeTeam.id === teamId) {
    return match.awayTeam.teamName;
  }
  if (match.awayTeam.id === teamId) {
    return match.homeTeam.teamName;
  }
  return null;
}

function deriveTeamScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (match.homeTeam.id === teamId) {
    return asInteger(match.homeTeam.score);
  }
  if (match.awayTeam.id === teamId) {
    return asInteger(match.awayTeam.score);
  }
  return null;
}

function deriveOpponentScore(
  match: BBApiScheduleMatch,
  teamId: string | null,
): number | null {
  if (match.homeTeam.id === teamId) {
    return asInteger(match.awayTeam.score);
  }
  if (match.awayTeam.id === teamId) {
    return asInteger(match.homeTeam.score);
  }
  return null;
}

function isTeamHome(match: BBApiScheduleMatch, teamId: string | null): boolean {
  return Boolean(teamId && match.homeTeam.id === teamId);
}

function isClubMatchForTeam(
  match: BBApiScheduleMatch,
  teamId: string | null,
): boolean {
  return Boolean(
    teamId &&
      (match.homeTeam.id === teamId || match.awayTeam.id === teamId) &&
      !isNonClubScheduleType(match.type),
  );
}

function isNonClubScheduleType(type: string | null | undefined): boolean {
  const normalized = type?.trim().toLowerCase();
  return Boolean(
    normalized &&
      (normalized.includes("allstar") ||
        normalized.includes("all-star") ||
        normalized.startsWith("nationalteam") ||
        normalized.startsWith("nt.")),
  );
}

function byStartTimeAscending(
  left: BBApiScheduleMatch,
  right: BBApiScheduleMatch,
): number {
  return String(left.startTime ?? "").localeCompare(String(right.startTime ?? ""));
}

function byStartTimeDescending(
  left: BBApiScheduleMatch,
  right: BBApiScheduleMatch,
): number {
  return String(right.startTime ?? "").localeCompare(String(left.startTime ?? ""));
}

function byCapturedAtDescending(
  left: ArenaPricingSnapshotRecord,
  right: ArenaPricingSnapshotRecord,
): number {
  return String(right.capturedAt ?? "").localeCompare(String(left.capturedAt ?? ""));
}
