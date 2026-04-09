import type {
  LineupHelperAssignment,
  LineupHelperContext,
  LineupHelperRosterPlayer,
  PositionCode,
} from "@/app/types";
import {
  LINEUP_ALLOWED_MINUTES,
  LINEUP_MAX_MINUTES_PER_PLAYER,
  LINEUP_MINUTE_INCREMENT,
  LINEUP_TEAM_TOTAL_MINUTES,
  LINEUP_MINUTES_PER_POSITION,
  POSITION_SEQUENCE,
  type LineupRole,
  validateOptimizedLineup,
} from "@/lib/coach-parrot";

export const LINEUP_POSITIONS: PositionCode[] = [...POSITION_SEQUENCE] as PositionCode[];
export const LINEUP_MINUTE_OPTIONS = [...LINEUP_ALLOWED_MINUTES];

export type LineupMinuteMatrix = Record<string, Record<PositionCode, number>>;

export type LineupValidation = {
  playerTotals: Record<string, number>;
  positionTotals: Record<PositionCode, number>;
  roleAssignments: Record<
    PositionCode,
    Array<{
      playerId: string;
      position: PositionCode;
      minutes: number;
      role: LineupRole;
    }>
  >;
  rolesByPlayerPosition: Record<
    string,
    Partial<Record<PositionCode, LineupRole>>
  >;
  rotationFeasible: boolean;
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
  const report = validateOptimizedLineup({
    lineup: assignmentsFromMatrix(matrix).map((assignment) => ({
      ...assignment,
      position: assignment.position,
    })),
    players: players
      .filter((player) => player.available)
      .map((player) => ({
        playerId: player.playerId,
        name: player.fullName,
      })),
  });

  return {
    playerTotals: report.playerTotals,
    positionTotals: report.positionTotals as Record<PositionCode, number>,
    roleAssignments: report.roleAssignments as LineupValidation["roleAssignments"],
    rolesByPlayerPosition:
      report.rolesByPlayerPosition as LineupValidation["rolesByPlayerPosition"],
    rotationFeasible: report.rotationFeasible,
    teamTotal: report.teamTotal,
    errors: report.errors,
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

export function lineupRuleSummary(): string {
  return `Use ${LINEUP_MINUTE_INCREMENT}-minute increments, cap every player at ${LINEUP_MAX_MINUTES_PER_PLAYER} minutes, and fill ${LINEUP_MINUTES_PER_POSITION} minutes at each position for ${LINEUP_TEAM_TOTAL_MINUTES} team minutes.`;
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
