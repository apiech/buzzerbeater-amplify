import type { CSSProperties } from "react";

import rawScaleData from "./rating-scales.json";

type RawScaleEntry = {
  color: string;
  label: string;
  value: number;
};

type RawScale = {
  aliases?: string[];
  entries: RawScaleEntry[];
  id: string;
  overflow: "cap_top_label" | "repeat_top_label";
};

type RawScaleData = {
  scales: RawScale[];
};

export type BuzzerBeaterScaleId =
  | "enthusiasm"
  | "game_shape"
  | "player_rating"
  | "potential"
  | "staff_skill"
  | "team_rating";

export type BuzzerBeaterScaleEntry = RawScaleEntry;

export type ResolvedBuzzerBeaterValue = {
  canonicalScaleId: RawScale["id"];
  color: string;
  displayLabel: string;
  entry: BuzzerBeaterScaleEntry;
  isOverflow: boolean;
  normalizedLabel: string | null;
  rawValue: number | null;
  resolvedValue: number;
  scaleId: BuzzerBeaterScaleId;
};

const scaleData = rawScaleData as RawScaleData;

const scalesById = new Map<string, RawScale>();
const labelValueMaps = new Map<string, Map<string, RawScaleEntry>>();

for (const scale of scaleData.scales) {
  scalesById.set(scale.id, scale);
  for (const alias of scale.aliases ?? []) {
    scalesById.set(alias, scale);
  }
  labelValueMaps.set(
    scale.id,
    new Map(scale.entries.map((entry) => [normalizeRatingLabel(entry.label), entry])),
  );
}

function normalizeRatingLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function formatNumericSuffix(value: number): string {
  return Number.isInteger(value) ? String(value) : `${value}`;
}

function readScale(scaleId: BuzzerBeaterScaleId): RawScale {
  const scale = scalesById.get(scaleId);
  if (!scale) {
    throw new Error(`Unknown BuzzerBeater scale: ${scaleId}`);
  }
  return scale;
}

function clampResolvedEntry(scale: RawScale, numericValue: number): ResolvedBuzzerBeaterValue {
  const firstEntry = scale.entries[0];
  const lastEntry = scale.entries[scale.entries.length - 1];
  if (!firstEntry || !lastEntry) {
    throw new Error(`BuzzerBeater scale ${scale.id} does not contain any entries.`);
  }

  if (numericValue <= firstEntry.value) {
    return {
      canonicalScaleId: scale.id,
      color: firstEntry.color,
      displayLabel: firstEntry.label,
      entry: firstEntry,
      isOverflow: false,
      normalizedLabel: normalizeRatingLabel(firstEntry.label),
      rawValue: numericValue,
      resolvedValue: firstEntry.value,
      scaleId: scale.id as BuzzerBeaterScaleId,
    };
  }

  const resolvedValue = Math.floor(numericValue);
  const exactMatch = scale.entries.find((entry) => entry.value === resolvedValue);
  if (exactMatch) {
    return {
      canonicalScaleId: scale.id,
      color: exactMatch.color,
      displayLabel: exactMatch.label,
      entry: exactMatch,
      isOverflow: false,
      normalizedLabel: normalizeRatingLabel(exactMatch.label),
      rawValue: numericValue,
      resolvedValue: exactMatch.value,
      scaleId: scale.id as BuzzerBeaterScaleId,
    };
  }

  const isOverflow = numericValue > lastEntry.value;
  return {
    canonicalScaleId: scale.id,
    color: (isOverflow ? lastEntry : firstEntry).color,
    displayLabel:
      isOverflow && scale.overflow === "repeat_top_label"
        ? `${lastEntry.label} (${formatNumericSuffix(numericValue)})`
        : (isOverflow ? lastEntry : firstEntry).label,
    entry: isOverflow ? lastEntry : firstEntry,
    isOverflow,
    normalizedLabel: normalizeRatingLabel((isOverflow ? lastEntry : firstEntry).label),
    rawValue: numericValue,
    resolvedValue: (isOverflow ? lastEntry : firstEntry).value,
    scaleId: scale.id as BuzzerBeaterScaleId,
  };
}

export function resolveBuzzerBeaterValue(args: {
  label?: string | null;
  scale: BuzzerBeaterScaleId;
  value?: number | null;
}): ResolvedBuzzerBeaterValue | null {
  const scale = readScale(args.scale);
  const scaleLabelMap = labelValueMaps.get(scale.id);
  if (!scaleLabelMap) {
    return null;
  }

  if (typeof args.label === "string" && args.label.trim()) {
    const normalizedLabel = normalizeRatingLabel(args.label);
    const labelMatch = scaleLabelMap.get(normalizedLabel);
    if (labelMatch) {
      return {
        canonicalScaleId: scale.id,
        color: labelMatch.color,
        displayLabel: labelMatch.label,
        entry: labelMatch,
        isOverflow: false,
        normalizedLabel,
        rawValue: null,
        resolvedValue: labelMatch.value,
        scaleId: args.scale,
      };
    }
  }

  if (typeof args.value === "number" && Number.isFinite(args.value)) {
    return {
      ...clampResolvedEntry(scale, args.value),
      scaleId: args.scale,
    };
  }

  return null;
}

export function formatBuzzerBeaterLabel(args: {
  label?: string | null;
  scale: BuzzerBeaterScaleId;
  value?: number | null;
}): string | null {
  return resolveBuzzerBeaterValue(args)?.displayLabel ?? null;
}

export function resolveBuzzerBeaterNumericValue(
  scale: BuzzerBeaterScaleId,
  label: string | null | undefined,
): number | null {
  const resolved = resolveBuzzerBeaterValue({ scale, label });
  return resolved?.resolvedValue ?? null;
}

export function buzzerBeaterColorStyle(args: {
  label?: string | null;
  scale: BuzzerBeaterScaleId;
  value?: number | null;
}): CSSProperties | undefined {
  const resolved = resolveBuzzerBeaterValue(args);
  if (!resolved) {
    return undefined;
  }
  return {
    ["--bb-rating-color" as "--bb-rating-color"]: resolved.color,
  };
}

export function renderBuzzerBeaterHtmlSpan(
  text: string,
  args: {
    label?: string | null;
    scale: BuzzerBeaterScaleId;
    value?: number | null;
  },
): string {
  const resolved = resolveBuzzerBeaterValue(args);
  return resolved
    ? `<span style="color:${resolved.color}">${text}</span>`
    : text;
}

export function allScaleValues(scale: BuzzerBeaterScaleId): BuzzerBeaterScaleEntry[] {
  return [...readScale(scale).entries];
}
