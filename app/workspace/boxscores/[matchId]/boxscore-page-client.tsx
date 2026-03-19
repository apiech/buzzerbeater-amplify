"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { client } from "@/app/amplify-client";
import type {
  MatchBoxscorePayload,
  MatchBoxscorePlayerLine,
  MatchBoxscoreTeam,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";

const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const numericCellClassName = "text-right tabular-nums";
const panelMetaClassName = "text-sm leading-7 text-ink-muted";

export function BoxscorePageClient({ matchId }: { matchId: string }) {
  const [payload, setPayload] = useState<MatchBoxscorePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadBoxscore() {
      setIsLoading(true);
      setError(null);

      const response = await client.queries.getMatchBoxscoreDetails({ matchId });
      if (cancelled) {
        return;
      }

      if (response.errors?.length || !response.data) {
        setPayload(null);
        setError(formatAmplifyErrors(response.errors));
        setIsLoading(false);
        return;
      }

      setPayload(response.data);
      setIsLoading(false);
    }

    void loadBoxscore();

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  return (
    <main className="grid min-h-screen gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <p className="m-0 text-[0.76rem] font-bold uppercase tracking-[0.18em] text-accent">
            Boxscore
          </p>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.05em] text-ink">
            {buildBoxscoreTitle(payload, matchId)}
          </h1>
          <p className={panelMetaClassName}>
            {payload
              ? [
                  payload.matchType ?? "Completed game",
                  formatTimestamp(payload.startTime),
                  humanizeSource(payload.source),
                ]
                  .filter(Boolean)
                  .join(" • ")
              : `Match ${matchId}`}
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90"
          href="/workspace/home"
        >
          Back to workspace
        </Link>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {isLoading ? (
        <Panel>
          <SectionHeading title="Loading boxscore" />
          <p className={panelMetaClassName}>
            Fetching boxscore data for match {matchId}.
          </p>
        </Panel>
      ) : null}

      {!isLoading && !payload && !error ? (
        <Panel>
          <SectionHeading title="No boxscore available" />
          <p className={panelMetaClassName}>
            The requested match boxscore could not be loaded.
          </p>
        </Panel>
      ) : null}

      {payload ? (
        <>
          <Panel>
            <SectionHeading
              eyebrow="Score"
              title={buildScoreline(payload)}
            />
            <div className={summaryGridClassName}>
              <SummaryBlock
                detail={formatQuarterLine(payload.homeTeam?.partialScores)}
                label={payload.homeTeam?.teamName ?? "Home team"}
                value={`Score ${payload.homeTeam?.score ?? "N/A"}`}
              />
              <SummaryBlock
                detail={formatQuarterLine(payload.awayTeam?.partialScores)}
                label={payload.awayTeam?.teamName ?? "Away team"}
                value={`Score ${payload.awayTeam?.score ?? "N/A"}`}
              />
              <SummaryBlock
                detail={payload.homeTeam?.defStrategy ?? "Defense unavailable"}
                label={`${payload.homeTeam?.teamName ?? "Home team"} tactics`}
                value={payload.homeTeam?.offStrategy ?? "Offense unavailable"}
              />
              <SummaryBlock
                detail={payload.awayTeam?.defStrategy ?? "Defense unavailable"}
                label={`${payload.awayTeam?.teamName ?? "Away team"} tactics`}
                value={payload.awayTeam?.offStrategy ?? "Offense unavailable"}
              />
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <MetricComparisonPanel
              left={payload.homeTeam?.ratings ?? []}
              leftLabel={payload.homeTeam?.teamName ?? "Home team"}
              right={payload.awayTeam?.ratings ?? []}
              rightLabel={payload.awayTeam?.teamName ?? "Away team"}
              title="Ratings"
            />
            <MetricComparisonPanel
              left={payload.homeTeam?.efficiency ?? []}
              leftLabel={payload.homeTeam?.teamName ?? "Home team"}
              right={payload.awayTeam?.efficiency ?? []}
              rightLabel={payload.awayTeam?.teamName ?? "Away team"}
              title="Efficiency"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TeamBoxscorePanel team={payload.homeTeam} title="Boxscore" />
            <TeamBoxscorePanel team={payload.awayTeam} title="Boxscore" />
          </div>
        </>
      ) : null}
    </main>
  );
}

function SummaryBlock({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-black/8 bg-surface-strong p-4">
      <p className="m-0 text-[0.76rem] font-bold uppercase tracking-[0.16em] text-ink-muted">
        {label}
      </p>
      <p className="m-0 mt-2 text-lg font-semibold text-ink">{value}</p>
      <p className={`${panelMetaClassName} m-0 mt-1`}>{detail}</p>
    </div>
  );
}

function MetricComparisonPanel({
  left,
  leftLabel,
  right,
  rightLabel,
  title,
}: {
  left: MatchBoxscoreTeam["ratings"];
  leftLabel: string;
  right: MatchBoxscoreTeam["ratings"];
  rightLabel: string;
  title: string;
}) {
  const rows = buildMetricComparisonRows(left, right);

  return (
    <Panel as="article" padding="sm" variant="solid">
      <SectionHeading title={title} titleAs="h4" />
      <TableShell compact tableClassName="min-w-[24rem]">
        <thead>
          <tr>
            <TableHeadCell>Metric</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>
              {leftLabel}
            </TableHeadCell>
            <TableHeadCell className={numericCellClassName}>
              {rightLabel}
            </TableHeadCell>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell className={numericCellClassName}>
                  {row.leftValue}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {row.rightValue}
                </TableCell>
              </tr>
            ))
          ) : (
            <tr>
              <TableCell className="text-ink-muted" colSpan={3}>
                No saved metrics are available for this match.
              </TableCell>
            </tr>
          )}
        </tbody>
      </TableShell>
    </Panel>
  );
}

function TeamBoxscorePanel({
  team,
  title,
}: {
  team: MatchBoxscoreTeam | null | undefined;
  title: string;
}) {
  const totals = buildSelectedTotals(team?.teamTotals ?? []);
  const players = sortBoxscorePlayers(team?.players ?? []);

  return (
    <Panel as="article" padding="sm" variant="solid">
      <SectionHeading
        description={formatQuarterLine(team?.partialScores)}
        title={team?.teamName ?? title}
        titleAs="h4"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Tag>{`Score ${team?.score ?? "N/A"}`}</Tag>
        <Tag>{`Off ${team?.offStrategy ?? "N/A"}`}</Tag>
        <Tag>{`Def ${team?.defStrategy ?? "N/A"}`}</Tag>
        {totals.map((entry) => (
          <Tag key={entry.key}>{`${entry.label} ${entry.value}`}</Tag>
        ))}
      </div>

      <TableShell tableClassName="min-w-[34rem]">
        <thead>
          <tr>
            <TableHeadCell>Player</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>Min</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>PTS</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>REB</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>AST</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>STL</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>BLK</TableHeadCell>
            <TableHeadCell className={numericCellClassName}>TO</TableHeadCell>
          </tr>
        </thead>
        <tbody>
          {players.length ? (
            players.map((player) => (
              <tr key={player.playerId ?? player.fullName}>
                <TableCell>
                  <div className="grid gap-1">
                    <span className="font-semibold text-ink">
                      {player.fullName}
                    </span>
                    {player.isStarter ? (
                      <span className="text-xs font-semibold text-ink-muted">
                        Starter
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {formatMetricValue(player.minutes)}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {readPlayerStat(player, "pts")}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {readPlayerStat(player, "reb")}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {readPlayerStat(player, "ast")}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {readPlayerStat(player, "stl")}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {readPlayerStat(player, "blk")}
                </TableCell>
                <TableCell className={numericCellClassName}>
                  {readPlayerStat(player, "to")}
                </TableCell>
              </tr>
            ))
          ) : (
            <tr>
              <TableCell className="text-ink-muted" colSpan={8}>
                No player lines were saved for this team.
              </TableCell>
            </tr>
          )}
        </tbody>
      </TableShell>
    </Panel>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-note-bg px-3 py-1.5 text-sm font-semibold text-note">
      {children}
    </span>
  );
}

function buildMetricComparisonRows(
  left: MatchBoxscoreTeam["ratings"],
  right: MatchBoxscoreTeam["ratings"],
) {
  const leftMap = new Map(left.map((entry) => [entry.key, entry]));
  const rightMap = new Map(right.map((entry) => [entry.key, entry]));
  const keys = Array.from(
    new Set([...Array.from(leftMap.keys()), ...Array.from(rightMap.keys())]),
  ).sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));

  return keys.map((key) => ({
    key,
    label: humanizeKey(key),
    leftValue: formatMetricEntry(leftMap.get(key)),
    rightValue: formatMetricEntry(rightMap.get(key)),
  }));
}

function buildSelectedTotals(metrics: MatchBoxscoreTeam["teamTotals"]) {
  const preferredKeys = ["fg", "fga", "3fg", "3fga", "ft", "fta", "orb", "drb"];

  return preferredKeys
    .map((key) => metrics.find((entry) => entry.key.toLowerCase() === key))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({
      key: entry.key,
      label: entry.key.toUpperCase(),
      value: formatMetricEntry(entry),
    }));
}

function sortBoxscorePlayers(players: MatchBoxscorePlayerLine[]) {
  return [...players].sort((left, right) => {
    if (left.isStarter !== right.isStarter) {
      return left.isStarter ? -1 : 1;
    }

    return (right.minutes ?? 0) - (left.minutes ?? 0);
  });
}

function readPlayerStat(
  player: MatchBoxscorePlayerLine,
  key: string,
): string {
  const entry = player.performance.find(
    (metric) => metric.key.toLowerCase() === key.toLowerCase(),
  );
  return formatMetricEntry(entry);
}

function formatMetricEntry(
  entry:
    | MatchBoxscoreTeam["ratings"][number]
    | MatchBoxscorePlayerLine["performance"][number]
    | undefined,
) {
  if (!entry) {
    return "N/A";
  }

  return formatMetricValue(entry.numberValue ?? entry.textValue ?? null);
}

function buildScoreline(payload: MatchBoxscorePayload): string {
  const homeScore = payload.homeTeam?.score ?? "N/A";
  const awayScore = payload.awayTeam?.score ?? "N/A";
  const homeName = payload.homeTeam?.teamName ?? "Home";
  const awayName = payload.awayTeam?.teamName ?? "Away";

  return `${homeName} ${homeScore} - ${awayScore} ${awayName}`;
}

function buildBoxscoreTitle(
  payload: MatchBoxscorePayload | null,
  matchId: string,
) {
  if (!payload) {
    return `Match ${matchId}`;
  }

  const homeName = payload.homeTeam?.teamName;
  const awayName = payload.awayTeam?.teamName;
  if (homeName && awayName) {
    return `${homeName} vs ${awayName}`;
  }

  return `Match ${payload.matchId}`;
}

function formatQuarterLine(partials: number[] | null | undefined): string {
  return partials?.length
    ? `Partials ${partials.map((value) => String(value)).join(" / ")}`
    : "Quarter scores unavailable";
}

function humanizeSource(source: string): string {
  if (source === "LIVE_BB_API") {
    return "Live BB API";
  }
  if (source === "MATCH_BOXSCORE_CACHE") {
    return "Match boxscore cache";
  }
  if (source === "CANONICAL_MATCH_STORE") {
    return "Canonical match store";
  }

  return source
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatAmplifyErrors(
  errors: Array<{ message?: string }> | null | undefined,
): string {
  if (!errors?.length) {
    return "The operation failed without a detailed error message.";
  }

  return errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unavailable";
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

function formatMetricValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return "N/A";
}

export const __testing = {
  buildMetricComparisonRows,
  buildScoreline,
  readPlayerStat,
  sortBoxscorePlayers,
};
