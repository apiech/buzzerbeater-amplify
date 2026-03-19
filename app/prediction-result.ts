import type {
  PredictionGridCell,
  PredictionResult,
  PredictionTacticsGrid,
} from "@/app/types";

type PredictionGridSelection = {
  awayDefense: string;
  homeOffense: string;
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
      if (cell.pointDiff === null) {
        continue;
      }
      if (
        !bestCell ||
        bestCell.pointDiff === null ||
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
  if (!homeOffense || !awayDefense) {
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

function toPredictionTacticsGrid(value: unknown): PredictionTacticsGrid | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const offenses = toStringArray(record.offenses);
  const defenses = toStringArray(record.defenses);
  if (!offenses?.length || !defenses?.length || !Array.isArray(record.cells)) {
    return null;
  }

  const cells = record.cells.map((row) => {
    if (!Array.isArray(row) || row.length !== offenses.length) {
      return null;
    }

    const parsedRow = row.map(toPredictionGridCell);
    return parsedRow.every((cell): cell is PredictionGridCell => Boolean(cell))
      ? parsedRow
      : null;
  });

  if (
    cells.length !== defenses.length ||
    !cells.every((row): row is PredictionGridCell[] => Array.isArray(row))
  ) {
    return null;
  }

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
  if (!homeOffense || !awayDefense) {
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

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && Boolean(entry.trim()),
  );
  return entries.length === value.length ? entries : null;
}
