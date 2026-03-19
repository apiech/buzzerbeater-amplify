"use client";

import { useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
import {
  LINEUP_POSITIONS,
  assignmentMatrixFromLineup,
  assignmentsFromMatrix,
  coerceEnthusiasm,
  coerceMinuteValue,
  createEmptyMinuteRow,
  normalizeHelperContext,
  type LineupMinuteMatrix,
  validateLineupMatrix,
} from "@/app/lineup-helper-state";
import type {
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
import { Field, Input, Select } from "@/app/ui/primitives/field";
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

export function LineupHelper() {
  const [workspace, setWorkspace] =
    useState<DecodedLineupHelperWorkspace | null>(null);
  const [evaluation, setEvaluation] = useState<LineupHelperEvaluation | null>(
    null,
  );
  const [minuteMatrix, setMinuteMatrix] = useState<LineupMinuteMatrix>({});
  const [context, setContext] = useState<LineupHelperContext>(() =>
    normalizeHelperContext({}),
  );
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [workspaceLoadVersion, setWorkspaceLoadVersion] = useState(0);

  const roster = workspace?.roster ?? EMPTY_ROSTER;
  const validation = validateLineupMatrix(roster, minuteMatrix);
  const availableRosterCount = roster.filter(
    (player) => player.available,
  ).length;
  const hasGeneratedLineup = Boolean(workspace?.defaultAssignments.length);
  const canEvaluate =
    Boolean(workspace) &&
    availableRosterCount > 0 &&
    validation.errors.length === 0;
  const visibleEvaluation = canEvaluate ? evaluation : null;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoadingWorkspace(true);
      setWorkspaceError(null);
      setEvaluationError(null);

      const response = await client.queries.getLineupHelperWorkspace();
      if (cancelled) {
        return;
      }

      if (response.errors?.length || !response.data) {
        setWorkspace(null);
        setEvaluation(null);
        setMinuteMatrix({});
        setWorkspaceError(formatAmplifyErrors(response.errors));
        setIsLoadingWorkspace(false);
        return;
      }

      const nextWorkspace = decodeLineupHelperWorkspace(response.data);
      setWorkspace(nextWorkspace);
      setEvaluation(nextWorkspace.evaluation);
      setContext(nextWorkspace.defaultContext);
      setMinuteMatrix(
        assignmentMatrixFromLineup(
          nextWorkspace.roster,
          nextWorkspace.defaultAssignments,
        ),
      );
      setWorkspaceError(null);
      setEvaluationError(null);
      setIsLoadingWorkspace(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [workspaceLoadVersion]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const nextRoster = workspace.roster;
    const nextValidation = validateLineupMatrix(nextRoster, minuteMatrix);
    if (!nextRoster.length || !nextRoster.some((player) => player.available)) {
      setIsEvaluating(false);
      setEvaluationError(null);
      setEvaluation(null);
      return;
    }

    if (nextValidation.errors.length) {
      setIsEvaluating(false);
      setEvaluationError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsEvaluating(true);
        const response = await client.queries.evaluateLineupHelper({
          roster: nextRoster.map(encodeLineupHelperRosterPlayer),
          assignments: assignmentsFromMatrix(minuteMatrix),
          context,
        });

        if (cancelled) {
          return;
        }

        if (response.errors?.length || !response.data) {
          setEvaluationError(formatAmplifyErrors(response.errors));
          setIsEvaluating(false);
          return;
        }

        setEvaluation(decodeLineupHelperEvaluation(response.data));
        setEvaluationError(null);
        setIsEvaluating(false);
      })();
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [context, minuteMatrix, workspace]);

  function updateMinute(
    playerId: string,
    position: PositionCode,
    value: string,
  ) {
    const nextMinutes = coerceMinuteValue(value);
    setMinuteMatrix((current) => ({
      ...current,
      [playerId]: {
        ...(current[playerId] ?? createEmptyMinuteRow()),
        [position]: nextMinutes,
      },
    }));
  }

  function handleAutofill() {
    if (!workspace) {
      return;
    }
    setMinuteMatrix(
      assignmentMatrixFromLineup(
        workspace.roster,
        workspace.defaultAssignments,
      ),
    );
    setEvaluation(workspace.evaluation);
    setEvaluationError(null);
  }

  return (
    <div className="grid gap-4">
      <SectionHeading
        actions={
          <div className="flex flex-wrap gap-3">
            <Button
              loading={isLoadingWorkspace}
              onClick={() => setWorkspaceLoadVersion((current) => current + 1)}
              variant="secondary"
            >
              Refresh roster data
            </Button>
            <Button
              disabled={!workspace || !hasGeneratedLineup}
              onClick={handleAutofill}
              variant="secondary"
            >
              {hasGeneratedLineup ? "Autofill lineup" : "No generated lineup"}
            </Button>
          </div>
        }
        description="Lineup ratings from your saved roster data with minute planning and tactic context."
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
              Player data is not ready yet. Ratings and autofill stay disabled
              until a fresh roster update completes.
            </Alert>
          ) : null}
          {validation.errors.length ? (
            <Alert>{validation.errors.join(" ")}</Alert>
          ) : null}
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
              </Panel>

              <Panel as="article" padding="sm" variant="solid">
                <SectionHeading title="Minute grid" titleAs="h5" />
                <TableShell>
                  <thead>
                    <tr>
                      <TableHeadCell>Player</TableHeadCell>
                      <TableHeadCell>Role</TableHeadCell>
                      <TableHeadCell>Player data</TableHeadCell>
                      {LINEUP_POSITIONS.map((position) => (
                        <TableHeadCell key={position}>{position}</TableHeadCell>
                      ))}
                      <TableHeadCell>Total</TableHeadCell>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((player) => {
                      const rowMinutes = minuteMatrix[player.playerId] ?? createEmptyMinuteRow();
                      const totalMinutes = LINEUP_POSITIONS.reduce(
                        (sum, position) => sum + rowMinutes[position],
                        0,
                      );
                      return (
                        <tr key={player.playerId}>
                          <TableCell>
                            <div className="grid gap-1">
                              <strong>{player.fullName}</strong>
                              <span className={statusCopyClassName}>
                                {player.bestPosition ?? "Flex"} •{" "}
                                {formatCurrency(player.salary)} •{" "}
                                {skillHeadline(player)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="grid gap-2">
                              <StatusBadge
                                tone={player.available ? "success" : "danger"}
                              >
                                {player.available ? "Ready" : "Unavailable"}
                              </StatusBadge>
                              <span className="text-ink-muted text-xs">
                                <BuzzerBeaterRatingText
                                  label={player.gameShape}
                                  scale="game_shape"
                                >
                                  {player.gameShape ?? "No shape"}
                                </BuzzerBeaterRatingText>{" "}
                                • Age{" "}
                                {player.age ?? "N/A"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="grid gap-1">
                              <span className="text-ink text-sm">
                                {player.snapshotCapturedAt
                                  ? `Updated ${formatTimestamp(player.snapshotCapturedAt)}`
                                  : "Player data not ready"}
                              </span>
                              <span className="text-ink-muted text-xs">
                                {player.snapshotWarning ?? "Latest saved player update"}
                              </span>
                            </div>
                          </TableCell>
                          {LINEUP_POSITIONS.map((position) => (
                            <TableCell key={`${player.playerId}-${position}`}>
                              <Input
                                disabled={!player.available}
                                inputMode="numeric"
                                max={48}
                                min={0}
                                onChange={(event) =>
                                  updateMinute(
                                    player.playerId,
                                    position,
                                    event.target.value,
                                  )
                                }
                                step={1}
                                type="number"
                                value={rowMinutes[position]}
                              />
                            </TableCell>
                          ))}
                          <TableCell>
                            <strong>{totalMinutes}</strong>
                          </TableCell>
                        </tr>
                      );
                    })}
                    <tr>
                      <TableCell className="text-ink font-semibold" colSpan={3}>
                        Position totals
                      </TableCell>
                      {LINEUP_POSITIONS.map((position) => (
                        <TableCell
                          className="font-semibold"
                          key={`totals-${position}`}
                        >
                          {validation.positionTotals[position]}
                        </TableCell>
                      ))}
                      <TableCell className="font-semibold">
                        {validation.teamTotal}
                      </TableCell>
                    </tr>
                  </tbody>
                </TableShell>
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
                <SectionHeading title="Position outputs" titleAs="h5" />
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
    defaultContext: normalizeHelperContext(record.defaultContext),
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
    context: normalizeHelperContext(
      record.context,
    ),
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

function formatAmplifyErrors(
  errors: ReadonlyArray<{ message?: string } | null> | null | undefined,
) {
  const messages = (errors ?? [])
    .map((error) => error?.message?.trim())
    .filter((message): message is string => Boolean(message));
  return messages.join(" ") || "The request did not complete.";
}
