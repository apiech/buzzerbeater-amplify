"use client";

import { z } from "zod";

import type {
  EditableTeamRatings,
  MatchBoxscorePayload,
  MatchBoxscoreTeam,
  PredictionDraft,
  PredictionSideInput,
  PredictionVenue,
  ScoutedOpponentSheet,
} from "@/app/types";
import { parseLegacyJsonField } from "@/lib/json-parsing";
import { normalizePredictionModelKey } from "@/lib/prediction/model-selection";
import { normalizePredictionRatingsFromBoxscore } from "@/lib/prediction/normalization";

export const GAME_PREDICTION_DRAFT_STORAGE_KEY = "bb.gamePredictionDraft.v1";
const gamePredictionDraftStorageSchema = z.object({}).passthrough();

export const GAME_PREDICTION_OFFENSE_OPTIONS = [
  "Base",
  "Push",
  "Patient",
  "Motion",
  "Run and Gun",
  "Princeton",
  "Look Inside",
  "Low Post",
  "Inside Isolation",
  "Outside Isolation",
] as const;

export const GAME_PREDICTION_DEFENSE_OPTIONS = [
  "Man to Man",
  "2-3 Zone",
  "3-2 Zone",
  "1-3-1 Zone",
  "Inside Box-and-One",
  "Outside Box-and-One",
  "Press",
] as const;

export const GAME_PREDICTION_EFFORT_OPTIONS = [
  "Take It Easy",
  "Normal",
  "Crunch Time",
] as const;

export const GAME_PREDICTION_VENUE_OPTIONS: Array<{
  label: string;
  value: PredictionVenue;
}> = [
  { label: "Team A home", value: "TEAM_A_HOME" },
  { label: "Neutral", value: "NEUTRAL" },
  { label: "Team B home", value: "TEAM_B_HOME" },
];

const DEFAULT_RATINGS: EditableTeamRatings = {
  insideDefense: 10,
  insideScoring: 10,
  offensiveFlow: 10,
  outsideDefense: 10,
  outsideScoring: 10,
  rebounding: 10,
};

const OFFENSE_DISPLAY_BY_TOKEN: Record<string, string> = {
  base: "Base",
  push: "Push",
  patient: "Patient",
  motion: "Motion",
  runandgun: "Run and Gun",
  princeton: "Princeton",
  lookinside: "Look Inside",
  lowpost: "Low Post",
  insideisolation: "Inside Isolation",
  outsideisolation: "Outside Isolation",
};

const DEFENSE_DISPLAY_BY_TOKEN: Record<string, string> = {
  mantomant: "Man to Man",
  mantoman: "Man to Man",
  m2m: "Man to Man",
  "23zone": "2-3 Zone",
  "32zone": "3-2 Zone",
  "131zone": "1-3-1 Zone",
  insideboxandone: "Inside Box-and-One",
  outsideboxandone: "Outside Box-and-One",
  press: "Press",
  fullcourtpress: "Press",
};

export function createDefaultPredictionRatings(): EditableTeamRatings {
  return { ...DEFAULT_RATINGS };
}

export function createDefaultPredictionSide(args?: {
  teamId?: string | null;
  teamName?: string | null;
}): PredictionSideInput {
  return {
    defense: "Man to Man",
    effortChoice: "Normal",
    gdpFocus: "N/A",
    gdpPace: "N/A",
    offense: "Base",
    ratings: createDefaultPredictionRatings(),
    sourceLabel: null,
    sourceMatchId: null,
    teamId: args?.teamId ?? null,
    teamName: args?.teamName?.trim() || "Team",
  };
}

export function createDefaultPredictionDraft(args?: {
  teamAId?: string | null;
  teamAName?: string | null;
  teamBId?: string | null;
  teamBName?: string | null;
}): PredictionDraft {
  return {
    modelKey: null,
    teamA: createDefaultPredictionSide({
      teamId: args?.teamAId ?? null,
      teamName: args?.teamAName ?? "Team A",
    }),
    teamB: createDefaultPredictionSide({
      teamId: args?.teamBId ?? null,
      teamName: args?.teamBName ?? "Team B",
    }),
    venue: "NEUTRAL",
  };
}

export function createBlankPredictionDraft(args?: {
  teamAId?: string | null;
  teamAName?: string | null;
}): PredictionDraft {
  return createDefaultPredictionDraft({
    teamAId: args?.teamAId ?? null,
    teamAName: args?.teamAName ?? "Team A",
    teamBId: null,
    teamBName: "Team B",
  });
}

export function createPredictionDraftFromScout(args: {
  currentTeamId?: string | null;
  currentTeamName?: string | null;
  isNextOpponent: boolean;
  nextMatchIsHome?: boolean | null;
  sheet: ScoutedOpponentSheet;
}): PredictionDraft {
  const teamA =
    args.currentTeamId || args.currentTeamName
      ? {
          ...createDefaultPredictionSide({
            teamId: args.currentTeamId ?? null,
            teamName: args.currentTeamName ?? "Team A",
          }),
          sourceLabel: "Current team baseline",
        }
      : createDefaultPredictionSide({ teamName: "Team A" });

  return {
    modelKey: null,
    teamA,
    teamB: cloneScoutedOpponentSheet(args.sheet),
    venue: args.isNextOpponent
      ? args.nextMatchIsHome
        ? "TEAM_A_HOME"
        : "TEAM_B_HOME"
      : "NEUTRAL",
  };
}

export function cloneScoutedOpponentSheet(
  sheet: ScoutedOpponentSheet,
): PredictionSideInput {
  return {
    defense: sheet.defense,
    effortChoice: sheet.effortChoice,
    gdpFocus: sheet.gdpFocus,
    gdpPace: sheet.gdpPace,
    offense: sheet.offense,
    ratings: cloneRatings(sheet.ratings),
    sourceLabel: sheet.sourceLabel,
    sourceMatchId: sheet.sourceMatchId,
    teamId: sheet.teamId,
    teamName: sheet.teamName,
  };
}

export function createPredictionSideFromBoxscoreTeam(args: {
  match: MatchBoxscorePayload;
  team: MatchBoxscoreTeam;
  teamLocation: "HOME" | "AWAY";
}): PredictionSideInput {
  const normalizedRatings =
    args.team.ratings !== null
      ? normalizePredictionRatingsFromBoxscore({
          sourceTeam: args.team,
          teamLocation: args.teamLocation,
        })
      : createDefaultPredictionRatings();

  const hostLabel =
    args.teamLocation === "HOME" ? "Hosted that match" : "Visited that match";

  return {
    defense: toPredictionDefenseDisplay(args.team.defStrategy),
    effortChoice: "Normal",
    gdpFocus: "N/A",
    gdpPace: "N/A",
    offense: toPredictionOffenseDisplay(args.team.offStrategy),
    ratings: cloneRatings(normalizedRatings),
    sourceLabel: `${hostLabel} on ${formatMatchDate(args.match.startTime)}`,
    sourceMatchId: args.match.matchId,
    teamId: args.team.teamId ?? null,
    teamName: args.team.teamName ?? "Selected team",
  };
}

export function readPredictionDraftFromStorage(
  storage: Storage | null | undefined,
  fallback: PredictionDraft,
): PredictionDraft | null {
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(GAME_PREDICTION_DRAFT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const parsed = parseLegacyJsonField(gamePredictionDraftStorageSchema, raw);
  return reconcilePredictionDraft(
    (parsed as Partial<PredictionDraft> | null) ?? null,
    fallback,
  );
}

export function writePredictionDraftToStorage(
  storage: Storage | null | undefined,
  draft: PredictionDraft,
): void {
  if (!storage) {
    return;
  }

  storage.setItem(GAME_PREDICTION_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function reconcilePredictionDraft(
  value: Partial<PredictionDraft> | null | undefined,
  fallback: PredictionDraft,
): PredictionDraft {
  if (!value) {
    return fallback;
  }

  return {
    modelKey: normalizePredictionModelKey(value.modelKey),
    teamA: reconcilePredictionSide(value.teamA, fallback.teamA),
    teamB: reconcilePredictionSide(value.teamB, fallback.teamB),
    venue: normalizePredictionVenue(value.venue, fallback.venue),
  };
}

export function cloneRatings(
  ratings: EditableTeamRatings | null | undefined,
): EditableTeamRatings {
  return {
    insideDefense: normalizeRatingValue(ratings?.insideDefense),
    insideScoring: normalizeRatingValue(ratings?.insideScoring),
    offensiveFlow: normalizeRatingValue(ratings?.offensiveFlow),
    outsideDefense: normalizeRatingValue(ratings?.outsideDefense),
    outsideScoring: normalizeRatingValue(ratings?.outsideScoring),
    rebounding: normalizeRatingValue(ratings?.rebounding),
  };
}

export function formatPredictionVenueLabel(
  venue: PredictionVenue,
  teamAName: string,
  teamBName: string,
): string {
  if (venue === "TEAM_A_HOME") {
    return `${teamAName} home`;
  }
  if (venue === "TEAM_B_HOME") {
    return `${teamBName} home`;
  }
  return "Neutral site";
}

export function toPredictionOffenseDisplay(value: string | null | undefined): string {
  const token = normalizeTacticToken(value);
  return OFFENSE_DISPLAY_BY_TOKEN[token] ?? "Base";
}

export function toPredictionDefenseDisplay(value: string | null | undefined): string {
  const token = normalizeTacticToken(value);
  return DEFENSE_DISPLAY_BY_TOKEN[token] ?? "Man to Man";
}

function reconcilePredictionSide(
  value: Partial<PredictionSideInput> | null | undefined,
  fallback: PredictionSideInput,
): PredictionSideInput {
  return {
    defense:
      typeof value?.defense === "string" && value.defense.trim()
        ? value.defense
        : fallback.defense,
    effortChoice:
      typeof value?.effortChoice === "string" && value.effortChoice.trim()
        ? value.effortChoice
        : fallback.effortChoice,
    gdpFocus:
      typeof value?.gdpFocus === "string" && value.gdpFocus.trim()
        ? value.gdpFocus
        : fallback.gdpFocus,
    gdpPace:
      typeof value?.gdpPace === "string" && value.gdpPace.trim()
        ? value.gdpPace
        : fallback.gdpPace,
    offense:
      typeof value?.offense === "string" && value.offense.trim()
        ? value.offense
        : fallback.offense,
    ratings: cloneRatings(value?.ratings ?? fallback.ratings),
    sourceLabel:
      typeof value?.sourceLabel === "string" && value.sourceLabel.trim()
        ? value.sourceLabel
        : fallback.sourceLabel,
    sourceMatchId:
      typeof value?.sourceMatchId === "string" && value.sourceMatchId.trim()
        ? value.sourceMatchId
        : fallback.sourceMatchId,
    teamId:
      typeof value?.teamId === "string" && value.teamId.trim()
        ? value.teamId
        : fallback.teamId,
    teamName:
      typeof value?.teamName === "string" && value.teamName.trim()
        ? value.teamName
        : fallback.teamName,
  };
}

function normalizePredictionVenue(
  value: PredictionDraft["venue"] | undefined,
  fallback: PredictionVenue,
): PredictionVenue {
  if (value === "TEAM_A_HOME" || value === "TEAM_B_HOME" || value === "NEUTRAL") {
    return value;
  }
  return fallback;
}

function normalizeRatingValue(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 10;
  }
  return Number(numeric.toFixed(2));
}

function normalizeTacticToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function formatMatchDate(value: string | null | undefined): string {
  if (!value) {
    return "an imported match";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "an imported match";
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
