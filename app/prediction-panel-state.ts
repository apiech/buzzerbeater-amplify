"use client";

import type {
  ConnectedPredictionInput,
  DashboardWorkspace,
  ManualPredictionInput,
  OpponentForecastScenario,
  OpponentForecastSnapshot,
  PredictionConnectedOverrides,
  PredictionConnectedSelection,
  PredictionDraftState,
  PredictionForecastContext,
  PredictionForecastPrefill,
  PredictionSubmissionRequest,
} from "@/app/types";

export const PREDICTION_DRAFT_STORAGE_KEY = "bb.predictionDraft.v1";

const FORECAST_OVERRIDE_FIELDS = [
  "away_offStrategy",
  "away_defStrategy",
  "away_gdp_focus",
  "away_gdp_pace",
  "effortDelta",
] as const;

export function createDefaultManualPredictionInput(): ManualPredictionInput {
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
    home_offStrategy: "Base",
    home_defStrategy: "ManToMan",
    away_offStrategy: "Base",
    away_defStrategy: "ManToMan",
    home_gdp_focus: "N/A",
    home_gdp_pace: "N/A",
    away_gdp_focus: "N/A",
    away_gdp_pace: "N/A",
    neutral: "0",
    effortDelta: 0,
  };
}

export function createDefaultConnectedSelection(
  workspace: DashboardWorkspace,
): PredictionConnectedSelection {
  return {
    homeSourceMatchId:
      workspace.home.recentMatches.find(
        (match) => Boolean(match.matchId && match.hasBoxscore),
      )?.matchId ?? "",
    awaySourceMatchId:
      workspace.scout.summary?.recentGames.find(
        (match) => Boolean(match.matchId && match.hasBoxscore),
      )?.matchId ?? "",
  };
}

export function createDefaultPredictionDraft(
  workspace: DashboardWorkspace,
): PredictionDraftState {
  return {
    mode: "CONNECTED",
    manualInput: createDefaultManualPredictionInput(),
    connectedSelection: createDefaultConnectedSelection(workspace),
    connectedOverrides: {},
    forecastPrefill: null,
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
    mode: draft.mode === "MANUAL" ? "MANUAL" : "CONNECTED",
    manualInput: {
      ...defaults.manualInput,
      ...(toRecord(draft.manualInput) ?? {}),
    },
    connectedSelection: {
      homeSourceMatchId:
        asOptionalString(draft.connectedSelection?.homeSourceMatchId) ??
        defaults.connectedSelection.homeSourceMatchId,
      awaySourceMatchId:
        asOptionalString(draft.connectedSelection?.awaySourceMatchId) ??
        defaults.connectedSelection.awaySourceMatchId,
    },
    connectedOverrides: {
      ...(toRecord(draft.connectedOverrides) ?? {}),
    },
    forecastPrefill: normalizeForecastPrefill(draft.forecastPrefill),
  };
}

export function buildSubmissionRequest(args: {
  awayTeamId: string | null;
  draft: PredictionDraftState;
  homeTeamId: string | null;
}): PredictionSubmissionRequest {
  if (args.draft.mode === "MANUAL") {
    return {
      mode: "MANUAL",
      manualInput: args.draft.manualInput,
    };
  }

  const connectedInput: ConnectedPredictionInput = {
    homeSourceMatchId:
      asOptionalString(args.draft.connectedSelection.homeSourceMatchId) ??
      undefined,
    awaySourceMatchId:
      asOptionalString(args.draft.connectedSelection.awaySourceMatchId) ??
      undefined,
    homeTeamId: args.homeTeamId ?? undefined,
    awayTeamId: args.awayTeamId ?? undefined,
    ...args.draft.connectedOverrides,
    manualFallback: args.draft.manualInput,
  };

  if (args.draft.forecastPrefill) {
    connectedInput.forecastContext = args.draft.forecastPrefill.context;
  }

  return {
    mode: "CONNECTED",
    connectedInput,
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
  const selectionDefaults = createDefaultConnectedSelection(args.workspace);
  const overrides = {
    away_offStrategy: args.scenario.offense,
    away_defStrategy: args.scenario.defense,
    away_gdp_focus: args.scenario.gdpFocus ?? "N/A",
    away_gdp_pace: args.scenario.gdpPace ?? "N/A",
    effortDelta: mapOpponentEffortChoiceToRelativeDelta(args.scenario.effortChoice),
  } satisfies PredictionForecastPrefill["overrides"];

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
    mode: "CONNECTED",
    connectedSelection: {
      homeSourceMatchId:
        args.draft.connectedSelection.homeSourceMatchId ||
        selectionDefaults.homeSourceMatchId,
      awaySourceMatchId:
        args.draft.connectedSelection.awaySourceMatchId ||
        selectionDefaults.awaySourceMatchId,
    },
    connectedOverrides: {
      ...args.draft.connectedOverrides,
      ...overrides,
    },
    forecastPrefill: {
      context,
      overrides,
    },
  };
}

export function clearForecastPrefill(
  draft: PredictionDraftState,
): PredictionDraftState {
  const prefill = draft.forecastPrefill;
  if (!prefill) {
    return draft;
  }

  const nextOverrides: PredictionConnectedOverrides = {
    ...draft.connectedOverrides,
  };
  for (const field of FORECAST_OVERRIDE_FIELDS) {
    if (nextOverrides[field] === prefill.overrides[field]) {
      delete nextOverrides[field];
    }
  }

  return {
    ...draft,
    connectedOverrides: nextOverrides,
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

export function extractForecastContextFromRequest(
  value: unknown,
): PredictionForecastContext | null {
  const record = toRecord(value);
  const connectedInput = toRecord(record?.connectedInput);
  const forecastContext = toRecord(connectedInput?.forecastContext);
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
          (entry): entry is string => typeof entry === "string" && Boolean(entry),
        )
      : [],
    sourceTeamId,
  };
}

function normalizeForecastPrefill(
  value: unknown,
): PredictionForecastPrefill | null {
  const record = toRecord(value);
  const context = extractForecastContextFromRequest({
    connectedInput: {
      forecastContext: record?.context,
    },
  });
  const overrides = toRecord(record?.overrides);
  if (!context || !overrides) {
    return null;
  }

  return {
    context,
    overrides: {
      away_offStrategy: asOptionalString(overrides.away_offStrategy) ?? "Base",
      away_defStrategy: asOptionalString(overrides.away_defStrategy) ?? "ManToMan",
      away_gdp_focus: asOptionalString(overrides.away_gdp_focus) ?? "N/A",
      away_gdp_pace: asOptionalString(overrides.away_gdp_pace) ?? "N/A",
      effortDelta: asOptionalNumber(overrides.effortDelta) ?? 0,
    },
  };
}

function toRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, any>;
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
