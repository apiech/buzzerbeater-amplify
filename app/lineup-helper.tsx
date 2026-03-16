"use client";

import { useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
import {
  LINEUP_POSITIONS,
  assignmentMatrixFromLineup,
  assignmentsFromMatrix,
  coerceEnthusiasm,
  coerceMinuteValue,
  emptyMinuteMatrix,
  normalizeHelperContext,
  type LineupMinuteMatrix,
  validateLineupMatrix,
} from "@/app/lineup-helper-state";
import {
  decodeGraphqlJsonPayload,
  encodeGraphqlJsonInput,
} from "@/app/graphql-json";
import type {
  DecodedLineupHelperWorkspace,
  LineupHelperAssignment,
  LineupHelperContext,
  LineupHelperEvaluation,
  LineupHelperEvaluationRecord,
  LineupHelperRankingEntry,
  LineupHelperRosterPlayer,
  LineupHelperWorkspaceRecord,
  PositionCode,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
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
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,1fr)]";
const rankingsGridClassName = "grid gap-4 lg:grid-cols-2 xl:grid-cols-3";
const EMPTY_ROSTER: LineupHelperRosterPlayer[] = [];

export function LineupHelper() {
  const [workspace, setWorkspace] = useState<DecodedLineupHelperWorkspace | null>(null);
  const [evaluation, setEvaluation] = useState<LineupHelperEvaluation | null>(null);
  const [minuteMatrix, setMinuteMatrix] = useState<LineupMinuteMatrix>({});
  const [context, setContext] = useState<LineupHelperContext>(() =>
    normalizeHelperContext({}),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [workspaceLoadVersion, setWorkspaceLoadVersion] = useState(0);

  const roster = workspace?.roster ?? EMPTY_ROSTER;
  const validation = validateLineupMatrix(roster, minuteMatrix);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoadingWorkspace(true);
      setLoadError(null);

      const response = await client.queries.getLineupHelperWorkspace();
      if (cancelled) {
        return;
      }

      if (response.errors?.length || !response.data) {
        setWorkspace(null);
        setEvaluation(null);
        setMinuteMatrix({});
        setLoadError(formatAmplifyErrors(response.errors));
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
    if (!nextRoster.length || nextValidation.errors.length) {
      setIsEvaluating(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsEvaluating(true);
        const response = await client.queries.evaluateLineupHelper({
          roster: encodeGraphqlJsonInput(nextRoster),
          assignments: encodeGraphqlJsonInput(assignmentsFromMatrix(minuteMatrix)),
          context: encodeGraphqlJsonInput(context),
        });

        if (cancelled) {
          return;
        }

        if (response.errors?.length || !response.data) {
          setLoadError(formatAmplifyErrors(response.errors));
          setIsEvaluating(false);
          return;
        }

        setEvaluation(decodeLineupHelperEvaluation(response.data));
        setIsEvaluating(false);
      })();
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [context, minuteMatrix, workspace]);

  function updateMinute(playerId: string, position: PositionCode, value: string) {
    setMinuteMatrix((current) => ({
      ...current,
      [playerId]: {
        ...(current[playerId] ?? Object.fromEntries(LINEUP_POSITIONS.map((slot) => [slot, 0]))),
        [position]: coerceMinuteValue(value),
      },
    }));
  }

  function handleAutofill() {
    if (!workspace) {
      return;
    }
    setMinuteMatrix(
      assignmentMatrixFromLineup(workspace.roster, workspace.defaultAssignments),
    );
    setEvaluation(workspace.evaluation);
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
              Refresh cache
            </Button>
            <Button
              disabled={!workspace}
              onClick={handleAutofill}
              variant="secondary"
            >
              Autofill lineup
            </Button>
          </div>
        }
        description="CoachParrot-style ratings from your cached roster snapshots with per-position minutes and tactic context."
        title="CoachParrot Lineup Helper"
        titleAs="h4"
      />

      {loadError ? <Alert>{loadError}</Alert> : null}
      {validation.errors.length ? (
        <Alert>
          {validation.errors.join(" ")}
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          detail={workspace?.syncedAt ? `Cache ${formatTimestamp(workspace.syncedAt)}` : "Cache unavailable"}
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
          label="Snapshot warnings"
          value={workspace?.snapshotWarnings.length ?? 0}
        />
        <StatCard
          detail={isEvaluating ? "Recomputing ratings" : "Latest evaluation"}
          label="Engine status"
          value={isEvaluating ? "Updating" : evaluation ? "Ready" : "Idle"}
        />
      </div>

      <div className={twoColumnGridClassName}>
        <div className="grid gap-4">
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading title="Context" titleAs="h5" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Offense">
                <Select
                  onChange={(event) =>
                    setContext((current) => ({
                      ...current,
                      offense: event.target.value,
                    }))
                  }
                  value={context.offense}
                >
                  {(workspace?.availableOffenses ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Defense">
                <Select
                  onChange={(event) =>
                    setContext((current) => ({
                      ...current,
                      defense: event.target.value,
                    }))
                  }
                  value={context.defense}
                >
                  {(workspace?.availableDefenses ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location">
                <Select
                  onChange={(event) =>
                    setContext((current) => ({
                      ...current,
                      homeCourt: event.target.value,
                    }))
                  }
                  value={context.homeCourt}
                >
                  {(workspace?.availableLocations ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Enthusiasm">
                <Select
                  onChange={(event) =>
                    setContext((current) => ({
                      ...current,
                      enthusiasm: coerceEnthusiasm(event.target.value),
                    }))
                  }
                  value={String(context.enthusiasm)}
                >
                  {Array.from({ length: 12 }, (_, index) => 12 - index).map((value) => (
                    <option key={value} value={value}>
                      {value}
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
                  <TableHeadCell>Snapshot</TableHeadCell>
                  {LINEUP_POSITIONS.map((position) => (
                    <TableHeadCell key={position}>{position}</TableHeadCell>
                  ))}
                  <TableHeadCell>Total</TableHeadCell>
                </tr>
              </thead>
              <tbody>
                {roster.map((player) => {
                  const rowMinutes = minuteMatrix[player.playerId] ?? emptyMinuteMatrix([player])[player.playerId];
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
                            {player.bestPosition ?? "Flex"} • {formatCurrency(player.salary)} •{" "}
                            {skillHeadline(player)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-2">
                          <StatusBadge tone={player.available ? "success" : "danger"}>
                            {player.available ? "Ready" : "Unavailable"}
                          </StatusBadge>
                          <span className="text-xs text-ink-muted">
                            {player.gameShape ?? "No shape"} • Age {player.age ?? "N/A"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-1">
                          <span className="text-sm text-ink">
                            {player.snapshotWeekKey ?? "No snapshot"}
                          </span>
                          <span className="text-xs text-ink-muted">
                            {player.snapshotWarning ?? formatTimestamp(player.snapshotCapturedAt)}
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
                              updateMinute(player.playerId, position, event.target.value)
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
                  <TableCell className="font-semibold text-ink" colSpan={3}>
                    Position totals
                  </TableCell>
                  {LINEUP_POSITIONS.map((position) => (
                    <TableCell className="font-semibold" key={`totals-${position}`}>
                      {validation.positionTotals[position]}
                    </TableCell>
                  ))}
                  <TableCell className="font-semibold">{validation.teamTotal}</TableCell>
                </tr>
              </tbody>
            </TableShell>
          </Panel>
        </div>

        <div className="grid gap-4">
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading title="Ratings" titleAs="h5" />
            <div className="grid gap-4 sm:grid-cols-2">
              {evaluation
                ? ratingLabels.map((rating) => (
                    <StatCard
                      key={rating.key}
                      detail={`${evaluation.ratingLabels[rating.key]} • ${evaluation.outputBandLabels[rating.key]}`}
                      label={rating.label}
                      value={Number(evaluation.roundedRatings[rating.key]).toFixed(1)}
                    />
                  ))
                : ratingLabels.map((rating) => (
                    <StatCard
                      key={rating.key}
                      detail="Waiting for a valid lineup"
                      label={rating.label}
                      value="--"
                    />
                  ))}
            </div>
            {evaluation?.warnings.length ? (
              <div className="grid gap-2">
                <SectionHeading title="Warnings" titleAs="h5" />
                {evaluation.warnings.map((warning) => (
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
                    <TableHeadCell key={`output-${position}`}>{position}</TableHeadCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((player) => (
                  <tr key={`outputs-${player.playerId}`}>
                    <TableCell>{player.fullName}</TableCell>
                    {LINEUP_POSITIONS.map((position) => (
                      <TableCell key={`${player.playerId}-output-${position}`}>
                        {formatDecimal(
                          evaluation?.playerPositionOutputs[player.playerId]?.[position] ?? null,
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
            <div className="grid gap-3 rounded-card border border-black/8 bg-white/65 p-4" key={`rank-${position}`}>
              <div className="flex items-center justify-between gap-3">
                <strong className="text-base text-ink">{position}</strong>
                <StatusBadge tone="note">
                  {evaluation ? evaluation.rankings[position].length : 0} options
                </StatusBadge>
              </div>
              <ol className="grid list-decimal gap-2 pl-5">
                {(evaluation?.rankings[position] ?? []).slice(0, 5).map((entry) => (
                  <li className="text-sm text-ink" key={`${position}-${entry.playerId}`}>
                    <span className="font-semibold">{entry.name}</span>{" "}
                    <span className="text-ink-muted">({formatDecimal(entry.output)})</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function decodeLineupHelperWorkspace(
  record: LineupHelperWorkspaceRecord,
): DecodedLineupHelperWorkspace {
  return {
    generatedAt: record.generatedAt,
    syncedAt: record.syncedAt ?? null,
    roster: decodeGraphqlJsonPayload<LineupHelperRosterPlayer[]>(record.roster),
    defaultContext: normalizeHelperContext(
      decodeGraphqlJsonPayload<LineupHelperContext>(record.defaultContext),
    ),
    defaultAssignments: decodeGraphqlJsonPayload<LineupHelperAssignment[]>(
      record.defaultAssignments,
    ),
    evaluation: decodeLineupHelperEvaluationFromJson(record.evaluation),
    snapshotWarnings: decodeGraphqlJsonPayload<
      Array<{ playerId: string; fullName: string; warning: string }>
    >(record.snapshotWarnings),
    availableOffenses: decodeGraphqlJsonPayload<string[]>(record.availableOffenses),
    availableDefenses: decodeGraphqlJsonPayload<string[]>(record.availableDefenses),
    availableLocations: decodeGraphqlJsonPayload<string[]>(record.availableLocations),
  };
}

function decodeLineupHelperEvaluation(
  record: LineupHelperEvaluationRecord,
): LineupHelperEvaluation {
  return decodeLineupHelperEvaluationFromJson(record);
}

function decodeLineupHelperEvaluationFromJson(
  value: unknown,
): LineupHelperEvaluation {
  const record = value as LineupHelperEvaluationRecord;
  return {
    context: normalizeHelperContext(
      decodeGraphqlJsonPayload<LineupHelperContext>(record.context),
    ),
    normalizedLineup: decodeGraphqlJsonPayload<LineupHelperAssignment[]>(
      record.normalizedLineup,
    ),
    rawRatings: decodeGraphqlJsonPayload<Record<string, number>>(record.rawRatings),
    roundedRatings: decodeGraphqlJsonPayload<Record<string, number>>(
      record.roundedRatings,
    ),
    ratingLabels: decodeGraphqlJsonPayload<Record<string, string>>(record.ratingLabels),
    outputBandLabels: decodeGraphqlJsonPayload<Record<string, string>>(
      record.outputBandLabels,
    ),
    warnings: decodeGraphqlJsonPayload<string[]>(record.warnings),
    rankings: decodeGraphqlJsonPayload<Record<PositionCode, LineupHelperRankingEntry[]>>(
      record.rankings,
    ),
    playerPositionOutputs: decodeGraphqlJsonPayload<
      Record<string, Record<PositionCode, number>>
    >(record.playerPositionOutputs),
    perPositionContributions: decodeGraphqlJsonPayload<
      Record<string, Record<PositionCode, number>>
    >(record.perPositionContributions),
    totalOutput: Number(record.totalOutput),
  };
}

function skillHeadline(player: LineupHelperRosterPlayer) {
  const sorted = Object.entries(player.skills)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([key, value]) => `${key.toUpperCase()} ${value}`);
  return sorted.join(" • ");
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
