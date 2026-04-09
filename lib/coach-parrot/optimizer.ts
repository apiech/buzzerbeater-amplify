import {
  LEGAL_POSITION_MINUTE_SPLITS,
  LINEUP_MAX_MINUTES_PER_PLAYER,
  LINEUP_MINUTES_PER_POSITION,
  LINEUP_TEAM_TOTAL_MINUTES,
  checkRotationFeasibility,
  emptyPositionRoleAssignments,
  type LineupRoleAssignment,
  type PositionRoleAssignments,
} from "./lineup-rules";
import type {
  CoachParrotRoster,
  LineupAssignment,
  LineupOptimizerAlgorithm,
  Position,
} from "./types";
import { POSITION_SEQUENCE } from "./types";

const SCORE_EPSILON = 1e-9;
const LEGACY_CANDIDATE_LIMIT_PER_SPLIT = 24;
const LEGACY_PLAYER_POOL_LIMIT_PER_POSITION = 6;

type PlayerIdentity = {
  playerId: string;
  name?: string | null;
};

type PositionCandidate = {
  assignments: LineupRoleAssignment[];
  lexKey: string;
  minuteEntries: Array<[number, number]>;
  objective: number;
  position: Position;
  starterIndex: number;
  starterObjective: number;
};

type OptimizationResult = {
  assignments: LineupAssignment[];
  objective: number;
  roleAssignments: PositionRoleAssignments;
  rotationFeasible: boolean;
  starterObjective: number;
};

type PlayerOutputs = Record<string, Record<Position, number>>;
type PlayerOutputsByMinutes = Record<string, Record<number, Record<Position, number>>>;
type ExactDelta = {
  objective: number;
  starterObjective: number;
};

export const __testing = {
  buildExactPositionCandidates,
  computeCandidateDelta,
  computeOptimizationMetrics,
};

export async function optimizeLineup(args: {
  algorithm?: LineupOptimizerAlgorithm;
  playerOutputs: PlayerOutputs;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  players: CoachParrotRoster | readonly PlayerIdentity[];
}): Promise<OptimizationResult | null> {
  const algorithm = args.algorithm ?? "EXACT";
  if (algorithm === "LEGACY_HEURISTIC") {
    return optimizeLineupByOutputsLegacy({
      playerOutputs: args.playerOutputs,
      players: args.players,
    });
  }

  return optimizeLineupExactly({
    playerOutputsByMinutes: args.playerOutputsByMinutes,
    playerOutputs: args.playerOutputs,
    players: args.players,
  });
}

export function optimizeLineupByOutputsLegacy(args: {
  playerOutputs: PlayerOutputs;
  players: CoachParrotRoster | readonly PlayerIdentity[];
}): OptimizationResult | null {
  const players = normalizePlayerIdentities(args.players);
  if (
    players.length < 6 ||
    players.length * LINEUP_MAX_MINUTES_PER_PLAYER < LINEUP_TEAM_TOTAL_MINUTES
  ) {
    return null;
  }

  const playerIds = shortlistLegacyPlayerIds({
    allPlayerIds: players.map((player) => player.playerId),
    playerOutputs: args.playerOutputs,
  });
  const playerIndexById = new Map(
    playerIds.map((playerId, index) => [playerId, index]),
  );
  const candidatesByPositionAndSplit = Object.fromEntries(
    POSITION_SEQUENCE.map((position) => [
      position,
      Object.fromEntries(
        LEGAL_POSITION_MINUTE_SPLITS.map((split) => [
          split.join(","),
          buildLegacyPositionCandidates({
            playerIds,
            playerIndexById,
            playerOutputs: args.playerOutputs,
            position,
            split,
          }),
        ]),
      ),
    ]),
  ) as Record<Position, Record<string, PositionCandidate[]>>;

  type PatternCombo = {
    candidateListsByPosition: Record<Position, PositionCandidate[]>;
    lexKey: string;
    upperObjective: number;
    upperStarterObjective: number;
  };

  const patternCombos: PatternCombo[] = [];
  const comboCandidateLists = {} as Record<Position, PositionCandidate[]>;
  const comboSplitKeys: string[] = [];

  function buildPatternCombos(
    depth: number,
    upperObjective: number,
    upperStarterObjective: number,
  ) {
    if (depth === POSITION_SEQUENCE.length) {
      patternCombos.push({
        candidateListsByPosition: { ...comboCandidateLists },
        lexKey: comboSplitKeys.join("|"),
        upperObjective,
        upperStarterObjective,
      });
      return;
    }

    const position = POSITION_SEQUENCE[depth]!;
    for (const split of LEGAL_POSITION_MINUTE_SPLITS) {
      const splitKey = split.join(",");
      const candidates = candidatesByPositionAndSplit[position][splitKey] ?? [];
      if (!candidates.length) {
        continue;
      }

      comboCandidateLists[position] = candidates;
      comboSplitKeys.push(`${position}:${splitKey}`);
      buildPatternCombos(
        depth + 1,
        upperObjective + candidates[0]!.objective,
        upperStarterObjective + candidates[0]!.starterObjective,
      );
      comboSplitKeys.pop();
    }
  }

  buildPatternCombos(0, 0, 0);
  if (!patternCombos.length) {
    return null;
  }

  patternCombos.sort((left, right) => {
    if (Math.abs(right.upperObjective - left.upperObjective) > SCORE_EPSILON) {
      return right.upperObjective - left.upperObjective;
    }
    if (
      Math.abs(right.upperStarterObjective - left.upperStarterObjective) >
      SCORE_EPSILON
    ) {
      return right.upperStarterObjective - left.upperStarterObjective;
    }
    return left.lexKey.localeCompare(right.lexKey);
  });

  let best: OptimizationResult | null = null;

  function solvePatternCombo(
    candidateListsByPosition: Record<Position, PositionCandidate[]>,
    options?: {
      stopAfterFirstResult?: boolean;
    },
  ): OptimizationResult | null {
    let comboBest: OptimizationResult | null = null;
    const stopAfterFirstResult = options?.stopAfterFirstResult === true;
    const selected: PositionCandidate[] = [];
    const starterUsed = new Array(playerIds.length).fill(false);
    const minutesUsed = new Array(playerIds.length).fill(0);
    const stateMemo = new Map<
      string,
      {
        objective: number;
        starterObjective: number;
      }
    >();

    function resolveIncumbent(): OptimizationResult | null {
      if (comboBest == null) {
        return best;
      }
      if (best == null) {
        return comboBest;
      }
      return compareOptimizationResults(comboBest, best) < 0 ? comboBest : best;
    }

    function maybeAccept(selectedCandidates: PositionCandidate[]) {
      const roleAssignments = selectedCandidates.reduce((result, candidate) => {
        result[candidate.position] = candidate.assignments;
        return result;
      }, emptyPositionRoleAssignments());
      const rotationFeasible = checkRotationFeasibility(roleAssignments);
      if (!rotationFeasible) {
        return;
      }

      const assignments = selectedCandidates.flatMap((candidate) =>
        candidate.assignments.map(({ role: _role, ...assignment }) => assignment),
      );
      const objective = Number(
        selectedCandidates
          .reduce((sum, candidate) => sum + candidate.objective, 0)
          .toFixed(12),
      );
      const starterObjective = Number(
        selectedCandidates
          .reduce((sum, candidate) => sum + candidate.starterObjective, 0)
          .toFixed(12),
      );
      const candidateResult: OptimizationResult = {
        assignments,
        objective,
        roleAssignments,
        rotationFeasible,
        starterObjective,
      };

      if (
        comboBest == null ||
        compareOptimizationResults(candidateResult, comboBest) < 0
      ) {
        comboBest = candidateResult;
      }
    }

    function canApplyCandidate(candidate: PositionCandidate): boolean {
      if (starterUsed[candidate.starterIndex]) {
        return false;
      }

      for (const [playerIndex, minutes] of candidate.minuteEntries) {
        if (minutesUsed[playerIndex]! + minutes > LINEUP_MAX_MINUTES_PER_PLAYER) {
          return false;
        }
      }

      return true;
    }

    function applyCandidate(candidate: PositionCandidate, direction: 1 | -1) {
      starterUsed[candidate.starterIndex] = direction > 0;
      for (const [playerIndex, minutes] of candidate.minuteEntries) {
        minutesUsed[playerIndex] = minutesUsed[playerIndex]! + minutes * direction;
      }
    }

    function buildStateKey(depth: number): string {
      return `${depth}|${starterUsed.map((value) => (value ? "1" : "0")).join("")}|${minutesUsed.join(",")}`;
    }

    function buildOptimisticBound(
      depth: number,
      currentObjective: number,
      currentStarterObjective: number,
    ): {
      objective: number;
      starterObjective: number;
    } | null {
      let objective = currentObjective;
      let starterObjective = currentStarterObjective;

      for (
        let positionIndex = depth;
        positionIndex < POSITION_SEQUENCE.length;
        positionIndex += 1
      ) {
        const position = POSITION_SEQUENCE[positionIndex]!;
        const bestFeasible = candidateListsByPosition[position].find((candidate) =>
          canApplyCandidate(candidate),
        );
        if (!bestFeasible) {
          return null;
        }
        objective += bestFeasible.objective;
        starterObjective += bestFeasible.starterObjective;
      }

      return {
        objective,
        starterObjective,
      };
    }

    function search(
      currentObjective: number,
      currentStarterObjective: number,
      depth: number,
    ) {
      if (stopAfterFirstResult && comboBest != null) {
        return;
      }

      if (depth === POSITION_SEQUENCE.length) {
        maybeAccept(selected);
        return;
      }

      if (!stopAfterFirstResult) {
        const optimisticBound = buildOptimisticBound(
          depth,
          currentObjective,
          currentStarterObjective,
        );
        if (!optimisticBound) {
          return;
        }

        const incumbent = resolveIncumbent();
        if (
          incumbent != null &&
          optimisticBound.objective < incumbent.objective - SCORE_EPSILON
        ) {
          return;
        }
        if (
          incumbent != null &&
          Math.abs(optimisticBound.objective - incumbent.objective) <=
            SCORE_EPSILON &&
          optimisticBound.starterObjective <
            incumbent.starterObjective - SCORE_EPSILON
        ) {
          return;
        }

        const stateKey = buildStateKey(depth);
        const seen = stateMemo.get(stateKey);
        if (
          seen &&
          (currentObjective < seen.objective - SCORE_EPSILON ||
            (Math.abs(currentObjective - seen.objective) <= SCORE_EPSILON &&
              currentStarterObjective <
                seen.starterObjective - SCORE_EPSILON))
        ) {
          return;
        }
        if (
          !seen ||
          currentObjective > seen.objective + SCORE_EPSILON ||
          (Math.abs(currentObjective - seen.objective) <= SCORE_EPSILON &&
            currentStarterObjective > seen.starterObjective + SCORE_EPSILON)
        ) {
          stateMemo.set(stateKey, {
            objective: currentObjective,
            starterObjective: currentStarterObjective,
          });
        }
      }

      const position = POSITION_SEQUENCE[depth]!;
      for (const candidate of candidateListsByPosition[position]) {
        if (!canApplyCandidate(candidate)) {
          continue;
        }

        applyCandidate(candidate, 1);
        selected.push(candidate);
        search(
          currentObjective + candidate.objective,
          currentStarterObjective + candidate.starterObjective,
          depth + 1,
        );
        selected.pop();
        applyCandidate(candidate, -1);
        if (stopAfterFirstResult && comboBest != null) {
          return;
        }
      }
    }

    search(0, 0, 0);
    return comboBest;
  }

  for (const combo of patternCombos) {
    const seeded = solvePatternCombo(combo.candidateListsByPosition, {
      stopAfterFirstResult: true,
    });
    if (seeded) {
      best = seeded;
      break;
    }
  }

  for (const combo of patternCombos) {
    if (best != null && combo.upperObjective < best.objective - SCORE_EPSILON) {
      break;
    }
    if (
      best != null &&
      Math.abs(combo.upperObjective - best.objective) <= SCORE_EPSILON &&
      combo.upperStarterObjective < best.starterObjective - SCORE_EPSILON
    ) {
      continue;
    }

    const optimized = solvePatternCombo(combo.candidateListsByPosition);
    if (optimized && (best == null || compareOptimizationResults(optimized, best) < 0)) {
      best = optimized;
    }
  }

  return best;
}

async function optimizeLineupExactly(args: {
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  playerOutputs: PlayerOutputs;
  players: CoachParrotRoster | readonly PlayerIdentity[];
}): Promise<OptimizationResult | null> {
  const allPlayers = normalizePlayerIdentities(args.players).sort((left, right) =>
    left.playerId.localeCompare(right.playerId),
  );
  const shortlistedPlayerIds = shortlistExactPlayerIds({
    allPlayerIds: allPlayers.map((player) => player.playerId),
    playerOutputs: args.playerOutputs,
  });
  const players = allPlayers.filter((player) =>
    shortlistedPlayerIds.includes(player.playerId),
  );
  if (
    players.length < 6 ||
    players.length * LINEUP_MAX_MINUTES_PER_PLAYER < LINEUP_TEAM_TOTAL_MINUTES
  ) {
    return null;
  }
  const playerIds = players.map((player) => player.playerId);
  const playerIndexById = new Map(
    playerIds.map((playerId, index) => [playerId, index]),
  );
  const candidatesByPosition = Object.fromEntries(
    POSITION_SEQUENCE.map((position) => [
      position,
      buildExactPositionCandidates({
        playerIds,
        playerIndexById,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
        position,
      }),
    ]),
  ) as Record<Position, PositionCandidate[]>;

  if (
    POSITION_SEQUENCE.some(
      (position) => candidatesByPosition[position].length === 0,
    )
  ) {
    return null;
  }

  const starterUsed = new Array(players.length).fill(false);
  const playerTotals = new Array(players.length).fill(0);
  const playerMinutesByPosition = Array.from({ length: players.length }, () =>
    new Array(POSITION_SEQUENCE.length).fill(0),
  );
  const playerStarterMinutesByPosition = Array.from(
    { length: players.length },
    () => new Array(POSITION_SEQUENCE.length).fill(0),
  );
  const selected: PositionCandidate[] = [];
  const staticRemainingUpperByDepth = buildStaticRemainingUpperByDepth(
    candidatesByPosition,
  );

  let best = computeSeedResult({
      exactPlayerOutputsByMinutes: args.playerOutputsByMinutes,
      legacyPlayerOutputs: args.playerOutputs,
      players,
    }) ?? null;
  const greedySeed = buildGreedyExactSeed({
    candidatesByPosition,
    playerIds,
    playerIndexById,
    playerOutputsByMinutes: args.playerOutputsByMinutes,
  });
  if (greedySeed && (best == null || compareOptimizationResults(greedySeed, best) < 0)) {
    best = greedySeed;
  }
  const improvedSeed = improveGreedyExactSeed({
    candidatesByPosition,
    playerIds,
    playerIndexById,
    playerOutputsByMinutes: args.playerOutputsByMinutes,
    seed: best,
  });
  if (improvedSeed && (best == null || compareOptimizationResults(improvedSeed, best) < 0)) {
    best = improvedSeed;
  }
  if (players.length > 8) {
    return best;
  }

  function canApplyCandidate(candidate: PositionCandidate): boolean {
    if (starterUsed[candidate.starterIndex]) {
      return false;
    }
    for (const [playerIndex, minutes] of candidate.minuteEntries) {
      if (playerTotals[playerIndex]! + minutes > LINEUP_MAX_MINUTES_PER_PLAYER) {
        return false;
      }
    }
    return true;
  }

  function applyCandidate(candidate: PositionCandidate): void {
    mutateCandidateState({
      candidate,
      playerIndexById,
      playerStarterMinutesByPosition,
      playerTotals,
      playerMinutesByPosition,
      starterUsed,
      direction: 1,
    });
  }

  function removeCandidate(candidate: PositionCandidate): void {
    mutateCandidateState({
      candidate,
      playerIndexById,
      playerStarterMinutesByPosition,
      playerTotals,
      playerMinutesByPosition,
      starterUsed,
      direction: -1,
    });
  }

  function buildOptimisticBound(depth: number): ExactDelta | null {
    let objective = 0;
    let starterObjective = 0;

    for (let index = depth; index < POSITION_SEQUENCE.length; index += 1) {
      const position = POSITION_SEQUENCE[index]!;
      const bestCandidate = findBestOptimisticCandidate({
        candidates: candidatesByPosition[position],
        playerIndexById,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
        playerStarterMinutesByPosition,
        playerTotals,
        playerMinutesByPosition,
        starterUsed,
      });
      if (!bestCandidate) {
        return null;
      }
      objective += bestCandidate.objective;
      starterObjective += bestCandidate.starterObjective;
    }

    return {
      objective: Number(objective.toFixed(12)),
      starterObjective: Number(starterObjective.toFixed(12)),
    };
  }

  function search(
    depth: number,
    currentObjective: number,
    currentStarterObjective: number,
  ) {
    if (depth === POSITION_SEQUENCE.length) {
      const roleAssignments = selected.reduce((result, candidate) => {
        result[candidate.position] = candidate.assignments;
        return result;
      }, emptyPositionRoleAssignments());
      if (!checkRotationFeasibility(roleAssignments)) {
        return;
      }

      const assignments = selected.flatMap((candidate) =>
        candidate.assignments.map(({ role: _role, ...assignment }) => assignment),
      );
      const candidateResult: OptimizationResult = {
        assignments,
        objective: Number(currentObjective.toFixed(12)),
        roleAssignments,
        rotationFeasible: true,
        starterObjective: Number(currentStarterObjective.toFixed(12)),
      };
      if (best == null || compareOptimizationResults(candidateResult, best) < 0) {
        best = candidateResult;
      }
      return;
    }

    const optimisticBound = buildOptimisticBound(depth);
    if (!optimisticBound) {
      return;
    }

    if (
      best != null &&
      currentObjective + optimisticBound.objective < best.objective - SCORE_EPSILON
    ) {
      return;
    }
    if (
      best != null &&
      Math.abs(currentObjective + optimisticBound.objective - best.objective) <=
        SCORE_EPSILON &&
      currentStarterObjective + optimisticBound.starterObjective <
        best.starterObjective - SCORE_EPSILON
    ) {
      return;
    }

    const position = POSITION_SEQUENCE[depth]!;
    const remainingStaticUpper = staticRemainingUpperByDepth[depth + 1]!;
    for (const candidate of candidatesByPosition[position]) {
      if (
        best != null &&
        currentObjective + candidate.objective + remainingStaticUpper.objective <
          best.objective - SCORE_EPSILON
      ) {
        break;
      }
      if (
        best != null &&
        Math.abs(
          currentObjective +
            candidate.objective +
            remainingStaticUpper.objective -
            best.objective,
        ) <= SCORE_EPSILON &&
        currentStarterObjective +
          candidate.starterObjective +
          remainingStaticUpper.starterObjective <
          best.starterObjective - SCORE_EPSILON
      ) {
        break;
      }
      if (!canApplyCandidate(candidate)) {
        continue;
      }

      const delta = computeCandidateDelta({
        candidate,
        playerIndexById,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
        playerStarterMinutesByPosition,
        playerTotals,
        playerMinutesByPosition,
        direction: 1,
      });
      applyCandidate(candidate);
      selected.push(candidate);
      search(
        depth + 1,
        currentObjective + delta.objective,
        currentStarterObjective + delta.starterObjective,
      );
      selected.pop();
      removeCandidate(candidate);
    }
  }

  search(0, 0, 0);
  return best;
}

function buildStaticRemainingUpperByDepth(
  candidatesByPosition: Record<Position, PositionCandidate[]>,
): ExactDelta[] {
  const result = Array.from({ length: POSITION_SEQUENCE.length + 1 }, () => ({
    objective: 0,
    starterObjective: 0,
  }));
  for (let depth = POSITION_SEQUENCE.length - 1; depth >= 0; depth -= 1) {
    const position = POSITION_SEQUENCE[depth]!;
    const bestCandidate = candidatesByPosition[position][0];
    result[depth] = {
      objective:
        (result[depth + 1]?.objective ?? 0) + (bestCandidate?.objective ?? 0),
      starterObjective:
        (result[depth + 1]?.starterObjective ?? 0) +
        (bestCandidate?.starterObjective ?? 0),
    };
  }
  return result;
}

function buildExactPositionCandidates(args: {
  playerIds: string[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  position: Position;
}): PositionCandidate[] {
  const candidates = LEGAL_POSITION_MINUTE_SPLITS.flatMap((split) =>
    buildExactCandidatesForSplit({
      ...args,
      split,
    }),
  );
  candidates.sort(compareCandidates);
  return candidates;
}

function buildExactCandidatesForSplit(args: {
  playerIds: string[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  position: Position;
  split: readonly number[];
}): PositionCandidate[] {
  const candidates: PositionCandidate[] = [];
  const starterMinutes = args.split[0]!;

  for (const starterId of args.playerIds) {
    if (args.split.length === 2) {
      for (const backupId of args.playerIds) {
        if (backupId === starterId) {
          continue;
        }
        candidates.push(
          createExactPositionCandidate({
            assignments: [
              {
                minutes: starterMinutes,
                playerId: starterId,
                position: args.position,
                role: "starter",
              },
              {
                minutes: args.split[1]!,
                playerId: backupId,
                position: args.position,
                role: "backup",
              },
            ],
            playerIndexById: args.playerIndexById,
            playerOutputsByMinutes: args.playerOutputsByMinutes,
            position: args.position,
          }),
        );
      }
      continue;
    }

    for (const backupId of args.playerIds) {
      if (backupId === starterId) {
        continue;
      }
      for (const reserveId of args.playerIds) {
        if (reserveId === starterId || reserveId === backupId) {
          continue;
        }
        candidates.push(
          createExactPositionCandidate({
            assignments: [
              {
                minutes: starterMinutes,
                playerId: starterId,
                position: args.position,
                role: "starter",
              },
              {
                minutes: args.split[1]!,
                playerId: backupId,
                position: args.position,
                role: "backup",
              },
              {
                minutes: args.split[2]!,
                playerId: reserveId,
                position: args.position,
                role: "reserve",
              },
            ],
            playerIndexById: args.playerIndexById,
            playerOutputsByMinutes: args.playerOutputsByMinutes,
            position: args.position,
          }),
        );
      }
    }
  }

  return candidates;
}

function createExactPositionCandidate(args: {
  assignments: LineupRoleAssignment[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  position: Position;
}): PositionCandidate {
  const minuteEntries = args.assignments.map((assignment) => {
    const playerIndex = args.playerIndexById.get(assignment.playerId);
    if (playerIndex == null) {
      throw new Error(`Unknown player index for ${assignment.playerId}.`);
    }
    return [playerIndex, assignment.minutes] as [number, number];
  });
  const objective = Number(
    args.assignments
      .reduce((sum, assignment) => {
        const output =
          args.playerOutputsByMinutes[assignment.playerId]?.[assignment.minutes]?.[
            args.position
          ] ?? 0;
        return sum + output * (assignment.minutes / LINEUP_MINUTES_PER_POSITION);
      }, 0)
      .toFixed(12),
  );
  const starter = args.assignments[0];
  if (!starter) {
    throw new Error("Position candidates must include a starter assignment.");
  }
  const starterObjective = Number(
    (
      (args.playerOutputsByMinutes[starter.playerId]?.[starter.minutes]?.[args.position] ??
        0) *
      (starter.minutes / LINEUP_MINUTES_PER_POSITION)
    ).toFixed(12),
  );

  return {
    assignments: args.assignments,
    lexKey: buildAssignmentLexKey(
      args.assignments.map(({ role: _role, ...assignment }) => assignment),
    ),
    minuteEntries,
    objective,
    position: args.position,
    starterIndex: minuteEntries[0]![0],
    starterObjective,
  };
}

function computeSeedResult(args: {
  exactPlayerOutputsByMinutes: PlayerOutputsByMinutes;
  legacyPlayerOutputs: PlayerOutputs;
  players: PlayerIdentity[];
}): OptimizationResult | null {
  const legacy = optimizeLineupByOutputsLegacy({
    playerOutputs: args.legacyPlayerOutputs,
    players: args.players,
  });
  if (!legacy) {
    return null;
  }
  return computeOptimizationMetrics({
    assignments: legacy.assignments,
    players: args.players,
    playerOutputsByMinutes: args.exactPlayerOutputsByMinutes,
  });
}

function buildGreedyExactSeed(args: {
  candidatesByPosition: Record<Position, PositionCandidate[]>;
  playerIds: string[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
}): OptimizationResult | null {
  const starterUsed = new Array(args.playerIds.length).fill(false);
  const playerTotals = new Array(args.playerIds.length).fill(0);
  const playerMinutesByPosition = Array.from({ length: args.playerIds.length }, () =>
    new Array(POSITION_SEQUENCE.length).fill(0),
  );
  const playerStarterMinutesByPosition = Array.from(
    { length: args.playerIds.length },
    () => new Array(POSITION_SEQUENCE.length).fill(0),
  );
  const selected: PositionCandidate[] = [];
  let objective = 0;
  let starterObjective = 0;

  for (const position of POSITION_SEQUENCE) {
    const choice = findBestOptimisticCandidateChoice({
      candidates: args.candidatesByPosition[position],
      playerIndexById: args.playerIndexById,
      playerOutputsByMinutes: args.playerOutputsByMinutes,
      playerStarterMinutesByPosition,
      playerTotals,
      playerMinutesByPosition,
      starterUsed,
    });
    if (!choice) {
      return null;
    }
    selected.push(choice.candidate);
    objective += choice.delta.objective;
    starterObjective += choice.delta.starterObjective;
    mutateCandidateState({
      candidate: choice.candidate,
      playerIndexById: args.playerIndexById,
      playerStarterMinutesByPosition,
      playerTotals,
      playerMinutesByPosition,
      starterUsed,
      direction: 1,
    });
  }

  const roleAssignments = selected.reduce((result, candidate) => {
    result[candidate.position] = candidate.assignments;
    return result;
  }, emptyPositionRoleAssignments());
  if (!checkRotationFeasibility(roleAssignments)) {
    return null;
  }

  const assignments = selected.flatMap((candidate) =>
    candidate.assignments.map(({ role: _role, ...assignment }) => assignment),
  );
  return {
    assignments,
    objective: Number(objective.toFixed(12)),
    roleAssignments,
    rotationFeasible: true,
    starterObjective: Number(starterObjective.toFixed(12)),
  };
}

function improveGreedyExactSeed(args: {
  candidatesByPosition: Record<Position, PositionCandidate[]>;
  playerIds: string[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  seed: OptimizationResult | null;
}): OptimizationResult | null {
  if (args.seed == null) {
    return null;
  }

  const selectedByPosition = Object.fromEntries(
    POSITION_SEQUENCE.map((position) => [
      position,
      matchCandidateByAssignments({
        assignments: args.seed?.roleAssignments[position] ?? [],
        candidates: args.candidatesByPosition[position],
      }),
    ]),
  ) as Record<Position, PositionCandidate | null>;

  if (POSITION_SEQUENCE.some((position) => selectedByPosition[position] == null)) {
    return args.seed;
  }

  let current = args.seed;
  let changed = true;

  while (changed) {
    changed = false;
    for (const position of POSITION_SEQUENCE) {
      const candidateToReplace = selectedByPosition[position];
      if (!candidateToReplace) {
        continue;
      }

      const starterUsed = new Array(args.playerIds.length).fill(false);
      const playerTotals = new Array(args.playerIds.length).fill(0);
      const playerMinutesByPosition = Array.from({ length: args.playerIds.length }, () =>
        new Array(POSITION_SEQUENCE.length).fill(0),
      );
      const playerStarterMinutesByPosition = Array.from(
        { length: args.playerIds.length },
        () => new Array(POSITION_SEQUENCE.length).fill(0),
      );

      for (const otherPosition of POSITION_SEQUENCE) {
        if (otherPosition === position) {
          continue;
        }
        const selected = selectedByPosition[otherPosition];
        if (!selected) {
          continue;
        }
        mutateCandidateState({
          candidate: selected,
          playerIndexById: args.playerIndexById,
          playerStarterMinutesByPosition,
          playerTotals,
          playerMinutesByPosition,
          starterUsed,
          direction: 1,
        });
      }

      const choice = findBestOptimisticCandidateChoice({
        candidates: args.candidatesByPosition[position],
        playerIndexById: args.playerIndexById,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
        playerStarterMinutesByPosition,
        playerTotals,
        playerMinutesByPosition,
        starterUsed,
      });
      if (!choice || choice.candidate.lexKey === candidateToReplace.lexKey) {
        continue;
      }

      selectedByPosition[position] = choice.candidate;
      const nextMetrics = computeOptimizationMetrics({
        assignments: POSITION_SEQUENCE.flatMap((entryPosition) =>
          (selectedByPosition[entryPosition]?.assignments ?? []).map(
            ({ role: _role, ...assignment }) => assignment,
          ),
        ),
        players: args.playerIds.map((playerId) => ({ playerId })),
        playerOutputsByMinutes: args.playerOutputsByMinutes,
      });
      if (
        nextMetrics &&
        compareOptimizationResults(nextMetrics, current) < 0
      ) {
        current = nextMetrics;
        changed = true;
      } else {
        selectedByPosition[position] = candidateToReplace;
      }
    }
  }

  return current;
}

function matchCandidateByAssignments(args: {
  assignments: readonly LineupRoleAssignment[];
  candidates: PositionCandidate[];
}): PositionCandidate | null {
  const key = buildAssignmentLexKey(
    args.assignments.map(({ role: _role, ...assignment }) => assignment),
  );
  return args.candidates.find((candidate) => candidate.lexKey === key) ?? null;
}

function computeOptimizationMetrics(args: {
  assignments: readonly LineupAssignment[];
  players: readonly PlayerIdentity[];
  playerOutputsByMinutes: PlayerOutputsByMinutes;
}): OptimizationResult | null {
  const roleAssignments = emptyPositionRoleAssignments();
  const normalizedAssignments = [...args.assignments].sort(
    (left, right) =>
      POSITION_SEQUENCE.indexOf(left.position) -
        POSITION_SEQUENCE.indexOf(right.position) ||
      right.minutes - left.minutes ||
      left.playerId.localeCompare(right.playerId),
  );

  for (const position of POSITION_SEQUENCE) {
    roleAssignments[position] = normalizedAssignments
      .filter((assignment) => assignment.position === position)
      .sort(
        (left, right) =>
          right.minutes - left.minutes || left.playerId.localeCompare(right.playerId),
      )
      .map((assignment, index) => ({
        ...assignment,
        role: index === 0 ? "starter" : index === 1 ? "backup" : "reserve",
      }));
  }

  if (!checkRotationFeasibility(roleAssignments)) {
    return null;
  }

  const playerTotals = new Map<string, number>();
  for (const assignment of normalizedAssignments) {
    playerTotals.set(
      assignment.playerId,
      (playerTotals.get(assignment.playerId) ?? 0) + assignment.minutes,
    );
  }

  const objective = Number(
    normalizedAssignments
      .reduce((sum, assignment) => {
        const totalMinutes = playerTotals.get(assignment.playerId) ?? assignment.minutes;
        const output =
          args.playerOutputsByMinutes[assignment.playerId]?.[totalMinutes]?.[
            assignment.position
          ] ?? 0;
        return sum + output * (assignment.minutes / LINEUP_MINUTES_PER_POSITION);
      }, 0)
      .toFixed(12),
  );
  const starterObjective = Number(
    POSITION_SEQUENCE.reduce((sum, position) => {
      const starter = roleAssignments[position][0];
      if (!starter) {
        return sum;
      }
      const totalMinutes = playerTotals.get(starter.playerId) ?? starter.minutes;
      const output =
        args.playerOutputsByMinutes[starter.playerId]?.[totalMinutes]?.[position] ?? 0;
      return sum + output * (starter.minutes / LINEUP_MINUTES_PER_POSITION);
    }, 0).toFixed(12),
  );

  return {
    assignments: normalizedAssignments.map(({ minutes, playerId, position }) => ({
      minutes,
      playerId,
      position,
    })),
    objective,
    roleAssignments,
    rotationFeasible: true,
    starterObjective,
  };
}

function findBestOptimisticCandidate(args: {
  candidates: PositionCandidate[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  playerStarterMinutesByPosition: number[][];
  playerTotals: number[];
  playerMinutesByPosition: number[][];
  starterUsed: boolean[];
}): ExactDelta | null {
  const choice = findBestOptimisticCandidateChoice(args);
  return choice?.delta ?? null;
}

function findBestOptimisticCandidateChoice(args: {
  candidates: PositionCandidate[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  playerStarterMinutesByPosition: number[][];
  playerTotals: number[];
  playerMinutesByPosition: number[][];
  starterUsed: boolean[];
}): { candidate: PositionCandidate; delta: ExactDelta } | null {
  let best: ExactDelta | null = null;
  let bestCandidate: PositionCandidate | null = null;

  for (const candidate of args.candidates) {
    if (best && candidate.objective < best.objective - SCORE_EPSILON) {
      break;
    }
    if (args.starterUsed[candidate.starterIndex]) {
      continue;
    }
    let canApply = true;
    for (const [playerIndex, minutes] of candidate.minuteEntries) {
      if (args.playerTotals[playerIndex]! + minutes > LINEUP_MAX_MINUTES_PER_PLAYER) {
        canApply = false;
        break;
      }
    }
    if (!canApply) {
      continue;
    }

    const delta = computeCandidateDelta({
      candidate,
      playerIndexById: args.playerIndexById,
      playerOutputsByMinutes: args.playerOutputsByMinutes,
      playerStarterMinutesByPosition: args.playerStarterMinutesByPosition,
      playerTotals: args.playerTotals,
      playerMinutesByPosition: args.playerMinutesByPosition,
      direction: 1,
    });
    if (
      best == null ||
      delta.objective > best.objective + SCORE_EPSILON ||
      (Math.abs(delta.objective - best.objective) <= SCORE_EPSILON &&
        delta.starterObjective > best.starterObjective + SCORE_EPSILON)
    ) {
      best = delta;
      bestCandidate = candidate;
    }
  }

  return best && bestCandidate
    ? {
        candidate: bestCandidate,
        delta: best,
      }
    : null;
}

function computeCandidateDelta(args: {
  candidate: PositionCandidate;
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
  playerStarterMinutesByPosition: number[][];
  playerTotals: number[];
  playerMinutesByPosition: number[][];
  direction: 1 | -1;
}): ExactDelta {
  const positionIndex = POSITION_SEQUENCE.indexOf(args.candidate.position);
  const affectedPlayers = new Map<
    number,
    {
      minutesAdded: number;
      starterMinutesAdded: number;
    }
  >();

  for (const assignment of args.candidate.assignments) {
    const playerIndex = args.playerIndexById.get(assignment.playerId);
    if (playerIndex == null) {
      continue;
    }
    const existing = affectedPlayers.get(playerIndex) ?? {
      minutesAdded: 0,
      starterMinutesAdded: 0,
    };
    existing.minutesAdded += assignment.minutes * args.direction;
    if (assignment.role === "starter") {
      existing.starterMinutesAdded += assignment.minutes * args.direction;
    }
    affectedPlayers.set(playerIndex, existing);
  }

  let objective = 0;
  let starterObjective = 0;

  for (const [playerIndex, adjustment] of Array.from(affectedPlayers.entries())) {
    const playerId = args.candidate.assignments.find(
      (assignment) => args.playerIndexById.get(assignment.playerId) === playerIndex,
    )?.playerId;
    if (playerId == null) {
      continue;
    }
    const currentTotal = args.playerTotals[playerIndex] ?? 0;
    const nextTotal = currentTotal + adjustment.minutesAdded;
    objective +=
      evaluatePlayerContribution({
        playerId,
        totalMinutes: nextTotal,
        addedMinutes: adjustment.minutesAdded,
        minutesByPosition: args.playerMinutesByPosition[playerIndex] ?? [],
        positionIndex,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
      }) -
      evaluatePlayerContribution({
        playerId,
        totalMinutes: currentTotal,
        addedMinutes: 0,
        minutesByPosition: args.playerMinutesByPosition[playerIndex] ?? [],
        positionIndex,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
      });
    starterObjective +=
      evaluatePlayerContribution({
        playerId,
        totalMinutes: nextTotal,
        addedMinutes: adjustment.starterMinutesAdded,
        minutesByPosition: args.playerStarterMinutesByPosition[playerIndex] ?? [],
        positionIndex,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
      }) -
      evaluatePlayerContribution({
        playerId,
        totalMinutes: currentTotal,
        addedMinutes: 0,
        minutesByPosition: args.playerStarterMinutesByPosition[playerIndex] ?? [],
        positionIndex,
        playerOutputsByMinutes: args.playerOutputsByMinutes,
      });
  }

  return {
    objective: Number(objective.toFixed(12)),
    starterObjective: Number(starterObjective.toFixed(12)),
  };
}

function evaluatePlayerContribution(args: {
  playerId: string;
  totalMinutes: number;
  addedMinutes: number;
  minutesByPosition: readonly number[];
  positionIndex: number;
  playerOutputsByMinutes: PlayerOutputsByMinutes;
}): number {
  if (args.totalMinutes <= 0) {
    return 0;
  }

  return POSITION_SEQUENCE.reduce((sum, position, index) => {
    const currentMinutes = args.minutesByPosition[index] ?? 0;
    const nextMinutes =
      index === args.positionIndex ? currentMinutes + args.addedMinutes : currentMinutes;
    if (nextMinutes <= 0) {
      return sum;
    }
    const output =
      args.playerOutputsByMinutes[args.playerId]?.[args.totalMinutes]?.[position] ?? 0;
    return sum + output * (nextMinutes / LINEUP_MINUTES_PER_POSITION);
  }, 0);
}

function mutateCandidateState(args: {
  candidate: PositionCandidate;
  playerIndexById: ReadonlyMap<string, number>;
  playerStarterMinutesByPosition: number[][];
  playerTotals: number[];
  playerMinutesByPosition: number[][];
  starterUsed: boolean[];
  direction: 1 | -1;
}): void {
  const positionIndex = POSITION_SEQUENCE.indexOf(args.candidate.position);
  for (const assignment of args.candidate.assignments) {
    const playerIndex = args.playerIndexById.get(assignment.playerId);
    if (playerIndex == null) {
      continue;
    }
    args.playerTotals[playerIndex] =
      (args.playerTotals[playerIndex] ?? 0) + assignment.minutes * args.direction;
    args.playerMinutesByPosition[playerIndex]![positionIndex] =
      (args.playerMinutesByPosition[playerIndex]![positionIndex] ?? 0) +
      assignment.minutes * args.direction;
    if (assignment.role === "starter") {
      args.starterUsed[playerIndex] = args.direction > 0;
      args.playerStarterMinutesByPosition[playerIndex]![positionIndex] =
        (args.playerStarterMinutesByPosition[playerIndex]![positionIndex] ?? 0) +
        assignment.minutes * args.direction;
    }
  }
}

function buildLegacyPositionCandidates(args: {
  playerIds: string[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputs: PlayerOutputs;
  position: Position;
  split: readonly number[];
}): PositionCandidate[] {
  const candidates: PositionCandidate[] = [];
  const starterMinutes = args.split[0]!;

  for (const starterId of args.playerIds) {
    if (args.split.length === 2) {
      for (const backupId of args.playerIds) {
        if (backupId === starterId) {
          continue;
        }
        candidates.push(
          createLegacyPositionCandidate({
            assignments: [
              {
                minutes: starterMinutes,
                playerId: starterId,
                position: args.position,
                role: "starter",
              },
              {
                minutes: args.split[1]!,
                playerId: backupId,
                position: args.position,
                role: "backup",
              },
            ],
            playerIndexById: args.playerIndexById,
            playerOutputs: args.playerOutputs,
            position: args.position,
          }),
        );
      }
      continue;
    }

    for (const backupId of args.playerIds) {
      if (backupId === starterId) {
        continue;
      }
      for (const reserveId of args.playerIds) {
        if (reserveId === starterId || reserveId === backupId) {
          continue;
        }
        candidates.push(
          createLegacyPositionCandidate({
            assignments: [
              {
                minutes: starterMinutes,
                playerId: starterId,
                position: args.position,
                role: "starter",
              },
              {
                minutes: args.split[1]!,
                playerId: backupId,
                position: args.position,
                role: "backup",
              },
              {
                minutes: args.split[2]!,
                playerId: reserveId,
                position: args.position,
                role: "reserve",
              },
            ],
            playerIndexById: args.playerIndexById,
            playerOutputs: args.playerOutputs,
            position: args.position,
          }),
        );
      }
    }
  }

  return candidates
    .sort(compareCandidates)
    .slice(0, LEGACY_CANDIDATE_LIMIT_PER_SPLIT);
}

function createLegacyPositionCandidate(args: {
  assignments: LineupRoleAssignment[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputs: PlayerOutputs;
  position: Position;
}): PositionCandidate {
  const minuteEntries = args.assignments.map((assignment) => {
    const playerIndex = args.playerIndexById.get(assignment.playerId);
    if (playerIndex == null) {
      throw new Error(`Unknown player index for ${assignment.playerId}.`);
    }
    return [playerIndex, assignment.minutes] as [number, number];
  });
  const objective = Number(
    args.assignments
      .reduce((sum, assignment) => {
        const output = args.playerOutputs[assignment.playerId]?.[args.position] ?? 0;
        return sum + output * (assignment.minutes / LINEUP_MINUTES_PER_POSITION);
      }, 0)
      .toFixed(12),
  );
  const starter = args.assignments[0];
  if (!starter) {
    throw new Error("Position candidates must include a starter assignment.");
  }
  const starterObjective = Number(
    (
      (args.playerOutputs[starter.playerId]?.[args.position] ?? 0) *
      (starter.minutes / LINEUP_MINUTES_PER_POSITION)
    ).toFixed(12),
  );

  return {
    assignments: args.assignments,
    lexKey: buildAssignmentLexKey(
      args.assignments.map(({ role: _role, ...assignment }) => assignment),
    ),
    minuteEntries,
    objective,
    position: args.position,
    starterIndex: minuteEntries[0]![0],
    starterObjective,
  };
}

function compareCandidates(left: PositionCandidate, right: PositionCandidate): number {
  if (Math.abs(right.objective - left.objective) > SCORE_EPSILON) {
    return right.objective - left.objective;
  }
  if (Math.abs(right.starterObjective - left.starterObjective) > SCORE_EPSILON) {
    return right.starterObjective - left.starterObjective;
  }
  return left.lexKey.localeCompare(right.lexKey);
}

function compareOptimizationResults(
  left: OptimizationResult,
  right: OptimizationResult,
): number {
  if (left.objective > right.objective + SCORE_EPSILON) {
    return -1;
  }
  if (right.objective > left.objective + SCORE_EPSILON) {
    return 1;
  }
  if (left.starterObjective > right.starterObjective + SCORE_EPSILON) {
    return -1;
  }
  if (right.starterObjective > left.starterObjective + SCORE_EPSILON) {
    return 1;
  }
  return buildAssignmentLexKey(left.assignments).localeCompare(
    buildAssignmentLexKey(right.assignments),
  );
}

function buildAssignmentLexKey(assignments: readonly LineupAssignment[]): string {
  const positionRank = new Map(
    POSITION_SEQUENCE.map((position, index) => [position, index]),
  );
  return [...assignments]
    .sort(
      (left, right) =>
        (positionRank.get(left.position) ?? 0) -
          (positionRank.get(right.position) ?? 0) ||
        left.playerId.localeCompare(right.playerId) ||
        left.minutes - right.minutes,
    )
    .map((assignment) => `${assignment.position}:${assignment.playerId}:${assignment.minutes}`)
    .join("|");
}

function shortlistLegacyPlayerIds(args: {
  allPlayerIds: string[];
  playerOutputs: PlayerOutputs;
}): string[] {
  const shortlisted = new Set<string>();

  for (const position of POSITION_SEQUENCE) {
    const rankedIds = [...args.allPlayerIds].sort(
      (left, right) =>
        (args.playerOutputs[right]?.[position] ?? 0) -
          (args.playerOutputs[left]?.[position] ?? 0) ||
        left.localeCompare(right),
    );
    for (const playerId of rankedIds.slice(0, LEGACY_PLAYER_POOL_LIMIT_PER_POSITION)) {
      shortlisted.add(playerId);
    }
  }

  if (shortlisted.size < 6) {
    const overallRankedIds = [...args.allPlayerIds].sort(
      (left, right) =>
        POSITION_SEQUENCE.reduce(
          (sum, position) => sum + (args.playerOutputs[right]?.[position] ?? 0),
          0,
        ) -
          POSITION_SEQUENCE.reduce(
            (sum, position) => sum + (args.playerOutputs[left]?.[position] ?? 0),
            0,
          ) ||
        left.localeCompare(right),
    );
    for (const playerId of overallRankedIds) {
      shortlisted.add(playerId);
      if (shortlisted.size >= 6) {
        break;
      }
    }
  }

  return Array.from(shortlisted).sort();
}

function shortlistExactPlayerIds(args: {
  allPlayerIds: string[];
  playerOutputs: PlayerOutputs;
}): string[] {
  const shortlisted = new Set<string>();

  for (const position of POSITION_SEQUENCE) {
    const rankedIds = [...args.allPlayerIds].sort(
      (left, right) =>
        (args.playerOutputs[right]?.[position] ?? 0) -
          (args.playerOutputs[left]?.[position] ?? 0) ||
        left.localeCompare(right),
    );
    for (const playerId of rankedIds.slice(0, 3)) {
      shortlisted.add(playerId);
    }
  }

  const overallRankedIds = [...args.allPlayerIds].sort(
    (left, right) =>
      POSITION_SEQUENCE.reduce(
        (sum, position) => sum + (args.playerOutputs[right]?.[position] ?? 0),
        0,
      ) -
        POSITION_SEQUENCE.reduce(
          (sum, position) => sum + (args.playerOutputs[left]?.[position] ?? 0),
          0,
        ) ||
      left.localeCompare(right),
  );
  for (const playerId of overallRankedIds) {
    shortlisted.add(playerId);
    if (shortlisted.size >= 10) {
      break;
    }
  }

  return Array.from(shortlisted).sort();
}

function normalizePlayerIdentities(
  players: CoachParrotRoster | readonly PlayerIdentity[],
): PlayerIdentity[] {
  if ("players" in players) {
    return players.players.map((player) => ({
      playerId: player.playerId,
      name: player.name,
    }));
  }
  return [...players].map((player) => ({
    playerId: player.playerId,
    name: player.name ?? player.playerId,
  }));
}
