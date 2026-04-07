import { z } from "zod";

import {
  PREDICTION_AWAY_DEFENSE_OPTIONS,
  PREDICTION_HOME_OFFENSE_OPTIONS,
} from "./normalization";

const predictionHomeOffenseSchema = z.enum(PREDICTION_HOME_OFFENSE_OPTIONS);
const predictionAwayDefenseSchema = z.enum(PREDICTION_AWAY_DEFENSE_OPTIONS);
const finiteNumberSchema = z.number().finite();

export const predictionGridCellSchema = z.object({
  awayDefense: predictionAwayDefenseSchema,
  awayScore: finiteNumberSchema.nullable(),
  homeOffense: predictionHomeOffenseSchema,
  homeScore: finiteNumberSchema.nullable(),
  pointDiff: finiteNumberSchema.nullable(),
});

export const predictionEndpointTacticsGridSchema = z.object({
  offenses: z.array(predictionHomeOffenseSchema).min(1),
  defenses: z.array(predictionAwayDefenseSchema).min(1),
  cells: z.array(z.array(predictionGridCellSchema)).min(1),
});

export const predictionEndpointResponseSchema = z.object({
  awayScore: finiteNumberSchema.optional(),
  homeScore: finiteNumberSchema.optional(),
  modelVersion: z.string().trim().min(1).optional(),
  pointDiff: finiteNumberSchema.optional(),
  tacticsGrid: predictionEndpointTacticsGridSchema,
});

export const currentPredictionForecastContextSchema = z.object({
  forecastGeneratedAt: z.string().trim().min(1),
  forecastJobId: z.string().trim().min(1),
  forecastModelVersion: z.string().trim().min(1),
  scenarioId: z.string().trim().min(1),
  scenarioLabel: z.string().trim().min(1),
  scenarioProbability: finiteNumberSchema,
  sourceTeamId: z.string().trim().min(1),
  enthusiasmBand: z.string().trim().min(1).nullable().optional(),
});

export const currentPredictionPreviewSchema = z.object({
  awayScore: finiteNumberSchema.nullable().optional(),
  error: z.string().trim().min(1).nullable().optional(),
  executionArn: z.string().trim().min(1).nullable().optional(),
  forecastContext: currentPredictionForecastContextSchema.nullable().optional(),
  homeScore: finiteNumberSchema.nullable().optional(),
  modelVersion: z.string().trim().min(1).nullable().optional(),
  pointDiff: finiteNumberSchema.nullable().optional(),
  requestId: z.string().trim().min(1),
  requestedAt: z.string().trim().min(1),
  status: z.enum([
    "QUEUED",
    "RESOLVING_INPUT",
    "INVOKING_MODEL",
    "SUCCEEDED",
    "FAILED",
  ]),
  tacticsGrid: predictionEndpointTacticsGridSchema.nullable().optional(),
  updatedAt: z.string().trim().min(1),
  userId: z.string().trim().min(1),
});

export type PredictionGridCellShape = z.infer<typeof predictionGridCellSchema>;
export type PredictionEndpointResponse = z.infer<
  typeof predictionEndpointResponseSchema
>;
export type PredictionEndpointTacticsGrid = z.infer<
  typeof predictionEndpointTacticsGridSchema
>;
export type CurrentPredictionForecastContextShape = z.infer<
  typeof currentPredictionForecastContextSchema
>;
export type CurrentPredictionPreviewShape = z.infer<
  typeof currentPredictionPreviewSchema
>;

export function countRenderablePredictionGridCells(
  grid: PredictionEndpointTacticsGrid,
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
  cell: PredictionGridCellShape,
): boolean {
  return (
    typeof cell.homeScore === "number" &&
    Number.isFinite(cell.homeScore) &&
    typeof cell.awayScore === "number" &&
    Number.isFinite(cell.awayScore) &&
    typeof cell.pointDiff === "number" &&
    Number.isFinite(cell.pointDiff)
  );
}

