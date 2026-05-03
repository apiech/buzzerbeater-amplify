"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  rivalsWorkspaceQueryOptions,
  submitRivalsBackfillMutation,
} from "@/app/dashboard/workspace-query-client";
import type {
  RivalsBackfillStatus,
  RivalsPanelContext,
  RivalsWorkspacePayload,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";
import { cn } from "@/app/ui/primitives/cn";

type RivalsPanelProps = {
  context: RivalsPanelContext;
};

type RivalryRowRecord = RivalsWorkspacePayload["rows"][number];
type RivalryMatchRecord = NonNullable<
  NonNullable<RivalsWorkspacePayload["selectedRivalry"]>["matches"]
>[number];
type CompetitionBreakdownRow = NonNullable<
  NonNullable<RivalsWorkspacePayload["selectedRivalry"]>["competitionBreakdown"]
>[number];
type SeasonBreakdownRow = NonNullable<
  NonNullable<RivalsWorkspacePayload["selectedRivalry"]>["seasonBreakdown"]
>[number];
type VisibleAggregateRow = Pick<
  RivalryRowRecord,
  | "averageMargin"
  | "games"
  | "homeLosses"
  | "homeWins"
  | "lastMatch"
  | "leagueLosses"
  | "leagueWins"
  | "losses"
  | "playoffLosses"
  | "playoffWins"
  | "roadLosses"
  | "roadWins"
  | "seasons"
  | "tvGames"
  | "winPct"
  | "wins"
>;

type AggregateSortKey =
  | "averageMargin"
  | "games"
  | "lastMatch"
  | "homeLosses"
  | "homeWins"
  | "leagueLosses"
  | "leagueWins"
  | "losses"
  | "opponent"
  | "playoffLosses"
  | "playoffWins"
  | "roadLosses"
  | "roadWins"
  | "tvGames"
  | "winPct"
  | "wins";

type MatchSortKey =
  | "competition"
  | "date"
  | "margin"
  | "outcome"
  | "season"
  | "venue";

type SortDirection = "asc" | "desc";

type CheckboxFilterOption = {
  label: string;
  value: string;
};

type SeasonRangeSelection = {
  endSeason: string;
  startSeason: string;
};

const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const filterGridClassName = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
const detailGridClassName = "grid gap-4 xl:grid-cols-2";
const subduedCopyClassName = "text-sm leading-7 text-ink-muted";
const checkboxListClassName = "grid gap-2";
const checkboxOptionClassName =
  "flex items-center gap-3 rounded-card border border-black/8 bg-white/70 px-3 py-2 text-sm text-ink";
const aggregateRowCellClassName =
  "border-t-2 border-black/12 bg-black/[0.03] font-semibold";

const aggregateSortOptions: Array<{
  key: AggregateSortKey;
  label: string;
}> = [
  { key: "wins", label: "Wins" },
  { key: "losses", label: "Losses" },
  { key: "winPct", label: "Win %" },
  { key: "games", label: "Meetings" },
  { key: "leagueWins", label: "League wins" },
  { key: "leagueLosses", label: "League losses" },
  { key: "homeWins", label: "Home wins" },
  { key: "homeLosses", label: "Home losses" },
  { key: "roadWins", label: "Road wins" },
  { key: "roadLosses", label: "Road losses" },
  { key: "playoffWins", label: "Playoff wins" },
  { key: "playoffLosses", label: "Playoff losses" },
  { key: "averageMargin", label: "Average margin" },
  { key: "tvGames", label: "TV games" },
  { key: "lastMatch", label: "Last match" },
  { key: "opponent", label: "Opponent" },
];

const competitionOrder = [
  "LEAGUE_REGULAR_SEASON",
  "PLAYOFFS",
  "CUP",
  "SCRIMMAGE",
  "PRIVATE_LEAGUE",
  "BUZZERBEATER_BEST",
  "BUZZERBEATER_MADNESS",
  "OTHER",
] as const;

const venueFilterOptions: CheckboxFilterOption[] = [
  { label: "Home", value: "HOME" },
  { label: "Road", value: "ROAD" },
];

const outcomeFilterOptions: CheckboxFilterOption[] = [
  { label: "Wins", value: "WIN" },
  { label: "Losses", value: "LOSS" },
];

const tvScopeFilterOptions: CheckboxFilterOption[] = [
  { label: "TV", value: "TV" },
  { label: "Non-TV", value: "NON_TV" },
];

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  year: "numeric",
});

export function RivalsPanel({ context }: RivalsPanelProps) {
  const refreshMutation = useMutation({
    mutationFn: submitRivalsBackfillMutation,
  });
  const [searchText, setSearchText] = useState("");
  const [selectedCompetitions, setSelectedCompetitions] = useState<
    string[] | null
  >(null);
  const [selectedVenues, setSelectedVenues] = useState<string[] | null>(null);
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[] | null>(
    null,
  );
  const [selectedTvScopes, setSelectedTvScopes] = useState<string[] | null>(
    null,
  );
  const [startSeason, setStartSeason] = useState<string | null>(null);
  const [endSeason, setEndSeason] = useState<string | null>(null);
  const [minimumGames, setMinimumGames] = useState("");
  const [sortKey, setSortKey] = useState<AggregateSortKey>("wins");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedOpponentId, setSelectedOpponentId] = useState("");
  const [matchSortKey, setMatchSortKey] = useState<MatchSortKey>("date");
  const [matchSortDirection, setMatchSortDirection] =
    useState<SortDirection>("desc");

  const payloadDefaults = useMemo(
    () => ({
      competitionOptions: [] as CheckboxFilterOption[],
      seasonRange: { endSeason: "", startSeason: "" },
      seasonValues: [] as string[],
    }),
    [],
  );
  const effectiveCompetitionOptions = payloadDefaults.competitionOptions;
  const effectiveSeasonValues = payloadDefaults.seasonValues;
  const defaultSeasonRange = payloadDefaults.seasonRange;

  const queryArgs = useMemo(
    () => ({
      competitionKeys:
        selectedCompetitions === null ? undefined : selectedCompetitions,
      endSeason: endSeason === null ? undefined : parseSeasonValue(endSeason),
      outcomes: selectedOutcomes === null ? undefined : selectedOutcomes,
      selectedOpponentId: selectedOpponentId || undefined,
      startSeason:
        startSeason === null ? undefined : parseSeasonValue(startSeason),
      tvScopes: selectedTvScopes === null ? undefined : selectedTvScopes,
      venues: selectedVenues === null ? undefined : selectedVenues,
    }),
    [
      endSeason,
      selectedCompetitions,
      selectedOpponentId,
      selectedOutcomes,
      selectedTvScopes,
      selectedVenues,
      startSeason,
    ],
  );

  const rivalsQuery = useQuery({
    ...rivalsWorkspaceQueryOptions(queryArgs),
    enabled: Boolean(context.team.teamId),
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) =>
      hasActiveRivalsStatus(query.state.data?.status) ? 5000 : false,
  });

  const deferredSearchText = useDeferredValue(searchText);
  const payload = rivalsQuery.data ?? null;
  const panelError =
    readQueryError(refreshMutation.error) ?? readQueryError(rivalsQuery.error);
  const isLoading = rivalsQuery.isPending || refreshMutation.isPending;
  const statusMessage = resolveRivalsStatusMessage(payload?.status ?? null);

  const competitionOptions = payload
    ? payload.competitionOptions.map((option) => ({
        label: option.label,
        value: option.key,
      }))
    : effectiveCompetitionOptions;
  const seasonValues = payload
    ? payload.seasonRange.availableSeasons.map(String)
    : effectiveSeasonValues;
  const effectiveSeasonRange = normalizeSeasonRange(
    seasonValues,
    startSeason ?? toSeasonString(payload?.seasonRange.startSeason),
    endSeason ?? toSeasonString(payload?.seasonRange.endSeason),
  );
  const selectedCompetitionValues = resolveSelectedValues(
    selectedCompetitions,
    competitionOptions.map((option) => option.value),
  );
  const selectedVenueValues = resolveSelectedValues(
    selectedVenues,
    venueFilterOptions.map((option) => option.value),
  );
  const selectedOutcomeValues = resolveSelectedValues(
    selectedOutcomes,
    outcomeFilterOptions.map((option) => option.value),
  );
  const selectedTvScopeValues = resolveSelectedValues(
    selectedTvScopes,
    tvScopeFilterOptions.map((option) => option.value),
  );
  const minimumGamesValue = Math.max(1, Number.parseInt(minimumGames, 10) || 1);
  const normalizedSearch = deferredSearchText.trim().toLowerCase();

  const rivalryRows = sortRivalryRows(
    (payload?.rows ?? []).filter((row) => {
      if (row.games < minimumGamesValue) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return (
        row.opponentTeamName.toLowerCase().includes(normalizedSearch) ||
        row.opponentTeamId.includes(normalizedSearch)
      );
    }),
    sortKey,
    sortDirection,
  );

  useEffect(() => {
    if (!rivalryRows.length) {
      if (selectedOpponentId) {
        setSelectedOpponentId("");
      }
      return;
    }

    if (!rivalryRows.some((row) => row.opponentTeamId === selectedOpponentId)) {
      const firstRow = rivalryRows[0];
      if (firstRow) {
        setSelectedOpponentId(firstRow.opponentTeamId);
      }
    }
  }, [rivalryRows, selectedOpponentId]);

  const selectedRivalry =
    payload?.selectedRivalry &&
    (!selectedOpponentId ||
      payload.selectedRivalry.row.opponentTeamId === selectedOpponentId)
      ? payload.selectedRivalry
      : null;
  const selectedMatches = sortRivalryMatches(
    selectedRivalry?.matches ?? [],
    matchSortKey,
    matchSortDirection,
  );
  const competitionBreakdown: CompetitionBreakdownRow[] =
    selectedRivalry?.competitionBreakdown ?? [];
  const seasonBreakdown: SeasonBreakdownRow[] =
    selectedRivalry?.seasonBreakdown ?? [];

  const activeTeamName =
    payload?.team.teamName ?? context.team.teamName ?? "Your club";
  const visibleAggregate = buildVisibleAggregate(rivalryRows);
  const filteredMatchCount = visibleAggregate?.games ?? 0;
  const filterSummary = `Showing ${rivalryRows.length} rival${
    rivalryRows.length === 1 ? "" : "s"
  } across ${filteredMatchCount} meeting${
    filteredMatchCount === 1 ? "" : "s"
  }.`;

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            loading={isLoading}
            onClick={() =>
              void refreshMutation.mutateAsync(undefined, {
                onSuccess: () => {
                  void rivalsQuery.refetch();
                },
              })
            }
            variant="secondary"
          >
            {payload?.status ? "Refresh history" : "Build history"}
          </Button>
        }
        description="Scan every completed game on the active club's schedule history, aggregate the record by opponent, and drill into league, playoff, cup, TV, venue, and season splits."
        eyebrow="Rivals"
        title="My greatest rivals"
      />

      <p className={subduedCopyClassName}>
        Focus team: {activeTeamName}. Filters apply before aggregation, so the
        rivalry table always reflects the exact slice you asked for.
      </p>

      {panelError ? <Alert>{panelError}</Alert> : null}
      {statusMessage ? <Alert>{statusMessage}</Alert> : null}
      {payload?.warning ? <Alert>{payload.warning}</Alert> : null}

      <div className={summaryGridClassName}>
        <StatCard
          detail="Completed meetings found in the live history scan."
          label="All meetings"
          value={payload?.summary.totalCompletedGames ?? 0}
        />
        <StatCard
          detail="Distinct opponents with at least one completed game."
          label="Rivals"
          value={payload?.summary.totalOpponents ?? 0}
        />
        <StatCard
          detail={`Loaded ${payload?.summary.seasonsWithGames ?? 0} seasons with games.`}
          label="Season span"
          value={formatSeasonSpan(
            payload?.summary.firstSeason ?? null,
            payload?.summary.lastSeason ?? null,
          )}
        />
        <StatCard
          detail={formatRecord(
            payload?.summary.wins ?? 0,
            payload?.summary.losses ?? 0,
          )}
          label="TV games"
          value={payload?.summary.tvGames ?? 0}
        />
      </div>

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          actions={
            <Button onClick={resetFilters} size="sm" variant="ghost">
              Reset filters
            </Button>
          }
          description={filterSummary}
          title="Filters and ranking"
          titleAs="h4"
        />

        <div className={filterGridClassName}>
          <Field label="Search">
            <Input
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Opponent name or team ID"
              value={searchText}
            />
          </Field>

          <Field label="Minimum meetings">
            <Input
              inputMode="numeric"
              min={1}
              onChange={(event) => setMinimumGames(event.target.value)}
              placeholder="Minimum meetings"
              type="number"
              value={minimumGames}
            />
          </Field>

          <Field label="Season range">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                disabled={!seasonValues.length}
                onChange={(event) => {
                  const nextRange = updateSeasonRangeFromStart(
                    seasonValues,
                    event.target.value,
                    effectiveSeasonRange.endSeason,
                  );
                  setStartSeason(nextRange.startSeason);
                  setEndSeason(nextRange.endSeason);
                }}
                value={
                  effectiveSeasonRange.startSeason ||
                  defaultSeasonRange.startSeason
                }
              >
                {seasonValues.length ? (
                  seasonValues.map((season) => (
                    <option key={`start-${season}`} value={season}>
                      Start S{season}
                    </option>
                  ))
                ) : (
                  <option value="">No seasons</option>
                )}
              </Select>
              <Select
                disabled={!seasonValues.length}
                onChange={(event) => {
                  const nextRange = updateSeasonRangeFromEnd(
                    seasonValues,
                    effectiveSeasonRange.startSeason,
                    event.target.value,
                  );
                  setStartSeason(nextRange.startSeason);
                  setEndSeason(nextRange.endSeason);
                }}
                value={
                  effectiveSeasonRange.endSeason || defaultSeasonRange.endSeason
                }
              >
                {seasonValues.length ? (
                  seasonValues.map((season) => (
                    <option key={`end-${season}`} value={season}>
                      End S{season}
                    </option>
                  ))
                ) : (
                  <option value="">No seasons</option>
                )}
              </Select>
            </div>
          </Field>

          <Field label="Competition">
            <CheckboxFilterGroup
              onSelectAll={() => setSelectedCompetitions(null)}
              onSelectNone={() => setSelectedCompetitions([])}
              onToggleValue={(value) =>
                setSelectedCompetitions((current) =>
                  toggleSelectedValue(
                    current,
                    value,
                    competitionOptions.map((option) => option.value),
                  ),
                )
              }
              options={competitionOptions}
              selectedValues={selectedCompetitionValues}
            />
          </Field>

          <Field label="Venue">
            <CheckboxFilterGroup
              onSelectAll={() => setSelectedVenues(null)}
              onSelectNone={() => setSelectedVenues([])}
              onToggleValue={(value) =>
                setSelectedVenues((current) =>
                  toggleSelectedValue(
                    current,
                    value,
                    venueFilterOptions.map((option) => option.value),
                  ),
                )
              }
              options={venueFilterOptions}
              selectedValues={selectedVenueValues}
            />
          </Field>

          <Field label="Outcome">
            <CheckboxFilterGroup
              onSelectAll={() => setSelectedOutcomes(null)}
              onSelectNone={() => setSelectedOutcomes([])}
              onToggleValue={(value) =>
                setSelectedOutcomes((current) =>
                  toggleSelectedValue(
                    current,
                    value,
                    outcomeFilterOptions.map((option) => option.value),
                  ),
                )
              }
              options={outcomeFilterOptions}
              selectedValues={selectedOutcomeValues}
            />
          </Field>

          <Field label="TV">
            <CheckboxFilterGroup
              onSelectAll={() => setSelectedTvScopes(null)}
              onSelectNone={() => setSelectedTvScopes([])}
              onToggleValue={(value) =>
                setSelectedTvScopes((current) =>
                  toggleSelectedValue(
                    current,
                    value,
                    tvScopeFilterOptions.map((option) => option.value),
                  ),
                )
              }
              options={tvScopeFilterOptions}
              selectedValues={selectedTvScopeValues}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Field className="max-w-xs" label="Sort rivals by">
            <Select
              onChange={(event) =>
                setSortKey(event.target.value as AggregateSortKey)
              }
              value={sortKey}
            >
              {aggregateSortOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-wrap gap-2 pt-7">
            <SortDirectionButton
              active={sortDirection === "desc"}
              label="High to low"
              onClick={() => setSortDirection("desc")}
            />
            <SortDirectionButton
              active={sortDirection === "asc"}
              label="Low to high"
              onClick={() => setSortDirection("asc")}
            />
          </div>
        </div>
      </Panel>

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          description="Pick a rival to open the filtered head-to-head detail below."
          title="Head-to-head table"
          titleAs="h4"
        />

        {rivalryRows.length ? (
          <TableShell tableClassName="min-w-[104rem]">
            <thead>
              <tr>
                <SortHeadCell
                  active={sortKey === "opponent"}
                  direction={sortDirection}
                  label="Opponent"
                  onToggle={() => toggleAggregateSort("opponent")}
                />
                <SortHeadCell
                  active={sortKey === "games"}
                  direction={sortDirection}
                  label="Meetings"
                  onToggle={() => toggleAggregateSort("games")}
                />
                <SortHeadCell
                  active={sortKey === "wins"}
                  direction={sortDirection}
                  label="Wins"
                  onToggle={() => toggleAggregateSort("wins")}
                />
                <SortHeadCell
                  active={sortKey === "losses"}
                  direction={sortDirection}
                  label="Losses"
                  onToggle={() => toggleAggregateSort("losses")}
                />
                <SortHeadCell
                  active={sortKey === "winPct"}
                  direction={sortDirection}
                  label="Win %"
                  onToggle={() => toggleAggregateSort("winPct")}
                />
                <SortHeadCell
                  active={sortKey === "homeWins"}
                  direction={sortDirection}
                  label="Home W"
                  onToggle={() => toggleAggregateSort("homeWins")}
                />
                <SortHeadCell
                  active={sortKey === "homeLosses"}
                  direction={sortDirection}
                  label="Home L"
                  onToggle={() => toggleAggregateSort("homeLosses")}
                />
                <SortHeadCell
                  active={sortKey === "roadWins"}
                  direction={sortDirection}
                  label="Road W"
                  onToggle={() => toggleAggregateSort("roadWins")}
                />
                <SortHeadCell
                  active={sortKey === "roadLosses"}
                  direction={sortDirection}
                  label="Road L"
                  onToggle={() => toggleAggregateSort("roadLosses")}
                />
                <SortHeadCell
                  active={sortKey === "leagueWins"}
                  direction={sortDirection}
                  label="League W"
                  onToggle={() => toggleAggregateSort("leagueWins")}
                />
                <SortHeadCell
                  active={sortKey === "leagueLosses"}
                  direction={sortDirection}
                  label="League L"
                  onToggle={() => toggleAggregateSort("leagueLosses")}
                />
                <SortHeadCell
                  active={sortKey === "playoffWins"}
                  direction={sortDirection}
                  label="Playoff W"
                  onToggle={() => toggleAggregateSort("playoffWins")}
                />
                <SortHeadCell
                  active={sortKey === "playoffLosses"}
                  direction={sortDirection}
                  label="Playoff L"
                  onToggle={() => toggleAggregateSort("playoffLosses")}
                />
                <SortHeadCell
                  active={sortKey === "averageMargin"}
                  direction={sortDirection}
                  label="Avg margin"
                  onToggle={() => toggleAggregateSort("averageMargin")}
                />
                <SortHeadCell
                  active={sortKey === "tvGames"}
                  direction={sortDirection}
                  label="TV"
                  onToggle={() => toggleAggregateSort("tvGames")}
                />
                <TableHeadCell>Seasons</TableHeadCell>
                <SortHeadCell
                  active={sortKey === "lastMatch"}
                  direction={sortDirection}
                  label="Last match"
                  onToggle={() => toggleAggregateSort("lastMatch")}
                />
              </tr>
            </thead>
            <tbody>
              {rivalryRows.map((row) => {
                const selected = row.opponentTeamId === selectedOpponentId;

                return (
                  <tr
                    className={cn(selected && "bg-accent/8")}
                    key={row.opponentTeamId}
                  >
                    <TableCell className="min-w-[15rem]">
                      <button
                        className="grid gap-1 text-left"
                        onClick={() =>
                          setSelectedOpponentId(row.opponentTeamId)
                        }
                        type="button"
                      >
                        <strong className="text-ink text-sm">
                          {row.opponentTeamName}
                        </strong>
                        <span className="text-ink-muted text-xs font-semibold tracking-[0.08em] uppercase">
                          Team {row.opponentTeamId}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>{row.games}</TableCell>
                    <TableCell>{row.wins}</TableCell>
                    <TableCell>{row.losses}</TableCell>
                    <TableCell>{formatWinPct(row.winPct)}</TableCell>
                    <TableCell>{row.homeWins}</TableCell>
                    <TableCell>{row.homeLosses}</TableCell>
                    <TableCell>{row.roadWins}</TableCell>
                    <TableCell>{row.roadLosses}</TableCell>
                    <TableCell>{row.leagueWins}</TableCell>
                    <TableCell>{row.leagueLosses}</TableCell>
                    <TableCell>{row.playoffWins}</TableCell>
                    <TableCell>{row.playoffLosses}</TableCell>
                    <TableCell>{formatMargin(row.averageMargin)}</TableCell>
                    <TableCell>{row.tvGames}</TableCell>
                    <TableCell>{formatSeasonList(row.seasons)}</TableCell>
                    <TableCell>{formatDate(row.lastMatch)}</TableCell>
                  </tr>
                );
              })}
            </tbody>
            {visibleAggregate ? (
              <tfoot>
                <tr>
                  <TableCell
                    className={cn(
                      "min-w-[15rem] align-middle",
                      aggregateRowCellClassName,
                    )}
                  >
                    <div className="grid gap-1 text-left">
                      <strong className="text-sm">Total</strong>
                      <span className="text-ink-muted text-xs font-semibold tracking-[0.08em] uppercase">
                        {activeTeamName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.games}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.wins}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.losses}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {formatWinPct(visibleAggregate.winPct)}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.homeWins}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.homeLosses}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.roadWins}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.roadLosses}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.leagueWins}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.leagueLosses}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.playoffWins}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.playoffLosses}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {formatMargin(visibleAggregate.averageMargin)}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {visibleAggregate.tvGames}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {formatSeasonList(visibleAggregate.seasons)}
                  </TableCell>
                  <TableCell className={aggregateRowCellClassName}>
                    {formatDate(visibleAggregate.lastMatch)}
                  </TableCell>
                </tr>
              </tfoot>
            ) : null}
          </TableShell>
        ) : (
          <p className={subduedCopyClassName}>
            No rivalry rows match the current filters.
          </p>
        )}
      </Panel>

      {selectedRivalry ? (
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description={`Current filters show ${selectedRivalry.row.games} meetings against team ${selectedRivalry.row.opponentTeamId}.`}
            title={`Head-to-head: ${selectedRivalry.row.opponentTeamName}`}
            titleAs="h4"
          />

          <div className={summaryGridClassName}>
            <StatCard
              detail="Filtered meetings in view."
              label="Meetings shown"
              value={selectedRivalry.row.games}
            />
            <StatCard
              detail={formatWinPct(selectedRivalry.row.winPct)}
              label="Record"
              value={formatRecord(
                selectedRivalry.row.wins,
                selectedRivalry.row.losses,
              )}
            />
            <StatCard
              detail={`Home ${formatRecord(selectedRivalry.row.homeWins, selectedRivalry.row.homeLosses)} • Road ${formatRecord(selectedRivalry.row.roadWins, selectedRivalry.row.roadLosses)}`}
              label="League split"
              value={formatRecord(
                selectedRivalry.row.leagueWins,
                selectedRivalry.row.leagueLosses,
              )}
            />
            <StatCard
              detail={formatDate(selectedRivalry.row.lastMatch)}
              label="Current streak"
              value={selectedRivalry.row.currentStreak}
            />
          </div>

          <div className={detailGridClassName}>
            <Panel as="article" padding="sm" variant="glass">
              <SectionHeading title="By competition" titleAs="h5" />
              <TableShell compact tableClassName="min-w-[44rem]">
                <thead>
                  <tr>
                    <TableHeadCell>Competition</TableHeadCell>
                    <TableHeadCell>Wins</TableHeadCell>
                    <TableHeadCell>Losses</TableHeadCell>
                    <TableHeadCell>Home W</TableHeadCell>
                    <TableHeadCell>Home L</TableHeadCell>
                    <TableHeadCell>Road W</TableHeadCell>
                    <TableHeadCell>Road L</TableHeadCell>
                    <TableHeadCell>Avg margin</TableHeadCell>
                    <TableHeadCell>TV</TableHeadCell>
                  </tr>
                </thead>
                <tbody>
                  {competitionBreakdown.map((row) => (
                    <tr key={row.competitionKey}>
                      <TableCell>{row.competitionLabel}</TableCell>
                      <TableCell>{row.wins}</TableCell>
                      <TableCell>{row.losses}</TableCell>
                      <TableCell>{row.homeWins}</TableCell>
                      <TableCell>{row.homeLosses}</TableCell>
                      <TableCell>{row.roadWins}</TableCell>
                      <TableCell>{row.roadLosses}</TableCell>
                      <TableCell>{formatMargin(row.averageMargin)}</TableCell>
                      <TableCell>{row.tvGames}</TableCell>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </Panel>

            <Panel as="article" padding="sm" variant="glass">
              <SectionHeading title="By season" titleAs="h5" />
              <TableShell compact tableClassName="min-w-[40rem]">
                <thead>
                  <tr>
                    <TableHeadCell>Season</TableHeadCell>
                    <TableHeadCell>Wins</TableHeadCell>
                    <TableHeadCell>Losses</TableHeadCell>
                    <TableHeadCell>League W</TableHeadCell>
                    <TableHeadCell>League L</TableHeadCell>
                    <TableHeadCell>Avg margin</TableHeadCell>
                    <TableHeadCell>TV</TableHeadCell>
                    <TableHeadCell>Last match</TableHeadCell>
                  </tr>
                </thead>
                <tbody>
                  {seasonBreakdown.map((row) => (
                    <tr key={row.season}>
                      <TableCell>{row.season}</TableCell>
                      <TableCell>{row.wins}</TableCell>
                      <TableCell>{row.losses}</TableCell>
                      <TableCell>{row.leagueWins}</TableCell>
                      <TableCell>{row.leagueLosses}</TableCell>
                      <TableCell>{formatMargin(row.averageMargin)}</TableCell>
                      <TableCell>{row.tvGames}</TableCell>
                      <TableCell>{formatDate(row.lastMatch)}</TableCell>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </Panel>
          </div>

          <Panel as="article" padding="sm" variant="glass">
            <SectionHeading
              actions={
                <div className="flex flex-wrap gap-2">
                  <SortDirectionButton
                    active={matchSortDirection === "desc"}
                    label="Newest first"
                    onClick={() => setMatchSortDirection("desc")}
                  />
                  <SortDirectionButton
                    active={matchSortDirection === "asc"}
                    label="Oldest first"
                    onClick={() => setMatchSortDirection("asc")}
                  />
                </div>
              }
              description="Every completed meeting in the current slice."
              title="Game ledger"
              titleAs="h5"
            />

            <TableShell tableClassName="min-w-[62rem]">
              <thead>
                <tr>
                  <SortHeadCell
                    active={matchSortKey === "date"}
                    direction={matchSortDirection}
                    label="Date"
                    onToggle={() => toggleMatchSort("date")}
                  />
                  <SortHeadCell
                    active={matchSortKey === "season"}
                    direction={matchSortDirection}
                    label="Season"
                    onToggle={() => toggleMatchSort("season")}
                  />
                  <SortHeadCell
                    active={matchSortKey === "competition"}
                    direction={matchSortDirection}
                    label="Competition"
                    onToggle={() => toggleMatchSort("competition")}
                  />
                  <SortHeadCell
                    active={matchSortKey === "venue"}
                    direction={matchSortDirection}
                    label="Venue"
                    onToggle={() => toggleMatchSort("venue")}
                  />
                  <SortHeadCell
                    active={matchSortKey === "outcome"}
                    direction={matchSortDirection}
                    label="Result"
                    onToggle={() => toggleMatchSort("outcome")}
                  />
                  <SortHeadCell
                    active={matchSortKey === "margin"}
                    direction={matchSortDirection}
                    label="Margin"
                    onToggle={() => toggleMatchSort("margin")}
                  />
                  <TableHeadCell>Score</TableHeadCell>
                  <TableHeadCell>TV</TableHeadCell>
                </tr>
              </thead>
              <tbody>
                {selectedMatches.map((match) => (
                  <tr key={match.matchId}>
                    <TableCell>{formatDateTime(match.startTime)}</TableCell>
                    <TableCell>{match.season}</TableCell>
                    <TableCell>
                      <div className="grid gap-1">
                        <span>{match.competitionLabel}</span>
                        {match.stageLabel ? (
                          <span className="text-ink-muted text-xs font-semibold tracking-[0.08em] uppercase">
                            {match.stageLabel}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {match.venue === "HOME" ? "Home" : "Road"}
                    </TableCell>
                    <TableCell>
                      {match.outcome === "WIN" ? "Win" : "Loss"}
                    </TableCell>
                    <TableCell>{formatMargin(match.margin)}</TableCell>
                    <TableCell>
                      {match.teamScore}-{match.opponentScore}
                    </TableCell>
                    <TableCell>{match.isTvGame ? "TV" : "No"}</TableCell>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Panel>
        </Panel>
      ) : null}
    </Panel>
  );

  function resetFilters() {
    setSearchText("");
    setSelectedCompetitions(null);
    setSelectedVenues(null);
    setSelectedOutcomes(null);
    setSelectedTvScopes(null);
    setStartSeason(null);
    setEndSeason(null);
    setMinimumGames("");
    setSortKey("wins");
    setSortDirection("desc");
    setSelectedOpponentId("");
    setMatchSortKey("date");
    setMatchSortDirection("desc");
  }

  function toggleAggregateSort(nextKey: AggregateSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "opponent" ? "asc" : "desc");
  }

  function toggleMatchSort(nextKey: MatchSortKey) {
    if (matchSortKey === nextKey) {
      setMatchSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }

    setMatchSortKey(nextKey);
    setMatchSortDirection(
      nextKey === "competition" || nextKey === "venue" || nextKey === "outcome"
        ? "asc"
        : "desc",
    );
  }
}

function buildDefaultSeasonRange(
  seasonValues: readonly string[],
): SeasonRangeSelection {
  const firstSeason = seasonValues[0] ?? "";
  const lastSeason = seasonValues.at(-1) ?? firstSeason;

  return {
    endSeason: lastSeason,
    startSeason: firstSeason,
  };
}

function normalizeSeasonRange(
  seasonValues: readonly string[],
  startSeason: string,
  endSeason: string,
): SeasonRangeSelection {
  const defaults = buildDefaultSeasonRange(seasonValues);
  if (!seasonValues.length) {
    return defaults;
  }

  const resolvedStart = seasonValues.includes(startSeason)
    ? startSeason
    : defaults.startSeason;
  const resolvedEnd = seasonValues.includes(endSeason)
    ? endSeason
    : defaults.endSeason;

  if (compareSeasonValues(resolvedStart, resolvedEnd) <= 0) {
    return {
      endSeason: resolvedEnd,
      startSeason: resolvedStart,
    };
  }

  return {
    endSeason: resolvedEnd,
    startSeason: resolvedStart,
  };
}

function updateSeasonRangeFromStart(
  seasonValues: readonly string[],
  nextStartSeason: string,
  currentEndSeason: string,
): SeasonRangeSelection {
  const defaults = buildDefaultSeasonRange(seasonValues);
  if (!seasonValues.length) {
    return defaults;
  }

  const resolvedStart = seasonValues.includes(nextStartSeason)
    ? nextStartSeason
    : defaults.startSeason;
  const resolvedEnd = seasonValues.includes(currentEndSeason)
    ? currentEndSeason
    : defaults.endSeason;

  if (compareSeasonValues(resolvedStart, resolvedEnd) <= 0) {
    return {
      endSeason: resolvedEnd,
      startSeason: resolvedStart,
    };
  }

  return {
    endSeason: resolvedStart,
    startSeason: resolvedStart,
  };
}

function updateSeasonRangeFromEnd(
  seasonValues: readonly string[],
  currentStartSeason: string,
  nextEndSeason: string,
): SeasonRangeSelection {
  const defaults = buildDefaultSeasonRange(seasonValues);
  if (!seasonValues.length) {
    return defaults;
  }

  const resolvedStart = seasonValues.includes(currentStartSeason)
    ? currentStartSeason
    : defaults.startSeason;
  const resolvedEnd = seasonValues.includes(nextEndSeason)
    ? nextEndSeason
    : defaults.endSeason;

  if (compareSeasonValues(resolvedStart, resolvedEnd) <= 0) {
    return {
      endSeason: resolvedEnd,
      startSeason: resolvedStart,
    };
  }

  return {
    endSeason: resolvedEnd,
    startSeason: resolvedEnd,
  };
}

function compareSeasonValues(left: string, right: string): number {
  return Number(left) - Number(right);
}

function parseSeasonValue(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSeasonString(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function resolveSelectedValues(
  selectedValues: readonly string[] | null,
  allValues: readonly string[],
): string[] {
  if (selectedValues === null) {
    return [...allValues];
  }

  return selectedValues.filter((value) => allValues.includes(value));
}

function toggleSelectedValue(
  selectedValues: readonly string[] | null,
  value: string,
  allValues: readonly string[],
): string[] {
  const resolved = resolveSelectedValues(selectedValues, allValues);
  return resolved.includes(value)
    ? resolved.filter((entry) => entry !== value)
    : [...resolved, value];
}

function buildVisibleAggregate(
  rows: readonly RivalryRowRecord[],
): VisibleAggregateRow | null {
  if (!rows.length) {
    return null;
  }

  const seasons = new Set<number>();
  let latestLastMatch: string | null = null;
  let latestLastMatchValue = Number.NEGATIVE_INFINITY;
  let totalMargin = 0;

  const aggregate = rows.reduce<VisibleAggregateRow>(
    (current, row) => {
      current.games += row.games;
      current.wins += row.wins;
      current.losses += row.losses;
      current.homeWins += row.homeWins;
      current.homeLosses += row.homeLosses;
      current.roadWins += row.roadWins;
      current.roadLosses += row.roadLosses;
      current.leagueWins += row.leagueWins;
      current.leagueLosses += row.leagueLosses;
      current.playoffWins += row.playoffWins;
      current.playoffLosses += row.playoffLosses;
      current.tvGames += row.tvGames;
      totalMargin += row.averageMargin * row.games;

      for (const season of row.seasons) {
        seasons.add(season);
      }

      const lastMatchValue = parseTimestamp(row.lastMatch);
      if (lastMatchValue > latestLastMatchValue) {
        latestLastMatch = row.lastMatch ?? null;
        latestLastMatchValue = lastMatchValue;
      }

      return current;
    },
    {
      averageMargin: 0,
      games: 0,
      homeLosses: 0,
      homeWins: 0,
      lastMatch: null,
      leagueLosses: 0,
      leagueWins: 0,
      losses: 0,
      playoffLosses: 0,
      playoffWins: 0,
      roadLosses: 0,
      roadWins: 0,
      seasons: [],
      tvGames: 0,
      winPct: 0,
      wins: 0,
    },
  );

  return {
    ...aggregate,
    averageMargin: aggregate.games ? totalMargin / aggregate.games : 0,
    lastMatch: latestLastMatch,
    seasons: Array.from(seasons).sort((left, right) => left - right),
    winPct: aggregate.games ? aggregate.wins / aggregate.games : 0,
  };
}

function sortRivalryRows(
  rows: readonly RivalryRowRecord[],
  sortKey: AggregateSortKey,
  direction: SortDirection,
): RivalryRowRecord[] {
  const sorted = [...rows].sort((left, right) => {
    switch (sortKey) {
      case "averageMargin":
        return left.averageMargin - right.averageMargin;
      case "games":
        return left.games - right.games;
      case "homeLosses":
        return left.homeLosses - right.homeLosses;
      case "homeWins":
        return left.homeWins - right.homeWins;
      case "lastMatch":
        return compareTimestamps(left.lastMatch, right.lastMatch);
      case "leagueLosses":
        return left.leagueLosses - right.leagueLosses;
      case "leagueWins":
        return left.leagueWins - right.leagueWins;
      case "losses":
        return left.losses - right.losses;
      case "opponent":
        return left.opponentTeamName.localeCompare(right.opponentTeamName);
      case "playoffLosses":
        return left.playoffLosses - right.playoffLosses;
      case "playoffWins":
        return left.playoffWins - right.playoffWins;
      case "roadLosses":
        return left.roadLosses - right.roadLosses;
      case "roadWins":
        return left.roadWins - right.roadWins;
      case "tvGames":
        return left.tvGames - right.tvGames;
      case "winPct":
        return left.winPct - right.winPct;
      case "wins":
        return left.wins - right.wins;
      default:
        return 0;
    }
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}

function sortRivalryMatches(
  matches: readonly RivalryMatchRecord[],
  sortKey: MatchSortKey,
  direction: SortDirection,
): RivalryMatchRecord[] {
  const sorted = [...matches].sort((left, right) => {
    switch (sortKey) {
      case "competition":
        return compareCompetition(left.competitionKey, right.competitionKey);
      case "date":
        return compareTimestamps(left.startTime, right.startTime);
      case "margin":
        return left.margin - right.margin;
      case "outcome":
        return left.outcome.localeCompare(right.outcome);
      case "season":
        return left.season - right.season;
      case "venue":
        return left.venue.localeCompare(right.venue);
      default:
        return 0;
    }
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}

function compareCompetition(left: string, right: string): number {
  const leftIndex = competitionOrder.indexOf(
    left as (typeof competitionOrder)[number],
  );
  const rightIndex = competitionOrder.indexOf(
    right as (typeof competitionOrder)[number],
  );

  return normalizeOrderValue(leftIndex) - normalizeOrderValue(rightIndex);
}

function normalizeOrderValue(value: number): number {
  return value === -1 ? Number.MAX_SAFE_INTEGER : value;
}

function compareTimestamps(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return parseTimestamp(left) - parseTimestamp(right);
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function readQueryError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.trim();
  return message.length ? message : null;
}

function hasActiveRivalsStatus(
  status: RivalsBackfillStatus | null | undefined,
): boolean {
  return Boolean(
    status &&
    (status.status === "QUEUED" ||
      status.status === "FETCHING_SEASONS" ||
      status.status === "FETCHING_SCHEDULES" ||
      status.status === "BUILDING_DATASET"),
  );
}

function resolveRivalsStatusMessage(
  status: RivalsBackfillStatus | null,
): string | null {
  if (!status) {
    return null;
  }

  switch (status.status) {
    case "SUCCEEDED":
      return null;
    case "QUEUED":
      return "Rivals history refresh is queued. Cached data will stay visible while the backfill starts.";
    case "FETCHING_SEASONS":
      return "Rivals history is loading the season list in the background.";
    case "FETCHING_SCHEDULES":
      return "Rivals history is fetching season schedules in the background.";
    case "BUILDING_DATASET":
      return "Rivals history is rebuilding the rivalry facts dataset.";
    case "FAILED":
      return status.error ?? "The latest rivals refresh failed.";
    default:
      return null;
  }
}

function formatRecord(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

function formatWinPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMargin(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function formatSeasonSpan(
  firstSeason: number | null,
  lastSeason: number | null,
): string {
  if (!firstSeason || !lastSeason) {
    return "No seasons";
  }

  return firstSeason === lastSeason
    ? `Season ${firstSeason}`
    : `S${firstSeason} to S${lastSeason}`;
}

function formatSeasonList(seasons: readonly number[]): string {
  if (!seasons.length) {
    return "None";
  }

  if (seasons.length === 1) {
    return `S${seasons[0]}`;
  }

  return `${seasons.length} (${seasons[0]}-${seasons.at(-1)})`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value.slice(0, 10)
    : shortDateFormatter.format(parsed);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : dateTimeFormatter.format(parsed);
}

function CheckboxFilterGroup({
  onSelectAll,
  onSelectNone,
  onToggleValue,
  options,
  selectedValues,
}: {
  onSelectAll: () => void;
  onSelectNone: () => void;
  onToggleValue: (value: string) => void;
  options: readonly CheckboxFilterOption[];
  selectedValues: readonly string[];
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          className="text-accent text-xs font-semibold tracking-[0.08em] uppercase"
          onClick={onSelectAll}
          type="button"
        >
          All
        </button>
        <button
          className="text-ink-muted text-xs font-semibold tracking-[0.08em] uppercase"
          onClick={onSelectNone}
          type="button"
        >
          None
        </button>
      </div>
      <div className={checkboxListClassName}>
        {options.map((option) => (
          <label className={checkboxOptionClassName} key={option.value}>
            <input
              checked={selectedValues.includes(option.value)}
              className="accent-accent size-4"
              onChange={() => onToggleValue(option.value)}
              type="checkbox"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SortHeadCell({
  active,
  direction,
  label,
  onToggle,
}: {
  active: boolean;
  direction: SortDirection;
  label: string;
  onToggle: () => void;
}) {
  return (
    <TableHeadCell>
      <button
        className="inline-flex items-center gap-1 text-left"
        onClick={onToggle}
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[0.72rem]">
          {active ? (direction === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </TableHeadCell>
  );
}

function SortDirectionButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-full border px-4 py-2 text-sm font-semibold transition",
        active
          ? "border-accent bg-accent text-accent-contrast shadow-sm"
          : "text-ink hover:border-accent/35 border-black/10 bg-white/70 hover:bg-white",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

export const __testing = {
  buildVisibleAggregate,
  buildDefaultSeasonRange,
  normalizeSeasonRange,
  sortRivalryRows,
  toggleSelectedValue,
  updateSeasonRangeFromEnd,
  updateSeasonRangeFromStart,
};
