"use client";

import { useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import type { PredictionJobRecord, SyncRunRecord } from "@/app/types";

const terminalPredictionStatuses = new Set(["SUCCEEDED", "FAILED"]);
const terminalSyncStatuses = new Set(["SUCCEEDED", "FAILED", "IDLE"]);
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-2";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";

export function OperationsPanel() {
  const [syncRuns, setSyncRuns] = useState<SyncRunRecord[]>([]);
  const [predictionJobs, setPredictionJobs] = useState<PredictionJobRecord[]>([]);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadOperations();
  }, []);

  useEffect(() => {
    const hasActiveWork =
      syncRuns.some((run) => run.status && !terminalSyncStatuses.has(run.status)) ||
      predictionJobs.some(
        (job) => job.status && !terminalPredictionStatuses.has(job.status),
      );

    if (!hasActiveWork) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadOperations();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [predictionJobs, syncRuns]);

  async function loadOperations() {
    setIsLoading(true);
    setOpsError(null);

    const [syncResponse, predictionResponse] = await Promise.all([
      client.models.SyncRun.list({ limit: 8 }),
      client.models.PredictionJob.list({ limit: 8 }),
    ]);

    if (syncResponse.errors?.length || predictionResponse.errors?.length) {
      setOpsError(
        formatAmplifyErrors([
          ...(syncResponse.errors ?? []),
          ...(predictionResponse.errors ?? []),
        ]),
      );
      setSyncRuns([]);
      setPredictionJobs([]);
      setIsLoading(false);
      return;
    }

    setSyncRuns(
      [...syncResponse.data].sort((left, right) =>
        String(right.startedAt ?? right.createdAt ?? "").localeCompare(
          String(left.startedAt ?? left.createdAt ?? ""),
        ),
      ),
    );
    setPredictionJobs(
      [...predictionResponse.data].sort((left, right) =>
        String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
          String(left.updatedAt ?? left.createdAt ?? ""),
        ),
      ),
    );
    setIsLoading(false);
  }

  const activeSyncCount = syncRuns.filter(
    (run) => run.status && !terminalSyncStatuses.has(run.status),
  ).length;
  const failedSyncCount = syncRuns.filter((run) => run.status === "FAILED").length;
  const activePredictionCount = predictionJobs.filter(
    (job) => job.status && !terminalPredictionStatuses.has(job.status),
  ).length;

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button loading={isLoading} onClick={() => void loadOperations()} variant="secondary">
            Refresh ops
          </Button>
        }
        description="Track manual workspace refreshes and prediction jobs without leaving the product."
        eyebrow="Operations"
        title="Sync and prediction visibility"
      />

      {opsError ? <Alert>{opsError}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          detail={
            failedSyncCount
              ? `${failedSyncCount} recent failure(s)`
              : "Recent syncs are healthy."
          }
          label="Active syncs"
          value={activeSyncCount}
        />
        <StatCard
          detail={
            predictionJobs[0]?.modelVersion
              ? `Latest model ${predictionJobs[0].modelVersion}`
              : "No model version resolved yet."
          }
          label="Prediction queue"
          value={activePredictionCount}
        />
      </div>

      <div className={twoColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Recent sync runs" titleAs="h4" />
          {syncRuns.length ? (
            <ul className={listClassName}>
              {syncRuns.map((run) => (
                <li className={listItemClassName} key={run.id}>
                  <strong className="text-sm text-ink">
                    {run.kind ?? "Workspace sync"}
                  </strong>
                  <span className={statusCopyClassName}>
                    {humanizeStatus(run.status)} • {formatTimestamp(run.startedAt ?? null)}
                    {run.error ? ` • ${run.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={statusCopyClassName}>No sync runs have been recorded yet.</p>
          )}
        </Panel>

        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Recent prediction jobs" titleAs="h4" />
          {predictionJobs.length ? (
            <ul className={listClassName}>
              {predictionJobs.map((job) => (
                <li className={listItemClassName} key={job.id}>
                  <strong className="text-sm text-ink">
                    {humanizeStatus(job.status)}
                  </strong>
                  <span className={statusCopyClassName}>
                    {job.modelVersion ? `${job.modelVersion} • ` : ""}
                    {formatTimestamp(job.updatedAt ?? job.createdAt ?? null)}
                    {job.error ? ` • ${job.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={statusCopyClassName}>
              No prediction jobs have been recorded yet.
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
