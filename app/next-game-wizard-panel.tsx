"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  applyLineupAvailabilityOverride,
  readTeamLineupAvailabilityOverride,
  toggleExcludedPlayerId,
  writeTeamLineupAvailabilityOverride,
  type EffectiveLineupHelperRosterPlayer,
  type TeamLineupAvailabilityOverride,
} from "@/app/lineup-availability-state";
import {
  NEXT_GAME_RECOMMENDATION_DEFAULTS,
  formatRecommendationSwitchSummary,
  readNextGameRecommendationInput,
  writeNextGameRecommendationInput,
} from "@/app/next-game-recommendation-state";
import {
  NEXT_GAME_WIZARD_GOAL_OPTIONS,
  formatNextGameWizardGoalLabel,
  formatProjectedOutcome,
  listNextGameWizardAlternativePlans,
  resolveNextGameWizardScenarioMargin,
  selectNextGameWizardPrimaryPlan,
  type NextGameWizardGoalPreset,
} from "@/app/next-game-wizard-state";
import {
  boxscoreQueryOptions,
  nextGamePlannerDetailQueryOptions,
  nextGameRecommendationQueryOptions,
  optimizeLineupHelperQuery,
  opponentForecastQueryOptions,
  repairOwnerRosterDataMutation,
  refreshLineupHelperAfterOwnerRosterRepair,
  scoutTeamSummaryQueryOptions,
  submitNextGameRecommendationJobMutation,
  submitOpponentForecastJobMutation,
  workspaceQueryKeys,
} from "@/app/dashboard/workspace-query-client";
import {
  createDefaultPredictionSide,
  createPredictionSideFromBoxscoreTeam,
  writePredictionDraftToStorage,
} from "@/app/game-prediction-state";
import { GamePlannerPanel } from "@/app/game-planner-panel";
import type {
  HomeWorkspacePayload,
  LineupHelperDependencyState,
  LineupHelperWorkspaceRecord,
  MatchBoxscorePayload,
  MatchBoxscoreTeam,
  NextGamePlannerTacticPair,
  NextGameRecommendationInput,
  NextGameRecommendationProgress,
  NextGameRecommendationSnapshot,
  OpponentForecastSnapshot,
  OpponentForecastScenario,
  PositionCode,
  PredictionSideInput,
  RecommendedGamePlan,
  ScoutTeamSummaryPayload,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import {
  StatusBadge,
  statusToneFromValue,
} from "@/app/ui/primitives/status-badge";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  formatNextGameRecommendationStatus,
  formatOpponentForecastStatus,
} from "@/app/ui/presentation";

type NextGameWizardPanelProps = {
  home: HomeWorkspacePayload;
  initialLineupHelper: LineupHelperWorkspaceRecord | null;
  lineupHelperState: LineupHelperDependencyState;
};

const terminalForecastStatuses = new Set(["SUCCEEDED", "FAILED"]);
const terminalRecommendationStatuses = new Set(["SUCCEEDED", "FAILED"]);

export function NextGameWizardPanel({
  home,
  initialLineupHelper,
  lineupHelperState,
}: NextGameWizardPanelProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const nextMatch = home.nextMatch ?? null;
  const currentTeamId = home.team.teamId ?? null;
  const currentTeamName = home.team.teamName ?? "Current team";
  const [goalPreset, setGoalPreset] =
    useState<NextGameWizardGoalPreset>("BEST_CHANCE");
  const [availabilityOverride, setAvailabilityOverride] =
    useState<TeamLineupAvailabilityOverride>({
      excludedPlayerIds: [],
    });
  const [loadedAvailabilityTeamId, setLoadedAvailabilityTeamId] = useState<
    string | null
  >(null);
  const [advancedInput, setAdvancedInput] =
    useState<NextGameRecommendationInput>(NEXT_GAME_RECOMMENDATION_DEFAULTS);
  const [hasLoadedAdvancedInput, setHasLoadedAdvancedInput] = useState(false);
  const [matchupLabError, setMatchupLabError] = useState<string | null>(null);
  const [ownerRosterRepairExhausted, setOwnerRosterRepairExhausted] =
    useState(false);
  const lastAutoRepairKeyRef = useRef<string | null>(null);
  const lastAutoForecastKeyRef = useRef<string | null>(null);
  const lastAutoRecommendationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setAvailabilityOverride(
      readTeamLineupAvailabilityOverride(
        typeof window === "undefined" ? null : window.localStorage,
        currentTeamId,
      ),
    );
    setLoadedAvailabilityTeamId(currentTeamId);
  }, [currentTeamId]);

  useEffect(() => {
    if (loadedAvailabilityTeamId !== currentTeamId) {
      return;
    }

    writeTeamLineupAvailabilityOverride(
      typeof window === "undefined" ? null : window.localStorage,
      currentTeamId,
      availabilityOverride,
    );
  }, [availabilityOverride, currentTeamId, loadedAvailabilityTeamId]);

  useEffect(() => {
    const stored = readNextGameRecommendationInput(
      typeof window === "undefined" ? null : window.localStorage,
    );
    setAdvancedInput(stored);
    setHasLoadedAdvancedInput(true);
  }, []);

  const lineupHelper = initialLineupHelper;
  const snapshotWarnings = lineupHelper?.snapshotWarnings ?? [];
  const hasReadyLineupHelper = Boolean(
    lineupHelper && lineupHelperState.status === "ready",
  );
  const effectiveRoster = useMemo<EffectiveLineupHelperRosterPlayer[]>(
    () =>
      hasReadyLineupHelper && lineupHelper
        ? applyLineupAvailabilityOverride(
            lineupHelper.roster,
            availabilityOverride,
          )
        : [],
    [availabilityOverride, hasReadyLineupHelper, lineupHelper],
  );
  const availableRosterCount = effectiveRoster.filter(
    (player) => player.available,
  ).length;
  const ownerRosterRepairState = resolveOwnerRosterRepairState({
    availableRosterCount,
    excludedPlayerCount: availabilityOverride.excludedPlayerIds.length,
    lineupHelper,
    lineupHelperState,
    repairExhausted: ownerRosterRepairExhausted,
  });

  const recommendationInput = useMemo<NextGameRecommendationInput>(
    () => ({
      ...advancedInput,
      excludedPlayerIds: availabilityOverride.excludedPlayerIds,
    }),
    [advancedInput, availabilityOverride.excludedPlayerIds],
  );
  const debouncedRecommendationInput =
    useDeferredValue(recommendationInput);

  useEffect(() => {
    if (!hasLoadedAdvancedInput) {
      return;
    }

    writeNextGameRecommendationInput(
      typeof window === "undefined" ? null : window.localStorage,
      recommendationInput,
    );
  }, [hasLoadedAdvancedInput, recommendationInput]);

  useEffect(() => {
    setOwnerRosterRepairExhausted(false);
  }, [currentTeamId, nextMatch?.matchId]);

  useEffect(() => {
    if (!ownerRosterRepairState.blockedByMissingSnapshots) {
      setOwnerRosterRepairExhausted(false);
    }
  }, [ownerRosterRepairState.blockedByMissingSnapshots]);

  const scoutQuery = useQuery({
    ...scoutTeamSummaryQueryOptions({
      teamId: nextMatch?.opponentTeamId ?? undefined,
    }),
    enabled: Boolean(nextMatch?.opponentTeamId),
    placeholderData: (previous) => previous,
  });
  const scout = scoutQuery.data ?? null;
  const scoutSourceMatchId = useMemo(
    () => selectLatestUsableSourceMatchId(scout),
    [scout],
  );

  const forecastQuery = useQuery({
    ...opponentForecastQueryOptions({
      teamId: nextMatch?.opponentTeamId ?? "",
    }),
    enabled: Boolean(nextMatch?.opponentTeamId),
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot || terminalForecastStatuses.has(snapshot.status)) {
        return false;
      }
      return 4000;
    },
  });
  const forecast = forecastQuery.data ?? null;
  const primaryScenario = forecast?.result?.topScenarios[0] ?? null;
  const nextMatchId = nextMatch?.matchId ?? null;
  const nextOpponentTeamId = nextMatch?.opponentTeamId ?? null;
  const canLoadRecommendation = Boolean(
    nextMatchId &&
    nextOpponentTeamId &&
    forecast?.jobId &&
    forecast.status === "SUCCEEDED" &&
    forecast.result &&
    scoutSourceMatchId,
  );
  const recommendationQueryArgs =
    nextMatchId && nextOpponentTeamId && forecast?.jobId
      ? {
          forecastJobId: forecast.jobId,
          input: debouncedRecommendationInput,
          matchId: nextMatchId,
          opponentTeamId: nextOpponentTeamId,
        }
      : null;

  const recommendationQuery = useQuery({
    ...nextGameRecommendationQueryOptions(
      recommendationQueryArgs ?? {
        forecastJobId: "",
        input: debouncedRecommendationInput,
        matchId: "",
        opponentTeamId: "",
      },
    ),
    enabled: canLoadRecommendation,
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot || terminalRecommendationStatuses.has(snapshot.status)) {
        return false;
      }
      return 2000;
    },
    retry: false,
  });
  const recommendation = recommendationQuery.data ?? null;
  const recommendationProgress = recommendation?.progress ?? null;
  const plannerDetailQuery = useQuery({
    ...nextGamePlannerDetailQueryOptions({
      artifactKey: recommendation?.result?.artifactKey ?? "",
    }),
    enabled: Boolean(recommendation?.result?.artifactKey),
  });

  const submitForecastMutation = useMutation({
    mutationFn: async () => {
      if (!nextMatch?.opponentTeamId) {
        throw new Error("No next opponent is available yet.");
      }
      return submitOpponentForecastJobMutation({
        teamId: nextMatch.opponentTeamId,
      });
    },
    onSuccess: async () => {
      if (!nextMatch?.opponentTeamId) {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.opponentForecast(nextMatch.opponentTeamId),
      });
    },
  });

  const submitRecommendationMutation = useMutation({
    mutationFn: async () => {
      return submitNextGameRecommendationJobMutation({
        input: debouncedRecommendationInput,
      });
    },
    onSuccess: async () => {
      if (!recommendationQueryArgs) {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.nextGameRecommendation(
          recommendationQueryArgs,
        ),
      });
    },
  });

  const repairOwnerRosterMutation = useMutation({
    mutationFn: repairOwnerRosterDataMutation,
    onSuccess: async () => {
      const refreshed = await refreshLineupHelperAfterOwnerRosterRepair(
        queryClient,
      );
      setOwnerRosterRepairExhausted(
        !refreshed ||
          refreshed.roster.filter((player) => player.available).length === 0,
      );
    },
  });

  const openMatchupLabMutation = useMutation({
    mutationFn: async () => {
      if (!nextMatch || !nextMatch.opponentTeamId) {
        throw new Error(
          "No next match is available to send to the matchup lab.",
        );
      }

      const primaryPlan = selectNextGameWizardPrimaryPlan({
        goal: goalPreset,
        result: recommendation?.result,
      });
      if (!primaryPlan) {
        throw new Error(
          "Generate a recommendation before opening the matchup lab.",
        );
      }

      const ourSide = await buildRecommendedTeamSide({
        currentTeamId,
        currentTeamName,
        nextMatchIsHome: nextMatch.isHome ?? false,
        plan: primaryPlan,
        roster: effectiveRoster,
      });
      const opponentSide = await buildPredictedOpponentSide({
        forecastScenario: primaryScenario,
        matchId:
          recommendation?.result?.opponentSourceMatchId ?? scoutSourceMatchId,
        opponentTeamId: nextMatch.opponentTeamId,
        opponentTeamName:
          nextMatch.opponentTeamName ??
          scout?.summary?.teamName ??
          "Next opponent",
        queryClient,
      });

      writePredictionDraftToStorage(
        typeof window === "undefined" ? null : window.sessionStorage,
        {
          teamA: ourSide,
          teamB: opponentSide,
          venue: nextMatch.isHome ? "TEAM_A_HOME" : "TEAM_B_HOME",
        },
      );
      router.push("/workspace/predictions");
    },
    onError: (error) => {
      setMatchupLabError(readClientError(error));
    },
    onSuccess: () => {
      setMatchupLabError(null);
    },
  });

  const excludedPlayerCount = availabilityOverride.excludedPlayerIds.length;
  const goalLabel = formatNextGameWizardGoalLabel(goalPreset);
  const excludedPlayers = effectiveRoster.filter(
    (player) => player.isCoachExcluded,
  );
  const usableRosterState = resolveUsableRosterState({
    availableRosterCount,
    excludedPlayerCount,
    lineupHelper,
    lineupHelperState,
  });
  const scoutError = readClientError(scoutQuery.error);
  const forecastError =
    readClientError(submitForecastMutation.error) ??
    forecast?.error ??
    readClientError(forecastQuery.error);
  const recommendationBlockedReason = resolveRecommendationBlockedReason({
    availableRosterCount,
    excludedPlayerCount,
    forecast,
    lineupHelper,
    lineupHelperState,
    nextMatch,
    snapshotWarningCount: snapshotWarnings.length,
    sourceMatchId: scoutSourceMatchId,
  });
  const recommendationError =
    readClientError(submitRecommendationMutation.error) ??
    recommendation?.error ??
    readClientError(recommendationQuery.error);
  const rosterError =
    (lineupHelperState.status === "error"
      ? lineupHelperState.errorMessage
      : null) ?? readClientError(repairOwnerRosterMutation.error);
  const plannerDetailError = readClientError(plannerDetailQuery.error);
  const forecastInProgress = Boolean(
    submitForecastMutation.isPending ||
      (forecast && !terminalForecastStatuses.has(forecast.status)),
  );
  const recommendationInProgress = Boolean(
    submitRecommendationMutation.isPending ||
      (recommendation &&
        !terminalRecommendationStatuses.has(recommendation.status)),
  );
  const recommendationPhaseLabel =
    recommendationInProgress && recommendationProgress?.phaseIndex
      ? `Phase ${recommendationProgress.phaseIndex} of ${recommendationProgress.phaseCount}`
      : null;
  const recommendationTimeline = buildRecommendationPhaseTimeline(
    recommendationProgress,
  );
  const recommendationCurrentPhaseElapsed =
    recommendationInProgress && recommendationProgress?.currentPhaseStartedAt
      ? formatElapsedTime(recommendationProgress.currentPhaseStartedAt)
      : null;
  const recommendationProgressContext = recommendationProgress?.context ?? null;
  const recommendationArtifactKey =
    recommendationProgressContext?.artifactKey ??
    recommendation?.result?.artifactKey ??
    null;
  const plannerInProgress = Boolean(
    recommendation?.result?.artifactKey &&
      (plannerDetailQuery.isPending || plannerDetailQuery.isFetching) &&
      !plannerDetailQuery.data,
  );
  const hasSuccessfulForecast = Boolean(
    forecast?.status === "SUCCEEDED" && forecast.result,
  );
  const hasSuccessfulRecommendation = Boolean(
    recommendation?.status === "SUCCEEDED" && recommendation.result,
  );
  const primaryPlan = selectNextGameWizardPrimaryPlan({
    goal: goalPreset,
    result: recommendation?.result,
  });
  const primaryScenarioMargin =
    resolveNextGameWizardScenarioMargin({
      plan: primaryPlan,
      scenarioId: primaryScenario?.scenarioId ?? null,
    }) ??
    primaryPlan?.weightedExpectedPointDiff ??
    null;
  const alternativePlans = listNextGameWizardAlternativePlans({
    goal: goalPreset,
    result: recommendation?.result,
  });
  const primaryPair: NextGamePlannerTacticPair | null =
    plannerDetailQuery.data?.ourPairs.find(
      (pair) => pair.pairId === primaryPlan?.pairId,
    ) ?? null;
  const canRefreshRosterData = !repairOwnerRosterMutation.isPending;
  const canManualRosterRepair =
    ownerRosterRepairState.shouldOfferRepair &&
    !repairOwnerRosterMutation.isPending;
  const canClearExclusions = excludedPlayers.length > 0;
  const canResetSwitch = !isStandardDefensiveSwitch(
    recommendationInput.defensiveSwitch,
  );
  const canRefreshForecast =
    Boolean(nextOpponentTeamId) &&
    !forecastInProgress &&
    (Boolean(forecastError) || hasSuccessfulForecast);
  const canRefreshRecommendation =
    !recommendationBlockedReason &&
    !recommendationInProgress &&
    (Boolean(recommendationError) || hasSuccessfulRecommendation);
  const forecastActionLabel = forecastError
    ? "Retry outlook"
    : "Refresh opponent outlook";
  const recommendationActionLabel = recommendationError
    ? "Retry recommendation"
    : "Refresh recommendation";
  const shouldAutoRepair = shouldAutoRepairOwnerRoster({
    excludedPlayerCount,
    repairPending: repairOwnerRosterMutation.isPending,
    shouldOfferRepair: ownerRosterRepairState.shouldOfferRepair,
  });
  const shouldAutoForecast = shouldAutoSubmitOpponentForecast({
    forecast,
    pending: submitForecastMutation.isPending,
    teamId: nextOpponentTeamId,
  });
  const shouldAutoRecommendation = shouldAutoSubmitNextGameRecommendation({
    blockedReason: recommendationBlockedReason,
    error: recommendationError,
    recommendation,
    pending: submitRecommendationMutation.isPending,
  });
  const stepStates = resolveNextGameWizardStepStates({
    final: {
      error: primaryPlan ? plannerDetailError : null,
      ready: Boolean(primaryPlan),
      working: Boolean(primaryPlan) && plannerInProgress,
    },
    forecast: {
      error: forecastError,
      ready: hasSuccessfulForecast,
      working: forecastInProgress,
    },
    recommendation: {
      blocked: Boolean(recommendationBlockedReason),
      error: recommendationError,
      ready: hasSuccessfulRecommendation,
      working: recommendationInProgress,
    },
    roster: {
      error:
        lineupHelperState.status === "error"
          ? lineupHelperState.errorMessage
          : ownerRosterRepairState.blockedByMissingSnapshots
            ? readClientError(repairOwnerRosterMutation.error)
            : null,
      ready: hasReadyLineupHelper && availableRosterCount > 0,
      working:
        lineupHelperState.status === "loading" ||
        repairOwnerRosterMutation.isPending,
    },
  });

  useEffect(() => {
    const autoRepairKey =
      currentTeamId && nextMatchId ? `${currentTeamId}:${nextMatchId}` : null;
    if (!autoRepairKey || !shouldAutoRepair) {
      return;
    }
    if (lastAutoRepairKeyRef.current === autoRepairKey) {
      return;
    }
    lastAutoRepairKeyRef.current = autoRepairKey;
    void repairOwnerRosterMutation.mutateAsync().catch(() => undefined);
  }, [
    currentTeamId,
    nextMatchId,
    repairOwnerRosterMutation,
    shouldAutoRepair,
  ]);

  useEffect(() => {
    const autoForecastKey =
      nextOpponentTeamId && nextMatchId
        ? `${nextOpponentTeamId}:${nextMatchId}`
        : null;
    if (!autoForecastKey || !shouldAutoForecast) {
      return;
    }
    if (lastAutoForecastKeyRef.current === autoForecastKey) {
      return;
    }
    lastAutoForecastKeyRef.current = autoForecastKey;
    void submitForecastMutation.mutateAsync().catch(() => undefined);
  }, [
    nextMatchId,
    nextOpponentTeamId,
    shouldAutoForecast,
    submitForecastMutation,
  ]);

  useEffect(() => {
    const autoRecommendationKey =
      nextMatchId && nextOpponentTeamId && scoutSourceMatchId && forecast?.jobId
        ? JSON.stringify({
            forecastJobId: forecast.jobId,
            input: debouncedRecommendationInput,
            matchId: nextMatchId,
            opponentTeamId: nextOpponentTeamId,
            sourceMatchId: scoutSourceMatchId,
          })
        : null;
    if (!autoRecommendationKey || !shouldAutoRecommendation) {
      return;
    }
    if (lastAutoRecommendationKeyRef.current === autoRecommendationKey) {
      return;
    }
    lastAutoRecommendationKeyRef.current = autoRecommendationKey;
    void submitRecommendationMutation.mutateAsync().catch(() => undefined);
  }, [
    debouncedRecommendationInput,
    forecast?.jobId,
    nextMatchId,
    nextOpponentTeamId,
    scoutSourceMatchId,
    shouldAutoRecommendation,
    submitRecommendationMutation,
  ]);

  async function handleRefreshRosterData(): Promise<void> {
    setMatchupLabError(null);
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.lineupHelper,
    });
  }

  function handleResetWizard() {
    setGoalPreset("BEST_CHANCE");
    setAvailabilityOverride({ excludedPlayerIds: [] });
    setAdvancedInput(NEXT_GAME_RECOMMENDATION_DEFAULTS);
    lastAutoRepairKeyRef.current = null;
    lastAutoForecastKeyRef.current = null;
    lastAutoRecommendationKeyRef.current = null;
    setMatchupLabError(null);
  }

  if (!nextMatch?.matchId || !nextMatch.opponentTeamId) {
    return (
      <Panel>
        <SectionHeading eyebrow="Next Game" title="No scheduled next game" />
        <p className="text-ink-muted text-sm leading-7">
          The wizard appears once your next opponent is known.
        </p>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4">
      <Panel>
        <SectionHeading
          actions={
            <Button onClick={handleResetWizard} size="sm" variant="ghost">
              Start over
            </Button>
          }
          description="Walk through the likely opponent plan, lock your usable roster, and finish with one primary recommendation for your scheduled next game."
          eyebrow="Next Game"
          title={nextMatch.opponentTeamName ?? "Next opponent"}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            detail={formatMatchVenue(nextMatch.isHome)}
            label="Tipoff"
            value={formatTimestamp(nextMatch.startTime)}
          />
          <StatCard
            detail={
              scout?.summary?.record
                ? formatRecord(scout.summary.record)
                : "Scout loading"
            }
            label="Opponent"
            value={
              nextMatch.opponentTeamName ??
              scout?.summary?.teamName ??
              "Unknown"
            }
          />
          <StatCard
            detail={
              excludedPlayers.length
                ? excludedPlayers.map((player) => player.fullName).join(", ")
                : "Using the full available roster"
            }
            label="Coach exclusions"
            value={excludedPlayers.length}
          />
          <StatCard
            detail={`Switch ${formatRecommendationSwitchSummary(recommendationInput.defensiveSwitch)}`}
            label="Current prep input"
            value={`Enthusiasm ${recommendationInput.enthusiasm}`}
          />
        </div>
      </Panel>

      <NextGameWizardStepCard
        state={stepStates.goal}
        stepNumber={1}
        summary={`${goalLabel} is the current planning goal.`}
        title="Goal"
      >
        <p className="text-sm leading-7 text-ink-muted">
          Pick the outcome you want the wizard to optimize for. You can reopen
          this step anytime if you want a different recommendation emphasis.
        </p>
        <div className="grid gap-3">
          {NEXT_GAME_WIZARD_GOAL_OPTIONS.map((option) => (
            <button
              className={cn(
                "rounded-card grid gap-1 border border-black/8 bg-white/70 p-4 text-left transition hover:-translate-y-px hover:border-accent/30",
                goalPreset === option.value && "border-accent/35 bg-note-bg/50",
              )}
              key={option.value}
              onClick={() => setGoalPreset(option.value)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm text-ink">{option.label}</strong>
                <StatusBadge
                  tone={goalPreset === option.value ? "note" : "neutral"}
                >
                  {goalPreset === option.value ? "Selected" : "Available"}
                </StatusBadge>
              </div>
              <span className="text-sm text-ink-muted">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      </NextGameWizardStepCard>

      <NextGameWizardStepCard
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canRefreshRosterData}
              loading={lineupHelperState.status === "loading"}
              onClick={() => void handleRefreshRosterData()}
              size="sm"
              variant="secondary"
            >
              Refresh roster data
            </Button>
            <Button
              disabled={!canManualRosterRepair}
              loading={repairOwnerRosterMutation.isPending}
              onClick={() => void repairOwnerRosterMutation.mutateAsync()}
              size="sm"
              variant="secondary"
            >
              Repair roster data
            </Button>
            <Button
              disabled={!canClearExclusions}
              onClick={() => setAvailabilityOverride({ excludedPlayerIds: [] })}
              size="sm"
              variant="ghost"
            >
              Clear exclusions
            </Button>
            <Button
              disabled={!canResetSwitch}
              onClick={() =>
                setAdvancedInput((current) => ({
                  ...current,
                  defensiveSwitch:
                    NEXT_GAME_RECOMMENDATION_DEFAULTS.defensiveSwitch,
                }))
              }
              size="sm"
              variant="ghost"
            >
              Standard switch
            </Button>
          </div>
        }
        state={stepStates.roster}
        stepNumber={2}
        summary={usableRosterState.summary}
        title="Coach inputs and usable roster"
      >
        <div className="grid gap-3">
          {rosterError ? <Alert>{rosterError}</Alert> : null}
          {ownerRosterRepairState.blockedByMissingSnapshots && !rosterError ? (
            <Alert tone="note">
              {repairOwnerRosterMutation.isPending
                ? "Refreshing canonical player snapshots for this roster now."
                : ownerRosterRepairExhausted
                  ? "A targeted roster repair already ran once for this matchup. Refresh the roster after another sync if you want to try again."
                  : "Every saved player is blocked by a missing canonical snapshot, so the wizard can auto-repair this roster once before asking you to intervene."}
            </Alert>
          ) : null}
          {snapshotWarnings.length ? (
            <Alert tone="note">
              Snapshot warnings:{" "}
              {snapshotWarnings
                .map((warning) => `${warning.fullName}: ${warning.warning}`)
                .join(" • ")}
            </Alert>
          ) : null}
          <p className="text-sm leading-7 text-ink-muted">
            Mark players out manually when needed, then tune enthusiasm and the
            defensive switch. Picking an already-assigned defender swaps the
            assignments automatically so the switch always stays valid.
          </p>

          <div className="rounded-card grid gap-3 border border-black/8 bg-white/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <strong className="text-sm text-ink">Usable roster</strong>
                <span className="text-sm text-ink-muted">
                  {usableRosterState.summary}
                </span>
              </div>
              <span className="text-xs font-semibold text-ink-muted">
                {canClearExclusions
                  ? "Coach exclusions are active."
                  : "No coach exclusions are active."}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {effectiveRoster.map((player) => (
                <Button
                  disabled={
                    usableRosterState.controlsDisabled ||
                    !player.isSystemAvailable
                  }
                  key={`wizard-exclusion-${player.playerId}`}
                  onClick={() =>
                    setAvailabilityOverride((current) =>
                      toggleExcludedPlayerId(current, player.playerId),
                    )
                  }
                  size="sm"
                  variant={player.isCoachExcluded ? "secondary" : "ghost"}
                >
                  {!player.isSystemAvailable
                    ? `${player.fullName} unavailable`
                    : player.isCoachExcluded
                      ? `Include ${player.fullName}`
                      : `Exclude ${player.fullName}`}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.65fr)_minmax(0,1fr)]">
            <div className="rounded-card border border-black/8 bg-white/70 p-4">
              <Field label="Enthusiasm">
                <Select
                  onChange={(event) =>
                    setAdvancedInput((current) => ({
                      ...current,
                      enthusiasm: normalizeEnthusiasm(
                        event.currentTarget.value,
                      ),
                    }))
                  }
                  value={String(advancedInput.enthusiasm)}
                >
                  {Array.from({ length: 15 }, (_, index) => index + 1).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
            </div>

            <div className="rounded-card grid gap-4 border border-black/8 bg-white/70 p-4">
              <div className="grid gap-1">
                <strong className="text-sm text-ink">
                  Defensive switch assignments
                </strong>
                <span className="text-sm text-ink-muted">
                  Choose who each position picks up on defense. Reusing a
                  defender swaps the existing assignment instead of creating an
                  invalid switch.
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(
                  [
                    ["pg", "PG"],
                    ["sg", "SG"],
                    ["sf", "SF"],
                    ["pf", "PF"],
                    ["c", "C"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={`${label} defends as`}>
                    <Select
                      onChange={(event) =>
                        setAdvancedInput((current) => ({
                          ...current,
                          defensiveSwitch: applyDefensiveSwitchSwap(
                            current.defensiveSwitch,
                            key,
                            event.currentTarget.value as PositionCode,
                          ),
                        }))
                      }
                      value={advancedInput.defensiveSwitch[key]}
                    >
                      {(["PG", "SG", "SF", "PF", "C"] as const).map(
                        (position) => (
                          <option key={`${key}-${position}`} value={position}>
                            {position}
                          </option>
                        ),
                      )}
                    </Select>
                  </Field>
                ))}
              </div>
            </div>
          </div>
        </div>
      </NextGameWizardStepCard>

      <NextGameWizardStepCard
        actions={
          <Button
            disabled={!canRefreshForecast}
            loading={forecastInProgress}
            onClick={() => void submitForecastMutation.mutateAsync()}
            size="sm"
            variant="secondary"
          >
            {forecastInProgress ? "Opponent outlook running" : forecastActionLabel}
          </Button>
        }
        state={stepStates.forecast}
        stepNumber={3}
        summary={
          hasSuccessfulForecast
            ? `${primaryScenario?.label ?? "Opponent outlook"} is ready.`
            : forecastError
              ? "Opponent outlook needs attention."
              : "The wizard gathers the opponent outlook automatically."
        }
        title="Opponent outlook"
      >
        <div className="grid gap-3">
          {scoutError ? <Alert>{scoutError}</Alert> : null}
          {forecastError ? <Alert>{forecastError}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusToneFromValue(forecast?.status ?? "QUEUED")}>
              {formatOpponentForecastStatus(forecast?.status ?? null)}
            </StatusBadge>
            {forecast ? (
              <span className="text-xs font-semibold text-ink-muted">
                {formatJobRunMeta({
                  completedAt: forecast.completedAt,
                  requestedAt: forecast.requestedAt,
                  startedAt: forecast.startedAt,
                  working: forecastInProgress,
                })}
              </span>
            ) : (
              <span className="text-xs font-semibold text-ink-muted">
                {shouldAutoForecast
                  ? "Starting automatically for this opponent."
                  : "A retry becomes available here if the outlook fails."}
              </span>
            )}
          </div>
          {!canRefreshForecast ? (
            <p className="text-sm leading-7 text-ink-muted">
              {forecastInProgress
                ? "The opponent outlook is already running and this step will refresh automatically."
                : forecastError
                  ? "Retry becomes available after this step finishes loading the failed outlook."
                  : "There is no finished opponent outlook to refresh yet because the wizard is gathering it automatically."}
            </p>
          ) : null}

          {primaryScenario ? (
            <div className="rounded-card grid gap-3 border border-black/8 bg-white/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <strong className="text-sm text-ink">
                    {primaryScenario.label}
                  </strong>
                  <span className="text-sm text-ink-muted">
                    {primaryScenario.offense} • {primaryScenario.defense} •{" "}
                    {primaryScenario.effortChoice}
                  </span>
                </div>
                <StatusBadge tone="note">
                  {(primaryScenario.probability * 100).toFixed(0)}%
                </StatusBadge>
              </div>
              {primaryScenario.evidence.length ? (
                <p className="text-sm text-ink-muted">
                  {primaryScenario.evidence.join(" • ")}
                </p>
              ) : null}
              <p className="text-sm text-ink-muted">
                Likely starters: {formatProjectionPlayers(primaryScenario.starters)}
              </p>
            </div>
          ) : (
            <p className="text-sm leading-7 text-ink-muted">
              {forecastInProgress
                ? "Building the opponent outlook now."
                : "The opponent outlook will appear here as soon as the forecast completes."}
            </p>
          )}
        </div>
      </NextGameWizardStepCard>

      <NextGameWizardStepCard
        actions={
          <Button
            disabled={!canRefreshRecommendation}
            loading={recommendationInProgress}
            onClick={() => void submitRecommendationMutation.mutateAsync()}
            size="sm"
            variant="secondary"
          >
            {recommendationInProgress
              ? "Recommendation running"
              : recommendationActionLabel}
          </Button>
        }
        state={stepStates.recommendation}
        stepNumber={4}
        summary={
          hasSuccessfulRecommendation
            ? "Recommendation ready for review."
            : recommendationError
              ? "Recommendation needs attention."
              : recommendationBlockedReason ??
                "The wizard starts this automatically once the roster, outlook, and source boxscore are ready."
        }
        title="Recommendation run"
      >
        <div className="grid gap-3">
          {recommendationBlockedReason ? (
            <Alert tone="note">{recommendationBlockedReason}</Alert>
          ) : null}
          {recommendationError ? <Alert>{recommendationError}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={statusToneFromValue(recommendation?.status ?? "QUEUED")}
            >
              {formatNextGameRecommendationStatus(recommendation?.status ?? null)}
            </StatusBadge>
            {recommendation ? (
              <span className="text-xs font-semibold text-ink-muted">
                {formatJobRunMeta({
                  completedAt: recommendation.completedAt,
                  requestedAt: recommendation.requestedAt,
                  startedAt: recommendation.startedAt,
                  working: recommendationInProgress,
                })}
              </span>
            ) : (
              <span className="text-xs font-semibold text-ink-muted">
                {shouldAutoRecommendation
                  ? "Starting automatically with the latest coach inputs."
                  : "This step unlocks itself once the earlier prep work is ready."}
              </span>
            )}
          </div>
          {!canRefreshRecommendation ? (
            <p className="text-sm leading-7 text-ink-muted">
              {recommendationInProgress
                ? "The recommendation run is already active. This card tracks the four-phase run as progress updates arrive."
                : recommendationBlockedReason
                  ? "Refresh stays disabled until the roster, opponent outlook, and source match context are ready."
                  : "There is no finished recommendation to refresh yet because the wizard launches it automatically."}
            </p>
          ) : null}
          {recommendation?.result?.stale ? (
            <Alert tone="note">
              This recommendation used an older forecast snapshot. Refresh it to
              line up with the latest opponent outlook.
            </Alert>
          ) : null}
          {recommendationProgress ? (
            <div className="rounded-card grid gap-3 border border-black/8 bg-white/75 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <strong className="text-sm text-ink">
                    {recommendationProgress.summary}
                  </strong>
                  <span className="text-sm text-ink-muted">
                    {recommendationPhaseLabel ??
                      "The recommendation will show detailed phase progress as soon as the run starts."}
                    {recommendationCurrentPhaseElapsed
                      ? ` • Current phase running for ${recommendationCurrentPhaseElapsed}`
                      : ""}
                  </span>
                </div>
                <span className="text-xs font-semibold text-ink-muted">
                  Last update {formatTimestamp(recommendationProgress.updatedAt)}
                </span>
              </div>
              <div className="grid gap-2">
                {recommendationTimeline.map((phase) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-black/6 bg-white/70 px-3 py-2"
                    key={phase.key}
                  >
                    <div className="flex items-center gap-3">
                      <StatusBadge
                        tone={
                          phase.state === "complete"
                            ? "success"
                            : phase.state === "active"
                              ? "note"
                              : phase.state === "failed"
                                ? "danger"
                                : "neutral"
                        }
                      >
                        {phase.state === "complete"
                          ? "Complete"
                          : phase.state === "active"
                            ? "Working"
                            : phase.state === "failed"
                              ? "Failed"
                              : "Upcoming"}
                      </StatusBadge>
                      <span className="text-sm font-semibold text-ink">
                        {phase.label}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-ink-muted">
                      {phase.detail}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {recommendation ? (
            <details className="rounded-card border border-black/8 bg-white/70 p-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
                Run details
              </summary>
              <div className="mt-3 grid gap-2 text-sm text-ink-muted">
                <span>Job ID: {recommendation.jobId}</span>
                <span>
                  Forecast run:{" "}
                  {recommendationProgressContext?.forecastJobId ??
                    recommendation.result?.forecastJobId ??
                    "Pending"}
                </span>
                <span>
                  Source match:{" "}
                  {recommendationProgressContext?.sourceMatchId ??
                    recommendation.result?.opponentSourceMatchId ??
                    "Pending"}
                </span>
                <span>
                  Available roster:{" "}
                  {formatOptionalCount(
                    recommendationProgressContext?.availableRosterCount,
                    "players",
                  )}
                </span>
                <span>
                  Excluded players:{" "}
                  {excludedPlayers.length
                    ? excludedPlayers.map((player) => player.fullName).join(", ")
                    : "None"}
                </span>
                <span>
                  Planner pairs:{" "}
                  {formatOptionalCount(
                    recommendationProgressContext?.plannerPairCount,
                    "pairs",
                  )}
                </span>
                <span>
                  Candidates:{" "}
                  {formatOptionalCount(
                    recommendationProgressContext?.candidateCount,
                    "candidates",
                  )}
                </span>
                <span>
                  Planner artifact: {recommendationArtifactKey ?? "Pending"}
                </span>
                <span>
                  Workspace source:{" "}
                  {formatWorkspaceCacheDetail(recommendationProgressContext)}
                </span>
                <span>
                  Last progress update:{" "}
                  {recommendationProgress
                    ? formatTimestamp(recommendationProgress.updatedAt)
                    : "Waiting to start"}
                </span>
                {recommendation.result?.stale ? (
                  <span>
                    Warning: This run used an older forecast snapshot than the
                    latest outlook.
                  </span>
                ) : null}
              </div>
            </details>
          ) : null}
          <div className="rounded-card grid gap-3 border border-black/8 bg-white/70 p-4">
            <div className="grid gap-1">
              <strong className="text-sm text-ink">Run inputs</strong>
              <span className="text-sm text-ink-muted">
                Goal {goalLabel} • Enthusiasm {recommendationInput.enthusiasm} •
                Switch {formatRecommendationSwitchSummary(recommendationInput.defensiveSwitch)}
              </span>
            </div>
            <span className="text-sm text-ink-muted">
              {excludedPlayers.length
                ? `Excluded players: ${excludedPlayers.map((player) => player.fullName).join(", ")}`
                : "No coach exclusions are active for this run."}
            </span>
          </div>
        </div>
      </NextGameWizardStepCard>

      <NextGameWizardStepCard
        actions={
          <Button
            disabled={!primaryPlan}
            loading={openMatchupLabMutation.isPending}
            onClick={() => void openMatchupLabMutation.mutateAsync()}
            size="sm"
            variant="secondary"
          >
            Open in matchup lab
          </Button>
        }
        state={stepStates.final}
        stepNumber={5}
        summary={
          primaryPlan
            ? `Ready: ${primaryPlan.offense} / ${primaryPlan.defense}.`
            : "Your final recommendation and planner detail appear here automatically."
        }
        title="Final plan and planner detail"
      >
        <div className="grid gap-4">
          {matchupLabError ? <Alert>{matchupLabError}</Alert> : null}
          {primaryPair?.supportTier === "ESTIMATED" ? (
            <Alert tone="note">
              This tactic pair is estimated support rather than a direct
              planner pairing, so treat the margin as a softer guide than the
              direct-support options.
            </Alert>
          ) : null}
          {primaryPlan ? (
            <>
              <div className="rounded-card grid gap-3 border border-black/8 bg-white/75 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-accent">
                      {goalLabel}
                    </span>
                    <strong className="text-lg text-ink">
                      Run {primaryPlan.offense} with {primaryPlan.defense}
                    </strong>
                  </div>
                  <StatusBadge
                    tone={
                      typeof primaryScenarioMargin === "number" &&
                      primaryScenarioMargin > 0
                        ? "success"
                        : "neutral"
                    }
                  >
                    {formatProjectedOutcome(primaryScenarioMargin)}
                  </StatusBadge>
                </div>
                <p className="text-sm text-ink-muted">
                  Your opponent will likely counter with{" "}
                  {primaryScenario
                    ? `${primaryScenario.offense}, ${primaryScenario.defense}, and ${primaryScenario.effortChoice}`
                    : "their current most likely forecasted look"}
                  .
                </p>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    detail={formatScoreline(primaryPlan)}
                    label="Expected margin"
                    value={formatSigned(primaryPlan.weightedExpectedPointDiff)}
                  />
                  <StatCard
                    detail={`Floor ${formatSigned(primaryPlan.floorPointDiff)} • Ceiling ${formatSigned(primaryPlan.ceilingPointDiff)}`}
                    label="Risk band"
                    value={`${(primaryPlan.winProbability * 100).toFixed(0)}% win`}
                  />
                  <StatCard
                    detail={formatRecommendationSwitchSummary(
                      primaryPlan.defensiveSwitch,
                    )}
                    label="Effort"
                    value={primaryPlan.effortChoice}
                  />
                  <StatCard
                    detail={
                      excludedPlayers.length
                        ? excludedPlayers.map((player) => player.fullName).join(", ")
                        : "No coach exclusions"
                    }
                    label="Roster assumption"
                    value={`${recommendationInput.excludedPlayerIds.length} excluded`}
                  />
                </div>
                <div className="grid gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-muted">
                    Projected lineup
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {primaryPlan.lineup.map((player) => (
                      <span
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/5 px-3 py-1 text-xs font-semibold text-ink"
                        key={`${player.playerId}-${player.position}`}
                      >
                        {player.position} {player.fullName}
                        <span className="text-ink-muted">{player.minutes}m</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {alternativePlans.length ? (
                <div className="grid gap-3">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-muted">
                    Alternate approaches
                  </span>
                  {alternativePlans.map((option) => (
                    <div
                      className="rounded-card grid gap-2 border border-black/8 bg-white/70 p-4"
                      key={option.goal}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <strong className="text-sm text-ink">
                          {option.label}
                        </strong>
                        <StatusBadge tone="neutral">
                          {formatSigned(option.plan.weightedExpectedPointDiff)}
                        </StatusBadge>
                      </div>
                      <p className="text-sm text-ink-muted">
                        {option.plan.offense} / {option.plan.defense} •{" "}
                        {option.plan.effortChoice}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              <GamePlannerPanel
                detail={plannerDetailQuery.data ?? null}
                detailError={plannerDetailError}
                detailLoading={plannerInProgress}
                forecast={forecast}
                input={recommendationInput}
                recommendation={recommendation}
              />
            </>
          ) : (
            <p className="text-sm leading-7 text-ink-muted">
              {recommendationInProgress
                ? "The planner detail will appear here automatically as soon as the recommendation finishes."
                : "Finish the earlier wizard steps and the final plan will appear here automatically."}
            </p>
          )}
        </div>
      </NextGameWizardStepCard>
    </div>
  );
}

type NextGameWizardStepId =
  | "goal"
  | "roster"
  | "forecast"
  | "recommendation"
  | "final";

type NextGameWizardStepState =
  | "complete"
  | "current"
  | "working"
  | "blocked"
  | "error"
  | "upcoming";

function NextGameWizardStepCard(props: {
  actions?: ReactNode;
  children: ReactNode;
  state: NextGameWizardStepState;
  stepNumber: number;
  summary: string;
  title: string;
}) {
  const header = (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-muted">
          Step {props.stepNumber}
        </span>
        <StatusBadge tone={toneForWizardStepState(props.state)}>
          {formatWizardStepStateLabel(props.state)}
        </StatusBadge>
      </div>
      <strong className="text-lg text-ink">{props.title}</strong>
      <span className="text-sm text-ink-muted">{props.summary}</span>
    </div>
  );
  const actions = props.actions ? (
    <div className="flex flex-wrap gap-2">{props.actions}</div>
  ) : null;
  const expandedBody = (
    <div className="mt-4 grid gap-4">
      {actions}
      {props.children}
    </div>
  );

  if (props.state === "complete") {
    return (
      <details className="rounded-panel border border-border-soft bg-surface p-5 shadow-panel">
        <summary className="cursor-pointer list-none">
          <div className="pr-8">{header}</div>
        </summary>
        {expandedBody}
      </details>
    );
  }

  return (
    <Panel
      className={cn(
        props.state === "blocked" || props.state === "upcoming"
          ? "border-black/10 bg-surface/80"
          : undefined,
      )}
    >
      <div className="grid gap-1">
        {header}
        {actions}
      </div>
      {props.state === "current" ||
      props.state === "working" ||
      props.state === "error" ? (
        <div className="mt-4 grid gap-4">{props.children}</div>
      ) : null}
    </Panel>
  );
}

function toneForWizardStepState(state: NextGameWizardStepState) {
  switch (state) {
    case "complete":
      return "success" as const;
    case "current":
    case "working":
      return "note" as const;
    case "error":
      return "danger" as const;
    case "blocked":
    case "upcoming":
    default:
      return "neutral" as const;
  }
}

function formatWizardStepStateLabel(state: NextGameWizardStepState): string {
  switch (state) {
    case "complete":
      return "Complete";
    case "current":
      return "Current";
    case "working":
      return "Working";
    case "blocked":
      return "Blocked";
    case "error":
      return "Needs attention";
    case "upcoming":
    default:
      return "Upcoming";
  }
}

function resolveNextGameWizardStepStates(args: {
  final: {
    error: string | null;
    ready: boolean;
    working: boolean;
  };
  forecast: {
    error: string | null;
    ready: boolean;
    working: boolean;
  };
  recommendation: {
    blocked: boolean;
    error: string | null;
    ready: boolean;
    working: boolean;
  };
  roster: {
    error: string | null;
    ready: boolean;
    working: boolean;
  };
}): Record<NextGameWizardStepId, NextGameWizardStepState> {
  const roster = resolvePrimaryWizardStepState(args.roster);
  const forecast = resolveDependentWizardStepState({
    blocked: roster !== "complete" && !args.forecast.working,
    error: args.forecast.error,
    ready: args.forecast.ready,
    working: args.forecast.working,
  });
  const recommendation = resolveDependentWizardStepState({
    blocked:
      (forecast !== "complete" && !args.recommendation.working) ||
      args.recommendation.blocked,
    error: args.recommendation.error,
    ready: args.recommendation.ready,
    working: args.recommendation.working,
  });

  return {
    final:
      args.final.error && args.final.ready
        ? "error"
        : args.final.ready
          ? "current"
          : resolveDependentWizardStepState({
              blocked: recommendation !== "complete" && !args.final.working,
              error: args.final.error,
              ready: false,
              working: args.final.working,
            }),
    forecast,
    goal: "complete",
    recommendation,
    roster,
  };
}

function resolvePrimaryWizardStepState(args: {
  error: string | null;
  ready: boolean;
  working: boolean;
}): NextGameWizardStepState {
  if (args.ready) {
    return "complete";
  }
  if (args.error) {
    return "error";
  }
  if (args.working) {
    return "working";
  }
  return "current";
}

function resolveDependentWizardStepState(args: {
  blocked: boolean;
  error: string | null;
  ready: boolean;
  working: boolean;
}): NextGameWizardStepState {
  if (args.ready) {
    return "complete";
  }
  if (args.error) {
    return "error";
  }
  if (args.working) {
    return "working";
  }
  if (args.blocked) {
    return "upcoming";
  }
  return "current";
}

function resolveRecommendationBlockedReason(args: {
  availableRosterCount: number;
  excludedPlayerCount: number;
  forecast: OpponentForecastSnapshot | null;
  lineupHelper: LineupHelperWorkspaceRecord | null;
  lineupHelperState: LineupHelperDependencyState;
  nextMatch: HomeWorkspacePayload["nextMatch"];
  snapshotWarningCount: number;
  sourceMatchId: string | null;
}): string | null {
  if (!args.nextMatch?.matchId || !args.nextMatch.opponentTeamId) {
    return "No next match is scheduled yet.";
  }
  if (args.lineupHelperState.status === "loading") {
    return "Lineup helper context is still loading for your club.";
  }
  if (args.lineupHelperState.status === "error") {
    return (
      args.lineupHelperState.errorMessage ??
      "Lineup helper data is unavailable for this section."
    );
  }
  if (!args.lineupHelper) {
    return "Player data is not ready yet. Recommendations stay disabled until a fresh roster update completes.";
  }
  if (args.availableRosterCount === 0) {
    if (args.snapshotWarningCount > 0 && args.excludedPlayerCount === 0) {
      return "No usable roster is currently available because every saved player is missing a canonical skill snapshot.";
    }
    return "No usable roster remains after applying your exclusions.";
  }
  if (
    !args.forecast ||
    args.forecast.status !== "SUCCEEDED" ||
    !args.forecast.result
  ) {
    return "Generate a successful opponent outlook before requesting a recommendation.";
  }
  if (!args.sourceMatchId) {
    return "No opponent source boxscore is available yet for the current next opponent.";
  }
  return null;
}

function resolveOwnerRosterRepairState(args: {
  availableRosterCount: number;
  excludedPlayerCount: number;
  lineupHelper: LineupHelperWorkspaceRecord | null;
  lineupHelperState: LineupHelperDependencyState;
  repairExhausted: boolean;
}): {
  blockedByMissingSnapshots: boolean;
  shouldOfferRepair: boolean;
} {
  const blockedByMissingSnapshots = Boolean(
    args.lineupHelperState.status === "ready" &&
      args.lineupHelper &&
      args.availableRosterCount === 0 &&
      args.excludedPlayerCount === 0 &&
      args.lineupHelper.roster.length > 0 &&
      args.lineupHelper.roster.every(
        (player) => !player.available && Boolean(player.snapshotWarning),
      ),
  );

  return {
    blockedByMissingSnapshots,
    shouldOfferRepair: blockedByMissingSnapshots && !args.repairExhausted,
  };
}

function resolveUsableRosterState(args: {
  availableRosterCount: number;
  excludedPlayerCount: number;
  lineupHelper: LineupHelperWorkspaceRecord | null;
  lineupHelperState: LineupHelperDependencyState;
}): {
  controlsDisabled: boolean;
  summary: string;
} {
  if (args.lineupHelperState.status === "loading") {
    return {
      controlsDisabled: true,
      summary: "Loading your saved roster before coach exclusions can be applied.",
    };
  }
  if (args.lineupHelperState.status === "error") {
    return {
      controlsDisabled: true,
      summary:
        args.lineupHelperState.errorMessage ??
        "Lineup data is unavailable for this section.",
    };
  }
  if (!args.lineupHelper) {
    return {
      controlsDisabled: true,
      summary:
        "Player data is not ready yet. Coach exclusions will appear after a fresh roster update completes.",
    };
  }
  if (
    args.availableRosterCount === 0 &&
    args.lineupHelper.snapshotWarnings.length > 0 &&
    args.excludedPlayerCount === 0
  ) {
    return {
      controlsDisabled: false,
      summary:
        "0 players currently available. Missing canonical skill snapshots are keeping the saved roster unavailable.",
    };
  }
  return {
    controlsDisabled: false,
    summary: `${args.availableRosterCount} player${args.availableRosterCount === 1 ? "" : "s"} available after coach exclusions.`,
  };
}

function shouldAutoRepairOwnerRoster(args: {
  excludedPlayerCount: number;
  repairPending: boolean;
  shouldOfferRepair: boolean;
}): boolean {
  return (
    args.shouldOfferRepair &&
    args.excludedPlayerCount === 0 &&
    !args.repairPending
  );
}

function shouldAutoSubmitOpponentForecast(args: {
  forecast: OpponentForecastSnapshot | null;
  pending: boolean;
  teamId: string | null;
}): boolean {
  if (!args.teamId || args.pending) {
    return false;
  }
  if (!args.forecast) {
    return true;
  }
  return false;
}

function shouldAutoSubmitNextGameRecommendation(args: {
  blockedReason: string | null;
  error: string | null;
  pending: boolean;
  recommendation: NextGameRecommendationSnapshot | null;
}): boolean {
  if (args.blockedReason || args.pending) {
    return false;
  }
  if (!args.recommendation) {
    return !args.error;
  }
  if (args.recommendation.status === "FAILED") {
    return false;
  }
  if (!terminalRecommendationStatuses.has(args.recommendation.status)) {
    return false;
  }
  return Boolean(args.recommendation.result?.stale);
}

function isStandardDefensiveSwitch(
  value: NextGameRecommendationInput["defensiveSwitch"],
): boolean {
  return (
    value.pg === "PG" &&
    value.sg === "SG" &&
    value.sf === "SF" &&
    value.pf === "PF" &&
    value.c === "C"
  );
}

function applyDefensiveSwitchSwap(
  current: NextGameRecommendationInput["defensiveSwitch"],
  sourceKey: keyof NextGameRecommendationInput["defensiveSwitch"],
  nextValue: PositionCode,
): NextGameRecommendationInput["defensiveSwitch"] {
  if (current[sourceKey] === nextValue) {
    return current;
  }

  const nextSwitch = { ...current };
  const swapKey = (Object.keys(current) as Array<keyof typeof current>).find(
    (key) => key !== sourceKey && current[key] === nextValue,
  );
  const previousValue = current[sourceKey];

  nextSwitch[sourceKey] = nextValue;
  if (swapKey) {
    nextSwitch[swapKey] = previousValue;
  }

  return nextSwitch;
}

function formatJobRunMeta(args: {
  completedAt: string | null | undefined;
  requestedAt: string | null | undefined;
  startedAt: string | null | undefined;
  working: boolean;
}): string {
  if (args.completedAt) {
    return `Updated ${formatTimestamp(args.completedAt)}`;
  }

  const anchor = args.startedAt ?? args.requestedAt ?? null;
  if (!anchor) {
    return "Waiting to start";
  }

  if (!args.working) {
    return `Requested ${formatTimestamp(anchor)}`;
  }

  return `Started ${formatTimestamp(anchor)} • running for ${formatElapsedTime(anchor)}`;
}

function formatElapsedTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "moments";
  }

  const elapsedMs = Math.max(0, Date.now() - parsed.getTime());
  const elapsedSeconds = Math.round(elapsedMs / 1000);
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);
  return `${elapsedHours}h`;
}

function buildRecommendationPhaseTimeline(
  progress: NextGameRecommendationProgress | null,
): Array<{
  detail: string;
  key: string;
  label: string;
  state: "active" | "complete" | "failed" | "pending";
}> {
  const phases = [
    { key: "RESOLVING_CONTEXT", label: "Resolve context" },
    { key: "OPTIMIZING_LINEUPS", label: "Optimize lineups" },
    { key: "SCORING_MATCHUPS", label: "Score matchups" },
    { key: "BUILDING_PLANNER", label: "Build planner" },
  ] as const;
  const completedPhases = new Map(
    (progress?.completedPhases ?? []).map((phase) => [phase.phaseKey, phase]),
  );
  const failedPhaseKey =
    progress?.phaseKey === "FAILED"
      ? recommendationPhaseKeyFromIndex(progress.phaseIndex)
      : null;

  return phases.map((phase) => {
    const completed = completedPhases.get(phase.key);
    if (completed) {
      return {
        detail: `Completed in ${formatDurationMs(completed.durationMs)}`,
        key: phase.key,
        label: phase.label,
        state: "complete" as const,
      };
    }

    if (failedPhaseKey === phase.key) {
      return {
        detail: progress?.summary ?? "Failed",
        key: phase.key,
        label: phase.label,
        state: "failed" as const,
      };
    }

    if (progress?.phaseKey === phase.key) {
      return {
        detail:
          phase.key === "OPTIMIZING_LINEUPS" &&
          progress.completedUnits !== null &&
          progress.completedUnits !== undefined &&
          progress.totalUnits !== null &&
          progress.totalUnits !== undefined
            ? `${progress.completedUnits}/${progress.totalUnits} ${progress.unitLabel ?? "units"}`
            : progress.currentPhaseStartedAt
              ? `Running for ${formatElapsedTime(progress.currentPhaseStartedAt)}`
              : "Working now",
        key: phase.key,
        label: phase.label,
        state: "active" as const,
      };
    }

    return {
      detail: "Waiting",
      key: phase.key,
      label: phase.label,
      state: "pending" as const,
    };
  });
}

function recommendationPhaseKeyFromIndex(index: number): string | null {
  switch (index) {
    case 1:
      return "RESOLVING_CONTEXT";
    case 2:
      return "OPTIMIZING_LINEUPS";
    case 3:
      return "SCORING_MATCHUPS";
    case 4:
      return "BUILDING_PLANNER";
    default:
      return null;
  }
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "moments";
  }

  const seconds = Math.round(value / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function formatOptionalCount(
  value: number | null | undefined,
  label: string,
): string {
  return value === null || value === undefined ? "Pending" : `${value} ${label}`;
}

function formatWorkspaceCacheDetail(
  context: NextGameRecommendationProgress["context"] | null | undefined,
): string {
  if (!context) {
    return "Pending";
  }

  if (context.workspaceCacheState === "hit") {
    return context.workspaceSyncedAt
      ? `Cached workspace from ${formatTimestamp(context.workspaceSyncedAt)}`
      : "Cached workspace";
  }

  if (context.workspaceSyncedAt) {
    return `Fresh workspace synced ${formatTimestamp(context.workspaceSyncedAt)}`;
  }

  return "Fresh workspace";
}

async function buildRecommendedTeamSide(args: {
  currentTeamId: string | null;
  currentTeamName: string;
  nextMatchIsHome: boolean;
  plan: NonNullable<RecommendedGamePlan>;
  roster: EffectiveLineupHelperRosterPlayer[];
}): Promise<PredictionSideInput> {
  try {
    const optimized = await optimizeLineupHelperQuery({
      algorithm: "EXACT",
      context: {
        defense: args.plan.defense,
        defensiveSwitch: {
          c: args.plan.defensiveSwitch.c,
          pf: args.plan.defensiveSwitch.pf,
          pg: args.plan.defensiveSwitch.pg,
          sf: args.plan.defensiveSwitch.sf,
          sg: args.plan.defensiveSwitch.sg,
        },
        enthusiasm: args.plan.enthusiasm,
        homeCourt: args.nextMatchIsHome ? "Home Court" : "Away or Neutral",
        offense: args.plan.offense,
      },
      roster: args.roster.map(encodeLineupHelperRosterPlayer),
    });

    return {
      ...createDefaultPredictionSide({
        teamId: args.currentTeamId,
        teamName: args.currentTeamName,
      }),
      defense: args.plan.defense,
      effortChoice: args.plan.effortChoice,
      offense: args.plan.offense,
      ratings: {
        insideDefense: optimized.rawRatings.insideDefense,
        insideScoring: optimized.rawRatings.insideScoring,
        offensiveFlow: optimized.rawRatings.offensiveFlow,
        outsideDefense: optimized.rawRatings.outsideDefense,
        outsideScoring: optimized.rawRatings.outsideScoring,
        rebounding: optimized.rawRatings.rebounding,
      },
      sourceLabel: "Next-game wizard recommendation",
    };
  } catch {
    return {
      ...createDefaultPredictionSide({
        teamId: args.currentTeamId,
        teamName: args.currentTeamName,
      }),
      defense: args.plan.defense,
      effortChoice: args.plan.effortChoice,
      offense: args.plan.offense,
      sourceLabel: "Next-game wizard recommendation",
    };
  }
}

async function buildPredictedOpponentSide(args: {
  forecastScenario: OpponentForecastScenario | null;
  matchId: string | null;
  opponentTeamId: string;
  opponentTeamName: string;
  queryClient: ReturnType<typeof useQueryClient>;
}): Promise<PredictionSideInput> {
  const sourceMatch = args.matchId
    ? await args.queryClient.fetchQuery(
        boxscoreQueryOptions({ matchId: args.matchId }),
      )
    : null;
  const sourceBoxscoreSide = selectBoxscoreTeamForOpponent(
    sourceMatch,
    args.opponentTeamId,
  );
  const sourceSide =
    sourceMatch && sourceBoxscoreSide
      ? createPredictionSideFromBoxscoreTeam({
          match: sourceMatch,
          team: sourceBoxscoreSide.team,
          teamLocation: sourceBoxscoreSide.teamLocation,
        })
      : createDefaultPredictionSide({
          teamId: args.opponentTeamId,
          teamName: args.opponentTeamName,
        });

  return {
    ...sourceSide,
    defense: args.forecastScenario?.defense ?? sourceSide.defense,
    effortChoice: args.forecastScenario?.effortChoice ?? "Normal",
    gdpFocus: args.forecastScenario?.gdpFocus ?? sourceSide.gdpFocus,
    gdpPace: args.forecastScenario?.gdpPace ?? sourceSide.gdpPace,
    offense: args.forecastScenario?.offense ?? sourceSide.offense,
    ratings: sourceSide.ratings,
    sourceLabel: sourceSide.sourceLabel,
    sourceMatchId: args.matchId,
    teamId: args.opponentTeamId,
    teamName: args.opponentTeamName,
  };
}

function selectLatestUsableSourceMatchId(
  scout: ScoutTeamSummaryPayload | null,
): string | null {
  return (
    scout?.summary?.recentGames.find(
      (match) => match.matchId && match.hasBoxscore,
    )?.matchId ?? null
  );
}

type OpponentBoxscoreSide = {
  team: MatchBoxscoreTeam;
  teamLocation: "HOME" | "AWAY";
};

function selectBoxscoreTeamForOpponent(
  match: MatchBoxscorePayload | null,
  opponentTeamId: string | null,
): OpponentBoxscoreSide | null {
  if (!match || !opponentTeamId) {
    return null;
  }
  if (match.homeTeam?.teamId === opponentTeamId) {
    return {
      team: match.homeTeam,
      teamLocation: "HOME",
    };
  }
  if (match.awayTeam?.teamId === opponentTeamId) {
    return {
      team: match.awayTeam,
      teamLocation: "AWAY",
    };
  }
  return null;
}

function encodeLineupHelperRosterPlayer(
  player: EffectiveLineupHelperRosterPlayer,
): LineupHelperWorkspaceRecord["roster"][number] {
  return {
    age: player.age,
    available: player.available,
    bestPosition: player.bestPosition,
    dmi: player.dmi,
    fullName: player.fullName,
    gameShape: player.gameShape,
    injuryWeeks: player.injuryWeeks,
    playerId: player.playerId,
    salary: player.salary,
    skills: {
      dr: player.skills.dr,
      ex: player.skills.ex,
      ft: player.skills.ft,
      gs: player.skills.gs,
      ha: player.skills.ha,
      id: player.skills.id,
      is: player.skills.is,
      jr: player.skills.jr,
      js: player.skills.js,
      od: player.skills.od,
      pa: player.skills.pa,
      rb: player.skills.rb,
      sb: player.skills.sb,
      st: player.skills.st,
    },
    snapshotCapturedAt: player.snapshotCapturedAt,
    snapshotWarning: player.snapshotWarning,
    snapshotWeekKey: player.snapshotWeekKey,
  };
}

function formatProjectionPlayers(
  players: Array<{ fullName: string }> | undefined,
): string {
  return players?.length
    ? players.map((player) => player.fullName).join(", ")
    : "No projection yet";
}

function formatScoreline(plan: {
  predictedOpponentScore: number;
  predictedTeamScore: number;
}): string {
  return `${plan.predictedTeamScore.toFixed(1)} - ${plan.predictedOpponentScore.toFixed(1)}`;
}

function formatSigned(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "TBD";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRecord(
  value: HomeWorkspacePayload["team"]["record"] | null | undefined,
): string {
  return value ? `${value.wins ?? 0}-${value.losses ?? 0}` : "N/A";
}

function formatMatchVenue(isHome: boolean | null | undefined): string {
  return isHome ? "Home" : "Away";
}

function normalizeEnthusiasm(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return NEXT_GAME_RECOMMENDATION_DEFAULTS.enthusiasm;
  }
  return Math.min(15, Math.max(1, Math.round(parsed)));
}

function readClientError(error: unknown): string | null {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : null;
}

export const __testing = {
  applyDefensiveSwitchSwap,
  buildRecommendationPhaseTimeline,
  formatDurationMs,
  formatJobRunMeta,
  formatWorkspaceCacheDetail,
  isStandardDefensiveSwitch,
  resolveOwnerRosterRepairState,
  resolveNextGameWizardStepStates,
  resolveRecommendationBlockedReason,
  resolveUsableRosterState,
  shouldAutoRepairOwnerRoster,
  shouldAutoSubmitNextGameRecommendation,
  shouldAutoSubmitOpponentForecast,
};
