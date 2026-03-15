"use client";

import { useEffect, useState } from "react";
import { Button, Heading, Text } from "@aws-amplify/ui-react";

import { client } from "@/app/amplify-client";
import type { PredictionJobRecord, SyncRunRecord } from "@/app/types";

const terminalPredictionStatuses = new Set(["SUCCEEDED", "FAILED"]);
const terminalSyncStatuses = new Set(["SUCCEEDED", "FAILED", "IDLE"]);

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
    <section className="dashboard-card">
      <div className="section-header">
        <div>
          <Text className="eyebrow">Operations</Text>
          <Heading level={2}>Sync and prediction visibility</Heading>
        </div>
        <Button
          className="secondary-button"
          onClick={() => void loadOperations()}
          isLoading={isLoading}
        >
          Refresh ops
        </Button>
      </div>

      <Text className="status-copy">
        Track manual workspace refreshes and prediction jobs without leaving the
        product.
      </Text>

      {opsError ? <div className="inline-alert">{opsError}</div> : null}

      <div className="summary-strip">
        <div className="summary-card">
          <span className="summary-label">Active syncs</span>
          <strong className="summary-value">{activeSyncCount}</strong>
          <span className="summary-detail">
            {failedSyncCount ? `${failedSyncCount} recent failure(s)` : "Recent syncs are healthy."}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Prediction queue</span>
          <strong className="summary-value">{activePredictionCount}</strong>
          <span className="summary-detail">
            {predictionJobs[0]?.modelVersion
              ? `Latest model ${predictionJobs[0].modelVersion}`
              : "No model version resolved yet."}
          </span>
        </div>
      </div>

      <div className="dashboard-grid two-column">
        <article className="subpanel">
          <Heading level={4}>Recent sync runs</Heading>
          {syncRuns.length ? (
            <ul className="data-list">
              {syncRuns.map((run) => (
                <li key={run.id}>
                  <strong>{run.kind ?? "Workspace sync"}</strong>
                  <span>
                    {humanizeStatus(run.status)} • {formatTimestamp(run.startedAt ?? null)}
                    {run.error ? ` • ${run.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Text>No sync runs have been recorded yet.</Text>
          )}
        </article>

        <article className="subpanel">
          <Heading level={4}>Recent prediction jobs</Heading>
          {predictionJobs.length ? (
            <ul className="data-list">
              {predictionJobs.map((job) => (
                <li key={job.id}>
                  <strong>{humanizeStatus(job.status)}</strong>
                  <span>
                    {job.modelVersion ? `${job.modelVersion} • ` : ""}
                    {formatTimestamp(job.updatedAt ?? job.createdAt ?? null)}
                    {job.error ? ` • ${job.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Text>No prediction jobs have been recorded yet.</Text>
          )}
        </article>
      </div>
    </section>
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
