"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useQueryStates } from "nuqs";
import { useEffect, useMemo, useState } from "react";

import {
  scoutScheduleQueryOptions,
  scoutTeamSummaryQueryOptions,
} from "@/app/dashboard/workspace-query-client";
import { useAuthenticatedWorkspace } from "@/app/dashboard/use-authenticated-workspace";
import type { ScoutWorkspacePayload } from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { SimpleSchedulePanel } from "@/app/workspace/simple/simple-schedule-panel";
import {
  resolveSimpleScoutDefaultTeamId,
  resolveSimpleScoutFilterApplyAction,
  resolveSimpleScoutTeamSelectionAction,
  simpleScoutUrlStateParsers,
} from "@/app/workspace/simple/simple-scout-state";

export function SimpleSchedulePageClient() {
  const {
    connected,
    connectionError,
    isLoadingConnection,
    isLoadingWorkspace,
    workspace,
    workspaceError,
  } = useAuthenticatedWorkspace({
    activeSection: "opponent-schedule",
    commercialModeEnabled: false,
  });
  const home = workspace?.home ?? null;
  const nextOpponentTeamId = home?.nextScoutMatch?.opponentTeamId ?? null;
  const [scoutUrlState, setScoutUrlState] =
    useQueryStates(simpleScoutUrlStateParsers);
  const [scoutTeamDraftId, setScoutTeamDraftId] = useState("");
  const [manualScoutTeamId, setManualScoutTeamId] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);

  const scoutSummaryQuery = useQuery({
    ...scoutTeamSummaryQueryOptions({
      teamId: scoutUrlState.scoutTeam ?? undefined,
    }),
    enabled: connected && Boolean(home),
    placeholderData: (previousData) => previousData,
  });
  const resolvedScoutTeamId =
    scoutUrlState.scoutTeam ??
    scoutSummaryQuery.data?.requestedTeamId ??
    scoutSummaryQuery.data?.teamId ??
    nextOpponentTeamId ??
    null;
  const scoutScheduleQuery = useQuery({
    ...scoutScheduleQueryOptions({
      competitionKeys: scoutUrlState.scoutTypes,
      season: scoutUrlState.scoutSeason,
      teamId: resolvedScoutTeamId,
    }),
    enabled: connected && Boolean(home) && Boolean(resolvedScoutTeamId),
    placeholderData: (previousData) => previousData,
  });
  const scout = useMemo<ScoutWorkspacePayload | null>(() => {
    if (!scoutSummaryQuery.data) {
      return null;
    }

    return {
      ...scoutSummaryQuery.data,
      schedule:
        scoutScheduleQuery.data ?? scoutSummaryQuery.data.schedule ?? null,
    };
  }, [scoutScheduleQuery.data, scoutSummaryQuery.data]);

  useEffect(() => {
    setScoutTeamDraftId(
      resolveSimpleScoutDefaultTeamId({
        nextScoutTeamId: nextOpponentTeamId,
        requestedScoutTeamId: scout?.requestedTeamId ?? null,
        scoutTeamId: scout?.teamId ?? null,
        urlTeamId: scoutUrlState.scoutTeam ?? null,
      }),
    );
  }, [
    nextOpponentTeamId,
    scout?.requestedTeamId,
    scout?.teamId,
    scoutUrlState.scoutTeam,
  ]);

  useEffect(() => {
    setPickerError(null);
  }, [resolvedScoutTeamId]);

  async function handleLoadOpponent() {
    const nextTeamId = manualScoutTeamId.trim() || scoutTeamDraftId;
    if (!nextTeamId) {
      setPickerError("Select an opponent or enter a team ID.");
      return;
    }

    setPickerError(null);

    const action = resolveSimpleScoutTeamSelectionAction({
      nextTeamId,
      resolvedTeamId: resolvedScoutTeamId,
      urlTeamId: scoutUrlState.scoutTeam ?? null,
    });

    if (action.kind === "noop") {
      return;
    }

    if (action.kind === "update-url") {
      await setScoutUrlState(action.nextState);
      return;
    }

    await scoutSummaryQuery.refetch();
    await scoutScheduleQuery.refetch();
  }

  const loading = isLoadingConnection || (connected && !workspace && isLoadingWorkspace);
  const errorMessage =
    pickerError ??
    connectionError ??
    workspaceError ??
    (scoutSummaryQuery.error instanceof Error
      ? scoutSummaryQuery.error.message
      : null) ??
    (scoutScheduleQuery.error instanceof Error
      ? scoutScheduleQuery.error.message
      : null);

  if (loading) {
    return (
      <div className="rounded-lg border border-black/10 bg-white px-4 py-5 text-sm text-ink-muted">
        Loading schedule workspace.
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-black/10 bg-white px-4 py-5 text-sm text-ink">
        Connect your club in{" "}
        <Link className="font-semibold underline" href="/workspace/ops">
          Account
        </Link>{" "}
        to use the simple schedule view.
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="rounded-lg border border-black/10 bg-white px-4 py-5 text-sm text-ink-muted">
        No workspace data is available yet.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {errorMessage ? <Alert>{errorMessage}</Alert> : null}

      <div className="grid gap-3 rounded-lg border border-black/10 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_auto]">
          <Field label="Opponent">
            <Select
              className="rounded-md px-3 py-2 shadow-none"
              onChange={(event) => setScoutTeamDraftId(event.currentTarget.value)}
              value={scoutTeamDraftId}
            >
              <option value="">Select opponent</option>
              {(scout?.availableOpponents ?? []).map((opponent) => (
                <option
                  key={opponent.teamId ?? opponent.teamName ?? "unknown-opponent"}
                  value={opponent.teamId ?? ""}
                >
                  {opponent.teamName ?? "Unknown team"}
                  {typeof opponent.wins === "number" &&
                  typeof opponent.losses === "number"
                    ? ` • ${opponent.wins}-${opponent.losses}`
                    : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Manual team ID">
            <Input
              className="rounded-md px-3 py-2 shadow-none"
              inputMode="numeric"
              onChange={(event) => setManualScoutTeamId(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleLoadOpponent();
                }
              }}
              placeholder="12345"
              value={manualScoutTeamId}
            />
          </Field>

          <div className="flex items-end">
            <Button
              loading={
                scoutSummaryQuery.isFetching || scoutScheduleQuery.isFetching
              }
              onClick={() => void handleLoadOpponent()}
              size="sm"
              variant="secondary"
            >
              Load
            </Button>
          </div>
        </div>

        {scout?.summary?.teamName ? (
          <div className="text-sm text-ink-muted">
            Viewing {scout.summary.teamName}
          </div>
        ) : null}
      </div>

      <SimpleSchedulePanel
        emptyStateMessage={scout?.message ?? undefined}
        isLoading={scoutSummaryQuery.isFetching || scoutScheduleQuery.isFetching}
        onApplyFilters={async (input) => {
          const action = resolveSimpleScoutFilterApplyAction({
            currentCompetitionKeys: scoutUrlState.scoutTypes,
            currentSeason: scoutUrlState.scoutSeason,
            nextCompetitionKeys: input.competitionKeys,
            nextSeason: input.season,
          });

          if (action.kind === "update-url") {
            await setScoutUrlState(action.nextState);
            return;
          }

          await scoutScheduleQuery.refetch();
        }}
        schedule={scout?.schedule}
      />
    </div>
  );
}
