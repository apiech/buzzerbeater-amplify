"use client";

import { useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
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
import type {
  GameDayRecapRecord,
  LeagueGameDayRecapRecord,
  PredictionJobRecord,
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
  const [gameDayRecaps, setGameDayRecaps] = useState<GameDayRecapRecord[]>([]);
  const [leagueGameDayRecaps, setLeagueGameDayRecaps] = useState<
    LeagueGameDayRecapRecord[]
  >([]);
  const [singleGameSummaries, setSingleGameSummaries] = useState<
    SingleGameSummaryRecord[]
  >([]);
  const [syncRuns, setSyncRuns] = useState<SyncRunRecord[]>([]);
  const [predictionJobs, setPredictionJobs] = useState<PredictionJobRecord[]>([]);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadOperations();
  }, []);

  useEffect(() => {
    const hasActiveWork =
      syncRuns.some((run) => !terminalSyncStatuses.has(run.status)) ||
      combinedRecaps(
        gameDayRecaps,
        leagueGameDayRecaps,
        singleGameSummaries,
      ).some((recap) => !terminalRecapStatuses.has(recap.status)) ||
      predictionJobs.some((job) => !terminalPredictionStatuses.has(job.status));

    if (!hasActiveWork) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadOperations();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [gameDayRecaps, leagueGameDayRecaps, predictionJobs, singleGameSummaries, syncRuns]);

  async function loadOperations() {
    setIsLoading(true);
    setOpsError(null);

    const response = await client.reads.getOperationsActivity({ limit: 8 });

    if (response.errors?.length || !response.data) {
      setOpsError(formatAmplifyErrors(response.errors));
      setGameDayRecaps([]);
      setLeagueGameDayRecaps([]);
      setSingleGameSummaries([]);
      setSyncRuns([]);
      setPredictionJobs([]);
      setIsLoading(false);
      return;
    }

    setSyncRuns(
      [...response.data.syncRuns].sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      ),
    );
    setGameDayRecaps(
      [...response.data.gameDayRecaps].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    setLeagueGameDayRecaps(
      [...response.data.leagueGameDayRecaps].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    setSingleGameSummaries(
      [...response.data.singleGameSummaries].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    setPredictionJobs(
      [...response.data.predictionJobs].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    setIsLoading(false);
  }

  const activeSyncCount = syncRuns.filter((run) => !terminalSyncStatuses.has(run.status)).length;
  const failedSyncCount = syncRuns.filter((run) => run.status === "FAILED").length;
  const activePredictionCount = predictionJobs.filter(
    (job) => !terminalPredictionStatuses.has(job.status),
  ).length;
  const recapActivity = combinedRecaps(
    gameDayRecaps,
    leagueGameDayRecaps,
    singleGameSummaries,
  );
  const activeRecapCount = recapActivity.filter(
    (recap) => !terminalRecapStatuses.has(recap.status),
  ).length;

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button loading={isLoading} onClick={() => void loadOperations()} variant="secondary">
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
            predictionJobs[0]
              ? `${formatPreviewStatus(predictionJobs[0].status)} as of ${formatTimestamp(predictionJobs[0].updatedAt)}.`
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
          <SectionHeading title="Recent previews" titleAs="h4" />
          {predictionJobs.length ? (
            <ul className={listClassName}>
              {predictionJobs.map((job) => (
                <li className={listItemClassName} key={job.id}>
                  <strong className="text-sm text-ink">
                    {describePredictionJob(job)}
                  </strong>
                  <span className={statusCopyClassName}>
                    {formatPreviewStatus(job.status)} •{" "}
                    {formatTimestamp(job.updatedAt)}
                    {job.error ? ` • ${job.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={statusCopyClassName}>
              No previews have been recorded yet.
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

function describePredictionJob(job: PredictionJobRecord): string {
  if (job.error) {
    return "Preview needs attention";
  }

  return job.mode === "CONNECTED"
    ? "Saved-game preview"
    : "Manual preview";
}

function readRecapHeadline(value: unknown): string | null {
  const record = parseJsonRecord(value);
  const summary = parseJsonRecord(record?.summary);
  const headline = summary?.headline;
  return typeof headline === "string" && headline.trim()
    ? headline.trim()
    : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return parseJsonRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
