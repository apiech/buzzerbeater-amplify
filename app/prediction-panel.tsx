"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { client } from "@/app/amplify-client";
import {
  findBestPredictionGridCell,
  findPredictionGridCell,
  isPredictionGridSelectionSupported,
  readPredictionGridSelection,
  toPredictionResult,
} from "@/app/prediction-result";
import {
  buildSubmissionRequest,
  clearForecastPrefill,
  createDefaultManualPredictionInput,
  extractForecastContextFromRequest,
} from "@/app/prediction-panel-state";
import type {
  DashboardWorkspace,
  ManualPredictionInput,
  PredictionGridCell,
  PredictionConnectedOverrides,
  PredictionDraftState,
  PredictionJobRecord,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  StatusBadge,
  statusToneFromValue,
} from "@/app/ui/primitives/status-badge";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";
import { formatPreviewStatus } from "@/app/ui/presentation";
import { buzzerBeaterColorStyle } from "@/lib/buzzerbeater/rating-scale";

export { buildSubmissionRequest, createDefaultManualPredictionInput };

const OFFENSE_OPTIONS = [
  "Base",
  "Push",
  "Patient",
  "Motion",
  "RunAndGun",
  "Princeton",
  "LookInside",
  "LowPost",
  "InsideIsolation",
  "OutsideIsolation",
];

const DEFENSE_OPTIONS = [
  "ManToMan",
  "23Zone",
  "32Zone",
  "131Zone",
  "Press",
  "InsideBoxAndOne",
  "OutsideBoxAndOne",
];

const GDP_FOCUS_OPTIONS = [
  "N/A",
  "outside.hit",
  "outside.miss",
  "Inside.hit",
  "Inside.miss",
  "Balanced.hit",
  "Balanced.miss",
];

const GDP_PACE_OPTIONS = [
  "N/A",
  "Fast.hit",
  "Fast.miss",
  "Normal.hit",
  "Normal.miss",
  "Slow.hit",
  "Slow.miss",
];

const RATING_FIELDS: Array<{
  label: string;
  homeKey: NumericManualField;
  awayKey: NumericManualField;
}> = [
  {
    label: "Outside scoring",
    homeKey: "home_outsideScoring",
    awayKey: "away_outsideScoring",
  },
  {
    label: "Inside scoring",
    homeKey: "home_insideScoring",
    awayKey: "away_insideScoring",
  },
  {
    label: "Outside defense",
    homeKey: "home_outsideDefense",
    awayKey: "away_outsideDefense",
  },
  {
    label: "Inside defense",
    homeKey: "home_insideDefense",
    awayKey: "away_insideDefense",
  },
  {
    label: "Rebounding",
    homeKey: "home_rebounding",
    awayKey: "away_rebounding",
  },
  {
    label: "Offensive flow",
    homeKey: "home_offensiveFlow",
    awayKey: "away_offensiveFlow",
  },
];

type PredictionPanelProps = {
  draft: PredictionDraftState;
  onDraftChange: Dispatch<SetStateAction<PredictionDraftState>>;
  workspace: DashboardWorkspace;
};

type NumericManualField =
  | "home_outsideScoring"
  | "home_insideScoring"
  | "home_outsideDefense"
  | "home_insideDefense"
  | "home_rebounding"
  | "home_offensiveFlow"
  | "away_outsideScoring"
  | "away_insideScoring"
  | "away_outsideDefense"
  | "away_insideDefense"
  | "away_rebounding"
  | "away_offensiveFlow"
  | "effortDelta";

type TextManualField = Exclude<keyof ManualPredictionInput, NumericManualField>;
type NumericConnectedOverrideField = "effortDelta";
type TextConnectedOverrideField = Exclude<
  keyof PredictionConnectedOverrides,
  NumericConnectedOverrideField
>;

const terminalStatuses = new Set(["SUCCEEDED", "FAILED"]);
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-2";
const formGridClassName = "grid gap-4 md:grid-cols-2";
const ratingGridClassName =
  "grid min-w-[32rem] grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.9fr))] gap-x-3 gap-y-3";

export function PredictionPanel({
  draft,
  onDraftChange,
  workspace,
}: PredictionPanelProps) {
  const [jobs, setJobs] = useState<PredictionJobRecord[]>([]);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mode = draft.mode;
  const manualInput = draft.manualInput;
  const connectedSelection = draft.connectedSelection;
  const connectedOverrides = draft.connectedOverrides;
  const forecastPrefill = draft.forecastPrefill;

  const homeMatchOptions = workspace.home.recentMatches.filter((match) =>
    Boolean(match.matchId && match.hasBoxscore),
  );
  const awayMatchOptions =
    workspace.scout.summary?.recentGames.filter((match) =>
      Boolean(match.matchId && match.hasBoxscore),
    ) ?? [];
  const defaultHomeSourceMatchId = homeMatchOptions[0]?.matchId ?? "";
  const defaultAwaySourceMatchId = awayMatchOptions[0]?.matchId ?? "";
  const homeTeamId = workspace.home.team.teamId ?? null;
  const awayTeamId =
    workspace.scout.summary?.matchupPerspective.opponentTeamId ?? null;

  useEffect(() => {
    onDraftChange((current) => {
      const nextHome =
        current.connectedSelection.homeSourceMatchId ||
        defaultHomeSourceMatchId;
      const nextAway =
        current.connectedSelection.awaySourceMatchId ||
        defaultAwaySourceMatchId;
      if (
        nextHome === current.connectedSelection.homeSourceMatchId &&
        nextAway === current.connectedSelection.awaySourceMatchId
      ) {
        return current;
      }

      return {
        ...current,
        connectedSelection: {
          homeSourceMatchId: nextHome,
          awaySourceMatchId: nextAway,
        },
      };
    });
  }, [defaultAwaySourceMatchId, defaultHomeSourceMatchId, onDraftChange]);

  useEffect(() => {
    void loadJobs();
  }, []);

  useEffect(() => {
    const hasActiveJob = jobs.some((job) => !terminalStatuses.has(job.status));
    if (!hasActiveJob) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadJobs();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [jobs]);

  async function loadJobs() {
    setIsLoadingJobs(true);
    const { data, errors } = await client.reads.getPredictionHistory({
      limit: 12,
    });

    if (errors?.length || !data) {
      setPredictionError(formatAmplifyErrors(errors));
      setJobs([]);
      setIsLoadingJobs(false);
      return;
    }

    const sorted = [...data.items].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    setJobs(sorted);
    setIsLoadingJobs(false);
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setPredictionError(null);

    const request = buildSubmissionRequest({
      awayTeamId,
      draft,
      homeTeamId,
    });

    const result = await client.mutations.submitPredictionJob({
      request,
    });

    if (result.errors?.length || !result.data) {
      setPredictionError(formatAmplifyErrors(result.errors));
      setIsSubmitting(false);
      return;
    }

    await loadJobs();
    setIsSubmitting(false);
  }

  function updateMode(nextMode: "CONNECTED" | "MANUAL") {
    onDraftChange((current) => ({
      ...current,
      mode: nextMode,
    }));
  }

  function updateConnectedSelection(
    field: keyof PredictionDraftState["connectedSelection"],
    nextValue: string,
  ) {
    onDraftChange((current) => ({
      ...current,
      connectedSelection: {
        ...current.connectedSelection,
        [field]: nextValue,
      },
    }));
  }

  function updateManualNumericField(
    field: NumericManualField,
    nextValue: string,
  ) {
    const parsed = Number(nextValue);
    onDraftChange((current) => ({
      ...current,
      manualInput: {
        ...current.manualInput,
        [field]: Number.isFinite(parsed) ? parsed : 0,
      },
    }));
  }

  function updateManualTextField(field: TextManualField, nextValue: string) {
    onDraftChange((current) => ({
      ...current,
      manualInput: {
        ...current.manualInput,
        [field]: nextValue,
      },
    }));
  }

  function updateConnectedNumericField(
    field: NumericConnectedOverrideField,
    nextValue: string,
  ) {
    const parsed = Number(nextValue);
    onDraftChange((current) => ({
      ...current,
      connectedOverrides: {
        ...current.connectedOverrides,
        [field]: Number.isFinite(parsed) ? parsed : 0,
      },
    }));
  }

  function updateConnectedTextField(
    field: TextConnectedOverrideField,
    nextValue: string,
  ) {
    onDraftChange((current) => ({
      ...current,
      connectedOverrides: {
        ...current.connectedOverrides,
        [field]: nextValue,
      },
    }));
  }

  function currentTextValue(
    manualField: TextManualField,
    connectedField?: TextConnectedOverrideField,
  ): string {
    if (mode === "MANUAL" || !connectedField) {
      return manualInput[manualField];
    }
    const overrideValue = connectedOverrides[connectedField];
    return typeof overrideValue === "string" && overrideValue
      ? overrideValue
      : manualInput[manualField];
  }

  function currentEffortValue(): number {
    if (mode === "MANUAL") {
      return manualInput.effortDelta;
    }
    return typeof connectedOverrides.effortDelta === "number"
      ? connectedOverrides.effortDelta
      : manualInput.effortDelta;
  }

  const connectedReady = Boolean(
    connectedSelection.homeSourceMatchId &&
    connectedSelection.awaySourceMatchId &&
    homeTeamId &&
    awayTeamId,
  );
  const latestJob = jobs.length ? jobs[0] : null;
  const latestExplanation = latestJob
    ? [
        ...describeResolvedInput(latestJob.resolvedInputSnapshot),
        summarizeForecastContext(
          extractForecastContextFromRequest(latestJob.request),
        ),
      ].filter((entry): entry is string => Boolean(entry))
    : [];
  const latestSuccessfulJob =
    jobs.find(
      (job) =>
        job.status === "SUCCEEDED" && Boolean(toPredictionResult(job.result)),
    ) ?? null;
  const latestSuccessfulResult = latestSuccessfulJob
    ? toPredictionResult(latestSuccessfulJob.result)
    : null;
  const latestTacticsGrid = latestSuccessfulResult?.tacticsGrid ?? null;
  const latestGridSelection = latestSuccessfulJob
    ? readPredictionGridSelection(latestSuccessfulJob.resolvedInputSnapshot)
    : null;
  const selectedGridPairSupported =
    latestTacticsGrid && latestGridSelection
      ? isPredictionGridSelectionSupported(
          latestTacticsGrid,
          latestGridSelection,
        )
      : false;
  const selectedGridCell =
    latestTacticsGrid && latestGridSelection && selectedGridPairSupported
      ? findPredictionGridCell(latestTacticsGrid, latestGridSelection)
      : null;
  const bestGridCell = latestTacticsGrid
    ? findBestPredictionGridCell(latestTacticsGrid)
    : null;
  const unsupportedSelectedAwayDefense =
    latestTacticsGrid &&
    latestGridSelection &&
    !latestTacticsGrid.defenses.includes(latestGridSelection.awayDefense)
      ? latestGridSelection.awayDefense
      : null;

  return (
    <Panel>
      <SectionHeading
        actions={
          <>
            <div
              aria-label="Prediction mode"
              className="inline-flex rounded-full bg-black/5 p-1"
              role="tablist"
            >
              <button
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition",
                  mode === "CONNECTED"
                    ? "bg-accent text-accent-contrast"
                    : "text-ink-muted hover:text-ink",
                )}
                onClick={() => updateMode("CONNECTED")}
                role="tab"
                type="button"
              >
                Box scores
              </button>
              <button
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition",
                  mode === "MANUAL"
                    ? "bg-accent text-accent-contrast"
                    : "text-ink-muted hover:text-ink",
                )}
                onClick={() => updateMode("MANUAL")}
                role="tab"
                type="button"
              >
                Manual
              </button>
            </div>
            <Button
              disabled={mode === "CONNECTED" && !connectedReady}
              loading={isSubmitting}
              onClick={() => void handleSubmit()}
            >
              {mode === "CONNECTED"
                ? "Run box-score preview"
                : "Run manual preview"}
            </Button>
          </>
        }
        eyebrow="Predictions"
        title="Matchup preview"
      />

      <p className={statusCopyClassName}>
        Use saved box scores for a faster preview, or fill in the matchup
        yourself when you want full control.
      </p>

      {predictionError ? <Alert>{predictionError}</Alert> : null}

      {forecastPrefill ? (
        <Alert tone="note">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <strong className="text-ink text-sm">
                Forecast prefill: {forecastPrefill.context.scenarioLabel} (
                {formatPercent(forecastPrefill.context.scenarioProbability)})
              </strong>
              <span className="text-ink-muted text-sm">
                Model {forecastPrefill.context.forecastModelVersion} • Generated{" "}
                {formatTimestamp(forecastPrefill.context.forecastGeneratedAt)} •
                Effort is mapped relative to a Normal home effort.
              </span>
            </div>
            <Button
              onClick={() =>
                onDraftChange((current) => clearForecastPrefill(current))
              }
              size="sm"
              variant="secondary"
            >
              Clear forecast prefill
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className={twoColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description="Choose one recent game for your club and one for the opponent. The preview reuses the ratings saved from those box scores."
            title="Saved game sources"
            titleAs="h4"
          />

          <div className={formGridClassName}>
            <Field label="Your source game">
              <Select
                onChange={(event) =>
                  updateConnectedSelection(
                    "homeSourceMatchId",
                    event.target.value,
                  )
                }
                value={connectedSelection.homeSourceMatchId}
              >
                <option value="">Select a recent club game</option>
                {homeMatchOptions.map((match) => (
                  <option key={match.matchId} value={match.matchId ?? ""}>
                    {formatMatchOption(
                      match.opponentTeamName,
                      match.startTime,
                      match.teamScore,
                      match.opponentScore,
                    )}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Opponent source game">
              <Select
                onChange={(event) =>
                  updateConnectedSelection(
                    "awaySourceMatchId",
                    event.target.value,
                  )
                }
                value={connectedSelection.awaySourceMatchId}
              >
                <option value="">Select a recent opponent game</option>
                {awayMatchOptions.map((match) => (
                  <option key={match.matchId} value={match.matchId ?? ""}>
                    {formatMatchOption(
                      match.opponentTeamName,
                      match.startTime,
                      match.teamScore,
                      match.opponentScore,
                    )}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              detail="Uses your saved club data."
              label="Your team"
              value={workspace.home.team.teamName ?? "Unavailable"}
            />
            <StatCard
              detail={
                awayMatchOptions.length
                  ? `${awayMatchOptions.length} recent opponent games ready`
                  : "Refresh club data to load opponent examples."
              }
              label="Opponent"
              value={workspace.scout.summary?.teamName ?? "No saved opponent"}
            />
          </div>
        </Panel>

        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description="Ratings are required for manual previews and act as a fallback when saved games are unavailable."
            title={
              mode === "MANUAL"
                ? "Manual matchup input"
                : "Manual fallback input"
            }
            titleAs="h4"
          />

          <div className="overflow-x-auto">
            <div className={ratingGridClassName}>
              <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                Metric
              </div>
              <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                Home
              </div>
              <div className="text-ink-muted text-[0.78rem] font-bold tracking-[0.08em] uppercase">
                Away
              </div>
              {RATING_FIELDS.map((field) => (
                <div className="contents" key={field.label}>
                  <span className="text-ink font-semibold">{field.label}</span>
                  <Input
                    className="font-semibold"
                    onChange={(event) =>
                      updateManualNumericField(
                        field.homeKey,
                        event.target.value,
                      )
                    }
                    style={buzzerBeaterColorStyle({
                      scale: "team_rating",
                      value: manualInput[field.homeKey],
                    })}
                    step="0.1"
                    type="number"
                    value={manualInput[field.homeKey]}
                  />
                  <Input
                    className="font-semibold"
                    onChange={(event) =>
                      updateManualNumericField(
                        field.awayKey,
                        event.target.value,
                      )
                    }
                    style={buzzerBeaterColorStyle({
                      scale: "team_rating",
                      value: manualInput[field.awayKey],
                    })}
                    step="0.1"
                    type="number"
                    value={manualInput[field.awayKey]}
                  />
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className={twoColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Tactics" titleAs="h4" />
          <div className={formGridClassName}>
            <Field label="Home offense">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField(
                        "home_offStrategy",
                        event.target.value,
                      )
                    : updateConnectedTextField(
                        "home_offStrategy",
                        event.target.value,
                      )
                }
                value={currentTextValue("home_offStrategy", "home_offStrategy")}
              >
                {OFFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Home defense">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField(
                        "home_defStrategy",
                        event.target.value,
                      )
                    : updateConnectedTextField(
                        "home_defStrategy",
                        event.target.value,
                      )
                }
                value={currentTextValue("home_defStrategy", "home_defStrategy")}
              >
                {DEFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Away offense">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField(
                        "away_offStrategy",
                        event.target.value,
                      )
                    : updateConnectedTextField(
                        "away_offStrategy",
                        event.target.value,
                      )
                }
                value={currentTextValue("away_offStrategy", "away_offStrategy")}
              >
                {OFFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Away defense">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField(
                        "away_defStrategy",
                        event.target.value,
                      )
                    : updateConnectedTextField(
                        "away_defStrategy",
                        event.target.value,
                      )
                }
                value={currentTextValue("away_defStrategy", "away_defStrategy")}
              >
                {DEFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Home GDP focus">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField(
                        "home_gdp_focus",
                        event.target.value,
                      )
                    : updateConnectedTextField(
                        "home_gdp_focus",
                        event.target.value,
                      )
                }
                value={currentTextValue("home_gdp_focus", "home_gdp_focus")}
              >
                {GDP_FOCUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Home GDP pace">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField("home_gdp_pace", event.target.value)
                    : updateConnectedTextField(
                        "home_gdp_pace",
                        event.target.value,
                      )
                }
                value={currentTextValue("home_gdp_pace", "home_gdp_pace")}
              >
                {GDP_PACE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Away GDP focus">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField(
                        "away_gdp_focus",
                        event.target.value,
                      )
                    : updateConnectedTextField(
                        "away_gdp_focus",
                        event.target.value,
                      )
                }
                value={currentTextValue("away_gdp_focus", "away_gdp_focus")}
              >
                {GDP_FOCUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Away GDP pace">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField("away_gdp_pace", event.target.value)
                    : updateConnectedTextField(
                        "away_gdp_pace",
                        event.target.value,
                      )
                }
                value={currentTextValue("away_gdp_pace", "away_gdp_pace")}
              >
                {GDP_PACE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Game context" titleAs="h4" />
          <div className={formGridClassName}>
            <Field label="Neutral site">
              <Select
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualTextField("neutral", event.target.value)
                    : updateConnectedTextField("neutral", event.target.value)
                }
                value={currentTextValue("neutral", "neutral")}
              >
                <option value="0">Home court</option>
                <option value="1">Neutral site</option>
              </Select>
            </Field>
            <Field label="Effort delta">
              <Input
                max={2}
                min={-2}
                onChange={(event) =>
                  mode === "MANUAL"
                    ? updateManualNumericField(
                        "effortDelta",
                        event.target.value,
                      )
                    : updateConnectedNumericField(
                        "effortDelta",
                        event.target.value,
                      )
                }
                step={1}
                type="number"
                value={currentEffortValue()}
              />
            </Field>
          </div>

          {latestJob ? (
            <div className="rounded-card grid gap-2 border border-black/5 bg-white/65 p-4">
              <StatusBadge tone={statusToneFromValue(latestJob.status)}>
                {formatPreviewStatus(latestJob.status)}
              </StatusBadge>
              <strong className="text-ink text-base">
                {describePredictionJob(latestJob)}
              </strong>
              <span className="text-ink-muted text-sm">
                Updated {formatTimestamp(latestJob.updatedAt)}
              </span>
              {latestExplanation.length ? (
                <div className="flex flex-wrap gap-2">
                  {latestExplanation.map((item) => (
                    <span
                      className="bg-note-bg text-note inline-flex rounded-full px-3 py-1.5 text-sm font-semibold"
                      key={item}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className={statusCopyClassName}>
              No previews have been run yet.
            </p>
          )}
        </Panel>
      </div>

      {latestTacticsGrid ? (
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description="Rows show opponent defense. Columns show your offense."
            title="Tactic matchup grid"
            titleAs="h4"
          />

          <div className="grid gap-3">
            {bestGridCell && bestGridCell.pointDiff !== null ? (
              <Alert tone="note">
                Best shown matchup: {bestGridCell.homeOffense} vs{" "}
                {bestGridCell.awayDefense} (
                {formatSigned(bestGridCell.pointDiff)})
              </Alert>
            ) : null}

            <span className={statusCopyClassName}>
              Latest successful preview updated{" "}
              {formatTimestamp(latestSuccessfulJob?.updatedAt)}
            </span>

            {unsupportedSelectedAwayDefense ? (
              <Alert tone="note">
                The grid covers ML-supported opponent defenses only, so{" "}
                {unsupportedSelectedAwayDefense} is not included in the
                comparison set.
              </Alert>
            ) : null}
          </div>

          <TableShell className="mt-4" tableClassName="min-w-[56rem]">
            <thead>
              <tr>
                <TableHeadCell className="bg-surface sticky left-0 z-10">
                  Opponent defense
                </TableHeadCell>
                {latestTacticsGrid.offenses.map((offense) => (
                  <TableHeadCell className="text-center" key={offense}>
                    {offense}
                  </TableHeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {latestTacticsGrid.defenses.map((defense, rowIndex) => {
                const row = latestTacticsGrid.cells[rowIndex] ?? [];

                return (
                  <tr key={defense}>
                    <TableCell className="bg-surface sticky left-0 z-10 font-semibold">
                      {defense}
                    </TableCell>
	                    {row.map((cell) => {
	                      const isSelected =
	                        selectedGridCell?.homeOffense === cell.homeOffense &&
	                        selectedGridCell.awayDefense === cell.awayDefense;

                      return (
                        <TableCell
                          className="min-w-[8.5rem] text-center"
                          key={cell.homeOffense}
                        >
                          <div
                            className={cn(
                              "rounded-card grid gap-1 border px-2 py-2",
                              isSelected
                                ? "border-accent bg-accent/10 shadow-sm"
                                : "border-black/8",
                            )}
                            style={predictionGridCellStyle(cell.pointDiff)}
                          >
                            <strong className="text-ink text-sm">
                              {formatGridScore(cell)}
                            </strong>
                            <span className="text-ink-muted text-xs font-semibold">
                              {formatGridDiff(cell)}
                            </span>
                            {isSelected ? (
                              <span className="text-accent text-[0.68rem] font-bold tracking-[0.1em] uppercase">
                                Current
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        </Panel>
      ) : null}

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading title="Recent previews" titleAs="h4" />
        {isLoadingJobs ? (
          <p className={statusCopyClassName}>Loading recent preview history.</p>
        ) : jobs.length ? (
          <ul className={listClassName}>
            {jobs.map((job) => {
              const forecastContext = extractForecastContextFromRequest(
                job.request,
              );
              return (
                <li className={listItemClassName} key={job.id}>
                  <strong className="text-ink text-sm">
                    {describePredictionJob(job)}
                  </strong>
                  <span className={statusCopyClassName}>
                    {formatPreviewStatus(job.status)} •{" "}
                    {formatTimestamp(job.updatedAt)}
                    {job.error ? ` • ${job.error}` : ""}
                  </span>
                  {forecastContext ? (
                    <span className="text-note text-xs font-semibold tracking-[0.12em] uppercase">
                      Forecast {forecastContext.scenarioLabel} •{" "}
                      {formatPercent(forecastContext.scenarioProbability)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={statusCopyClassName}>No preview history yet.</p>
        )}
      </Panel>
    </Panel>
  );
}

function describePredictionJob(job: PredictionJobRecord): string {
  const result = toPredictionResult(job.result);
  if (result) {
    return `${result.homeScore.toFixed(1)} - ${result.awayScore.toFixed(1)} (${formatSigned(result.pointDiff)})`;
  }

  if (job.error) {
    return "Preview needs attention";
  }

  return job.mode === "CONNECTED" ? "Saved-game preview" : "Manual preview";
}

function describeResolvedInput(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const snapshot = value as Partial<Record<string, unknown>>;
  const notes = [
    summarizeStrategy(snapshot, "home", "Home"),
    summarizeStrategy(snapshot, "away", "Away"),
    summarizeVenue(snapshot.neutral),
    summarizeEffort(snapshot.effortDelta),
    summarizeMatchupEdge(
      "Perimeter",
      snapshot.home_outsideScoring,
      snapshot.away_outsideDefense,
    ),
    summarizeMatchupEdge(
      "Interior",
      snapshot.home_insideScoring,
      snapshot.away_insideDefense,
    ),
    summarizeMatchupEdge(
      "Boards",
      snapshot.home_rebounding,
      snapshot.away_rebounding,
      false,
    ),
  ].filter((note): note is string => Boolean(note));

  return notes.slice(0, 6);
}

function formatAmplifyErrors(
  errors: Array<{ message?: string }> | null | undefined,
): string {
  if (!errors?.length) {
    return "The operation failed without a detailed error message.";
  }

  return errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMatchOption(
  opponentTeamName: string | null | undefined,
  startTime: string | null | undefined,
  teamScore: number | null | undefined,
  opponentScore: number | null | undefined,
): string {
  const result =
    teamScore !== null && opponentScore !== null
      ? ` • ${teamScore}-${opponentScore}`
      : "";
  return `${opponentTeamName ?? "Unknown opponent"} • ${formatTimestamp(startTime)}${result}`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function summarizeStrategy(
  snapshot: Partial<Record<string, unknown>>,
  side: "home" | "away",
  label: string,
): string | null {
  const offense = asOptionalString(snapshot[`${side}_offStrategy`]);
  const defense = asOptionalString(snapshot[`${side}_defStrategy`]);
  if (!offense && !defense) {
    return null;
  }

  return `${label} ${offense ?? "Base"} / ${defense ?? "ManToMan"}`;
}

function summarizeVenue(value: unknown): string | null {
  const normalized = asOptionalString(value);
  if (!normalized) {
    return null;
  }

  return normalized === "1" ? "Neutral site" : "Home court";
}

function summarizeEffort(value: unknown): string | null {
  const numeric = asOptionalNumber(value);
  if (numeric === null || numeric === 0) {
    return null;
  }

  return `Effort Δ ${numeric > 0 ? `+${numeric}` : numeric}`;
}

function summarizeMatchupEdge(
  label: string,
  offense: unknown,
  defense: unknown,
  treatAsDefense = true,
): string | null {
  const offenseValue = asOptionalNumber(offense);
  const defenseValue = asOptionalNumber(defense);

  if (offenseValue === null || defenseValue === null) {
    return null;
  }

  const diff = treatAsDefense
    ? offenseValue - defenseValue
    : offenseValue - defenseValue;
  return `${label} ${formatSigned(diff)}`;
}

function summarizeForecastContext(
  value: ReturnType<typeof extractForecastContextFromRequest>,
): string | null {
  if (!value) {
    return null;
  }
  return `Forecast ${value.scenarioLabel} ${formatPercent(value.scenarioProbability)}`;
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

function formatGridScore(cell: PredictionGridCell): string {
  if (cell.homeScore === null || cell.awayScore === null) {
    return "Unavailable";
  }

  return `${cell.homeScore.toFixed(1)}-${cell.awayScore.toFixed(1)}`;
}

function formatGridDiff(cell: PredictionGridCell): string {
  if (cell.pointDiff === null) {
    return "No result";
  }

  return formatSigned(cell.pointDiff);
}

function predictionGridCellStyle(pointDiff: number | null) {
  if (pointDiff === null) {
    return undefined;
  }

  const alpha = Math.min(0.28, 0.08 + Math.abs(pointDiff) / 24);
  return {
    backgroundColor:
      pointDiff >= 0
        ? `rgba(20, 138, 95, ${alpha.toFixed(3)})`
        : `rgba(184, 55, 64, ${alpha.toFixed(3)})`,
  };
}
