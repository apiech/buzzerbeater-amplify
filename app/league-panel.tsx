"use client";

import { useState } from "react";

import type { LeagueIntelPayload } from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";

type LeaguePanelProps = {
  currentTeamId: string | null;
  league: LeagueIntelPayload | null;
};

type LeagueViewId = "standings" | "offense" | "defense" | "payroll" | "arena";

type LeagueComparisonMetricTriplet = NonNullable<
  NonNullable<LeagueIntelPayload["comparisons"]>["offense"][number]["points"]
>;

const leagueViewOptions: Array<{
  id: LeagueViewId;
  label: string;
}> = [
  { id: "standings", label: "Standings" },
  { id: "offense", label: "Offense" },
  { id: "defense", label: "Defense" },
  { id: "payroll", label: "Payroll" },
  { id: "arena", label: "Arena" },
];

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

export function LeaguePanel({ currentTeamId, league }: LeaguePanelProps) {
  const [activeViewId, setActiveViewId] = useState<LeagueViewId>("standings");

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

  const standingsRows = flattenLeagueStandings(league);
  const comparisons = league.comparisons ?? null;

  return (
    <Panel>
      <SectionHeading
        eyebrow="League"
        title={league.league?.name ?? "League"}
        description="Standings plus team-by-team offense, defense, payroll, and arena comparisons from the latest synced league snapshot."
        actions={
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
        }
      />

      {comparisons ? (
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
          <span>Season {comparisons.season ?? "Current"}</span>
          <span>
            Built {new Date(comparisons.builtAt).toLocaleString("en-US")}
          </span>
        </div>
      ) : null}

      {comparisons?.incompleteTeamCount ? (
        <Alert tone="note">
          {describeLeagueComparisonState(comparisons.incompleteTeamCount)}
        </Alert>
      ) : null}

      {!standingsRows.length ? (
        <p className="text-sm leading-7 text-ink-muted">
          No league standings are ready yet.
        </p>
      ) : null}

      {standingsRows.length ? (
        <>
          {activeViewId === "standings" ? (
            <StandingsTable
              currentTeamId={currentTeamId}
              rows={standingsRows}
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

export function isCurrentLeagueTeamRow(
  rowTeamId: string | null | undefined,
  currentTeamId: string | null,
): boolean {
  return Boolean(rowTeamId && currentTeamId && rowTeamId === currentTeamId);
}

export const __testing = {
  describeLeagueComparisonState,
  flattenLeagueStandings,
  isCurrentLeagueTeamRow,
};
