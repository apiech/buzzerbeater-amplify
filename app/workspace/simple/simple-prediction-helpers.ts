import type {
  BillingSummary,
  MatchBoxscorePayload,
  MatchSummary,
  PredictionDraft,
  PredictionMatrixCell,
  PredictionMatrixTacticPair,
  PredictionMatrixView,
} from "@/app/types";
import { COMMERCIAL_MODE_DISABLED_SENTINEL } from "@/app/dashboard/remote-errors";
import { hasFeature } from "@/lib/billing/plans";

type ImportSide = "teamA" | "teamB";

export type SimplePredictionImportMatchOption = {
  label: string;
  matchId: string;
};

export type PredictionImportMatchFieldState = {
  error: string | null;
  hint: string;
};

export type MatrixVisibleResult = {
  cell: PredictionMatrixCell;
  teamAPair: PredictionMatrixTacticPair;
  teamBPair: PredictionMatrixTacticPair;
};

type PredictionSideTeamIdCommitResult = {
  changed: boolean;
  committedTeamIdInput: string;
  draft: PredictionDraft;
  nextImportMatchId: string;
  nextManualImportMatchId: string;
};

const MATRIX_CELL_HEATMAP_MAX_ABS_MARGIN = 20;
const MATRIX_OFFENSE_SORT_ORDER = [
  "Base Offense",
  "Push the Ball",
  "Patient",
  "Look Inside",
  "Low Post",
  "Run and Gun",
  "Motion",
  "Princeton",
  "Outside Isolation",
  "Inside Isolation",
] as const;
const MATRIX_DEFENSE_SORT_ORDER = [
  "Man to Man",
  "3-2 Zone",
  "1-3-1 Zone",
  "2-3 Zone",
  "Outside Box + 1",
  "Inside Box + 1",
  "Full Court Press",
] as const;
const MATRIX_DEFENSE_CANONICAL_LABELS: Record<string, string> = {
  "Man to man": "Man to Man",
};

export function normalizeImportIdentifier(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function readSimplePredictionErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : String(error);
}

export function usesCurrentTeamSchedule(args: {
  currentTeamId: string | null;
  sideTeamId: string | null;
}) {
  const currentTeamId = normalizeImportIdentifier(args.currentTeamId);
  const sideTeamId = normalizeImportIdentifier(args.sideTeamId);
  return Boolean(currentTeamId && sideTeamId && currentTeamId === sideTeamId);
}

export function resolvePredictionSideRecentMatches(args: {
  currentTeamId: string | null;
  currentTeamRecentMatches: readonly MatchSummary[];
  scoutRecentMatches: readonly MatchSummary[];
  sideTeamId: string | null;
}): MatchSummary[] {
  const sideTeamId = normalizeImportIdentifier(args.sideTeamId);
  if (!sideTeamId) {
    return [];
  }

  return usesCurrentTeamSchedule({
    currentTeamId: args.currentTeamId,
    sideTeamId,
  })
    ? [...args.currentTeamRecentMatches]
    : [...args.scoutRecentMatches];
}

export function buildPredictionImportMatchOptions(
  matches: readonly MatchSummary[],
): SimplePredictionImportMatchOption[] {
  const seenMatchIds = new Set<string>();

  return [...matches]
    .filter(
      (match): match is MatchSummary & { matchId: string } =>
        Boolean(match.hasBoxscore && normalizeImportIdentifier(match.matchId)),
    )
    .sort((left, right) =>
      String(right.startTime ?? "").localeCompare(String(left.startTime ?? "")),
    )
    .flatMap((match) => {
      const matchId = normalizeImportIdentifier(match.matchId);
      if (!matchId || seenMatchIds.has(matchId)) {
        return [];
      }

      seenMatchIds.add(matchId);
      return [
        {
          label: formatPredictionImportMatchLabel(match),
          matchId,
        },
      ];
    });
}

export function ensurePredictionImportMatchOption(args: {
  importMatch: MatchBoxscorePayload | null;
  importMatchId: string;
  options: readonly SimplePredictionImportMatchOption[];
}): SimplePredictionImportMatchOption[] {
  const importMatchId = normalizeImportIdentifier(args.importMatchId);
  if (!importMatchId) {
    return [...args.options];
  }

  if (args.options.some((option) => option.matchId === importMatchId)) {
    return [...args.options];
  }

  return [
    ...args.options,
    {
      label: args.importMatch
        ? formatPredictionImportBoxscoreLabel(args.importMatch)
        : `Game ${importMatchId}`,
      matchId: importMatchId,
    },
  ];
}

export function resolvePredictionImportTeamLocation(args: {
  boxscore: MatchBoxscorePayload | null;
  sideTeamId: string | null;
}): "HOME" | "AWAY" | null {
  const sideTeamId = normalizeImportIdentifier(args.sideTeamId);
  const homeTeam = args.boxscore?.homeTeam ?? null;
  const awayTeam = args.boxscore?.awayTeam ?? null;
  const homeTeamId = normalizeImportIdentifier(homeTeam?.teamId);
  const awayTeamId = normalizeImportIdentifier(awayTeam?.teamId);

  if (sideTeamId) {
    const homeMatches = homeTeamId === sideTeamId;
    const awayMatches = awayTeamId === sideTeamId;

    if (homeMatches && !awayMatches) {
      return "HOME";
    }
    if (awayMatches && !homeMatches) {
      return "AWAY";
    }
    return null;
  }

  if (homeTeam && !awayTeam) {
    return "HOME";
  }
  if (!homeTeam && awayTeam) {
    return "AWAY";
  }

  return null;
}

export function commitPredictionSideTeamIdChange(args: {
  currentImportMatchId: string;
  currentManualImportMatchId: string;
  draft: PredictionDraft;
  nextTeamIdInput: string;
  side: ImportSide;
}): PredictionSideTeamIdCommitResult {
  const currentSide = args.draft[args.side];
  const nextTeamId = normalizeImportIdentifier(args.nextTeamIdInput);
  const currentTeamId = normalizeImportIdentifier(currentSide.teamId);
  const committedTeamIdInput = nextTeamId ?? "";

  if (currentTeamId === nextTeamId) {
    return {
      changed: false,
      committedTeamIdInput,
      draft: args.draft,
      nextImportMatchId: args.currentImportMatchId,
      nextManualImportMatchId: args.currentManualImportMatchId,
    };
  }

  return {
    changed: true,
    committedTeamIdInput,
    draft: {
      ...args.draft,
      [args.side]: {
        ...currentSide,
        sourceLabel: null,
        sourceMatchId: null,
        teamId: nextTeamId,
      },
    },
    nextImportMatchId: "",
    nextManualImportMatchId: "",
  };
}

export function applyPredictionSideResolvedTeamName(args: {
  draft: PredictionDraft;
  side: ImportSide;
  teamId: string;
  teamName: string | null | undefined;
}) {
  const currentSide = args.draft[args.side];
  const normalizedCurrentTeamId = normalizeImportIdentifier(currentSide.teamId);
  const normalizedTargetTeamId = normalizeImportIdentifier(args.teamId);
  const resolvedTeamName = args.teamName?.trim() || null;

  if (
    !normalizedCurrentTeamId ||
    !normalizedTargetTeamId ||
    normalizedCurrentTeamId !== normalizedTargetTeamId ||
    !resolvedTeamName ||
    currentSide.teamName === resolvedTeamName
  ) {
    return args.draft;
  }

  return {
    ...args.draft,
    [args.side]: {
      ...currentSide,
      teamName: resolvedTeamName,
    },
  };
}

export function describePredictionImportMatchField(args: {
  errorMessage: string | null;
  isLoading: boolean;
  options: readonly SimplePredictionImportMatchOption[];
  selectedMatchId: string;
  teamId: string | null;
}): PredictionImportMatchFieldState {
  if (!normalizeImportIdentifier(args.teamId)) {
    return {
      error: args.errorMessage,
      hint: normalizeImportIdentifier(args.selectedMatchId)
        ? "A specific game is selected."
        : "Enter a team ID to load recent boxscores.",
    };
  }

  if (args.isLoading) {
    return {
      error: args.errorMessage,
      hint: "Loading recent boxscores.",
    };
  }

  if (!args.options.length) {
    return {
      error: args.errorMessage,
      hint: "No recent boxscores are available.",
    };
  }

  return {
    error: args.errorMessage,
    hint: "Choose a recent boxscore or load a game ID.",
  };
}

export function sortPairs(pairs: readonly PredictionMatrixTacticPair[]) {
  const offenseOrder = new Map<string, number>(
    MATRIX_OFFENSE_SORT_ORDER.map((value, index) => [value, index]),
  );
  const defenseOrder = new Map<string, number>(
    MATRIX_DEFENSE_SORT_ORDER.map((value, index) => [value, index]),
  );

  return [...pairs].sort((left, right) => {
    return (
      (offenseOrder.get(left.offense) ?? Number.MAX_SAFE_INTEGER) -
        (offenseOrder.get(right.offense) ?? Number.MAX_SAFE_INTEGER) ||
      (defenseOrder.get(normalizeMatrixDefenseLabel(left.defense)) ??
        Number.MAX_SAFE_INTEGER) -
        (defenseOrder.get(normalizeMatrixDefenseLabel(right.defense)) ??
          Number.MAX_SAFE_INTEGER) ||
      left.pairId.localeCompare(right.pairId)
    );
  });
}

export function findSelectedCell(args: {
  teamAPairId: string | null;
  teamBPairId: string | null;
  view: PredictionMatrixView | null;
}): PredictionMatrixCell | null {
  if (!args.view || !args.teamAPairId || !args.teamBPairId) {
    return null;
  }

  const row = args.view.rows.find(
    (candidate) => candidate.teamBPairId === args.teamBPairId,
  );
  return (
    row?.cells.find((candidate) => candidate.teamAPairId === args.teamAPairId) ??
    null
  );
}

export function findMinimaxVisibleResult(args: {
  teamAPairs: readonly PredictionMatrixTacticPair[];
  teamBPairs: readonly PredictionMatrixTacticPair[];
  view: PredictionMatrixView | null;
}): MatrixVisibleResult | null {
  if (!args.view || !args.teamAPairs.length || !args.teamBPairs.length) {
    return null;
  }

  const rowsByTeamBPairId = new Map(
    args.view.rows.map((row) => [row.teamBPairId, row] as const),
  );

  let recommendation:
    | (MatrixVisibleResult & {
        averageMargin: number;
        worstCaseMargin: number;
      })
    | null = null;

  for (const teamAPair of args.teamAPairs) {
    let worstCase: MatrixVisibleResult | null = null;
    let marginSum = 0;
    let marginCount = 0;

    for (const teamBPair of args.teamBPairs) {
      const row = rowsByTeamBPairId.get(teamBPair.pairId);
      if (!row) {
        continue;
      }

      const cell =
        row.cells.find((candidate) => candidate.teamAPairId === teamAPair.pairId) ??
        null;
      if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
        continue;
      }

      marginSum += cell.predictedPointDiff;
      marginCount += 1;

      if (
        !worstCase ||
        cell.predictedPointDiff <
          (worstCase.cell.predictedPointDiff ?? Number.POSITIVE_INFINITY)
      ) {
        worstCase = {
          cell,
          teamAPair,
          teamBPair,
        };
      }
    }

    if (!worstCase || marginCount === 0) {
      continue;
    }

    const worstCaseMargin =
      worstCase.cell.predictedPointDiff ?? Number.NEGATIVE_INFINITY;
    const averageMargin = marginSum / marginCount;

    if (
      !recommendation ||
      worstCaseMargin > recommendation.worstCaseMargin ||
      (worstCaseMargin === recommendation.worstCaseMargin &&
        averageMargin > recommendation.averageMargin)
    ) {
      recommendation = {
        ...worstCase,
        averageMargin,
        worstCaseMargin,
      };
    }
  }

  return recommendation
    ? {
        cell: recommendation.cell,
        teamAPair: recommendation.teamAPair,
        teamBPair: recommendation.teamBPair,
      }
    : null;
}

export function findFirstAvailableResult(args: {
  teamAPairs: readonly PredictionMatrixTacticPair[];
  teamBPairs: readonly PredictionMatrixTacticPair[];
  view: PredictionMatrixView | null;
}): MatrixVisibleResult | null {
  if (!args.view) {
    return null;
  }

  for (const teamBPair of args.teamBPairs) {
    const row = args.view.rows.find(
      (candidate) => candidate.teamBPairId === teamBPair.pairId,
    );
    if (!row) {
      continue;
    }

    for (const teamAPair of args.teamAPairs) {
      const cell =
        row.cells.find((candidate) => candidate.teamAPairId === teamAPair.pairId) ??
        null;
      if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
        continue;
      }

      return {
        cell,
        teamAPair,
        teamBPair,
      };
    }
  }

  return null;
}

export function getPredictionCellHeatmapStyle(cell: PredictionMatrixCell | null) {
  const level = getPredictionCellHeatmapLevel(cell);
  if (level === null) {
    return {
      backgroundColor: "rgba(15, 23, 42, 0.03)",
      borderColor: "rgba(15, 23, 42, 0.08)",
    };
  }

  const intensity = Math.abs(level);
  if (level > 0) {
    return {
      backgroundColor: `rgba(34, 197, 94, ${0.06 + intensity * 0.24})`,
      borderColor: `rgba(34, 197, 94, ${0.14 + intensity * 0.22})`,
    };
  }

  if (level < 0) {
    return {
      backgroundColor: `rgba(239, 68, 68, ${0.06 + intensity * 0.24})`,
      borderColor: `rgba(239, 68, 68, ${0.14 + intensity * 0.22})`,
    };
  }

  return {
    backgroundColor: "rgba(15, 23, 42, 0.04)",
    borderColor: "rgba(15, 23, 42, 0.08)",
  };
}

export function formatCellMargin(cell: PredictionMatrixCell | null) {
  if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
    return "Unavailable";
  }

  return `${cell.predictedPointDiff > 0 ? "+" : ""}${cell.predictedPointDiff.toFixed(
    1,
  )}`;
}

export function formatCellScoreline(
  cell: PredictionMatrixCell | null,
  teamALabel: string,
  teamBLabel: string,
) {
  if (
    !cell?.available ||
    typeof cell.predictedTeamAScore !== "number" ||
    typeof cell.predictedTeamBScore !== "number"
  ) {
    return "No score estimate";
  }

  return `${teamALabel} ${cell.predictedTeamAScore.toFixed(
    1,
  )} • ${teamBLabel} ${cell.predictedTeamBScore.toFixed(1)}`;
}

export function formatTacticPairLabel(pair: PredictionMatrixTacticPair) {
  return `${pair.offense} / ${pair.defense}${pair.estimated ? " (Est.)" : ""}`;
}

export function normalizePredictionNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Number(parsed.toFixed(2));
}

export function canUseSimplePredictionFeature(args: {
  billingError: string | null;
  billingSummary: BillingSummary | null;
}) {
  const commercialModeDisabled =
    args.billingError === COMMERCIAL_MODE_DISABLED_SENTINEL;
  const billingPlanId =
    args.billingSummary?.planId === "premium" ? "premium" : "free";

  return commercialModeDisabled
    ? true
    : args.billingSummary
      ? hasFeature(billingPlanId, "predictions")
      : false;
}

export function buildSimplePredictionRequest(draft: PredictionDraft) {
  return {
    ...draft,
    modelKey: null,
  };
}

function formatPredictionImportMatchLabel(match: MatchSummary): string {
  const prefix = match.startTime ? `${formatDate(match.startTime)} • ` : "";
  const opponent = match.opponentTeamName ?? "Unknown opponent";
  const outcome = match.outcome ? `${match.outcome} ` : "";
  const score =
    typeof match.teamScore === "number" &&
    typeof match.opponentScore === "number"
      ? `${match.teamScore}-${match.opponentScore}`
      : null;

  return `${prefix}${opponent}${score ? ` • ${outcome}${score}` : ""}`.trim();
}

function formatPredictionImportBoxscoreLabel(match: MatchBoxscorePayload): string {
  const prefix = match.startTime ? `${formatDate(match.startTime)} • ` : "";
  const homeTeam =
    match.homeTeam?.teamName ?? match.context?.homeTeamName ?? "Home";
  const awayTeam =
    match.awayTeam?.teamName ?? match.context?.awayTeamName ?? "Away";
  const score =
    typeof match.homeTeam?.score === "number" &&
    typeof match.awayTeam?.score === "number"
      ? ` • ${match.homeTeam.score}-${match.awayTeam.score}`
      : "";

  return `${prefix}${homeTeam} vs ${awayTeam}${score}`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeMatrixDefenseLabel(defense: string) {
  return MATRIX_DEFENSE_CANONICAL_LABELS[defense] ?? defense;
}

function getPredictionCellHeatmapLevel(cell: PredictionMatrixCell | null) {
  if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
    return null;
  }

  const normalized = cell.predictedPointDiff / MATRIX_CELL_HEATMAP_MAX_ABS_MARGIN;
  return Math.max(-1, Math.min(1, normalized));
}

export const __testing = {
  applyPredictionSideResolvedTeamName,
  buildPredictionImportMatchOptions,
  buildSimplePredictionRequest,
  canUseSimplePredictionFeature,
  commitPredictionSideTeamIdChange,
  describePredictionImportMatchField,
  ensurePredictionImportMatchOption,
  findFirstAvailableResult,
  findMinimaxVisibleResult,
  findSelectedCell,
  formatCellMargin,
  getPredictionCellHeatmapStyle,
  resolvePredictionImportTeamLocation,
  resolvePredictionSideRecentMatches,
  sortPairs,
  usesCurrentTeamSchedule,
};
