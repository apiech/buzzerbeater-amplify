import type {
  PredictionGridCell,
  PredictionResult,
  PredictionTacticsGrid,
} from "@/app/types";
import {
  asOptionalNumber,
  asOptionalString,
  isPredictionAwayDefense,
  isPredictionHomeOffense,
  toRecord,
  toStringArray,
} from "@/app/prediction-parsing";

type PredictionGridSelection = {
  awayDefense: PredictionGridCell["awayDefense"];
  homeOffense: PredictionGridCell["homeOffense"];
};

type RenderablePredictionGridCell = PredictionGridCell & {
  awayScore: number;
  homeScore: number;
  pointDiff: number;
};

export function toPredictionResult(value: unknown): PredictionResult | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const homeScore = asOptionalNumber(record.homeScore);
  const awayScore = asOptionalNumber(record.awayScore);
  const pointDiff = asOptionalNumber(record.pointDiff);
  if (homeScore === null || awayScore === null || pointDiff === null) {
    return null;
  }

  const tacticsGrid = toPredictionTacticsGrid(record.tacticsGrid);

  return {
    homeScore,
    awayScore,
    pointDiff,
    modelVersion: asOptionalString(record.modelVersion) ?? "unknown",
    ...(tacticsGrid ? { tacticsGrid } : {}),
  };
}

export function findBestPredictionGridCell(
  grid: PredictionTacticsGrid,
): PredictionGridCell | null {
  let bestCell: PredictionGridCell | null = null;

  for (const row of grid.cells) {
    for (const cell of row) {
      if (!isRenderablePredictionGridCell(cell)) {
        continue;
      }
      if (
        !bestCell ||
        !isRenderablePredictionGridCell(bestCell) ||
        cell.pointDiff > bestCell.pointDiff
      ) {
        bestCell = cell;
      }
    }
  }

  return bestCell;
}

export function findPredictionGridCell(
  grid: PredictionTacticsGrid,
  selection: PredictionGridSelection,
): PredictionGridCell | null {
  const defenseIndex = grid.defenses.indexOf(selection.awayDefense);
  const offenseIndex = grid.offenses.indexOf(selection.homeOffense);
  if (defenseIndex === -1 || offenseIndex === -1) {
    return null;
  }

  return grid.cells[defenseIndex]?.[offenseIndex] ?? null;
}

export function readPredictionGridSelection(
  value: unknown,
): PredictionGridSelection | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const homeOffense = asOptionalString(record.home_offStrategy);
  const awayDefense = asOptionalString(record.away_defStrategy);
  if (
    !homeOffense ||
    !awayDefense ||
    !isPredictionHomeOffense(homeOffense) ||
    !isPredictionAwayDefense(awayDefense)
  ) {
    return null;
  }

  return {
    awayDefense,
    homeOffense,
  };
}

export function isPredictionGridSelectionSupported(
  grid: PredictionTacticsGrid,
  selection: PredictionGridSelection,
): boolean {
  return (
    grid.offenses.includes(selection.homeOffense) &&
    grid.defenses.includes(selection.awayDefense)
  );
}

export function hasRenderablePredictionGrid(
  grid: PredictionTacticsGrid | null | undefined,
): grid is PredictionTacticsGrid {
  if (!grid) {
    return false;
  }

  return countRenderablePredictionGridCells(grid) > 0;
}

export function countRenderablePredictionGridCells(
  grid: PredictionTacticsGrid,
): number {
  let count = 0;

  for (const row of grid.cells) {
    for (const cell of row) {
      if (isRenderablePredictionGridCell(cell)) {
        count += 1;
      }
    }
  }

  return count;
}

export function isRenderablePredictionGridCell(
  cell: PredictionGridCell,
): cell is RenderablePredictionGridCell {
  return (
    cell.homeScore !== null &&
    cell.awayScore !== null &&
    cell.pointDiff !== null
  );
}

export function toPredictionTacticsGrid(
  value: unknown,
): PredictionTacticsGrid | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const offenses = toPredictionHomeOffenseArray(record.offenses);
  const defenses = toPredictionAwayDefenseArray(record.defenses);
  if (!offenses?.length || !defenses?.length) {
    return null;
  }

  const rawRows = Array.isArray(record.cells) ? record.cells : [];
  const cells = defenses.map((awayDefense, rowIndex) => {
    const rawRow = Array.isArray(rawRows[rowIndex]) ? rawRows[rowIndex] : [];

    return offenses.map((homeOffense, columnIndex) => {
      const parsedCell = toPredictionGridCell(rawRow[columnIndex]);
      if (
        parsedCell &&
        parsedCell.homeOffense === homeOffense &&
        parsedCell.awayDefense === awayDefense
      ) {
        return parsedCell;
      }

      return createUnavailablePredictionGridCell(homeOffense, awayDefense);
    });
  });

  return {
    offenses,
    defenses,
    cells,
  };
}

function toPredictionGridCell(value: unknown): PredictionGridCell | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const homeOffense = asOptionalString(record.homeOffense);
  const awayDefense = asOptionalString(record.awayDefense);
  if (
    !homeOffense ||
    !awayDefense ||
    !isPredictionHomeOffense(homeOffense) ||
    !isPredictionAwayDefense(awayDefense)
  ) {
    return null;
  }

  return {
    homeOffense,
    awayDefense,
    homeScore: asOptionalNumber(record.homeScore),
    awayScore: asOptionalNumber(record.awayScore),
    pointDiff: asOptionalNumber(record.pointDiff),
  };
}

function toPredictionHomeOffenseArray(
  value: unknown,
): PredictionGridCell["homeOffense"][] | null {
  const entries = toStringArray(value);
  if (!entries || !entries.every(isPredictionHomeOffense)) {
    return null;
  }

  return entries;
}

function toPredictionAwayDefenseArray(
  value: unknown,
): PredictionGridCell["awayDefense"][] | null {
  const entries = toStringArray(value);
  if (!entries || !entries.every(isPredictionAwayDefense)) {
    return null;
  }

  return entries;
}

function createUnavailablePredictionGridCell(
  homeOffense: PredictionGridCell["homeOffense"],
  awayDefense: PredictionGridCell["awayDefense"],
): PredictionGridCell {
  return {
    awayDefense,
    awayScore: null,
    homeOffense,
    homeScore: null,
    pointDiff: null,
  };
}
