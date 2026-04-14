"use client";

import { z } from "zod";

import type {
  NextGameRecommendationInput,
  PositionCode,
  RecommendationMode,
} from "@/app/types";
import { normalizeExcludedPlayerIds } from "@/app/lineup-availability-state";
import {
  normalizeDefensiveSwitch,
  validateDefensiveSwitch,
} from "@/lib/coach-parrot/lineup-rules";
import { parseLegacyJsonField } from "@/lib/json-parsing";

export const NEXT_GAME_RECOMMENDATION_STORAGE_KEY =
  "bb.nextGameRecommendation.v1";
export const NEXT_GAME_RECOMMENDATION_DEFAULTS: NextGameRecommendationInput = {
  excludedPlayerIds: [],
  enthusiasm: 8,
  defensiveSwitch: {
    pg: "PG",
    sg: "SG",
    sf: "SF",
    pf: "PF",
    c: "C",
  },
};
export const RECOMMENDATION_MODES: RecommendationMode[] = [
  "BEST_EXPECTED",
  "SAFEST",
  "EFFICIENT_WIN",
];
const nextGameRecommendationInputStorageSchema = z
  .object({
    defensiveSwitch: z
      .object({
        c: z.enum(["PG", "SG", "SF", "PF", "C"]).optional(),
        pf: z.enum(["PG", "SG", "SF", "PF", "C"]).optional(),
        pg: z.enum(["PG", "SG", "SF", "PF", "C"]).optional(),
        sf: z.enum(["PG", "SG", "SF", "PF", "C"]).optional(),
        sg: z.enum(["PG", "SG", "SF", "PF", "C"]).optional(),
      })
      .partial()
      .optional(),
    excludedPlayerIds: z.array(z.string()).optional(),
    enthusiasm: z.coerce.number().optional(),
  })
  .partial();

export function normalizeNextGameRecommendationInput(
  value:
    | {
        excludedPlayerIds?: string[];
        enthusiasm?: number;
        defensiveSwitch?: Partial<
          NextGameRecommendationInput["defensiveSwitch"]
        >;
      }
    | null
    | undefined,
): NextGameRecommendationInput {
  const defensiveSwitch = normalizeDefensiveSwitch(
    value?.defensiveSwitch
      ? {
          PG: value.defensiveSwitch.pg,
          SG: value.defensiveSwitch.sg,
          SF: value.defensiveSwitch.sf,
          PF: value.defensiveSwitch.pf,
          C: value.defensiveSwitch.c,
        }
      : {},
  );
  const errors = validateDefensiveSwitch(defensiveSwitch);
  if (errors.length) {
    return NEXT_GAME_RECOMMENDATION_DEFAULTS;
  }

  return {
    excludedPlayerIds: normalizeExcludedPlayerIds(value?.excludedPlayerIds),
    enthusiasm: normalizeEnthusiasm(value?.enthusiasm),
    defensiveSwitch: {
      pg: defensiveSwitch.PG,
      sg: defensiveSwitch.SG,
      sf: defensiveSwitch.SF,
      pf: defensiveSwitch.PF,
      c: defensiveSwitch.C,
    },
  };
}

export function readNextGameRecommendationInput(
  storage: Storage | null | undefined,
): NextGameRecommendationInput {
  if (!storage) {
    return NEXT_GAME_RECOMMENDATION_DEFAULTS;
  }

  const raw = storage.getItem(NEXT_GAME_RECOMMENDATION_STORAGE_KEY);
  if (!raw) {
    return NEXT_GAME_RECOMMENDATION_DEFAULTS;
  }

  return normalizeNextGameRecommendationInput(
    parseLegacyJsonField(nextGameRecommendationInputStorageSchema, raw),
  );
}

export function writeNextGameRecommendationInput(
  storage: Storage | null | undefined,
  value: NextGameRecommendationInput,
): void {
  if (!storage) {
    return;
  }
  storage.setItem(
    NEXT_GAME_RECOMMENDATION_STORAGE_KEY,
    JSON.stringify(normalizeNextGameRecommendationInput(value)),
  );
}

export function formatRecommendationSwitchSummary(
  defensiveSwitch: NextGameRecommendationInput["defensiveSwitch"],
): string {
  return (
    [
      ["PG", defensiveSwitch.pg],
      ["SG", defensiveSwitch.sg],
      ["SF", defensiveSwitch.sf],
      ["PF", defensiveSwitch.pf],
      ["C", defensiveSwitch.c],
    ] as Array<[string, PositionCode]>
  )
    .map(([from, to]) => `${from}->${to}`)
    .join(" • ");
}

function normalizeEnthusiasm(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return NEXT_GAME_RECOMMENDATION_DEFAULTS.enthusiasm;
  }
  return Math.min(15, Math.max(1, Math.round(numeric)));
}
