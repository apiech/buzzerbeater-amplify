"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  boxscoreQueryOptions,
  currentPredictionQueryOptions,
  submitPredictionJobMutation,
  workspaceQueryKeys,
} from "@/app/dashboard/workspace-query-client";
import {
  findBestPredictionGridCell,
  hasRenderablePredictionGrid,
} from "@/app/prediction-result";
import {
  buildSubmissionRequest,
  clearForecastPrefill,
  createDefaultPredictionInput,
} from "@/app/prediction-panel-state";
import type {
  CurrentPredictionPreview,
  MatchBoxscorePayload,
  PredictionDraftState,
  PredictionGridCell,
  PredictionPanelContext,
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
import {
  applyBoxscoreRatingsToPredictionInput,
  PREDICTION_HOME_COURT_FACTOR,
} from "@/lib/prediction/normalization";

export { buildSubmissionRequest, createDefaultPredictionInput };

const RATING_FIELDS: Array<{
  label: string;
  homeKey: NumericPredictionField;
  awayKey: NumericPredictionField;
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
  context: PredictionPanelContext;
  draft: PredictionDraftState;
  onDraftChange: Dispatch<SetStateAction<PredictionDraftState>>;
};

type NumericPredictionField =
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

type SourceSide = "home" | "away";
type TeamLocation = "HOME" | "AWAY";

const terminalPredictionStatuses = new Set(["SUCCEEDED", "FAILED"]);
const formGridClassName = "grid gap-4 md:grid-cols-2";
const ratingGridClassName =
  "grid min-w-[32rem] grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.9fr))] gap-x-3 gap-y-3";
const sourceCardClassName =
  "rounded-card grid gap-3 border border-black/8 bg-white/70 p-4";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-2";
const incompletePredictionResultMessage =
  "Prediction completed without any usable tactics-grid cells. Rerun the preview.";

export function PredictionPanel({
  context,
  draft,
  onDraftChange,
}: PredictionPanelProps) {
  const queryClient = useQueryClient();
  const predictionFormId = useId();
  const predictionMatrixRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedPredictionLoadRef = useRef(false);
  const previousRenderablePredictionKeyRef = useRef<string | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState<SourceSide | null>(null);
  const currentPredictionQuery = useQuery({
    ...currentPredictionQueryOptions(),
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot || terminalPredictionStatuses.has(snapshot.status)) {
        return false;
      }

      return 4000;
    },
  });
  const submitPredictionMutation = useMutation({
    mutationFn: (request: unknown) => submitPredictionJobMutation({ request }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.currentPrediction,
      });
    },
  });

  const input = draft.input;
  const forecastPrefill = draft.forecastPrefill;
  const sourceSelection = draft.sourceSelection;

  const homeMatchOptions = context.home.recentMatches.filter((match) =>
    Boolean(match.matchId && match.hasBoxscore),
  );
  const awayMatchOptions =
    context.scoutSummary?.recentGames.filter((match) =>
      Boolean(match.matchId && match.hasBoxscore),
    ) ?? [];
  const defaultHomeSourceMatchId = homeMatchOptions[0]?.matchId ?? "";
  const defaultAwaySourceMatchId = awayMatchOptions[0]?.matchId ?? "";
  const homeTeamId = context.home.team.teamId ?? null;
  const awayTeamId =
    context.scoutSummary?.matchupPerspective.opponentTeamId ?? null;
  const currentPrediction = currentPredictionQuery.data ?? null;
  const currentPredictionRequestId = currentPrediction?.requestId ?? null;
  const currentPredictionUpdatedAt = currentPrediction?.updatedAt ?? null;
  const currentResult = readPredictionResult(currentPrediction);
  const currentGrid = currentPrediction?.tacticsGrid ?? null;
  const canRenderCurrentGrid = hasRenderablePredictionGrid(currentGrid);
  const currentPredictionIssue =
    currentPrediction?.error ??
    (currentPrediction?.status === "SUCCEEDED" && !canRenderCurrentGrid
      ? incompletePredictionResultMessage
      : null);
  const currentPredictionStatus =
    currentPrediction?.status === "SUCCEEDED" && !canRenderCurrentGrid
      ? "FAILED"
      : currentPrediction?.status;
  const currentPredictionSummary = currentPrediction
    ? describePredictionSummary({
        issue: currentPredictionIssue,
        result: currentResult,
        status: currentPrediction.status,
        tacticsGridReady: canRenderCurrentGrid,
      })
    : null;
  const bestGridCell = canRenderCurrentGrid
    ? findBestPredictionGridCell(currentGrid)
    : null;
  const forecastContext = currentPrediction?.forecastContext ?? null;

  useEffect(() => {
    onDraftChange((current) => {
      const nextHome =
        current.sourceSelection.homeSourceMatchId || defaultHomeSourceMatchId;
      const nextAway =
        current.sourceSelection.awaySourceMatchId || defaultAwaySourceMatchId;
      if (
        nextHome === current.sourceSelection.homeSourceMatchId &&
        nextAway === current.sourceSelection.awaySourceMatchId
      ) {
        return current;
      }

      return {
        ...current,
        sourceSelection: {
          homeSourceMatchId: nextHome,
          awaySourceMatchId: nextAway,
        },
      };
    });
  }, [defaultAwaySourceMatchId, defaultHomeSourceMatchId, onDraftChange]);

  useEffect(() => {
    if (currentPredictionQuery.isPending) {
      return;
    }

    const currentRenderablePredictionKey =
      currentPredictionRequestId && canRenderCurrentGrid
        ? `${currentPredictionRequestId}:${currentPredictionUpdatedAt}`
        : null;

    if (!hasInitializedPredictionLoadRef.current) {
      hasInitializedPredictionLoadRef.current = true;
      previousRenderablePredictionKeyRef.current = currentRenderablePredictionKey;
      return;
    }

    const previousRenderablePredictionKey =
      previousRenderablePredictionKeyRef.current;
    previousRenderablePredictionKeyRef.current = currentRenderablePredictionKey;
    if (
      previousRenderablePredictionKey !== null ||
      currentRenderablePredictionKey === null
    ) {
      return;
    }

    predictionMatrixRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [
    canRenderCurrentGrid,
    currentPredictionRequestId,
    currentPredictionUpdatedAt,
    currentPredictionQuery.isPending,
  ]);

  async function handleSubmit() {
    if (submitPredictionMutation.isPending) {
      return;
    }

    setPredictionError(null);

    try {
      await submitPredictionMutation.mutateAsync(
        buildSubmissionRequest({ draft }),
      );
      await currentPredictionQuery.refetch();
    } catch (error) {
      setPredictionError(formatClientError(error));
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmit();
  }

  async function handleLoadSource(side: SourceSide) {
    const matchId =
      side === "home"
        ? sourceSelection.homeSourceMatchId
        : sourceSelection.awaySourceMatchId;
    const teamId = side === "home" ? homeTeamId : awayTeamId;

    if (!matchId) {
      setPredictionError(
        `Select a ${side === "home" ? "home" : "away"} source game first.`,
      );
      return;
    }
    if (!teamId) {
      setPredictionError(
        `${side === "home" ? "Home" : "Away"} team metadata is unavailable.`,
      );
      return;
    }

    setIsLoadingSource(side);
    setPredictionError(null);

    try {
      const payload = await queryClient.fetchQuery(
        boxscoreQueryOptions({ matchId }),
      );
      if (!payload) {
        throw new Error("The selected box score is unavailable.");
      }

      const resolvedSource = resolvePredictionSourceTeam(payload, teamId);
      onDraftChange((current) => ({
        ...current,
        input: applyBoxscoreRatingsToPredictionInput({
          input: current.input,
          side,
          sourceTeam: resolvedSource.sourceTeam,
          teamLocation: resolvedSource.teamLocation,
        }),
      }));
    } catch (error) {
      setPredictionError(formatClientError(error));
    } finally {
      setIsLoadingSource(null);
    }
  }

  const isLoadingPrediction = currentPredictionQuery.isPending;
  const isSubmitting = submitPredictionMutation.isPending;
  const effectivePredictionError =
    predictionError ??
    readQueryError(currentPredictionQuery.error) ??
    readQueryError(submitPredictionMutation.error);

  function updateSourceSelection(field: "homeSourceMatchId" | "awaySourceMatchId", value: string) {
    onDraftChange((current) => ({
      ...current,
      sourceSelection: {
        ...current.sourceSelection,
        [field]: value,
      },
    }));
  }

  function updateNumericField(field: NumericPredictionField, nextValue: string) {
    const parsed = Number(nextValue);
    onDraftChange((current) => ({
      ...current,
      input: {
        ...current.input,
        [field]: Number.isFinite(parsed) ? parsed : 0,
      },
    }));
  }

  function updateVenue(nextValue: string) {
    onDraftChange((current) => ({
      ...current,
      input: {
        ...current.input,
        neutral: nextValue,
      },
    }));
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button form={predictionFormId} loading={isSubmitting} type="submit">
            Run preview
          </Button>
        }
        eyebrow="Predictions"
        title="Matchup preview"
      />

      <p className={statusCopyClassName}>
        The ratings grid is the source of truth. Loading a saved box score only
        prefills that grid after removing source tactics and home-court effects
        back to a Base offense / Man-to-man defense baseline.
      </p>

      {effectivePredictionError ? <Alert>{effectivePredictionError}</Alert> : null}

      {forecastPrefill ? (
        <Alert tone="note">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <strong className="text-sm text-ink">
                Forecast prefill: {forecastPrefill.context.scenarioLabel} (
                {formatPercent(forecastPrefill.context.scenarioProbability)})
              </strong>
              <span className="text-sm text-ink-muted">
                Model {forecastPrefill.context.forecastModelVersion} • Generated{" "}
                {formatTimestamp(forecastPrefill.context.forecastGeneratedAt)} •
                Effort stays relative to a Normal home effort.
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

      <form className="grid gap-4" id={predictionFormId} onSubmit={handleFormSubmit}>
        <div className={twoColumnGridClassName}>
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Choose a saved game for each side, then load normalized ratings into the editable grid."
              title="Load from boxscore"
              titleAs="h4"
            />

            <div className={formGridClassName}>
              <div className={sourceCardClassName}>
                <Field label="Home source game">
                  <Select
                    onChange={(event) =>
                      updateSourceSelection("homeSourceMatchId", event.target.value)
                    }
                    value={sourceSelection.homeSourceMatchId}
                  >
                    <option value="">Select a recent home-side game</option>
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
                <Button
                  disabled={!sourceSelection.homeSourceMatchId || !homeTeamId}
                  loading={isLoadingSource === "home"}
                  onClick={() => void handleLoadSource("home")}
                  type="button"
                  variant="secondary"
                >
                  Load home ratings
                </Button>
              </div>

              <div className={sourceCardClassName}>
                <Field label="Away source game">
                  <Select
                    onChange={(event) =>
                      updateSourceSelection("awaySourceMatchId", event.target.value)
                    }
                    value={sourceSelection.awaySourceMatchId}
                  >
                    <option value="">Select a recent away-side game</option>
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
                <Button
                  disabled={!sourceSelection.awaySourceMatchId || !awayTeamId}
                  loading={isLoadingSource === "away"}
                  onClick={() => void handleLoadSource("away")}
                  type="button"
                  variant="secondary"
                >
                  Load away ratings
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <StatCard
                detail="Saved box scores are a shortcut only. You can still edit every number below."
                label="Home team"
                value={context.home.team.teamName ?? "Unavailable"}
              />
              <StatCard
                detail={
                  awayMatchOptions.length
                    ? `${awayMatchOptions.length} saved opponent games available`
                    : "Refresh workspace data to load opponent box scores."
                }
                label="Away team"
                value={context.scoutSummary?.teamName ?? "No saved opponent"}
              />
            </div>
          </Panel>

          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="One current preview is stored per user. Reopening the page loads it immediately."
              title="Current preview"
              titleAs="h4"
            />

            {isLoadingPrediction ? (
              <p className={statusCopyClassName}>Loading current preview.</p>
            ) : currentPrediction ? (
              <div className="grid gap-4">
                <div className="rounded-card grid gap-2 border border-black/8 bg-white/70 p-4">
                  <StatusBadge tone={statusToneFromValue(currentPredictionStatus)}>
                    {formatPreviewStatus(currentPredictionStatus)}
                  </StatusBadge>
                  <strong className="text-base text-ink">
                    {currentPredictionSummary}
                  </strong>
                  <span className="text-sm text-ink-muted">
                    Updated {formatTimestamp(currentPrediction.updatedAt)}
                  </span>
                </div>

                {currentPredictionIssue ? (
                  <Alert>{currentPredictionIssue}</Alert>
                ) : null}

                {bestGridCell ? (
                  <Alert tone="note">
                    Best shown matchup: {bestGridCell.homeOffense} vs{" "}
                    {bestGridCell.awayDefense} ({formatSigned(bestGridCell.pointDiff ?? 0)}
                    )
                  </Alert>
                ) : null}

                {forecastContext ? (
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex rounded-full bg-note-bg px-3 py-1.5 text-sm font-semibold text-note">
                      Forecast {forecastContext.scenarioLabel}
                    </span>
                    <span className="inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold text-ink-muted">
                      {formatPercent(forecastContext.scenarioProbability)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className={statusCopyClassName}>
                No preview has been run yet.
              </p>
            )}
          </Panel>
        </div>

        <div className={twoColumnGridClassName}>
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description={`Editable baseline ratings. Source loads remove tactics and the ${PREDICTION_HOME_COURT_FACTOR.toFixed(2)} home-court factor before writing here.`}
              title="Ratings grid"
              titleAs="h4"
            />

            <div className="overflow-x-auto">
              <div className={ratingGridClassName}>
                <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                  Metric
                </div>
                <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                  Home
                </div>
                <div className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                  Away
                </div>
                {RATING_FIELDS.map((field) => (
                  <div className="contents" key={field.label}>
                    <span className="font-semibold text-ink">{field.label}</span>
                    <Input
                      className="font-semibold"
                      onChange={(event) =>
                        updateNumericField(field.homeKey, event.target.value)
                      }
                      step="0.1"
                      style={buzzerBeaterColorStyle({
                        scale: "team_rating",
                        value: input[field.homeKey],
                      })}
                      type="number"
                      value={input[field.homeKey]}
                    />
                    <Input
                      className="font-semibold"
                      onChange={(event) =>
                        updateNumericField(field.awayKey, event.target.value)
                      }
                      step="0.1"
                      style={buzzerBeaterColorStyle({
                        scale: "team_rating",
                        value: input[field.awayKey],
                      })}
                      type="number"
                      value={input[field.awayKey]}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Venue and effort stay configurable. Tactics are compared in the result matrix instead of separate selectors."
              title="Simulation context"
              titleAs="h4"
            />

            <div className={formGridClassName}>
              <Field label="Venue">
                <Select
                  onChange={(event) => updateVenue(event.target.value)}
                  value={input.neutral}
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
                    updateNumericField("effortDelta", event.target.value)
                  }
                  step={1}
                  type="number"
                  value={input.effortDelta}
                />
              </Field>
            </div>

            <p className={statusCopyClassName}>
              GDP inputs are temporarily unavailable because the current
              released model does not use GDP features.
            </p>

            <p className={statusCopyClassName}>
              Hidden fixed tactics stay locked to Base offense and Man-to-man
              defense while the matrix compares home offense against away defense.
            </p>
          </Panel>
        </div>
      </form>

      {canRenderCurrentGrid ? (
        <div ref={predictionMatrixRef}>
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              description="Rows show opponent defense. Columns show your offense."
              title="Outcome matrix"
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
                Current preview updated {formatTimestamp(currentPrediction?.updatedAt)}
              </span>
            </div>

            <TableShell className="mt-4" tableClassName="min-w-[56rem]">
              <thead>
                <tr>
                  <TableHeadCell className="bg-surface sticky left-0 z-10">
                    Opponent defense
                  </TableHeadCell>
                  {currentGrid.offenses.map((offense) => (
                    <TableHeadCell className="text-center" key={offense}>
                      {offense}
                    </TableHeadCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentGrid.defenses.map((defense, rowIndex) => {
                  const row = currentGrid.cells[rowIndex] ?? [];

                  return (
                    <tr key={defense}>
                      <TableCell className="bg-surface sticky left-0 z-10 font-semibold">
                        {defense}
                      </TableCell>
                      {row.map((cell) => {
                        const isBestCell =
                          bestGridCell?.homeOffense === cell.homeOffense &&
                          bestGridCell.awayDefense === cell.awayDefense;

                        return (
                          <TableCell
                            className="min-w-[8.5rem] text-center"
                            key={cell.homeOffense}
                          >
                            <div
                              className={cn(
                                "rounded-card grid gap-1 border px-2 py-2",
                                isBestCell
                                  ? "border-accent bg-accent/10 shadow-sm"
                                  : "border-black/8",
                              )}
                              style={predictionGridCellStyle(cell.pointDiff)}
                            >
                              <strong className="text-sm text-ink">
                                {formatGridScore(cell)}
                              </strong>
                              <span className="text-xs font-semibold text-ink-muted">
                                {formatGridDiff(cell)}
                              </span>
                              {isBestCell ? (
                                <span className="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-accent">
                                  Best
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
        </div>
      ) : null}
    </Panel>
  );
}

function resolvePredictionSourceTeam(
  payload: MatchBoxscorePayload,
  targetTeamId: string,
): {
  sourceTeam: NonNullable<MatchBoxscorePayload["homeTeam"]>;
  teamLocation: TeamLocation;
} {
  if (payload.homeTeam?.teamId === targetTeamId) {
    return {
      sourceTeam: payload.homeTeam,
      teamLocation: "HOME",
    };
  }

  if (payload.awayTeam?.teamId === targetTeamId) {
    return {
      sourceTeam: payload.awayTeam,
      teamLocation: "AWAY",
    };
  }

  throw new Error("The selected box score does not contain the expected team.");
}

function describePredictionSummary(input: {
  issue: string | null;
  result:
    | {
        awayScore: number;
        homeScore: number;
        pointDiff: number;
      }
    | null;
  status: string | null | undefined;
  tacticsGridReady: boolean;
}): string {
  const { issue, result, status, tacticsGridReady } = input;
  if (result) {
    return `${result.homeScore.toFixed(1)} - ${result.awayScore.toFixed(1)} (${formatSigned(result.pointDiff)})`;
  }

  if (tacticsGridReady) {
    return "Tactics grid ready";
  }

  if (issue || status === "FAILED") {
    return "Preview needs attention";
  }

  return "Preview in progress";
}

function readPredictionResult(
  prediction: CurrentPredictionPreview | null,
): {
  awayScore: number;
  homeScore: number;
  pointDiff: number;
} | null {
  if (
    !prediction ||
    prediction.homeScore === null ||
    prediction.homeScore === undefined ||
    prediction.awayScore === null ||
    prediction.awayScore === undefined ||
    prediction.pointDiff === null ||
    prediction.pointDiff === undefined
  ) {
    return null;
  }

  return {
    awayScore: prediction.awayScore,
    homeScore: prediction.homeScore,
    pointDiff: prediction.pointDiff,
  };
}

function readQueryError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.trim();
  return message.length ? message : null;
}

function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
