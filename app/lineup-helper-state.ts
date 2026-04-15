import type {
  DecodedLineupHelperAssignment,
  DecodedLineupHelperContext,
  LineupHelperRosterPlayer,
  PositionCode,
} from "@/app/types";
import {
  LINEUP_MAX_MINUTES_PER_PLAYER,
  LINEUP_MINUTE_INCREMENT,
  LINEUP_MINUTES_PER_POSITION,
  LINEUP_TEAM_TOTAL_MINUTES,
  normalizeDefensiveSwitch,
  validateDefensiveSwitch,
  validateOptimizedLineup,
  type LineupRole,
} from "@/lib/coach-parrot/lineup-rules";
import type { DefensiveSwitch } from "@/lib/coach-parrot/types";
import { POSITION_SEQUENCE } from "@/lib/coach-parrot/types";

export const LINEUP_POSITIONS: PositionCode[] = [
  ...POSITION_SEQUENCE,
] as PositionCode[];
export const LINEUP_POSITION_LABELS: Record<PositionCode, string> = {
  PG: "Point guard",
  SG: "Shooting guard",
  SF: "Small forward",
  PF: "Power forward",
  C: "Center",
};
export const LINEUP_ROLE_SEQUENCE = [
  "starter",
  "backup",
  "reserve",
] as const satisfies LineupRole[];

export type LineupRoleSlot = (typeof LINEUP_ROLE_SEQUENCE)[number];
export type LineupSplitPatternKey =
  | "42-6"
  | "36-12"
  | "30-18"
  | "30-12-6"
  | "24-18-6";

export type LineupSlotLayout = Record<
  PositionCode,
  {
    backupPlayerId: string;
    patternKey: LineupSplitPatternKey;
    reservePlayerId: string;
    starterPlayerId: string;
  }
>;

export type LineupValidation = {
  assignments: DecodedLineupHelperAssignment[];
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
  switchErrors: string[];
  teamTotal: number;
  errors: string[];
};

export const LINEUP_SPLIT_PATTERNS: Array<{
  key: LineupSplitPatternKey;
  label: string;
  minutesByRole: Partial<Record<LineupRoleSlot, number>>;
}> = [
  {
    key: "42-6",
    label: "42 / 6",
    minutesByRole: { starter: 42, backup: 6 },
  },
  {
    key: "36-12",
    label: "36 / 12",
    minutesByRole: { starter: 36, backup: 12 },
  },
  {
    key: "30-18",
    label: "30 / 18",
    minutesByRole: { starter: 30, backup: 18 },
  },
  {
    key: "30-12-6",
    label: "30 / 12 / 6",
    minutesByRole: { starter: 30, backup: 12, reserve: 6 },
  },
  {
    key: "24-18-6",
    label: "24 / 18 / 6",
    minutesByRole: { starter: 24, backup: 18, reserve: 6 },
  },
];

const DEFAULT_PATTERN_KEY: LineupSplitPatternKey = "42-6";
const PATTERN_BY_KEY = Object.fromEntries(
  LINEUP_SPLIT_PATTERNS.map((pattern) => [pattern.key, pattern]),
) as Record<LineupSplitPatternKey, (typeof LINEUP_SPLIT_PATTERNS)[number]>;
const MINUTES_TO_PATTERN_KEY = new Map(
  LINEUP_SPLIT_PATTERNS.map((pattern) => [
    LINEUP_ROLE_SEQUENCE.flatMap((role) =>
      pattern.minutesByRole[role] ? [pattern.minutesByRole[role]] : [],
    ).join(","),
    pattern.key,
  ]),
);

export function emptyLineupLayout(): LineupSlotLayout {
  return Object.fromEntries(
    LINEUP_POSITIONS.map((position) => [
      position,
      {
        backupPlayerId: "",
        patternKey: DEFAULT_PATTERN_KEY,
        reservePlayerId: "",
        starterPlayerId: "",
      },
    ]),
  ) as LineupSlotLayout;
}

export function lineupLayoutFromAssignments(
  assignments: DecodedLineupHelperAssignment[],
): LineupSlotLayout {
  const layout = emptyLineupLayout();

  for (const position of LINEUP_POSITIONS) {
    const assignmentsAtPosition = assignments
      .filter((assignment) => assignment.position === position)
      .sort(
        (left, right) =>
          right.minutes - left.minutes ||
          left.playerId.localeCompare(right.playerId),
      );

    const patternKey =
      MINUTES_TO_PATTERN_KEY.get(
        assignmentsAtPosition.map((assignment) => assignment.minutes).join(","),
      ) ?? DEFAULT_PATTERN_KEY;
    const nextState = layout[position];

    nextState.patternKey = patternKey;
    nextState.starterPlayerId = assignmentsAtPosition[0]?.playerId ?? "";
    nextState.backupPlayerId = assignmentsAtPosition[1]?.playerId ?? "";
    nextState.reservePlayerId = assignmentsAtPosition[2]?.playerId ?? "";
  }

  return layout;
}

export function assignmentsFromLineupLayout(
  layout: LineupSlotLayout,
): DecodedLineupHelperAssignment[] {
  return LINEUP_POSITIONS.flatMap((position) => {
    const positionLayout = layout[position];
    const pattern = PATTERN_BY_KEY[positionLayout.patternKey];

    const roles: Array<[LineupRoleSlot, string]> = [
      ["starter", positionLayout.starterPlayerId],
      ["backup", positionLayout.backupPlayerId],
      ["reserve", positionLayout.reservePlayerId],
    ];

    return roles.flatMap(([role, playerId]) => {
      const minutes = pattern.minutesByRole[role] ?? 0;
      return playerId && minutes > 0
        ? [
            {
              playerId,
              position,
              minutes,
            },
          ]
        : [];
    });
  });
}

export function validateLineupLayout(
  players: LineupHelperRosterPlayer[],
  layout: LineupSlotLayout,
  defensiveSwitch: DefensiveSwitch,
): LineupValidation {
  const assignments = assignmentsFromLineupLayout(layout);
  const slotErrors: string[] = [];

  for (const position of LINEUP_POSITIONS) {
    const positionLayout = layout[position];
    const selectedPlayers = [
      positionLayout.starterPlayerId,
      positionLayout.backupPlayerId,
      positionLayout.reservePlayerId,
    ].filter(Boolean);
    if (selectedPlayers.length !== new Set(selectedPlayers).size) {
      slotErrors.push(
        `${position} cannot assign the same player to starter, backup, or reserve more than once.`,
      );
    }

    const pattern = PATTERN_BY_KEY[positionLayout.patternKey];
    const requiredRoles = LINEUP_ROLE_SEQUENCE.filter(
      (role) => (pattern.minutesByRole[role] ?? 0) > 0,
    );
    for (const role of requiredRoles) {
      const playerId =
        role === "starter"
          ? positionLayout.starterPlayerId
          : role === "backup"
            ? positionLayout.backupPlayerId
            : positionLayout.reservePlayerId;
      if (!playerId) {
        slotErrors.push(`${position} ${role} must be assigned.`);
      }
    }
  }

  const report = validateOptimizedLineup({
    lineup: assignments.map((assignment) => ({
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
  const switchErrors = validateDefensiveSwitch(defensiveSwitch);
  const errors = Array.from(
    new Set([...slotErrors, ...switchErrors, ...report.errors]),
  );

  return {
    assignments,
    playerTotals: report.playerTotals,
    positionTotals: report.positionTotals as Record<PositionCode, number>,
    roleAssignments:
      report.roleAssignments as LineupValidation["roleAssignments"],
    rolesByPlayerPosition:
      report.rolesByPlayerPosition as LineupValidation["rolesByPlayerPosition"],
    rotationFeasible: report.rotationFeasible,
    switchErrors,
    teamTotal: report.teamTotal,
    errors,
  };
}

export function removeUnavailablePlayersFromLineupLayout(
  layout: LineupSlotLayout,
  players: readonly Pick<LineupHelperRosterPlayer, "available" | "playerId">[],
): LineupSlotLayout {
  const availablePlayerIds = new Set(
    players
      .filter((player) => player.available)
      .map((player) => player.playerId),
  );

  return Object.fromEntries(
    LINEUP_POSITIONS.map((position) => {
      const current = layout[position];
      return [
        position,
        {
          ...current,
          starterPlayerId: availablePlayerIds.has(current.starterPlayerId)
            ? current.starterPlayerId
            : "",
          backupPlayerId: availablePlayerIds.has(current.backupPlayerId)
            ? current.backupPlayerId
            : "",
          reservePlayerId: availablePlayerIds.has(current.reservePlayerId)
            ? current.reservePlayerId
            : "",
        },
      ];
    }),
  ) as LineupSlotLayout;
}

export function lineupRuleSummary(): string {
  return `Use ${LINEUP_MINUTE_INCREMENT}-minute increments, cap every player at ${LINEUP_MAX_MINUTES_PER_PLAYER} minutes, and fill ${LINEUP_MINUTES_PER_POSITION} minutes at each position for ${LINEUP_TEAM_TOTAL_MINUTES} team minutes.`;
}

export function normalizeHelperContext(
  context: Partial<DecodedLineupHelperContext>,
): DecodedLineupHelperContext {
  return {
    offense: context.offense ?? "Base Offense",
    defense: context.defense ?? "Man to man",
    enthusiasm: coerceEnthusiasm(context.enthusiasm),
    homeCourt:
      context.homeCourt === "Home Court" ? "Home Court" : "Away or Neutral",
    defensiveSwitch: normalizeDefensiveSwitch(context.defensiveSwitch),
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

export function minutesForRole(
  patternKey: LineupSplitPatternKey,
  role: LineupRoleSlot,
): number {
  return PATTERN_BY_KEY[patternKey].minutesByRole[role] ?? 0;
}

export function roleIsEnabled(
  patternKey: LineupSplitPatternKey,
  role: LineupRoleSlot,
): boolean {
  return minutesForRole(patternKey, role) > 0;
}

export function isIdentityDefensiveSwitch(
  defensiveSwitch: Record<PositionCode, PositionCode>,
): boolean {
  return LINEUP_POSITIONS.every(
    (position) => defensiveSwitch[position] === position,
  );
}
