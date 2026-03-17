"use client";

import { useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
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

    const [
      syncResponse,
      predictionResponse,
      recapResponse,
      gameDayResponse,
      singleGameResponse,
    ] = await Promise.all([
      client.models.SyncRun.list({ limit: 8 }),
      client.models.PredictionJob.list({ limit: 8 }),
      client.models.GameDayRecap.list({ limit: 8 }),
      client.models.LeagueGameDayRecap.list({ limit: 8 }),
      client.models.SingleGameSummary.list({ limit: 8 }),
    ]);

    if (
      syncResponse.errors?.length ||
      predictionResponse.errors?.length ||
      recapResponse.errors?.length ||
      gameDayResponse.errors?.length ||
      singleGameResponse.errors?.length
    ) {
      setOpsError(
        formatAmplifyErrors([
          ...(syncResponse.errors ?? []),
          ...(predictionResponse.errors ?? []),
          ...(recapResponse.errors ?? []),
          ...(gameDayResponse.errors ?? []),
          ...(singleGameResponse.errors ?? []),
        ]),
      );
      setGameDayRecaps([]);
      setLeagueGameDayRecaps([]);
      setSingleGameSummaries([]);
      setSyncRuns([]);
      setPredictionJobs([]);
      setIsLoading(false);
      return;
    }

    setSyncRuns(
      [...syncResponse.data].sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    );
    setGameDayRecaps(
      [...recapResponse.data].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
    setLeagueGameDayRecaps(
      [...gameDayResponse.data].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
    setSingleGameSummaries(
      [...singleGameResponse.data].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    setPredictionJobs(
      [...predictionResponse.data].sort((left, right) =>
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
              ? `${failedSyncCount} recent failure(s)`
              : "Recent syncs are healthy."
          }
          label="Active refreshes"
          value={activeSyncCount}
        />
        <StatCard
          detail={
            predictionJobs[0]?.modelVersion
              ? `Latest preview engine ${predictionJobs[0].modelVersion}`
              : "No preview engine has been recorded yet."
          }
          label="Preview queue"
          value={activePredictionCount}
        />
        <StatCard
          detail={
            recapActivity[0]?.modelId
              ? `Latest recap model ${recapActivity[0].modelId}`
              : "No recap model has been recorded yet."
          }
          label="Active recaps"
          value={activeRecapCount}
        />
      </div>

      <div className={threeColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Recent refreshes" titleAs="h4" />
          {syncRuns.length ? (
            <ul className={listClassName}>
              {syncRuns.map((run) => (
                <li className={listItemClassName} key={run.id}>
                  <strong className="text-sm text-ink">
                    {run.kind}
                  </strong>
                  <span className={statusCopyClassName}>
                    {humanizeStatus(run.status)} • {formatTimestamp(run.startedAt)}
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
                    {humanizeStatus(job.status)}
                  </strong>
                  <span className={statusCopyClassName}>
                    {job.modelVersion ? `${job.modelVersion} • ` : ""}
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
                    {humanizeStatus(recap.status)} • {recap.detail}
                    {recap.modelId ? ` • ${recap.modelId}` : ""}
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

function humanizeStatus(status: string | null | undefined): string {
  if (!status) {
    return "Unknown";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
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
      modelId: recap.modelId ?? null,
      status: recap.status,
      title: recap.leagueName ?? recap.leagueId,
      updatedAt: recap.updatedAt,
    })),
    ...leagueGameDayRecaps.map((recap) => ({
      detail: `Game day ${recap.gameDayNumber}${recap.season ? ` • season ${recap.season}` : ""}`,
      error: recap.error ?? null,
      key: `LEAGUE_GAME_DAY:${recap.targetKey}`,
      modelId: recap.modelId ?? null,
      status: recap.status,
      title: recap.leagueName ?? recap.leagueId,
      updatedAt: recap.updatedAt,
    })),
    ...singleGameSummaries.map((recap) => ({
      detail: `${recap.gameDate ?? "Date unknown"} • match ${recap.matchId}`,
      error: recap.error ?? null,
      key: `SINGLE_GAME:${recap.targetKey}`,
      modelId: recap.modelId ?? null,
      status: recap.status,
      title: recap.leagueName ?? "Single game summary",
      updatedAt: recap.updatedAt,
    })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
