"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  accessibleMatchesQueryOptions,
  boxscoreQueryOptions,
  predictionMatrixQueryOptions,
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
import type {
  AccessibleMatchSummary,
  MatchBoxscorePayload,
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

type GamePredictionPanelProps = {
  currentTeamId: string | null;
  currentTeamName: string | null;
};

type ImportSide = "teamA" | "teamB";

const ratingGridClassName = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
const MATRIX_CELL_HEATMAP_MAX_ABS_MARGIN = 20;

export function GamePredictionPanel({
  currentTeamId,
  currentTeamName,
}: GamePredictionPanelProps) {
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
  const [teamAImportMatchId, setTeamAImportMatchId] = useState("");
  const [teamBImportMatchId, setTeamBImportMatchId] = useState("");
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
      setTeamAImportMatchId(storedDraft.teamA.sourceMatchId ?? "");
      setTeamBImportMatchId(storedDraft.teamB.sourceMatchId ?? "");
      return;
    }

    setDraft(defaultDraft);
  }, [defaultDraft]);

  useEffect(() => {
    writePredictionDraftToStorage(
      typeof window === "undefined" ? null : window.sessionStorage,
      draft,
    );
  }, [draft]);

  const accessibleMatchesQuery = useQuery(accessibleMatchesQueryOptions());
  const accessibleMatches = useMemo(
    () => sortAccessibleMatches(accessibleMatchesQuery.data ?? []),
    [accessibleMatchesQuery.data],
  );
  const teamAImportQuery = useQuery({
    ...boxscoreQueryOptions({ matchId: teamAImportMatchId || "" }),
    enabled: Boolean(teamAImportMatchId),
  });
  const teamBImportQuery = useQuery({
    ...boxscoreQueryOptions({ matchId: teamBImportMatchId || "" }),
    enabled: Boolean(teamBImportMatchId),
  });

  const matrixMutation = useMutation({
    mutationFn: async (request: PredictionDraft) =>
      queryClient.fetchQuery(predictionMatrixQueryOptions({ request })),
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
    () =>
      Math.max(
        teamBColumnGroups.reduce(
          (sum, group) => sum + (group.expanded ? group.pairs.length : 1),
          0,
        ),
        1,
      ),
    [teamBColumnGroups],
  );
  const activeViewRowsByTeamBPairId = useMemo(
    () => new Map((activeView?.rows ?? []).map((row) => [row.teamBPairId, row] as const)),
    [activeView],
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
  }, [matrix]);

  useEffect(() => {
    setExpandedTeamAOffenses((current) =>
      reconcileSelectedOptions(current, teamAOffenseOptions),
    );
    setEnabledTeamADefenses((current) =>
      reconcileSelectedOptions(current, teamADefenseOptions),
    );
  }, [teamADefenseOptions, teamAOffenseOptions]);

  useEffect(() => {
    setExpandedTeamBOffenses((current) =>
      reconcileSelectedOptions(current, teamBOffenseOptions),
    );
    setEnabledTeamBDefenses((current) =>
      reconcileSelectedOptions(current, teamBDefenseOptions),
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
                  setTeamAImportMatchId("");
                  setTeamBImportMatchId("");
                  setSelectedTeamAPairId(null);
                  setSelectedTeamBPairId(null);
                  setSelectedViewId(null);
                  matrixMutation.reset();
                }}
                size="sm"
                variant="ghost"
              >
                Start blank matchup
              </Button>
              <Button
                loading={matrixMutation.isPending}
                onClick={() => void matrixMutation.mutateAsync(draft)}
                size="sm"
                variant="secondary"
              >
                Run matchup matrix
              </Button>
            </div>
          }
          description="Build any matchup with editable team sheets, import either team from any accessible match, and compare every tactic pair in one matrix."
          title="Game prediction"
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
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
          <StatCard
            className={cn(bestResult && "border-success/20 bg-success/10")}
            detail={renderMatrixResultDetail({
              emptyDetail:
                "Run the matrix to surface the strongest upside cell in the current visible view.",
              note: "Exploration only. This ignores opponent adaptation.",
              result: bestResult,
              teamALabel: selectedTeamALabel,
              teamBLabel: selectedTeamBLabel,
            })}
            label="Best visible upside"
            value={bestResult ? formatCellMargin(bestResult.cell) : matrix ? "Unavailable" : "Not run"}
          />
          <StatCard
            className={cn(worstResult && "border-danger-border bg-danger-bg")}
            detail={renderMatrixResultDetail({
              emptyDetail:
                "Run the matrix to surface the harshest downside cell in the current visible view.",
              note: "Exploration only. This ignores opponent adaptation.",
              result: worstResult,
              teamALabel: selectedTeamALabel,
              teamBLabel: selectedTeamBLabel,
            })}
            label="Worst visible downside"
            value={worstResult ? formatCellMargin(worstResult.cell) : matrix ? "Unavailable" : "Not run"}
          />
        </div>

        {matrixMutation.error ? (
          <Alert>{String(matrixMutation.error)}</Alert>
        ) : null}

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

        <div className="grid gap-4 xl:grid-cols-2">
          <PredictionSideCard
            accessibleMatches={accessibleMatches}
            importMatch={teamAImportQuery.data ?? null}
            importMatchId={teamAImportMatchId}
            importMatchLoading={teamAImportQuery.isFetching}
            importSide="teamA"
            onImportMatchIdChange={setTeamAImportMatchId}
            onImportTeam={(boxscore, teamLocation) =>
              importPredictionSide({
                boxscore,
                setDraft,
                side: "teamA",
                teamLocation,
              })
            }
            onSideChange={(updater) =>
              setDraft((current) => ({ ...current, teamA: updater(current.teamA) }))
            }
            side={draft.teamA}
            sideLabel="Team A"
          />

          <PredictionSideCard
            accessibleMatches={accessibleMatches}
            importMatch={teamBImportQuery.data ?? null}
            importMatchId={teamBImportMatchId}
            importMatchLoading={teamBImportQuery.isFetching}
            importSide="teamB"
            onImportMatchIdChange={setTeamBImportMatchId}
            onImportTeam={(boxscore, teamLocation) =>
              importPredictionSide({
                boxscore,
                setDraft,
                side: "teamB",
                teamLocation,
              })
            }
            onSideChange={(updater) =>
              setDraft((current) => ({ ...current, teamB: updater(current.teamB) }))
            }
            side={draft.teamB}
            sideLabel="Team B"
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
            <div className="grid gap-4 rounded-card border border-black/8 bg-white p-4 xl:grid-cols-2">
              <MatrixToggleGroup
                hint="Hide or reopen whole Team A offense families. These buttons mirror the disclosure rows in the matrix body."
                label={`Rows · ${selectedTeamALabel} offense groups`}
                onReset={() => setExpandedTeamAOffenses([...teamAOffenseOptions])}
                onToggle={(offense) =>
                  setExpandedTeamAOffenses((current) =>
                    toggleExpandedOffense(current, offense, teamAOffenseOptions),
                  )
                }
                options={teamAOffenseOptions}
                selectedOptions={expandedTeamAOffenses}
              />
              <MatrixToggleGroup
                hint="Keep only the Team A defenses you care about inside the visible offense groups."
                label={`Rows · ${selectedTeamALabel} defenses`}
                onReset={() => setEnabledTeamADefenses([...teamADefenseOptions])}
                onToggle={(defense) =>
                  setEnabledTeamADefenses((current) =>
                    toggleRequiredOption(current, defense, teamADefenseOptions),
                  )
                }
                options={teamADefenseOptions}
                selectedOptions={enabledTeamADefenses}
              />
              <MatrixToggleGroup
                hint="Hide or reopen whole Team B offense families. These buttons mirror the disclosure state in the matrix header."
                label={`Columns · ${selectedTeamBLabel} offense groups`}
                onReset={() => setExpandedTeamBOffenses([...teamBOffenseOptions])}
                onToggle={(offense) =>
                  setExpandedTeamBOffenses((current) =>
                    toggleExpandedOffense(current, offense, teamBOffenseOptions),
                  )
                }
                options={teamBOffenseOptions}
                selectedOptions={expandedTeamBOffenses}
              />
              <MatrixToggleGroup
                hint="Keep only the Team B defenses you care about inside the visible offense groups."
                label={`Columns · ${selectedTeamBLabel} defenses`}
                onReset={() => setEnabledTeamBDefenses([...teamBDefenseOptions])}
                onToggle={(defense) =>
                  setEnabledTeamBDefenses((current) =>
                    toggleRequiredOption(current, defense, teamBDefenseOptions),
                  )
                }
                options={teamBDefenseOptions}
                selectedOptions={enabledTeamBDefenses}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {matrix.views.map((view) => (
                <Button
                  key={view.viewId}
                  onClick={() => setSelectedViewId(view.viewId)}
                  size="sm"
                  variant={view.viewId === activeView?.viewId ? "secondary" : "ghost"}
                >
                  {view.label}
                </Button>
              ))}
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
                    <div className="hidden md:block">
                      <div className="max-h-[72vh] overflow-auto rounded-card border border-black/8 bg-white">
                        <table className="w-max min-w-full border-collapse text-left">
                          <thead className="bg-white">
                            <tr>
                              <th className="sticky left-0 top-0 z-50 min-w-[14rem] border-b border-black/10 bg-white px-4 py-3 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]">
                                <div className="grid gap-1">
                                  <span className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                    Rows
                                  </span>
                                  <span className="text-sm font-semibold text-ink">
                                    {selectedTeamALabel} tactics
                                  </span>
                                </div>
                              </th>
                              <th
                                className="sticky top-0 z-40 border-b border-black/10 bg-white px-4 py-3 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]"
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
                              <th className="sticky left-0 top-[4.35rem] z-50 min-w-[14rem] border-b border-black/10 bg-white px-4 py-3 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]">
                                <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                  {selectedTeamALabel} offense groups
                                </span>
                              </th>
                              {teamBColumnGroups.map((group) => {
                                const highlightsSelectedOffense =
                                  selectedTeamBPair?.offense === group.offense;

                                return (
                                  <th
                                    className="sticky top-[4.35rem] z-40 border-b border-black/10 bg-white px-2 py-2 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]"
                                    colSpan={group.expanded ? group.pairs.length : 1}
                                    key={group.offense}
                                    style={{
                                      backgroundColor: highlightsSelectedOffense
                                        ? "#fff4ea"
                                        : "#ffffff",
                                    }}
                                  >
                                    <button
                                      className="grid w-full gap-1 rounded-[1rem] border border-black/8 bg-white px-3 py-2 text-left transition hover:border-accent/35 hover:bg-white"
                                      onClick={() =>
                                        setExpandedTeamBOffenses((current) =>
                                          toggleExpandedOffense(
                                            current,
                                            group.offense,
                                            teamBOffenseOptions,
                                          ),
                                        )
                                      }
                                      type="button"
                                    >
                                      <span className="flex items-center justify-between gap-3">
                                        <span className="text-[0.75rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                          {group.offense}
                                        </span>
                                        <span
                                          aria-hidden="true"
                                          className="text-sm font-semibold text-ink"
                                        >
                                          {group.expanded ? "-" : "+"}
                                        </span>
                                      </span>
                                      <span className="text-[0.7rem] leading-5 text-ink-muted">
                                        {group.expanded
                                          ? `${group.pairs.length} ${selectedTeamBLabel} defenses`
                                          : "Hidden"}
                                      </span>
                                    </button>
                                  </th>
                                );
                              })}
                            </tr>
                            <tr>
                              <th className="sticky left-0 top-[8.7rem] z-50 min-w-[14rem] border-b border-black/10 bg-white px-4 py-3 text-left shadow-[0_1px_0_rgba(15,23,42,0.08)]">
                                <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                  {selectedTeamBLabel} defense
                                </span>
                              </th>
                              {teamBColumnGroups.map((group) =>
                                group.expanded ? (
                                  group.pairs.map((pair) => (
                                    <th
                                      className="sticky top-[8.7rem] z-30 min-w-[4.75rem] border-b border-black/10 bg-white px-2 py-2 text-center shadow-[0_1px_0_rgba(15,23,42,0.08)]"
                                      key={pair.pairId}
                                      style={{
                                        backgroundColor:
                                          selectedTeamBPairId === pair.pairId
                                            ? "#fff4ea"
                                            : "#ffffff",
                                      }}
                                    >
                                      <div className="grid gap-1">
                                        <span className="text-[0.78rem] font-semibold leading-5 text-ink">
                                          {pair.defense}
                                        </span>
                                        {pair.estimated ? (
                                          <span className="text-[0.65rem] font-semibold text-note">
                                            Estimated
                                          </span>
                                        ) : null}
                                      </div>
                                    </th>
                                  ))
                                ) : (
                                  <th
                                    className="sticky top-[8.7rem] z-30 min-w-[4.75rem] border-b border-black/10 bg-white px-2 py-2 text-center shadow-[0_1px_0_rgba(15,23,42,0.08)]"
                                    key={`${group.offense}-collapsed`}
                                  >
                                    <span className="text-[0.68rem] font-semibold text-ink-muted">
                                      Hidden
                                    </span>
                                  </th>
                                ),
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {teamARowGroups.map((group) => (
                              <Fragment key={group.offense}>
                                <tr>
                                  <th
                                    className="sticky left-0 z-20 border-y border-black/10 bg-white px-4 py-3 text-left shadow-[1px_0_0_rgba(15,23,42,0.06)]"
                                    style={{
                                      backgroundColor:
                                        selectedTeamAPair?.offense === group.offense
                                          ? "#fff4ea"
                                          : "#ffffff",
                                    }}
                                  >
                                    <button
                                      className="grid w-full gap-1 text-left"
                                      onClick={() =>
                                        setExpandedTeamAOffenses((current) =>
                                          toggleExpandedOffense(
                                            current,
                                            group.offense,
                                            teamAOffenseOptions,
                                          ),
                                        )
                                      }
                                      type="button"
                                    >
                                      <span className="flex items-center justify-between gap-3">
                                        <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                          {selectedTeamALabel} offense
                                        </span>
                                        <span
                                          aria-hidden="true"
                                          className="text-sm font-semibold text-ink"
                                        >
                                          {group.expanded ? "-" : "+"}
                                        </span>
                                      </span>
                                      <span className="text-sm font-semibold text-ink">
                                        {group.offense}
                                      </span>
                                      <span className="text-[0.7rem] leading-5 text-ink-muted">
                                        {group.expanded
                                          ? `${group.pairs.length} ${selectedTeamALabel} defenses`
                                          : "Rows hidden"}
                                      </span>
                                    </button>
                                  </th>
                                  <td
                                    className="border-y border-black/10 bg-white px-0 py-0"
                                    colSpan={renderedColumnCount}
                                  />
                                </tr>
                                {group.expanded
                                  ? group.pairs.map((teamAPair) => {
                                      const isSelectedRow =
                                        selectedTeamAPairId === teamAPair.pairId;

                                      return (
                                        <tr key={teamAPair.pairId}>
                                          <th
                                            className="sticky left-0 z-20 border-b border-black/10 bg-white px-4 py-2 text-left align-top shadow-[1px_0_0_rgba(15,23,42,0.06)]"
                                            style={{
                                              backgroundColor: isSelectedRow
                                                ? "#fff4ea"
                                                : "#ffffff",
                                            }}
                                          >
                                            <div className="grid gap-1">
                                              <span className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                                                {teamAPair.offense}
                                              </span>
                                              <strong className="text-[0.82rem] leading-5 text-ink">
                                                {teamAPair.defense}
                                              </strong>
                                              {teamAPair.estimated ? (
                                                <span className="text-xs font-semibold text-note">
                                                  Estimated
                                                </span>
                                              ) : null}
                                            </div>
                                          </th>
                                          {teamBColumnGroups.map((teamBGroup) =>
                                            teamBGroup.expanded ? (
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
                                                  selectedTeamBPairId === teamBPair.pairId;
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
                                                    className="border-b border-black/10 p-1 align-top"
                                                    key={`${teamBPair.pairId}-${teamAPair.pairId}`}
                                                  >
                                                    <button
                                                      className={cn(
                                                        "grid min-h-[3.35rem] w-full gap-1 rounded-[0.8rem] border px-2 py-2 text-left transition",
                                                        isSelected &&
                                                          "ring-2 ring-accent/35",
                                                      )}
                                                      onClick={() =>
                                                        handleMatrixSelection({
                                                          matrix,
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
                                                        <span className="flex flex-wrap gap-1">
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
                                                        {formatCompactCellMargin(cell)}
                                                      </strong>
                                                    </button>
                                                  </td>
                                                );
                                              })
                                            ) : (
                                              <td
                                                className="border-b border-black/10 bg-white p-1 align-top"
                                                key={`${teamAPair.pairId}-${teamBGroup.offense}-collapsed`}
                                              >
                                                <button
                                                  className="grid min-h-[3.35rem] w-full place-items-center rounded-[0.8rem] border border-dashed border-black/10 bg-white px-2 py-2 text-center transition hover:border-accent/35 hover:bg-white"
                                                  onClick={() =>
                                                    setExpandedTeamBOffenses(
                                                      (current) =>
                                                        toggleExpandedOffense(
                                                          current,
                                                          teamBGroup.offense,
                                                          teamBOffenseOptions,
                                                        ),
                                                    )
                                                  }
                                                  type="button"
                                                >
                                                  <span className="text-[0.68rem] font-semibold text-ink">
                                                    Show
                                                  </span>
                                                </button>
                                              </td>
                                            ),
                                          )}
                                        </tr>
                                      );
                                    })
                                  : null}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="grid gap-4 md:hidden">
                      <Alert tone="note">
                        Rows are {selectedTeamALabel}. Columns are {selectedTeamBLabel}.
                        Positive margins still favor {selectedTeamALabel}.
                      </Alert>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={`${selectedTeamALabel} tactic pair`}>
                          <Select
                            onChange={(event) => {
                              const nextTeamAPairId = event.currentTarget.value;
                              handleMatrixSelection({
                                matrix,
                                setDraft,
                                setSelectedTeamAPairId,
                                setSelectedTeamBPairId,
                                teamAPairId: nextTeamAPairId,
                                teamBPairId:
                                  selectedTeamBPairId ??
                                  visibleTeamBPairs[0]?.pairId ??
                                  "",
                              });
                            }}
                            value={selectedTeamAPairId ?? ""}
                          >
                            {visibleTeamAPairs.map((pair) => (
                              <option key={pair.pairId} value={pair.pairId}>
                                {formatTacticPairLabel(pair)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={`${selectedTeamBLabel} tactic pair`}>
                          <Select
                            onChange={(event) => {
                              const nextTeamBPairId = event.currentTarget.value;
                              handleMatrixSelection({
                                matrix,
                                setDraft,
                                setSelectedTeamAPairId,
                                setSelectedTeamBPairId,
                                teamAPairId:
                                  selectedTeamAPairId ??
                                  visibleTeamAPairs[0]?.pairId ??
                                  "",
                                teamBPairId: nextTeamBPairId,
                              });
                            }}
                            value={selectedTeamBPairId ?? ""}
                          >
                            {visibleTeamBPairs.map((pair) => (
                              <option key={pair.pairId} value={pair.pairId}>
                                {formatTacticPairLabel(pair)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <Panel as="article" padding="sm" variant="solid">
                        <SectionHeading
                          title="Inspected tactic matchup"
                          titleAs="h4"
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-card border border-black/8 bg-white p-4">
                            <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                              {selectedTeamALabel}
                            </span>
                            <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                              {selectedTeamAPair
                                ? formatTacticPairLabel(selectedTeamAPair)
                                : "No inspected tactic pair selected"}
                            </p>
                          </div>
                          <div className="rounded-card border border-black/8 bg-white p-4">
                            <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                              {selectedTeamBLabel}
                            </span>
                            <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                              {selectedTeamBPair
                                ? formatTacticPairLabel(selectedTeamBPair)
                                : "No inspected tactic pair selected"}
                            </p>
                          </div>
                        </div>
                        <StatCard
                          detail={formatCellScoreline(
                            selectedCell,
                            selectedTeamALabel,
                            selectedTeamBLabel,
                          )}
                          label="Predicted margin"
                          value={formatCellMargin(selectedCell)}
                        />
                      </Panel>

                      <Panel as="article" padding="sm" variant="solid">
                        <SectionHeading
                          title="Recommended tactic matchup"
                          titleAs="h4"
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-card border border-black/8 bg-white p-4">
                            <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                              {selectedTeamALabel}
                            </span>
                            <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                              {recommendedResult
                                ? formatTacticPairLabel(recommendedResult.teamAPair)
                                : "No recommended tactic pair available"}
                            </p>
                          </div>
                          <div className="rounded-card border border-black/8 bg-white p-4">
                            <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
                              {selectedTeamBLabel} best response
                            </span>
                            <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                              {recommendedResult
                                ? formatTacticPairLabel(recommendedResult.teamBPair)
                                : "No visible counter available"}
                            </p>
                          </div>
                        </div>
                        <StatCard
                          className={cn(
                            recommendedResult && "border-note-border bg-note-bg",
                          )}
                          detail={renderMatrixResultDetail({
                            emptyDetail:
                              "Run the matrix to recommend the best worst-case tactic pairing.",
                            note:
                              "Assumes Team B chooses the visible counter that minimizes Team A's margin.",
                            result: recommendedResult,
                            teamALabel: selectedTeamALabel,
                            teamBLabel: selectedTeamBLabel,
                          })}
                          label="Worst-case margin"
                          value={
                            recommendedResult
                              ? formatCellMargin(recommendedResult.cell)
                              : "Unavailable"
                          }
                        />
                        <p className="text-sm leading-7 text-ink-muted">
                          The row labels belong to {selectedTeamALabel}. The column
                          headers belong to {selectedTeamBLabel}. Best and worst
                          visible cards are exploration-only because they ignore
                          opponent adaptation.
                        </p>
                      </Panel>
                    </div>
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
  accessibleMatches: AccessibleMatchSummary[];
  importMatch: MatchBoxscorePayload | null;
  importMatchId: string;
  importMatchLoading: boolean;
  importSide: ImportSide;
  onImportMatchIdChange: (value: string) => void;
  onImportTeam: (
    boxscore: MatchBoxscorePayload,
    teamLocation: "HOME" | "AWAY",
  ) => void;
  onSideChange: (updater: (current: PredictionSideInput) => PredictionSideInput) => void;
  side: PredictionSideInput;
  sideLabel: string;
};

function PredictionSideCard({
  accessibleMatches,
  importMatch,
  importMatchId,
  importMatchLoading,
  onImportMatchIdChange,
  onImportTeam,
  onSideChange,
  side,
  sideLabel,
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
        <Field label={`${sideLabel} team ID`}>
          <Input
            onChange={(event) => {
              const teamId = event.currentTarget.value.trim() || null;
              onSideChange((current) => ({
                ...current,
                teamId,
              }));
            }}
            value={side.teamId ?? ""}
          />
        </Field>
        <Field
          hint="Choose any accessible match, then pick which club from that match should populate this side."
          label="Import from match"
        >
          <Select
            onChange={(event) => onImportMatchIdChange(event.currentTarget.value)}
            value={importMatchId}
          >
            <option value="">No imported match</option>
            {accessibleMatches.map((match) => (
              <option key={match.matchId} value={match.matchId}>
                {formatAccessibleMatchLabel(match)}
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
      </div>

      {importMatchId ? (
        <div className="grid gap-3 rounded-card border border-black/8 bg-white/70 p-4">
          <strong className="text-sm text-ink">Use a team from the selected match</strong>
          {importMatchLoading ? (
            <p className="text-sm text-ink-muted">Loading the match details.</p>
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

function importPredictionSide(args: {
  boxscore: MatchBoxscorePayload;
  setDraft: Dispatch<SetStateAction<PredictionDraft>>;
  side: ImportSide;
  teamLocation: "HOME" | "AWAY";
}) {
  const team =
    args.teamLocation === "HOME" ? args.boxscore.homeTeam : args.boxscore.awayTeam;
  if (!team) {
    return;
  }

  const importedSide = createPredictionSideFromBoxscoreTeam({
    match: args.boxscore,
    team,
    teamLocation: args.teamLocation,
  });

  args.setDraft((current) => ({
    ...current,
    [args.side]: importedSide,
  }));
}

function handleMatrixSelection(args: {
  matrix: PredictionMatrixResult;
  setDraft: Dispatch<SetStateAction<PredictionDraft>>;
  setSelectedTeamAPairId: Dispatch<SetStateAction<string | null>>;
  setSelectedTeamBPairId: Dispatch<SetStateAction<string | null>>;
  teamAPairId: string;
  teamBPairId: string;
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

function sortAccessibleMatches(matches: AccessibleMatchSummary[]) {
  return [...matches].sort((left, right) =>
    String(right.startTime ?? "").localeCompare(String(left.startTime ?? "")),
  );
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

function MatrixToggleGroup({
  hint,
  label,
  onReset,
  onToggle,
  options,
  selectedOptions,
}: {
  hint?: string;
  label: string;
  onReset: () => void;
  onToggle: (value: string) => void;
  options: readonly string[];
  selectedOptions: readonly string[];
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-[0.08em] text-ink-muted uppercase">
          {label}
        </span>
        <Button onClick={onReset} size="sm" variant="ghost">
          Show all
        </Button>
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
              {option}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function formatAccessibleMatchLabel(match: AccessibleMatchSummary): string {
  const teams = [
    match.teamId ? `Team ${match.teamId}` : "Tracked team",
    match.opponentTeamName ?? "Opponent",
  ].join(" vs ");
  const score =
    typeof match.teamScore === "number" && typeof match.opponentScore === "number"
      ? ` • ${match.teamScore}-${match.opponentScore}`
      : "";
  const startTime = match.startTime ? `${formatDate(match.startTime)} • ` : "";
  return `${startTime}${teams}${score}`;
}

function sortPairs(pairs: PredictionMatrixTacticPair[]) {
  const offenseOrder = new Map<string, number>(
    GAME_PREDICTION_OFFENSE_OPTIONS.map((value, index) => [value, index]),
  );
  const defenseOrder = new Map<string, number>(
    GAME_PREDICTION_DEFENSE_OPTIONS.map((value, index) => [value, index]),
  );

  return [...pairs].sort((left, right) => {
    return (
      (offenseOrder.get(left.offense) ?? Number.MAX_SAFE_INTEGER) -
        (offenseOrder.get(right.offense) ?? Number.MAX_SAFE_INTEGER) ||
      (defenseOrder.get(left.defense) ?? Number.MAX_SAFE_INTEGER) -
        (defenseOrder.get(right.defense) ?? Number.MAX_SAFE_INTEGER) ||
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
    if (seen.has(pair.defense)) {
      continue;
    }
    seen.add(pair.defense);
    defenses.push(pair.defense);
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

  const visible = new Set(args.enabledDefenses);
  return sortPairs([...args.pairs]).filter((pair) => visible.has(pair.defense));
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
  buildOffenseGroups,
  filterPairsByDefenses,
  findExtremeVisibleCell,
  findMinimaxVisibleResult,
  findSelectedCell,
  formatCompactCellMargin,
  getPredictionCellHeatmapLevel,
  listUniquePairOffenses,
  listUniquePairDefenses,
  reconcileSelectedOptions,
  resolveVisibleSelection,
  sortPairs,
  toggleExpandedOffense,
  toggleRequiredOption,
};
