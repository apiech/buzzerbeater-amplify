import type {
  CoachParrotRoster,
  DefensiveSwitch,
  LineupAssignment,
  Position,
} from "./types";
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

export const IDENTITY_DEFENSIVE_SWITCH: DefensiveSwitch = {
  PG: "PG",
  SG: "SG",
  SF: "SF",
  PF: "PF",
  C: "C",
};

export function createIdentityDefensiveSwitch(): DefensiveSwitch {
  return { ...IDENTITY_DEFENSIVE_SWITCH };
}

export function normalizeDefensiveSwitch(
  value: Partial<Record<string, unknown>> | null | undefined,
): DefensiveSwitch {
  const normalized = createIdentityDefensiveSwitch();
  for (const position of POSITION_SEQUENCE) {
    const rawValue = value?.[position] ?? value?.[position.toLowerCase()];
    const candidate =
      typeof rawValue === "string" ? rawValue.toUpperCase() : undefined;
    if (candidate && POSITION_SEQUENCE.includes(candidate as Position)) {
      normalized[position] = candidate as Position;
    }
  }
  return normalized;
}

export function validateDefensiveSwitch(
  defensiveSwitch: DefensiveSwitch,
): string[] {
  const values = POSITION_SEQUENCE.map((position) => defensiveSwitch[position]);
  if (values.some((value) => !POSITION_SEQUENCE.includes(value))) {
    return [
      "Defensive switch must map every offensive position onto a valid defensive position.",
    ];
  }
  if (new Set(values).size !== POSITION_SEQUENCE.length) {
    return [
      "Defensive switch must be a one-to-one mapping across PG, SG, SF, PF, and C.",
    ];
  }
  return [];
}

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
    return initialState
      .map((entries, index) => {
        const units = entries
          .map((entry) => `${entry.playerId}:${entry.units}`)
          .join(",");
        const position = POSITION_SEQUENCE[index]!;
        return `${position}:${units}`;
      })
      .join("|");
  }

  function search(): boolean {
    const key = stateKey();
    const memoized = memo.get(key);
    if (memoized !== undefined) {
      return memoized;
    }

    if (
      initialState.every((entries) => entries.every((entry) => entry.units === 0))
    ) {
      memo.set(key, true);
      return true;
    }

    const optionsByPosition = initialState
      .map((entries, index) => ({
        options: entries
          .filter((entry) => entry.units > 0)
          .map((entry) => entry.playerId)
          .sort(),
        position: POSITION_SEQUENCE[index]!,
      }))
      .sort((left, right) => left.options.length - right.options.length);

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

function dedupeErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
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
