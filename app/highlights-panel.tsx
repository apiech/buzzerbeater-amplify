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
};

const ACTIVE_SCAN_STATUSES = new Set([
  "ENQUEUING_MATCHES",
  "QUEUED",
  "RESOLVING_HISTORY",
]);

export function HighlightsPanel({ workspace }: HighlightsPanelProps) {
  const [perspective, setPerspective] =
    useState<HighlightsFilterPerspective>("both");
  const [onlyOutcomeChange, setOnlyOutcomeChange] = useState(true);
  const [payload, setPayload] = useState<TeamHighlightsPayload | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadHighlightsEffect = useEffectEvent(() => {
    void loadHighlights();
  });

  useEffect(() => {
    loadHighlightsEffect();
  }, [perspective, onlyOutcomeChange]);

  async function loadHighlights(
    options: LoadHighlightsOptions = {},
  ): Promise<void> {
    if (options.append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setPanelError(null);

    const response = await client.queries.getMyTeamHighlights({
      cursor: options.cursor,
      onlyOutcomeChange,
      perspective: perspective.toUpperCase(),
    });

    if (response.errors?.length || !response.data) {
      setPanelError(formatAmplifyErrors(response.errors));
      setIsLoading(false);
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
    setIsLoading(false);
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
  const summary = payload?.summary ?? {
    againstMoments: 0,
    filteredMoments: 0,
    forMoments: 0,
    outcomeChangeMoments: 0,
    totalMoments: 0,
  };

  return (
    <Panel>
      <SectionHeading
        actions={
          <>
            <Button
              loading={isLoading}
              onClick={() => void loadHighlights()}
              variant="secondary"
            >
              Refresh
            </Button>
            <Button loading={isSubmitting} onClick={() => void handleSubmit()}>
              {scanStatus ? "Scan again" : "Scan history"}
            </Button>
          </>
        }
        description="Scan your connected club's history for late-game moments and review them from both team perspectives."
        eyebrow="Highlights"
        title="My Team All-time Highlights"
      />

      <p className={statusCopyClassName}>
        Default view keeps the focus on late regulation and overtime swings that
        changed the result for your club.
      </p>

      {panelError ? <Alert>{panelError}</Alert> : null}

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
              <div className="grid gap-2 sm:grid-cols-2">
                <StatCard
                  detail="Completed matches found during the history scan."
                  label="Discovered"
                  value={scanStatus.matchesDiscovered ?? 0}
                />
                <StatCard
                  detail="Existing matches that already had moments ready."
                  label="Reused"
                  value={scanStatus.matchesReused ?? 0}
                />
              </div>
              <p className={statusCopyClassName}>
                {describeScanStatus(scanStatus)}
              </p>
              {scanStatus.error ? <Alert>{scanStatus.error}</Alert> : null}
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

export function describeHighlightsEmptyState(
  payload: TeamHighlightsPayload | null,
  options: {
    isLoading: boolean;
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

  if (hasActiveTeamHighlightsScan(payload.scanStatus)) {
    return "Scanning team history now. This list refreshes automatically.";
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
  const reused = status.matchesReused ?? 0;
  const intro =
    status.status === "SUCCEEDED" ? "Scanned" : "Scanning";

  if (status.seasonsFrom !== null && status.seasonsTo !== null) {
    const reusedCopy = reused
      ? ` ${reused} game${reused === 1 ? " was" : "s were"} already ready.`
      : "";
    return `${intro} seasons ${status.seasonsFrom} through ${status.seasonsTo}. Found ${discovered} completed games.${reusedCopy}`;
  }

  return "Scanning your club's history and preparing new moments.";
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
