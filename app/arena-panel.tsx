"use client";

import type { ArenaWorkspacePayload } from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import { StatusBadge } from "@/app/ui/primitives/status-badge";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";
import { WorkInProgressNotice } from "@/app/ui/primitives/work-in-progress-notice";

const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-[1.4fr_1fr]";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const numericTableCellClassName = "text-right tabular-nums";
const numericTableHeadClassName = "text-right";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("en-US");
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const arenaSectionLabels = {
  bleachers: "Bleachers",
  lowerTier: "Lower tier",
  courtside: "Courtside",
  luxury: "Luxury boxes",
} as const;

type ArenaSeat = NonNullable<
  NonNullable<ArenaWorkspacePayload["arena"]>["seats"]
>[number];
type ArenaHomeGame = ArenaWorkspacePayload["recentHomeGames"][number];
type ArenaHomeGameSection = ArenaHomeGame["sections"][number];

export function ArenaPanel({
  arena,
}: {
  arena: ArenaWorkspacePayload | null;
}) {
  if (!arena) {
    return (
      <Panel>
        <SectionHeading eyebrow="Arena" title="Loading arena pricing advisor" />
        <WorkInProgressNotice subject="This arena pricing page" />
        <p className={statusCopyClassName}>
          Pulling your arena, economy, and recent home attendance context.
        </p>
      </Panel>
    );
  }

  const recommendation = arena.recommendation;
  const lowConfidenceReasons = arena.diagnostics.lowConfidenceReasons;
  const arenaOverview = arena.arena;
  const economy = arena.economy;

  if (!arenaOverview || !economy) {
    return (
      <Panel>
        <SectionHeading eyebrow="Arena" title="Arena pricing advisor" />
        <WorkInProgressNotice subject="This arena pricing page" />
        <p className={statusCopyClassName}>
          Arena and economy details are not available in this sync yet. Refresh the
          workspace to rebuild this section.
        </p>
      </Panel>
    );
  }

  const expansion = arenaOverview.expansion;

  return (
    <div className="grid gap-4">
      <Panel>
        <SectionHeading
          eyebrow="Arena"
          title={arenaOverview.name ?? "Arena pricing advisor"}
          description="Read-only ticket pricing guidance for your next home game. Projections are heuristic and meant to support pricing decisions, not mirror the hidden BB attendance model."
        />
        <WorkInProgressNotice subject="This arena pricing page" />

        <div className={summaryGridClassName}>
          <StatCard
            label="Next home game"
            value={arena.nextHomeMatch?.opponentTeamName ?? "No home game scheduled"}
            detail={
              arena.nextHomeMatch
                ? `${formatTimestamp(arena.nextHomeMatch.startTime)} • ${arena.nextHomeMatch.type ?? "Unknown type"}`
                : "The advisor will resume once your next home fixture is available."
            }
          />
          <StatCard
            label="Cash"
            value={formatCurrency(economy.cash)}
            detail="Current club cash from the latest economy sync."
          />
          <StatCard
            label="Available balance"
            value={formatCurrency(economy.availableBalance)}
            detail="Ready-to-spend balance after current obligations."
          />
          <StatCard
            label="Projected gate delta"
            value={formatSignedCurrency(
              recommendation?.projectedRevenueDelta ?? null,
            )}
            detail={
              recommendation?.heuristicDisclaimer ??
              "Heuristic estimate only."
            }
          />
        </div>

        <Panel as="article" className="mt-4" padding="sm" variant="solid">
          <SectionHeading
            title="Next home game target"
            titleAs="h4"
            description={
              arena.nextHomeMatch
                ? `Use these recommendations for ${arena.nextHomeMatch.opponentTeamName ?? "your next opponent"} and update prices at least 15 minutes before tipoff.`
                : "No future home game is listed yet, so the advisor is anchored to your latest arena state and recent home demand."
            }
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StatusBadge tone={confidenceTone(recommendation?.overallConfidence ?? 0)}>
              Confidence {formatConfidence(recommendation?.overallConfidence ?? null)}
            </StatusBadge>
            <StatusBadge tone="neutral">
              Comparables {arena.diagnostics.comparableGameCount}
            </StatusBadge>
            <StatusBadge tone="neutral">
              Matched snapshots {arena.diagnostics.matchedSnapshotCount}
            </StatusBadge>
          </div>
        </Panel>

        {expansion ? (
          <div className="mt-4">
            <Alert>
              Arena expansion is in progress with about {expansion.daysLeft ?? "?"} days
              left. Recommendations use the current visible arena state, and recent games
              may map to older capacities until construction completes.
            </Alert>
          </div>
        ) : null}
      </Panel>

      <div className={twoColumnGridClassName}>
        <Panel>
          <SectionHeading
            title="Current arena setup"
            titleAs="h3"
            description="Current capacities, posted prices, and configured next prices from BB."
          />
          <TableShell className="mt-4" compact>
            <thead>
              <tr>
                <TableHeadCell className="pl-0">Section</TableHeadCell>
                <TableHeadCell className={numericTableHeadClassName}>
                  Capacity
                </TableHeadCell>
                <TableHeadCell className={numericTableHeadClassName}>
                  Current
                </TableHeadCell>
                <TableHeadCell className={numericTableHeadClassName}>
                  Next
                </TableHeadCell>
                <TableHeadCell className={numericTableHeadClassName}>
                  Bounds
                </TableHeadCell>
              </tr>
            </thead>
            <tbody>
              {arenaOverview.seats.map((seat) => (
                <tr key={seat.section}>
                  <TableCell className="pl-0">
                    {formatArenaSectionLabel(seat.section)}
                  </TableCell>
                  <TableCell className={numericTableCellClassName}>
                    {formatInteger(seat.capacity)}
                  </TableCell>
                  <TableCell className={numericTableCellClassName}>
                    {formatCurrency(seat.price)}
                  </TableCell>
                  <TableCell className={numericTableCellClassName}>
                    {formatCurrency(seat.nextPrice)}
                  </TableCell>
                  <TableCell className={numericTableCellClassName}>
                    {formatCurrency(seat.minPrice)}-{formatCurrency(seat.maxPrice)}
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>

        <Panel>
          <SectionHeading
            title="Confidence and reasoning"
            titleAs="h3"
            description="Use confidence to judge how aggressively to trust the suggested move."
          />

          {lowConfidenceReasons.length ? (
            <div className="mt-4 grid gap-3">
              {lowConfidenceReasons.map((reason) => (
                <Alert key={reason}>{reason}</Alert>
              ))}
            </div>
          ) : (
            <p className={`${statusCopyClassName} mt-4`}>
              The recent sample is reasonably healthy for a heuristic read. You still
              may want to sanity-check big moves against your own league context.
            </p>
          )}

          <div className="mt-4 grid gap-3">
            {(recommendation?.sections ?? []).map((section) => (
              <Panel as="article" key={section.section} padding="sm" variant="solid">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <strong className="text-sm text-ink">
                      {formatArenaSectionLabel(section.section)}
                    </strong>
                    <span className={statusCopyClassName}>{section.reason}</span>
                  </div>
                  <StatusBadge tone={confidenceTone(section.confidence)}>
                    {formatConfidence(section.confidence)}
                  </StatusBadge>
                </div>
              </Panel>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeading
          title="Recommended prices"
          titleAs="h3"
          description="Suggested next prices based on weighted occupancy by section and one adjacent-section guardrail."
        />
        {recommendation ? (
          <>
            <TableShell className="mt-4">
              <thead>
                <tr>
                  <TableHeadCell className="pl-0">Section</TableHeadCell>
                  <TableHeadCell className={numericTableHeadClassName}>
                    Current
                  </TableHeadCell>
                  <TableHeadCell className={numericTableHeadClassName}>
                    Suggested
                  </TableHeadCell>
                  <TableHeadCell className={numericTableHeadClassName}>
                    Delta
                  </TableHeadCell>
                  <TableHeadCell className={numericTableHeadClassName}>
                    Weighted occ.
                  </TableHeadCell>
                  <TableHeadCell className={numericTableHeadClassName}>
                    Projected fill
                  </TableHeadCell>
                  <TableHeadCell className={numericTableHeadClassName}>
                    Projected gate
                  </TableHeadCell>
                </tr>
              </thead>
              <tbody>
                {recommendation.sections.map((section) => {
                  const seat = arenaOverview.seats.find(
                    (candidate) => candidate.section === section.section,
                  );
                  return (
                    <tr key={section.section}>
                      <TableCell className="pl-0">
                        {formatArenaSectionLabel(section.section)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatCurrency(section.currentPrice)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatCurrency(section.recommendedPrice)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatSignedCurrency(section.delta)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatPercent(section.weightedOccupancyPct)}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatProjectedFill(
                          seat ?? null,
                          section.projectedAttendance ?? null,
                        )}
                      </TableCell>
                      <TableCell className={numericTableCellClassName}>
                        {formatCurrency(section.projectedRevenue)}
                      </TableCell>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>

            <p className={`${statusCopyClassName} mt-4`}>
              {recommendation.heuristicDisclaimer}
            </p>
          </>
        ) : (
          <p className={`${statusCopyClassName} mt-4`}>
            Recommendations will appear once there is enough arena state to analyze.
          </p>
        )}
      </Panel>

      <Panel>
        <SectionHeading
          title="Recent home games"
          titleAs="h3"
          description="Attendance and occupancy by section from your latest completed home games."
        />
        {arena.recentHomeGames.length ? (
          <TableShell className="mt-4">
            <thead>
              <tr>
                <TableHeadCell className="pl-0">Opponent</TableHeadCell>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell className={numericTableHeadClassName}>
                  Gate
                </TableHeadCell>
                <TableHeadCell>Bleachers</TableHeadCell>
                <TableHeadCell>Lower tier</TableHeadCell>
                <TableHeadCell>Courtside</TableHeadCell>
                <TableHeadCell>Luxury</TableHeadCell>
              </tr>
            </thead>
            <tbody>
              {arena.recentHomeGames.map((game) => (
                <tr key={game.matchId}>
                  <TableCell className="pl-0">
                    <div className="grid gap-1">
                      <strong className="text-sm text-ink">
                        {game.opponentTeamName || "Unknown opponent"}
                      </strong>
                      <span className="text-xs text-ink-muted">
                        {game.matchedSnapshotCapturedAt
                          ? `Matched ${formatTimestamp(game.matchedSnapshotCapturedAt)}`
                          : "Used current capacity fallback"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{formatTimestamp(game.startTime)}</TableCell>
                  <TableCell>{game.competitionLabel || game.type || "Home game"}</TableCell>
                  <TableCell className={numericTableCellClassName}>
                    {formatCurrency(game.estimatedRealizedGate)}
                  </TableCell>
                  {renderSectionHistoryCell(findGameSection(game, "bleachers"))}
                  {renderSectionHistoryCell(findGameSection(game, "lowerTier"))}
                  {renderSectionHistoryCell(findGameSection(game, "courtside"))}
                  {renderSectionHistoryCell(findGameSection(game, "luxury"))}
                </tr>
              ))}
            </tbody>
          </TableShell>
        ) : (
          <p className={`${statusCopyClassName} mt-4`}>
            No completed home games are stored yet, so the advisor is using current arena
            state only. Once you build up home attendance history, the recommendations will
            get sharper.
          </p>
        )}
      </Panel>
    </div>
  );
}

function renderSectionHistoryCell(section: ArenaHomeGameSection | null) {
  return (
    <TableCell key={section?.section ?? "unknown"}>
      <div className="grid gap-1">
        <strong className="text-sm text-ink">
          {formatAttendance(section?.attendance ?? null, section?.capacity ?? null)}
        </strong>
        <span className="text-xs text-ink-muted">
          {formatPercent(section?.occupancyPct ?? null)} @ {formatCurrency(section?.price ?? null)}
        </span>
      </div>
    </TableCell>
  );
}

function findGameSection(
  game: ArenaHomeGame,
  sectionKey: keyof typeof arenaSectionLabels,
): ArenaHomeGameSection | null {
  return game.sections.find((section) => section.section === sectionKey) ?? null;
}

function formatArenaSectionLabel(value: string | null | undefined): string {
  if (!value) {
    return "Unknown section";
  }
  const label = Object.hasOwn(arenaSectionLabels, value)
    ? arenaSectionLabels[value as keyof typeof arenaSectionLabels]
    : null;
  return label ?? value;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unknown time";
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? value
    : timestampFormatter.format(new Date(timestamp));
}

function formatCurrency(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : currencyFormatter.format(value);
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value === 0) {
    return "$0";
  }
  return `${value > 0 ? "+" : "-"}${currencyFormatter.format(Math.abs(value))}`;
}

function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : numberFormatter.format(value);
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

function formatConfidence(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : `${Math.round(value * 100)}% confidence`;
}

function formatAttendance(
  attendance: number | null,
  capacity: number | null,
): string {
  if (attendance === null && capacity === null) {
    return "—";
  }
  if (attendance === null) {
    return `— / ${formatInteger(capacity)}`;
  }
  if (capacity === null) {
    return formatInteger(attendance);
  }
  return `${formatInteger(attendance)} / ${formatInteger(capacity)}`;
}

function formatProjectedFill(
  seat: ArenaSeat | null,
  projectedAttendance: number | null,
): string {
  const capacity = seat?.capacity ?? null;
  if (!seat || projectedAttendance === null || capacity === null || capacity <= 0) {
    return "—";
  }

  const projectedPct = (projectedAttendance / capacity) * 100;
  return `${formatInteger(projectedAttendance)} (${projectedPct.toFixed(1)}%)`;
}

function confidenceTone(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "neutral" as const;
  }
  if (value >= 0.75) {
    return "success" as const;
  }
  if (value >= 0.55) {
    return "note" as const;
  }
  return "neutral" as const;
}
