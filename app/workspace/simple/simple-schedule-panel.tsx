"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  SchedulePill,
  buildScheduleBbstatsScale,
  collectScheduleBbstatsValues,
  readScheduleShowColors,
  resolveScheduleBbstatsPresentation,
  resolveScheduleTacticPresentation,
  writeScheduleShowColors,
} from "@/app/schedule-presentation";
import type { ScoutSchedulePayload } from "@/app/types";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Select } from "@/app/ui/primitives/field";

type SimpleSchedulePanelProps = {
  emptyStateMessage?: string;
  isLoading: boolean;
  onApplyFilters: (input: {
    competitionKeys: string[];
    season: number | null;
  }) => Promise<void> | void;
  schedule: ScoutSchedulePayload | null | undefined;
};

type ScheduleRow = ScoutSchedulePayload["rows"][number];

const filterToggleClassName =
  "inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-ink";
const groupBoundaryClassName = "border-l border-black/12";

export function SimpleSchedulePanel({
  emptyStateMessage,
  isLoading,
  onApplyFilters,
  schedule,
}: SimpleSchedulePanelProps) {
  const [draftSeason, setDraftSeason] = useState<string>("");
  const [draftCompetitionKeys, setDraftCompetitionKeys] = useState<string[]>([]);
  const [showColors, setShowColors] = useState(true);
  const [hasLoadedShowColors, setHasLoadedShowColors] = useState(false);

  useEffect(() => {
    setDraftSeason(schedule?.selectedSeason ? String(schedule.selectedSeason) : "");
    setDraftCompetitionKeys(schedule?.selectedCompetitionKeys ?? []);
  }, [schedule]);

  useEffect(() => {
    setShowColors(
      readScheduleShowColors(
        typeof window === "undefined" ? null : window.localStorage,
      ),
    );
    setHasLoadedShowColors(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedShowColors) {
      return;
    }

    writeScheduleShowColors(
      typeof window === "undefined" ? null : window.localStorage,
      showColors,
    );
  }, [hasLoadedShowColors, showColors]);

  const rows = schedule?.rows ?? [];
  const bbstatsScale = useMemo(
    () =>
      buildScheduleBbstatsScale(
        collectScheduleBbstatsValues(schedule?.rows ?? []),
      ),
    [schedule?.rows],
  );

  if (!schedule) {
    return (
      <div className="rounded-lg border border-black/10 bg-white px-4 py-5 text-sm text-ink-muted">
        {emptyStateMessage ?? defaultSimpleScheduleEmptyStateMessage()}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 rounded-lg border border-black/10 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-[11rem]" label="Season">
            <Select
              className="rounded-md px-3 py-2 shadow-none"
              disabled={!schedule.availableSeasons.length}
              onChange={(event) => setDraftSeason(event.currentTarget.value)}
              value={draftSeason}
            >
              {schedule.availableSeasons.length ? (
                schedule.availableSeasons.map((season) => (
                  <option key={`simple-schedule-season-${season}`} value={season}>
                    Season {season}
                  </option>
                ))
              ) : (
                <option value="">No seasons</option>
              )}
            </Select>
          </Field>

          <div className="flex min-w-[18rem] flex-1 flex-wrap gap-2">
            {schedule.competitionOptions.map((option) => (
              <label className={filterToggleClassName} key={option.key}>
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
                <span>{option.label}</span>
                <span className="text-ink-muted">({option.count})</span>
              </label>
            ))}
          </div>

          <label className={filterToggleClassName}>
            <input
              checked={showColors}
              onChange={(event) => setShowColors(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>Show colors</span>
          </label>

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
        </div>

        <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <InlineStat
            label="Shown"
            value={String(schedule.summary.totalGames)}
          />
          <InlineStat
            label="Completed"
            value={String(schedule.summary.completedGames)}
          />
          <InlineStat
            label="Upcoming"
            value={String(schedule.summary.upcomingGames)}
          />
          <InlineStat
            label="Serious"
            value={String(schedule.summary.seriousGames)}
          />
        </dl>
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
        <table className="w-full min-w-[74rem] border-collapse text-left">
          <thead>
            <tr className="bg-[rgba(15,23,42,0.03)]">
              <TableHead rowSpan={2}>Date</TableHead>
              <TableHead rowSpan={2}>Competition</TableHead>
              <TableHead rowSpan={2}>Venue</TableHead>
              <TableHead className={groupBoundaryClassName} colSpan={3}>
                Team
              </TableHead>
              <TableHead className={groupBoundaryClassName} colSpan={4}>
                Opponent
              </TableHead>
              <TableHead className={groupBoundaryClassName} rowSpan={2}>
                Result
              </TableHead>
              <TableHead rowSpan={2}>Serious</TableHead>
              <TableHead rowSpan={2}>Boxscore</TableHead>
            </tr>
            <tr className="bg-[rgba(15,23,42,0.03)]">
              <TableHead className={groupBoundaryClassName}>Offense</TableHead>
              <TableHead>Defense</TableHead>
              <TableHead>BBStats</TableHead>
              <TableHead className={groupBoundaryClassName}>Name</TableHead>
              <TableHead>Offense</TableHead>
              <TableHead>Defense</TableHead>
              <TableHead>BBStats</TableHead>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr
                  className="border-t border-black/8"
                  key={
                    row.matchId ??
                    `${row.season}-${row.startTime}-${row.opponentTeamId}`
                  }
                >
                  <TableCell>{formatSimpleScheduleTimestamp(row.startTime)}</TableCell>
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span>{row.competitionLabel}</span>
                      {row.stageLabel ? (
                        <span className="text-xs uppercase tracking-[0.08em] text-ink-muted">
                          {row.stageLabel}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{formatSimpleScheduleVenue(row.venue)}</TableCell>
                  <TableCell className={groupBoundaryClassName}>
                    {renderTacticCellValue(row.teamOffense, "offense", showColors)}
                  </TableCell>
                  <TableCell>
                    {renderTacticCellValue(row.teamDefense, "defense", showColors)}
                  </TableCell>
                  <TableCell>
                    {renderBbstatsCellValue(row.teamBbStatsTotal, bbstatsScale, showColors)}
                  </TableCell>
                  <TableCell className={groupBoundaryClassName}>
                    {row.opponentTeamName ?? "Unknown opponent"}
                  </TableCell>
                  <TableCell>
                    {renderTacticCellValue(row.opponentOffense, "offense", showColors)}
                  </TableCell>
                  <TableCell>
                    {renderTacticCellValue(row.opponentDefense, "defense", showColors)}
                  </TableCell>
                  <TableCell>
                    {renderBbstatsCellValue(
                      row.opponentBbStatsTotal,
                      bbstatsScale,
                      showColors,
                    )}
                  </TableCell>
                  <TableCell className={groupBoundaryClassName}>
                    {formatSimpleScheduleResult(row)}
                  </TableCell>
                  <TableCell>
                    {row.seriousness ? (
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em]",
                          seriousnessBadgeClassName(row.seriousness),
                        )}
                        title={row.seriousnessReason ?? undefined}
                      >
                        {row.seriousness}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {row.matchId && row.hasBoxscore ? (
                      <Link
                        className="rounded-md border border-black/10 px-2.5 py-1.5 text-sm font-medium text-ink transition hover:bg-black/5"
                        href={`/workspace/boxscores/${encodeURIComponent(row.matchId)}`}
                        prefetch={false}
                      >
                        Open
                      </Link>
                    ) : (
                      <span className="text-xs uppercase tracking-[0.08em] text-ink-muted">
                        Not ready
                      </span>
                    )}
                  </TableCell>
                </tr>
              ))
            ) : (
              <tr>
                <TableCell className="text-ink-muted" colSpan={13}>
                  {simpleScheduleTableEmptyStateMessage()}
                </TableCell>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </dt>
      <dd className="m-0 font-semibold text-ink">{value}</dd>
    </div>
  );
}

function TableHead({
  children,
  className,
  colSpan,
  rowSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
  rowSpan?: number;
}) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.08em] text-ink-muted",
        className,
      )}
      colSpan={colSpan}
      rowSpan={rowSpan}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  className,
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      className={cn("px-3 py-2 align-top text-sm text-ink", className)}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
}

function renderTacticCellValue(
  value: string | null | undefined,
  kind: "defense" | "offense",
  showColors: boolean,
) {
  const presentation = resolveScheduleTacticPresentation(value, kind);
  if (!presentation.rawValue) {
    return presentation.label;
  }

  return (
    <SchedulePill colorHex={presentation.colorHex} showColors={showColors}>
      {presentation.label}
    </SchedulePill>
  );
}

function renderBbstatsCellValue(
  value: number | null | undefined,
  scale: ReturnType<typeof buildScheduleBbstatsScale>,
  showColors: boolean,
) {
  const presentation = resolveScheduleBbstatsPresentation(value, scale);
  if (presentation.band === null && presentation.label === "—") {
    return presentation.label;
  }

  return (
    <SchedulePill colorHex={presentation.colorHex} showColors={showColors}>
      {presentation.label}
    </SchedulePill>
  );
}

function formatSimpleScheduleTimestamp(value: string | null | undefined): string {
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

function formatSimpleScheduleVenue(value: string | null | undefined): string {
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

function formatSimpleScheduleBbstats(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function defaultSimpleScheduleEmptyStateMessage(): string {
  return "No schedule is available until an opponent is selected.";
}

function simpleScheduleTableEmptyStateMessage(): string {
  return "No games match the current filters.";
}

function formatSimpleScheduleResult(row: ScheduleRow): string {
  if (
    row.outcome === "PENDING" ||
    row.teamScore === null ||
    row.opponentScore === null
  ) {
    return "Upcoming";
  }

  return `${row.teamScore}-${row.opponentScore} ${
    row.outcome === "WIN" ? "W" : "L"
  }`;
}

function seriousnessBadgeClassName(seriousness: string): string {
  switch (seriousness) {
    case "YES":
      return "border-success/20 bg-success/10 text-success";
    case "NO":
      return "border-danger-border bg-danger-bg text-accent-strong";
    default:
      return "border-note-border bg-note-bg text-note";
  }
}

export const __testing = {
  defaultSimpleScheduleEmptyStateMessage,
  formatSimpleScheduleBbstats,
  formatSimpleScheduleResult,
  simpleScheduleTableEmptyStateMessage,
};
