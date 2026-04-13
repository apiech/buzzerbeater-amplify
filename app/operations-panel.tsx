"use client";

import { useQuery } from "@tanstack/react-query";

import { operationsActivityQueryOptions } from "@/app/dashboard/workspace-query-client";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  formatConnectionStatus,
  formatPreviewStatus,
  formatSyncKind,
  formatWriteupStatus,
} from "@/app/ui/presentation";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import type {
  CurrentPredictionPreview,
  GameDayRecapRecord,
  GameDayRecapResultPayload,
  LeagueGameDayRecapRecord,
  SingleGameSummaryRecord,
  SyncRunRecord,
} from "@/app/types";

const terminalRecapStatuses = new Set(["SUCCEEDED", "FAILED"]);
const terminalPredictionStatuses = new Set(["SUCCEEDED", "FAILED"]);
const terminalSyncStatuses = new Set(["SUCCEEDED", "FAILED", "IDLE"]);
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const threeColumnGridClassName = "grid gap-4 xl:grid-cols-3";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";

export function OperationsPanel() {
  const operationsQuery = useQuery({
    ...operationsActivityQueryOptions({ limit: 8 }),
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) => {
      const payload = query.state.data;
      if (
        !payload ||
        !hasActiveOperationsActivity({
          currentPrediction: payload.currentPrediction,
          gameDayRecaps: payload.gameDayRecaps,
          leagueGameDayRecaps: payload.leagueGameDayRecaps,
          singleGameSummaries: payload.singleGameSummaries,
          syncRuns: payload.syncRuns,
        })
      ) {
        return false;
      }

      return 4000;
    },
  });

  const syncRuns = [...(operationsQuery.data?.syncRuns ?? [])].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
  const gameDayRecaps = [...(operationsQuery.data?.gameDayRecaps ?? [])].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
  const leagueGameDayRecaps = [
    ...(operationsQuery.data?.leagueGameDayRecaps ?? []),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const singleGameSummaries = [
    ...(operationsQuery.data?.singleGameSummaries ?? []),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const currentPrediction = operationsQuery.data?.currentPrediction ?? null;
  const opsError = readQueryError(operationsQuery.error);

  const activeSyncCount = syncRuns.filter((run) => isActiveSyncStatus(run.status)).length;
  const failedSyncCount = syncRuns.filter((run) => run.status === "FAILED").length;
  const activePredictionCount =
    currentPrediction && isActivePredictionStatus(currentPrediction.status)
      ? 1
      : 0;
  const recapActivity = combinedRecaps(
    gameDayRecaps,
    leagueGameDayRecaps,
    singleGameSummaries,
  );
  const activeRecapCount = recapActivity.filter(
    (recap) => isActiveRecapStatus(recap.status),
  ).length;

  async function handleRefresh(): Promise<void> {
    captureAnalyticsEvent("operations_refresh_requested", {
      source: "operations_panel",
    });
    await operationsQuery.refetch();
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            loading={operationsQuery.isRefetching}
            onClick={() => void handleRefresh()}
            variant="secondary"
          >
            Refresh activity
          </Button>
        }
        description="Review recent club refreshes and matchup preview activity without leaving the app."
        eyebrow="Account"
        title="Recent activity"
      />

      {opsError ? <Alert>{opsError}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          detail={
            failedSyncCount
              ? `${failedSyncCount} recent refresh${failedSyncCount === 1 ? "" : "es"} need attention.`
              : activeSyncCount
                ? "Club data is updating now."
                : "Club data looks current."
          }
          label="Active refreshes"
          value={activeSyncCount}
        />
        <StatCard
          detail={
            currentPrediction
              ? `${formatPreviewStatus(currentPrediction.status)} as of ${formatTimestamp(currentPrediction.updatedAt)}.`
              : "No preview activity yet."
          }
          label="Previews running"
          value={activePredictionCount}
        />
        <StatCard
          detail={
            recapActivity[0]
              ? `${formatWriteupStatus(recapActivity[0].status)} as of ${formatTimestamp(recapActivity[0].updatedAt)}.`
              : "No writeup activity yet."
          }
          label="Writeups running"
          value={activeRecapCount}
        />
      </div>

      <div className={threeColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Recent club updates" titleAs="h4" />
          {syncRuns.length ? (
            <ul className={listClassName}>
              {syncRuns.map((run) => (
                <li className={listItemClassName} key={run.id}>
                  <strong className="text-sm text-ink">
                    {formatSyncKind(run.kind)}
                  </strong>
                  <span className={statusCopyClassName}>
                    {formatConnectionStatus(run.status)} • {formatTimestamp(run.startedAt)}
                    {run.error ? ` • ${run.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={statusCopyClassName}>No refresh activity has been recorded yet.</p>
          )}
        </Panel>

        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Current preview" titleAs="h4" />
          {currentPrediction ? (
            <ul className={listClassName}>
              <li className={listItemClassName} key={currentPrediction.requestId}>
                <strong className="text-sm text-ink">
                  {describePredictionJob(currentPrediction)}
                </strong>
                <span className={statusCopyClassName}>
                  {formatPreviewStatus(currentPrediction.status)} •{" "}
                  {formatTimestamp(currentPrediction.updatedAt)}
                  {currentPrediction.error ? ` • ${currentPrediction.error}` : ""}
                </span>
              </li>
            </ul>
          ) : (
            <p className={statusCopyClassName}>
              No preview has been recorded yet.
            </p>
          )}
        </Panel>

        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Recent recaps" titleAs="h4" />
          {recapActivity.length ? (
            <ul className={listClassName}>
              {recapActivity.map((recap) => (
                <li className={listItemClassName} key={recap.key}>
                  <strong className="text-sm text-ink">
                    {recap.title}
                  </strong>
                  <span className={statusCopyClassName}>
                    {formatWriteupStatus(recap.status)} • {recap.detail}
                    {recap.error ? ` • ${recap.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={statusCopyClassName}>
              No recaps have been recorded yet.
            </p>
          )}
        </Panel>
      </div>
    </Panel>
  );
}

function readQueryError(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
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

function combinedRecaps(
  gameDayRecaps: readonly GameDayRecapRecord[],
  leagueGameDayRecaps: readonly LeagueGameDayRecapRecord[],
  singleGameSummaries: readonly SingleGameSummaryRecord[],
) {
  return [
    ...gameDayRecaps.map((recap) => ({
      detail: recap.gameDate,
      error: recap.error ?? null,
      key: `LEAGUE_DATE:${recap.targetKey}`,
      status: recap.status,
      title:
        readRecapHeadline(recap.resultJson) ??
        recap.leagueName ??
        "League recap",
      updatedAt: recap.updatedAt,
    })),
    ...leagueGameDayRecaps.map((recap) => ({
      detail: `Game day ${recap.gameDayNumber}${recap.season ? ` • season ${recap.season}` : ""}`,
      error: recap.error ?? null,
      key: `LEAGUE_GAME_DAY:${recap.targetKey}`,
      status: recap.status,
      title:
        readRecapHeadline(recap.resultJson) ??
        recap.leagueName ??
        "League recap",
      updatedAt: recap.updatedAt,
    })),
    ...singleGameSummaries.map((recap) => ({
      detail: recap.gameDate ?? "Date unavailable",
      error: recap.error ?? null,
      key: `SINGLE_GAME:${recap.targetKey}`,
      status: recap.status,
      title:
        readRecapHeadline(recap.resultJson) ??
        recap.leagueName ??
        "Single-game recap",
      updatedAt: recap.updatedAt,
    })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function hasActiveOperationsActivity(input: {
  currentPrediction: CurrentPredictionPreview | null;
  gameDayRecaps: readonly GameDayRecapRecord[];
  leagueGameDayRecaps: readonly LeagueGameDayRecapRecord[];
  singleGameSummaries: readonly SingleGameSummaryRecord[];
  syncRuns: readonly SyncRunRecord[];
}): boolean {
  return (
    input.syncRuns.some((run) => isActiveSyncStatus(run.status)) ||
    Boolean(
      input.currentPrediction &&
        isActivePredictionStatus(input.currentPrediction.status),
    ) ||
    input.gameDayRecaps.some((recap) => isActiveRecapStatus(recap.status)) ||
    input.leagueGameDayRecaps.some((recap) => isActiveRecapStatus(recap.status)) ||
    input.singleGameSummaries.some((recap) => isActiveRecapStatus(recap.status))
  );
}

function describePredictionJob(job: CurrentPredictionPreview): string {
  if (
    job.homeScore !== null &&
    job.homeScore !== undefined &&
    job.awayScore !== null &&
    job.awayScore !== undefined &&
    job.pointDiff !== null &&
    job.pointDiff !== undefined
  ) {
    return `${job.homeScore.toFixed(1)} - ${job.awayScore.toFixed(1)} (${job.pointDiff > 0 ? "+" : ""}${job.pointDiff.toFixed(1)})`;
  }

  if (job.error) {
    return "Preview needs attention";
  }

  return "Preview in progress";
}

function readRecapHeadline(
  value: GameDayRecapResultPayload | null | undefined,
): string | null {
  const headline = value?.summary.headline;
  return typeof headline === "string" && headline.trim()
    ? headline.trim()
    : null;
}

function isActivePredictionStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && !terminalPredictionStatuses.has(status);
}

function isActiveRecapStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && !terminalRecapStatuses.has(status);
}

function isActiveSyncStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && !terminalSyncStatuses.has(status);
}
