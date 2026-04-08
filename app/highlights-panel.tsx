"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { client } from "@/app/amplify-client";
import type {
  DashboardWorkspace,
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
  workspace: DashboardWorkspace;
};

type HighlightsFilterPerspective = "against" | "both" | "for";

type LoadHighlightsOptions = {
  append?: boolean;
  cursor?: string | null;
  silent?: boolean;
};

const ACTIVE_SCAN_STATUSES = new Set([
  "ENQUEUING_MATCHES",
  "QUEUED",
  "RESOLVING_HISTORY",
  "WAITING_FOR_MATCH_JOBS",
]);
const STALE_SCAN_MILLISECONDS = 15 * 60 * 1000;

export function HighlightsPanel({ workspace }: HighlightsPanelProps) {
  const [perspective, setPerspective] =
    useState<HighlightsFilterPerspective>("both");
  const [onlyOutcomeChange, setOnlyOutcomeChange] = useState(true);
  const [payload, setPayload] = useState<TeamHighlightsPayload | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadHighlightsEffect = useEffectEvent((options: LoadHighlightsOptions = {}) => {
    void loadHighlights(options);
  });

  useEffect(() => {
    loadHighlightsEffect();
  }, [perspective, onlyOutcomeChange]);

  async function loadHighlights(
    options: LoadHighlightsOptions = {},
  ): Promise<void> {
    if (options.append) {
      setIsLoadingMore(true);
    } else if (!options.silent) {
      setIsLoading(true);
    }
    if (!options.silent) {
      setPanelError(null);
    }

    const response = await client.queries.getMyTeamHighlights({
      cursor: options.cursor,
      onlyOutcomeChange,
      perspective: perspective.toUpperCase(),
    });

    if (response.errors?.length || !response.data) {
      setPanelError(formatAmplifyErrors(response.errors));
      if (!options.silent) {
        setIsLoading(false);
      }
      setIsLoadingMore(false);
      return;
    }

    const nextPayload = response.data;
    setPayload((current) => {
      if (!options.append || !current) {
        return nextPayload;
      }

      return {
        ...nextPayload,
        items: [...current.items, ...nextPayload.items],
      };
    });
    if (!options.silent) {
      setIsLoading(false);
    }
    setIsLoadingMore(false);
  }

  async function handleSubmit(): Promise<void> {
    setIsSubmitting(true);
    setPanelError(null);

    const response = await client.mutations.submitMyTeamHighlightsScan();
    if (response.errors?.length || !response.data) {
      setPanelError(formatAmplifyErrors(response.errors));
      setIsSubmitting(false);
      return;
    }

    await loadHighlights();
    setIsSubmitting(false);
  }

  async function handleLoadMore(): Promise<void> {
    if (!payload?.nextCursor) {
      return;
    }

    await loadHighlights({
      append: true,
      cursor: payload.nextCursor,
    });
  }

  const focusTeamName =
    payload?.team.teamName ?? workspace.home.team.teamName ?? "Your club";
  const scanStatus = payload?.scanStatus ?? null;
  const isScanStale = isTeamHighlightsScanStale(scanStatus);
  const hasActiveScan = hasActiveTeamHighlightsScan(scanStatus) && !isScanStale;
  const scanActionLabel = getTeamHighlightsScanActionLabel(scanStatus, {
    hasActiveScan,
    isScanStale,
  });
  const summary = payload?.summary ?? {
    againstMoments: 0,
    filteredMoments: 0,
    forMoments: 0,
    outcomeChangeMoments: 0,
    totalMoments: 0,
  };

  useEffect(() => {
    if (!hasActiveScan) {
      return;
    }

    const intervalId = window.setInterval(() => {
      loadHighlightsEffect({ silent: true });
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasActiveScan]);

  const submittedMatches =
    (scanStatus?.matchesEnqueuedForIngest ?? 0) +
    (scanStatus?.matchesEnqueuedForMaterialize ?? 0);
  const failedMatches = scanStatus?.matchesFailed ?? 0;
  const brokenMatches = scanStatus?.brokenMatches ?? [];
  const hasBrokenMatches = brokenMatches.length > 0;

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            disabled={hasActiveScan}
            loading={isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {scanActionLabel}
          </Button>
        }
        description="Scan your connected club's history for late-game moments and review them from both team perspectives."
        eyebrow="Highlights"
        title="My Team All-time Highlights"
      />

      <p className={statusCopyClassName}>
        Default view keeps the focus on late regulation and overtime swings that
        changed the result for your club.
      </p>

      {panelError ? (
        <Alert>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <p>Couldn&apos;t load the latest moments right now.</p>
              <p className="text-xs leading-5 text-current/80">
                Technical details: {panelError}
              </p>
            </div>
            <Button
              loading={isLoading}
              onClick={() => void loadHighlights()}
              size="sm"
              variant="secondary"
            >
              Try again
            </Button>
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
                  detail="Discovered games that already had moments ready before this run."
                  label="Already ready"
                  value={scanStatus.matchesReused ?? 0}
                />
                <StatCard
                  detail="Discovered games that needed fresh moment preparation in this run."
                  label="Needed work"
                  value={submittedMatches}
                />
                <StatCard
                  detail="Games from this run that already finished preparing moments."
                  label="Prepared this run"
                  value={scanStatus.matchesCompleted ?? 0}
                />
              </div>
              <p className={statusCopyClassName}>
                {describeScanStatus(scanStatus)}
              </p>
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
                      The latest team history scan ended before all moments were
                      ready. Retry it to start a fresh run.
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
    isScanStale: boolean;
  },
): string {
  if (options.hasActiveScan) {
    return "Scan running";
  }

  if (options.isScanStale || status?.status === "FAILED") {
    return "Retry scan";
  }

  if (
    status?.status === "COMPLETED_WITH_GAPS" ||
    status?.status === "SUCCEEDED"
  ) {
    return "Rescan history";
  }

  return "Scan history";
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

  if (hasActiveTeamHighlightsScan(payload.scanStatus)) {
    return "Scanning team history now. Older clubs can take several minutes, and this panel refreshes automatically.";
  }

  if (
    payload.scanStatus.status === "COMPLETED_WITH_GAPS" &&
    (payload.scanStatus.brokenMatches?.length ?? 0) > 0
  ) {
    return "Some games could not be prepared from BuzzerBeater data, but moments are ready for the rest of your history.";
  }

  if (payload.summary.totalMoments > 0) {
    return options.onlyOutcomeChange
      ? "Moments exist for this team, but none match the current outcome-change filter."
      : "Moments exist for this team, but none match the current perspective filter.";
  }

  return "No late-game moments are ready for this team yet.";
}

function buildMomentHeadline(moment: TeamHighlightsMoment): string {
  const player = moment.playerName ?? "Unknown player";
  const opponent = moment.opponentName ?? "Unknown opponent";

  if (moment.perspective === "FOR") {
    return `${player} delivered one against ${opponent}`;
  }

  return `${player} delivered one for ${opponent} against ${moment.teamName ?? "your team"}`;
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
  const completed = status.matchesCompleted ?? 0;
  const failed = status.matchesFailed ?? 0;
  const submitted =
    (status.matchesEnqueuedForIngest ?? 0) +
    (status.matchesEnqueuedForMaterialize ?? 0);
  const reused = status.matchesReused ?? 0;
  const brokenMatches = status.brokenMatches ?? [];
  const intro =
    status.status === "COMPLETED_WITH_GAPS" ||
    status.status === "SUCCEEDED" ||
    status.status === "FAILED"
      ? "Scanned"
      : "Scanning";

  if (status.seasonsFrom !== null && status.seasonsTo !== null) {
    const reusedCopy = reused
      ? ` ${reused} game${reused === 1 ? " was" : "s were"} already ready before this run.`
      : "";
    const submittedCopy = submitted
      ? ` ${submitted} game${submitted === 1 ? " needed" : "s needed"} fresh preparation in this run.`
      : "";
    const completedCopy = completed
      ? ` ${completed} game${completed === 1 ? " finished" : "s finished"} preparing moments${status.status === "WAITING_FOR_MATCH_JOBS" ? " so far" : " in this run"}.`
      : "";
    const brokenCopy = brokenMatches.length
      ? ` ${brokenMatches.length} game${brokenMatches.length === 1 ? " could" : "s could"} not be prepared from BuzzerBeater data.`
      : "";
    if (status.status === "WAITING_FOR_MATCH_JOBS") {
      const failureCopy = failed
        ? ` ${failed} submitted job${failed === 1 ? " has" : "s have"} failed.`
        : "";
      return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo}. Found ${discovered} completed games.${reusedCopy}${submittedCopy}${completedCopy}${failureCopy} Older clubs can take several minutes.`;
    }

    if (status.status === "FAILED") {
      return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo} before the run failed. Found ${discovered} completed games.${reusedCopy}${submittedCopy}${completedCopy}`;
    }

    if (status.status === "COMPLETED_WITH_GAPS") {
      return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo}. Found ${discovered} completed games.${reusedCopy}${submittedCopy}${completedCopy}${brokenCopy}`;
    }

    return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo}. Found ${discovered} completed games.${reusedCopy}${submittedCopy}${completedCopy} Older clubs can take several minutes.`;
  }

  if (status.status === "WAITING_FOR_MATCH_JOBS") {
    return `Preparing moments from ${submitted} submitted match jobs. ${completed} finished so far. Older clubs can take several minutes.`;
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

function formatAmplifyErrors(
  errors: ReadonlyArray<{ message?: string | null }> | null | undefined,
): string {
  const messages = (errors ?? [])
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message));

  return messages[0] ?? "The request failed.";
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
