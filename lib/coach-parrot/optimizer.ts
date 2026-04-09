import type { CoachParrotRoster, LineupAssignment, Position } from "./types";
import { POSITION_SEQUENCE } from "./types";

export const LINEUP_MAX_MINUTES_PER_PLAYER = 42;
export const LINEUP_MINUTES_PER_POSITION = 48;
export const LINEUP_MINUTE_INCREMENT = 6;
export const LINEUP_TEAM_TOTAL_MINUTES =
  LINEUP_MINUTES_PER_POSITION * POSITION_SEQUENCE.length;
export const LINEUP_ALLOWED_MINUTES = [
  0,
  6,
  12,
  18,
  24,
  30,
  36,
  42,
] as const;
export const LEGAL_POSITION_MINUTE_SPLITS = [
  [42, 6],
  [36, 12],
  [30, 18],
  [30, 12, 6],
  [24, 18, 6],
] as const;

const LINEUP_ALLOWED_MINUTE_SET = new Set<number>(LINEUP_ALLOWED_MINUTES);
const LEGAL_POSITION_SPLIT_SET = new Set<string>(
  LEGAL_POSITION_MINUTE_SPLITS.map((split) => split.join(",")),
);
const OPTIMIZER_CANDIDATE_LIMIT_PER_SPLIT = 24;
const OPTIMIZER_PLAYER_POOL_LIMIT_PER_POSITION = 6;
const SCORE_EPSILON = 1e-9;

type PlayerIdentity = {
  playerId: string;
  name?: string | null;
};

export type LineupRole = "starter" | "backup" | "reserve";

export type LineupRoleAssignment = LineupAssignment & {
  role: LineupRole;
};

export type PositionRoleAssignments = Record<Position, LineupRoleAssignment[]>;

export type LineupLegalityReport = {
  playerTotals: Record<string, number>;
  positionTotals: Record<Position, number>;
  teamTotal: number;
  errors: string[];
  roleAssignments: PositionRoleAssignments;
  rolesByPlayerPosition: Record<string, Partial<Record<Position, LineupRole>>>;
  rotationFeasible: boolean;
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

export function normalizeLineupAssignments(
  assignments: readonly LineupAssignment[],
): LineupAssignment[] {
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

export function emptyPositionRoleAssignments(): PositionRoleAssignments {
  return {
    PG: [],
    SG: [],
    SF: [],
    PF: [],
    C: [],
  };
}

export function optimizeLineupByOutputs(args: {
  playerOutputs: Record<string, Record<Position, number>>;
  players: CoachParrotRoster | readonly PlayerIdentity[];
}): OptimizationResult | null {
  const players = normalizePlayerIdentities(args.players);
  if (
    players.length < 6 ||
    players.length * LINEUP_MAX_MINUTES_PER_PLAYER < LINEUP_TEAM_TOTAL_MINUTES
  ) {
    return null;
  }

  const playerIds = shortlistOptimizerPlayerIds({
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
          buildPositionCandidates({
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

export function validateOptimizedLineup(args: {
  lineup: readonly LineupAssignment[];
  players: CoachParrotRoster | readonly PlayerIdentity[];
}): LineupLegalityReport {
  const players = normalizePlayerIdentities(args.players);
  const playerNameLookup = new Map(
    players.map((player) => [player.playerId, player.name ?? player.playerId]),
  );
  const knownPlayerIds = new Set(players.map((player) => player.playerId));
  const normalized = normalizeLineupAssignments(args.lineup);
  const playerTotals = Object.fromEntries(
    players.map((player) => [player.playerId, 0]),
  ) as Record<string, number>;
  const positionTotals = Object.fromEntries(
    POSITION_SEQUENCE.map((position) => [position, 0]),
  ) as Record<Position, number>;
  const rolesByPlayerPosition: Record<
    string,
    Partial<Record<Position, LineupRole>>
  > = Object.fromEntries(
    players.map((player) => [player.playerId, {}]),
  ) as Record<string, Partial<Record<Position, LineupRole>>>;
  const roleAssignments = emptyPositionRoleAssignments();
  const errors: string[] = [];

  for (const assignment of normalized) {
    if (!knownPlayerIds.has(assignment.playerId)) {
      errors.push(
        `${assignment.playerId} is assigned minutes but is not available in the current roster.`,
      );
    }

    if (!LINEUP_ALLOWED_MINUTE_SET.has(assignment.minutes)) {
      errors.push(
        `${resolvePlayerName(assignment.playerId, playerNameLookup)} has illegal ${assignment.position} minutes. Use 6-minute increments up to 42.`,
      );
    }

    if (knownPlayerIds.has(assignment.playerId)) {
      playerTotals[assignment.playerId] =
        (playerTotals[assignment.playerId] ?? 0) + assignment.minutes;
    }
    positionTotals[assignment.position] += assignment.minutes;
  }

  for (const [playerId, totalMinutes] of Object.entries(playerTotals)) {
    if (totalMinutes > LINEUP_MAX_MINUTES_PER_PLAYER) {
      errors.push(
        `${resolvePlayerName(playerId, playerNameLookup)} exceeds 42 total minutes.`,
      );
    }
  }

  const starterIds: string[] = [];
  for (const position of POSITION_SEQUENCE) {
    const assignmentsAtPosition = normalized
      .filter((assignment) => assignment.position === position)
      .sort(
        (left, right) =>
          right.minutes - left.minutes ||
          left.playerId.localeCompare(right.playerId),
      );

    if (positionTotals[position] !== LINEUP_MINUTES_PER_POSITION) {
      errors.push(`${position} must total 48 minutes.`);
      continue;
    }

    const splitKey = assignmentsAtPosition.map((assignment) => assignment.minutes).join(",");
    if (!LEGAL_POSITION_SPLIT_SET.has(splitKey)) {
      errors.push(
        `${position} must use one of the legal minute splits: 42/6, 36/12, 30/18, 30/12/6, or 24/18/6.`,
      );
      continue;
    }

    const nextRoleAssignments = assignmentsAtPosition.map((assignment, index) => ({
      ...assignment,
      role: (index === 0 ? "starter" : index === 1 ? "backup" : "reserve") as LineupRole,
    }));
    const starter = nextRoleAssignments[0];
    if (!starter) {
      errors.push(`${position} must include a starter.`);
      continue;
    }
    roleAssignments[position] = nextRoleAssignments;
    starterIds.push(starter.playerId);

    for (const assignment of nextRoleAssignments) {
      let playerRoles = rolesByPlayerPosition[assignment.playerId];
      if (!playerRoles) {
        playerRoles = {};
        rolesByPlayerPosition[assignment.playerId] = playerRoles;
      }
      playerRoles[position] = assignment.role;
    }
  }

  if (new Set(starterIds).size !== starterIds.length) {
    errors.push("A player cannot start at multiple positions.");
  }

  const teamTotal = Object.values(positionTotals).reduce(
    (sum, minutes) => sum + minutes,
    0,
  );
  if (teamTotal !== LINEUP_TEAM_TOTAL_MINUTES) {
    errors.push("The lineup must total 240 team minutes.");
  }

  const rotationFeasible =
    errors.length === 0 ? checkRotationFeasibility(roleAssignments) : false;
  if (errors.length === 0 && !rotationFeasible) {
    errors.push("The lineup cannot be scheduled as a legal 6-minute rotation.");
  }

  return {
    playerTotals,
    positionTotals,
    teamTotal,
    errors: dedupeErrors(errors),
    roleAssignments,
    rolesByPlayerPosition,
    rotationFeasible,
  };
}

export function checkRotationFeasibility(
  roleAssignments: PositionRoleAssignments,
): boolean {
  const initialState = POSITION_SEQUENCE.map((position) =>
    roleAssignments[position]
      .filter((assignment) => assignment.minutes > 0)
      .map((assignment) => ({
        playerId: assignment.playerId,
        units: assignment.minutes / LINEUP_MINUTE_INCREMENT,
      }))
      .sort((left, right) => left.playerId.localeCompare(right.playerId)),
  );
  const memo = new Map<string, boolean>();

  function stateKey() {
    return initialState.map((entries, index) => {
      const units = entries
        .map((entry) => `${entry.playerId}:${entry.units}`)
        .join(",");
      const position = POSITION_SEQUENCE[index]!;
      return `${position}:${units}`;
    }).join("|");
  }

  function search(): boolean {
    const key = stateKey();
    if (memo.has(key)) {
      return memo.get(key) ?? false;
    }

    if (
      initialState.every((entries) => entries.every((entry) => entry.units === 0))
    ) {
      memo.set(key, true);
      return true;
    }

    const optionsByPosition = initialState.map((entries, index) => ({
      options: entries
        .filter((entry) => entry.units > 0)
        .map((entry) => entry.playerId)
        .sort(),
      position: POSITION_SEQUENCE[index]!,
    })).sort((left, right) => left.options.length - right.options.length);

    if (optionsByPosition.some((entry) => entry.options.length === 0)) {
      memo.set(key, false);
      return false;
    }

    const picks = new Map<Position, string>();
    const usedPlayers = new Set<string>();

    function assignTick(optionIndex: number): boolean {
      if (optionIndex === optionsByPosition.length) {
        const decrementedIndexes: Array<[number, number]> = [];
        for (const [position, playerId] of Array.from(picks.entries())) {
          const positionIndex = POSITION_SEQUENCE.indexOf(position);
          if (positionIndex < 0) {
            return false;
          }
          const positionEntries = initialState[positionIndex];
          if (!positionEntries) {
            return false;
          }
          const playerIndex = positionEntries.findIndex(
            (entry) => entry.playerId === playerId,
          );
          if (playerIndex < 0) {
            return false;
          }
          const playerEntry = positionEntries[playerIndex];
          if (!playerEntry) {
            return false;
          }
          playerEntry.units -= 1;
          decrementedIndexes.push([positionIndex, playerIndex]);
        }

        const feasible = search();

        for (const [positionIndex, playerIndex] of decrementedIndexes) {
          const positionEntries = initialState[positionIndex];
          const playerEntry = positionEntries?.[playerIndex];
          if (playerEntry) {
            playerEntry.units += 1;
          }
        }
        return feasible;
      }

      const nextOptions = optionsByPosition[optionIndex];
      if (!nextOptions) {
        return false;
      }
      const { options, position } = nextOptions;
      for (const playerId of options) {
        if (usedPlayers.has(playerId)) {
          continue;
        }
        usedPlayers.add(playerId);
        picks.set(position, playerId);
        if (assignTick(optionIndex + 1)) {
          return true;
        }
        picks.delete(position);
        usedPlayers.delete(playerId);
      }

      return false;
    }

    const feasible = assignTick(0);
    memo.set(key, feasible);
    return feasible;
  }

  return search();
}

function buildPositionCandidates(args: {
  playerIds: string[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputs: Record<string, Record<Position, number>>;
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
          createPositionCandidate({
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
          createPositionCandidate({
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
    .slice(0, OPTIMIZER_CANDIDATE_LIMIT_PER_SPLIT);
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

function createPositionCandidate(args: {
  assignments: LineupRoleAssignment[];
  playerIndexById: ReadonlyMap<string, number>;
  playerOutputs: Record<string, Record<Position, number>>;
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

function dedupeErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
}

function shortlistOptimizerPlayerIds(args: {
  allPlayerIds: string[];
  playerOutputs: Record<string, Record<Position, number>>;
}): string[] {
  const shortlisted = new Set<string>();

  for (const position of POSITION_SEQUENCE) {
    const rankedIds = [...args.allPlayerIds].sort(
      (left, right) =>
        (args.playerOutputs[right]?.[position] ?? 0) -
          (args.playerOutputs[left]?.[position] ?? 0) ||
        left.localeCompare(right),
    );
    for (const playerId of rankedIds.slice(0, OPTIMIZER_PLAYER_POOL_LIMIT_PER_POSITION)) {
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

function resolvePlayerName(
  playerId: string,
  playerNameLookup: Map<string, string>,
): string {
  return playerNameLookup.get(playerId) ?? playerId;
}
