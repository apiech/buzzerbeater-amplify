"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  leagueHistoryQueryOptions,
  submitLeagueHistoryBackfillMutation,
} from "@/app/dashboard/workspace-query-client";
import type {
  LeagueHistoryPanelContext,
  LeagueHistoryBackfillStatus,
  LeagueHistoryPayload,
  LeagueHistoryRow,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  TableCell,
  TableHeadCell,
  TableShell,
} from "@/app/ui/primitives/table-shell";

const ACTIVE_BACKFILL_STATES = new Set([
  "FETCHING_STANDINGS",
  "QUEUED",
  "RESOLVING_SEASONS",
]);

const formGridClassName = "grid gap-4 lg:grid-cols-[minmax(0,18rem)_auto]";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const summaryGridClassName = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

type LeagueHistoryPanelProps = {
  context: LeagueHistoryPanelContext;
};

type SortKey =
  | "averageMargin"
  | "games"
  | "losses"
  | "pa"
  | "pf"
  | "pointMargin"
  | "seasons"
  | "teamName"
  | "winPct"
  | "wins";

type SortDirection = "asc" | "desc";

type SortState = {
  direction: SortDirection;
  key: SortKey;
};

const defaultSortState: SortState = {
  direction: "desc",
  key: "wins",
};

export function LeagueHistoryPanel({ context }: LeagueHistoryPanelProps) {
  const defaultLeagueId = context.connection.leagueId ?? null;
  const defaultLeagueName = context.connection.leagueName ?? null;
  const [leagueIdInput, setLeagueIdInput] = useState(defaultLeagueId ?? "");
  const [requestedLeagueId, setRequestedLeagueId] = useState<string | null>(
    defaultLeagueId,
  );
  const [panelError, setPanelError] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>(defaultSortState);
  const submitBackfillMutation = useMutation({
    mutationFn: (leagueId: string | null) =>
      submitLeagueHistoryBackfillMutation(
        leagueId && leagueId !== defaultLeagueId ? { leagueId } : undefined,
      ),
  });
  const historyQuery = useQuery({
    ...leagueHistoryQueryOptions(
      requestedLeagueId && requestedLeagueId !== defaultLeagueId
        ? { leagueId: requestedLeagueId }
        : undefined,
    ),
    enabled: Boolean(requestedLeagueId),
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) =>
      hasActiveLeagueHistoryBackfill(query.state.data?.status ?? null)
        ? 4000
        : false,
  });
  const payload = historyQuery.data ?? null;
  const refetchHistory = historyQuery.refetch;
  const isLoading =
    Boolean(requestedLeagueId) &&
    (historyQuery.isPending || submitBackfillMutation.isPending);
  const isSubmitting = submitBackfillMutation.isPending;
  const submitBackfill = submitBackfillMutation.mutateAsync;

  useEffect(() => {
    if (!requestedLeagueId && defaultLeagueId) {
      setLeagueIdInput(defaultLeagueId);
      setRequestedLeagueId(defaultLeagueId);
    }
  }, [defaultLeagueId, requestedLeagueId]);

  const handleHistoryRefresh = useCallback(async (args: {
    ensureBackfill: boolean;
    leagueId: string | null;
  }): Promise<void> => {
    if (!args.leagueId) {
      return;
    }

    setPanelError(null);

    try {
      if (args.ensureBackfill) {
        await submitBackfill(args.leagueId);
      }
      await refetchHistory();
    } catch (error) {
      setPanelError(readQueryError(error));
    }
  }, [refetchHistory, submitBackfill]);

  useEffect(() => {
    if (!requestedLeagueId) {
      setPanelError(
        "Connect a BuzzerBeater team with a league first, or enter a league ID override.",
      );
      return;
    }

    setSortState(defaultSortState);
    setPanelError(null);
    void handleHistoryRefresh({
      ensureBackfill: true,
      leagueId: requestedLeagueId,
    });
  }, [handleHistoryRefresh, requestedLeagueId]);

  useEffect(() => {
    if (!historyQuery.error) {
      return;
    }
    setPanelError(readQueryError(historyQuery.error));
  }, [historyQuery.error]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLeagueId = normalizeLeagueId(leagueIdInput) ?? defaultLeagueId;
    setRequestedLeagueId(normalizedLeagueId);
    if (normalizedLeagueId) {
      setLeagueIdInput(normalizedLeagueId);
    }
  }

  function handleResetLeague(): void {
    setLeagueIdInput(defaultLeagueId ?? "");
    setRequestedLeagueId(defaultLeagueId);
  }

  function handleSort(nextKey: SortKey): void {
    setSortState((current) => {
      if (current.key === nextKey) {
        return {
          direction: current.direction === "asc" ? "desc" : "asc",
          key: nextKey,
        };
      }

      return {
        direction: nextKey === "teamName" ? "asc" : "desc",
        key: nextKey,
      };
    });
  }

  const rows = sortLeagueHistoryRows(payload?.rows ?? [], sortState);
  const displayRows = canDisplayLeagueHistoryRows(payload) ? rows : [];
  const historyStatus = payload?.status ?? null;
  const effectiveLeagueName =
    payload?.league.name ??
    (requestedLeagueId === defaultLeagueId ? defaultLeagueName : null) ??
    requestedLeagueId ??
    "League history";

  return (
    <Panel>
      <SectionHeading
        actions={
          <>
            <Button
              loading={isLoading && !isSubmitting}
              onClick={() =>
                void handleHistoryRefresh({
                  ensureBackfill: false,
                  leagueId: requestedLeagueId,
                })
              }
              variant="secondary"
            >
              Refresh
            </Button>
            <Button
              loading={isSubmitting}
              onClick={() =>
                void handleHistoryRefresh({
                  ensureBackfill: true,
                  leagueId: requestedLeagueId,
                })
              }
            >
              {historyStatus ? "Scan again" : "Scan history"}
            </Button>
          </>
        }
        description="Totals include stored completed seasons plus the live current standings. Conference history is intentionally ignored in this first version."
        eyebrow="League History"
        title={effectiveLeagueName}
      />

      <form className={formGridClassName} onSubmit={handleSubmit}>
        <Field
          hint={
            defaultLeagueId
              ? `Leave blank to use your connected league (${defaultLeagueId}).`
              : "Enter a league ID to load its historical standings."
          }
          htmlFor="league-history-league-id"
          label="League ID override"
        >
          <Input
            id="league-history-league-id"
            onChange={(event) => setLeagueIdInput(event.target.value)}
            placeholder={defaultLeagueId ?? "League ID"}
            value={leagueIdInput}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Button type="submit" variant="secondary">
            Load league
          </Button>
          <Button
            disabled={!defaultLeagueId}
            onClick={handleResetLeague}
            variant="ghost"
          >
            Use my league
          </Button>
        </div>
      </form>

      {panelError ? <Alert>{panelError}</Alert> : null}
      {payload?.warning ? <Alert>{payload.warning}</Alert> : null}

      <div className={summaryGridClassName}>
        <StatCard
          detail="Completed seasons already stored in the historical cache."
          label="Stored seasons"
          value={payload?.summary.historicalSeasonsStored ?? 0}
        />
        <StatCard
          detail="All teams included in the current aggregate."
          label="Teams"
          value={payload?.summary.totalTeams ?? 0}
        />
        <StatCard
          detail="Live season folded into the table at read time."
          label="Current season"
          value={payload?.summary.currentSeason ?? "N/A"}
        />
      </div>

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading title="Backfill status" titleAs="h4" />
        <p className={statusCopyClassName}>
          {describeLeagueHistoryStatus(historyStatus, {
            isLoading,
            leagueId: requestedLeagueId,
          })}
        </p>
        {historyStatus?.status === "FAILED" ? (
          <div className="flex flex-wrap gap-3">
            <Button
              loading={isSubmitting}
              onClick={() =>
                void handleHistoryRefresh({
                  ensureBackfill: true,
                  leagueId: requestedLeagueId,
                })
              }
            >
              Retry backfill
            </Button>
          </div>
        ) : null}
      </Panel>

      {canDisplayLeagueHistoryRows(payload) ? (
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description="Click a column heading to sort the all-time league table."
            title="All-time standings"
            titleAs="h4"
          />
          <TableShell>
            <thead>
              <tr>
                <SortableHeadCell
                  active={sortState.key === "teamName"}
                  direction={sortState.direction}
                  label="Team"
                  onClick={() => handleSort("teamName")}
                />
                <SortableHeadCell
                  active={sortState.key === "seasons"}
                  direction={sortState.direction}
                  label="Seasons"
                  onClick={() => handleSort("seasons")}
                />
                <SortableHeadCell
                  active={sortState.key === "games"}
                  direction={sortState.direction}
                  label="G"
                  onClick={() => handleSort("games")}
                />
                <SortableHeadCell
                  active={sortState.key === "wins"}
                  direction={sortState.direction}
                  label="W"
                  onClick={() => handleSort("wins")}
                />
                <SortableHeadCell
                  active={sortState.key === "losses"}
                  direction={sortState.direction}
                  label="L"
                  onClick={() => handleSort("losses")}
                />
                <SortableHeadCell
                  active={sortState.key === "winPct"}
                  direction={sortState.direction}
                  label="Win%"
                  onClick={() => handleSort("winPct")}
                />
                <SortableHeadCell
                  active={sortState.key === "pf"}
                  direction={sortState.direction}
                  label="PF"
                  onClick={() => handleSort("pf")}
                />
                <SortableHeadCell
                  active={sortState.key === "pa"}
                  direction={sortState.direction}
                  label="PA"
                  onClick={() => handleSort("pa")}
                />
                <SortableHeadCell
                  active={sortState.key === "pointMargin"}
                  direction={sortState.direction}
                  label="Margin"
                  onClick={() => handleSort("pointMargin")}
                />
                <SortableHeadCell
                  active={sortState.key === "averageMargin"}
                  direction={sortState.direction}
                  label="Avg Margin"
                  onClick={() => handleSort("averageMargin")}
                />
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.teamId}>
                  <TableCell>{row.teamName}</TableCell>
                  <TableCell>{row.seasons}</TableCell>
                  <TableCell>{row.games}</TableCell>
                  <TableCell>{row.wins}</TableCell>
                  <TableCell>{row.losses}</TableCell>
                  <TableCell>{formatPercent(row.winPct)}</TableCell>
                  <TableCell>{row.pf}</TableCell>
                  <TableCell>{row.pa}</TableCell>
                  <TableCell>{formatSignedNumber(row.pointMargin)}</TableCell>
                  <TableCell>{formatSignedFloat(row.averageMargin)}</TableCell>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      ) : (
        <Panel as="article" padding="sm" variant="solid">
          <p className={statusCopyClassName}>
            {describeLeagueHistoryWaitingState(payload, { isLoading })}
          </p>
        </Panel>
      )}
    </Panel>
  );
}

function SortableHeadCell({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: SortDirection;
  label: string;
  onClick: () => void;
}) {
  return (
    <TableHeadCell>
      <button
        className="inline-flex items-center gap-2 text-left text-inherit"
        onClick={onClick}
        type="button"
      >
        <span>{label}</span>
        {active ? <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </TableHeadCell>
  );
}

export function hasActiveLeagueHistoryBackfill(
  status: LeagueHistoryBackfillStatus | null | undefined,
): boolean {
  return Boolean(status && ACTIVE_BACKFILL_STATES.has(status.status));
}

export function canDisplayLeagueHistoryRows(
  payload: LeagueHistoryPayload | null,
): boolean {
  return Boolean(payload && payload.status?.status === "SUCCEEDED");
}

export function describeLeagueHistoryStatus(
  status: LeagueHistoryBackfillStatus | null | undefined,
  options: { isLoading: boolean; leagueId: string | null },
): string {
  if (options.isLoading && !status) {
    return "Loading league history.";
  }

  if (!status) {
    return options.leagueId
      ? `League ${options.leagueId} has not started a historical backfill yet.`
      : "Choose a league to start the historical scan.";
  }

  if (status.status === "QUEUED") {
    return "Historical standings backfill is queued and waiting to start.";
  }

  if (status.status === "RESOLVING_SEASONS") {
    return "Resolving which completed seasons need to be stored for this league.";
  }

  if (status.status === "FETCHING_STANDINGS") {
    const stored = status.historicalSeasonsStored ?? 0;
    const expected = status.historicalSeasonsExpected ?? "?";
    return `Stored ${stored} of ${expected} completed seasons so far.`;
  }

  if (status.status === "FAILED") {
    return status.error
      ? `Historical backfill failed: ${status.error}`
      : "Historical backfill failed before the all-time table was ready.";
  }

  const stored = status.historicalSeasonsStored ?? 0;
  return `Historical backfill is complete. ${stored} completed seasons are cached for this league.`;
}

export function describeLeagueHistoryWaitingState(
  payload: LeagueHistoryPayload | null,
  options: { isLoading: boolean },
): string {
  if (options.isLoading && !payload) {
    return "Loading the league history page.";
  }

  if (hasActiveLeagueHistoryBackfill(payload?.status ?? null)) {
    return "The page will show the all-time table once the full historical backfill finishes.";
  }

  if (payload?.status?.status === "FAILED") {
    return "Retry the backfill to finish storing completed seasons before showing the table.";
  }

  return "No all-time standings are ready yet.";
}

export function sortLeagueHistoryRows(
  rows: readonly LeagueHistoryRow[],
  sort: SortState,
): LeagueHistoryRow[] {
  const multiplier = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const comparison = compareBySortKey(left, right, sort.key);
    if (comparison !== 0) {
      return comparison * multiplier;
    }

    const defaultComparison =
      compareBySortKey(left, right, "wins") * -1 ||
      compareBySortKey(left, right, "winPct") * -1 ||
      compareBySortKey(left, right, "pointMargin") * -1 ||
      compareBySortKey(left, right, "teamName");

    return defaultComparison;
  });
}

function compareBySortKey(
  left: LeagueHistoryRow,
  right: LeagueHistoryRow,
  key: SortKey,
): number {
  if (key === "teamName") {
    return left.teamName.localeCompare(right.teamName);
  }

  return left[key] - right[key];
}

function normalizeLeagueId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function readQueryError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request failed without a detailed error message.";
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function formatSignedFloat(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
