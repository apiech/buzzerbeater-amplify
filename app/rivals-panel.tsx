"use client";

import { useDeferredValue, useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
import type { DashboardWorkspace, RivalsWorkspacePayload } from "@/app/types";
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
  workspace: DashboardWorkspace;
};

type RivalryMatchRecord = RivalsWorkspacePayload["matches"][number];

type AggregateSortKey =
  | "averageMargin"
  | "games"
  | "lastMatch"
  | "leagueWins"
  | "opponent"
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

type RivalryRow = {
  averageMargin: number;
  currentStreak: string;
  games: number;
  homeLosses: number;
  homeWins: number;
  lastMatch: string | null;
  leagueLosses: number;
  leagueWins: number;
  losses: number;
  matches: RivalryMatchRecord[];
  opponentTeamId: string;
  opponentTeamName: string;
  playoffLosses: number;
  playoffWins: number;
  roadLosses: number;
  roadWins: number;
  seasons: number[];
  totalMargin: number;
  tvGames: number;
  winPct: number;
  wins: number;
};

type CompetitionBreakdownRow = {
  averageMargin: number;
  competitionKey: string;
  competitionLabel: string;
  games: number;
  homeLosses: number;
  homeWins: number;
  losses: number;
  roadLosses: number;
  roadWins: number;
  tvGames: number;
  wins: number;
};

type SeasonBreakdownRow = {
  averageMargin: number;
  games: number;
  lastMatch: string | null;
  leagueLosses: number;
  leagueWins: number;
  losses: number;
  season: number;
  tvGames: number;
  wins: number;
};

const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const filterGridClassName = "grid gap-4 md:grid-cols-2 xl:grid-cols-6";
const detailGridClassName = "grid gap-4 xl:grid-cols-2";
const subduedCopyClassName = "text-sm leading-7 text-ink-muted";

const aggregateSortOptions: Array<{
  key: AggregateSortKey;
  label: string;
}> = [
  { key: "wins", label: "Wins" },
  { key: "winPct", label: "Win %" },
  { key: "games", label: "Meetings" },
  { key: "leagueWins", label: "League wins" },
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

const competitionLabelByKey: Record<string, string> = {
  BUZZERBEATER_BEST: "BuzzerBeater's Best",
  BUZZERBEATER_MADNESS: "BuzzerBeater Madness",
  CUP: "Cup",
  LEAGUE_REGULAR_SEASON: "League regular season",
  OTHER: "Other",
  PLAYOFFS: "Playoffs",
  PRIVATE_LEAGUE: "Private league",
  SCRIMMAGE: "Scrimmage",
};

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

export function RivalsPanel({ workspace }: RivalsPanelProps) {
  const [payload, setPayload] = useState<RivalsWorkspacePayload | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [competitionFilter, setCompetitionFilter] = useState("ALL");
  const [seasonFilter, setSeasonFilter] = useState("ALL");
  const [venueFilter, setVenueFilter] = useState("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState("ALL");
  const [tvFilter, setTvFilter] = useState("ALL");
  const [minimumGames, setMinimumGames] = useState("");
  const [sortKey, setSortKey] = useState<AggregateSortKey>("wins");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedOpponentId, setSelectedOpponentId] = useState("");
  const [matchSortKey, setMatchSortKey] = useState<MatchSortKey>("date");
  const [matchSortDirection, setMatchSortDirection] =
    useState<SortDirection>("desc");

  const deferredSearchText = useDeferredValue(searchText);

  useEffect(() => {
    void loadRivals();
  }, [workspace.home.team.teamId]);

  async function loadRivals(): Promise<void> {
    setIsLoading(true);
    setPanelError(null);

    const response = await client.queries.getRivalsWorkspace();
    if (response.errors?.length || !response.data) {
      setPayload(null);
      setPanelError(formatAmplifyErrors(response.errors));
      setIsLoading(false);
      return;
    }

    setPayload(response.data);
    setIsLoading(false);
  }

  const matches = payload?.matches ?? [];
  const minimumGamesValue = Math.max(1, Number.parseInt(minimumGames, 10) || 1);
  const normalizedSearch = deferredSearchText.trim().toLowerCase();

  const filteredMatches = matches.filter((match) => {
    if (
      competitionFilter !== "ALL" &&
      match.competitionKey !== competitionFilter
    ) {
      return false;
    }

    if (seasonFilter !== "ALL" && String(match.season) !== seasonFilter) {
      return false;
    }

    if (venueFilter !== "ALL" && match.venue !== venueFilter) {
      return false;
    }

    if (outcomeFilter !== "ALL" && match.outcome !== outcomeFilter) {
      return false;
    }

    if (tvFilter === "TV_ONLY" && !match.isTvGame) {
      return false;
    }

    if (tvFilter === "NON_TV" && match.isTvGame) {
      return false;
    }

    return true;
  });

  const rivalryRows = sortRivalryRows(
    buildRivalryRows(filteredMatches).filter((row) => {
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
    rivalryRows.find((row) => row.opponentTeamId === selectedOpponentId) ??
    null;
  const selectedMatches = sortRivalryMatches(
    selectedRivalry?.matches ?? [],
    matchSortKey,
    matchSortDirection,
  );
  const competitionBreakdown = buildCompetitionBreakdown(selectedMatches);
  const seasonBreakdown = buildSeasonBreakdown(selectedMatches);
  const competitionOptions = buildCompetitionOptions(matches);
  const seasonOptions = Array.from(
    new Set(matches.map((match) => match.season)),
  )
    .sort((left, right) => right - left)
    .map(String);

  const activeTeamName =
    payload?.team.teamName ?? workspace.home.team.teamName ?? "Your club";
  const filterSummary = `Showing ${rivalryRows.length} rival${
    rivalryRows.length === 1 ? "" : "s"
  } across ${filteredMatches.length} meeting${
    filteredMatches.length === 1 ? "" : "s"
  }.`;

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            loading={isLoading}
            onClick={() => void loadRivals()}
            variant="secondary"
          >
            Refresh
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

          <Field label="Competition">
            <Select
              onChange={(event) => setCompetitionFilter(event.target.value)}
              value={competitionFilter}
            >
              <option value="ALL">All competitions</option>
              {competitionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Season">
            <Select
              onChange={(event) => setSeasonFilter(event.target.value)}
              value={seasonFilter}
            >
              <option value="ALL">All seasons</option>
              {seasonOptions.map((season) => (
                <option key={season} value={season}>
                  Season {season}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Venue">
            <Select
              onChange={(event) => setVenueFilter(event.target.value)}
              value={venueFilter}
            >
              <option value="ALL">Home and road</option>
              <option value="HOME">Home</option>
              <option value="ROAD">Road</option>
            </Select>
          </Field>

          <Field label="Outcome">
            <Select
              onChange={(event) => setOutcomeFilter(event.target.value)}
              value={outcomeFilter}
            >
              <option value="ALL">Wins and losses</option>
              <option value="WIN">Wins only</option>
              <option value="LOSS">Losses only</option>
            </Select>
          </Field>

          <Field label="TV and minimum">
            <div className="grid gap-3">
              <Select
                onChange={(event) => setTvFilter(event.target.value)}
                value={tvFilter}
              >
                <option value="ALL">TV and non-TV</option>
                <option value="TV_ONLY">TV only</option>
                <option value="NON_TV">Non-TV only</option>
              </Select>
              <Input
                inputMode="numeric"
                min={1}
                onChange={(event) => setMinimumGames(event.target.value)}
                placeholder="Minimum meetings"
                type="number"
                value={minimumGames}
              />
            </div>
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
          <TableShell tableClassName="min-w-[78rem]">
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
                  label="W-L"
                  onToggle={() => toggleAggregateSort("wins")}
                />
                <SortHeadCell
                  active={sortKey === "winPct"}
                  direction={sortDirection}
                  label="Win %"
                  onToggle={() => toggleAggregateSort("winPct")}
                />
                <TableHeadCell>Home</TableHeadCell>
                <TableHeadCell>Road</TableHeadCell>
                <SortHeadCell
                  active={sortKey === "leagueWins"}
                  direction={sortDirection}
                  label="League"
                  onToggle={() => toggleAggregateSort("leagueWins")}
                />
                <TableHeadCell>Playoffs</TableHeadCell>
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
                    <TableCell>{formatRecord(row.wins, row.losses)}</TableCell>
                    <TableCell>{formatWinPct(row.winPct)}</TableCell>
                    <TableCell>
                      {formatRecord(row.homeWins, row.homeLosses)}
                    </TableCell>
                    <TableCell>
                      {formatRecord(row.roadWins, row.roadLosses)}
                    </TableCell>
                    <TableCell>
                      {formatRecord(row.leagueWins, row.leagueLosses)}
                    </TableCell>
                    <TableCell>
                      {formatRecord(row.playoffWins, row.playoffLosses)}
                    </TableCell>
                    <TableCell>{formatMargin(row.averageMargin)}</TableCell>
                    <TableCell>{row.tvGames}</TableCell>
                    <TableCell>{formatSeasonList(row.seasons)}</TableCell>
                    <TableCell>{formatDate(row.lastMatch)}</TableCell>
                  </tr>
                );
              })}
            </tbody>
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
            description={`Current filters show ${selectedRivalry.games} meetings against team ${selectedRivalry.opponentTeamId}.`}
            title={`Head-to-head: ${selectedRivalry.opponentTeamName}`}
            titleAs="h4"
          />

          <div className={summaryGridClassName}>
            <StatCard
              detail="Filtered meetings in view."
              label="Meetings shown"
              value={selectedRivalry.games}
            />
            <StatCard
              detail={formatWinPct(selectedRivalry.winPct)}
              label="Record"
              value={formatRecord(selectedRivalry.wins, selectedRivalry.losses)}
            />
            <StatCard
              detail={`Home ${formatRecord(selectedRivalry.homeWins, selectedRivalry.homeLosses)} • Road ${formatRecord(selectedRivalry.roadWins, selectedRivalry.roadLosses)}`}
              label="League split"
              value={formatRecord(
                selectedRivalry.leagueWins,
                selectedRivalry.leagueLosses,
              )}
            />
            <StatCard
              detail={formatDate(selectedRivalry.lastMatch)}
              label="Current streak"
              value={selectedRivalry.currentStreak}
            />
          </div>

          <div className={detailGridClassName}>
            <Panel as="article" padding="sm" variant="glass">
              <SectionHeading title="By competition" titleAs="h5" />
              <TableShell compact tableClassName="min-w-[34rem]">
                <thead>
                  <tr>
                    <TableHeadCell>Competition</TableHeadCell>
                    <TableHeadCell>W-L</TableHeadCell>
                    <TableHeadCell>Home</TableHeadCell>
                    <TableHeadCell>Road</TableHeadCell>
                    <TableHeadCell>Avg margin</TableHeadCell>
                    <TableHeadCell>TV</TableHeadCell>
                  </tr>
                </thead>
                <tbody>
                  {competitionBreakdown.map((row) => (
                    <tr key={row.competitionKey}>
                      <TableCell>{row.competitionLabel}</TableCell>
                      <TableCell>
                        {formatRecord(row.wins, row.losses)}
                      </TableCell>
                      <TableCell>
                        {formatRecord(row.homeWins, row.homeLosses)}
                      </TableCell>
                      <TableCell>
                        {formatRecord(row.roadWins, row.roadLosses)}
                      </TableCell>
                      <TableCell>{formatMargin(row.averageMargin)}</TableCell>
                      <TableCell>{row.tvGames}</TableCell>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </Panel>

            <Panel as="article" padding="sm" variant="glass">
              <SectionHeading title="By season" titleAs="h5" />
              <TableShell compact tableClassName="min-w-[34rem]">
                <thead>
                  <tr>
                    <TableHeadCell>Season</TableHeadCell>
                    <TableHeadCell>W-L</TableHeadCell>
                    <TableHeadCell>League</TableHeadCell>
                    <TableHeadCell>Avg margin</TableHeadCell>
                    <TableHeadCell>TV</TableHeadCell>
                    <TableHeadCell>Last match</TableHeadCell>
                  </tr>
                </thead>
                <tbody>
                  {seasonBreakdown.map((row) => (
                    <tr key={row.season}>
                      <TableCell>{row.season}</TableCell>
                      <TableCell>
                        {formatRecord(row.wins, row.losses)}
                      </TableCell>
                      <TableCell>
                        {formatRecord(row.leagueWins, row.leagueLosses)}
                      </TableCell>
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
    setCompetitionFilter("ALL");
    setSeasonFilter("ALL");
    setVenueFilter("ALL");
    setOutcomeFilter("ALL");
    setTvFilter("ALL");
    setMinimumGames("");
    setSortKey("wins");
    setSortDirection("desc");
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

function buildRivalryRows(
  matches: readonly RivalryMatchRecord[],
): RivalryRow[] {
  const rows = new Map<string, RivalryRow>();

  for (const match of matches) {
    const current =
      rows.get(match.opponentTeamId) ??
      createEmptyRivalryRow(match.opponentTeamId, match.opponentTeamName);

    current.games += 1;
    current.matches.push(match);
    current.totalMargin += match.margin;
    current.lastMatch = pickLaterTimestamp(current.lastMatch, match.startTime);

    if (!current.seasons.includes(match.season)) {
      current.seasons.push(match.season);
    }

    if (match.outcome === "WIN") {
      current.wins += 1;
      if (match.venue === "HOME") {
        current.homeWins += 1;
      } else {
        current.roadWins += 1;
      }
    } else {
      current.losses += 1;
      if (match.venue === "HOME") {
        current.homeLosses += 1;
      } else {
        current.roadLosses += 1;
      }
    }

    if (match.competitionKey === "LEAGUE_REGULAR_SEASON") {
      if (match.outcome === "WIN") {
        current.leagueWins += 1;
      } else {
        current.leagueLosses += 1;
      }
    }

    if (match.competitionKey === "PLAYOFFS") {
      if (match.outcome === "WIN") {
        current.playoffWins += 1;
      } else {
        current.playoffLosses += 1;
      }
    }

    if (match.isTvGame) {
      current.tvGames += 1;
    }

    rows.set(match.opponentTeamId, current);
  }

  return Array.from(rows.values()).map((row) => {
    row.seasons.sort((left, right) => left - right);
    row.averageMargin = row.games ? row.totalMargin / row.games : 0;
    row.winPct = row.games ? row.wins / row.games : 0;
    row.currentStreak = buildCurrentStreak(row.matches);
    return row;
  });
}

function createEmptyRivalryRow(
  opponentTeamId: string,
  opponentTeamName: string,
): RivalryRow {
  return {
    averageMargin: 0,
    currentStreak: "N/A",
    games: 0,
    homeLosses: 0,
    homeWins: 0,
    lastMatch: null,
    leagueLosses: 0,
    leagueWins: 0,
    losses: 0,
    matches: [],
    opponentTeamId,
    opponentTeamName,
    playoffLosses: 0,
    playoffWins: 0,
    roadLosses: 0,
    roadWins: 0,
    seasons: [],
    totalMargin: 0,
    tvGames: 0,
    winPct: 0,
    wins: 0,
  };
}

function buildCompetitionBreakdown(
  matches: readonly RivalryMatchRecord[],
): CompetitionBreakdownRow[] {
  const rows = new Map<string, CompetitionBreakdownRow>();

  for (const match of matches) {
    const current = rows.get(match.competitionKey) ?? {
      averageMargin: 0,
      competitionKey: match.competitionKey,
      competitionLabel:
        (match.competitionLabel ||
          competitionLabelByKey[match.competitionKey]) ??
        match.competitionKey,
      games: 0,
      homeLosses: 0,
      homeWins: 0,
      losses: 0,
      roadLosses: 0,
      roadWins: 0,
      tvGames: 0,
      wins: 0,
    };

    current.games += 1;
    current.averageMargin += match.margin;
    if (match.outcome === "WIN") {
      current.wins += 1;
      if (match.venue === "HOME") {
        current.homeWins += 1;
      } else {
        current.roadWins += 1;
      }
    } else {
      current.losses += 1;
      if (match.venue === "HOME") {
        current.homeLosses += 1;
      } else {
        current.roadLosses += 1;
      }
    }

    if (match.isTvGame) {
      current.tvGames += 1;
    }

    rows.set(match.competitionKey, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      averageMargin: row.games ? row.averageMargin / row.games : 0,
    }))
    .sort((left, right) => {
      const leftIndex = competitionOrder.indexOf(
        left.competitionKey as (typeof competitionOrder)[number],
      );
      const rightIndex = competitionOrder.indexOf(
        right.competitionKey as (typeof competitionOrder)[number],
      );
      return normalizeOrderValue(leftIndex) - normalizeOrderValue(rightIndex);
    });
}

function buildSeasonBreakdown(
  matches: readonly RivalryMatchRecord[],
): SeasonBreakdownRow[] {
  const rows = new Map<number, SeasonBreakdownRow>();

  for (const match of matches) {
    const current = rows.get(match.season) ?? {
      averageMargin: 0,
      games: 0,
      lastMatch: null,
      leagueLosses: 0,
      leagueWins: 0,
      losses: 0,
      season: match.season,
      tvGames: 0,
      wins: 0,
    };

    current.games += 1;
    current.averageMargin += match.margin;
    current.lastMatch = pickLaterTimestamp(current.lastMatch, match.startTime);

    if (match.outcome === "WIN") {
      current.wins += 1;
    } else {
      current.losses += 1;
    }

    if (match.competitionKey === "LEAGUE_REGULAR_SEASON") {
      if (match.outcome === "WIN") {
        current.leagueWins += 1;
      } else {
        current.leagueLosses += 1;
      }
    }

    if (match.isTvGame) {
      current.tvGames += 1;
    }

    rows.set(match.season, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      averageMargin: row.games ? row.averageMargin / row.games : 0,
    }))
    .sort((left, right) => right.season - left.season);
}

function buildCurrentStreak(matches: readonly RivalryMatchRecord[]): string {
  if (!matches.length) {
    return "N/A";
  }

  const ordered = [...matches].sort((left, right) =>
    compareTimestamps(right.startTime, left.startTime),
  );
  const firstMatch = ordered[0];
  if (!firstMatch) {
    return "N/A";
  }

  const streakOutcome = firstMatch.outcome;
  let streakLength = 0;

  for (const match of ordered) {
    if (match.outcome !== streakOutcome) {
      break;
    }
    streakLength += 1;
  }

  return `${streakOutcome === "WIN" ? "W" : "L"}${streakLength}`;
}

function sortRivalryRows(
  rows: readonly RivalryRow[],
  sortKey: AggregateSortKey,
  direction: SortDirection,
): RivalryRow[] {
  const sorted = [...rows].sort((left, right) => {
    switch (sortKey) {
      case "averageMargin":
        return left.averageMargin - right.averageMargin;
      case "games":
        return left.games - right.games;
      case "lastMatch":
        return compareTimestamps(left.lastMatch, right.lastMatch);
      case "leagueWins":
        return left.leagueWins - right.leagueWins;
      case "opponent":
        return left.opponentTeamName.localeCompare(right.opponentTeamName);
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

function pickLaterTimestamp(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  return compareTimestamps(current, candidate) >= 0
    ? (current ?? null)
    : (candidate ?? null);
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

function formatAmplifyErrors(
  errors: ReadonlyArray<{ message?: string }> | null | undefined,
): string {
  const messages = (errors ?? [])
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message));

  return messages[0] ?? "The request failed without a detailed error message.";
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

function buildCompetitionOptions(matches: readonly RivalryMatchRecord[]) {
  const labels = new Map<string, string>();

  for (const match of matches) {
    if (!labels.has(match.competitionKey)) {
      labels.set(
        match.competitionKey,
        (match.competitionLabel ||
          competitionLabelByKey[match.competitionKey]) ??
          match.competitionKey,
      );
    }
  }

  return Array.from(labels.entries())
    .sort((left, right) => compareCompetition(left[0], right[0]))
    .map(([value, label]) => ({ label, value }));
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
