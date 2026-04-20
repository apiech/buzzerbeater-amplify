"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
const groupedHeaderCellClassName = "bg-black/[0.03] text-center";
const groupBoundaryClassName = "border-l border-black/12";

type OpponentSchedulePanelProps = {
  emptyStateMessage?: string;
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
  emptyStateMessage,
  isLoading,
  onApplyFilters,
  schedule,
  teamName,
}: OpponentSchedulePanelProps) {
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
      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          description="Open an opponent to load the full season slate and serious-mode scouting signals."
          title="Season schedule"
          titleAs="h4"
        />
        <p className="text-sm leading-7 text-ink-muted">
          {emptyStateMessage ?? defaultScheduleEmptyStateMessage()}
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

          <Field label="Display">
            <label className={checkboxOptionClassName}>
              <input
                checked={showColors}
                onChange={(event) => setShowColors(event.currentTarget.checked)}
                type="checkbox"
              />
              <span className="flex-1">Show colors</span>
            </label>
          </Field>
        </div>

        <TableShell tableClassName="min-w-[74rem]">
          <thead>
            <tr>
              <TableHeadCell className={groupedHeaderCellClassName} rowSpan={2}>
                Date
              </TableHeadCell>
              <TableHeadCell className={groupedHeaderCellClassName} rowSpan={2}>
                Competition
              </TableHeadCell>
              <TableHeadCell className={groupedHeaderCellClassName} rowSpan={2}>
                Venue
              </TableHeadCell>
              <TableHeadCell
                className={`${groupBoundaryClassName} ${groupedHeaderCellClassName}`}
                colSpan={3}
              >
                Team
              </TableHeadCell>
              <TableHeadCell
                className={`${groupBoundaryClassName} ${groupedHeaderCellClassName}`}
                colSpan={4}
              >
                Opponent
              </TableHeadCell>
              <TableHeadCell
                className={`${groupBoundaryClassName} ${groupedHeaderCellClassName}`}
                rowSpan={2}
              >
                Score / Status
              </TableHeadCell>
              <TableHeadCell className={groupedHeaderCellClassName} rowSpan={2}>
                Took seriously
              </TableHeadCell>
              <TableHeadCell className={groupedHeaderCellClassName} rowSpan={2}>
                Boxscore
              </TableHeadCell>
            </tr>
            <tr>
              <TableHeadCell className={groupBoundaryClassName}>Offense</TableHeadCell>
              <TableHeadCell>Defense</TableHeadCell>
              <TableHeadCell>BBStats</TableHeadCell>
              <TableHeadCell className={groupBoundaryClassName}>Name</TableHeadCell>
              <TableHeadCell>Offense</TableHeadCell>
              <TableHeadCell>Defense</TableHeadCell>
              <TableHeadCell>BBStats</TableHeadCell>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr
                  key={
                    row.matchId ??
                    `${row.season}-${row.startTime}-${row.opponentTeamId}`
                  }
                >
                  <TableCell className={tableCellClassName}>
                    {formatTimestamp(row.startTime)}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    <div className="grid gap-1">
                      <span>{row.competitionLabel}</span>
                      {row.stageLabel ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                          {row.stageLabel}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {formatVenue(row.venue)}
                  </TableCell>
                  <TableCell className={`${groupBoundaryClassName} ${tableCellClassName}`}>
                    {renderTacticCellValue(row.teamOffense, "offense", showColors)}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {renderTacticCellValue(row.teamDefense, "defense", showColors)}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {renderBbstatsCellValue(row.teamBbStatsTotal, bbstatsScale, showColors)}
                  </TableCell>
                  <TableCell className={`${groupBoundaryClassName} ${tableCellClassName}`}>
                    {row.opponentTeamName ?? "Unknown opponent"}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {renderTacticCellValue(row.opponentOffense, "offense", showColors)}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {renderTacticCellValue(row.opponentDefense, "defense", showColors)}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {renderBbstatsCellValue(
                      row.opponentBbStatsTotal,
                      bbstatsScale,
                      showColors,
                    )}
                  </TableCell>
                  <TableCell className={`${groupBoundaryClassName} ${tableCellClassName}`}>
                    {formatResult(row)}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {row.seriousness ? (
                      <StatusBadge
                        title={row.seriousnessReason ?? undefined}
                        tone={toneForSeriousness(row.seriousness)}
                      >
                        {row.seriousness}
                      </StatusBadge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className={tableCellClassName}>
                    {row.matchId && row.hasBoxscore ? (
                      <Link
                        className={boxscoreLinkClassName}
                        href={`/workspace/boxscores/${encodeURIComponent(row.matchId)}`}
                        prefetch={false}
                      >
                        Boxscore
                      </Link>
                    ) : (
                      <span className="text-xs font-semibold text-ink-muted">
                        Not ready
                      </span>
                    )}
                  </TableCell>
                </tr>
              ))
            ) : (
              <tr>
                <TableCell className="text-ink-muted" colSpan={13}>
                  {scheduleTableEmptyStateMessage()}
                </TableCell>
              </tr>
            )}
          </tbody>
        </TableShell>
      </div>
    </Panel>
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

function defaultScheduleEmptyStateMessage(): string {
  return "No schedule is available until a scout target is selected.";
}

function scheduleTableEmptyStateMessage(): string {
  return "No games match the current season and game-type filters.";
}

function formatResult(row: ScheduleRow): string {
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
  defaultScheduleEmptyStateMessage,
  formatBbstats,
  formatResult,
  scheduleTableEmptyStateMessage,
  toneForSeriousness,
};
