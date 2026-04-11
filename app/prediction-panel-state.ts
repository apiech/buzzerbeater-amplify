"use client";

import type {
  DashboardWorkspace,
  OpponentForecastScenario,
  OpponentForecastSnapshot,
  PredictionDraftState,
  PredictionForecastAppliedValues,
  PredictionForecastContext,
  PredictionForecastPrefill,
  PredictionInput,
  PredictionSourceSelection,
  PredictionSubmissionRequest,
} from "@/app/types";

export const PREDICTION_DRAFT_STORAGE_KEY = "bb.predictionDraft.v2";

export function createDefaultPredictionInput(): PredictionInput {
  return {
    home_outsideScoring: 10,
    home_insideScoring: 10,
    home_outsideDefense: 10,
    home_insideDefense: 10,
    home_rebounding: 10,
    home_offensiveFlow: 10,
    away_outsideScoring: 10,
    away_insideScoring: 10,
    away_outsideDefense: 10,
    away_insideDefense: 10,
    away_rebounding: 10,
    away_offensiveFlow: 10,
    home_gdp_focus: "N/A",
    home_gdp_pace: "N/A",
    away_gdp_focus: "N/A",
    away_gdp_pace: "N/A",
    neutral: "0",
    effortDelta: 0,
  };
}

export function createDefaultPredictionSourceSelection(
  workspace: DashboardWorkspace,
): PredictionSourceSelection {
  return {
    homeSourceMatchId:
      workspace.home.recentMatches.find(
        (match) => Boolean(match.matchId && match.hasBoxscore),
      )?.matchId ?? "",
    awaySourceMatchId:
      workspace.scout?.summary?.recentGames.find(
        (match) => Boolean(match.matchId && match.hasBoxscore),
      )?.matchId ?? "",
  };
}

export function createDefaultPredictionDraft(
  workspace: DashboardWorkspace,
): PredictionDraftState {
  return {
    input: createDefaultPredictionInput(),
    forecastPrefill: null,
    sourceSelection: createDefaultPredictionSourceSelection(workspace),
  };
}

export function reconcilePredictionDraft(
  workspace: DashboardWorkspace,
  draft: Partial<PredictionDraftState> | null | undefined,
): PredictionDraftState {
  const defaults = createDefaultPredictionDraft(workspace);
  if (!draft) {
    return defaults;
  }

  return {
    input: normalizePredictionInputValue(draft.input, defaults.input),
    forecastPrefill: normalizeForecastPrefill(draft.forecastPrefill),
    sourceSelection: {
      homeSourceMatchId:
        asOptionalString(draft.sourceSelection?.homeSourceMatchId) ??
        defaults.sourceSelection.homeSourceMatchId,
      awaySourceMatchId:
        asOptionalString(draft.sourceSelection?.awaySourceMatchId) ??
        defaults.sourceSelection.awaySourceMatchId,
    },
  };
}

export function buildSubmissionRequest(args: {
  draft: PredictionDraftState;
}): PredictionSubmissionRequest {
  return {
    input: normalizePredictionInputValue(
      args.draft.input,
      createDefaultPredictionInput(),
    ),
    ...(args.draft.forecastPrefill
      ? { forecastContext: args.draft.forecastPrefill.context }
      : {}),
  };
}

export function mapOpponentEffortChoiceToRelativeDelta(
  value: string | null | undefined,
): number {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "TIE" || normalized === "TAKE IT EASY") {
    return 1;
  }
  if (normalized === "CT" || normalized === "CRUNCH TIME") {
    return -1;
  }
  return 0;
}

export function applyForecastScenarioToDraft(args: {
  draft: PredictionDraftState;
  scenario: OpponentForecastScenario;
  snapshot: OpponentForecastSnapshot;
  sourceTeamId: string;
  workspace: DashboardWorkspace;
}): PredictionDraftState {
  const selectionDefaults = createDefaultPredictionSourceSelection(args.workspace);
  const appliedValues: PredictionForecastAppliedValues = {
    effortDelta: mapOpponentEffortChoiceToRelativeDelta(args.scenario.effortChoice),
  };

  const context: PredictionForecastContext = {
    forecastJobId: args.snapshot.jobId,
    forecastModelVersion:
      args.snapshot.modelVersion ??
      args.snapshot.result?.modelVersion ??
      "unknown",
    forecastGeneratedAt:
      args.snapshot.result?.generatedAt ??
      args.snapshot.completedAt ??
      args.snapshot.requestedAt,
    scenarioId: args.scenario.scenarioId,
    scenarioLabel: args.scenario.label,
    scenarioProbability: args.scenario.probability,
    enthusiasmBand: args.scenario.enthusiasmBand ?? null,
    evidence: [...args.scenario.evidence],
    sourceTeamId: args.sourceTeamId,
  };

  return {
    ...args.draft,
    input: {
      ...args.draft.input,
      ...appliedValues,
    },
    forecastPrefill: {
      context,
      appliedValues,
      previousValues: {
        effortDelta: args.draft.input.effortDelta,
      },
    },
    sourceSelection: {
      homeSourceMatchId:
        args.draft.sourceSelection.homeSourceMatchId ||
        selectionDefaults.homeSourceMatchId,
      awaySourceMatchId:
        args.draft.sourceSelection.awaySourceMatchId ||
        selectionDefaults.awaySourceMatchId,
    },
  };
}

export function clearForecastPrefill(
  draft: PredictionDraftState,
): PredictionDraftState {
  if (!draft.forecastPrefill) {
    return draft;
  }

  const nextInput = { ...draft.input };
  if (nextInput.effortDelta === draft.forecastPrefill.appliedValues.effortDelta) {
    nextInput.effortDelta = draft.forecastPrefill.previousValues.effortDelta;
  }

  return {
    ...draft,
    input: nextInput,
    forecastPrefill: null,
  };
}

export function readPredictionDraftFromStorage(
  storage: Storage | null | undefined,
  workspace: DashboardWorkspace,
): PredictionDraftState | null {
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(PREDICTION_DRAFT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PredictionDraftState>;
    return reconcilePredictionDraft(workspace, parsed);
  } catch {
    return null;
  }
}

export function writePredictionDraftToStorage(
  storage: Storage | null | undefined,
  draft: PredictionDraftState,
): void {
  if (!storage) {
    return;
  }
  storage.setItem(PREDICTION_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function normalizeForecastPrefill(
  value: unknown,
): PredictionForecastPrefill | null {
  const record = toRecord(value);
  const context = normalizePredictionForecastContext(record?.context);
  const appliedValues = normalizeForecastValues(record?.appliedValues);
  const previousValues = normalizeForecastValues(record?.previousValues);
  if (!context || !appliedValues || !previousValues) {
    return null;
  }

  return {
    context,
    appliedValues,
    previousValues,
  };
}

function normalizeForecastValues(
  value: unknown,
): PredictionForecastAppliedValues | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  return {
    effortDelta: asOptionalNumber(record.effortDelta) ?? 0,
  };
}

function normalizePredictionInputValue(
  value: unknown,
  defaults: PredictionInput,
): PredictionInput {
  const record = toRecord(value);

  return {
    ...defaults,
    ...(record ?? {}),
    home_gdp_focus: "N/A",
    home_gdp_pace: "N/A",
    away_gdp_focus: "N/A",
    away_gdp_pace: "N/A",
  };
}

function normalizePredictionForecastContext(
  value: unknown,
): PredictionForecastContext | null {
  const forecastContext = toRecord(value);
  if (!forecastContext) {
    return null;
  }

  const forecastJobId = asOptionalString(forecastContext.forecastJobId);
  const scenarioId = asOptionalString(forecastContext.scenarioId);
  const scenarioLabel = asOptionalString(forecastContext.scenarioLabel);
  const sourceTeamId = asOptionalString(forecastContext.sourceTeamId);
  if (!forecastJobId || !scenarioId || !scenarioLabel || !sourceTeamId) {
    return null;
  }

  return {
    forecastJobId,
    forecastModelVersion:
      asOptionalString(forecastContext.forecastModelVersion) ?? "unknown",
    forecastGeneratedAt:
      asOptionalString(forecastContext.forecastGeneratedAt) ?? "",
    scenarioId,
    scenarioLabel,
    scenarioProbability:
      asOptionalNumber(forecastContext.scenarioProbability) ?? 0,
    enthusiasmBand: asOptionalString(forecastContext.enthusiasmBand),
    evidence: Array.isArray(forecastContext.evidence)
      ? forecastContext.evidence.filter(
          (entry): entry is string =>
            typeof entry === "string" && Boolean(entry.trim()),
        )
      : [],
    sourceTeamId,
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
