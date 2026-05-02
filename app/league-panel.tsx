"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  leagueIntelQueryOptions,
  leagueSeasonSimulationQueryOptions,
  submitLeagueSeasonSimulationJobMutation,
  workspaceQueryKeys,
} from "@/app/dashboard/workspace-query-client";
import type {
  LeagueIntelPayload,
  LeagueSeasonSimulationProgress,
  LeagueSeasonSimulationResult,
  LeagueSeasonSimulationSnapshot,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Input } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";

type LeaguePanelProps = {
  currentTeamId: string | null;
  isRefreshingLeague?: boolean;
  league: LeagueIntelPayload | null;
};

type LeagueViewId =
  | "standings"
  | "projection"
  | "offense"
  | "defense"
  | "payroll"
  | "arena";

type LeagueComparisonMetricTriplet = NonNullable<
  NonNullable<LeagueIntelPayload["comparisons"]>["offense"][number]["points"]
>;

const activeProjectionStatuses = new Set<
  LeagueSeasonSimulationSnapshot["status"]
>([
  "QUEUED",
  "RESOLVING_CONTEXT",
  "COLLECTING_SNAPSHOTS",
  "SCORING_GAMES",
  "RUNNING_SIMULATIONS",
]);

const leagueViewOptions: Array<{
  id: LeagueViewId;
  label: string;
}> = [
  { id: "standings", label: "Standings" },
  { id: "projection", label: "Projection" },
  { id: "offense", label: "Offense" },
  { id: "defense", label: "Defense" },
  { id: "payroll", label: "Payroll" },
  { id: "arena", label: "Arena" },
];

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});
const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

export function LeaguePanel({
  currentTeamId,
  isRefreshingLeague = false,
  league,
}: LeaguePanelProps) {
  const [activeViewId, setActiveViewId] = useState<LeagueViewId>("standings");
  const connectedLeagueId = normalizeLeagueId(league?.league?.id ?? null);
  const [leagueIdInput, setLeagueIdInput] = useState("");
  const [requestedLeagueId, setRequestedLeagueId] = useState<string | null>(null);
  const selectedLeagueId = requestedLeagueId ?? connectedLeagueId;
  const selectedLeagueArgs =
    selectedLeagueId && selectedLeagueId !== connectedLeagueId
      ? { leagueId: selectedLeagueId }
      : undefined;
  const isUsingConnectedLeague = !selectedLeagueArgs;
  const leagueOverrideQuery = useQuery({
    ...leagueIntelQueryOptions(selectedLeagueArgs),
    enabled: Boolean(selectedLeagueArgs?.leagueId),
    placeholderData: (previous) => previous,
    retry: false,
  });
  const activeLeague = isUsingConnectedLeague
    ? league
    : (leagueOverrideQuery.data ?? null);
  const freshnessStatus =
    activeLeague?.freshnessStatus ??
    (activeLeague?.standings.length ? "FRESH" : "UNAVAILABLE");
  const isFreshLeague = freshnessStatus === "FRESH";
  const queryClient = useQueryClient();
  const projectionQuery = useQuery({
    ...leagueSeasonSimulationQueryOptions(selectedLeagueArgs),
    enabled:
      Boolean(activeLeague) && isFreshLeague && activeViewId === "projection",
    placeholderData: (previous) => previous,
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot || !activeProjectionStatuses.has(snapshot.status)) {
        return false;
      }
      return 4000;
    },
    retry: false,
  });
  const submitProjectionMutation = useMutation({
    mutationFn: () =>
      submitLeagueSeasonSimulationJobMutation(selectedLeagueArgs),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.leagueSeasonSimulation(selectedLeagueArgs),
      });
    },
  });

  useEffect(() => {
    if (!requestedLeagueId && connectedLeagueId) {
      setLeagueIdInput(connectedLeagueId);
    }
  }, [connectedLeagueId, requestedLeagueId]);

  function handleLeagueSelectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const leagueId = normalizeLeagueId(leagueIdInput);
    if (!leagueId || leagueId === connectedLeagueId) {
      setRequestedLeagueId(null);
      setLeagueIdInput(connectedLeagueId ?? "");
      return;
    }

    setRequestedLeagueId(leagueId);
    setLeagueIdInput(leagueId);
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.leagueIntel({ leagueId }),
    });
  }

  function handleUseConnectedLeague() {
    setRequestedLeagueId(null);
    setLeagueIdInput(connectedLeagueId ?? "");
  }

  const leaguePicker = (
    <form
      className="grid gap-3 rounded-[1.25rem] border border-border-soft bg-white/45 p-4 md:grid-cols-[minmax(14rem,24rem)_auto] md:items-end"
      onSubmit={handleLeagueSelectionSubmit}
    >
      <Field
        hint="Enter any BuzzerBeater league ID to inspect standings and run a projection."
        label="League ID"
      >
        <Input
          inputMode="numeric"
          onChange={(event) => setLeagueIdInput(event.target.value)}
          placeholder={connectedLeagueId ?? "League ID"}
          value={leagueIdInput}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" variant="secondary">
          Load league
        </Button>
        {connectedLeagueId && !isUsingConnectedLeague ? (
          <Button
            onClick={handleUseConnectedLeague}
            size="sm"
            type="button"
            variant="ghost"
          >
            Use my league
          </Button>
        ) : null}
      </div>
    </form>
  );

  if (!league) {
    return (
      <Panel>
        <SectionHeading eyebrow="League" title="Loading league comparisons" />
        <p className="text-sm leading-7 text-ink-muted">
          Pulling standings and league-wide team tables for this section.
        </p>
      </Panel>
    );
  }

  if (!activeLeague) {
    return (
      <Panel>
        <SectionHeading
          eyebrow="League"
          title="Loading requested league"
          description="Checking live standings for the selected league ID."
        />
        {leaguePicker}
        <Alert aria-busy="true" tone="note">
          Loading league {selectedLeagueId ?? "details"}.
        </Alert>
        {leagueOverrideQuery.error instanceof Error ? (
          <Alert tone="danger">{leagueOverrideQuery.error.message}</Alert>
        ) : null}
      </Panel>
    );
  }

  const standingsRows = flattenLeagueStandings(activeLeague);
  const comparisons = isFreshLeague
    ? (activeLeague.comparisons ?? null)
    : null;
  const projection = projectionQuery.data ?? null;
  const seasonLabel = activeLeague.season ?? comparisons?.season ?? null;

  return (
    <Panel>
      <SectionHeading
        eyebrow="League"
        title={activeLeague.league?.name ?? "League"}
        description={
          isFreshLeague
            ? "Standings plus team-by-team offense, defense, payroll, and arena comparisons from the latest synced league snapshot."
            : "Live league standings, team comparisons, and season projection for the selected league."
        }
        actions={
          isFreshLeague ? (
            <div className="flex flex-wrap gap-2">
              {leagueViewOptions.map((option) => (
                <Button
                  key={option.id}
                  onClick={() => setActiveViewId(option.id)}
                  size="sm"
                  variant={activeViewId === option.id ? "secondary" : "ghost"}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null
        }
      />

      {leaguePicker}

      {leagueOverrideQuery.isFetching && selectedLeagueArgs ? (
        <Alert aria-busy="true" tone="note">
          Loading league {selectedLeagueArgs.leagueId}.
        </Alert>
      ) : null}

      {leagueOverrideQuery.error instanceof Error ? (
        <Alert tone="danger">{leagueOverrideQuery.error.message}</Alert>
      ) : null}

      {isFreshLeague && (seasonLabel !== null || comparisons) ? (
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {seasonLabel !== null ? <span>Season {seasonLabel}</span> : null}
          {comparisons ? (
            <span>
              Built {new Date(comparisons.builtAt).toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
      ) : null}

      {!isFreshLeague ? (
        isRefreshingLeague ? (
          <Alert aria-busy="true" tone="note">
            <span className="inline-flex items-center gap-3">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-current opacity-70 motion-safe:animate-pulse"
              />
              Refreshing live league standings now. Tables and projections will
              appear as soon as current-season data is ready.
            </span>
          </Alert>
        ) : (
          <Alert tone="note">
            {describeUnavailableLeagueState(activeLeague.freshnessMessage ?? null)}
          </Alert>
        )
      ) : null}

      {isFreshLeague && comparisons?.incompleteTeamCount ? (
        <Alert tone="note">
          {describeLeagueComparisonState(comparisons.incompleteTeamCount)}
        </Alert>
      ) : null}

      {!isFreshLeague ? (
        <p className="text-sm leading-7 text-ink-muted">
          This section refreshes itself when live standings are missing, and it
          keeps previous-season league membership hidden until the current table
          is confirmed.
        </p>
      ) : null}

      {isFreshLeague && !standingsRows.length ? (
        <p className="text-sm leading-7 text-ink-muted">
          No league standings are ready yet.
        </p>
      ) : null}

      {isFreshLeague && standingsRows.length ? (
        <>
          {activeViewId === "standings" ? (
            <StandingsTable
              currentTeamId={currentTeamId}
              rows={standingsRows}
            />
          ) : null}
          {activeViewId === "projection" ? (
            <ProjectionView
              currentTeamId={currentTeamId}
              projection={projection}
              runProjection={() => submitProjectionMutation.mutate()}
              runningError={
                projectionQuery.error instanceof Error
                  ? projectionQuery.error.message
                  : submitProjectionMutation.error instanceof Error
                    ? submitProjectionMutation.error.message
                    : null
              }
              submitPending={submitProjectionMutation.isPending}
            />
          ) : null}
          {activeViewId === "offense" ? (
            comparisons ? (
              <OffenseTable
                currentTeamId={currentTeamId}
                rows={comparisons.offense}
              />
            ) : (
              <ComparisonEmptyState />
            )
          ) : null}
          {activeViewId === "defense" ? (
            comparisons ? (
              <DefenseTable
                currentTeamId={currentTeamId}
                rows={comparisons.defense}
              />
            ) : (
              <ComparisonEmptyState />
            )
          ) : null}
          {activeViewId === "payroll" ? (
            comparisons ? (
              <PayrollTable
                currentTeamId={currentTeamId}
                rows={comparisons.payroll}
              />
            ) : (
              <ComparisonEmptyState />
            )
          ) : null}
          {activeViewId === "arena" ? (
            comparisons ? (
              <ArenaTable currentTeamId={currentTeamId} rows={comparisons.arena} />
            ) : (
              <ComparisonEmptyState />
            )
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}

function ProjectionView({
  currentTeamId,
  projection,
  runProjection,
  runningError,
  submitPending,
}: {
  currentTeamId: string | null;
  projection: LeagueSeasonSimulationSnapshot | null;
  runProjection: () => void;
  runningError: string | null;
  submitPending: boolean;
}) {
  const result = projection?.result ?? null;
  const progress = projection?.progress ?? null;
  const active = projection ? activeProjectionStatuses.has(projection.status) : false;
  const currentTeamProjection = result
    ? findCurrentTeamProjection(result, currentTeamId)
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm leading-7 text-ink-muted">
            Run a Monte Carlo rest-of-season projection with current standings,
            remaining league games, and per-matchup minimax tactic probabilities.
          </p>
          {projection ? (
            <div className="flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
              <span>Season {projection.season}</span>
              <span>Status {projection.status}</span>
              <span>
                Requested {new Date(projection.requestedAt).toLocaleString("en-US")}
              </span>
            </div>
          ) : null}
        </div>
        <Button
          loading={submitPending}
          onClick={runProjection}
          size="sm"
          variant="secondary"
        >
          {projection ? "Rerun projection" : "Run projection"}
        </Button>
      </div>

      {runningError ? <Alert tone="danger">{runningError}</Alert> : null}

      {projection?.status === "FAILED" && projection.error ? (
        <Alert tone="danger">{projection.error}</Alert>
      ) : null}

      {active && progress ? (
        <Alert tone="note">{describeProjectionProgress(progress)}</Alert>
      ) : null}

      {!projection ? (
        <Alert tone="note">
          No season projection has been generated for the current league yet.
        </Alert>
      ) : null}

      {currentTeamProjection ? (
        <Alert tone="note">
          {currentTeamProjection.teamName ?? "Your team"} projects to{" "}
          {formatProjectedRecord(
            currentTeamProjection.expectedWins,
            currentTeamProjection.expectedLosses,
          )}{" "}
          with an average finish of{" "}
          {decimalFormatter.format(currentTeamProjection.averageFinish)} and a{" "}
          {formatProbability(currentTeamProjection.firstPlaceProbability)} chance
          to finish first.
        </Alert>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
            <span>
              Built {new Date(result.generatedAt).toLocaleString("en-US")}
            </span>
            <span>
              {numberFormatter.format(result.simulationCount)} simulations
            </span>
            <span>
              Residual sigma {decimalFormatter.format(result.residualSigma)}
            </span>
            {result.modelVersion ? <span>{result.modelVersion}</span> : null}
          </div>

          {result.lowSampleTeamCount > 0 ? (
            <Alert tone="note">
              {result.lowSampleTeamCount} team
              {result.lowSampleTeamCount === 1 ? "" : "s"} relied on a small or
              fallback historical sample. Check the snapshot notes in the table
              below.
            </Alert>
          ) : null}

          <Alert tone="note">
            Canonical standings rank teams by expected wins and expected point
            margin. Finish odds and win ranges come from{" "}
            {numberFormatter.format(result.simulationCount)} simulated seasons.
          </Alert>

          {result.conferences.map((conference) => (
            <ProjectionConferenceTable
              conference={conference}
              currentTeamId={currentTeamId}
              key={conference.conferenceIndex}
            />
          ))}

          <ProjectionGamesTable games={result.remainingGames} />
        </>
      ) : null}
    </div>
  );
}

function ProjectionConferenceTable({
  conference,
  currentTeamId,
}: {
  conference: LeagueSeasonSimulationResult["conferences"][number];
  currentTeamId: string | null;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold tracking-[0.08em] text-ink uppercase">
        Conference {conference.conferenceIndex + 1}
      </h3>
      <TableShell>
        <thead>
          <tr>
            <TableHeadCell className="pl-0">Team</TableHeadCell>
            <TableHeadCell className="text-right">Current</TableHeadCell>
            <TableHeadCell className="text-right">Projected</TableHeadCell>
            <TableHeadCell className="text-right">Wins range</TableHeadCell>
            <TableHeadCell className="text-right">Avg finish</TableHeadCell>
            <TableHeadCell className="text-right">1st</TableHeadCell>
            <TableHeadCell>Finish odds</TableHeadCell>
            <TableHeadCell>Snapshot</TableHeadCell>
          </tr>
        </thead>
        <tbody>
          {conference.teams.map((team) => {
            const highlighted = isCurrentLeagueTeamRow(team.teamId, currentTeamId);
            return (
              <tr key={buildLeagueRowKey(team.teamId, team.standingsIndex)}>
                <TableCell className={leagueRowCellClassName(highlighted, "pl-0")}>
                  <span className={highlighted ? "font-semibold" : undefined}>
                    {team.teamName ?? "Unknown team"}
                  </span>
                </TableCell>
                <TableCell
                  className={leagueRowCellClassName(
                    highlighted,
                    "text-right tabular-nums",
                  )}
                >
                  {formatRecord(team.currentWins, team.currentLosses)}
                </TableCell>
                <TableCell
                  className={leagueRowCellClassName(
                    highlighted,
                    "text-right tabular-nums",
                  )}
                >
                  {formatProjectedRecord(team.expectedWins, team.expectedLosses)}
                </TableCell>
                <TableCell
                  className={leagueRowCellClassName(
                    highlighted,
                    "text-right tabular-nums",
                  )}
                >
                  {formatWinsPercentiles(team.winsP10, team.winsP50, team.winsP90)}
                </TableCell>
                <TableCell
                  className={leagueRowCellClassName(
                    highlighted,
                    "text-right tabular-nums",
                  )}
                >
                  {decimalFormatter.format(team.averageFinish)}
                </TableCell>
                <TableCell
                  className={leagueRowCellClassName(
                    highlighted,
                    "text-right tabular-nums",
                  )}
                >
                  {formatProbability(team.firstPlaceProbability)}
                </TableCell>
                <TableCell className={leagueRowCellClassName(highlighted)}>
                  <span className="text-sm leading-6 text-ink-muted">
                    {formatFinishDistribution(team.finishProbabilities)}
                  </span>
                </TableCell>
                <TableCell className={leagueRowCellClassName(highlighted)}>
                  <div className="space-y-1 text-sm leading-6">
                    <div>
                      Source tactics: {team.snapshot.offense} /{" "}
                      {team.snapshot.defense}
                    </div>
                    <div className="text-ink-muted">
                      {describeProjectionSelectionStrategy(
                        team.snapshot.selectionStrategy,
                      )}
                    </div>
                    {team.snapshot.sourceMatchId ? (
                      <div className="text-ink-muted">
                        Source {team.snapshot.sourceMatchId}
                        {typeof team.snapshot.sourceSeason === "number"
                          ? ` · S${team.snapshot.sourceSeason}`
                          : ""}
                      </div>
                    ) : null}
                    {team.snapshot.sampleWarning ? (
                      <div className="text-ink-muted">
                        {team.snapshot.sampleWarning}
                      </div>
                    ) : null}
                  </div>
                </TableCell>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
    </div>
  );
}

function ProjectionGamesTable({
  games,
}: {
  games: LeagueSeasonSimulationResult["remainingGames"];
}) {
  if (!games.length) {
    return (
      <Alert tone="note">
        No remaining regular-season league games were found for this projection.
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold tracking-[0.08em] text-ink uppercase">
        Remaining game probabilities
      </h3>
      <TableShell>
        <thead>
          <tr>
            <TableHeadCell className="pl-0">Tip-off</TableHeadCell>
            <TableHeadCell>Matchup</TableHeadCell>
            <TableHeadCell>Minimax tactics</TableHeadCell>
            <TableHeadCell className="text-right">Expected</TableHeadCell>
            <TableHeadCell className="text-right">Home win</TableHeadCell>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <tr key={game.matchId}>
              <TableCell className="pl-0 text-sm text-ink-muted">
                {game.startTime
                  ? new Date(game.startTime).toLocaleString("en-US")
                  : "TBD"}
              </TableCell>
              <TableCell>
                {game.homeTeamName ?? "Home"} vs {game.awayTeamName ?? "Away"}
              </TableCell>
              <TableCell className="text-sm text-ink-muted">
                Home {game.homeOffense} / {game.homeDefense} · Away{" "}
                {game.awayOffense} / {game.awayDefense}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {decimalFormatter.format(game.expectedHomeScore)}-
                {decimalFormatter.format(game.expectedAwayScore)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatProbability(game.homeWinProbability)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function ComparisonEmptyState() {
  return (
    <p className="text-sm leading-7 text-ink-muted">
      Team comparison tables are not available yet for this league snapshot.
    </p>
  );
}

function StandingsTable({
  currentTeamId,
  rows,
}: {
  currentTeamId: string | null;
  rows: ReturnType<typeof flattenLeagueStandings>;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          <TableHeadCell className="pl-0">Conf</TableHeadCell>
          <TableHeadCell>Team</TableHeadCell>
          <TableHeadCell className="text-right">W-L</TableHeadCell>
          <TableHeadCell className="text-right">Margin</TableHeadCell>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const highlighted = isCurrentLeagueTeamRow(row.teamId, currentTeamId);

          return (
            <tr key={buildLeagueRowKey(row.teamId, row.standingsIndex)}>
              <TableCell className={leagueRowCellClassName(highlighted, "pl-0")}>
                {row.conferenceIndex + 1}
              </TableCell>
              <TableCell className={leagueRowCellClassName(highlighted)}>
                <span className={highlighted ? "font-semibold" : undefined}>
                  {row.teamName ?? "Unknown team"}
                </span>
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatRecord(row.wins, row.losses)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatSignedNumber(row.pointMargin)}
              </TableCell>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function OffenseTable({
  currentTeamId,
  rows,
}: {
  currentTeamId: string | null;
  rows: NonNullable<NonNullable<LeagueIntelPayload["comparisons"]>["offense"]>;
}) {
  return (
    <TripletTable
      currentTeamId={currentTeamId}
      columns={[
        { key: "points", label: "PPG", kind: "number" },
        { key: "fgPct", label: "FG%", kind: "percentage" },
        { key: "threePtPct", label: "3P%", kind: "percentage" },
        { key: "ftPct", label: "FT%", kind: "percentage" },
        { key: "assists", label: "APG", kind: "number" },
        { key: "offensiveRebounds", label: "ORPG", kind: "number" },
        { key: "effectiveFgPct", label: "EFFG", kind: "percentage" },
      ]}
      rows={rows}
    />
  );
}

function DefenseTable({
  currentTeamId,
  rows,
}: {
  currentTeamId: string | null;
  rows: NonNullable<NonNullable<LeagueIntelPayload["comparisons"]>["defense"]>;
}) {
  return (
    <TripletTable
      currentTeamId={currentTeamId}
      columns={[
        { key: "totalRebounds", label: "RPG", kind: "number" },
        { key: "blocks", label: "BPG", kind: "number" },
        { key: "steals", label: "SPG", kind: "number" },
        { key: "turnovers", label: "TOPG", kind: "number" },
        { key: "fouls", label: "PFPG", kind: "number" },
      ]}
      rows={rows}
    />
  );
}

function TripletTable({
  columns,
  currentTeamId,
  rows,
}: {
  columns: Array<{
    key: string;
    kind: "number" | "percentage";
    label: string;
  }>;
  currentTeamId: string | null;
  rows: Array<{
    conferenceIndex: number;
    gamesPlayed?: number | null;
    standingsIndex: number;
    teamId?: string | null;
    teamName?: string | null;
    [key: string]: unknown;
  }>;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          <TableHeadCell className="pl-0" rowSpan={2}>
            Conf
          </TableHeadCell>
          <TableHeadCell rowSpan={2}>Team</TableHeadCell>
          <TableHeadCell className="text-right" rowSpan={2}>
            GP
          </TableHeadCell>
          {columns.map((column) => (
            <TableHeadCell className="text-center" colSpan={3} key={column.key}>
              {column.label}
            </TableHeadCell>
          ))}
        </tr>
        <tr>
          {columns.flatMap((column) => [
            <TableHeadCell className="text-right" key={`${column.key}-team`}>
              Team
            </TableHeadCell>,
            <TableHeadCell className="text-right" key={`${column.key}-opp`}>
              Opp
            </TableHeadCell>,
            <TableHeadCell className="text-right" key={`${column.key}-diff`}>
              Diff
            </TableHeadCell>,
          ])}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const highlighted = isCurrentLeagueTeamRow(
            row.teamId ?? null,
            currentTeamId,
          );

          return (
            <tr key={buildLeagueRowKey(row.teamId ?? null, row.standingsIndex)}>
              <TableCell className={leagueRowCellClassName(highlighted, "pl-0")}>
                {row.conferenceIndex + 1}
              </TableCell>
              <TableCell className={leagueRowCellClassName(highlighted)}>
                <span className={highlighted ? "font-semibold" : undefined}>
                  {row.teamName ?? "Unknown team"}
                </span>
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatInteger(row.gamesPlayed ?? null)}
              </TableCell>
              {columns.flatMap((column) => {
                const metric = (row[column.key] ?? null) as LeagueComparisonMetricTriplet | null;
                return [
                  <TableCell
                    className={leagueRowCellClassName(
                      highlighted,
                      "text-right tabular-nums",
                    )}
                    key={`${column.key}-team-${row.standingsIndex}`}
                  >
                    {formatTripletMetric(metric, "team", column.kind)}
                  </TableCell>,
                  <TableCell
                    className={leagueRowCellClassName(
                      highlighted,
                      "text-right tabular-nums",
                    )}
                    key={`${column.key}-opp-${row.standingsIndex}`}
                  >
                    {formatTripletMetric(metric, "opponent", column.kind)}
                  </TableCell>,
                  <TableCell
                    className={leagueRowCellClassName(
                      highlighted,
                      "text-right tabular-nums",
                    )}
                    key={`${column.key}-diff-${row.standingsIndex}`}
                  >
                    {formatTripletMetric(metric, "diff", column.kind)}
                  </TableCell>,
                ];
              })}
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function PayrollTable({
  currentTeamId,
  rows,
}: {
  currentTeamId: string | null;
  rows: NonNullable<NonNullable<LeagueIntelPayload["comparisons"]>["payroll"]>;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          <TableHeadCell className="pl-0">Conf</TableHeadCell>
          <TableHeadCell>Team</TableHeadCell>
          <TableHeadCell className="text-right">Players</TableHeadCell>
          <TableHeadCell className="text-right">Total</TableHeadCell>
          <TableHeadCell className="text-right">Average</TableHeadCell>
          <TableHeadCell className="text-right">Std Dev</TableHeadCell>
          <TableHeadCell className="text-right">Top 5</TableHeadCell>
          <TableHeadCell className="text-right">Top 8</TableHeadCell>
          <TableHeadCell className="text-right">Top 10</TableHeadCell>
          <TableHeadCell className="text-right">Top 6 to 10</TableHeadCell>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const highlighted = isCurrentLeagueTeamRow(row.teamId, currentTeamId);

          return (
            <tr key={buildLeagueRowKey(row.teamId, row.standingsIndex)}>
              <TableCell className={leagueRowCellClassName(highlighted, "pl-0")}>
                {row.conferenceIndex + 1}
              </TableCell>
              <TableCell className={leagueRowCellClassName(highlighted)}>
                <span className={highlighted ? "font-semibold" : undefined}>
                  {row.teamName ?? "Unknown team"}
                </span>
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatInteger(row.playerCount)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatCurrency(row.totalPayroll)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatCurrency(row.averageSalary)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatCurrency(row.standardDeviation)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatCurrency(row.top5Payroll)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatCurrency(row.top8Payroll)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatCurrency(row.top10Payroll)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatCurrency(row.payrollRanks6To10)}
              </TableCell>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function ArenaTable({
  currentTeamId,
  rows,
}: {
  currentTeamId: string | null;
  rows: NonNullable<NonNullable<LeagueIntelPayload["comparisons"]>["arena"]>;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          <TableHeadCell className="pl-0">Conf</TableHeadCell>
          <TableHeadCell>Team</TableHeadCell>
          <TableHeadCell className="text-right">Total capacity</TableHeadCell>
          <TableHeadCell className="text-right">Bleachers</TableHeadCell>
          <TableHeadCell className="text-right">Lower tier</TableHeadCell>
          <TableHeadCell className="text-right">Courtside</TableHeadCell>
          <TableHeadCell className="text-right">Luxury boxes</TableHeadCell>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const highlighted = isCurrentLeagueTeamRow(row.teamId, currentTeamId);

          return (
            <tr key={buildLeagueRowKey(row.teamId, row.standingsIndex)}>
              <TableCell className={leagueRowCellClassName(highlighted, "pl-0")}>
                {row.conferenceIndex + 1}
              </TableCell>
              <TableCell className={leagueRowCellClassName(highlighted)}>
                <span className={highlighted ? "font-semibold" : undefined}>
                  {row.teamName ?? "Unknown team"}
                </span>
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatInteger(row.totalCapacity)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatInteger(row.bleachers)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatInteger(row.lowerTier)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatInteger(row.courtside)}
              </TableCell>
              <TableCell
                className={leagueRowCellClassName(
                  highlighted,
                  "text-right tabular-nums",
                )}
              >
                {formatInteger(row.luxuryBoxes)}
              </TableCell>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

export function flattenLeagueStandings(league: LeagueIntelPayload) {
  let standingsIndex = 0;

  return league.standings.flatMap((conference) =>
    conference.teams.map((team) => ({
      conferenceIndex: conference.index,
      losses: team.losses ?? null,
      pointMargin: team.pointMargin ?? null,
      standingsIndex: standingsIndex++,
      teamId: team.teamId ?? null,
      teamName: team.teamName ?? null,
      wins: team.wins ?? null,
    })),
  );
}

export function describeLeagueComparisonState(incompleteTeamCount: number): string {
  if (incompleteTeamCount <= 0) {
    return "All league comparison rows are ready.";
  }

  return `${incompleteTeamCount} team${incompleteTeamCount === 1 ? "" : "s"} could not be fully refreshed, so some comparison cells are blank.`;
}

function buildLeagueRowKey(teamId: string | null | undefined, standingsIndex: number) {
  return `${teamId ?? "unknown"}::${standingsIndex}`;
}

function leagueRowCellClassName(highlighted: boolean, className?: string) {
  return cn(highlighted && "bg-accent/10", className);
}

function formatCurrency(value: number | null | undefined): string {
  return typeof value === "number" ? currencyFormatter.format(value) : "—";
}

function formatInteger(value: number | null | undefined): string {
  return typeof value === "number" ? numberFormatter.format(value) : "—";
}

function formatRecord(
  wins: number | null | undefined,
  losses: number | null | undefined,
): string {
  if (typeof wins !== "number" || typeof losses !== "number") {
    return "—";
  }

  return `${wins}-${losses}`;
}

function formatProjectedRecord(
  wins: number | null | undefined,
  losses: number | null | undefined,
): string {
  if (typeof wins !== "number" || typeof losses !== "number") {
    return "—";
  }

  return `${formatProjectionNumber(wins)}-${formatProjectionNumber(losses)}`;
}

function formatSignedNumber(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "—";
  }

  if (value === 0) {
    return "0";
  }

  const absoluteValue = Number.isInteger(value)
    ? numberFormatter.format(Math.abs(value))
    : Math.abs(value).toFixed(1);
  return `${value > 0 ? "+" : "-"}${absoluteValue}`;
}

function formatTripletMetric(
  metric: LeagueComparisonMetricTriplet | null,
  part: keyof LeagueComparisonMetricTriplet,
  _kind: "number" | "percentage",
): string {
  const value = metric?.[part];
  if (typeof value !== "number") {
    return "—";
  }

  return value.toFixed(1);
}

function formatProjectionNumber(value: number): string {
  return Number.isInteger(value)
    ? numberFormatter.format(value)
    : decimalFormatter.format(value);
}

function formatWinsPercentiles(
  p10: number | null | undefined,
  p50: number | null | undefined,
  p90: number | null | undefined,
): string {
  if (
    typeof p10 !== "number" ||
    typeof p50 !== "number" ||
    typeof p90 !== "number"
  ) {
    return "—";
  }

  return `${formatProjectionNumber(p10)} / ${formatProjectionNumber(p50)} / ${formatProjectionNumber(p90)}`;
}

function formatProbability(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "—";
  }

  return `${decimalFormatter.format(value * 100)}%`;
}

function formatFinishDistribution(
  probabilities: ReadonlyArray<{
    place: number;
    probability: number;
  }>,
): string {
  const formatted = probabilities
    .filter((entry) => entry.probability > 0.01)
    .map((entry) => `${entry.place}: ${formatProbability(entry.probability)}`)
    .join(" · ");
  return formatted || "—";
}

function describeUnavailableLeagueState(message: string | null): string {
  if (
    message &&
    !/fresh refresh succeeds/i.test(message) &&
    !/Live league standings are unavailable right now/i.test(message)
  ) {
    return message;
  }

  return "Live league standings could not be confirmed after the latest refresh. This section will retry automatically and will not show previous-season league membership as current.";
}

function describeProjectionSelectionStrategy(
  strategy:
    | "BEST_AVAILABLE"
    | "CURRENT_SEASON_15TH_PERCENTILE"
    | "LEAGUE_AVERAGE_FALLBACK"
    | "MULTI_SEASON_THIRD_BEST",
): string {
  switch (strategy) {
    case "CURRENT_SEASON_15TH_PERCENTILE":
      return "Current-season 15th percentile snapshot";
    case "MULTI_SEASON_THIRD_BEST":
      return "Multi-season third-best fallback snapshot";
    case "BEST_AVAILABLE":
      return "Best available historical snapshot";
    case "LEAGUE_AVERAGE_FALLBACK":
      return "League-average fallback snapshot";
  }
}

function describeProjectionProgress(
  progress: LeagueSeasonSimulationProgress,
): string {
  const unitSummary =
    typeof progress.completedUnits === "number" &&
    typeof progress.totalUnits === "number" &&
    progress.unitLabel
      ? ` ${numberFormatter.format(progress.completedUnits)} of ${numberFormatter.format(progress.totalUnits)} ${progress.unitLabel}.`
      : "";
  return `${progress.summary}${unitSummary}`;
}

function findCurrentTeamProjection(
  result: LeagueSeasonSimulationResult,
  currentTeamId: string | null,
) {
  if (!currentTeamId) {
    return null;
  }

  for (const conference of result.conferences) {
    const match = conference.teams.find((team) => team.teamId === currentTeamId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function isCurrentLeagueTeamRow(
  rowTeamId: string | null | undefined,
  currentTeamId: string | null,
): boolean {
  return Boolean(rowTeamId && currentTeamId && rowTeamId === currentTeamId);
}

function normalizeLeagueId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const __testing = {
  describeUnavailableLeagueState,
  describeProjectionProgress,
  describeProjectionSelectionStrategy,
  describeLeagueComparisonState,
  formatFinishDistribution,
  flattenLeagueStandings,
  isCurrentLeagueTeamRow,
  normalizeLeagueId,
};
