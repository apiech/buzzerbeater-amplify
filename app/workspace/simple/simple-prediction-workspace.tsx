"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  boxscoreQueryOptions,
  predictionMatrixQueryOptions,
  scoutTeamSummaryQueryOptions,
} from "@/app/dashboard/workspace-query-client";
import {
  GAME_PREDICTION_DEFENSE_OPTIONS,
  GAME_PREDICTION_EFFORT_OPTIONS,
  GAME_PREDICTION_OFFENSE_OPTIONS,
  GAME_PREDICTION_VENUE_OPTIONS,
  createBlankPredictionDraft,
  createPredictionSideFromBoxscoreTeam,
  readPredictionDraftFromStorage,
  writePredictionDraftToStorage,
} from "@/app/game-prediction-state";
import type {
  MatchBoxscorePayload,
  MatchSummary,
  PredictionDraft,
  PredictionSideInput,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import {
  applyPredictionSideResolvedTeamName,
  buildPredictionImportMatchOptions,
  buildSimplePredictionRequest,
  commitPredictionSideTeamIdChange,
  describePredictionImportMatchField,
  ensurePredictionImportMatchOption,
  findFirstAvailableResult,
  findMinimaxVisibleResult,
  findSelectedCell,
  formatCellMargin,
  formatCellScoreline,
  formatTacticPairLabel,
  getPredictionCellHeatmapStyle,
  normalizeImportIdentifier,
  normalizePredictionNumber,
  readSimplePredictionErrorMessage,
  resolvePredictionImportTeamLocation,
  resolvePredictionSideRecentMatches,
  sortPairs,
  usesCurrentTeamSchedule,
  type MatrixVisibleResult,
  type SimplePredictionImportMatchOption,
} from "@/app/workspace/simple/simple-prediction-helpers";

type ImportSide = "teamA" | "teamB";

type SimplePredictionWorkspaceProps = {
  currentTeamId: string | null;
  currentTeamName: string | null;
  recentMatches: MatchSummary[];
};

const denseControlClassName = "rounded-md px-3 py-2 shadow-none";

export function SimplePredictionWorkspace({
  currentTeamId,
  currentTeamName,
  recentMatches,
}: SimplePredictionWorkspaceProps) {
  const queryClient = useQueryClient();
  const defaultDraft = useMemo(
    () =>
      createBlankPredictionDraft({
        teamAId: currentTeamId,
        teamAName: currentTeamName ?? "Team A",
      }),
    [currentTeamId, currentTeamName],
  );
  const didRestoreDraftRef = useRef(false);
  const [draft, setDraft] = useState<PredictionDraft>(defaultDraft);
  const [teamATeamIdInput, setTeamATeamIdInput] = useState(
    () => defaultDraft.teamA.teamId ?? "",
  );
  const [teamBTeamIdInput, setTeamBTeamIdInput] = useState(
    () => defaultDraft.teamB.teamId ?? "",
  );
  const [teamAImportMatchId, setTeamAImportMatchId] = useState("");
  const [teamBImportMatchId, setTeamBImportMatchId] = useState("");
  const [teamAManualImportMatchId, setTeamAManualImportMatchId] = useState("");
  const [teamBManualImportMatchId, setTeamBManualImportMatchId] = useState("");
  const [teamAManualImportError, setTeamAManualImportError] = useState<
    string | null
  >(null);
  const [teamBManualImportError, setTeamBManualImportError] = useState<
    string | null
  >(null);
  const [teamAManualImportLoading, setTeamAManualImportLoading] =
    useState(false);
  const [teamBManualImportLoading, setTeamBManualImportLoading] =
    useState(false);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [selectedTeamAPairId, setSelectedTeamAPairId] = useState<string | null>(
    null,
  );
  const [selectedTeamBPairId, setSelectedTeamBPairId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (didRestoreDraftRef.current) {
      return;
    }

    didRestoreDraftRef.current = true;
    const storedDraft = readPredictionDraftFromStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      defaultDraft,
    );
    if (!storedDraft) {
      return;
    }

    setDraft({
      ...storedDraft,
      modelKey: null,
    });
    setTeamATeamIdInput(storedDraft.teamA.teamId ?? "");
    setTeamBTeamIdInput(storedDraft.teamB.teamId ?? "");
    setTeamAImportMatchId(storedDraft.teamA.sourceMatchId ?? "");
    setTeamBImportMatchId(storedDraft.teamB.sourceMatchId ?? "");
  }, [defaultDraft]);

  useEffect(() => {
    writePredictionDraftToStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      {
        ...draft,
        modelKey: null,
      },
    );
  }, [draft]);

  useEffect(() => {
    setDraft((current) =>
      current.modelKey
        ? {
            ...current,
            modelKey: null,
          }
        : current,
    );
  }, []);

  const teamAUsesCurrentTeamSchedule = usesCurrentTeamSchedule({
    currentTeamId,
    sideTeamId: draft.teamA.teamId,
  });
  const teamBUsesCurrentTeamSchedule = usesCurrentTeamSchedule({
    currentTeamId,
    sideTeamId: draft.teamB.teamId,
  });
  const teamAScheduleQuery = useQuery({
    ...scoutTeamSummaryQueryOptions({ teamId: draft.teamA.teamId }),
    enabled: Boolean(draft.teamA.teamId && !teamAUsesCurrentTeamSchedule),
  });
  const teamBScheduleQuery = useQuery({
    ...scoutTeamSummaryQueryOptions({ teamId: draft.teamB.teamId }),
    enabled: Boolean(draft.teamB.teamId && !teamBUsesCurrentTeamSchedule),
  });
  const teamAAutoImportMatches = useMemo(
    () =>
      buildPredictionImportMatchOptions(
        resolvePredictionSideRecentMatches({
          currentTeamId,
          currentTeamRecentMatches: recentMatches,
          scoutRecentMatches:
            teamAScheduleQuery.data?.summary?.recentGames ?? [],
          sideTeamId: draft.teamA.teamId,
        }),
      ),
    [
      currentTeamId,
      draft.teamA.teamId,
      recentMatches,
      teamAScheduleQuery.data?.summary?.recentGames,
    ],
  );
  const teamBAutoImportMatches = useMemo(
    () =>
      buildPredictionImportMatchOptions(
        resolvePredictionSideRecentMatches({
          currentTeamId,
          currentTeamRecentMatches: recentMatches,
          scoutRecentMatches:
            teamBScheduleQuery.data?.summary?.recentGames ?? [],
          sideTeamId: draft.teamB.teamId,
        }),
      ),
    [
      currentTeamId,
      draft.teamB.teamId,
      recentMatches,
      teamBScheduleQuery.data?.summary?.recentGames,
    ],
  );
  const teamAImportQuery = useQuery({
    ...boxscoreQueryOptions({
      matchId: teamAImportMatchId || "",
      preferLive: true,
    }),
    enabled: Boolean(teamAImportMatchId),
  });
  const teamBImportQuery = useQuery({
    ...boxscoreQueryOptions({
      matchId: teamBImportMatchId || "",
      preferLive: true,
    }),
    enabled: Boolean(teamBImportMatchId),
  });
  const teamAImportMatchOptions = useMemo(
    () =>
      ensurePredictionImportMatchOption({
        importMatch: teamAImportQuery.data ?? null,
        importMatchId: teamAImportMatchId,
        options: teamAAutoImportMatches,
      }),
    [teamAAutoImportMatches, teamAImportMatchId, teamAImportQuery.data],
  );
  const teamBImportMatchOptions = useMemo(
    () =>
      ensurePredictionImportMatchOption({
        importMatch: teamBImportQuery.data ?? null,
        importMatchId: teamBImportMatchId,
        options: teamBAutoImportMatches,
      }),
    [teamBAutoImportMatches, teamBImportMatchId, teamBImportQuery.data],
  );
  const teamAImportMatchListState = useMemo(
    () =>
      describePredictionImportMatchField({
        errorMessage: readSimplePredictionErrorMessage(teamAScheduleQuery.error),
        isLoading:
          Boolean(draft.teamA.teamId) &&
          !teamAUsesCurrentTeamSchedule &&
          (teamAScheduleQuery.isPending || teamAScheduleQuery.isFetching),
        options: teamAImportMatchOptions,
        selectedMatchId: teamAImportMatchId,
        teamId: draft.teamA.teamId,
      }),
    [
      draft.teamA.teamId,
      teamAImportMatchId,
      teamAImportMatchOptions,
      teamAScheduleQuery.error,
      teamAScheduleQuery.isFetching,
      teamAScheduleQuery.isPending,
      teamAUsesCurrentTeamSchedule,
    ],
  );
  const teamBImportMatchListState = useMemo(
    () =>
      describePredictionImportMatchField({
        errorMessage: readSimplePredictionErrorMessage(teamBScheduleQuery.error),
        isLoading:
          Boolean(draft.teamB.teamId) &&
          !teamBUsesCurrentTeamSchedule &&
          (teamBScheduleQuery.isPending || teamBScheduleQuery.isFetching),
        options: teamBImportMatchOptions,
        selectedMatchId: teamBImportMatchId,
        teamId: draft.teamB.teamId,
      }),
    [
      draft.teamB.teamId,
      teamBImportMatchId,
      teamBImportMatchOptions,
      teamBScheduleQuery.error,
      teamBScheduleQuery.isFetching,
      teamBScheduleQuery.isPending,
      teamBUsesCurrentTeamSchedule,
    ],
  );
  const matrixMutation = useMutation({
    mutationFn: async (request: PredictionDraft) =>
      queryClient.fetchQuery(predictionMatrixQueryOptions({ request })),
    onError: () => {
      captureAnalyticsEvent("game_prediction_matrix_request_failed", {
        has_team_a_source_match: Boolean(draft.teamA.sourceMatchId),
        has_team_b_source_match: Boolean(draft.teamB.sourceMatchId),
        venue: draft.venue,
      });
    },
    onSuccess: (result, request) => {
      captureAnalyticsEvent("game_prediction_matrix_completed", {
        has_estimated_team_a_pair: result.teamAPairs.some((pair) => pair.estimated),
        has_estimated_team_b_pair: result.teamBPairs.some((pair) => pair.estimated),
        team_a_pair_count: result.teamAPairs.length,
        team_b_pair_count: result.teamBPairs.length,
        venue: request.venue,
        view_count: result.views.length,
      });
    },
  });
  const matrix = matrixMutation.data ?? null;
  const activeView =
    matrix?.views.find((view) => view.viewId === selectedViewId) ??
    matrix?.views[0] ??
    null;
  const teamAPairs = useMemo(
    () => sortPairs(matrix?.teamAPairs ?? []),
    [matrix?.teamAPairs],
  );
  const teamBPairs = useMemo(
    () => sortPairs(matrix?.teamBPairs ?? []),
    [matrix?.teamBPairs],
  );
  const recommendedResult = useMemo(
    () =>
      findMinimaxVisibleResult({
        teamAPairs,
        teamBPairs,
        view: activeView,
      }),
    [activeView, teamAPairs, teamBPairs],
  );
  const selectedTeamAPair = useMemo(
    () => teamAPairs.find((pair) => pair.pairId === selectedTeamAPairId) ?? null,
    [selectedTeamAPairId, teamAPairs],
  );
  const selectedTeamBPair = useMemo(
    () => teamBPairs.find((pair) => pair.pairId === selectedTeamBPairId) ?? null,
    [selectedTeamBPairId, teamBPairs],
  );
  const selectedCell = useMemo(
    () =>
      findSelectedCell({
        teamAPairId: selectedTeamAPairId,
        teamBPairId: selectedTeamBPairId,
        view: activeView,
      }),
    [activeView, selectedTeamAPairId, selectedTeamBPairId],
  );
  const selectedResult = useMemo(
    () =>
      selectedCell && selectedTeamAPair && selectedTeamBPair
        ? {
            cell: selectedCell,
            teamAPair: selectedTeamAPair,
            teamBPair: selectedTeamBPair,
          }
        : null,
    [selectedCell, selectedTeamAPair, selectedTeamBPair],
  );

  useEffect(() => {
    if (!teamAImportMatchId) {
      return;
    }

    const teamLocation = resolvePredictionImportTeamLocation({
      boxscore: teamAImportQuery.data ?? null,
      sideTeamId: draft.teamA.teamId,
    });
    if (!teamLocation || !teamAImportQuery.data) {
      return;
    }

    handleImportTeam("teamA", teamAImportQuery.data, teamLocation);
  }, [draft.teamA.teamId, teamAImportMatchId, teamAImportQuery.data]);

  useEffect(() => {
    if (!teamBImportMatchId) {
      return;
    }

    const teamLocation = resolvePredictionImportTeamLocation({
      boxscore: teamBImportQuery.data ?? null,
      sideTeamId: draft.teamB.teamId,
    });
    if (!teamLocation || !teamBImportQuery.data) {
      return;
    }

    handleImportTeam("teamB", teamBImportQuery.data, teamLocation);
  }, [draft.teamB.teamId, teamBImportMatchId, teamBImportQuery.data]);

  useEffect(() => {
    if (!matrix?.views.length) {
      return;
    }

    setSelectedViewId((current) =>
      current && matrix.views.some((view) => view.viewId === current)
        ? current
        : matrix.views[0]?.viewId ?? null,
    );
  }, [matrix?.views]);

  useEffect(() => {
    if (!activeView) {
      return;
    }

    const existingCell = findSelectedCell({
      teamAPairId: selectedTeamAPairId,
      teamBPairId: selectedTeamBPairId,
      view: activeView,
    });
    if (existingCell) {
      return;
    }

    const nextSelection =
      recommendedResult ??
      findFirstAvailableResult({
        teamAPairs,
        teamBPairs,
        view: activeView,
      });

    if (!nextSelection) {
      setSelectedTeamAPairId(null);
      setSelectedTeamBPairId(null);
      return;
    }

    setSelectedTeamAPairId(nextSelection.teamAPair.pairId);
    setSelectedTeamBPairId(nextSelection.teamBPair.pairId);
  }, [
    activeView,
    recommendedResult,
    selectedTeamAPairId,
    selectedTeamBPairId,
    teamAPairs,
    teamBPairs,
  ]);

  useEffect(() => {
    if (!selectedTeamAPair || !selectedTeamBPair) {
      return;
    }

    setDraft((current) => {
      const matchesSelection =
        current.teamA.offense === selectedTeamAPair.offense &&
        current.teamA.defense === selectedTeamAPair.defense &&
        current.teamB.offense === selectedTeamBPair.offense &&
        current.teamB.defense === selectedTeamBPair.defense;
      if (matchesSelection) {
        return current;
      }

      return {
        ...current,
        teamA: {
          ...current.teamA,
          defense: selectedTeamAPair.defense,
          offense: selectedTeamAPair.offense,
        },
        teamB: {
          ...current.teamB,
          defense: selectedTeamBPair.defense,
          offense: selectedTeamBPair.offense,
        },
      };
    });
  }, [selectedTeamAPair, selectedTeamBPair]);

  function handleImportTeam(
    side: ImportSide,
    boxscore: MatchBoxscorePayload,
    teamLocation: "HOME" | "AWAY",
  ) {
    const team =
      teamLocation === "HOME" ? boxscore.homeTeam : boxscore.awayTeam;
    if (!team) {
      return;
    }

    const importedSide = createPredictionSideFromBoxscoreTeam({
      match: boxscore,
      team,
      teamLocation,
    });

    setDraft((current) => ({
      ...current,
      [side]: importedSide,
    }));

    if (side === "teamA") {
      setTeamATeamIdInput(importedSide.teamId ?? "");
      setTeamAManualImportError(null);
      return;
    }

    setTeamBTeamIdInput(importedSide.teamId ?? "");
    setTeamBManualImportError(null);
  }

  function handleImportMatchSelection(side: ImportSide, value: string) {
    if (side === "teamA") {
      setTeamAImportMatchId(value);
      setTeamAManualImportError(null);
      return;
    }

    setTeamBImportMatchId(value);
    setTeamBManualImportError(null);
  }

  function handleTeamIdCommit(side: ImportSide) {
    const teamIdInput = side === "teamA" ? teamATeamIdInput : teamBTeamIdInput;
    const currentImportMatchId =
      side === "teamA" ? teamAImportMatchId : teamBImportMatchId;
    const currentManualImportMatchId =
      side === "teamA" ? teamAManualImportMatchId : teamBManualImportMatchId;
    const result = commitPredictionSideTeamIdChange({
      currentImportMatchId,
      currentManualImportMatchId,
      draft,
      nextTeamIdInput: teamIdInput,
      side,
    });

    if (side === "teamA") {
      setTeamATeamIdInput(result.committedTeamIdInput);
      if (result.changed) {
        setTeamAImportMatchId(result.nextImportMatchId);
        setTeamAManualImportMatchId(result.nextManualImportMatchId);
        setTeamAManualImportError(null);
      }
    } else {
      setTeamBTeamIdInput(result.committedTeamIdInput);
      if (result.changed) {
        setTeamBImportMatchId(result.nextImportMatchId);
        setTeamBManualImportMatchId(result.nextManualImportMatchId);
        setTeamBManualImportError(null);
      }
    }

    if (result.draft !== draft) {
      setDraft(result.draft);
    }

    const committedTeamId = normalizeImportIdentifier(result.committedTeamIdInput);
    if (!committedTeamId) {
      return;
    }

    const currentDraftSide = result.draft[side];
    if (normalizeImportIdentifier(currentDraftSide.teamId) !== committedTeamId) {
      return;
    }

    const normalizedCurrentTeamId = normalizeImportIdentifier(currentTeamId);
    const normalizedCurrentTeamName = currentTeamName?.trim() || null;

    if (
      normalizedCurrentTeamId === committedTeamId &&
      normalizedCurrentTeamName
    ) {
      setDraft((current) =>
        applyPredictionSideResolvedTeamName({
          draft: current,
          side,
          teamId: committedTeamId,
          teamName: normalizedCurrentTeamName,
        }),
      );
      return;
    }

    void queryClient
      .fetchQuery(
        scoutTeamSummaryQueryOptions({
          teamId: committedTeamId,
        }),
      )
      .then((summary) => {
        const resolvedTeamName = summary?.summary?.teamName?.trim() || null;
        if (!resolvedTeamName) {
          return;
        }

        setDraft((current) =>
          applyPredictionSideResolvedTeamName({
            draft: current,
            side,
            teamId: committedTeamId,
            teamName: resolvedTeamName,
          }),
        );
      })
      .catch(() => undefined);
  }

  async function handleManualImportSubmit(side: ImportSide) {
    const rawMatchId =
      side === "teamA" ? teamAManualImportMatchId : teamBManualImportMatchId;
    const matchId = normalizeImportIdentifier(rawMatchId);
    const setError =
      side === "teamA" ? setTeamAManualImportError : setTeamBManualImportError;
    const setLoading =
      side === "teamA"
        ? setTeamAManualImportLoading
        : setTeamBManualImportLoading;

    if (!matchId) {
      setError("Enter a game ID.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const boxscore = await queryClient.fetchQuery(
        boxscoreQueryOptions({
          matchId,
          preferLive: true,
        }),
      );
      if (!boxscore) {
        throw new Error("That game could not be loaded.");
      }

      if (side === "teamA") {
        setTeamAImportMatchId(matchId);
        setTeamAManualImportMatchId(matchId);
      } else {
        setTeamBImportMatchId(matchId);
        setTeamBManualImportMatchId(matchId);
      }

      const teamLocation = resolvePredictionImportTeamLocation({
        boxscore,
        sideTeamId: side === "teamA" ? draft.teamA.teamId : draft.teamB.teamId,
      });
      if (teamLocation) {
        handleImportTeam(side, boxscore, teamLocation);
      }
    } catch (error) {
      setError(
        readSimplePredictionErrorMessage(error) ??
          "That game could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleRunMatrix() {
    if (matrixMutation.isPending) {
      return;
    }

    captureAnalyticsEvent("game_prediction_matrix_requested", {
      has_team_a_source_match: Boolean(draft.teamA.sourceMatchId),
      has_team_b_source_match: Boolean(draft.teamB.sourceMatchId),
      venue: draft.venue,
    });

    void matrixMutation
      .mutateAsync(buildSimplePredictionRequest(draft))
      .catch(() => undefined);
  }

  function handleReset() {
    const blank = createBlankPredictionDraft({
      teamAId: currentTeamId,
      teamAName: currentTeamName ?? "Team A",
    });

    setDraft(blank);
    setTeamATeamIdInput(blank.teamA.teamId ?? "");
    setTeamBTeamIdInput(blank.teamB.teamId ?? "");
    setTeamAImportMatchId("");
    setTeamBImportMatchId("");
    setTeamAManualImportMatchId("");
    setTeamBManualImportMatchId("");
    setTeamAManualImportError(null);
    setTeamBManualImportError(null);
    setSelectedViewId(null);
    setSelectedTeamAPairId(null);
    setSelectedTeamBPairId(null);
    matrixMutation.reset();
  }

  const selectedTeamALabel = draft.teamA.teamName || "Team A";
  const selectedTeamBLabel = draft.teamB.teamName || "Team B";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 bg-white p-4">
        <Field className="min-w-[12rem]" label="Venue">
          <Select
            className={denseControlClassName}
            onChange={(event) => {
              const venue = event.currentTarget.value as PredictionDraft["venue"];
              setDraft((current) => ({
                ...current,
                venue,
              }));
            }}
            value={draft.venue}
          >
            {GAME_PREDICTION_VENUE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end gap-2">
          <Button onClick={handleReset} size="sm" variant="ghost">
            Start blank
          </Button>
          <Button
            loading={matrixMutation.isPending}
            onClick={handleRunMatrix}
            size="sm"
            variant="secondary"
          >
            Run matrix
          </Button>
        </div>
      </div>

      {matrixMutation.error ? (
        <Alert>{String(matrixMutation.error)}</Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <SimplePredictionSideEditor
          importMatch={teamAImportQuery.data ?? null}
          importMatchError={readSimplePredictionErrorMessage(teamAImportQuery.error)}
          importMatchId={teamAImportMatchId}
          importMatchOptions={teamAImportMatchOptions}
          importMatchLoading={teamAImportQuery.isFetching}
          importMatchPickerError={teamAImportMatchListState.error}
          importMatchPickerHint={teamAImportMatchListState.hint}
          manualImportMatchId={teamAManualImportMatchId}
          manualImportMatchError={teamAManualImportError}
          manualImportMatchLoading={teamAManualImportLoading}
          onImportMatchIdChange={(value) =>
            handleImportMatchSelection("teamA", value)
          }
          onImportTeam={(boxscore, teamLocation) =>
            handleImportTeam("teamA", boxscore, teamLocation)
          }
          onManualImportMatchIdChange={setTeamAManualImportMatchId}
          onManualImportSubmit={() => void handleManualImportSubmit("teamA")}
          onSideChange={(updater) =>
            setDraft((current) => ({ ...current, teamA: updater(current.teamA) }))
          }
          onTeamIdCommit={() => handleTeamIdCommit("teamA")}
          onTeamIdInputChange={setTeamATeamIdInput}
          side={draft.teamA}
          sideLabel="Team A"
          teamIdInput={teamATeamIdInput}
        />

        <SimplePredictionSideEditor
          importMatch={teamBImportQuery.data ?? null}
          importMatchError={readSimplePredictionErrorMessage(teamBImportQuery.error)}
          importMatchId={teamBImportMatchId}
          importMatchOptions={teamBImportMatchOptions}
          importMatchLoading={teamBImportQuery.isFetching}
          importMatchPickerError={teamBImportMatchListState.error}
          importMatchPickerHint={teamBImportMatchListState.hint}
          manualImportMatchId={teamBManualImportMatchId}
          manualImportMatchError={teamBManualImportError}
          manualImportMatchLoading={teamBManualImportLoading}
          onImportMatchIdChange={(value) =>
            handleImportMatchSelection("teamB", value)
          }
          onImportTeam={(boxscore, teamLocation) =>
            handleImportTeam("teamB", boxscore, teamLocation)
          }
          onManualImportMatchIdChange={setTeamBManualImportMatchId}
          onManualImportSubmit={() => void handleManualImportSubmit("teamB")}
          onSideChange={(updater) =>
            setDraft((current) => ({ ...current, teamB: updater(current.teamB) }))
          }
          onTeamIdCommit={() => handleTeamIdCommit("teamB")}
          onTeamIdInputChange={setTeamBTeamIdInput}
          side={draft.teamB}
          sideLabel="Team B"
          teamIdInput={teamBTeamIdInput}
        />
      </div>

      <div className="grid gap-4 rounded-lg border border-black/10 bg-white p-4">
        {!matrix ? (
          <div className="text-sm text-ink-muted">
            Run the matrix to compare every available tactic pair.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {matrix.views.map((view) => (
                  <button
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition",
                      view.viewId === activeView?.viewId
                        ? "bg-ink text-white"
                        : "border border-black/10 bg-white text-ink hover:bg-black/5",
                    )}
                    key={view.viewId}
                    onClick={() => {
                      if (view.viewId === activeView?.viewId) {
                        return;
                      }
                      setSelectedViewId(view.viewId);
                      captureAnalyticsEvent("game_prediction_view_changed", {
                        next_view_id: view.viewId,
                        next_view_label: view.label,
                      });
                    }}
                    type="button"
                  >
                    {view.label}
                  </button>
                ))}
              </div>

              <div className="text-sm text-ink-muted">
                {teamAPairs.length} x {teamBPairs.length} pairs
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SimpleMatrixResultCard
                label="Best worst-case"
                result={recommendedResult}
                teamALabel={selectedTeamALabel}
                teamBLabel={selectedTeamBLabel}
              />
              <SimpleMatrixResultCard
                label="Selected"
                result={selectedResult}
                teamALabel={selectedTeamALabel}
                teamBLabel={selectedTeamBLabel}
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-black/10">
              <table className="w-full min-w-[58rem] border-collapse text-left">
                <thead>
                  <tr className="bg-[rgba(15,23,42,0.03)]">
                    <MatrixHead sticky>{selectedTeamALabel}</MatrixHead>
                    {teamBPairs.map((pair) => (
                      <MatrixHead key={pair.pairId}>
                        <div className="grid gap-0.5">
                          <span>{pair.offense}</span>
                          <span className="font-normal text-ink-muted">
                            {pair.defense}
                          </span>
                        </div>
                      </MatrixHead>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamAPairs.map((teamAPair) => (
                    <tr className="border-t border-black/8" key={teamAPair.pairId}>
                      <MatrixRowLabel>
                        <div className="grid gap-0.5">
                          <span>{teamAPair.offense}</span>
                          <span className="font-normal text-ink-muted">
                            {teamAPair.defense}
                          </span>
                        </div>
                      </MatrixRowLabel>
                      {teamBPairs.map((teamBPair) => {
                        const cell =
                          activeView?.rows
                            .find((row) => row.teamBPairId === teamBPair.pairId)
                            ?.cells.find(
                              (candidate) =>
                                candidate.teamAPairId === teamAPair.pairId,
                            ) ?? null;
                        const selected =
                          teamAPair.pairId === selectedTeamAPairId &&
                          teamBPair.pairId === selectedTeamBPairId;
                        const recommended =
                          recommendedResult?.teamAPair.pairId ===
                            teamAPair.pairId &&
                          recommendedResult.teamBPair.pairId === teamBPair.pairId;

                        return (
                          <td className="px-1.5 py-1.5" key={teamBPair.pairId}>
                            <button
                              className={cn(
                                "relative flex min-h-[3.25rem] w-full items-center justify-center rounded-md border px-2 py-2 text-sm font-semibold text-ink transition hover:brightness-[0.98]",
                                selected && "ring-2 ring-accent/35",
                              )}
                              onClick={() => {
                                setSelectedTeamAPairId(teamAPair.pairId);
                                setSelectedTeamBPairId(teamBPair.pairId);
                              }}
                              style={getPredictionCellHeatmapStyle(cell)}
                              type="button"
                            >
                              {recommended ? (
                                <span className="absolute left-1 top-1 rounded bg-white/80 px-1 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                  Best
                                </span>
                              ) : null}
                              {formatCellMargin(cell)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type SimplePredictionSideEditorProps = {
  importMatch: MatchBoxscorePayload | null;
  importMatchError: string | null;
  importMatchId: string;
  importMatchOptions: readonly SimplePredictionImportMatchOption[];
  importMatchLoading: boolean;
  importMatchPickerError: string | null;
  importMatchPickerHint: string;
  manualImportMatchId: string;
  manualImportMatchError: string | null;
  manualImportMatchLoading: boolean;
  onImportMatchIdChange: (value: string) => void;
  onImportTeam: (
    boxscore: MatchBoxscorePayload,
    teamLocation: "HOME" | "AWAY",
  ) => void;
  onManualImportMatchIdChange: (value: string) => void;
  onManualImportSubmit: () => void;
  onSideChange: (
    updater: (current: PredictionSideInput) => PredictionSideInput,
  ) => void;
  onTeamIdCommit: () => void;
  onTeamIdInputChange: (value: string) => void;
  side: PredictionSideInput;
  sideLabel: string;
  teamIdInput: string;
};

function SimplePredictionSideEditor({
  importMatch,
  importMatchError,
  importMatchId,
  importMatchOptions,
  importMatchLoading,
  importMatchPickerError,
  importMatchPickerHint,
  manualImportMatchId,
  manualImportMatchError,
  manualImportMatchLoading,
  onImportMatchIdChange,
  onImportTeam,
  onManualImportMatchIdChange,
  onManualImportSubmit,
  onSideChange,
  onTeamIdCommit,
  onTeamIdInputChange,
  side,
  sideLabel,
  teamIdInput,
}: SimplePredictionSideEditorProps) {
  return (
    <div className="grid gap-3 rounded-lg border border-black/10 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">
          {sideLabel}: {side.teamName || sideLabel}
        </div>
        {side.sourceLabel ? (
          <div className="text-xs text-ink-muted">{side.sourceLabel}</div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <Input
            className={denseControlClassName}
            onChange={(event) => {
              const teamName = event.currentTarget.value;
              onSideChange((current) => ({
                ...current,
                teamName,
              }));
            }}
            value={side.teamName}
          />
        </Field>

        <Field label="Team ID">
          <Input
            className={denseControlClassName}
            onBlur={onTeamIdCommit}
            onChange={(event) => onTeamIdInputChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }

              event.preventDefault();
              onTeamIdCommit();
            }}
            value={teamIdInput}
          />
        </Field>

        <Field
          error={importMatchPickerError}
          hint={importMatchPickerHint}
          label="Recent boxscore"
        >
          <Select
            className={denseControlClassName}
            disabled={!importMatchOptions.length}
            onChange={(event) => onImportMatchIdChange(event.currentTarget.value)}
            value={importMatchId}
          >
            <option value="">No import selected</option>
            {importMatchOptions.map((match) => (
              <option key={match.matchId} value={match.matchId}>
                {match.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field error={manualImportMatchError} label="Game ID">
          <div className="flex gap-2">
            <Input
              className={denseControlClassName}
              onChange={(event) =>
                onManualImportMatchIdChange(event.currentTarget.value)
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                onManualImportSubmit();
              }}
              placeholder="123456789"
              value={manualImportMatchId}
            />
            <Button
              loading={manualImportMatchLoading}
              onClick={onManualImportSubmit}
              size="sm"
              variant="secondary"
            >
              Load
            </Button>
          </div>
        </Field>
      </div>

      {importMatchId ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-black/10 bg-[rgba(15,23,42,0.02)] p-3">
          {importMatchLoading ? (
            <span className="text-sm text-ink-muted">Loading match.</span>
          ) : importMatchError ? (
            <span className="text-sm text-accent-strong">{importMatchError}</span>
          ) : importMatch ? (
            <>
              {importMatch.homeTeam ? (
                <Button
                  onClick={() => onImportTeam(importMatch, "HOME")}
                  size="sm"
                  variant="secondary"
                >
                  Use {importMatch.homeTeam.teamName ?? "Home"}
                </Button>
              ) : null}
              {importMatch.awayTeam ? (
                <Button
                  onClick={() => onImportTeam(importMatch, "AWAY")}
                  size="sm"
                  variant="secondary"
                >
                  Use {importMatch.awayTeam.teamName ?? "Away"}
                </Button>
              ) : null}
            </>
          ) : (
            <span className="text-sm text-ink-muted">Match unavailable.</span>
          )}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Offense">
          <Select
            className={denseControlClassName}
            onChange={(event) => {
              const offense = event.currentTarget.value;
              onSideChange((current) => ({
                ...current,
                offense,
              }));
            }}
            value={side.offense}
          >
            {GAME_PREDICTION_OFFENSE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Defense">
          <Select
            className={denseControlClassName}
            onChange={(event) => {
              const defense = event.currentTarget.value;
              onSideChange((current) => ({
                ...current,
                defense,
              }));
            }}
            value={side.defense}
          >
            {GAME_PREDICTION_DEFENSE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Effort">
          <Select
            className={denseControlClassName}
            onChange={(event) => {
              const effortChoice = event.currentTarget.value;
              onSideChange((current) => ({
                ...current,
                effortChoice,
              }));
            }}
            value={side.effortChoice}
          >
            {GAME_PREDICTION_EFFORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="GDP focus">
          <Input
            className={denseControlClassName}
            onChange={(event) => {
              const gdpFocus = event.currentTarget.value;
              onSideChange((current) => ({
                ...current,
                gdpFocus,
              }));
            }}
            value={side.gdpFocus}
          />
        </Field>

        <Field label="GDP pace">
          <Input
            className={denseControlClassName}
            onChange={(event) => {
              const gdpPace = event.currentTarget.value;
              onSideChange((current) => ({
                ...current,
                gdpPace,
              }));
            }}
            value={side.gdpPace}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <RatingField
          label="Outside scoring"
          onChange={(value) =>
            onSideChange((current) => ({
              ...current,
              ratings: {
                ...current.ratings,
                outsideScoring: normalizePredictionNumber(
                  value,
                  current.ratings.outsideScoring,
                ),
              },
            }))
          }
          value={side.ratings.outsideScoring}
        />
        <RatingField
          label="Inside scoring"
          onChange={(value) =>
            onSideChange((current) => ({
              ...current,
              ratings: {
                ...current.ratings,
                insideScoring: normalizePredictionNumber(
                  value,
                  current.ratings.insideScoring,
                ),
              },
            }))
          }
          value={side.ratings.insideScoring}
        />
        <RatingField
          label="Outside defense"
          onChange={(value) =>
            onSideChange((current) => ({
              ...current,
              ratings: {
                ...current.ratings,
                outsideDefense: normalizePredictionNumber(
                  value,
                  current.ratings.outsideDefense,
                ),
              },
            }))
          }
          value={side.ratings.outsideDefense}
        />
        <RatingField
          label="Inside defense"
          onChange={(value) =>
            onSideChange((current) => ({
              ...current,
              ratings: {
                ...current.ratings,
                insideDefense: normalizePredictionNumber(
                  value,
                  current.ratings.insideDefense,
                ),
              },
            }))
          }
          value={side.ratings.insideDefense}
        />
        <RatingField
          label="Rebounding"
          onChange={(value) =>
            onSideChange((current) => ({
              ...current,
              ratings: {
                ...current.ratings,
                rebounding: normalizePredictionNumber(
                  value,
                  current.ratings.rebounding,
                ),
              },
            }))
          }
          value={side.ratings.rebounding}
        />
        <RatingField
          label="Offensive flow"
          onChange={(value) =>
            onSideChange((current) => ({
              ...current,
              ratings: {
                ...current.ratings,
                offensiveFlow: normalizePredictionNumber(
                  value,
                  current.ratings.offensiveFlow,
                ),
              },
            }))
          }
          value={side.ratings.offensiveFlow}
        />
      </div>
    </div>
  );
}

function RatingField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: number;
}) {
  return (
    <Field label={label}>
      <Input
        className={denseControlClassName}
        inputMode="decimal"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={String(value)}
      />
    </Field>
  );
}

function SimpleMatrixResultCard({
  label,
  result,
  teamALabel,
  teamBLabel,
}: {
  label: string;
  result: MatrixVisibleResult | null;
  teamALabel: string;
  teamBLabel: string;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-[rgba(15,23,42,0.02)] p-3">
      <div className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </div>
      {result ? (
        <div className="mt-2 grid gap-1 text-sm">
          <div className="font-semibold text-ink">
            {formatCellMargin(result.cell)}
          </div>
          <div className="text-ink-muted">
            {teamALabel}: {formatTacticPairLabel(result.teamAPair)}
          </div>
          <div className="text-ink-muted">
            {teamBLabel}: {formatTacticPairLabel(result.teamBPair)}
          </div>
          <div className="text-ink-muted">
            {formatCellScoreline(result.cell, teamALabel, teamBLabel)}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-sm text-ink-muted">Unavailable</div>
      )}
    </div>
  );
}

function MatrixHead({
  children,
  sticky = false,
}: {
  children: React.ReactNode;
  sticky?: boolean;
}) {
  return (
    <th
      className={cn(
        "px-2 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted",
        sticky && "sticky left-0 bg-[rgba(245,243,238,0.98)]",
      )}
    >
      {children}
    </th>
  );
}

function MatrixRowLabel({ children }: { children: React.ReactNode }) {
  return (
    <th className="sticky left-0 bg-white px-2 py-2 text-sm font-semibold text-ink shadow-[1px_0_0_rgba(15,23,42,0.06)]">
      {children}
    </th>
  );
}
