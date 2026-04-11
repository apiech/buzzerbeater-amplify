"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { ScoutSchedulePayload } from "@/app/types";
import { Button } from "@/app/ui/primitives/button";
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

const checkboxListClassName = "grid gap-2";
const checkboxOptionClassName =
  "border-border-soft bg-surface-strong text-ink flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium";
const boxscoreLinkClassName =
  "inline-flex min-h-9 items-center justify-center rounded-full border border-border-soft bg-white/70 px-3.5 text-xs font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";
const tableCellClassName = "align-top";

type OpponentSchedulePanelProps = {
  isLoading: boolean;
  onApplyFilters: (input: {
    competitionKeys: string[];
    season: number | null;
  }) => Promise<void> | void;
  schedule: ScoutSchedulePayload | null | undefined;
  teamName: string | null | undefined;
};

type ScheduleRow = ScoutSchedulePayload["rows"][number];

export function OpponentSchedulePanel({
  isLoading,
  onApplyFilters,
  schedule,
  teamName,
}: OpponentSchedulePanelProps) {
  const [draftSeason, setDraftSeason] = useState<string>("");
  const [draftCompetitionKeys, setDraftCompetitionKeys] = useState<string[]>([]);

  useEffect(() => {
    setDraftSeason(schedule?.selectedSeason ? String(schedule.selectedSeason) : "");
    setDraftCompetitionKeys(schedule?.selectedCompetitionKeys ?? []);
  }, [schedule]);

  const columns: Array<ColumnDef<ScheduleRow>> = [
    {
      accessorKey: "startTime",
      cell: ({ row }) => formatTimestamp(row.original.startTime),
      header: "Date",
    },
    {
      accessorKey: "competitionLabel",
      cell: ({ row }) => (
        <div className="grid gap-1">
          <span>{row.original.competitionLabel}</span>
          {row.original.stageLabel ? (
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {row.original.stageLabel}
            </span>
          ) : null}
        </div>
      ),
      header: "Competition",
    },
    {
      accessorKey: "venue",
      cell: ({ row }) => formatVenue(row.original.venue),
      header: "Venue",
    },
    {
      accessorKey: "teamOffense",
      cell: ({ row }) => row.original.teamOffense ?? "—",
      header: "Team Off",
    },
    {
      accessorKey: "teamDefense",
      cell: ({ row }) => row.original.teamDefense ?? "—",
      header: "Team Def",
    },
    {
      accessorKey: "teamBbStatsTotal",
      cell: ({ row }) => formatBbstats(row.original.teamBbStatsTotal),
      header: "Team BBStats",
    },
    {
      accessorKey: "outcome",
      cell: ({ row }) => formatResult(row.original),
      header: "Score / Status",
    },
    {
      accessorKey: "seriousness",
      cell: ({ row }) =>
        row.original.seriousness ? (
          <StatusBadge
            title={row.original.seriousnessReason ?? undefined}
            tone={toneForSeriousness(row.original.seriousness)}
          >
            {row.original.seriousness}
          </StatusBadge>
        ) : (
          "—"
        ),
      header: "Took seriously",
    },
    {
      accessorKey: "opponentTeamName",
      cell: ({ row }) => row.original.opponentTeamName ?? "Unknown opponent",
      header: "Opponent",
    },
    {
      accessorKey: "opponentOffense",
      cell: ({ row }) => row.original.opponentOffense ?? "—",
      header: "Opp Off",
    },
    {
      accessorKey: "opponentDefense",
      cell: ({ row }) => row.original.opponentDefense ?? "—",
      header: "Opp Def",
    },
    {
      accessorKey: "opponentBbStatsTotal",
      cell: ({ row }) => formatBbstats(row.original.opponentBbStatsTotal),
      header: "Opp BBStats",
    },
    {
      accessorKey: "matchId",
      cell: ({ row }) =>
        row.original.matchId && row.original.hasBoxscore ? (
          <Link
            className={boxscoreLinkClassName}
            href={`/workspace/boxscores/${encodeURIComponent(row.original.matchId)}`}
            prefetch={false}
          >
            Boxscore
          </Link>
        ) : (
          <span className="text-xs font-semibold text-ink-muted">Not ready</span>
        ),
      header: "Boxscore",
    },
  ];
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table is the intended state engine for this schedule surface.
  const table = useReactTable({
    columns,
    data: schedule?.rows ?? [],
    getCoreRowModel: getCoreRowModel(),
  });

  if (!schedule) {
    return (
      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          description="Open an opponent to load the full season slate and serious-mode scouting signals."
          title="Season schedule"
          titleAs="h4"
        />
        <p className="text-sm leading-7 text-ink-muted">
          No schedule is available until a scout target is selected.
        </p>
      </Panel>
    );
  }

  return (
    <Panel as="article" padding="sm" variant="solid">
      <SectionHeading
        actions={
          <Button
            disabled={isLoading}
            loading={isLoading}
            onClick={() =>
              void onApplyFilters({
                competitionKeys: draftCompetitionKeys,
                season: draftSeason ? Number(draftSeason) : null,
              })
            }
            size="sm"
            variant="secondary"
          >
            Apply
          </Button>
        }
        description={`Full season slate for ${teamName ?? "the selected club"}, with BBStats totals and a shared serious-mode scouting signal.`}
        title="Season schedule"
        titleAs="h4"
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          detail="Rows after current filters."
          label="Games shown"
          value={schedule.summary.totalGames}
        />
        <StatCard
          detail="Completed games with a score."
          label="Completed"
          value={schedule.summary.completedGames}
        />
        <StatCard
          detail="Future games still on the slate."
          label="Upcoming"
          value={schedule.summary.upcomingGames}
        />
        <StatCard
          detail="Games the heuristic flags as likely serious."
          label="Serious"
          value={schedule.summary.seriousGames}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Field label="Season">
            <Select
              disabled={!schedule.availableSeasons.length}
              onChange={(event) => setDraftSeason(event.currentTarget.value)}
              value={draftSeason}
            >
              {schedule.availableSeasons.length ? (
                schedule.availableSeasons.map((season) => (
                  <option key={`schedule-season-${season}`} value={season}>
                    Season {season}
                  </option>
                ))
              ) : (
                <option value="">No seasons</option>
              )}
            </Select>
          </Field>

          <Field label="Game types">
            <div className={checkboxListClassName}>
              {schedule.competitionOptions.map((option) => (
                <label className={checkboxOptionClassName} key={option.key}>
                  <input
                    checked={draftCompetitionKeys.includes(option.key)}
                    onChange={() =>
                      setDraftCompetitionKeys((current) =>
                        current.includes(option.key)
                          ? current.filter((value) => value !== option.key)
                          : [...current, option.key].sort()
                      )
                    }
                    type="checkbox"
                  />
                  <span className="flex-1">
                    {option.label} ({option.count})
                  </span>
                </label>
              ))}
            </div>
          </Field>
        </div>

        <div className="overflow-x-auto">
          <TableShell>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHeadCell key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHeadCell>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.original.matchId ?? `${row.original.season}-${row.original.startTime}-${row.original.opponentTeamId}`}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell className={tableCellClassName} key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <TableCell className="text-ink-muted" colSpan={13}>
                    No games match the current season and game-type filters.
                  </TableCell>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      </div>
    </Panel>
  );
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
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

function formatVenue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  switch (value) {
    case "HOME":
      return "Home";
    case "ROAD":
      return "Road";
    case "NEUTRAL":
      return "Neutral";
    default:
      return "—";
  }
}

function formatBbstats(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function formatResult(
  row: ScheduleRow,
): string {
  if (row.outcome === "PENDING" || row.teamScore === null || row.opponentScore === null) {
    return "Upcoming";
  }

  return `${row.teamScore}-${row.opponentScore} ${row.outcome === "WIN" ? "W" : "L"}`;
}

function toneForSeriousness(seriousness: string) {
  switch (seriousness) {
    case "YES":
      return "success" as const;
    case "NO":
      return "danger" as const;
    default:
      return "note" as const;
  }
}

export const __testing = {
  formatBbstats,
  formatResult,
  toneForSeriousness,
};
