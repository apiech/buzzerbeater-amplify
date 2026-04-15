"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

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
  formatPredictionVenueLabel,
  readPredictionDraftFromStorage,
  writePredictionDraftToStorage,
} from "@/app/game-prediction-state";
import {
  PredictionModelMetadata,
  PredictionModelPicker,
} from "@/app/prediction-model-controls";
import { useRuntimeEnvironment } from "@/app/runtime-environment";
import type {
  MatchBoxscorePayload,
  MatchSummary,
  PredictionDraft,
  PredictionMatrixCell,
  PredictionMatrixResult,
  PredictionMatrixTacticPair,
  PredictionMatrixView,
  PredictionSideInput,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { isInternalPredictionModelPickerEnabled } from "@/lib/prediction/model-selection";

type GamePredictionPanelProps = {
  currentTeamId: string | null;
  currentTeamName: string | null;
  recentMatches: MatchSummary[];
};

type ImportSide = "teamA" | "teamB";
type PredictionMatrixMode = "overview" | "advanced";
type PredictionImportMatchOption = {
  label: string;
  matchId: string;
};

const ratingGridClassName = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
const MATRIX_CELL_HEATMAP_MAX_ABS_MARGIN = 20;
const MATRIX_MATCHUP_COLUMN_WIDTH_CLASS = "w-[4.9rem] min-w-[4.9rem] max-w-[4.9rem]";
const MATRIX_ROW_HEADER_WIDTH_CLASS = "w-[9.25rem] min-w-[9.25rem] max-w-[9.25rem]";
const MATRIX_CELL_CLASS = "border-b border-black/10 p-1 align-top";
const MATRIX_CELL_BUTTON_CLASS =
  "relative flex min-h-[3.35rem] w-full items-center justify-center rounded-[0.8rem] border px-2 py-2 text-center transition";
const MATRIX_CELL_BADGE_ROW_CLASS =
  "pointer-events-none absolute inset-x-1 top-1 flex flex-wrap justify-center gap-1";
const MATRIX_OFFENSE_SORT_ORDER = [
  "Base Offense",
  "Push the Ball",
  "Patient",
  "Look Inside",
  "Low Post",
  "Run and Gun",
  "Motion",
  "Princeton",
  "Outside Isolation",
  "Inside Isolation",
] as const;
const MATRIX_DEFENSE_SORT_ORDER = [
  "Man to Man",
  "3-2 Zone",
  "1-3-1 Zone",
  "2-3 Zone",
  "Outside Box + 1",
  "Inside Box + 1",
  "Full Court Press",
] as const;

const MATRIX_OFFENSE_ABBREVIATIONS: Record<string, string> = {
  "Base Offense": "Base",
  "Inside Isolation": "II",
  "Look Inside": "LI",
  "Low Post": "LP",
  "Motion": "Mot",
  "Outside Isolation": "OI",
  "Patient": "Pat",
  "Princeton": "Prc",
  "Push the Ball": "PtB",
  "Run and Gun": "RnG",
};

const MATRIX_DEFENSE_ABBREVIATIONS: Record<string, string> = {
  "1-3-1 Zone": "1-3-1",
  "2-3 Zone": "2-3",
  "3-2 Zone": "3-2",
  "Full Court Press": "FCP",
  "Inside Box + 1": "IBox",
  "Man to Man": "M2M",
  "Man to man": "M2M",
  "Outside Box + 1": "OBox",
};
const MATRIX_DEFENSE_CANONICAL_LABELS: Record<string, string> = {
  "Man to man": "Man to Man",
};

export function GamePredictionPanel({
  currentTeamId,
  currentTeamName,
  recentMatches,
}: GamePredictionPanelProps) {
  const queryClient = useQueryClient();
  const { environmentName } = useRuntimeEnvironment();
  const modelPickerEnabled =
    isInternalPredictionModelPickerEnabled(environmentName);
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
  const [teamAManualImportLoading, setTeamAManualImportLoading] = useState(false);
  const [teamBManualImportLoading, setTeamBManualImportLoading] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [selectedTeamAPairId, setSelectedTeamAPairId] = useState<string | null>(
    null,
  );
  const [selectedTeamBPairId, setSelectedTeamBPairId] = useState<string | null>(
    null,
  );
  const [expandedTeamAOffenses, setExpandedTeamAOffenses] = useState<string[]>(
    [],
  );
  const [enabledTeamADefenses, setEnabledTeamADefenses] = useState<string[]>([]);
  const [expandedTeamBOffenses, setExpandedTeamBOffenses] = useState<string[]>(
    [],
  );
  const [enabledTeamBDefenses, setEnabledTeamBDefenses] = useState<string[]>([]);
  const [matrixMode, setMatrixMode] = useState<PredictionMatrixMode>("overview");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showDefenseDrilldown, setShowDefenseDrilldown] = useState(false);
  const [showExtremes, setShowExtremes] = useState(false);
  const applyImportMatchIfResolvable = useEffectEvent(
    (args: {
      boxscore: MatchBoxscorePayload | null;
      side: ImportSide;
      sideTeamId: string | null;
    }) => {
      const teamLocation = resolvePredictionImportTeamLocation({
        boxscore: args.boxscore,
        sideTeamId: args.sideTeamId,
      });
      if (!teamLocation || !args.boxscore) {
        return;
      }

      handleImportTeam(args.side, args.boxscore, teamLocation);
    },
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
    if (storedDraft) {
      setDraft(storedDraft);
      setTeamATeamIdInput(storedDraft.teamA.teamId ?? "");
      setTeamBTeamIdInput(storedDraft.teamB.teamId ?? "");
      setTeamAImportMatchId(storedDraft.teamA.sourceMatchId ?? "");
      setTeamBImportMatchId(storedDraft.teamB.sourceMatchId ?? "");
      return;
    }

    setDraft(defaultDraft);
    setTeamATeamIdInput(defaultDraft.teamA.teamId ?? "");
    setTeamBTeamIdInput(defaultDraft.teamB.teamId ?? "");
  }, [defaultDraft]);

  useEffect(() => {
    writePredictionDraftToStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      draft,
    );
  }, [draft]);

  useEffect(() => {
    if (modelPickerEnabled) {
      return;
    }

    setDraft((current) =>
      current.modelKey
        ? {
            ...current,
            modelKey: null,
          }
        : current,
    );
  }, [modelPickerEnabled]);

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

  useEffect(() => {
    if (!teamAImportMatchId) {
      return;
    }

    applyImportMatchIfResolvable({
      boxscore: teamAImportQuery.data ?? null,
      side: "teamA",
      sideTeamId: draft.teamA.teamId,
    });
  }, [draft.teamA.teamId, teamAImportMatchId, teamAImportQuery.data]);

  useEffect(() => {
    if (!teamBImportMatchId) {
      return;
    }

    applyImportMatchIfResolvable({
      boxscore: teamBImportQuery.data ?? null,
      side: "teamB",
      sideTeamId: draft.teamB.teamId,
    });
  }, [draft.teamB.teamId, teamBImportMatchId, teamBImportQuery.data]);

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
        errorMessage: readClientSideErrorMessage(teamAScheduleQuery.error),
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
        errorMessage: readClientSideErrorMessage(teamBScheduleQuery.error),
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
  const teamAOffenseOptions = useMemo(
    () => listUniquePairOffenses(matrix?.teamAPairs ?? []),
    [matrix?.teamAPairs],
  );
  const teamADefenseOptions = useMemo(
    () => listUniquePairDefenses(matrix?.teamAPairs ?? []),
    [matrix?.teamAPairs],
  );
  const teamBOffenseOptions = useMemo(
    () => listUniquePairOffenses(matrix?.teamBPairs ?? []),
    [matrix?.teamBPairs],
  );
  const teamBDefenseOptions = useMemo(
    () => listUniquePairDefenses(matrix?.teamBPairs ?? []),
    [matrix?.teamBPairs],
  );
  const filteredTeamAPairs = useMemo(
    () =>
      filterPairsByDefenses({
        enabledDefenses: enabledTeamADefenses,
        pairs: matrix?.teamAPairs ?? [],
      }),
    [enabledTeamADefenses, matrix?.teamAPairs],
  );
  const filteredTeamBPairs = useMemo(
    () =>
      filterPairsByDefenses({
        enabledDefenses: enabledTeamBDefenses,
        pairs: matrix?.teamBPairs ?? [],
      }),
    [enabledTeamBDefenses, matrix?.teamBPairs],
  );
  const teamARowGroups = useMemo(
    () =>
      buildOffenseGroups({
        expandedOffenses: expandedTeamAOffenses,
        pairs: filteredTeamAPairs,
      }),
    [expandedTeamAOffenses, filteredTeamAPairs],
  );
  const teamBColumnGroups = useMemo(
    () =>
      buildOffenseGroups({
        expandedOffenses: expandedTeamBOffenses,
        pairs: filteredTeamBPairs,
      }),
    [expandedTeamBOffenses, filteredTeamBPairs],
  );
  const visibleAdvancedTeamARowGroups = useMemo(
    () => listExpandedOffenseGroups(teamARowGroups),
    [teamARowGroups],
  );
  const visibleAdvancedTeamBColumnGroups = useMemo(
    () => listExpandedOffenseGroups(teamBColumnGroups),
    [teamBColumnGroups],
  );
  const visibleTeamAPairs = useMemo(
    () =>
      sortPairs(
        teamARowGroups.flatMap((group) => (group.expanded ? group.pairs : [])),
      ),
    [teamARowGroups],
  );
  const visibleTeamBPairs = useMemo(
    () =>
      sortPairs(
        teamBColumnGroups.flatMap((group) => (group.expanded ? group.pairs : [])),
      ),
    [teamBColumnGroups],
  );
  const visibleTeamAPairIds = useMemo(
    () => new Set(visibleTeamAPairs.map((pair) => pair.pairId)),
    [visibleTeamAPairs],
  );
  const visibleTeamBPairIds = useMemo(
    () => new Set(visibleTeamBPairs.map((pair) => pair.pairId)),
    [visibleTeamBPairs],
  );
  const renderedColumnCount = useMemo(
    () => Math.max(countExpandedGroupPairs(visibleAdvancedTeamBColumnGroups), 1),
    [visibleAdvancedTeamBColumnGroups],
  );
  const activeViewRowsByTeamBPairId = useMemo(
    () => new Map((activeView?.rows ?? []).map((row) => [row.teamBPairId, row] as const)),
    [activeView],
  );
  const matrixSurfaceVisibility = useMemo(
    () => resolvePredictionMatrixSurfaceVisibility(matrixMode),
    [matrixMode],
  );

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
    if (!matrix) {
      return;
    }
    setSelectedTeamAPairId(null);
    setSelectedTeamBPairId(null);
    setMatrixMode("overview");
  }, [matrix]);

  useEffect(() => {
    setExpandedTeamAOffenses((current) =>
      reconcileSelectedOptions(current, teamAOffenseOptions),
    );
    setEnabledTeamADefenses((current) =>
      reconcileSelectedDefenseOptions(current, teamADefenseOptions),
    );
  }, [teamADefenseOptions, teamAOffenseOptions]);

  useEffect(() => {
    setExpandedTeamBOffenses((current) =>
      reconcileSelectedOptions(current, teamBOffenseOptions),
    );
    setEnabledTeamBDefenses((current) =>
      reconcileSelectedDefenseOptions(current, teamBDefenseOptions),
    );
  }, [teamBDefenseOptions, teamBOffenseOptions]);

  const bestResult = useMemo(
    () =>
      findExtremeVisibleCell({
        comparator: (candidate, current) => candidate > current,
        teamAPairIds: visibleTeamAPairIds,
        teamBPairIds: visibleTeamBPairIds,
        teamAPairs: visibleTeamAPairs,
        teamBPairs: visibleTeamBPairs,
        view: activeView,
      }),
    [activeView, visibleTeamAPairIds, visibleTeamAPairs, visibleTeamBPairIds, visibleTeamBPairs],
  );
  const worstResult = useMemo(
    () =>
      findExtremeVisibleCell({
        comparator: (candidate, current) => candidate < current,
        teamAPairIds: visibleTeamAPairIds,
        teamBPairIds: visibleTeamBPairIds,
        teamAPairs: visibleTeamAPairs,
        teamBPairs: visibleTeamBPairs,
        view: activeView,
      }),
    [activeView, visibleTeamAPairIds, visibleTeamAPairs, visibleTeamBPairIds, visibleTeamBPairs],
  );
  const selectedTeamALabel = draft.teamA.teamName || "Team A";
  const selectedTeamBLabel = draft.teamB.teamName || "Team B";
  const selectedTeamAPair = useMemo(
    () =>
      matrix?.teamAPairs.find((pair) => pair.pairId === selectedTeamAPairId) ??
      null,
    [matrix?.teamAPairs, selectedTeamAPairId],
  );
  const selectedTeamBPair = useMemo(
    () =>
      matrix?.teamBPairs.find((pair) => pair.pairId === selectedTeamBPairId) ??
      null,
    [matrix?.teamBPairs, selectedTeamBPairId],
  );
  const recommendedResult = useMemo(
    () =>
      findMinimaxVisibleResult({
        teamAPairs: visibleTeamAPairs,
        teamBPairs: visibleTeamBPairs,
        view: activeView,
      }),
    [activeView, visibleTeamAPairs, visibleTeamBPairs],
  );

  useEffect(() => {
    const nextSelection = resolveVisibleSelection({
      currentTeamAPairId: selectedTeamAPairId,
      currentTeamBPairId: selectedTeamBPairId,
      recommendedTeamAPairId: recommendedResult?.teamAPair.pairId ?? null,
      recommendedTeamBPairId: recommendedResult?.teamBPair.pairId ?? null,
      teamAPairs: visibleTeamAPairs,
      teamBPairs: visibleTeamBPairs,
      view: activeView,
    });
    if (!nextSelection) {
      if (selectedTeamAPairId !== null) {
        setSelectedTeamAPairId(null);
      }
      if (selectedTeamBPairId !== null) {
        setSelectedTeamBPairId(null);
      }
      return;
    }
    if (nextSelection.teamAPairId !== selectedTeamAPairId) {
      setSelectedTeamAPairId(nextSelection.teamAPairId);
    }
    if (nextSelection.teamBPairId !== selectedTeamBPairId) {
      setSelectedTeamBPairId(nextSelection.teamBPairId);
    }
  }, [
    activeView,
    recommendedResult,
    selectedTeamAPairId,
    selectedTeamBPairId,
    visibleTeamAPairs,
    visibleTeamBPairs,
  ]);

  useEffect(() => {
    if (!selectedTeamAPair || !selectedTeamBPair) {
      return;
    }

    setDraft((current) => {
      const teamAMatches =
        current.teamA.offense === selectedTeamAPair.offense &&
        current.teamA.defense === selectedTeamAPair.defense;
      const teamBMatches =
        current.teamB.offense === selectedTeamBPair.offense &&
        current.teamB.defense === selectedTeamBPair.defense;
      if (teamAMatches && teamBMatches) {
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
  const offenseOverviewRows = useMemo(
    () =>
      buildOffenseOverviewRows({
        teamAPairs: visibleTeamAPairs,
        teamBPairs: visibleTeamBPairs,
        view: activeView,
      }),
    [activeView, visibleTeamAPairs, visibleTeamBPairs],
  );
  const selectedOverviewCell = useMemo(
    () =>
      findOffenseOverviewCell({
        rows: offenseOverviewRows,
        teamAOffense:
          selectedResult?.teamAPair.offense ??
          recommendedResult?.teamAPair.offense ??
          null,
        teamBOffense:
          selectedResult?.teamBPair.offense ??
          recommendedResult?.teamBPair.offense ??
          null,
      }),
    [offenseOverviewRows, recommendedResult, selectedResult],
  );
  const recommendedOverviewCell = useMemo(
    () =>
      findOffenseOverviewCell({
        rows: offenseOverviewRows,
        teamAOffense: recommendedResult?.teamAPair.offense ?? null,
        teamBOffense: recommendedResult?.teamBPair.offense ?? null,
      }),
    [offenseOverviewRows, recommendedResult],
  );
  const selectedOverviewResult = selectedOverviewCell?.result ?? null;
  const selectedOverviewTeamAPairs = selectedOverviewCell?.teamAPairs ?? [];
  const selectedOverviewTeamBPairs = selectedOverviewCell?.teamBPairs ?? [];
  const visibleOverviewTeamAOffenses = useMemo(
    () => offenseOverviewRows.map((row) => row.teamAOffense),
    [offenseOverviewRows],
  );
  const visibleOverviewTeamBOffenses = useMemo(() => {
    const seen = new Set<string>();
    const offenses: string[] = [];

    for (const row of offenseOverviewRows) {
      for (const cell of row.cells) {
        if (seen.has(cell.teamBOffense)) {
          continue;
        }
        seen.add(cell.teamBOffense);
        offenses.push(cell.teamBOffense);
      }
    }

    return offenses;
  }, [offenseOverviewRows]);
  const selectedOverviewTeamAOffense =
    selectedOverviewCell?.teamAOffense ??
    recommendedOverviewCell?.teamAOffense ??
    visibleOverviewTeamAOffenses[0] ??
    "";
  const selectedOverviewTeamBOffense =
    selectedOverviewCell?.teamBOffense ??
    recommendedOverviewCell?.teamBOffense ??
    visibleOverviewTeamBOffenses[0] ??
    "";

  function handleRunMatchupMatrix() {
    if (matrixMutation.isPending) {
      return;
    }

    captureAnalyticsEvent("game_prediction_matrix_requested", {
      has_team_a_source_match: Boolean(draft.teamA.sourceMatchId),
      has_team_b_source_match: Boolean(draft.teamB.sourceMatchId),
      venue: draft.venue,
    });

    void matrixMutation
      .mutateAsync(modelPickerEnabled ? draft : { ...draft, modelKey: null })
      .catch(() => undefined);
  }

  function handleMatrixViewSelection(view: PredictionMatrixView) {
    if (view.viewId === activeView?.viewId) {
      return;
    }
    setSelectedViewId(view.viewId);
    captureAnalyticsEvent("game_prediction_view_changed", {
      next_view_id: view.viewId,
      next_view_label: view.label,
    });
  }

  function handleSurfaceToggle(
    surface:
      | "advanced_filters"
      | "defense_drilldown"
      | "explore_extremes",
    setter: Dispatch<SetStateAction<boolean>>,
  ) {
    setter((current) => {
      const next = !current;
      captureAnalyticsEvent("game_prediction_surface_toggled", {
        source: "game_prediction_panel",
        state: next ? "opened" : "closed",
        surface,
      });
      return next;
    });
  }

  function handleMatrixModeChange(nextMode: PredictionMatrixMode) {
    if (nextMode === matrixMode) {
      return;
    }

    setMatrixMode(nextMode);
    captureAnalyticsEvent("game_prediction_matrix_mode_changed", {
      next_mode: nextMode,
      source: "game_prediction_panel",
    });
  }

  function handleOffenseFilterToggle(args: {
    allOffenses: readonly string[];
    axis: "team_a" | "team_b";
    offense: string;
    setter: Dispatch<SetStateAction<string[]>>;
  }) {
    args.setter((current) => {
      const next = toggleExpandedOffense(current, args.offense, args.allOffenses);
      if (areStringListsEqual(current, next)) {
        return current;
      }
      captureAnalyticsEvent("game_prediction_offense_filter_changed", {
        axis: args.axis,
        offense: args.offense,
        selected_count: next.length,
        state: next.includes(args.offense) ? "expanded" : "collapsed",
        total_count: args.allOffenses.length,
      });
      return next;
    });
  }

  function handleDefenseFilterToggle(args: {
    allDefenses: readonly string[];
    axis: "team_a" | "team_b";
    defense: string;
    setter: Dispatch<SetStateAction<string[]>>;
  }) {
    args.setter((current) => {
      const next = toggleRequiredOption(current, args.defense, args.allDefenses);
      if (areStringListsEqual(current, next)) {
        return current;
      }
      captureAnalyticsEvent("game_prediction_defense_filter_changed", {
        axis: args.axis,
        defense: args.defense,
        selected_count: next.length,
        state: next.includes(args.defense) ? "enabled" : "disabled",
        total_count: args.allDefenses.length,
      });
      return next;
    });
  }

  function trackOverviewSelection(args: {
    cell: PredictionMatrixOverviewCell;
    source: "mobile_overview_picker" | "overview_heatmap";
  }) {
    const margin =
      typeof args.cell.result?.cell.predictedPointDiff === "number"
        ? args.cell.result.cell.predictedPointDiff
        : null;
    captureAnalyticsEvent("game_prediction_overview_cell_selected", {
      is_recommended:
        recommendedOverviewCell?.teamAOffense === args.cell.teamAOffense &&
        recommendedOverviewCell.teamBOffense === args.cell.teamBOffense,
      margin,
      source: args.source,
      team_a_offense: args.cell.teamAOffense,
      team_b_offense: args.cell.teamBOffense,
    });
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
      setError("Enter a game ID first.");
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
        readClientSideErrorMessage(error) ?? "That game could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

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

  return (
    <div className="grid gap-4">
      <Panel>
        <SectionHeading
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
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
                  setSelectedTeamAPairId(null);
                  setSelectedTeamBPairId(null);
                  setSelectedViewId(null);
                  setMatrixMode("overview");
                  setShowAdvancedFilters(false);
                  setShowDefenseDrilldown(false);
                  setShowExtremes(false);
                  matrixMutation.reset();
                }}
                size="sm"
                variant="ghost"
              >
                Start blank matchup
              </Button>
              <Button
                loading={matrixMutation.isPending}
                onClick={handleRunMatchupMatrix}
                size="sm"
                variant="secondary"
              >
                Run matchup matrix
              </Button>
            </div>
          }
          description="Build any matchup with editable team sheets, import from recent team boxscores or a specific game ID, and compare every tactic pair in one matrix."
          title="Game prediction"
        />

        <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1.15fr)_minmax(0,1fr)]">
          <StatCard
            detail="Explicit venue setting for the current matchup."
            label="Venue"
            value={formatPredictionVenueLabel(
              draft.venue,
              selectedTeamALabel,
              selectedTeamBLabel,
            )}
          />
          <StatCard
            className={cn(recommendedResult && "border-note-border bg-note-bg")}
            detail={renderMatrixResultDetail({
              emptyDetail:
                "Run the matrix to recommend the best worst-case matchup against an optimizing opponent.",
              note: "Best worst-case result against an optimizing opponent.",
              result: recommendedResult,
              teamALabel: selectedTeamALabel,
              teamBLabel: selectedTeamBLabel,
            })}
            label="Recommended matchup"
            value={recommendedResult ? formatCellMargin(recommendedResult.cell) : matrix ? "Unavailable" : "Not run"}
          />
          <StatCard
            className={cn(selectedResult && "border-accent/20 bg-accent/8")}
            detail={renderMatrixResultDetail({
              emptyDetail:
                "Pick a visible matrix cell to inspect exactly what both teams are running.",
              note: "Manual inspection updates the tactic editors.",
              result: selectedResult,
              teamALabel: selectedTeamALabel,
              teamBLabel: selectedTeamBLabel,
            })}
            label="Inspected matchup"
            value={matrix ? formatCellMargin(selectedCell) : "Not run"}
          />
        </div>

        {matrixMutation.error ? (
          <Alert>{String(matrixMutation.error)}</Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Venue">
            <Select
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

          <PredictionModelPicker
            onChange={(nextValue) =>
              setDraft((current) => ({
                ...current,
                modelKey: nextValue,
              }))
            }
            value={draft.modelKey}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <PredictionSideCard
            importMatch={teamAImportQuery.data ?? null}
            importMatchError={readClientSideErrorMessage(teamAImportQuery.error)}
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

          <PredictionSideCard
            importMatch={teamBImportQuery.data ?? null}
            importMatchError={readClientSideErrorMessage(teamBImportQuery.error)}
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
      </Panel>

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading title="Tactic-pair matrix" titleAs="h4" />

        {!matrix ? (
          <p className="text-sm leading-7 text-ink-muted">
            Run the matchup matrix to compare every {selectedTeamALabel} tactic pair
            against every {selectedTeamBLabel} tactic pair.
          </p>
        ) : (
          <div className="grid gap-4">
            <PredictionModelMetadata value={matrix} />
            <div className="grid gap-3 rounded-card border border-black/8 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {matrix.views.map((view) => (
                    <Button
                      key={view.viewId}
                      onClick={() => handleMatrixViewSelection(view)}
                      size="sm"
                      variant={view.viewId === activeView?.viewId ? "secondary" : "ghost"}
                    >
                      {view.label}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-2">
                  <PredictionMatrixModeSwitch
                    mode={matrixMode}
                    onChange={handleMatrixModeChange}
                  />
                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    <Button
                      onClick={() =>
                        handleSurfaceToggle(
                          "advanced_filters",
                          setShowAdvancedFilters,
                        )
                      }
                      size="sm"
                      variant={showAdvancedFilters ? "secondary" : "ghost"}
                    >
                      {showAdvancedFilters
                        ? "Hide advanced filters"
                        : "Advanced filters"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <CompactMatrixToggleGroup
                  formatOptionLabel={abbreviateMatrixOffenseLabel}
                  label={`Rows · ${selectedTeamALabel}`}
                  onToggle={(offense) =>
                    handleOffenseFilterToggle({
                      allOffenses: teamAOffenseOptions,
                      axis: "team_a",
                      offense,
                      setter: setExpandedTeamAOffenses,
                    })
                  }
                  options={teamAOffenseOptions}
                  selectedOptions={expandedTeamAOffenses}
                />
                <CompactMatrixToggleGroup
                  formatOptionLabel={abbreviateMatrixOffenseLabel}
                  label={`Columns · ${selectedTeamBLabel}`}
                  onToggle={(offense) =>
                    handleOffenseFilterToggle({
                      allOffenses: teamBOffenseOptions,
                      axis: "team_b",
                      offense,
                      setter: setExpandedTeamBOffenses,
                    })
                  }
                  options={teamBOffenseOptions}
                  selectedOptions={expandedTeamBOffenses}
                />
              </div>

              {showAdvancedFilters ? (
                <div className="grid gap-4 rounded-card border border-black/8 bg-[rgba(255,255,255,0.82)] p-4 xl:grid-cols-2">
                  <div className="xl:col-span-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
                      Advanced filters
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => {
                          setExpandedTeamAOffenses([...teamAOffenseOptions]);
                          setExpandedTeamBOffenses([...teamBOffenseOptions]);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        Show all
                      </Button>
                      <Button
                        onClick={() => {
                          setExpandedTeamAOffenses([...teamAOffenseOptions]);
                          setExpandedTeamBOffenses([...teamBOffenseOptions]);
                          setEnabledTeamADefenses([...teamADefenseOptions]);
                          setEnabledTeamBDefenses([...teamBDefenseOptions]);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        Reset filters
                      </Button>
                    </div>
                  </div>
                  <MatrixToggleGroup
                    formatOptionLabel={abbreviateMatrixDefenseLabel}
                    hint="Applies to the Overview summary, Defense breakdown, and Advanced pair matrix."
                    label={`Rows · ${selectedTeamALabel} defenses`}
                    onReset={() => setEnabledTeamADefenses([...teamADefenseOptions])}
                    onToggle={(defense) =>
                      handleDefenseFilterToggle({
                        allDefenses: teamADefenseOptions,
                        axis: "team_a",
                        defense,
                        setter: setEnabledTeamADefenses,
                      })
                    }
                    options={teamADefenseOptions}
                    selectedOptions={enabledTeamADefenses}
                    showReset={false}
                  />
                  <MatrixToggleGroup
                    formatOptionLabel={abbreviateMatrixDefenseLabel}
                    hint="Applies to the Overview summary, Defense breakdown, and Advanced pair matrix."
                    label={`Columns · ${selectedTeamBLabel} defenses`}
                    onReset={() => setEnabledTeamBDefenses([...teamBDefenseOptions])}
                    onToggle={(defense) =>
                      handleDefenseFilterToggle({
                        allDefenses: teamBDefenseOptions,
                        axis: "team_b",
                        defense,
                        setter: setEnabledTeamBDefenses,
                      })
                    }
                    options={teamBDefenseOptions}
                    selectedOptions={enabledTeamBDefenses}
                    showReset={false}
                  />
                </div>
              ) : null}
            </div>

            {activeView ? (
              <>
                {!visibleTeamAPairs.length || !visibleTeamBPairs.length ? (
                  <Alert tone="note">
                    The current offense and defense filters leave no visible tactic
                    rows or columns. Use the Show all action in the control tray to reopen the
                    matrix.
                  </Alert>
                ) : (
                  <>
                    <div
                      className={cn(
                        "flex flex-wrap items-start justify-between gap-3 rounded-card border border-black/8 bg-white px-4 py-3",
                        !matrixSurfaceVisibility.showOverview && "md:hidden",
                      )}
                    >
                      <div className="grid gap-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                          <span>Overview</span>
                          <span className="text-ink">
                            Rows · {selectedTeamALabel}
                          </span>
                          <span className="text-ink">
                            Columns · {selectedTeamBLabel}
                          </span>
                        </div>
                        <p className="text-sm leading-6 text-ink-muted">
                          Overview groups tactic pairs by offense. Each cell
                          shows the best worst-case margin across the currently
                          enabled defenses for those two offenses.
                        </p>
                        <p className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                          Positive margins favor {selectedTeamALabel}.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() =>
                            handleSurfaceToggle("explore_extremes", setShowExtremes)
                          }
                          size="sm"
                          variant={showExtremes ? "secondary" : "ghost"}
                        >
                          {showExtremes ? "Hide extremes" : "Explore extremes"}
                        </Button>
                      </div>
                    </div>

                    {matrixSurfaceVisibility.showAdvanced ? (
                      <div className="hidden flex-wrap items-start justify-between gap-3 rounded-card border border-black/8 bg-white px-4 py-3 md:flex">
                        <div className="grid gap-1.5">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                            <span>Advanced pair matrix</span>
                            <span className="text-ink">
                              Rows · {selectedTeamALabel} tactics
                            </span>
                            <span className="text-ink">
                              Columns · {selectedTeamBLabel} tactics
                            </span>
                          </div>
                          <p className="text-sm leading-6 text-ink-muted">
                            Every visible tactic pair is shown directly, still
                            grouped by offense so you can scan the full grid
                            without losing the simple heatmap structure.
                          </p>
                          <p className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                            Positive margins favor {selectedTeamALabel}.
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "grid gap-4",
                        !matrixSurfaceVisibility.showOverview && "md:hidden",
                      )}
                    >
                    <div className="hidden md:block">
                      <div className="max-h-[34rem] overflow-auto rounded-card border border-black/8 bg-white">
                        <table className="w-max min-w-full border-collapse text-left">
                          <thead className="bg-white">
                            <tr>
                              <th className="sticky left-0 top-0 z-50 w-28 min-w-28 border-b border-black/10 bg-white px-3 py-2.5 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]">
                                <div className="grid gap-1">
                                  <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                    Rows
                                  </span>
                                  <span
                                    className="truncate text-sm font-semibold text-ink"
                                    title={selectedTeamALabel}
                                  >
                                    {selectedTeamALabel}
                                  </span>
                                </div>
                              </th>
                              <th
                                className="sticky top-0 z-40 border-b border-black/10 bg-white px-3 py-2.5 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]"
                                colSpan={visibleOverviewTeamBOffenses.length}
                              >
                                <div className="grid gap-1">
                                  <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                    Columns
                                  </span>
                                  <span className="text-sm font-semibold text-ink">
                                    {selectedTeamBLabel}
                                  </span>
                                </div>
                              </th>
                            </tr>
                            <tr>
                              <th className="sticky left-0 top-[4.2rem] z-50 w-28 min-w-28 border-b border-black/10 bg-white px-3 py-2 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]">
                                <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                  Off
                                </span>
                              </th>
                              {visibleOverviewTeamBOffenses.map((offense) => {
                                const isRecommendedColumn =
                                  recommendedOverviewCell?.teamBOffense === offense;
                                const isSelectedColumn =
                                  selectedOverviewTeamBOffense === offense;

                                return (
                                  <th
                                    className={cn(
                                      "sticky top-[4.2rem] z-40 border-b border-black/10 px-2 py-2 text-center shadow-[0_1px_0_rgba(15,23,42,0.08)]",
                                      MATRIX_MATCHUP_COLUMN_WIDTH_CLASS,
                                    )}
                                    key={offense}
                                    style={{
                                      backgroundColor:
                                        isRecommendedColumn || isSelectedColumn
                                          ? "#fff4ea"
                                          : "#ffffff",
                                    }}
                                  >
                                    <span
                                      className="inline-flex items-center justify-center text-[0.82rem] font-semibold text-ink"
                                      title={offense}
                                    >
                                      {abbreviateMatrixOffenseLabel(offense)}
                                    </span>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {offenseOverviewRows.map((row) => {
                              const isRecommendedRow =
                                recommendedOverviewCell?.teamAOffense === row.teamAOffense;
                              const isSelectedRow =
                                selectedOverviewTeamAOffense === row.teamAOffense;

                              return (
                                <tr key={row.teamAOffense}>
                                  <th
                                    className="sticky left-0 z-20 w-28 min-w-28 border-b border-black/10 px-3 py-2 text-left shadow-[1px_0_0_rgba(15,23,42,0.06)]"
                                    style={{
                                      backgroundColor:
                                        isRecommendedRow || isSelectedRow
                                          ? "#fff4ea"
                                          : "#ffffff",
                                    }}
                                  >
                                    <div className="grid gap-1">
                                      <span
                                        className="text-sm font-semibold text-ink"
                                        title={row.teamAOffense}
                                      >
                                        {abbreviateMatrixOffenseLabel(row.teamAOffense)}
                                      </span>
                                      <span className="text-[0.68rem] text-ink-muted">
                                        {formatDefenseCount(row.teamAPairs.length)}
                                      </span>
                                    </div>
                                  </th>
                                  {row.cells.map((overviewCell) => {
                                    const result = overviewCell.result;
                                    const isRecommended =
                                      recommendedOverviewCell?.teamAOffense ===
                                        overviewCell.teamAOffense &&
                                      recommendedOverviewCell.teamBOffense ===
                                        overviewCell.teamBOffense;
                                    const isSelected =
                                      selectedOverviewCell?.teamAOffense ===
                                        overviewCell.teamAOffense &&
                                      selectedOverviewCell.teamBOffense ===
                                        overviewCell.teamBOffense;

                                    return (
                                      <td
                                        className={cn(
                                          MATRIX_CELL_CLASS,
                                          MATRIX_MATCHUP_COLUMN_WIDTH_CLASS,
                                        )}
                                        key={`${overviewCell.teamAOffense}-${overviewCell.teamBOffense}`}
                                      >
                                        <button
                                          className={cn(
                                            MATRIX_CELL_BUTTON_CLASS,
                                            isSelected && "ring-2 ring-accent/35",
                                          )}
                                          onClick={() => {
                                            if (!result) {
                                              return;
                                            }
                                            trackOverviewSelection({
                                              cell: overviewCell,
                                              source: "overview_heatmap",
                                            });
                                            handleMatrixSelection({
                                              matrix,
                                              setDraft,
                                              setSelectedTeamAPairId,
                                              setSelectedTeamBPairId,
                                              teamAPairId: result.teamAPair.pairId,
                                              teamBPairId: result.teamBPair.pairId,
                                            });
                                          }}
                                          style={getPredictionCellHeatmapStyle(
                                            result?.cell ?? null,
                                          )}
                                          type="button"
                                        >
                                          {isRecommended ? (
                                            <span
                                              className={MATRIX_CELL_BADGE_ROW_CLASS}
                                            >
                                              <span className="inline-flex rounded-full border border-note-border bg-note-bg px-1.5 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-note">
                                                Rec
                                              </span>
                                            </span>
                                          ) : null}
                                          <strong className="text-sm font-semibold text-ink">
                                            {formatCompactCellMargin(result?.cell ?? null)}
                                          </strong>
                                        </button>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="grid gap-4 md:hidden">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={`${selectedTeamALabel} offense`}>
                          <Select
                            onChange={(event) => {
                              const nextTeamAOffense = event.currentTarget.value;
                              const nextCell =
                                findOffenseOverviewCell({
                                  rows: offenseOverviewRows,
                                  teamAOffense: nextTeamAOffense,
                                  teamBOffense: selectedOverviewTeamBOffense,
                                }) ??
                                offenseOverviewRows.find(
                                  (candidate) =>
                                    candidate.teamAOffense === nextTeamAOffense,
                                )?.cells[0] ??
                                null;
                              if (!nextCell?.result) {
                                return;
                              }
                              trackOverviewSelection({
                                cell: nextCell,
                                source: "mobile_overview_picker",
                              });
                              handleMatrixSelection({
                                matrix,
                                setDraft,
                                setSelectedTeamAPairId,
                                setSelectedTeamBPairId,
                                teamAPairId: nextCell.result.teamAPair.pairId,
                                teamBPairId: nextCell.result.teamBPair.pairId,
                              });
                            }}
                            value={selectedOverviewTeamAOffense}
                          >
                            {visibleOverviewTeamAOffenses.map((offense) => (
                              <option key={offense} value={offense}>
                                {offense}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={`${selectedTeamBLabel} offense`}>
                          <Select
                            onChange={(event) => {
                              const nextTeamBOffense = event.currentTarget.value;
                              const nextCell =
                                findOffenseOverviewCell({
                                  rows: offenseOverviewRows,
                                  teamAOffense: selectedOverviewTeamAOffense,
                                  teamBOffense: nextTeamBOffense,
                                }) ??
                                offenseOverviewRows[0]?.cells.find(
                                  (candidate) =>
                                    candidate.teamBOffense === nextTeamBOffense,
                                ) ??
                                null;
                              if (!nextCell?.result) {
                                return;
                              }
                              trackOverviewSelection({
                                cell: nextCell,
                                source: "mobile_overview_picker",
                              });
                              handleMatrixSelection({
                                matrix,
                                setDraft,
                                setSelectedTeamAPairId,
                                setSelectedTeamBPairId,
                                teamAPairId: nextCell.result.teamAPair.pairId,
                                teamBPairId: nextCell.result.teamBPair.pairId,
                              });
                            }}
                            value={selectedOverviewTeamBOffense}
                          >
                            {visibleOverviewTeamBOffenses.map((offense) => (
                              <option key={offense} value={offense}>
                                {offense}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    </div>

                    <Panel as="article" padding="sm" variant="solid">
                      <SectionHeading
                        actions={
                          selectedOverviewCell ? (
                            <Button
                              onClick={() =>
                                handleSurfaceToggle(
                                  "defense_drilldown",
                                  setShowDefenseDrilldown,
                                )
                              }
                              size="sm"
                              variant={showDefenseDrilldown ? "secondary" : "ghost"}
                            >
                              {showDefenseDrilldown
                                ? "Hide defense breakdown"
                                : "Show defense breakdown"}
                            </Button>
                          ) : undefined
                        }
                        title="Offense matchup detail"
                        titleAs="h4"
                      />

                      {selectedOverviewCell && selectedOverviewResult ? (
                        <div className="grid gap-4">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-card border border-black/8 bg-white p-4">
                              <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                {selectedTeamALabel} offense
                              </span>
                              <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                                {selectedOverviewCell.teamAOffense}
                              </p>
                            </div>
                            <div className="rounded-card border border-black/8 bg-white p-4">
                              <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                {selectedTeamBLabel} offense
                              </span>
                              <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                                {selectedOverviewCell.teamBOffense}
                              </p>
                            </div>
                            <div className="rounded-card border border-black/8 bg-white p-4">
                              <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                {selectedTeamALabel} defense
                              </span>
                              <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                                {selectedOverviewResult.teamAPair.defense}
                              </p>
                            </div>
                            <div className="rounded-card border border-black/8 bg-white p-4">
                              <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                {selectedTeamBLabel} best response
                              </span>
                              <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                                {selectedOverviewResult.teamBPair.defense}
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
                            <StatCard
                              detail={formatCellScoreline(
                                selectedOverviewResult.cell,
                                selectedTeamALabel,
                                selectedTeamBLabel,
                              )}
                              label="Predicted margin"
                              value={formatCellMargin(selectedOverviewResult.cell)}
                            />
                            <div className="rounded-card border border-black/8 bg-white p-4 text-sm leading-7 text-ink-muted">
                              Within this offense matchup, {selectedTeamALabel} lands on{" "}
                              {selectedOverviewResult.teamAPair.defense} as the
                              best worst-case defense, and {selectedTeamBLabel} best
                              responds with {selectedOverviewResult.teamBPair.defense}.
                            </div>
                          </div>

                          {showDefenseDrilldown ? (
                            <div className="grid gap-3">
                              <div className="flex flex-wrap items-center gap-3 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                <span>Defense breakdown</span>
                                <span className="text-ink">
                                  Rows · {selectedTeamALabel} defense
                                </span>
                                <span className="text-ink">
                                  Columns · {selectedTeamBLabel} defense
                                </span>
                              </div>
                              <div className="max-h-[28rem] overflow-auto rounded-card border border-black/8 bg-white">
                                <table className="w-max min-w-full border-collapse text-left">
                                  <thead className="bg-white">
                                    <tr>
                                      <th className="sticky left-0 top-0 z-30 w-24 min-w-24 border-b border-black/10 bg-white px-3 py-2 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]">
                                        <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                          Def
                                        </span>
                                      </th>
                                      {selectedOverviewTeamBPairs.map((teamBPair) => (
                                        <th
                                          className={cn(
                                            "sticky top-0 z-20 border-b border-black/10 bg-white px-1.5 py-2 text-center shadow-[0_1px_0_rgba(15,23,42,0.08)]",
                                            MATRIX_MATCHUP_COLUMN_WIDTH_CLASS,
                                          )}
                                          key={teamBPair.pairId}
                                        >
                                          <span
                                            className="inline-flex items-center justify-center gap-1 text-[0.8rem] font-semibold text-ink"
                                            title={teamBPair.defense}
                                          >
                                            <span>
                                              {abbreviateMatrixDefenseLabel(
                                                teamBPair.defense,
                                              )}
                                            </span>
                                            {teamBPair.estimated ? (
                                              <EstimatedMatrixMarker />
                                            ) : null}
                                          </span>
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedOverviewTeamAPairs.map((teamAPair) => {
                                      const isSelectedRow =
                                        selectedTeamAPairId === teamAPair.pairId;

                                      return (
                                        <tr key={teamAPair.pairId}>
                                          <th
                                            className="sticky left-0 z-10 w-24 min-w-24 border-b border-black/10 bg-white px-3 py-2 text-left shadow-[1px_0_0_rgba(15,23,42,0.06)]"
                                            style={{
                                              backgroundColor: isSelectedRow
                                                ? "#fff4ea"
                                                : "#ffffff",
                                            }}
                                          >
                                            <span
                                              className="inline-flex items-center gap-1 text-[0.82rem] font-semibold text-ink"
                                              title={teamAPair.defense}
                                            >
                                              <span>
                                                {abbreviateMatrixDefenseLabel(
                                                  teamAPair.defense,
                                                )}
                                              </span>
                                              {teamAPair.estimated ? (
                                                <EstimatedMatrixMarker />
                                              ) : null}
                                            </span>
                                          </th>
                                          {selectedOverviewTeamBPairs.map((teamBPair) => {
                                            const row =
                                              activeViewRowsByTeamBPairId.get(
                                                teamBPair.pairId,
                                              ) ?? null;
                                            const cell =
                                              row?.cells.find(
                                                (candidate) =>
                                                  candidate.teamAPairId ===
                                                  teamAPair.pairId,
                                              ) ?? null;
                                            const isSelected =
                                              isSelectedRow &&
                                              selectedTeamBPairId === teamBPair.pairId;
                                            const isRecommended =
                                              matchesVisibleResult({
                                                result: recommendedResult,
                                                teamAPairId: teamAPair.pairId,
                                                teamBPairId: teamBPair.pairId,
                                              });

                                            return (
                                              <td
                                                className={cn(
                                                  MATRIX_CELL_CLASS,
                                                  MATRIX_MATCHUP_COLUMN_WIDTH_CLASS,
                                                )}
                                                key={`${teamAPair.pairId}-${teamBPair.pairId}-drilldown`}
                                              >
                                                <button
                                                  className={cn(
                                                    MATRIX_CELL_BUTTON_CLASS,
                                                    isSelected &&
                                                      "ring-2 ring-accent/35",
                                                  )}
                                                  onClick={() =>
                                                    handleMatrixSelection({
                                                      isRecommended,
                                                      matrix,
                                                      selectionSource:
                                                        "defense_drilldown",
                                                      view: activeView,
                                                      setDraft,
                                                      setSelectedTeamAPairId,
                                                      setSelectedTeamBPairId,
                                                      teamAPairId: teamAPair.pairId,
                                                      teamBPairId: teamBPair.pairId,
                                                    })
                                                  }
                                                  style={getPredictionCellHeatmapStyle(
                                                    cell,
                                                  )}
                                                  type="button"
                                                >
                                                  {isRecommended ? (
                                                    <span
                                                      className={MATRIX_CELL_BADGE_ROW_CLASS}
                                                    >
                                                      <span className="inline-flex rounded-full border border-note-border bg-note-bg px-1.5 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-note">
                                                        Rec
                                                      </span>
                                                    </span>
                                                  ) : null}
                                                  <strong className="text-sm font-semibold text-ink">
                                                    {formatCompactCellMargin(cell)}
                                                  </strong>
                                                </button>
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm leading-7 text-ink-muted">
                          Pick an Overview cell to inspect the Defense breakdown
                          inside that offense matchup.
                        </p>
                      )}
                    </Panel>

                    {showExtremes ? (
                      <Panel as="article" padding="sm" variant="solid">
                        <SectionHeading title="Explore extremes" titleAs="h4" />
                        <div className="grid gap-4 xl:grid-cols-2">
                          <StatCard
                            className={cn(
                              bestResult && "border-success/20 bg-[rgba(34,197,94,0.08)]",
                            )}
                            detail={renderMatrixResultDetail({
                              emptyDetail:
                                "No visible upside is available for the current filters.",
                              note:
                                "Exploration only. This ignores opponent adaptation.",
                              result: bestResult,
                              teamALabel: selectedTeamALabel,
                              teamBLabel: selectedTeamBLabel,
                            })}
                            label="Best visible upside"
                            value={
                              bestResult
                                ? formatCellMargin(bestResult.cell)
                                : "Unavailable"
                            }
                          />
                          <StatCard
                            className={cn(
                              worstResult &&
                                "border-danger-border bg-[rgba(239,68,68,0.08)]",
                            )}
                            detail={renderMatrixResultDetail({
                              emptyDetail:
                                "No visible downside is available for the current filters.",
                              note:
                                "Exploration only. This ignores opponent adaptation.",
                              result: worstResult,
                              teamALabel: selectedTeamALabel,
                              teamBLabel: selectedTeamBLabel,
                            })}
                            label="Worst visible downside"
                            value={
                              worstResult
                                ? formatCellMargin(worstResult.cell)
                                : "Unavailable"
                            }
                          />
                        </div>
                      </Panel>
                    ) : null}
                    </div>

                    {matrixSurfaceVisibility.showAdvanced ? (
                      <div className="hidden md:block">
                        <Panel as="article" padding="sm" variant="solid">
                          <SectionHeading
                            description="Every visible tactic pair, grouped by offense with compact heatmap cells."
                            title="Advanced pair matrix"
                            titleAs="h4"
                          />
                          <div className="max-h-[72vh] overflow-auto rounded-card border border-black/8 bg-white">
                            <table className="w-max min-w-full border-collapse text-left">
                              <thead className="bg-white">
                                <tr>
                                  <th
                                    className={cn(
                                      "sticky left-0 top-0 z-50 border-b border-black/10 bg-white px-3 py-2.5 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]",
                                      MATRIX_ROW_HEADER_WIDTH_CLASS,
                                    )}
                                  >
                                    <div className="grid gap-1">
                                      <span className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                        Rows
                                      </span>
                                      <span
                                        className="truncate text-sm font-semibold text-ink"
                                        title={`${selectedTeamALabel} tactics`}
                                      >
                                        {selectedTeamALabel}
                                      </span>
                                    </div>
                                  </th>
                                  <th
                                    className="sticky top-0 z-40 border-b border-black/10 bg-white px-3 py-2.5 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]"
                                    colSpan={renderedColumnCount}
                                  >
                                    <div className="grid gap-1">
                                      <span className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                        Columns
                                      </span>
                                      <span className="text-sm font-semibold text-ink">
                                        {selectedTeamBLabel} tactics
                                      </span>
                                    </div>
                                  </th>
                                </tr>
                                <tr>
                                  <th
                                    className={cn(
                                      "sticky left-0 top-[4.2rem] z-50 border-b border-black/10 bg-white px-3 py-2 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]",
                                      MATRIX_ROW_HEADER_WIDTH_CLASS,
                                    )}
                                  >
                                    <span
                                      className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted"
                                      title={`${selectedTeamALabel} offense groups`}
                                    >
                                      Off
                                    </span>
                                  </th>
                                  {visibleAdvancedTeamBColumnGroups.map((group) => {
                                    const highlightsSelectedOffense =
                                      selectedTeamBPair?.offense === group.offense;

                                    return (
                                      <th
                                        className="sticky top-[4.2rem] z-40 border-b border-black/10 bg-white px-1.5 py-1.5 text-center shadow-[0_1px_0_rgba(15,23,42,0.08)]"
                                        colSpan={group.pairs.length}
                                        key={group.offense}
                                        style={{
                                          backgroundColor: highlightsSelectedOffense
                                            ? "#fff4ea"
                                            : "#ffffff",
                                        }}
                                      >
                                        <button
                                          className="grid w-full gap-0.5 rounded-[0.8rem] border border-black/8 bg-white px-2 py-1.5 text-center transition hover:border-accent/35 hover:bg-white"
                                          onClick={() =>
                                            handleOffenseFilterToggle({
                                              allOffenses: teamBOffenseOptions,
                                              axis: "team_b",
                                              offense: group.offense,
                                              setter: setExpandedTeamBOffenses,
                                            })
                                          }
                                          type="button"
                                        >
                                          <span className="flex items-center justify-center gap-2">
                                            <span
                                              className="whitespace-nowrap text-[0.75rem] font-bold tracking-[0.08em] text-ink-muted"
                                              title={group.offense}
                                            >
                                              {abbreviateMatrixOffenseLabel(
                                                group.offense,
                                              )}
                                            </span>
                                          </span>
                                          <span className="text-[0.7rem] leading-5 text-ink-muted">
                                            {formatDefenseCount(group.pairs.length)}
                                          </span>
                                        </button>
                                      </th>
                                    );
                                  })}
                                </tr>
                                <tr>
                                  <th
                                    className={cn(
                                      "sticky left-0 top-[8.1rem] z-50 border-b border-black/10 bg-white px-3 py-2 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]",
                                      MATRIX_ROW_HEADER_WIDTH_CLASS,
                                    )}
                                  >
                                    <span
                                      className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted"
                                      title={`${selectedTeamBLabel} defense`}
                                    >
                                      Def
                                    </span>
                                  </th>
                                  {visibleAdvancedTeamBColumnGroups.flatMap((group) =>
                                    group.pairs.map((pair) => (
                                      <th
                                        className={cn(
                                          "sticky top-[8.1rem] z-30 border-b border-black/10 bg-white px-1.5 py-2 text-center shadow-[0_1px_0_rgba(15,23,42,0.08)]",
                                          MATRIX_MATCHUP_COLUMN_WIDTH_CLASS,
                                        )}
                                        key={pair.pairId}
                                        style={{
                                          backgroundColor:
                                            selectedTeamBPairId === pair.pairId
                                              ? "#fff4ea"
                                              : "#ffffff",
                                        }}
                                      >
                                        <div className="grid gap-1">
                                          <span
                                            className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-[0.78rem] font-semibold leading-5 text-ink"
                                            title={pair.defense}
                                          >
                                            <span>
                                              {abbreviateMatrixDefenseLabel(
                                                pair.defense,
                                              )}
                                            </span>
                                            {pair.estimated ? (
                                              <EstimatedMatrixMarker />
                                            ) : null}
                                          </span>
                                        </div>
                                      </th>
                                    )),
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {visibleAdvancedTeamARowGroups.map((group) => (
                                  <Fragment key={group.offense}>
                                    <tr>
                                      <th
                                        className="border-y border-black/10 bg-[rgba(15,23,42,0.03)] px-3 py-1.5 text-left"
                                        colSpan={renderedColumnCount + 1}
                                      >
                                        <button
                                          className="flex w-full items-center justify-between gap-3 text-left"
                                          onClick={() =>
                                            handleOffenseFilterToggle({
                                              allOffenses: teamAOffenseOptions,
                                              axis: "team_a",
                                              offense: group.offense,
                                              setter: setExpandedTeamAOffenses,
                                            })
                                          }
                                          type="button"
                                        >
                                          <span className="inline-flex items-center gap-3">
                                            <span
                                              className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-ink-muted"
                                              title={`${selectedTeamALabel} offense group`}
                                            >
                                              {selectedTeamALabel} offense
                                            </span>
                                              <span className="text-sm font-semibold text-ink">
                                                <span title={group.offense}>
                                                  {abbreviateMatrixOffenseLabel(
                                                    group.offense,
                                                  )}
                                                </span>
                                              </span>
                                          </span>
                                          <span className="text-[0.68rem] leading-5 text-ink-muted">
                                            {formatDefenseCount(group.pairs.length)}
                                          </span>
                                        </button>
                                      </th>
                                    </tr>
                                    {group.pairs.map((teamAPair) => {
                                      const isSelectedRow =
                                        selectedTeamAPairId === teamAPair.pairId;

                                      return (
                                        <tr key={teamAPair.pairId}>
                                          <th
                                            className={cn(
                                              "sticky left-0 z-20 border-b border-black/10 bg-white px-3 py-2 text-left align-top shadow-[1px_0_0_rgba(15,23,42,0.06)]",
                                              MATRIX_ROW_HEADER_WIDTH_CLASS,
                                            )}
                                            style={{
                                              backgroundColor: isSelectedRow
                                                ? "#fff4ea"
                                                : "#ffffff",
                                            }}
                                          >
                                            <div className="grid gap-0.5">
                                              <span
                                                className="text-[0.68rem] font-bold tracking-[0.08em] text-ink-muted"
                                                title={teamAPair.offense}
                                              >
                                                {abbreviateMatrixOffenseLabel(
                                                  teamAPair.offense,
                                                )}
                                              </span>
                                              <span className="inline-flex items-center gap-1">
                                                <strong
                                                  className="text-[0.82rem] leading-5 text-ink"
                                                  title={teamAPair.defense}
                                                >
                                                  {abbreviateMatrixDefenseLabel(
                                                    teamAPair.defense,
                                                  )}
                                                </strong>
                                                {teamAPair.estimated ? (
                                                  <EstimatedMatrixMarker className="mt-px" />
                                                ) : null}
                                              </span>
                                            </div>
                                          </th>
                                          {visibleAdvancedTeamBColumnGroups.flatMap((teamBGroup) =>
                                            teamBGroup.pairs.map((teamBPair) => {
                                              const row =
                                                activeViewRowsByTeamBPairId.get(
                                                  teamBPair.pairId,
                                                ) ?? null;
                                              const cell =
                                                row?.cells.find(
                                                  (candidate) =>
                                                    candidate.teamAPairId ===
                                                    teamAPair.pairId,
                                                ) ?? null;
                                              const isSelected =
                                                isSelectedRow &&
                                                selectedTeamBPairId ===
                                                  teamBPair.pairId;
                                              const isRecommended =
                                                matchesVisibleResult({
                                                  result: recommendedResult,
                                                  teamAPairId: teamAPair.pairId,
                                                  teamBPairId: teamBPair.pairId,
                                                });
                                              const isBest = matchesVisibleResult({
                                                result: bestResult,
                                                teamAPairId: teamAPair.pairId,
                                                teamBPairId: teamBPair.pairId,
                                              });
                                              const isWorst = matchesVisibleResult({
                                                result: worstResult,
                                                teamAPairId: teamAPair.pairId,
                                                teamBPairId: teamBPair.pairId,
                                              });

                                              return (
                                                <td
                                                  className={cn(
                                                    MATRIX_CELL_CLASS,
                                                    MATRIX_MATCHUP_COLUMN_WIDTH_CLASS,
                                                  )}
                                                  key={`${teamBPair.pairId}-${teamAPair.pairId}`}
                                                >
                                                  <button
                                                    className={cn(
                                                      MATRIX_CELL_BUTTON_CLASS,
                                                      isSelected &&
                                                        "ring-2 ring-accent/35",
                                                    )}
                                                    onClick={() =>
                                                      handleMatrixSelection({
                                                        isRecommended,
                                                        matrix,
                                                        selectionSource:
                                                          "advanced_matrix",
                                                        view: activeView,
                                                        setDraft,
                                                        setSelectedTeamAPairId,
                                                        setSelectedTeamBPairId,
                                                        teamAPairId:
                                                          teamAPair.pairId,
                                                        teamBPairId:
                                                          teamBPair.pairId,
                                                      })
                                                    }
                                                    style={getPredictionCellHeatmapStyle(
                                                      cell,
                                                    )}
                                                    type="button"
                                                  >
                                                    {isRecommended ||
                                                    isBest ||
                                                    isWorst ? (
                                                      <span
                                                        className={
                                                          MATRIX_CELL_BADGE_ROW_CLASS
                                                        }
                                                      >
                                                        {isRecommended ? (
                                                          <span className="inline-flex rounded-full border border-note-border bg-note-bg px-1.5 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-note">
                                                            Rec
                                                          </span>
                                                        ) : null}
                                                        {isBest ? (
                                                          <span className="inline-flex rounded-full border border-success/20 bg-white/85 px-1.5 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-success">
                                                            Best
                                                          </span>
                                                        ) : null}
                                                        {isWorst ? (
                                                          <span className="inline-flex rounded-full border border-danger-border bg-white/85 px-1.5 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-accent-strong">
                                                            Worst
                                                          </span>
                                                        ) : null}
                                                      </span>
                                                    ) : null}
                                                    <strong className="text-sm font-semibold text-ink">
                                                      {formatCompactCellMargin(
                                                        cell,
                                                      )}
                                                    </strong>
                                                  </button>
                                                </td>
                                              );
                                            }),
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </Panel>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <p className="text-sm leading-7 text-ink-muted">
                No tactic view is available for this matchup yet.
              </p>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

type PredictionSideCardProps = {
  importMatch: MatchBoxscorePayload | null;
  importMatchError: string | null;
  importMatchId: string;
  importMatchLoading: boolean;
  importMatchOptions: PredictionImportMatchOption[];
  importMatchPickerError: string | null;
  importMatchPickerHint: string;
  manualImportMatchError: string | null;
  manualImportMatchId: string;
  manualImportMatchLoading: boolean;
  onImportMatchIdChange: (value: string) => void;
  onImportTeam: (
    boxscore: MatchBoxscorePayload,
    teamLocation: "HOME" | "AWAY",
  ) => void;
  onManualImportMatchIdChange: (value: string) => void;
  onManualImportSubmit: () => void;
  onSideChange: (updater: (current: PredictionSideInput) => PredictionSideInput) => void;
  onTeamIdCommit: () => void;
  onTeamIdInputChange: (value: string) => void;
  side: PredictionSideInput;
  sideLabel: string;
  teamIdInput: string;
};

function PredictionSideCard({
  importMatch,
  importMatchError,
  importMatchId,
  importMatchLoading,
  importMatchOptions,
  importMatchPickerError,
  importMatchPickerHint,
  manualImportMatchError,
  manualImportMatchId,
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
}: PredictionSideCardProps) {
  return (
    <Panel as="article" padding="sm" variant="solid">
      <SectionHeading
        description={side.sourceLabel ?? "Manual matchup sheet."}
        title={`${sideLabel}: ${side.teamName || sideLabel}`}
        titleAs="h4"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={`${sideLabel} name`}>
          <Input
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
        <Field
          hint="Commit on blur or Enter to refresh this side's recent boxscores."
          label={`${sideLabel} team ID`}
        >
          <Input
            onChange={(event) => {
              onTeamIdInputChange(event.currentTarget.value);
            }}
            onBlur={onTeamIdCommit}
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
          label="Import from recent boxscore"
        >
          <Select
            onChange={(event) => onImportMatchIdChange(event.currentTarget.value)}
            disabled={!importMatchOptions.length}
            value={importMatchId}
          >
            <option value="">No imported boxscore</option>
            {importMatchOptions.map((match) => (
              <option key={match.matchId} value={match.matchId}>
                {match.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source note">
          <Input
            onChange={(event) => {
              const sourceLabel = event.currentTarget.value.trim() || null;
              onSideChange((current) => ({
                ...current,
                sourceLabel,
              }));
            }}
            value={side.sourceLabel ?? ""}
          />
        </Field>
        <Field
          className="md:col-span-2"
          error={manualImportMatchError}
          hint="Load a specific game ID when the recent boxscore list does not include it."
          label="Import by game ID"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
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
              placeholder="Enter a game ID"
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
        <div className="grid gap-3 rounded-card border border-black/8 bg-white/70 p-4">
          <strong className="text-sm text-ink">Use a team from the selected match</strong>
          {importMatchLoading ? (
            <p className="text-sm text-ink-muted">Loading the match details.</p>
          ) : importMatchError ? (
            <p className="text-sm text-accent-strong">{importMatchError}</p>
          ) : importMatch ? (
            <div className="flex flex-wrap gap-2">
              {importMatch.homeTeam ? (
                <Button
                  onClick={() => onImportTeam(importMatch, "HOME")}
                  size="sm"
                  variant="secondary"
                >
                  Use {importMatch.homeTeam.teamName ?? "Host"} • hosted
                </Button>
              ) : null}
              {importMatch.awayTeam ? (
                <Button
                  onClick={() => onImportTeam(importMatch, "AWAY")}
                  size="sm"
                  variant="secondary"
                >
                  Use {importMatch.awayTeam.teamName ?? "Visitor"} • visited
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              That match could not be loaded for import.
            </p>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Offense">
          <Select
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

      <div className={ratingGridClassName}>
        {renderRatingInput("Outside scoring", side.ratings.outsideScoring, (value) =>
          onSideChange((current) => ({
            ...current,
            ratings: { ...current.ratings, outsideScoring: normalizeNumber(value, current.ratings.outsideScoring) },
          })),
        )}
        {renderRatingInput("Inside scoring", side.ratings.insideScoring, (value) =>
          onSideChange((current) => ({
            ...current,
            ratings: { ...current.ratings, insideScoring: normalizeNumber(value, current.ratings.insideScoring) },
          })),
        )}
        {renderRatingInput("Outside defense", side.ratings.outsideDefense, (value) =>
          onSideChange((current) => ({
            ...current,
            ratings: { ...current.ratings, outsideDefense: normalizeNumber(value, current.ratings.outsideDefense) },
          })),
        )}
        {renderRatingInput("Inside defense", side.ratings.insideDefense, (value) =>
          onSideChange((current) => ({
            ...current,
            ratings: { ...current.ratings, insideDefense: normalizeNumber(value, current.ratings.insideDefense) },
          })),
        )}
        {renderRatingInput("Rebounding", side.ratings.rebounding, (value) =>
          onSideChange((current) => ({
            ...current,
            ratings: { ...current.ratings, rebounding: normalizeNumber(value, current.ratings.rebounding) },
          })),
        )}
        {renderRatingInput("Offensive flow", side.ratings.offensiveFlow, (value) =>
          onSideChange((current) => ({
            ...current,
            ratings: { ...current.ratings, offensiveFlow: normalizeNumber(value, current.ratings.offensiveFlow) },
          })),
        )}
      </div>
    </Panel>
  );
}

function handleMatrixSelection(args: {
  isRecommended?: boolean;
  matrix: PredictionMatrixResult;
  selectionSource?: "advanced_matrix" | "defense_drilldown";
  setDraft: Dispatch<SetStateAction<PredictionDraft>>;
  setSelectedTeamAPairId: Dispatch<SetStateAction<string | null>>;
  setSelectedTeamBPairId: Dispatch<SetStateAction<string | null>>;
  teamAPairId: string;
  teamBPairId: string;
  view?: PredictionMatrixView | null;
}) {
  const teamAPair = args.matrix.teamAPairs.find(
    (pair) => pair.pairId === args.teamAPairId,
  );
  const teamBPair = args.matrix.teamBPairs.find(
    (pair) => pair.pairId === args.teamBPairId,
  );
  if (!teamAPair || !teamBPair) {
    return;
  }

  if (args.selectionSource) {
    const selectedCell = findSelectedCell({
      teamAPairId: args.teamAPairId,
      teamBPairId: args.teamBPairId,
      view: args.view ?? null,
    });
    captureAnalyticsEvent("game_prediction_pair_selected", {
      is_recommended: args.isRecommended ?? false,
      margin:
        typeof selectedCell?.predictedPointDiff === "number"
          ? selectedCell.predictedPointDiff
          : null,
      source: args.selectionSource,
      team_a_defense: teamAPair.defense,
      team_a_offense: teamAPair.offense,
      team_b_defense: teamBPair.defense,
      team_b_offense: teamBPair.offense,
    });
  }

  args.setSelectedTeamAPairId(args.teamAPairId);
  args.setSelectedTeamBPairId(args.teamBPairId);
  args.setDraft((current) => ({
    ...current,
    teamA: {
      ...current.teamA,
      defense: teamAPair.defense,
      offense: teamAPair.offense,
    },
    teamB: {
      ...current.teamB,
      defense: teamBPair.defense,
      offense: teamBPair.offense,
    },
  }));
}

function renderRatingInput(
  label: string,
  value: number,
  onChange: (value: string) => void,
) {
  return (
    <Field key={label} label={label}>
      <Input
        inputMode="decimal"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={String(value)}
      />
    </Field>
  );
}

type PredictionSideTeamIdCommitResult = {
  changed: boolean;
  committedTeamIdInput: string;
  draft: PredictionDraft;
  nextImportMatchId: string;
  nextManualImportMatchId: string;
};

type PredictionImportMatchFieldState = {
  error: string | null;
  hint: string;
};

function commitPredictionSideTeamIdChange(args: {
  currentImportMatchId: string;
  currentManualImportMatchId: string;
  draft: PredictionDraft;
  nextTeamIdInput: string;
  side: ImportSide;
}): PredictionSideTeamIdCommitResult {
  const currentSide = args.draft[args.side];
  const nextTeamId = normalizeImportIdentifier(args.nextTeamIdInput);
  const currentTeamId = normalizeImportIdentifier(currentSide.teamId);
  const committedTeamIdInput = nextTeamId ?? "";

  if (currentTeamId === nextTeamId) {
    return {
      changed: false,
      committedTeamIdInput,
      draft: args.draft,
      nextImportMatchId: args.currentImportMatchId,
      nextManualImportMatchId: args.currentManualImportMatchId,
    };
  }

  return {
    changed: true,
    committedTeamIdInput,
    draft: {
      ...args.draft,
      [args.side]: {
        ...currentSide,
        sourceLabel: null,
        sourceMatchId: null,
        teamId: nextTeamId,
      },
    },
    nextImportMatchId: "",
    nextManualImportMatchId: "",
  };
}

function applyPredictionSideResolvedTeamName(args: {
  draft: PredictionDraft;
  side: ImportSide;
  teamId: string;
  teamName: string | null | undefined;
}) {
  const currentSide = args.draft[args.side];
  const normalizedCurrentTeamId = normalizeImportIdentifier(currentSide.teamId);
  const normalizedTargetTeamId = normalizeImportIdentifier(args.teamId);
  const resolvedTeamName = args.teamName?.trim() || null;

  if (
    !normalizedCurrentTeamId ||
    !normalizedTargetTeamId ||
    normalizedCurrentTeamId !== normalizedTargetTeamId ||
    !resolvedTeamName ||
    currentSide.teamName === resolvedTeamName
  ) {
    return args.draft;
  }

  return {
    ...args.draft,
    [args.side]: {
      ...currentSide,
      teamName: resolvedTeamName,
    },
  };
}

function usesCurrentTeamSchedule(args: {
  currentTeamId: string | null;
  sideTeamId: string | null;
}) {
  const currentTeamId = normalizeImportIdentifier(args.currentTeamId);
  const sideTeamId = normalizeImportIdentifier(args.sideTeamId);
  return Boolean(currentTeamId && sideTeamId && currentTeamId === sideTeamId);
}

function resolvePredictionSideRecentMatches(args: {
  currentTeamId: string | null;
  currentTeamRecentMatches: readonly MatchSummary[];
  scoutRecentMatches: readonly MatchSummary[];
  sideTeamId: string | null;
}): MatchSummary[] {
  const sideTeamId = normalizeImportIdentifier(args.sideTeamId);
  if (!sideTeamId) {
    return [];
  }

  return usesCurrentTeamSchedule({
    currentTeamId: args.currentTeamId,
    sideTeamId,
  })
    ? [...args.currentTeamRecentMatches]
    : [...args.scoutRecentMatches];
}

function buildPredictionImportMatchOptions(
  matches: readonly MatchSummary[],
): PredictionImportMatchOption[] {
  const seenMatchIds = new Set<string>();

  return [...matches]
    .filter(
      (match): match is MatchSummary & { matchId: string } =>
        Boolean(match.hasBoxscore && normalizeImportIdentifier(match.matchId)),
    )
    .sort((left, right) =>
      String(right.startTime ?? "").localeCompare(String(left.startTime ?? "")),
    )
    .flatMap((match) => {
      const matchId = normalizeImportIdentifier(match.matchId);
      if (!matchId || seenMatchIds.has(matchId)) {
        return [];
      }

      seenMatchIds.add(matchId);
      return [
        {
          label: formatPredictionImportMatchLabel(match),
          matchId,
        },
      ];
    });
}

function ensurePredictionImportMatchOption(args: {
  importMatch: MatchBoxscorePayload | null;
  importMatchId: string;
  options: readonly PredictionImportMatchOption[];
}): PredictionImportMatchOption[] {
  const importMatchId = normalizeImportIdentifier(args.importMatchId);
  if (!importMatchId) {
    return [...args.options];
  }

  if (args.options.some((option) => option.matchId === importMatchId)) {
    return [...args.options];
  }

  return [
    ...args.options,
    buildSelectedPredictionImportMatchOption({
      importMatch: args.importMatch,
      importMatchId,
    }),
  ];
}

function buildSelectedPredictionImportMatchOption(args: {
  importMatch: MatchBoxscorePayload | null;
  importMatchId: string;
}): PredictionImportMatchOption {
  return {
    label: args.importMatch
      ? formatPredictionImportBoxscoreLabel(args.importMatch)
      : `Game ${args.importMatchId}`,
    matchId: args.importMatchId,
  };
}

function resolvePredictionImportTeamLocation(args: {
  boxscore: MatchBoxscorePayload | null;
  sideTeamId: string | null;
}): "HOME" | "AWAY" | null {
  const sideTeamId = normalizeImportIdentifier(args.sideTeamId);
  const homeTeam = args.boxscore?.homeTeam ?? null;
  const awayTeam = args.boxscore?.awayTeam ?? null;
  const homeTeamId = normalizeImportIdentifier(homeTeam?.teamId);
  const awayTeamId = normalizeImportIdentifier(awayTeam?.teamId);

  if (sideTeamId) {
    const homeMatches = homeTeamId === sideTeamId;
    const awayMatches = awayTeamId === sideTeamId;

    if (homeMatches && !awayMatches) {
      return "HOME";
    }
    if (awayMatches && !homeMatches) {
      return "AWAY";
    }
    return null;
  }

  if (homeTeam && !awayTeam) {
    return "HOME";
  }
  if (!homeTeam && awayTeam) {
    return "AWAY";
  }

  return null;
}

function describePredictionImportMatchField(args: {
  errorMessage: string | null;
  isLoading: boolean;
  options: readonly PredictionImportMatchOption[];
  selectedMatchId: string;
  teamId: string | null;
}): PredictionImportMatchFieldState {
  if (!normalizeImportIdentifier(args.teamId)) {
    return {
      error: args.errorMessage,
      hint: normalizeImportIdentifier(args.selectedMatchId)
        ? "A specific game is selected below. Enter a team ID to auto-populate recent boxscores."
        : "Enter a team ID, then leave the field to load recent boxscores.",
    };
  }

  if (args.isLoading) {
    return {
      error: args.errorMessage,
      hint: "Loading recent boxscores for this team.",
    };
  }

  if (!args.options.length) {
    return {
      error: args.errorMessage,
      hint: "No recent boxscores are available for this team yet.",
    };
  }

  return {
    error: args.errorMessage,
    hint: "Choose a recent boxscore, or load a specific game ID below.",
  };
}

function formatPredictionImportMatchLabel(match: MatchSummary): string {
  const prefix = match.startTime ? `${formatDate(match.startTime)} • ` : "";
  const opponent = match.opponentTeamName ?? "Unknown opponent";
  const outcome = match.outcome ? `${match.outcome} ` : "";
  const score =
    typeof match.teamScore === "number" && typeof match.opponentScore === "number"
      ? `${match.teamScore}-${match.opponentScore}`
      : null;

  return `${prefix}${opponent}${score ? ` • ${outcome}${score}` : ""}`.trim();
}

function formatPredictionImportBoxscoreLabel(match: MatchBoxscorePayload): string {
  const prefix = match.startTime ? `${formatDate(match.startTime)} • ` : "";
  const homeTeam =
    match.homeTeam?.teamName ?? match.context?.homeTeamName ?? "Home";
  const awayTeam =
    match.awayTeam?.teamName ?? match.context?.awayTeamName ?? "Away";
  const score =
    typeof match.homeTeam?.score === "number" &&
    typeof match.awayTeam?.score === "number"
      ? ` • ${match.homeTeam.score}-${match.awayTeam.score}`
      : "";

  return `${prefix}${homeTeam} vs ${awayTeam}${score}`;
}

function normalizeImportIdentifier(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readClientSideErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : String(error);
}

type MatrixVisibleResult = {
  cell: PredictionMatrixCell;
  teamAPair: PredictionMatrixTacticPair;
  teamBPair: PredictionMatrixTacticPair;
};

type PredictionMatrixOffenseGroup = {
  offense: string;
  pairs: PredictionMatrixTacticPair[];
  expanded: boolean;
};

type PredictionMatrixOverviewCell = {
  result: MatrixVisibleResult | null;
  teamAOffense: string;
  teamAPairs: PredictionMatrixTacticPair[];
  teamBOffense: string;
  teamBPairs: PredictionMatrixTacticPair[];
};

type PredictionMatrixOverviewRow = {
  cells: PredictionMatrixOverviewCell[];
  teamAOffense: string;
  teamAPairs: PredictionMatrixTacticPair[];
};

function MatrixToggleGroup({
  formatOptionLabel,
  hint,
  label,
  onReset,
  onToggle,
  options,
  selectedOptions,
  showReset = true,
}: {
  formatOptionLabel?: (value: string) => string;
  hint?: string;
  label: string;
  onReset: () => void;
  onToggle: (value: string) => void;
  options: readonly string[];
  selectedOptions: readonly string[];
  showReset?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-[0.08em] text-ink-muted uppercase">
          {label}
        </span>
        {showReset ? (
          <Button onClick={onReset} size="sm" variant="ghost">
            Show all
          </Button>
        ) : null}
      </div>
      {hint ? <p className="text-sm leading-6 text-ink-muted">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selectedOptions.includes(option);
          return (
            <Button
              className={cn(active && "border-accent/35 bg-white text-ink")}
              key={option}
              onClick={() => onToggle(option)}
              size="sm"
              variant={active ? "secondary" : "ghost"}
            >
              {formatOptionLabel ? formatOptionLabel(option) : option}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function CompactMatrixToggleGroup({
  formatOptionLabel,
  label,
  onToggle,
  options,
  selectedOptions,
}: {
  formatOptionLabel?: (value: string) => string;
  label: string;
  onToggle: (value: string) => void;
  options: readonly string[];
  selectedOptions: readonly string[];
}) {
  return (
    <div className="grid gap-2">
      <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selectedOptions.includes(option);
          return (
            <Button
              className={cn(
                "min-w-[3rem]",
                active && "border-accent/35 bg-white text-ink",
              )}
              key={option}
              onClick={() => onToggle(option)}
              size="sm"
              title={option}
              variant={active ? "secondary" : "ghost"}
            >
              {formatOptionLabel ? formatOptionLabel(option) : option}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function PredictionMatrixModeSwitch({
  mode,
  onChange,
}: {
  mode: PredictionMatrixMode;
  onChange: (value: PredictionMatrixMode) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
        Matrix view
      </span>
      <div className="hidden flex-wrap gap-2 md:flex">
        <Button
          onClick={() => onChange("overview")}
          size="sm"
          variant={mode === "overview" ? "secondary" : "ghost"}
        >
          Overview
        </Button>
        <Button
          onClick={() => onChange("advanced")}
          size="sm"
          variant={mode === "advanced" ? "secondary" : "ghost"}
        >
          Advanced pair matrix
        </Button>
      </div>
      <div className="grid gap-2 md:hidden">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onChange("overview")}
            size="sm"
            variant={mode === "overview" ? "secondary" : "ghost"}
          >
            Overview
          </Button>
          <Button
            disabled
            size="sm"
            variant={mode === "advanced" ? "secondary" : "ghost"}
          >
            Advanced pair matrix
          </Button>
        </div>
        <p className="text-sm leading-6 text-ink-muted">
          Advanced pair matrix is desktop-only. Use Overview and Defense
          breakdown on mobile.
        </p>
      </div>
    </div>
  );
}

function sortPairs(pairs: PredictionMatrixTacticPair[]) {
  const offenseOrder = new Map<string, number>(
    MATRIX_OFFENSE_SORT_ORDER.map((value, index) => [value, index]),
  );
  const defenseOrder = new Map<string, number>(
    MATRIX_DEFENSE_SORT_ORDER.map((value, index) => [value, index]),
  );

  return [...pairs].sort((left, right) => {
    return (
      (offenseOrder.get(left.offense) ?? Number.MAX_SAFE_INTEGER) -
        (offenseOrder.get(right.offense) ?? Number.MAX_SAFE_INTEGER) ||
      (defenseOrder.get(normalizeMatrixDefenseLabel(left.defense)) ??
        Number.MAX_SAFE_INTEGER) -
        (defenseOrder.get(normalizeMatrixDefenseLabel(right.defense)) ??
          Number.MAX_SAFE_INTEGER) ||
      left.pairId.localeCompare(right.pairId)
    );
  });
}

function listUniquePairOffenses(pairs: readonly PredictionMatrixTacticPair[]) {
  const seen = new Set<string>();
  const offenses: string[] = [];

  for (const pair of sortPairs([...pairs])) {
    if (seen.has(pair.offense)) {
      continue;
    }
    seen.add(pair.offense);
    offenses.push(pair.offense);
  }

  return offenses;
}

function listUniquePairDefenses(pairs: readonly PredictionMatrixTacticPair[]) {
  const seen = new Set<string>();
  const defenses: string[] = [];

  for (const pair of sortPairs([...pairs])) {
    const normalizedDefense = normalizeMatrixDefenseLabel(pair.defense);
    if (seen.has(normalizedDefense)) {
      continue;
    }
    seen.add(normalizedDefense);
    defenses.push(normalizedDefense);
  }

  return defenses;
}

function filterPairsByDefenses(args: {
  enabledDefenses: readonly string[];
  pairs: readonly PredictionMatrixTacticPair[];
}) {
  if (!args.enabledDefenses.length) {
    return [];
  }

  const visible = new Set(args.enabledDefenses.map(normalizeMatrixDefenseLabel));
  return sortPairs([...args.pairs]).filter((pair) =>
    visible.has(normalizeMatrixDefenseLabel(pair.defense)),
  );
}

function reconcileSelectedOptions(
  current: readonly string[],
  allOptions: readonly string[],
): string[] {
  if (!allOptions.length) {
    return [];
  }

  const filtered = current.filter((option) => allOptions.includes(option));
  return filtered.length ? filtered : [...allOptions];
}

function reconcileSelectedDefenseOptions(
  current: readonly string[],
  allOptions: readonly string[],
): string[] {
  if (!allOptions.length) {
    return [];
  }

  const normalizedCurrent = Array.from(
    new Set(current.map(normalizeMatrixDefenseLabel)),
  );
  const filtered = normalizedCurrent.filter((option) => allOptions.includes(option));

  if (!filtered.length) {
    return [...allOptions];
  }

  return allOptions.filter((option) => filtered.includes(option));
}

function toggleRequiredOption(
  selectedOptions: readonly string[],
  value: string,
  allOptions: readonly string[],
): string[] {
  if (!allOptions.includes(value)) {
    return [...selectedOptions];
  }

  if (selectedOptions.includes(value)) {
    if (selectedOptions.length === 1) {
      return [...selectedOptions];
    }
    return allOptions.filter(
      (option) => option !== value && selectedOptions.includes(option),
    );
  }

  const next = new Set(selectedOptions);
  next.add(value);
  return allOptions.filter((option) => next.has(option));
}

function toggleExpandedOffense(
  expandedOffenses: readonly string[],
  offense: string,
  allOffenses: readonly string[],
) {
  return toggleRequiredOption(expandedOffenses, offense, allOffenses);
}

function listExpandedOffenseGroups(
  groups: readonly PredictionMatrixOffenseGroup[],
): PredictionMatrixOffenseGroup[] {
  return groups.filter((group) => group.expanded && group.pairs.length > 0);
}

function countExpandedGroupPairs(
  groups: readonly PredictionMatrixOffenseGroup[],
): number {
  return groups.reduce((sum, group) => sum + group.pairs.length, 0);
}

function resolvePredictionMatrixSurfaceVisibility(mode: PredictionMatrixMode) {
  return {
    showAdvanced: mode === "advanced",
    showOverview: mode === "overview",
  };
}

function areStringListsEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function formatDefenseCount(count: number) {
  return `${count} ${count === 1 ? "defense" : "defenses"}`;
}

function buildOffenseGroups(args: {
  expandedOffenses: readonly string[];
  pairs: readonly PredictionMatrixTacticPair[];
}): PredictionMatrixOffenseGroup[] {
  const groups = new Map<string, PredictionMatrixOffenseGroup>();

  for (const pair of sortPairs([...args.pairs])) {
    const group = groups.get(pair.offense);
    if (group) {
      group.pairs.push(pair);
      continue;
    }
    groups.set(pair.offense, {
      offense: pair.offense,
      pairs: [pair],
      expanded: args.expandedOffenses.includes(pair.offense),
    });
  }

  return Array.from(groups.values());
}

function buildOffenseOverviewRows(args: {
  teamAPairs: readonly PredictionMatrixTacticPair[];
  teamBPairs: readonly PredictionMatrixTacticPair[];
  view: PredictionMatrixView | null;
}): PredictionMatrixOverviewRow[] {
  if (!args.view || !args.teamAPairs.length || !args.teamBPairs.length) {
    return [];
  }

  const teamAPairsByOffense = new Map<string, PredictionMatrixTacticPair[]>();
  const teamBPairsByOffense = new Map<string, PredictionMatrixTacticPair[]>();

  for (const pair of sortPairs([...args.teamAPairs])) {
    const pairsForOffense = teamAPairsByOffense.get(pair.offense);
    if (pairsForOffense) {
      pairsForOffense.push(pair);
      continue;
    }
    teamAPairsByOffense.set(pair.offense, [pair]);
  }

  for (const pair of sortPairs([...args.teamBPairs])) {
    const pairsForOffense = teamBPairsByOffense.get(pair.offense);
    if (pairsForOffense) {
      pairsForOffense.push(pair);
      continue;
    }
    teamBPairsByOffense.set(pair.offense, [pair]);
  }

  return Array.from(teamAPairsByOffense.entries()).map(([teamAOffense, teamAPairs]) => ({
    teamAOffense,
    teamAPairs,
    cells: Array.from(teamBPairsByOffense.entries()).map(([teamBOffense, teamBPairs]) => ({
      teamAOffense,
      teamAPairs,
      teamBOffense,
      teamBPairs,
      result: findMinimaxVisibleResult({
        teamAPairs,
        teamBPairs,
        view: args.view,
      }),
    })),
  }));
}

function findOffenseOverviewCell(args: {
  rows: readonly PredictionMatrixOverviewRow[];
  teamAOffense: string | null;
  teamBOffense: string | null;
}): PredictionMatrixOverviewCell | null {
  if (!args.teamAOffense || !args.teamBOffense) {
    return null;
  }

  const row = args.rows.find((candidate) => candidate.teamAOffense === args.teamAOffense);
  return row?.cells.find((candidate) => candidate.teamBOffense === args.teamBOffense) ?? null;
}

function findSelectedCell(args: {
  teamAPairId: string | null;
  teamBPairId: string | null;
  view: PredictionMatrixView | null;
}): PredictionMatrixCell | null {
  if (!args.view || !args.teamAPairId || !args.teamBPairId) {
    return null;
  }
  const row = args.view.rows.find((candidate) => candidate.teamBPairId === args.teamBPairId);
  return row?.cells.find((candidate) => candidate.teamAPairId === args.teamAPairId) ?? null;
}

function resolveVisibleSelection(args: {
  currentTeamAPairId: string | null;
  currentTeamBPairId: string | null;
  recommendedTeamAPairId: string | null;
  recommendedTeamBPairId: string | null;
  teamAPairs: readonly PredictionMatrixTacticPair[];
  teamBPairs: readonly PredictionMatrixTacticPair[];
  view: PredictionMatrixView | null;
}): { teamAPairId: string; teamBPairId: string } | null {
  if (!args.view || !args.teamAPairs.length || !args.teamBPairs.length) {
    return null;
  }

  if (args.currentTeamAPairId && args.currentTeamBPairId) {
    const currentCell = findSelectedCell({
      teamAPairId: args.currentTeamAPairId,
      teamBPairId: args.currentTeamBPairId,
      view: args.view,
    });
    if (currentCell) {
      return {
        teamAPairId: args.currentTeamAPairId,
        teamBPairId: args.currentTeamBPairId,
      };
    }
  }

  if (!args.currentTeamAPairId && !args.currentTeamBPairId) {
    if (args.recommendedTeamAPairId && args.recommendedTeamBPairId) {
      const recommendedCell = findSelectedCell({
        teamAPairId: args.recommendedTeamAPairId,
        teamBPairId: args.recommendedTeamBPairId,
        view: args.view,
      });
      if (recommendedCell) {
        return {
          teamAPairId: args.recommendedTeamAPairId,
          teamBPairId: args.recommendedTeamBPairId,
        };
      }
    }
  }

  for (const teamAPair of args.teamAPairs) {
    for (const teamBPair of args.teamBPairs) {
      const cell = findSelectedCell({
        teamAPairId: teamAPair.pairId,
        teamBPairId: teamBPair.pairId,
        view: args.view,
      });
      if (!cell) {
        continue;
      }
      return {
        teamAPairId: teamAPair.pairId,
        teamBPairId: teamBPair.pairId,
      };
    }
  }

  return null;
}

function findMinimaxVisibleResult(args: {
  teamAPairs: readonly PredictionMatrixTacticPair[];
  teamBPairs: readonly PredictionMatrixTacticPair[];
  view: PredictionMatrixView | null;
}): MatrixVisibleResult | null {
  if (!args.view || !args.teamAPairs.length || !args.teamBPairs.length) {
    return null;
  }

  const rowsByTeamBPairId = new Map(
    args.view.rows.map((row) => [row.teamBPairId, row] as const),
  );

  let recommendation:
    | (MatrixVisibleResult & {
        averageMargin: number;
        worstCaseMargin: number;
      })
    | null = null;

  for (const teamAPair of args.teamAPairs) {
    let worstCase: MatrixVisibleResult | null = null;
    let marginSum = 0;
    let marginCount = 0;

    for (const teamBPair of args.teamBPairs) {
      const row = rowsByTeamBPairId.get(teamBPair.pairId);
      if (!row) {
        continue;
      }
      const cell =
        row.cells.find((candidate) => candidate.teamAPairId === teamAPair.pairId) ??
        null;
      if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
        continue;
      }

      marginSum += cell.predictedPointDiff;
      marginCount += 1;

      if (
        !worstCase ||
        cell.predictedPointDiff < (worstCase.cell.predictedPointDiff ?? Number.POSITIVE_INFINITY)
      ) {
        worstCase = {
          cell,
          teamAPair,
          teamBPair,
        };
      }
    }

    if (!worstCase || marginCount === 0) {
      continue;
    }

    const worstCaseMargin =
      worstCase.cell.predictedPointDiff ?? Number.NEGATIVE_INFINITY;
    const averageMargin = marginSum / marginCount;

    if (
      !recommendation ||
      worstCaseMargin > recommendation.worstCaseMargin ||
      (worstCaseMargin === recommendation.worstCaseMargin &&
        averageMargin > recommendation.averageMargin)
    ) {
      recommendation = {
        ...worstCase,
        averageMargin,
        worstCaseMargin,
      };
    }
  }

  return recommendation
    ? {
        cell: recommendation.cell,
        teamAPair: recommendation.teamAPair,
        teamBPair: recommendation.teamBPair,
      }
    : null;
}

function findExtremeVisibleCell(args: {
  comparator: (candidate: number, current: number) => boolean;
  teamAPairIds: ReadonlySet<string>;
  teamBPairIds: ReadonlySet<string>;
  teamAPairs: readonly PredictionMatrixTacticPair[];
  teamBPairs: readonly PredictionMatrixTacticPair[];
  view: PredictionMatrixView | null;
}): MatrixVisibleResult | null {
  if (!args.view) {
    return null;
  }

  const teamAPairsById = new Map(
    args.teamAPairs.map((pair) => [pair.pairId, pair] as const),
  );
  const teamBPairsById = new Map(
    args.teamBPairs.map((pair) => [pair.pairId, pair] as const),
  );

  let best: MatrixVisibleResult | null = null;
  for (const row of args.view.rows) {
    if (!args.teamBPairIds.has(row.teamBPairId)) {
      continue;
    }
    const teamBPair = teamBPairsById.get(row.teamBPairId);
    if (!teamBPair) {
      continue;
    }
    for (const cell of row.cells) {
      if (!args.teamAPairIds.has(cell.teamAPairId)) {
        continue;
      }
      if (!cell.available || typeof cell.predictedPointDiff !== "number") {
        continue;
      }
      const teamAPair = teamAPairsById.get(cell.teamAPairId);
      if (!teamAPair) {
        continue;
      }
      if (
        !best ||
        args.comparator(
          cell.predictedPointDiff,
          best.cell.predictedPointDiff ?? Number.NEGATIVE_INFINITY,
        )
      ) {
        best = {
          cell,
          teamAPair,
          teamBPair,
        };
      }
    }
  }

  return best;
}

function matchesVisibleResult(args: {
  result: MatrixVisibleResult | null;
  teamAPairId: string;
  teamBPairId: string;
}) {
  return Boolean(
    args.result &&
      args.result.teamAPair.pairId === args.teamAPairId &&
      args.result.teamBPair.pairId === args.teamBPairId,
  );
}

function formatCellMargin(cell: PredictionMatrixCell | null) {
  if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
    return "Unavailable";
  }
  return `${cell.predictedPointDiff > 0 ? "+" : ""}${cell.predictedPointDiff.toFixed(1)}`;
}

function formatCompactCellMargin(cell: PredictionMatrixCell | null) {
  if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
    return "—";
  }
  return formatCellMargin(cell);
}

function normalizeMatrixDefenseLabel(defense: string) {
  return MATRIX_DEFENSE_CANONICAL_LABELS[defense] ?? defense;
}

function abbreviateMatrixOffenseLabel(offense: string) {
  return MATRIX_OFFENSE_ABBREVIATIONS[offense] ?? offense;
}

function abbreviateMatrixDefenseLabel(defense: string) {
  const normalizedDefense = normalizeMatrixDefenseLabel(defense);
  return MATRIX_DEFENSE_ABBREVIATIONS[normalizedDefense] ?? normalizedDefense;
}

function getPredictionCellHeatmapLevel(cell: PredictionMatrixCell | null) {
  if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
    return null;
  }

  const normalized = cell.predictedPointDiff / MATRIX_CELL_HEATMAP_MAX_ABS_MARGIN;
  return Math.max(-1, Math.min(1, normalized));
}

function getPredictionCellHeatmapStyle(cell: PredictionMatrixCell | null) {
  const level = getPredictionCellHeatmapLevel(cell);
  if (level === null) {
    return {
      backgroundColor: "rgba(15, 23, 42, 0.03)",
      borderColor: "rgba(15, 23, 42, 0.08)",
    };
  }

  const intensity = Math.abs(level);
  if (level > 0) {
    return {
      backgroundColor: `rgba(34, 197, 94, ${0.06 + intensity * 0.24})`,
      borderColor: `rgba(34, 197, 94, ${0.14 + intensity * 0.22})`,
    };
  }

  if (level < 0) {
    return {
      backgroundColor: `rgba(239, 68, 68, ${0.06 + intensity * 0.24})`,
      borderColor: `rgba(239, 68, 68, ${0.14 + intensity * 0.22})`,
    };
  }

  return {
    backgroundColor: "rgba(15, 23, 42, 0.04)",
    borderColor: "rgba(15, 23, 42, 0.08)",
  };
}

function formatCellScoreline(
  cell: PredictionMatrixCell | null,
  teamALabel: string,
  teamBLabel: string,
) {
  if (
    !cell?.available ||
    typeof cell.predictedTeamAScore !== "number" ||
    typeof cell.predictedTeamBScore !== "number"
  ) {
    return "No safe score estimate";
  }
  return `${teamALabel} ${cell.predictedTeamAScore.toFixed(1)} • ${teamBLabel} ${cell.predictedTeamBScore.toFixed(1)}`;
}

function formatTacticPairLabel(pair: PredictionMatrixTacticPair) {
  return `${pair.offense} / ${pair.defense}${pair.estimated ? " (Estimated)" : ""}`;
}

function renderMatrixResultDetail(args: {
  emptyDetail: string;
  note?: string;
  result: MatrixVisibleResult | null;
  teamALabel: string;
  teamBLabel: string;
}) {
  if (!args.result) {
    return args.emptyDetail;
  }

  return (
    <>
      <span className="block">
        {args.teamALabel}: {formatTacticPairLabel(args.result.teamAPair)}
      </span>
      <span className="block">
        {args.teamBLabel}: {formatTacticPairLabel(args.result.teamBPair)}
      </span>
      <span className="block">
        {formatCellScoreline(args.result.cell, args.teamALabel, args.teamBLabel)}
      </span>
      {args.note ? <span className="block">{args.note}</span> : null}
    </>
  );
}

function EstimatedMatrixMarker({ className }: { className?: string }) {
  return (
    <span
      aria-label="Estimated tactic pair"
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full bg-note shadow-[0_0_0_1px_rgba(194,65,12,0.18)]",
        className,
      )}
      title="Estimated tactic pair"
    />
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Number(parsed.toFixed(2));
}

export const __testing = {
  abbreviateMatrixDefenseLabel,
  abbreviateMatrixOffenseLabel,
  applyPredictionSideResolvedTeamName,
  buildOffenseGroups,
  buildOffenseOverviewRows,
  buildPredictionImportMatchOptions,
  commitPredictionSideTeamIdChange,
  countExpandedGroupPairs,
  describePredictionImportMatchField,
  ensurePredictionImportMatchOption,
  filterPairsByDefenses,
  findExtremeVisibleCell,
  findOffenseOverviewCell,
  findMinimaxVisibleResult,
  findSelectedCell,
  formatDefenseCount,
  formatCompactCellMargin,
  getPredictionCellHeatmapLevel,
  listUniquePairOffenses,
  listUniquePairDefenses,
  listExpandedOffenseGroups,
  reconcileSelectedOptions,
  reconcileSelectedDefenseOptions,
  resolvePredictionMatrixSurfaceVisibility,
  resolvePredictionImportTeamLocation,
  resolvePredictionSideRecentMatches,
  resolveVisibleSelection,
  sortPairs,
  toggleExpandedOffense,
  toggleRequiredOption,
  usesCurrentTeamSchedule,
};
