"use client";

import type { PredictionGridCell } from "@/app/types";
import {
  PREDICTION_AWAY_DEFENSE_OPTIONS,
  PREDICTION_HOME_OFFENSE_OPTIONS,
} from "@/lib/prediction/normalization";

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && Boolean(entry.trim()),
  );
  return entries.length === value.length ? entries : null;
}

export function isPredictionHomeOffense(
  value: string,
): value is PredictionGridCell["homeOffense"] {
  return (PREDICTION_HOME_OFFENSE_OPTIONS as readonly string[]).includes(value);
}

export function isPredictionAwayDefense(
  value: string,
): value is PredictionGridCell["awayDefense"] {
  return (PREDICTION_AWAY_DEFENSE_OPTIONS as readonly string[]).includes(value);
}
