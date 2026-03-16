import artifactData from "./data/coach_parrot_v1.json";

import type { CoachParrotArtifacts } from "./types";

export const OFFENSE_OPTIONS = [
  "Base Offense",
  "Push the Ball",
  "Patient",
  "Look Inside",
  "Low Post",
  "Motion",
  "Run and Gun",
  "Princeton",
] as const;

export const DEFENSE_OPTIONS = [
  "Man to man",
  "2-3 Zone",
  "3-2 Zone",
  "1-3-1 Zone",
  "Full Court Press",
] as const;

export const LOCATION_OPTIONS = ["Home Court", "Away or Neutral"] as const;

const OFFENSE_ALIASES: Record<string, string> = {
  Base: "Base Offense",
  "Base Offense": "Base Offense",
  Push: "Push the Ball",
  "Push the Ball": "Push the Ball",
  Patient: "Patient",
  Motion: "Motion",
  RunAndGun: "Run and Gun",
  "Run and Gun": "Run and Gun",
  Princeton: "Princeton",
  LookInside: "Look Inside",
  "Look Inside": "Look Inside",
  LowPost: "Low Post",
  "Low Post": "Low Post",
  InsideIsolation: "Look Inside",
  OutsideIsolation: "Motion",
};

const DEFENSE_ALIASES: Record<string, string> = {
  ManToMan: "Man to man",
  "Man to man": "Man to man",
  "23Zone": "2-3 Zone",
  "2-3 Zone": "2-3 Zone",
  "32Zone": "3-2 Zone",
  "3-2 Zone": "3-2 Zone",
  "131Zone": "1-3-1 Zone",
  "1-3-1 Zone": "1-3-1 Zone",
  Press: "Full Court Press",
  "Full Court Press": "Full Court Press",
  InsideBoxAndOne: "2-3 Zone",
  OutsideBoxAndOne: "3-2 Zone",
};

export const coachParrotArtifacts = artifactData as CoachParrotArtifacts;

export function normalizeOffense(value: string | null | undefined): string {
  if (
    typeof value === "string" &&
    Object.hasOwn(coachParrotArtifacts.tactic_energy, value)
  ) {
    return value;
  }
  return OFFENSE_ALIASES[value ?? ""] ?? "Base Offense";
}

export function normalizeDefense(value: string | null | undefined): string {
  if (
    typeof value === "string" &&
    Object.hasOwn(coachParrotArtifacts.tactic_energy, value)
  ) {
    return value;
  }
  return DEFENSE_ALIASES[value ?? ""] ?? "Man to man";
}

export function normalizeLocation(value: string | null | undefined): string {
  return value === "Home Court" ? "Home Court" : "Away or Neutral";
}

export function normalizeEnthusiasm(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.min(12, Math.max(1, Math.round(numeric)));
}
