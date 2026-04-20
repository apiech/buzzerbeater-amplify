import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import type { ScoutSchedulePayload } from "@/app/types";
import { cn } from "@/app/ui/primitives/cn";

export const SCHEDULE_SHOW_COLORS_STORAGE_KEY = "bb.schedule.showColors.v1";

export type ScheduleTacticKind = "defense" | "offense";
export type ScheduleRow = ScoutSchedulePayload["rows"][number];

type ScheduleTacticConfig = {
  aliases?: string[];
  colorHex: string;
  kind: ScheduleTacticKind;
  label: string;
  token: string;
};

export type ScheduleTacticPresentation = {
  colorHex: string | null;
  kind: ScheduleTacticKind;
  label: string;
  rawValue: string | null;
  token: string | null;
};

export type ScheduleBbstatsScale = {
  distinctValueCount: number;
  thresholds: number[];
};

export type ScheduleBbstatsPresentation = {
  band: number | null;
  colorHex: string | null;
  label: string;
};

const NEUTRAL_PILL_CLASS_NAME =
  "border-black/10 bg-black/5 text-ink shadow-sm";
const PILL_CLASS_NAME =
  "inline-flex min-h-8 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none whitespace-nowrap";
const BBSTATS_BAND_COLORS = [
  "#64748b",
  "#0284c7",
  "#d97706",
  "#15803d",
] as const;

const SCHEDULE_TACTICS: ScheduleTacticConfig[] = [
  {
    aliases: ["baseoffense"],
    colorHex: "#64748b",
    kind: "offense",
    label: "Base",
    token: "base",
  },
  {
    colorHex: "#fb923c",
    kind: "offense",
    label: "Push",
    token: "push",
  },
  {
    colorHex: "#b45309",
    kind: "offense",
    label: "Patient",
    token: "patient",
  },
  {
    colorHex: "#f97316",
    kind: "offense",
    label: "Motion",
    token: "motion",
  },
  {
    colorHex: "#ea580c",
    kind: "offense",
    label: "Run and Gun",
    token: "runandgun",
  },
  {
    colorHex: "#c2410c",
    kind: "offense",
    label: "Princeton",
    token: "princeton",
  },
  {
    colorHex: "#16a34a",
    kind: "offense",
    label: "Look Inside",
    token: "lookinside",
  },
  {
    colorHex: "#15803d",
    kind: "offense",
    label: "Low Post",
    token: "lowpost",
  },
  {
    aliases: ["insideiso"],
    colorHex: "#8b5cf6",
    kind: "offense",
    label: "Inside Isolation",
    token: "insideisolation",
  },
  {
    aliases: ["outsideiso"],
    colorHex: "#ec4899",
    kind: "offense",
    label: "Outside Isolation",
    token: "outsideisolation",
  },
  {
    aliases: ["mantomant", "m2m"],
    colorHex: "#64748b",
    kind: "defense",
    label: "Man to Man",
    token: "mantoman",
  },
  {
    colorHex: "#0284c7",
    kind: "defense",
    label: "2-3 Zone",
    token: "23zone",
  },
  {
    colorHex: "#2563eb",
    kind: "defense",
    label: "3-2 Zone",
    token: "32zone",
  },
  {
    colorHex: "#0f766e",
    kind: "defense",
    label: "1-3-1 Zone",
    token: "131zone",
  },
  {
    aliases: ["insidebox1", "insideboxplus1"],
    colorHex: "#8b5cf6",
    kind: "defense",
    label: "Inside Box-and-One",
    token: "insideboxandone",
  },
  {
    aliases: ["outsidebox1", "outsideboxplus1"],
    colorHex: "#ec4899",
    kind: "defense",
    label: "Outside Box-and-One",
    token: "outsideboxandone",
  },
  {
    aliases: ["fullcourtpress"],
    colorHex: "#ea580c",
    kind: "defense",
    label: "Press",
    token: "press",
  },
];

const tacticsByKind = new Map<ScheduleTacticKind, Map<string, ScheduleTacticConfig>>([
  ["offense", new Map()],
  ["defense", new Map()],
]);

for (const tactic of SCHEDULE_TACTICS) {
  const tacticMap = tacticsByKind.get(tactic.kind);
  if (!tacticMap) {
    continue;
  }

  tacticMap.set(tactic.token, tactic);

  for (const alias of tactic.aliases ?? []) {
    tacticMap.set(alias, tactic);
  }
}

export function normalizeScheduleTacticToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function resolveScheduleTacticPresentation(
  value: string | null | undefined,
  kind: ScheduleTacticKind,
): ScheduleTacticPresentation {
  const rawValue = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!rawValue) {
    return {
      colorHex: null,
      kind,
      label: "—",
      rawValue: null,
      token: null,
    };
  }

  const normalizedToken = normalizeScheduleTacticToken(rawValue);
  const tactic = tacticsByKind.get(kind)?.get(normalizedToken);
  if (!tactic) {
    return {
      colorHex: null,
      kind,
      label: humanizeScheduleValue(rawValue),
      rawValue,
      token: normalizedToken || null,
    };
  }

  return {
    colorHex: tactic.colorHex,
    kind,
    label: tactic.label,
    rawValue,
    token: tactic.token,
  };
}

export function collectScheduleBbstatsValues(rows: ScheduleRow[]): number[] {
  return rows.flatMap((row) => {
    const values: number[] = [];
    if (typeof row.teamBbStatsTotal === "number" && Number.isFinite(row.teamBbStatsTotal)) {
      values.push(row.teamBbStatsTotal);
    }
    if (
      typeof row.opponentBbStatsTotal === "number" &&
      Number.isFinite(row.opponentBbStatsTotal)
    ) {
      values.push(row.opponentBbStatsTotal);
    }
    return values;
  });
}

export function buildScheduleBbstatsScale(
  values: Array<number | null | undefined>,
): ScheduleBbstatsScale | null {
  const numericValues = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);

  const distinctValues = Array.from(new Set(numericValues));
  if (distinctValues.length < 2) {
    return null;
  }

  const thresholds = [0.25, 0.5, 0.75]
    .map((quantile) => {
      const rank = Math.max(1, Math.ceil(numericValues.length * quantile));
      return numericValues[rank - 1] ?? null;
    })
    .filter((value): value is number => value !== null)
    .filter((value, index, entries) => value !== entries[index - 1]);

  return {
    distinctValueCount: distinctValues.length,
    thresholds,
  };
}

export function resolveScheduleBbstatsPresentation(
  value: number | null | undefined,
  scale: ScheduleBbstatsScale | null,
): ScheduleBbstatsPresentation {
  if (value === null || value === undefined) {
    return {
      band: null,
      colorHex: null,
      label: "—",
    };
  }

  if (!scale || scale.distinctValueCount < 2) {
    return {
      band: null,
      colorHex: null,
      label: String(value),
    };
  }

  const bandIndex = resolveScheduleBbstatsBand(value, scale.thresholds);
  const normalizedIndex =
    scale.thresholds.length === 0
      ? 0
      : Math.round((bandIndex / scale.thresholds.length) * (BBSTATS_BAND_COLORS.length - 1));

  return {
    band: bandIndex,
    colorHex: BBSTATS_BAND_COLORS[normalizedIndex] ?? BBSTATS_BAND_COLORS[0],
    label: String(value),
  };
}

export function readScheduleShowColors(storage: Storage | null): boolean {
  if (!storage) {
    return true;
  }

  try {
    const storedValue = storage.getItem(SCHEDULE_SHOW_COLORS_STORAGE_KEY);
    if (storedValue === "false") {
      return false;
    }
    if (storedValue === "true") {
      return true;
    }
  } catch {
    return true;
  }

  return true;
}

export function writeScheduleShowColors(
  storage: Storage | null,
  showColors: boolean,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      SCHEDULE_SHOW_COLORS_STORAGE_KEY,
      showColors ? "true" : "false",
    );
  } catch {
    // Ignore persistence failures and keep the in-memory preference.
  }
}

export function buildSchedulePillStyle(
  colorHex: string | null,
  showColors: boolean,
): CSSProperties | undefined {
  if (!showColors || !colorHex) {
    return undefined;
  }

  return {
    backgroundColor: withAlpha(colorHex, 0.14),
    borderColor: withAlpha(colorHex, 0.3),
  };
}

export function SchedulePill({
  children,
  className,
  colorHex,
  showColors,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  colorHex: string | null;
  showColors: boolean;
}) {
  return (
    <span
      className={cn(
        PILL_CLASS_NAME,
        !showColors || !colorHex ? NEUTRAL_PILL_CLASS_NAME : "text-ink shadow-sm",
        className,
      )}
      style={buildSchedulePillStyle(colorHex, showColors)}
      {...props}
    >
      {children}
    </span>
  );
}

function resolveScheduleBbstatsBand(value: number, thresholds: number[]): number {
  for (let index = 0; index < thresholds.length; index += 1) {
    const threshold = thresholds[index];
    if (threshold !== undefined && value <= threshold) {
      return index;
    }
  }
  return thresholds.length;
}

function humanizeScheduleValue(value: string): string {
  const collapsed = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ");

  return collapsed || value;
}

function withAlpha(colorHex: string, alpha: number): string {
  const normalized = colorHex.replace("#", "");
  if (normalized.length !== 6) {
    return colorHex;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export const __testing = {
  buildScheduleBbstatsScale,
  collectScheduleBbstatsValues,
  normalizeScheduleTacticToken,
  readScheduleShowColors,
  resolveScheduleBbstatsPresentation,
  resolveScheduleTacticPresentation,
  writeScheduleShowColors,
};
