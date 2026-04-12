"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  clearMyTeamHighlightsDataMutation,
  fetchTeamHighlightsQuery,
  submitMyTeamHighlightsScanMutation,
  workspaceQueryKeys,
} from "@/app/dashboard/workspace-query-client";
import type {
  HighlightsPanelContext,
  TeamHighlightsMoment,
  TeamHighlightsPayload,
  TeamHighlightsScanStatus,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  StatusBadge,
  statusToneFromValue,
} from "@/app/ui/primitives/status-badge";
import { formatHighlightsStatus } from "@/app/ui/presentation";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-2 rounded-card border border-black/8 bg-white/70 px-4 py-3";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-[1.25fr_0.95fr]";
const filterButtonClassName =
  "rounded-full border px-4 py-2 text-sm font-semibold transition";
const activeFilterButtonClassName =
  "border-accent bg-accent text-accent-contrast shadow-sm";
const inactiveFilterButtonClassName =
  "border-black/10 bg-white/70 text-ink hover:border-accent/35 hover:bg-white";

type HighlightsPanelProps = {
  context: HighlightsPanelContext;
};

type HighlightsFilterPerspective = "against" | "both" | "for";

const ACTIVE_SCAN_STATUSES = new Set([
  "ENQUEUING_MATCHES",
  "QUEUED",
  "RESOLVING_HISTORY",
  "WAITING_FOR_MATCH_JOBS",
]);
const TERMINAL_SCAN_STATUSES = new Set([
  "COMPLETED_WITH_GAPS",
  "FAILED",
  "SUCCEEDED",
]);
const STALE_SCAN_MILLISECONDS = 15 * 60 * 1000;
const BB_CREDENTIAL_RECONNECT_REQUIRED_PREFIX = "Reconnect BuzzerBeater:";
const BB_CREDENTIAL_SECRET_MISMATCH_PREFIX =
  "BuzzerBeater credential secret mismatch:";
const BB_CREDENTIAL_SECRET_UNAVAILABLE_PREFIX =
  "BuzzerBeater credential decryption is unavailable";

type HighlightsCredentialErrorKind =
  | "reconnect_required"
  | "secret_mismatch"
  | "secret_unavailable";

export function HighlightsPanel({ context }: HighlightsPanelProps) {
  const queryClient = useQueryClient();
  const hasInitializedFilterTrackingRef = useRef(false);
  const hasInitializedTerminalTrackingRef = useRef(false);
  const lastTrackedTerminalScanKeyRef = useRef<string | null>(null);
  const [perspective, setPerspective] =
    useState<HighlightsFilterPerspective>("both");
  const [onlyOutcomeChange, setOnlyOutcomeChange] = useState(true);
  const perspectiveValue = perspective.toUpperCase();
  const highlightsQuery = useInfiniteQuery({
    queryKey: workspaceQueryKeys.highlights({
      onlyOutcomeChange,
      perspective: perspectiveValue,
    }),
    queryFn: ({ pageParam }) =>
      fetchTeamHighlightsQuery({
        cursor:
          typeof pageParam === "string" && pageParam.trim().length
            ? pageParam
            : undefined,
        onlyOutcomeChange,
        perspective: perspectiveValue,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) => {
      const latestPayload = mergeHighlightsPages(query.state.data?.pages ?? []);
      return hasActiveTeamHighlightsScan(latestPayload?.scanStatus ?? null) &&
        !isTeamHighlightsScanStale(latestPayload?.scanStatus ?? null)
        ? 4000
        : false;
    },
  });
  const submitScanMutation = useMutation({
    mutationFn: submitMyTeamHighlightsScanMutation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workspace", "highlights"],
      });
    },
  });
  const clearDataMutation = useMutation({
    mutationFn: clearMyTeamHighlightsDataMutation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workspace", "highlights"],
      });
    },
  });
  const payload = useMemo(
    () => mergeHighlightsPages(highlightsQuery.data?.pages ?? []),
    [highlightsQuery.data?.pages],
  );
  const loadError = readQueryError(highlightsQuery.error);
  const submitError =
    readQueryError(submitScanMutation.error) ??
    readQueryError(clearDataMutation.error);
  const isLoading = highlightsQuery.isPending;
  const isLoadingMore = highlightsQuery.isFetchingNextPage;
  const isSubmitting = submitScanMutation.isPending;
  const isClearing = clearDataMutation.isPending;

  const focusTeamName =
    payload?.team.teamName ?? context.team.teamName ?? "Your club";
  const scanStatus = payload?.scanStatus ?? null;
  const isScanStale = isTeamHighlightsScanStale(scanStatus);
  const hasActiveScan = hasActiveTeamHighlightsScan(scanStatus) && !isScanStale;
  const hasRecordedHistory = hasRecordedTeamHighlightsHistory(scanStatus);
  const scanActionLabel = getTeamHighlightsScanActionLabel(scanStatus, {
    hasActiveScan,
    hasRecordedHistory,
    isScanStale,
  });
  const summary = payload?.summary ?? {
    againstMoments: 0,
    filteredMoments: 0,
    forMoments: 0,
    outcomeChangeMoments: 0,
    totalMoments: 0,
  };

  const failedMatches = scanStatus?.matchesFailed ?? 0;
  const brokenMatches = scanStatus?.brokenMatches ?? [];
  const hasBrokenMatches = brokenMatches.length > 0;
  const failedScanCredentialErrorKind = resolveHighlightsCredentialErrorKind(
    scanStatus?.errorCode,
    scanStatus?.error,
  );
  const submitCredentialErrorKind = resolveHighlightsCredentialErrorKind(
    null,
    submitError,
  );

  useEffect(() => {
    if (!hasInitializedFilterTrackingRef.current) {
      hasInitializedFilterTrackingRef.current = true;
      return;
    }

    captureAnalyticsEvent("highlights_filter_changed", {
      only_outcome_change: onlyOutcomeChange,
      perspective,
      source: "highlights_panel",
    });
  }, [onlyOutcomeChange, perspective]);

  useEffect(() => {
    const completedScan = scanStatus;
    const trackedStatus = scanStatus?.status;
    const terminalKey =
      trackedStatus && TERMINAL_SCAN_STATUSES.has(trackedStatus)
        ? `${trackedStatus}:${completedScan?.completedAt ?? completedScan?.updatedAt ?? completedScan?.requestedAt}`
        : null;

    if (!hasInitializedTerminalTrackingRef.current) {
      hasInitializedTerminalTrackingRef.current = true;
      lastTrackedTerminalScanKeyRef.current = terminalKey;
      return;
    }

    if (!terminalKey || lastTrackedTerminalScanKeyRef.current === terminalKey) {
      return;
    }
    if (!completedScan || !trackedStatus) {
      return;
    }

    lastTrackedTerminalScanKeyRef.current = terminalKey;
    captureAnalyticsEvent("highlights_scan_completed", {
      failed_matches: completedScan.matchesFailed ?? 0,
      matches_discovered: completedScan.matchesDiscovered ?? 0,
      matches_with_moments: completedScan.matchesWithMoments ?? 0,
      moments_written: completedScan.momentsWritten ?? 0,
      source: "highlights_panel",
      status: trackedStatus.toLowerCase(),
    });
  }, [
    scanStatus,
    scanStatus?.completedAt,
    scanStatus?.matchesDiscovered,
    scanStatus?.matchesFailed,
    scanStatus?.matchesWithMoments,
    scanStatus?.momentsWritten,
    scanStatus?.requestedAt,
    scanStatus?.status,
    scanStatus?.updatedAt,
  ]);

  async function handleSubmit(): Promise<void> {
    captureAnalyticsEvent("highlights_scan_requested", {
      action_label: scanActionLabel,
      has_recorded_history: hasRecordedHistory,
      source: "highlights_panel",
    });

    try {
      await submitScanMutation.mutateAsync();
    } catch {
      captureAnalyticsEvent("highlights_scan_request_failed", {
        source: "highlights_panel",
      });
      // Mutation state carries the user-facing error.
    }
  }

  async function handleLoadMore(): Promise<void> {
    if (!payload?.nextCursor) {
      return;
    }

    captureAnalyticsEvent("highlights_load_more_requested", {
      only_outcome_change: onlyOutcomeChange,
      perspective,
      source: "highlights_panel",
    });
    await highlightsQuery.fetchNextPage();
  }

  async function handleClear(): Promise<void> {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Clear the current team's saved highlights data in this environment? This deletes only this team's moments and recorded coverage so the next scan starts fresh.",
      )
    ) {
      return;
    }

    try {
      await clearDataMutation.mutateAsync();
      captureAnalyticsEvent("highlights_data_cleared", {
        source: "highlights_panel",
      });
    } catch {
      captureAnalyticsEvent("highlights_clear_failed", {
        source: "highlights_panel",
      });
      // Mutation state carries the user-facing error.
    }
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(payload?.summary.totalMoments ?? 0) > 0 || hasRecordedHistory ? (
              <Button
                className="border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100"
                disabled={hasActiveScan}
                loading={isClearing}
                onClick={() => void handleClear()}
                variant="secondary"
              >
                Clear data
              </Button>
            ) : null}
            <Button
              disabled={hasActiveScan || isClearing}
              loading={isSubmitting}
              onClick={() => void handleSubmit()}
            >
              {scanActionLabel}
            </Button>
          </div>
        }
        description="Scan your connected club's history for late-game moments and review them from both team perspectives."
        eyebrow="Highlights"
        title="My Team All-time Highlights"
      />

      <p className={statusCopyClassName}>
        Default view keeps the focus on late regulation and overtime swings that
        changed the result for your club.
      </p>

      {loadError ? (
        <Alert>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <p>Couldn&apos;t load the latest moments right now.</p>
              <p className="text-xs leading-5 text-current/80">
                Technical details: {loadError}
              </p>
            </div>
            <Button
              loading={isLoading}
              onClick={() => void highlightsQuery.refetch()}
              size="sm"
              variant="secondary"
            >
              Try again
            </Button>
          </div>
        </Alert>
      ) : null}
      {submitError ? (
        <Alert>
          <div className="grid gap-1">
            <p>
              {submitCredentialErrorKind
                ? describeHighlightsCredentialRecovery(submitCredentialErrorKind)
                : "The scan could not be started right now. Try again in a moment."}
            </p>
            <p className="text-xs leading-5 text-current/80">
              Technical details: {submitError}
            </p>
          </div>
        </Alert>
      ) : null}
      {isScanStale ? (
        <Alert>
          The latest scan stopped updating more than 15 minutes ago. Retry the
          scan to start a fresh run.
        </Alert>
      ) : null}

      <div className={summaryGridClassName}>
        <StatCard
          detail="Late-game moments saved for your club."
          label="All moments"
          value={summary.totalMoments}
        />
        <StatCard
          detail="Finishes your club delivered."
          label="For us"
          value={summary.forMoments}
        />
        <StatCard
          detail="Finishes opponents delivered against your club."
          label="Against us"
          value={summary.againstMoments}
        />
        <StatCard
          detail="Moments shown with the current filters."
          label="Visible now"
          value={summary.filteredMoments}
        />
      </div>

      <div className={twoColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description={`Focus team: ${focusTeamName}`}
            title="Filters"
            titleAs="h4"
          />

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["both", "Both"],
                ["for", "For us"],
                ["against", "Against us"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={[
                  filterButtonClassName,
                  perspective === value
                    ? activeFilterButtonClassName
                    : inactiveFilterButtonClassName,
                ].join(" ")}
                key={value}
                onClick={() => setPerspective(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <button
            className="flex items-center gap-3 rounded-card border border-black/10 bg-white/70 px-4 py-3 text-left text-sm font-semibold text-ink transition hover:border-accent/35 hover:bg-white"
            onClick={() => setOnlyOutcomeChange((current) => !current)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={[
                "inline-flex h-6 w-11 items-center rounded-full border transition",
                onlyOutcomeChange
                  ? "justify-end border-accent bg-accent/18 px-1"
                  : "justify-start border-black/10 bg-black/5 px-1",
              ].join(" ")}
            >
              <span
                className={[
                  "size-4 rounded-full transition",
                  onlyOutcomeChange ? "bg-accent" : "bg-ink-muted",
                ].join(" ")}
              />
            </span>
            <span>
              Only show Q4 or overtime moments that changed the game state.
            </span>
          </button>

          <div className="grid gap-2 rounded-card border border-black/8 bg-white/55 p-4">
            <strong className="text-sm text-ink">What counts in v1</strong>
            <p className={statusCopyClassName}>
              These are late-game buzzerbeaters and free throws pulled from saved
              game data. Broader highlight types stay out of scope for now.
            </p>
          </div>
        </Panel>

        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading title="Latest scan" titleAs="h4" />

          {scanStatus ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-ink">
                  {scanStatus.teamName ?? focusTeamName}
                </strong>
                <StatusBadge tone={statusToneFromValue(scanStatus.status)}>
                  {formatHighlightsStatus(scanStatus.status)}
                </StatusBadge>
              </div>
              <p className={statusCopyClassName}>
                Requested {formatTimestamp(scanStatus.requestedAt)}.
                {scanStatus.completedAt
                  ? ` Last update ${formatTimestamp(scanStatus.completedAt)}.`
                  : scanStatus.updatedAt
                    ? ` Last update ${formatTimestamp(scanStatus.updatedAt)}.`
                    : null}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  detail="Completed games found during the history scan."
                  label="Found"
                  value={scanStatus.matchesDiscovered ?? 0}
                />
                <StatCard
                  detail="Games already recorded for this team before this run."
                  label="Already recorded"
                  value={
                    scanStatus.matchesAlreadyRecorded ??
                    scanStatus.matchesReused ??
                    0
                  }
                />
                <StatCard
                  detail="Games this run checked and recorded for this team."
                  label="Processed this run"
                  value={
                    scanStatus.matchesProcessedThisRun ??
                    scanStatus.matchesCompleted ??
                    0
                  }
                />
                <StatCard
                  detail="Late-game moments written for this team in this run."
                  label="Moments written"
                  value={scanStatus.momentsWritten ?? 0}
                />
              </div>
              <p className={statusCopyClassName}>
                {describeScanStatus(scanStatus)}
              </p>
              {scanStatus.unsupportedSeasonsWarning ? (
                <Alert>{scanStatus.unsupportedSeasonsWarning}</Alert>
              ) : null}
              {typeof scanStatus.currentSeason === "number" && hasActiveScan ? (
                <p className={statusCopyClassName}>
                  Currently scanning season {scanStatus.currentSeason}.
                </p>
              ) : null}
              {failedMatches > 0 && scanStatus.status !== "COMPLETED_WITH_GAPS" ? (
                <Alert>
                  {failedMatches} match-processing job
                  {failedMatches === 1 ? " failed" : "s failed"} during this
                  scan.
                </Alert>
              ) : null}
              {scanStatus.status === "COMPLETED_WITH_GAPS" ? (
                <Alert>
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <p>
                        Moments are ready for the rest of your history, but{" "}
                        {brokenMatches.length} game
                        {brokenMatches.length === 1 ? "" : "s"} could not be
                        prepared from BuzzerBeater data.
                      </p>
                      {scanStatus.error ? (
                        <p className="text-xs leading-5 text-current/80">
                          Technical details: {scanStatus.error}
                        </p>
                      ) : null}
                    </div>
                    {hasBrokenMatches ? (
                      <ul className="grid gap-2 text-sm leading-6">
                        {brokenMatches.map((match) => (
                          <li key={match.matchId}>
                            <a
                              className="font-semibold underline underline-offset-2"
                              href={match.boxscoreUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {formatBrokenMatchLabel(match)}
                            </a>
                            <span className="text-current/80">
                              {" "}
                              {match.issue}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </Alert>
              ) : null}
              {scanStatus.status === "FAILED" ? (
                <Alert>
                  <div className="grid gap-1">
                    <p>
                      {failedScanCredentialErrorKind
                        ? describeHighlightsCredentialRecovery(
                            failedScanCredentialErrorKind,
                          )
                        : "The latest team history scan ended before all moments were ready. Retry it to start a fresh run."}
                    </p>
                    {scanStatus.error ? (
                      <p className="text-xs leading-5 text-current/80">
                        Technical details: {scanStatus.error}
                      </p>
                    ) : null}
                  </div>
                </Alert>
              ) : scanStatus.error ? (
                <Alert>{scanStatus.error}</Alert>
              ) : null}
            </div>
          ) : (
            <p className={statusCopyClassName}>
              No team highlights scan has been requested yet.
            </p>
          )}
        </Panel>
      </div>

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          description={describeHighlightsEmptyState(payload, {
            isLoading,
            isScanStale,
            onlyOutcomeChange,
          })}
          title="Moments"
          titleAs="h4"
        />

        {payload?.items.length ? (
          <>
            <ul className={listClassName}>
              {payload.items.map((moment) => (
                <li className={listItemClassName} key={moment.recordId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-ink">
                      {buildMomentHeadline(moment)}
                    </strong>
                    <StatusBadge
                      tone={
                        moment.perspective === "FOR" ? "success" : "danger"
                      }
                    >
                      {moment.perspective === "FOR" ? "For us" : "Against us"}
                    </StatusBadge>
                  </div>
                  <span className={statusCopyClassName}>
                    {buildMomentDetail(moment)}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {formatMomentMeta(moment)}
                  </span>
                  {moment.viewerUrl ? (
                    <div className="flex justify-start">
                      <a
                        className="text-sm font-semibold text-accent underline underline-offset-2"
                        href={moment.viewerUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open viewer
                      </a>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {payload.nextCursor ? (
              <div className="flex justify-start">
                <Button
                  loading={isLoadingMore}
                  onClick={() => void handleLoadMore()}
                  variant="secondary"
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className={statusCopyClassName}>
            {describeHighlightsEmptyState(payload, {
              isLoading,
              isScanStale,
              onlyOutcomeChange,
            })}
          </p>
        )}
      </Panel>
    </Panel>
  );
}

export function hasActiveTeamHighlightsScan(
  status: TeamHighlightsScanStatus | null,
): boolean {
  return Boolean(status && ACTIVE_SCAN_STATUSES.has(status.status));
}

export function isTeamHighlightsScanStale(
  status: TeamHighlightsScanStatus | null,
): boolean {
  if (!status || !hasActiveTeamHighlightsScan(status)) {
    return false;
  }

  const referenceTimestamp = status.updatedAt ?? status.requestedAt;
  const parsedReference = Date.parse(referenceTimestamp);
  if (!Number.isFinite(parsedReference)) {
    return false;
  }

  return Date.now() - parsedReference >= STALE_SCAN_MILLISECONDS;
}

export function getTeamHighlightsScanActionLabel(
  status: TeamHighlightsScanStatus | null,
  options: {
    hasActiveScan: boolean;
    hasRecordedHistory: boolean;
    isScanStale: boolean;
  },
): string {
  if (options.hasActiveScan) {
    return "Scan running";
  }

  if (options.isScanStale || status?.status === "FAILED") {
    return options.hasRecordedHistory ? "Retry extend" : "Retry scan";
  }

  if (options.hasRecordedHistory) {
    return "Extend history";
  }

  return "Scan history";
}

export function hasRecordedTeamHighlightsHistory(
  status: TeamHighlightsScanStatus | null,
): boolean {
  if (!status) {
    return false;
  }

  if (status.status === "SUCCEEDED" || status.status === "COMPLETED_WITH_GAPS") {
    return true;
  }

  return Boolean(
    (status.matchesAlreadyRecorded ?? status.matchesReused ?? 0) > 0 ||
      (status.matchesProcessedThisRun ?? status.matchesCompleted ?? 0) > 0,
  );
}

export function describeHighlightsEmptyState(
  payload: TeamHighlightsPayload | null,
  options: {
    isLoading: boolean;
    isScanStale: boolean;
    onlyOutcomeChange: boolean;
  },
): string {
  if (options.isLoading && !payload) {
    return "Loading the latest moments for your club.";
  }

  if (payload?.items.length) {
    return "Late-game moments are sorted newest first.";
  }

  if (!payload?.scanStatus) {
    return "Run a team history scan to build your all-time moments list.";
  }

  if (options.isScanStale) {
    return "The latest team history scan stopped updating. Retry it to continue preparing moments.";
  }

  if (
    payload.scanStatus.status === "FAILED" &&
    resolveHighlightsCredentialErrorKind(
      payload.scanStatus.errorCode,
      payload.scanStatus.error,
    )
  ) {
    return describeHighlightsCredentialRecovery(
      resolveHighlightsCredentialErrorKind(
        payload.scanStatus.errorCode,
        payload.scanStatus.error,
      )!,
    );
  }

  if (hasActiveTeamHighlightsScan(payload.scanStatus)) {
    return "Scanning team history now. Older clubs can take several minutes, and this panel refreshes automatically.";
  }

  if (
    payload.scanStatus.status === "COMPLETED_WITH_GAPS" &&
    (payload.scanStatus.brokenMatches?.length ?? 0) > 0
  ) {
    return "Some games could not be prepared from BuzzerBeater data, but moments are ready for the rest of your history.";
  }

  if (
    payload.scanStatus.unsupportedSeasonsWarning &&
    payload.summary.totalMoments === 0
  ) {
    return "Coverage is recorded for supported seasons, but early unsupported seasons are excluded from bb-events results.";
  }

  if (payload.summary.totalMoments > 0) {
    return options.onlyOutcomeChange
      ? "Moments exist for this team, but none match the current outcome-change filter."
      : "Moments exist for this team, but none match the current perspective filter.";
  }

  if (hasRecordedTeamHighlightsHistory(payload.scanStatus)) {
    return "This team's saved history is recorded, but no bb-events buzzerbeaters were found for the current coverage yet.";
  }

  return "Run a team history scan to build your all-time moments list.";
}

function buildMomentHeadline(moment: TeamHighlightsMoment): string {
  const player = moment.playerName ?? "Unknown player";
  const opponent = moment.opponentName ?? "Unknown opponent";

  if (moment.perspective === "FOR") {
    return `${player} delivered one against ${opponent}`;
  }

  return `${player} delivered one for ${opponent} against ${moment.teamName ?? "your team"}`;
}

function mergeHighlightsPages(
  pages: ReadonlyArray<TeamHighlightsPayload | null | undefined>,
): TeamHighlightsPayload | null {
  const firstPage = pages.find(
    (page): page is TeamHighlightsPayload => Boolean(page),
  );
  if (!firstPage) {
    return null;
  }

  const items = pages.flatMap((page) => page?.items ?? []);
  const lastPageWithCursor = [...pages]
    .reverse()
    .find((page): page is TeamHighlightsPayload => Boolean(page));

  return {
    ...firstPage,
    items,
    nextCursor: lastPageWithCursor?.nextCursor ?? null,
  };
}

function readQueryError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.trim();
  return message.length ? message : null;
}

function buildMomentDetail(moment: TeamHighlightsMoment): string {
  const action = describeMomentAction(moment);
  const scoreSwing =
    moment.teamScoreBefore !== null &&
    moment.opponentScoreBefore !== null &&
    moment.teamScoreAfter !== null &&
    moment.opponentScoreAfter !== null
      ? `Score swung from ${moment.teamScoreBefore}-${moment.opponentScoreBefore} to ${moment.teamScoreAfter}-${moment.opponentScoreAfter}.`
      : null;
  const comment = moment.comment ? ` ${moment.comment}` : "";

  return [action, scoreSwing, comment.trim()].filter(Boolean).join(" ");
}

function describeMomentAction(moment: TeamHighlightsMoment): string {
  const player = moment.playerName ?? "Unknown player";
  const shotLabel = normalizeShotLabel(moment.shotTypeLabel ?? moment.shotType);

  if (moment.eventKind === "free_throw") {
    return `${player} made a free throw as time expired.`;
  }

  if (shotLabel && typeof moment.shotDistanceFt === "number") {
    return `${player} scored on a ${shotLabel} from ${moment.shotDistanceFt.toFixed(1)} ft as time expired.`;
  }

  if (shotLabel) {
    return `${player} scored on a ${shotLabel} as time expired.`;
  }

  return `${player} scored as time expired.`;
}

function formatMomentMeta(moment: TeamHighlightsMoment): string {
  const parts = [
    moment.startTime ? formatTimestamp(moment.startTime) : null,
    moment.matchType ?? null,
    moment.period ?? null,
    moment.isHome === null
      ? null
      : moment.isHome
        ? "Home"
        : "Away",
    moment.outcomeChanged ? "Outcome changed" : null,
  ].filter(Boolean);

  return parts.join(" | ");
}

export function describeScanStatus(status: TeamHighlightsScanStatus): string {
  const discovered = status.matchesDiscovered ?? 0;
  const completed =
    status.matchesProcessedThisRun ?? status.matchesCompleted ?? 0;
  const failed = status.matchesFailed ?? 0;
  const reused = status.matchesAlreadyRecorded ?? status.matchesReused ?? 0;
  const withMoments = status.matchesWithMoments ?? 0;
  const withoutMoments = status.matchesWithoutMoments ?? 0;
  const momentsWritten = status.momentsWritten ?? 0;
  const brokenMatches = status.brokenMatches ?? [];
  const intro =
    status.status === "COMPLETED_WITH_GAPS" ||
    status.status === "SUCCEEDED" ||
    status.status === "FAILED"
      ? "Scanned"
      : "Scanning";

  if (status.seasonsFrom !== null && status.seasonsTo !== null) {
    const reusedCopy = reused
      ? ` ${reused} game${reused === 1 ? " was" : "s were"} already recorded for this team before this run.`
      : "";
    const completedCopy = completed
      ? ` ${completed} game${completed === 1 ? " was" : "s were"} processed in this run.`
      : "";
    const momentsCopy = momentsWritten
      ? ` ${momentsWritten} moment${momentsWritten === 1 ? " was" : "s were"} written in this run.`
      : "";
    const zeroHitCopy = withoutMoments
      ? ` ${withoutMoments} processed game${withoutMoments === 1 ? " had" : "s had"} no qualifying bb-events buzzerbeaters.`
      : "";
    const withMomentsCopy = withMoments
      ? ` ${withMoments} processed game${withMoments === 1 ? " produced" : "s produced"} at least one saved moment.`
      : "";
    const brokenCopy = brokenMatches.length
      ? ` ${brokenMatches.length} game${brokenMatches.length === 1 ? " could" : "s could"} not be prepared from BuzzerBeater data.`
      : "";
    if (status.status === "WAITING_FOR_MATCH_JOBS") {
      const failureCopy = failed
        ? ` ${failed} submitted job${failed === 1 ? " has" : "s have"} failed.`
        : "";
      return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo}. Found ${discovered} completed games.${reusedCopy}${completedCopy}${withMomentsCopy}${zeroHitCopy}${momentsCopy}${failureCopy} Older clubs can take several minutes.`;
    }

    if (status.status === "FAILED") {
      return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo} before the run failed. Found ${discovered} completed games.${reusedCopy}${completedCopy}${withMomentsCopy}${zeroHitCopy}${momentsCopy}`;
    }

    if (status.status === "COMPLETED_WITH_GAPS") {
      return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo}. Found ${discovered} completed games.${reusedCopy}${completedCopy}${withMomentsCopy}${zeroHitCopy}${momentsCopy}${brokenCopy}`;
    }

    return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo}. Found ${discovered} completed games.${reusedCopy}${completedCopy}${withMomentsCopy}${zeroHitCopy}${momentsCopy} Older clubs can take several minutes.`;
  }

  if (status.status === "WAITING_FOR_MATCH_JOBS") {
    return `Preparing saved moments now. ${completed} game${completed === 1 ? " is" : "s are"} already recorded in this run. Older clubs can take several minutes.`;
  }

  if (status.status === "FAILED") {
    const credentialErrorKind = resolveHighlightsCredentialErrorKind(
      status.errorCode,
      status.error,
    );
    if (credentialErrorKind === "reconnect_required") {
      return "The scan stopped before discovery began because the saved BuzzerBeater credential for this environment can no longer be decrypted.";
    }
    if (credentialErrorKind === "secret_mismatch") {
      return "The scan stopped before discovery began because the saved BuzzerBeater credential was encrypted with a different environment secret.";
    }
    if (credentialErrorKind === "secret_unavailable") {
      return "The scan stopped before discovery began because this environment could not load its BuzzerBeater credential secret.";
    }
    return "The latest team history scan ended before all moments were ready.";
  }

  return "Scanning your club's history and preparing new moments. Older clubs can take several minutes.";
}

function normalizeShotLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replaceAll("_", " ").replace(/^shottype\./i, "").toLowerCase();
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unavailable";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

export function isReconnectRequiredHighlightsError(
  error: string | null | undefined,
  errorCode?: string | null,
): boolean {
  if (
    resolveHighlightsCredentialErrorKind(errorCode ?? null, error) ===
    "reconnect_required"
  ) {
    return true;
  }

  return false;
}

function resolveHighlightsCredentialErrorKind(
  errorCode: string | null | undefined,
  error: string | null | undefined,
): HighlightsCredentialErrorKind | null {
  const normalizedErrorCode = errorCode?.trim().toLowerCase() ?? null;
  if (
    normalizedErrorCode === "reconnect_required" ||
    normalizedErrorCode === "secret_mismatch" ||
    normalizedErrorCode === "secret_unavailable"
  ) {
    return normalizedErrorCode;
  }

  const normalizedError = error?.trim().toLowerCase() ?? "";
  if (
    normalizedError.startsWith(BB_CREDENTIAL_RECONNECT_REQUIRED_PREFIX.toLowerCase())
  ) {
    return "reconnect_required";
  }
  if (
    normalizedError.startsWith(BB_CREDENTIAL_SECRET_MISMATCH_PREFIX.toLowerCase())
  ) {
    return "secret_mismatch";
  }
  return Boolean(
    normalizedError.startsWith(BB_CREDENTIAL_SECRET_UNAVAILABLE_PREFIX.toLowerCase()),
  )
    ? "secret_unavailable"
    : null;
}

function describeHighlightsCredentialRecovery(
  errorKind: HighlightsCredentialErrorKind,
): string {
  if (errorKind === "reconnect_required") {
    return "Reconnect BuzzerBeater in this environment and then rerun the scan.";
  }
  if (errorKind === "secret_mismatch") {
    return "This environment is using a different BB credential secret than the one that encrypted the saved credential. If that rotation was intentional, reconnect BuzzerBeater and rerun the scan. Otherwise, fix the environment secret configuration first.";
  }
  return "This environment can't load its BB credential secret right now. Fix the environment secret configuration and then rerun the scan.";
}

function formatBrokenMatchLabel(
  match: NonNullable<TeamHighlightsScanStatus["brokenMatches"]>[number],
): string {
  const matchup =
    match.homeTeamName && match.awayTeamName
      ? `${match.awayTeamName} at ${match.homeTeamName}`
      : `Match ${match.matchId}`;
  const parts = [
    typeof match.season === "number" ? `Season ${match.season}` : null,
    matchup,
    match.startTime ? formatTimestamp(match.startTime) : null,
  ].filter(Boolean);

  return parts.join(" | ");
}
