import {
  coachParrotArtifacts,
  normalizeDefense,
  normalizeEnthusiasm,
  normalizeLocation,
  normalizeOffense,
  resolveHomeCourtFlag,
} from "./artifacts";
import type {
  CoachParrotContext,
  CoachParrotEvaluation,
  CoachParrotRoster,
  LineupAssignment,
  Position,
  RankingEntry,
  Rating,
  RawPlayerSkills,
} from "./types";
import {
  POSITION_SEQUENCE,
  RATING_SEQUENCE,
} from "./types";

type CanonicalSkillField =
  | "js"
  | "jr"
  | "od"
  | "ha"
  | "dr"
  | "pa"
  | "is"
  | "id"
  | "rb"
  | "sb"
  | "st"
  | "ft"
  | "ex"
  | "gs";

const TEXT_SKILL_LABELS = [
  "atrocious",
  "pitiful",
  "awful",
  "inept",
  "mediocre",
  "average",
  "respectable",
  "strong",
  "proficient",
  "prominent",
  "prolific",
  "sensational",
  "tremendous",
  "wondrous",
  "marvelous",
  "prodigious",
  "stupendous",
  "phenomenal",
  "colossal",
  "legendary",
] as const;

const TEXT_SKILL_TO_VALUE = Object.fromEntries(
  TEXT_SKILL_LABELS.map((label, index) => [label, index + 1]),
) as Record<string, number>;

const SKILL_ALIASES: Partial<Record<string, CanonicalSkillField>> = {
  jumpshot: "js",
  js: "js",
  jumprange: "jr",
  jr: "jr",
  outsidedefense: "od",
  perimeterdefense: "od",
  perimdef: "od",
  od: "od",
  handling: "ha",
  ha: "ha",
  driving: "dr",
  dr: "dr",
  passing: "pa",
  pa: "pa",
  insidescoring: "is",
  insideshot: "is",
  insideoffense: "is",
  is: "is",
  insidedefense: "id",
  insidedef: "id",
  id: "id",
  rebounding: "rb",
  rb: "rb",
  shotblocking: "sb",
  shotblock: "sb",
  sb: "sb",
  stamina: "st",
  st: "st",
  freethrow: "ft",
  freethrows: "ft",
  ft: "ft",
  experience: "ex",
  ex: "ex",
  gameshape: "gs",
  gs: "gs",
};

export function normalizeContext(input: Partial<CoachParrotContext>): CoachParrotContext {
  return {
    offense: normalizeOffense(input.offense),
    defense: normalizeDefense(input.defense),
    enthusiasm: normalizeEnthusiasm(input.enthusiasm),
    homeCourt: normalizeLocation(input.homeCourt),
  };
}

export function normalizeSkillValue(rawValue: unknown): number | null {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue === "boolean") {
    return rawValue ? 1 : 0;
  }
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return Math.round(rawValue);
  }

  const text = String(rawValue).trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric);
  }
  const normalized = text.toLowerCase().replaceAll(" ", "").replaceAll("-", "");
  return TEXT_SKILL_TO_VALUE[normalized] ?? null;
}

export function buildRawPlayerSkills(input: {
  playerId: string;
  name: string;
  age?: unknown;
  salary?: unknown;
  metadata?: Record<string, unknown>;
  skills: Record<string, unknown>;
}): RawPlayerSkills {
  const normalized: Partial<Record<CanonicalSkillField, number>> = {};
  for (const [rawKey, rawValue] of Object.entries(input.skills)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
    const canonical = SKILL_ALIASES[key];
    if (canonical == null) {
      continue;
    }
    const value = normalizeSkillValue(rawValue);
    if (value == null) {
      continue;
    }
    normalized[canonical] = value;
  }

  return {
    playerId: input.playerId,
    name: input.name,
    js: normalized.js ?? 0,
    jr: normalized.jr ?? 0,
    od: normalized.od ?? 0,
    ha: normalized.ha ?? 0,
    dr: normalized.dr ?? 0,
    pa: normalized.pa ?? 0,
    is: normalized.is ?? 0,
    id: normalized.id ?? 0,
    rb: normalized.rb ?? 0,
    sb: normalized.sb ?? 0,
    st: normalized.st ?? 0,
    ft: normalized.ft ?? 0,
    ex: normalized.ex ?? 0,
    gs: normalized.gs ?? 0,
    age: normalizeSkillValue(input.age),
    salary: normalizeSkillValue(input.salary),
    metadata: input.metadata ?? {},
  };
}

function skillMap(player: RawPlayerSkills) {
  return {
    JS: player.js,
    JR: player.jr,
    OD: player.od,
    HA: player.ha,
    DR: player.dr,
    PA: player.pa,
    IS: player.is,
    ID: player.id,
    RB: player.rb,
    SB: player.sb,
  };
}

function energyMultiplier(args: {
  player: RawPlayerSkills;
  assignedMinutes: number;
  rating: Rating;
  context: CoachParrotContext;
}) {
  const scale = args.player.st * 100_000_000;
  if (scale <= 0) {
    return 0;
  }
  if (args.assignedMinutes <= 0) {
    return 1;
  }

  const offenseTacticEnergy =
    coachParrotArtifacts.tactic_energy[
      normalizeOffense(args.context.offense)
    ] as Partial<Record<Rating, { base: number; exponent: number }>> | undefined;
  const defenseTacticEnergy =
    coachParrotArtifacts.tactic_energy[
      normalizeDefense(args.context.defense)
    ] as Partial<Record<Rating, { base: number; exponent: number }>> | undefined;
  const offenseEnergy = offenseTacticEnergy?.[args.rating] ?? { base: 1, exponent: 1 };
  const defenseEnergy = defenseTacticEnergy?.[args.rating] ?? { base: 1, exponent: 1 };
  const offensiveTerm =
    1 -
    args.assignedMinutes ** offenseEnergy.exponent /
      (scale * (1 + Math.log(offenseEnergy.base)));
  const defensiveTerm =
    1 -
    args.assignedMinutes ** defenseEnergy.exponent /
      (scale * (1 + Math.log(defenseEnergy.base)));
  return Math.max(0, offensiveTerm * defensiveTerm);
}

function ratingComponent(args: {
  player: RawPlayerSkills;
  position: Position;
  rating: Rating;
  assignedMinutes: number;
  context: CoachParrotContext;
}) {
  const coefficients = coachParrotArtifacts.coefficients[args.position][args.rating];
  const base = Object.entries(coefficients).reduce((sum, [skill, weight]) => {
    return sum + skillMap(args.player)[skill as keyof ReturnType<typeof skillMap>] * weight;
  }, 0);
  const gameShapeFactor =
    1 + (args.player.gs - 7) * coachParrotArtifacts.gs_slopes[args.rating];
  const energy = energyMultiplier({
    player: args.player,
    assignedMinutes: args.assignedMinutes,
    rating: args.rating,
    context: args.context,
  });
  return base * gameShapeFactor * energy;
}

export function positionOutputTotals(args: {
  player: RawPlayerSkills;
  context: CoachParrotContext;
  assignedMinutes?: number;
}): Record<Position, number> {
  const assignedMinutes = args.assignedMinutes ?? coachParrotArtifacts.default_minutes;
  return Object.fromEntries(
    POSITION_SEQUENCE.map((position) => [
      position,
      Number(
        RATING_SEQUENCE.reduce((sum, rating) => {
          return (
            sum +
            ratingComponent({
              player: args.player,
              position,
              rating,
              assignedMinutes,
              context: args.context,
            })
          );
        }, 0).toFixed(12),
      ),
    ]),
  ) as Record<Position, number>;
}

export function rankRoster(args: {
  roster: CoachParrotRoster;
  context: CoachParrotContext;
}): {
  playerOutputs: Record<string, Record<Position, number>>;
  rankings: Record<Position, RankingEntry[]>;
} {
  const playerOutputs = Object.fromEntries(
    args.roster.players.map((player) => [
      player.playerId,
      positionOutputTotals({ player, context: args.context }),
    ]),
  ) as Record<string, Record<Position, number>>;

  const rankings = Object.fromEntries(
    POSITION_SEQUENCE.map((position) => [
      position,
      [...args.roster.players]
        .map((player) => {
          const positionOutputs = playerOutputs[player.playerId] ?? positionOutputTotals({
            player,
            context: args.context,
          });
          return {
            playerId: player.playerId,
            name: player.name,
            output: Number(positionOutputs[position].toFixed(12)),
          };
        })
        .sort(
          (left, right) =>
            right.output - left.output ||
            left.name.localeCompare(right.name) ||
            left.playerId.localeCompare(right.playerId),
        ),
    ]),
  ) as Record<Position, RankingEntry[]>;

  return {
    playerOutputs,
    rankings,
  };
}

function chooseMinutes(starterOutput: number, backupOutput: number | null): [number, number] {
  if (backupOutput == null || starterOutput <= 0) {
    return [48, 0];
  }
  const ratio = backupOutput / starterOutput;
  if (ratio >= 0.97) {
    return [24, 24];
  }
  if (ratio >= 0.94) {
    return [30, 18];
  }
  if (ratio >= 0.9) {
    return [36, 12];
  }
  if (ratio >= 0.86) {
    return [42, 6];
  }
  return [48, 0];
}

export function buildLineup(args: {
  roster: CoachParrotRoster;
  context: CoachParrotContext;
}): {
  assignments: LineupAssignment[];
  rankings: Record<Position, RankingEntry[]>;
  playerOutputs: Record<string, Record<Position, number>>;
  warnings: string[];
} {
  const { playerOutputs, rankings } = rankRoster(args);
  const usedPlayerIds = new Set<string>();
  const assignments: LineupAssignment[] = [];
  const warnings: string[] = [];

  for (const position of POSITION_SEQUENCE) {
    const candidates = rankings[position];
    if (!candidates.length) {
      warnings.push(`no candidates available for ${position}`);
      continue;
    }
    const starter =
      candidates.find((candidate) => !usedPlayerIds.has(candidate.playerId)) ?? candidates[0];
    if (!starter) {
      warnings.push(`no starter available for ${position}`);
      continue;
    }
    usedPlayerIds.add(starter.playerId);

    const backup =
      candidates.find(
        (candidate) =>
          candidate.playerId !== starter.playerId && !usedPlayerIds.has(candidate.playerId),
      ) ?? null;
    const [starterMinutes, backupMinutes] = chooseMinutes(
      starter.output,
      backup?.output ?? null,
    );

    assignments.push({
      position,
      playerId: starter.playerId,
      minutes: starterMinutes,
    });
    if (backup && backupMinutes > 0) {
      usedPlayerIds.add(backup.playerId);
      assignments.push({
        position,
        playerId: backup.playerId,
        minutes: backupMinutes,
      });
    }
  }

  for (const position of POSITION_SEQUENCE) {
    const total = assignments
      .filter((assignment) => assignment.position === position)
      .reduce((sum, assignment) => sum + assignment.minutes, 0);
    if (total !== 48) {
      warnings.push(`auto-lineup did not allocate 48 minutes at ${position}`);
    }
  }

  return {
    assignments,
    rankings,
    playerOutputs,
    warnings,
  };
}

function positionRatingComponents(args: {
  player: RawPlayerSkills;
  position: Position;
  assignedMinutes: number;
  context: CoachParrotContext;
}) {
  return Object.fromEntries(
    RATING_SEQUENCE.map((rating) => [
      rating,
      ratingComponent({
        player: args.player,
        position: args.position,
        rating,
        assignedMinutes: args.assignedMinutes,
        context: args.context,
      }),
    ]),
  ) as Record<Rating, number>;
}

function ratingLabel(value: number) {
  const rounded = Math.trunc(value * 3) / 3;
  const integer = Math.trunc(rounded);
  const fractionIndex = Math.round((rounded - integer) * 3);
  return {
    rounded,
    label:
      coachParrotArtifacts.rating_word_labels[String(Math.max(integer, 1))] ??
      coachParrotArtifacts.rating_word_labels["20"],
    band:
      coachParrotArtifacts.fractional_band_labels[String(Math.max(0, Math.min(2, fractionIndex)))] ??
      coachParrotArtifacts.fractional_band_labels["0"],
  };
}

function contextAdjustment(args: {
  rating: Rating;
  baseRating: number;
  context: CoachParrotContext;
}) {
  const enthusiasmCoefficient =
    coachParrotArtifacts.enthusiasm_adjustments[args.rating] ?? 0;
  const homeCourtCoefficient =
    coachParrotArtifacts.home_court_adjustments[args.rating] ?? 0;
  if (!enthusiasmCoefficient && !homeCourtCoefficient) {
    return 0;
  }

  const magnitude = Math.log1p(args.baseRating);
  return (
    magnitude * ((args.context.enthusiasm - 5) * enthusiasmCoefficient) +
    magnitude * (resolveHomeCourtFlag(args.context.homeCourt) * homeCourtCoefficient)
  );
}

function normalizeAssignments(assignments: LineupAssignment[]): LineupAssignment[] {
  const merged = new Map<string, LineupAssignment>();
  for (const assignment of assignments) {
    const minutes = Math.max(0, Math.round(assignment.minutes));
    if (!POSITION_SEQUENCE.includes(assignment.position)) {
      continue;
    }
    const key = `${assignment.playerId}:${assignment.position}`;
    const current = merged.get(key);
    merged.set(key, {
      position: assignment.position,
      playerId: assignment.playerId,
      minutes: minutes + (current?.minutes ?? 0),
    });
  }
  return Array.from(merged.values()).filter((assignment) => assignment.minutes > 0);
}

export function evaluateLineup(args: {
  roster: CoachParrotRoster;
  lineup: LineupAssignment[];
  context: Partial<CoachParrotContext>;
}): CoachParrotEvaluation {
  const context = normalizeContext(args.context);
  const lineup = normalizeAssignments(args.lineup);
  const playerIndex = new Map(args.roster.players.map((player) => [player.playerId, player]));
  const totalMinutesByPlayer = new Map<string, number>();
  const warnings: string[] = [];
  const { playerOutputs, rankings } = rankRoster({ roster: args.roster, context });

  for (const assignment of lineup) {
    totalMinutesByPlayer.set(
      assignment.playerId,
      (totalMinutesByPlayer.get(assignment.playerId) ?? 0) + assignment.minutes,
    );
  }

  for (const [playerId, minutes] of Array.from(totalMinutesByPlayer.entries())) {
    if (minutes > 48) {
      warnings.push(`${playerId} allocated ${minutes} minutes instead of 48 or fewer`);
    }
  }

  const perPositionContributions = Object.fromEntries(
    RATING_SEQUENCE.map((rating) => [
      rating,
      Object.fromEntries(POSITION_SEQUENCE.map((position) => [position, 0])),
    ]),
  ) as Record<Rating, Record<Position, number>>;

  for (const position of POSITION_SEQUENCE) {
    const positionAssignments = lineup.filter((assignment) => assignment.position === position);
    const positionTotalMinutes = positionAssignments.reduce(
      (sum, assignment) => sum + assignment.minutes,
      0,
    );
    if (positionTotalMinutes !== 48) {
      warnings.push(`${position} allocated ${positionTotalMinutes} minutes instead of 48`);
    }

    for (const assignment of positionAssignments) {
      const player = playerIndex.get(assignment.playerId);
      if (!player) {
        warnings.push(`missing player data for ${assignment.playerId}`);
        continue;
      }
      const components = positionRatingComponents({
        player,
        position,
        assignedMinutes: totalMinutesByPlayer.get(assignment.playerId) ?? assignment.minutes,
        context,
      });
      for (const rating of RATING_SEQUENCE) {
        perPositionContributions[rating][position] +=
          components[rating] * (assignment.minutes / 48);
      }
    }
  }

  const rawRatings = {} as Record<Rating, number>;
  for (const rating of RATING_SEQUENCE) {
    const baseRating = Object.values(perPositionContributions[rating]).reduce(
      (sum, value) => sum + value,
      0,
    );
    const adjustedRating = baseRating + contextAdjustment({
      rating,
      baseRating,
      context,
    });
    if (baseRating > 0 && adjustedRating !== baseRating) {
      const ratio = adjustedRating / baseRating;
      for (const position of POSITION_SEQUENCE) {
        perPositionContributions[rating][position] *= ratio;
      }
    }
    rawRatings[rating] = Number(adjustedRating.toFixed(12));
  }

  const roundedRatings = {} as Record<Rating, number>;
  const ratingLabels = {} as Record<Rating, string>;
  const outputBandLabels = {} as Record<Rating, string>;

  for (const rating of RATING_SEQUENCE) {
    const label = ratingLabel(rawRatings[rating]);
    roundedRatings[rating] = label.rounded;
    ratingLabels[rating] = label.label ?? "";
    outputBandLabels[rating] = label.band ?? "";
  }

  return {
    version: "CoachParrotEvaluationV1",
    context,
    rawRatings,
    roundedRatings,
    ratingLabels,
    outputBandLabels,
    totalOutput: Number(
      Object.values(rawRatings)
        .reduce((sum, value) => sum + value, 0)
        .toFixed(12),
    ),
    perPositionContributions: Object.fromEntries(
      RATING_SEQUENCE.map((rating) => [
        rating,
        Object.fromEntries(
          POSITION_SEQUENCE.map((position) => [
            position,
            Number(perPositionContributions[rating][position].toFixed(12)),
          ]),
        ),
      ]),
    ) as Record<Rating, Record<Position, number>>,
    playerPositionOutputs: playerOutputs,
    chosenLineup: lineup,
    warnings,
    rankings,
  };
}

export function evaluateRoster(args: {
  roster: CoachParrotRoster;
  context: Partial<CoachParrotContext>;
}): CoachParrotEvaluation {
  const context = normalizeContext(args.context);
  const built = buildLineup({
    roster: args.roster,
    context,
  });
  const evaluation = evaluateLineup({
    roster: args.roster,
    lineup: built.assignments,
    context,
  });
  return {
    ...evaluation,
    warnings: [...evaluation.warnings, ...built.warnings],
    rankings: built.rankings,
  };
}

export function sampleFixture() {
  return coachParrotArtifacts.sample;
}
