"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  lineupHelperEvaluationQueryOptions,
  lineupHelperWorkspaceQueryOptions,
  optimizeLineupHelperQuery,
} from "@/app/dashboard/workspace-query-client";
import {
  LINEUP_POSITION_LABELS,
  LINEUP_POSITIONS,
  LINEUP_ROLE_SEQUENCE,
  LINEUP_SPLIT_PATTERNS,
  assignmentsFromLineupLayout,
  coerceEnthusiasm,
  emptyLineupLayout,
  isIdentityDefensiveSwitch,
  lineupRuleSummary,
  lineupLayoutFromAssignments,
  minutesForRole,
  normalizeHelperContext,
  roleIsEnabled,
  validateLineupLayout,
  type LineupSlotLayout,
} from "@/app/lineup-helper-state";
import type {
  LineupHelperAlgorithm,
  DecodedLineupHelperWorkspace,
  LineupHelperAssignment,
  LineupHelperContext,
  LineupHelperEvaluation,
  LineupHelperEvaluationRecord,
  LineupHelperRankingEntry,
  LineupHelperRosterPlayer,
  LineupHelperSkillRatings,
  LineupHelperWorkspaceRecord,
  PositionCode,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { BuzzerBeaterRatingText } from "@/app/ui/primitives/buzzerbeater-rating-text";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import { StatusBadge } from "@/app/ui/primitives/status-badge";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";
import { allScaleValues } from "@/lib/buzzerbeater/rating-scale";

const ratingLabels: Array<{
  key: keyof LineupHelperEvaluation["rawRatings"];
  label: string;
}> = [
  { key: "outsideScoring", label: "Outside scoring" },
  { key: "insideScoring", label: "Inside scoring" },
  { key: "outsideDefense", label: "Outside defense" },
  { key: "insideDefense", label: "Inside defense" },
  { key: "rebounding", label: "Rebounding" },
  { key: "offensiveFlow", label: "Offensive flow" },
];

const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const twoColumnGridClassName =
  "grid gap-4 2xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,1fr)]";
const rankingsGridClassName = "grid gap-4 lg:grid-cols-2 xl:grid-cols-3";
const EMPTY_ROSTER: LineupHelperRosterPlayer[] = [];
const ENTHUSIASM_OPTIONS = [...allScaleValues("enthusiasm")].reverse();
const minuteSummaryGridClassName = "grid gap-3 md:grid-cols-3 xl:grid-cols-6";

export function LineupHelper({
  initialWorkspace,
}: {
  initialWorkspace?: LineupHelperWorkspaceRecord;
}) {
  const workspaceQuery = useQuery({
    ...lineupHelperWorkspaceQueryOptions(),
    initialData: initialWorkspace ?? undefined,
    placeholderData: (previousData) => previousData,
  });
  const workspace = useMemo<DecodedLineupHelperWorkspace | null>(
    () =>
      workspaceQuery.data
        ? decodeLineupHelperWorkspace(workspaceQuery.data)
        : null,
    [workspaceQuery.data],
  );
  const [evaluation, setEvaluation] = useState<LineupHelperEvaluation | null>(
    () =>
      initialWorkspace
        ? decodeLineupHelperWorkspace(initialWorkspace).evaluation
        : null,
  );
  const [lineupLayout, setLineupLayout] = useState<LineupSlotLayout>(() =>
    initialWorkspace
      ? lineupLayoutFromAssignments(
          decodeLineupHelperWorkspace(initialWorkspace).defaultAssignments,
        )
      : emptyLineupLayout(),
  );
  const [context, setContext] = useState<LineupHelperContext>(() =>
    initialWorkspace
      ? decodeLineupHelperWorkspace(initialWorkspace).defaultContext
      : normalizeHelperContext({}),
  );
  const [algorithm, setAlgorithm] =
    useState<LineupHelperAlgorithm>("EXACT");
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [debouncedEvaluationInput, setDebouncedEvaluationInput] = useState<{
    assignments: ReturnType<typeof assignmentsFromLineupLayout>;
    context: ReturnType<typeof encodeLineupHelperContext>;
    roster: ReturnType<typeof encodeLineupHelperRosterPlayer>[];
  } | null>(null);
  const suppressNextEvaluationRef = useRef(false);
  const optimizeMutation = useMutation({
    mutationFn: (input: {
      algorithm?: string | null;
      context: unknown;
      roster: unknown[];
    }) => optimizeLineupHelperQuery(input),
  });
  const evaluationQuery = useQuery({
    ...lineupHelperEvaluationQueryOptions(
      debouncedEvaluationInput ?? {
        assignments: [],
        context: {},
        roster: [],
      },
    ),
    enabled: Boolean(debouncedEvaluationInput),
    placeholderData: (previousData) => previousData,
  });

  const roster = workspace?.roster ?? EMPTY_ROSTER;
  const validation = validateLineupLayout(
    roster,
    lineupLayout,
    context.defensiveSwitch,
  );
  const availableRosterCount = roster.filter(
    (player) => player.available,
  ).length;
  const hasGeneratedLineup = Boolean(workspace?.defaultAssignments.length);
  const canEvaluate =
    Boolean(workspace) &&
    availableRosterCount > 0 &&
    validation.errors.length === 0;
  const visibleEvaluation = canEvaluate ? evaluation : null;
  const workspaceError = readQueryError(workspaceQuery.error);
  const isLoadingWorkspace = workspaceQuery.isPending;
  const isEvaluating = evaluationQuery.isFetching;
  const isOptimizing = optimizeMutation.isPending;

  useEffect(() => {
    if (!workspace) {
      return;
    }

    setEvaluation(workspace.evaluation);
    setContext(workspace.defaultContext);
    suppressNextEvaluationRef.current = true;
    setLineupLayout(
      lineupLayoutFromAssignments(workspace.defaultAssignments),
    );
    setEvaluationError(null);
  }, [workspace]);

  useEffect(() => {
    if (
      algorithm === "LEGACY_HEURISTIC" &&
      !isIdentityDefensiveSwitch(context.defensiveSwitch)
    ) {
      setAlgorithm("EXACT");
    }
  }, [algorithm, context.defensiveSwitch]);

  useEffect(() => {
    if (!workspace) {
      setDebouncedEvaluationInput(null);
      return;
    }

    const nextRoster = workspace.roster;
    if (suppressNextEvaluationRef.current) {
      suppressNextEvaluationRef.current = false;
      setEvaluationError(null);
      setDebouncedEvaluationInput(null);
      return;
    }

    const nextValidation = validateLineupLayout(
      nextRoster,
      lineupLayout,
      context.defensiveSwitch,
    );
    if (!nextRoster.length || !nextRoster.some((player) => player.available)) {
      setEvaluationError(null);
      setEvaluation(null);
      setDebouncedEvaluationInput(null);
      return;
    }

    if (nextValidation.errors.length) {
      setEvaluationError(null);
      setDebouncedEvaluationInput(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setDebouncedEvaluationInput({
        assignments: assignmentsFromLineupLayout(lineupLayout),
        context: encodeLineupHelperContext(context),
        roster: nextRoster.map(encodeLineupHelperRosterPlayer),
      });
    }, 260);

    return () => {
      window.clearTimeout(timer);
    };
  }, [context, lineupLayout, workspace]);

  useEffect(() => {
    if (!evaluationQuery.data) {
      if (evaluationQuery.error) {
        setEvaluationError(readQueryError(evaluationQuery.error));
      }
      return;
    }

    setEvaluation(decodeLineupHelperEvaluation(evaluationQuery.data));
    setEvaluationError(null);
  }, [evaluationQuery.data, evaluationQuery.error]);

  function updatePlayerSlot(
    position: PositionCode,
    role: "backup" | "reserve" | "starter",
    playerId: string,
  ) {
    setLineupLayout((current) => {
      const nextState = current[position];
      return {
        ...current,
        [position]: {
          ...nextState,
          ...(role === "starter"
            ? { starterPlayerId: playerId }
            : role === "backup"
              ? { backupPlayerId: playerId }
              : { reservePlayerId: playerId }),
        },
      };
    });
  }

  function updatePattern(position: PositionCode, patternKey: string) {
    const nextPatternKey = patternKey as typeof LINEUP_SPLIT_PATTERNS[number]["key"];
    setLineupLayout((current) => {
      const nextState = current[position];
      return {
        ...current,
        [position]: {
          ...nextState,
          patternKey: nextPatternKey,
          reservePlayerId: roleIsEnabled(nextPatternKey, "reserve")
            ? nextState.reservePlayerId
            : "",
        },
      };
    });
  }

  function updateDefensiveSwitch(
    offensePosition: PositionCode,
    defensivePosition: PositionCode,
  ) {
    setContext((current) => {
      const nextSwitch = { ...current.defensiveSwitch };
      const previousDefensivePosition = nextSwitch[offensePosition];
      const swappedOffensePosition = LINEUP_POSITIONS.find(
        (position) => nextSwitch[position] === defensivePosition,
      );

      nextSwitch[offensePosition] = defensivePosition;
      if (
        swappedOffensePosition &&
        swappedOffensePosition !== offensePosition
      ) {
        nextSwitch[swappedOffensePosition] = previousDefensivePosition;
      }

      return {
        ...current,
        defensiveSwitch: nextSwitch,
      };
    });
  }

  function handleRestoreDefaultLineup() {
    if (!workspace) {
      return;
    }
    suppressNextEvaluationRef.current = true;
    setContext(workspace.defaultContext);
    setEvaluation(workspace.evaluation);
    setLineupLayout(lineupLayoutFromAssignments(workspace.defaultAssignments));
    setEvaluationError(null);
  }

  async function handleOptimize() {
    if (!workspace) {
      return;
    }

    setEvaluationError(null);
    try {
      const nextEvaluationRecord = await optimizeMutation.mutateAsync({
        algorithm,
        roster: workspace.roster.map(encodeLineupHelperRosterPlayer),
        context: encodeLineupHelperContext(context),
      });
      const nextEvaluation = decodeLineupHelperEvaluation(nextEvaluationRecord);

      if (!nextEvaluation) {
        setEvaluationError("The optimizer did not return a usable lineup.");
        return;
      }

      suppressNextEvaluationRef.current = true;
      setEvaluation(nextEvaluation);
      setContext(nextEvaluation.context);
      setLineupLayout(
        lineupLayoutFromAssignments(nextEvaluation.normalizedLineup),
      );
    } catch (error) {
      setEvaluationError(readQueryError(error));
    }
  }

  const legacyAlgorithmDisabled = !isIdentityDefensiveSwitch(
    context.defensiveSwitch,
  );

  return (
    <div className="grid gap-4">
      <SectionHeading
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Field className="min-w-44" label="Algorithm">
              <Select
                disabled={isOptimizing}
                onChange={(event) =>
                  setAlgorithm(event.target.value as LineupHelperAlgorithm)
                }
                value={algorithm}
              >
                <option value="EXACT">Exact</option>
                <option
                  disabled={legacyAlgorithmDisabled}
                  value="LEGACY_HEURISTIC"
                >
                  Legacy heuristic
                </option>
              </Select>
            </Field>
            <Button
              loading={workspaceQuery.isFetching}
              onClick={() => void workspaceQuery.refetch()}
              variant="secondary"
            >
              Refresh roster data
            </Button>
            <Button
              disabled={!workspace || !hasGeneratedLineup}
              onClick={handleRestoreDefaultLineup}
              variant="secondary"
            >
              {hasGeneratedLineup
                ? "Restore default lineup"
                : "No default lineup"}
            </Button>
            <Button
              disabled={!workspace || availableRosterCount === 0}
              loading={isOptimizing}
              onClick={() => void handleOptimize()}
            >
              Optimize
            </Button>
          </div>
        }
        description="Lineup ratings from your saved roster data with legal minute planning, rotation checks, and tactic context."
        title="Lineup Helper"
        titleAs="h4"
      />

      {isLoadingWorkspace && !workspace ? (
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Loading lineup data" titleAs="h5" />
          <p className={statusCopyClassName}>
            Pulling your saved roster, player history, and default lineup.
          </p>
        </Panel>
      ) : null}

      {!isLoadingWorkspace && workspaceError && !workspace ? (
        <Panel as="article" padding="sm" variant="danger">
          <SectionHeading title="Lineup helper unavailable" titleAs="h5" />
          <p className={statusCopyClassName}>{workspaceError}</p>
        </Panel>
      ) : null}

      {workspace ? (
        <>
          {availableRosterCount === 0 ? (
            <Alert>
              Player data is not ready yet. Ratings and optimization stay disabled
              until a fresh roster update completes.
            </Alert>
          ) : null}
          {validation.errors.length
            ? validation.errors.map((error) => <Alert key={error}>{error}</Alert>)
            : null}
          {evaluationError ? <Alert>{evaluationError}</Alert> : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              detail={
                workspace.syncedAt
                  ? `Updated ${formatTimestamp(workspace.syncedAt)}`
                  : "Last update unavailable"
              }
              label="Roster rows"
              value={roster.length}
            />
            <StatCard
              detail={`${validation.teamTotal}/240 minutes`}
              label="Team total"
              value={validation.teamTotal}
            />
            <StatCard
              detail="Unavailable players stay disabled"
              label="Players needing updates"
              value={workspace.snapshotWarnings.length}
            />
            <StatCard
              detail={
                isEvaluating ? "Refreshing analysis" : "Latest analysis"
              }
              label="Analysis status"
              value={
                isEvaluating
                  ? "Updating"
                  : visibleEvaluation
                    ? "Ready"
                    : "Unavailable"
              }
            />
          </div>

          <div className={twoColumnGridClassName}>
            <div className="grid gap-4">
              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Context" titleAs="h5" />
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Offense">
                    <Select
                      disabled={availableRosterCount === 0}
                      onChange={(event) =>
                        setContext((current) => ({
                          ...current,
                          offense: event.target.value,
                        }))
                      }
                      value={context.offense}
                    >
                      {workspace.availableOffenses.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Defense">
                    <Select
                      disabled={availableRosterCount === 0}
                      onChange={(event) =>
                        setContext((current) => ({
                          ...current,
                          defense: event.target.value,
                        }))
                      }
                      value={context.defense}
                    >
                      {workspace.availableDefenses.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Location">
                    <Select
                      disabled={availableRosterCount === 0}
                      onChange={(event) =>
                        setContext((current) => ({
                          ...current,
                          homeCourt: event.target.value,
                        }))
                      }
                      value={context.homeCourt}
                    >
                      {workspace.availableLocations.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Enthusiasm">
                    <Select
                      disabled={availableRosterCount === 0}
                      onChange={(event) =>
                        setContext((current) => ({
                          ...current,
                          enthusiasm: coerceEnthusiasm(event.target.value),
                        }))
                      }
                      value={String(context.enthusiasm)}
                    >
                      {ENTHUSIASM_OPTIONS.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.value} - {entry.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {legacyAlgorithmDisabled ? (
                  <p className="text-ink-muted text-xs">
                    Legacy heuristic is disabled while defensive switch is active.
                  </p>
                ) : null}
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading
                  description={lineupRuleSummary()}
                  title="Lineup plan"
                  titleAs="h5"
                />
                <div className={minuteSummaryGridClassName}>
                  {LINEUP_POSITIONS.map((position) => (
                    <MinuteSummaryTile
                      current={validation.positionTotals[position]}
                      key={`summary-${position}`}
                      label={position}
                      target={48}
                    />
                  ))}
                  <MinuteSummaryTile
                    current={validation.teamTotal}
                    label="Team"
                    target={240}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {roster
                    .filter((player) => player.available)
                    .sort(
                      (left, right) =>
                        (validation.playerTotals[right.playerId] ?? 0) -
                          (validation.playerTotals[left.playerId] ?? 0) ||
                        left.fullName.localeCompare(right.fullName),
                    )
                    .map((player) => {
                      const totalMinutes =
                        validation.playerTotals[player.playerId] ?? 0;
                      return (
                        <span
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
                            totalMinutes > 42
                              ? "border-danger-border bg-danger-bg text-accent-strong"
                              : totalMinutes === 42
                                ? "border-note-border bg-note-bg text-note"
                                : "border-black/10 bg-black/5 text-ink",
                          )}
                          key={`player-total-${player.playerId}`}
                        >
                          {player.fullName}
                          <span className="text-ink-muted">{totalMinutes} min</span>
                        </span>
                      );
                    })}
                </div>
                <div className="grid gap-3">
                  {LINEUP_POSITIONS.map((position) => {
                    const positionLayout = lineupLayout[position];
                    const positionAssignments = validation.roleAssignments[position];
                    const positionOutputRankings =
                      visibleEvaluation?.rankings[position] ?? [];

                    return (
                      <article
                        className="rounded-card grid gap-4 border border-black/8 bg-white/65 p-4 shadow-sm"
                        key={`position-${position}`}
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="grid gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-ink text-base">
                                {position} offense
                              </strong>
                              <StatusBadge tone="note">
                                {LINEUP_POSITION_LABELS[position]}
                              </StatusBadge>
                              <StatusBadge
                                tone={
                                  validation.positionTotals[position] === 48
                                    ? "success"
                                    : "danger"
                                }
                              >
                                {validation.positionTotals[position]}/48 min
                              </StatusBadge>
                            </div>
                            <p className={statusCopyClassName}>
                              Defends as {context.defensiveSwitch[position]}. Choose a
                              legal split, then assign starter, backup, and reserve.
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Defends as">
                              <Select
                                disabled={isOptimizing}
                                onChange={(event) =>
                                  updateDefensiveSwitch(
                                    position,
                                    event.target.value as PositionCode,
                                  )
                                }
                                value={context.defensiveSwitch[position]}
                              >
                                {LINEUP_POSITIONS.map((option) => (
                                  <option key={`${position}-switch-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Split pattern">
                              <Select
                                disabled={isOptimizing}
                                onChange={(event) =>
                                  updatePattern(position, event.target.value)
                                }
                                value={positionLayout.patternKey}
                              >
                                {LINEUP_SPLIT_PATTERNS.map((pattern) => (
                                  <option key={`${position}-${pattern.key}`} value={pattern.key}>
                                    {pattern.label}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-3">
                          {LINEUP_ROLE_SEQUENCE.map((role) => {
                            const enabled = roleIsEnabled(positionLayout.patternKey, role);
                            const playerId =
                              role === "starter"
                                ? positionLayout.starterPlayerId
                                : role === "backup"
                                  ? positionLayout.backupPlayerId
                                  : positionLayout.reservePlayerId;
                            const selectedPlayer = roster.find(
                              (player) => player.playerId === playerId,
                            );
                            const selectedOtherPlayers = new Set(
                              [positionLayout.starterPlayerId, positionLayout.backupPlayerId, positionLayout.reservePlayerId]
                                .filter((candidateId) => candidateId && candidateId !== playerId),
                            );
                            const options = roster.filter(
                              (player) =>
                                player.available &&
                                (!selectedOtherPlayers.has(player.playerId) ||
                                  player.playerId === playerId),
                            );

                            return (
                              <div
                                className={cn(
                                  "rounded-card grid gap-3 border p-4",
                                  enabled
                                    ? "border-black/8 bg-white/70"
                                    : "border-black/6 bg-black/5 opacity-70",
                                )}
                                key={`${position}-${role}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="grid gap-1">
                                    <span className="text-ink text-sm font-semibold">
                                      {formatRoleLabel(role)}
                                    </span>
                                    <span className="text-ink-muted text-xs">
                                      {enabled
                                        ? `${minutesForRole(positionLayout.patternKey, role)} minutes`
                                        : "Unused in this split"}
                                    </span>
                                  </div>
                                  {enabled ? (
                                    <MinuteRolePill
                                      label={formatRoleLabel(role)}
                                      role={role}
                                    />
                                  ) : null}
                                </div>

                                <Field label="Player">
                                  <Select
                                    disabled={!enabled || isOptimizing}
                                    onChange={(event) =>
                                      updatePlayerSlot(position, role, event.target.value)
                                    }
                                    value={playerId}
                                  >
                                    <option value="">
                                      {enabled ? "Choose player" : "Unused"}
                                    </option>
                                    {options.map((player) => (
                                      <option key={`${position}-${role}-${player.playerId}`} value={player.playerId}>
                                        {player.fullName}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>

                                <div className="grid gap-1 text-xs">
                                  <span className="text-ink-muted">
                                    Output{" "}
                                    {formatDecimal(
                                      selectedPlayer
                                        ? visibleEvaluation?.playerPositionOutputs[
                                            selectedPlayer.playerId
                                          ]?.[position] ?? null
                                        : null,
                                    )}
                                  </span>
                                  <span className="text-ink-muted">
                                    Player total{" "}
                                    {selectedPlayer
                                      ? `${validation.playerTotals[selectedPlayer.playerId] ?? 0} min`
                                      : "0 min"}
                                  </span>
                                  {selectedPlayer ? (
                                    <span className="text-ink">
                                      {selectedPlayer.bestPosition ?? "Flex"} •{" "}
                                      {formatCurrency(selectedPlayer.salary)} •{" "}
                                      <BuzzerBeaterRatingText scale="game_shape">
                                        {selectedPlayer.gameShape ?? "unknown shape"}
                                      </BuzzerBeaterRatingText>{" "}
                                      •{" "}
                                      {skillHeadline(selectedPlayer)}
                                    </span>
                                  ) : (
                                    <span className="text-ink-muted">
                                      Choose from your available roster.
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {positionAssignments.map((assignment) => (
                            <MinuteRolePill
                              key={`${position}-${assignment.playerId}-${assignment.role}`}
                              label={`${resolvePlayerName(
                                roster,
                                assignment.playerId,
                              )} ${assignment.minutes}m`}
                              role={assignment.role}
                            />
                          ))}
                          {!positionAssignments.length ? (
                            <span className="text-ink-muted text-xs">
                              No legal role assignment yet.
                            </span>
                          ) : null}
                        </div>

                        <div className="grid gap-2">
                          <span className="text-ink-muted text-[0.72rem] font-bold uppercase tracking-[0.16em]">
                            Top fits for {position}
                          </span>
                          <ol className="grid list-decimal gap-1 pl-5 text-sm">
                            {positionOutputRankings.slice(0, 5).map((entry) => (
                              <li key={`${position}-rank-${entry.playerId}`}>
                                <span className="font-semibold text-ink">
                                  {entry.name}
                                </span>{" "}
                                <span className="text-ink-muted">
                                  ({formatDecimal(entry.output)})
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </Panel>
            </div>

            <div className="grid gap-4">
              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Ratings" titleAs="h5" />
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-1">
                  {visibleEvaluation
                    ? ratingLabels.map((rating) => (
                        <StatCard
                          key={rating.key}
                          detail={
                            <>
                              <BuzzerBeaterRatingText
                                label={visibleEvaluation.ratingLabels[rating.key]}
                                scale="team_rating"
                              >
                                {visibleEvaluation.ratingLabels[rating.key]}
                              </BuzzerBeaterRatingText>{" "}
                              • {visibleEvaluation.outputBandLabels[rating.key]}
                            </>
                          }
                          label={rating.label}
                          value={
                            <BuzzerBeaterRatingText
                              scale="team_rating"
                              value={visibleEvaluation.roundedRatings[rating.key]}
                            >
                              {Number(
                                visibleEvaluation.roundedRatings[rating.key],
                              ).toFixed(1)}
                            </BuzzerBeaterRatingText>
                          }
                        />
                      ))
                    : ratingLabels.map((rating) => (
                        <StatCard
                          key={rating.key}
                          detail={
                            availableRosterCount === 0
                              ? "Player data is required before ratings can be generated"
                              : "Waiting for a valid lineup"
                          }
                          label={rating.label}
                          value="--"
                        />
                      ))}
                </div>
                {visibleEvaluation?.warnings.length ? (
                  <div className="grid gap-2">
                    <SectionHeading title="Warnings" titleAs="h5" />
                    {visibleEvaluation.warnings.map((warning) => (
                      <Alert key={warning}>{warning}</Alert>
                    ))}
                  </div>
                ) : null}
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Slot outputs" titleAs="h5" />
                <TableShell compact>
                  <thead>
                    <tr>
                      <TableHeadCell>Player</TableHeadCell>
                      {LINEUP_POSITIONS.map((position) => (
                        <TableHeadCell key={`output-${position}`}>
                          {position}
                        </TableHeadCell>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((player) => (
                      <tr key={`outputs-${player.playerId}`}>
                        <TableCell>{player.fullName}</TableCell>
                        {LINEUP_POSITIONS.map((position) => (
                          <TableCell
                            key={`${player.playerId}-output-${position}`}
                          >
                            {formatDecimal(
                              visibleEvaluation?.playerPositionOutputs[
                                player.playerId
                              ]?.[position] ?? null,
                            )}
                          </TableCell>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </Panel>
            </div>
          </div>

          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading title="Depth chart rankings" titleAs="h5" />
            <div className={rankingsGridClassName}>
              {LINEUP_POSITIONS.map((position) => (
                <div
                  className="rounded-card grid gap-3 border border-black/8 bg-white/65 p-4"
                  key={`rank-${position}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-ink text-base">{position}</strong>
                    <StatusBadge tone="note">
                      {visibleEvaluation
                        ? visibleEvaluation.rankings[position].length
                        : 0}{" "}
                      options
                    </StatusBadge>
                  </div>
                  <ol className="grid list-decimal gap-2 pl-5">
                    {(visibleEvaluation?.rankings[position] ?? [])
                      .slice(0, 5)
                      .map((entry) => (
                        <li
                          className="text-ink text-sm"
                          key={`${position}-${entry.playerId}`}
                        >
                          <span className="font-semibold">{entry.name}</span>{" "}
                          <span className="text-ink-muted">
                            ({formatDecimal(entry.output)})
                          </span>
                        </li>
                      ))}
                  </ol>
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function decodeLineupHelperWorkspace(
  record: LineupHelperWorkspaceRecord,
): DecodedLineupHelperWorkspace {
  return {
    generatedAt: record.generatedAt,
    syncedAt: record.syncedAt ?? null,
    roster: record.roster.map(decodeLineupHelperRosterPlayer),
    defaultContext: decodeLineupHelperContext(record.defaultContext),
    defaultAssignments: record.defaultAssignments.map(decodeLineupHelperAssignment),
    evaluation: record.evaluation ? decodeLineupHelperEvaluation(record.evaluation) : null,
    snapshotWarnings: record.snapshotWarnings.map((warning) => ({
      playerId: warning.playerId,
      fullName: warning.fullName,
      warning: warning.warning,
    })),
    availableOffenses: [...record.availableOffenses],
    availableDefenses: [...record.availableDefenses],
    availableLocations: [...record.availableLocations],
  };
}

function decodeLineupHelperEvaluation(
  record: LineupHelperEvaluationRecord,
): LineupHelperEvaluation | null {
  return {
    context: decodeLineupHelperContext(record.context),
    normalizedLineup: record.normalizedLineup.map(decodeLineupHelperAssignment),
    rawRatings: { ...record.rawRatings },
    roundedRatings: { ...record.roundedRatings },
    ratingLabels: { ...record.ratingLabels },
    outputBandLabels: { ...record.outputBandLabels },
    warnings: [...record.warnings],
    rankings: {
      PG: record.rankings.pg.map(decodeLineupHelperRankingEntry),
      SG: record.rankings.sg.map(decodeLineupHelperRankingEntry),
      SF: record.rankings.sf.map(decodeLineupHelperRankingEntry),
      PF: record.rankings.pf.map(decodeLineupHelperRankingEntry),
      C: record.rankings.c.map(decodeLineupHelperRankingEntry),
    },
    playerPositionOutputs: Object.fromEntries(
      record.playerPositionOutputs.map((entry) => [
        entry.playerId,
        decodePositionOutput(entry.output),
      ]),
    ),
    perPositionContributions: {
      outsideScoring: decodePositionOutput(
        record.perPositionContributions.outsideScoring,
      ),
      insideScoring: decodePositionOutput(
        record.perPositionContributions.insideScoring,
      ),
      outsideDefense: decodePositionOutput(
        record.perPositionContributions.outsideDefense,
      ),
      insideDefense: decodePositionOutput(
        record.perPositionContributions.insideDefense,
      ),
      rebounding: decodePositionOutput(record.perPositionContributions.rebounding),
      offensiveFlow: decodePositionOutput(
        record.perPositionContributions.offensiveFlow,
      ),
    },
    totalOutput: Number(record.totalOutput),
  };
}

function decodeLineupHelperContext(
  record: LineupHelperWorkspaceRecord["defaultContext"],
): LineupHelperContext {
  return normalizeHelperContext({
    defense: record.defense,
    defensiveSwitch: {
      PG: record.defensiveSwitch.pg as PositionCode,
      SG: record.defensiveSwitch.sg as PositionCode,
      SF: record.defensiveSwitch.sf as PositionCode,
      PF: record.defensiveSwitch.pf as PositionCode,
      C: record.defensiveSwitch.c as PositionCode,
    },
    enthusiasm: record.enthusiasm,
    homeCourt: record.homeCourt,
    offense: record.offense,
  });
}

function encodeLineupHelperContext(
  context: LineupHelperContext,
): LineupHelperWorkspaceRecord["defaultContext"] {
  return {
    offense: context.offense,
    defense: context.defense,
    enthusiasm: context.enthusiasm,
    homeCourt: context.homeCourt,
    defensiveSwitch: {
      pg: context.defensiveSwitch.PG as LineupHelperWorkspaceRecord["defaultContext"]["defensiveSwitch"]["pg"],
      sg: context.defensiveSwitch.SG as LineupHelperWorkspaceRecord["defaultContext"]["defensiveSwitch"]["sg"],
      sf: context.defensiveSwitch.SF as LineupHelperWorkspaceRecord["defaultContext"]["defensiveSwitch"]["sf"],
      pf: context.defensiveSwitch.PF as LineupHelperWorkspaceRecord["defaultContext"]["defensiveSwitch"]["pf"],
      c: context.defensiveSwitch.C as LineupHelperWorkspaceRecord["defaultContext"]["defensiveSwitch"]["c"],
    },
  };
}

function decodeLineupHelperRosterPlayer(
  player: LineupHelperWorkspaceRecord["roster"][number],
): LineupHelperRosterPlayer {
  return {
    playerId: player.playerId,
    fullName: player.fullName,
    bestPosition: player.bestPosition ?? null,
    salary: player.salary ?? null,
    age: player.age ?? null,
    gameShape: player.gameShape ?? null,
    dmi: player.dmi ?? null,
    injuryWeeks: player.injuryWeeks ?? null,
    snapshotWeekKey: player.snapshotWeekKey ?? null,
    snapshotCapturedAt: player.snapshotCapturedAt ?? null,
    available: player.available,
    snapshotWarning: player.snapshotWarning ?? null,
    skills: toSkillRecord(player.skills),
  };
}

function encodeLineupHelperRosterPlayer(
  player: LineupHelperRosterPlayer,
): LineupHelperWorkspaceRecord["roster"][number] {
  return {
    playerId: player.playerId,
    fullName: player.fullName,
    bestPosition: player.bestPosition,
    salary: player.salary,
    age: player.age,
    gameShape: player.gameShape,
    dmi: player.dmi,
    injuryWeeks: player.injuryWeeks,
    snapshotWeekKey: player.snapshotWeekKey,
    snapshotCapturedAt: player.snapshotCapturedAt,
    available: player.available,
    snapshotWarning: player.snapshotWarning,
    skills: {
      js: player.skills.js,
      jr: player.skills.jr,
      od: player.skills.od,
      ha: player.skills.ha,
      dr: player.skills.dr,
      pa: player.skills.pa,
      is: player.skills.is,
      id: player.skills.id,
      rb: player.skills.rb,
      sb: player.skills.sb,
      st: player.skills.st,
      ft: player.skills.ft,
      ex: player.skills.ex,
      gs: player.skills.gs,
    },
  };
}

function decodeLineupHelperAssignment(
  assignment: LineupHelperWorkspaceRecord["defaultAssignments"][number],
): LineupHelperAssignment {
  return {
    playerId: assignment.playerId,
    position: assignment.position as PositionCode,
    minutes: assignment.minutes,
  };
}

function decodeLineupHelperRankingEntry(
  entry: LineupHelperEvaluationRecord["rankings"]["pg"][number],
): LineupHelperRankingEntry {
  return {
    playerId: entry.playerId,
    name: entry.name,
    output: entry.output,
  };
}

function decodePositionOutput(
  value: LineupHelperEvaluationRecord["playerPositionOutputs"][number]["output"],
): Record<PositionCode, number> {
  return {
    PG: value.pg,
    SG: value.sg,
    SF: value.sf,
    PF: value.pf,
    C: value.c,
  };
}

function toSkillRecord(
  skills: LineupHelperWorkspaceRecord["roster"][number]["skills"],
): LineupHelperSkillRatings {
  return {
    js: skills.js,
    jr: skills.jr,
    od: skills.od,
    ha: skills.ha,
    dr: skills.dr,
    pa: skills.pa,
    is: skills.is,
    id: skills.id,
    rb: skills.rb,
    sb: skills.sb,
    st: skills.st,
    ft: skills.ft,
    ex: skills.ex,
    gs: skills.gs,
  };
}

function skillHeadline(player: LineupHelperRosterPlayer) {
  const sorted = Object.entries(player.skills)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
  return sorted.flatMap(([key, value], index) => [
    index > 0 ? (
      <span className="text-ink-muted" key={`${key}-separator`}>
        {" "}
        •{" "}
      </span>
    ) : null,
    <BuzzerBeaterRatingText
      className="font-semibold"
      key={key}
      scale="player_rating"
      value={value}
    >
      {`${key.toUpperCase()} ${value}`}
    </BuzzerBeaterRatingText>,
  ]);
}

function resolvePlayerName(
  roster: LineupHelperRosterPlayer[],
  playerId: string,
) {
  return roster.find((player) => player.playerId === playerId)?.fullName ?? playerId;
}

function MinuteSummaryTile({
  current,
  label,
  target,
}: {
  current: number;
  label: string;
  target: number;
}) {
  const exact = current === target;
  const over = current > target;

  return (
    <div
      className={cn(
        "rounded-card grid gap-1 border px-4 py-3",
        exact
          ? "border-success/20 bg-success/10"
          : over
            ? "border-danger-border bg-danger-bg"
            : "border-note-border bg-note-bg",
      )}
    >
      <span className="text-ink-muted text-[0.72rem] font-bold uppercase tracking-[0.16em]">
        {label}
      </span>
      <strong className="text-ink text-2xl leading-none">{current}</strong>
      <span className="text-xs text-ink-muted">
        {exact ? "On target" : `${current}/${target} minutes`}
      </span>
    </div>
  );
}

function MinuteRolePill({
  label,
  role,
}: {
  label: string;
  role: "backup" | "reserve" | "starter";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold",
        role === "starter"
          ? "border-success/20 bg-success/10 text-success"
          : role === "backup"
            ? "border-note-border bg-note-bg text-note"
            : "border-black/10 bg-black/5 text-ink",
      )}
    >
      {label}
    </span>
  );
}

function formatRoleLabel(role: "backup" | "reserve" | "starter") {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDecimal(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }
  return Number(value).toFixed(2);
}

function formatCurrency(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readQueryError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "The request did not complete.";
}
