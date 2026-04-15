import { Worker } from "node:worker_threads";

import {
  coachParrotArtifacts,
  normalizeDefense,
  normalizeEnthusiasm,
  normalizeLocation,
  normalizeOffense,
  resolveHomeCourtFlag,
} from "./artifacts";
import {
  LINEUP_ALLOWED_MINUTES,
  LINEUP_MAX_MINUTES_PER_PLAYER,
  LINEUP_MINUTES_PER_POSITION,
  normalizeDefensiveSwitch,
  normalizeLineupAssignments,
} from "./lineup-rules";
import { resolveBuzzerBeaterNumericValue } from "../buzzerbeater/rating-scale";
import type {
  CoachParrotContext,
  CoachParrotEvaluation,
  CoachParrotRoster,
  LineupOptimizerAlgorithm,
  LineupAssignment,
  Position,
  RankingEntry,
  Rating,
  RawPlayerSkills,
} from "./types";
import { optimizeLineup } from "./optimizer";
import {
  POSITION_SEQUENCE,
  RATING_SEQUENCE,
} from "./types";

const OFFENSE_POSITION_RATINGS = [
  "outsideScoring",
  "insideScoring",
  "offensiveFlow",
] as const satisfies Rating[];
const DEFENSE_POSITION_RATINGS = [
  "outsideDefense",
  "insideDefense",
  "rebounding",
] as const satisfies Rating[];
const DEFAULT_BATCH_WORKER_COUNT = 2;
const COACH_PARROT_BATCH_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");

void (async () => {
  const moduleRef = await import(workerData.moduleUrl);

  parentPort?.on("message", async (job) => {
    try {
      const evaluation = await moduleRef.evaluateRosterBatchWorkerUnit({
        algorithm: workerData.algorithm ?? undefined,
        context: job.context,
        roster: workerData.roster,
      });
      parentPort?.postMessage({
        contextId: job.contextId,
        evaluation,
      });
    } catch (error) {
      parentPort?.postMessage({
        contextId: job.contextId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
})().catch((error) => {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : String(error),
    fatal: true,
  });
});
`;

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

export type EvaluateRosterBatchContextInput = {
  context: Partial<CoachParrotContext>;
  contextId: string;
};

export type EvaluateRosterBatchResult = {
  contextId: string;
  evaluation: CoachParrotEvaluation;
};

const SKILL_ALIASES: Partial<Record<string, CanonicalSkillField>> = {
  jumpshot: "js",
  js: "js",
  jumprange: "jr",
  jr: "jr",
  outsidedefense: "od",
  outsidedef: "od",
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
  rebound: "rb",
  rb: "rb",
  shotblocking: "sb",
  shotblock: "sb",
  shotblk: "sb",
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
    defensiveSwitch: normalizeDefensiveSwitch(input.defensiveSwitch),
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
  return resolveBuzzerBeaterNumericValue("player_rating", text);
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
    const key = rawKey.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
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
      Number(slotOutputTotal({
        assignedMinutes,
        context: args.context,
        offensivePosition: position,
        player: args.player,
      }).toFixed(12)),
    ]),
  ) as Record<Position, number>;
}

function slotOutputTotal(args: {
  assignedMinutes: number;
  context: CoachParrotContext;
  offensivePosition: Position;
  player: RawPlayerSkills;
}): number {
  const defensivePosition = args.context.defensiveSwitch[args.offensivePosition];
  const offensiveTotal = OFFENSE_POSITION_RATINGS.reduce((sum, rating) => {
    return (
      sum +
      ratingComponent({
        player: args.player,
        position: args.offensivePosition,
        rating,
        assignedMinutes: args.assignedMinutes,
        context: args.context,
      })
    );
  }, 0);
  const defensiveTotal = DEFENSE_POSITION_RATINGS.reduce((sum, rating) => {
    return (
      sum +
      ratingComponent({
        player: args.player,
        position: defensivePosition,
        rating,
        assignedMinutes: args.assignedMinutes,
        context: args.context,
      })
    );
  }, 0);
  return offensiveTotal + defensiveTotal;
}

export function rankRoster(args: {
  roster: CoachParrotRoster;
  context: Partial<CoachParrotContext>;
}): {
  playerOutputs: Record<string, Record<Position, number>>;
  rankings: Record<Position, RankingEntry[]>;
} {
  const context = normalizeContext(args.context);
  const playerOutputs = Object.fromEntries(
    args.roster.players.map((player) => [
      player.playerId,
      positionOutputTotals({ player, context }),
    ]),
  ) as Record<string, Record<Position, number>>;

  const rankings = Object.fromEntries(
    POSITION_SEQUENCE.map((position) => [
      position,
      [...args.roster.players]
        .map((player) => {
          const positionOutputs = playerOutputs[player.playerId] ?? positionOutputTotals({
            player,
            context,
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

export async function buildLineup(args: {
  algorithm?: LineupOptimizerAlgorithm;
  roster: CoachParrotRoster;
  context: CoachParrotContext;
}): Promise<{
  assignments: LineupAssignment[];
  rankings: Record<Position, RankingEntry[]>;
  playerOutputs: Record<string, Record<Position, number>>;
  warnings: string[];
}> {
  const { playerOutputs, playerOutputsByMinutes, rankings } =
    prepareLineupOptimization({
      context: args.context,
      roster: args.roster,
    });
  const optimized = await optimizeLineup({
    algorithm: args.algorithm,
    playerOutputsByMinutes,
    playerOutputs,
    players: args.roster,
  });
  if (!optimized) {
    throw new Error(
      "Unable to build a legal lineup with 6-minute increments and 42-minute exhaustion limits.",
    );
  }

  return {
    assignments: optimized.assignments,
    rankings,
    playerOutputs,
    warnings: [],
  };
}

function prepareLineupOptimization(args: {
  context: CoachParrotContext;
  roster: CoachParrotRoster;
}): {
  playerOutputs: Record<string, Record<Position, number>>;
  playerOutputsByMinutes: Record<string, Record<number, Record<Position, number>>>;
  rankings: Record<Position, RankingEntry[]>;
} {
  const { playerOutputs, rankings } = rankRoster(args);
  const playerOutputsByMinutes = Object.fromEntries(
    args.roster.players.map((player) => [
      player.playerId,
      Object.fromEntries(
        LINEUP_ALLOWED_MINUTES.map((minutes) => [
          minutes,
          positionOutputTotals({
            player,
            context: args.context,
            assignedMinutes: minutes,
          }),
        ]),
      ),
    ]),
  ) as Record<string, Record<number, Record<Position, number>>>;

  return {
    playerOutputs,
    playerOutputsByMinutes,
    rankings,
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

export function evaluateLineup(args: {
  roster: CoachParrotRoster;
  lineup: LineupAssignment[];
  context: Partial<CoachParrotContext>;
}): CoachParrotEvaluation {
  const context = normalizeContext(args.context);
  const lineup = normalizeLineupAssignments(args.lineup);
  const { playerOutputs, rankings } = rankRoster({ roster: args.roster, context });

  return evaluateLineupWithPreparedData({
    context,
    lineup,
    playerOutputs,
    rankings,
    roster: args.roster,
  });
}

function evaluateLineupWithPreparedData(args: {
  context: CoachParrotContext;
  lineup: LineupAssignment[];
  playerOutputs: Record<string, Record<Position, number>>;
  rankings: Record<Position, RankingEntry[]>;
  roster: CoachParrotRoster;
}): CoachParrotEvaluation {
  const playerIndex = new Map(
    args.roster.players.map((player) => [player.playerId, player]),
  );
  const totalMinutesByPlayer = new Map<string, number>();
  const warnings: string[] = [];

  for (const assignment of args.lineup) {
    totalMinutesByPlayer.set(
      assignment.playerId,
      (totalMinutesByPlayer.get(assignment.playerId) ?? 0) + assignment.minutes,
    );
  }

  for (const [playerId, minutes] of Array.from(totalMinutesByPlayer.entries())) {
    if (minutes > LINEUP_MAX_MINUTES_PER_PLAYER) {
      warnings.push(
        `${playerId} allocated ${minutes} minutes instead of ${LINEUP_MAX_MINUTES_PER_PLAYER} or fewer`,
      );
    }
  }

  const perPositionContributions = Object.fromEntries(
    RATING_SEQUENCE.map((rating) => [
      rating,
      Object.fromEntries(POSITION_SEQUENCE.map((position) => [position, 0])),
    ]),
  ) as Record<Rating, Record<Position, number>>;

  for (const position of POSITION_SEQUENCE) {
    const positionAssignments = args.lineup.filter(
      (assignment) => assignment.position === position,
    );
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
      const assignedMinutes = totalMinutesByPlayer.get(assignment.playerId);
      if (assignedMinutes == null) {
        warnings.push(`missing minute totals for ${assignment.playerId}`);
        continue;
      }
      const offensiveComponents = positionRatingComponents({
        player,
        position,
        assignedMinutes,
        context: args.context,
      });
      const defensivePosition = args.context.defensiveSwitch[position];
      const defensiveComponents = positionRatingComponents({
        player,
        position: defensivePosition,
        assignedMinutes,
        context: args.context,
      });
      for (const rating of OFFENSE_POSITION_RATINGS) {
        perPositionContributions[rating][position] +=
          offensiveComponents[rating] * (assignment.minutes / LINEUP_MINUTES_PER_POSITION);
      }
      for (const rating of DEFENSE_POSITION_RATINGS) {
        perPositionContributions[rating][defensivePosition] +=
          defensiveComponents[rating] *
          (assignment.minutes / LINEUP_MINUTES_PER_POSITION);
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
      context: args.context,
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
    context: args.context,
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
    playerPositionOutputs: args.playerOutputs,
    chosenLineup: args.lineup,
    warnings,
    rankings: args.rankings,
  };
}

export async function evaluateRoster(args: {
  algorithm?: LineupOptimizerAlgorithm;
  roster: CoachParrotRoster;
  context: Partial<CoachParrotContext>;
}): Promise<CoachParrotEvaluation> {
  const context = normalizeContext(args.context);
  const built = await buildLineup({
    algorithm: args.algorithm,
    roster: args.roster,
    context,
  });
  const evaluation = evaluateLineupWithPreparedData({
    context,
    lineup: built.assignments,
    playerOutputs: built.playerOutputs,
    rankings: built.rankings,
    roster: args.roster,
  });
  return {
    ...evaluation,
    warnings: [...evaluation.warnings, ...built.warnings],
    rankings: built.rankings,
  };
}

export async function evaluateRosterBatchWorkerUnit(args: {
  algorithm?: LineupOptimizerAlgorithm;
  context: Partial<CoachParrotContext>;
  roster: CoachParrotRoster;
}): Promise<CoachParrotEvaluation> {
  return await evaluateRoster(args);
}

export async function evaluateRosterBatch(args: {
  algorithm?: LineupOptimizerAlgorithm;
  contexts: readonly EvaluateRosterBatchContextInput[];
  onProgress?: (result: {
    completedCount: number;
    contextId: string;
    totalCount: number;
  }) => Promise<void> | void;
  roster: CoachParrotRoster;
  workerCount?: number;
}): Promise<EvaluateRosterBatchResult[]> {
  const jobs = args.contexts.map((context) => ({
    context: normalizeContext(context.context),
    contextId: context.contextId,
  }));
  if (!jobs.length) {
    return [];
  }

  const workerCount = Math.min(
    Math.max(1, args.workerCount ?? DEFAULT_BATCH_WORKER_COUNT),
    jobs.length,
  );

  if (workerCount === 1) {
    const results: EvaluateRosterBatchResult[] = [];
    let completedCount = 0;
    for (const job of jobs) {
      const evaluation = await evaluateRosterBatchWorkerUnit({
        algorithm: args.algorithm,
        context: job.context,
        roster: args.roster,
      });
      completedCount += 1;
      results.push({
        contextId: job.contextId,
        evaluation,
      });
      await Promise.resolve(
        args.onProgress?.({
          completedCount,
          contextId: job.contextId,
          totalCount: jobs.length,
        }),
      );
    }
    return results;
  }

  return await evaluateRosterBatchWithWorkers({
    algorithm: args.algorithm,
    jobs,
    onProgress: args.onProgress,
    roster: args.roster,
    workerCount,
  });
}

async function evaluateRosterBatchWithWorkers(args: {
  algorithm?: LineupOptimizerAlgorithm;
  jobs: Array<{
    context: CoachParrotContext;
    contextId: string;
  }>;
  onProgress?: (result: {
    completedCount: number;
    contextId: string;
    totalCount: number;
  }) => Promise<void> | void;
  roster: CoachParrotRoster;
  workerCount: number;
}): Promise<EvaluateRosterBatchResult[]> {
  const results = new Array<EvaluateRosterBatchResult>(args.jobs.length);
  const indexByContextId = new Map(
    args.jobs.map((job, index) => [job.contextId, index]),
  );
  const workers = Array.from({ length: args.workerCount }, () =>
    new Worker(COACH_PARROT_BATCH_WORKER_SOURCE, {
      eval: true,
      execArgv: process.execArgv,
      workerData: {
        algorithm: args.algorithm ?? null,
        moduleUrl: import.meta.url,
        roster: args.roster,
      },
    }),
  );
  let completedCount = 0;
  let nextIndex = 0;
  let settled = false;

  const cleanup = async () => {
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
  };

  return await new Promise<EvaluateRosterBatchResult[]>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      void cleanup().then(() => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    };

    const maybeFinish = () => {
      if (settled || completedCount !== args.jobs.length) {
        return;
      }
      settled = true;
      void cleanup().then(() => resolve(results));
    };

    const dispatchNext = (worker: Worker) => {
      if (settled) {
        return;
      }
      const job = args.jobs[nextIndex];
      if (!job) {
        maybeFinish();
        return;
      }
      nextIndex += 1;
      worker.postMessage(job);
    };

    for (const worker of workers) {
      worker.on("message", (message: unknown) => {
        void (async () => {
          if (settled) {
            return;
          }
          const record = message as {
            contextId?: unknown;
            error?: unknown;
            evaluation?: unknown;
            fatal?: unknown;
          };
          if (record.error) {
            fail(new Error(String(record.error)));
            return;
          }

          const contextId =
            typeof record.contextId === "string" ? record.contextId : null;
          if (!contextId || !record.evaluation) {
            fail(
              new Error(
                "Coach Parrot batch worker returned an invalid optimization payload.",
              ),
            );
            return;
          }

          const resultIndex = indexByContextId.get(contextId);
          if (resultIndex === undefined) {
            fail(
              new Error(
                `Coach Parrot batch worker returned an unknown context id: ${contextId}.`,
              ),
            );
            return;
          }

          results[resultIndex] = {
            contextId,
            evaluation: record.evaluation as CoachParrotEvaluation,
          };
          completedCount += 1;
          await Promise.resolve(
            args.onProgress?.({
              completedCount,
              contextId,
              totalCount: args.jobs.length,
            }),
          );
          dispatchNext(worker);
        })().catch(fail);
      });
      worker.on("error", fail);
      worker.on("exit", (code) => {
        if (!settled && code !== 0 && completedCount < args.jobs.length) {
          fail(
            new Error(
              `Coach Parrot batch worker exited unexpectedly with code ${code}.`,
            ),
          );
        }
      });
      dispatchNext(worker);
    }
  });
}

export function sampleFixture() {
  return coachParrotArtifacts.sample;
}
