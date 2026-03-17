import type {
  LineupHelperAssignment,
  LineupHelperContext,
  LineupHelperRosterPlayer,
  PositionCode,
} from "@/app/types";

export const LINEUP_POSITIONS: PositionCode[] = ["PG", "SG", "SF", "PF", "C"];

export type LineupMinuteMatrix = Record<string, Record<PositionCode, number>>;

export type LineupValidation = {
  playerTotals: Record<string, number>;
  positionTotals: Record<PositionCode, number>;
  teamTotal: number;
  errors: string[];
};

export function emptyMinuteMatrix(
  players: LineupHelperRosterPlayer[],
): LineupMinuteMatrix {
  return Object.fromEntries(
    players.map((player) => [
      player.playerId,
      createEmptyMinuteRow(),
    ]),
  ) as LineupMinuteMatrix;
}

export function assignmentMatrixFromLineup(
  players: LineupHelperRosterPlayer[],
  assignments: LineupHelperAssignment[],
): LineupMinuteMatrix {
  const matrix = emptyMinuteMatrix(players);
  for (const assignment of assignments) {
    const row = matrix[assignment.playerId];
    if (!row) {
      continue;
    }
    row[assignment.position] = coerceMinuteValue(assignment.minutes);
  }
  return matrix;
}

export function assignmentsFromMatrix(
  matrix: LineupMinuteMatrix,
): LineupHelperAssignment[] {
  return Object.entries(matrix).flatMap(([playerId, positions]) =>
    LINEUP_POSITIONS.flatMap((position) => {
      const minutes = coerceMinuteValue(positions[position]);
      return minutes > 0
        ? [
            {
              playerId,
              position,
              minutes,
            },
          ]
        : [];
    }),
  );
}

export function validateLineupMatrix(
  players: LineupHelperRosterPlayer[],
  matrix: LineupMinuteMatrix,
): LineupValidation {
  const playerTotals = Object.fromEntries(
    players.map((player) => [
      player.playerId,
      LINEUP_POSITIONS.reduce(
        (sum, position) =>
          sum +
          coerceMinuteValue(
            (matrix[player.playerId] ?? createEmptyMinuteRow())[position],
          ),
        0,
      ),
    ]),
  ) as Record<string, number>;

  const positionTotals = Object.fromEntries(
    LINEUP_POSITIONS.map((position) => [
      position,
      players.reduce(
        (sum, player) =>
          sum +
          coerceMinuteValue(
            (matrix[player.playerId] ?? createEmptyMinuteRow())[position],
          ),
        0,
      ),
    ]),
  ) as Record<PositionCode, number>;

  const teamTotal = Object.values(playerTotals).reduce(
    (sum, minutes) => sum + minutes,
    0,
  );
  const errors: string[] = [];

  for (const [playerId, total] of Object.entries(playerTotals)) {
    const player = players.find((entry) => entry.playerId === playerId);
    if (total > 48) {
      errors.push(`${player?.fullName ?? playerId} exceeds 48 total minutes.`);
    }
  }

  for (const position of LINEUP_POSITIONS) {
    if (positionTotals[position] !== 48) {
      errors.push(`${position} must total 48 minutes.`);
    }
  }

  if (teamTotal !== 240) {
    errors.push("The lineup must total 240 team minutes.");
  }

  return {
    playerTotals,
    positionTotals,
    teamTotal,
    errors,
  };
}

export function coerceMinuteValue(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.round(numeric));
}

export function normalizeHelperContext(
  context: Partial<LineupHelperContext>,
): LineupHelperContext {
  return {
    offense: context.offense ?? "Base Offense",
    defense: context.defense ?? "Man to man",
    enthusiasm: coerceEnthusiasm(context.enthusiasm),
    homeCourt:
      context.homeCourt === "Home Court" ? "Home Court" : "Away or Neutral",
  };
}

export function coerceEnthusiasm(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.min(15, Math.max(1, Math.round(numeric)));
}

export function createEmptyMinuteRow(): Record<PositionCode, number> {
  return Object.fromEntries(
    LINEUP_POSITIONS.map((position) => [position, 0]),
  ) as Record<PositionCode, number>;
}
