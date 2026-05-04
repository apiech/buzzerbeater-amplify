"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  RecapGenerationApproach as RecapGenerationApproachEnum,
  RecapInterviewIntensity as RecapInterviewIntensityEnum,
} from "@/amplify/data/schema-enums";
import {
  recapHistoryQueryOptions,
  setBbLeagueTimeZoneMutation,
  submitGameDayRecapMutation,
  submitLeagueGameDayPerformancesMutation,
  submitLeagueGameDayRecapMutation,
  submitSingleGameSummaryMutation,
} from "@/app/dashboard/workspace-query-client";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input, Select } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  StatusBadge,
  statusToneFromValue,
} from "@/app/ui/primitives/status-badge";
import { formatWriteupStatus } from "@/app/ui/presentation";
import type {
  GameDayRecapCostPayload,
  GameDayRecapRecord,
  GameDayRecapCoveragePayload,
  GameDayRecapFailurePayload,
  GameDayRecapResultPayload,
  LeagueGameDayPerformancesHistoryRecord,
  LeagueGameDayPerformancesResultPayload,
  RecapGenerationApproach,
  RecapPanelContext,
  RecapHistoryKind,
  RecapHistoryRecord,
  RecapInterviewIntensity,
  RecapQualityTier,
} from "@/app/types";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import {
  buildInterviewPersonalitySeed,
  INTERVIEW_PERSONALITY_TYPES,
  INTERVIEW_PERSONALITY_SOURCE_LABELS,
  isInterviewPersonalitySource,
  isInterviewPersonalityType,
  resolveDeterministicInterviewPersonality,
  resolveInterviewPersonalityLabel,
  type InterviewPersonalityType,
} from "@/lib/interview-personalities";
import {
  inferLeagueTimeZone,
  normalizeLeagueTimeZone,
  resolveCalendarDateKey,
} from "@/lib/league-timezones";
import { isNonProductionClientRuntime } from "@/lib/ui-debug";

const terminalStatuses = new Set(["FAILED", "SUCCEEDED"]);
const RECAP_STALE_TIMEOUT_MS = 20 * 60 * 1000;
const formGridClassName = "grid gap-4 md:grid-cols-2";
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-2 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const modeSwitcherClassName = "flex flex-wrap gap-2";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-[1.5fr_0.9fr]";
const RECAP_CAPABILITY_SUMMARY =
  "v1 uses standings, schedules, recent form, box scores, effort context, and public play-by-play moments when available. Transfers are still excluded for now.";
const PERFORMANCE_CAPABILITY_SUMMARY =
  "League game day performances are computed directly from the full final slate. The report tracks player and team leaders, positional top five selections, spotlight callouts, and its own BB forums export.";
const DEFAULT_MODEL_JUDGE_ENABLED = false;

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

type RecapPanelProps = {
  canUseLeagueWriteups: boolean;
  context: RecapPanelContext;
  isLoadingLeagueWriteupAccess: boolean;
};

type RecapBranch = "WRITEUPS" | "PERFORMANCES";
type RecapMode = Exclude<RecapHistoryKind, "LEAGUE_GAME_DAY_PERFORMANCES">;
type DebugRecapQualityTier = RecapQualityTier | "AUTO";
type RecapApproachOption = {
  description: string;
  label: string;
  value: RecapGenerationApproach;
};
type RecapInterviewIntensityOption = {
  description: string;
  label: string;
  value: RecapInterviewIntensity;
};
type DebugInterviewPersonalitySelection = InterviewPersonalityType | "";

const recapBranches: Array<{
  description: string;
  label: string;
  value: RecapBranch;
}> = [
  {
    description:
      "Premium AI writeups for league dates, league game days, and single finished matches.",
    label: "Writeups",
    value: "WRITEUPS",
  },
  {
    description:
      "Free deterministic league game-day leaderboards with a separate export for the forums.",
    label: "Performances",
    value: "PERFORMANCES",
  },
];

const recapModes: Array<{
  description: string;
  label: string;
  value: RecapMode;
}> = [
  {
    description:
      "Pick a league number and calendar date in the league's local time zone.",
    label: "League date",
    value: "LEAGUE_DATE",
  },
  {
    description: "Use the regular-season game day number from 1 to 22.",
    label: "League game day",
    value: "LEAGUE_GAME_DAY",
  },
  {
    description:
      "Summarize one finished game by entering its BuzzerBeater game number.",
    label: "Single game",
    value: "SINGLE_GAME",
  },
];

const recapApproachOptions: RecapApproachOption[] = [
  {
    description:
      "Uses structured deterministic facts from box scores, quarter states, schedules, standings, and play-by-play before writing.",
    label: "Fact library first (Recommended)",
    value: RecapGenerationApproachEnum.FACT_LIBRARY_FIRST,
  },
  {
    description:
      "Sends the compact fact library to a basic news-reporter writer with no validation, retry, polish, or interview passes.",
    label: "Simple fact library",
    value: RecapGenerationApproachEnum.SIMPLE_FACT_LIBRARY,
  },
  {
    description:
      "Keeps the previous recap engine available for comparison and fallback.",
    label: "Classic recap engine",
    value: RecapGenerationApproachEnum.LEGACY,
  },
];

const recapQualityTierOptions: Array<{
  description: string;
  label: string;
  value: DebugRecapQualityTier;
}> = [
  {
    description:
      "Uses the normal billing and environment routing to choose the writeup tier.",
    label: "Auto (Recommended)",
    value: "AUTO",
  },
  {
    description:
      "Forces the lighter standard writeup path for debugging and comparisons.",
    label: "Force standard",
    value: "standard",
  },
  {
    description:
      "Forces the premium writeup path for debugging and comparisons.",
    label: "Force premium",
    value: "premium",
  },
];

const recapInterviewIntensityOptions: RecapInterviewIntensityOption[] = [
  {
    description:
      "Distinctive, quotable voices that stay broadcast-safe and do not directly trash the opponent.",
    label: "Clean",
    value: RecapInterviewIntensityEnum.CLEAN,
  },
  {
    description:
      "The default: bolder boasts, playful trash talk, philosophy, and funny swagger without crossing into explicit hostility.",
    label: "PG-13",
    value: RecapInterviewIntensityEnum.PG13,
  },
  {
    description:
      "The most theatrical setting: sharper banter, bigger ego, and much harsher competitive energy.",
    label: "Full heat",
    value: RecapInterviewIntensityEnum.FULL_HEAT,
  },
  {
    description:
      "Skips player interviews entirely to reduce recap generation cost.",
    label: "No interviews",
    value: RecapInterviewIntensityEnum.NONE,
  },
];

export function RecapPanel({
  canUseLeagueWriteups,
  context,
  isLoadingLeagueWriteupAccess,
}: RecapPanelProps) {
  const safeContext: Partial<RecapPanelContext> = context;
  const isNonProdDebugUi = useMemo(() => isNonProductionClientRuntime(), []);
  const defaultLeagueId = safeContext.connection?.leagueId ?? "";
  const defaultLeagueTimeZone = resolveWorkspaceLeagueTimeZone(safeContext);
  const [branch, setBranch] = useState<RecapBranch>(() =>
    canUseLeagueWriteups ? "WRITEUPS" : "PERFORMANCES",
  );
  const [mode, setMode] = useState<RecapMode>("LEAGUE_DATE");
  const [approach, setApproach] = useState<RecapGenerationApproach>(
    RecapGenerationApproachEnum.FACT_LIBRARY_FIRST,
  );
  const [interviewIntensity, setInterviewIntensity] =
    useState<RecapInterviewIntensity>(RecapInterviewIntensityEnum.PG13);
  const [qualityTier, setQualityTier] = useState<DebugRecapQualityTier>("AUTO");
  const [modelJudgeEnabled, setModelJudgeEnabled] = useState(
    DEFAULT_MODEL_JUDGE_ENABLED,
  );
  const [winnerInterviewPersonalityType, setWinnerInterviewPersonalityType] =
    useState<DebugInterviewPersonalitySelection>("");
  const [loserInterviewPersonalityType, setLoserInterviewPersonalityType] =
    useState<DebugInterviewPersonalitySelection>("");
  const [leagueId, setLeagueId] = useState(defaultLeagueId);
  const [leagueTimeZone, setLeagueTimeZone] = useState(
    defaultLeagueTimeZone ?? "",
  );
  const [gameDate, setGameDate] = useState(resolveDefaultRecapDate(safeContext));
  const [gameDayNumber, setGameDayNumber] = useState("1");
  const [season, setSeason] = useState("");
  const [matchId, setMatchId] = useState("");
  const [selectedRecapKey, setSelectedRecapKey] = useState<string | null>(null);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    message: string;
    tone: "error" | "note" | "success";
  } | null>(null);
  const recapHistoryQuery = useQuery({
    ...recapHistoryQueryOptions({ limit: 8 }),
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) =>
      hasActiveRecapHistory(query.state.data?.items ?? []) ? 4000 : false,
  });
  const submitRecapMutation = useMutation({
    mutationFn: (input: {
      branch: RecapBranch;
      canUseLeagueWriteups: boolean;
      context: RecapPanelContext;
      gameDate: string;
      gameDayNumber: string;
      interviewIntensity: RecapInterviewIntensity;
      leagueId: string;
      leagueTimeZone: string;
      matchId: string;
      mode: RecapMode;
      approach: RecapGenerationApproach;
      qualityTier: DebugRecapQualityTier;
      modelJudgeEnabled: boolean;
      season: string;
      winnerInterviewPersonalityType: DebugInterviewPersonalitySelection;
      loserInterviewPersonalityType: DebugInterviewPersonalitySelection;
    }) => submitRecapRequest(input),
  });
  const allHistory = useMemo(
    () => sortRecapHistory(recapHistoryQuery.data?.items ?? []),
    [recapHistoryQuery.data?.items],
  );
  const recaps = useMemo(
    () => filterRecapHistoryForBranch(allHistory, branch),
    [allHistory, branch],
  );
  const isLoadingRecaps = recapHistoryQuery.isPending;
  const isSubmitting = submitRecapMutation.isPending;
  const submissionBlockReason = resolveSubmissionBlockReason({
    branch,
    canUseLeagueWriteups,
    context: safeContext,
    gameDate,
    gameDayNumber,
    historyLoaded: Boolean(
      recapHistoryQuery.data || !recapHistoryQuery.isPending,
    ),
    isLoadingLeagueWriteupAccess,
    leagueId,
    leagueTimeZone,
    matchId,
    mode,
    season,
  });

  useEffect(() => {
    if (!canUseLeagueWriteups && !isLoadingLeagueWriteupAccess) {
      setBranch((current) =>
        current === "WRITEUPS" ? "PERFORMANCES" : current,
      );
    }
  }, [canUseLeagueWriteups, isLoadingLeagueWriteupAccess]);

  useEffect(() => {
    if (!leagueId && defaultLeagueId) {
      setLeagueId(defaultLeagueId);
    }
  }, [defaultLeagueId, leagueId]);

  useEffect(() => {
    if (!leagueTimeZone && defaultLeagueTimeZone) {
      setLeagueTimeZone(defaultLeagueTimeZone);
    }
  }, [defaultLeagueTimeZone, leagueTimeZone]);

  useEffect(() => {
    if (recapHistoryQuery.error) {
      setRecapError(readQueryError(recapHistoryQuery.error));
    }
  }, [recapHistoryQuery.error]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyFeedback(null);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyFeedback]);
  useEffect(() => {
    setSelectedRecapKey((current) => {
      const targetKey = current;
      if (
        targetKey &&
        recaps.some((recap) => recap.selectionKey === targetKey)
      ) {
        return targetKey;
      }

      return recaps[0]?.selectionKey ?? null;
    });
  }, [recaps]);

  async function handleSubmit() {
    setRecapError(null);

    if (submissionBlockReason) {
      setRecapError(submissionBlockReason);
      return;
    }

    try {
      const result = await submitRecapMutation.mutateAsync({
        approach,
        branch,
        canUseLeagueWriteups,
        context,
        gameDate,
        gameDayNumber,
        interviewIntensity,
        leagueId,
        leagueTimeZone,
        mode,
        season,
        qualityTier,
        matchId,
        modelJudgeEnabled,
        winnerInterviewPersonalityType,
        loserInterviewPersonalityType,
      });

      captureAnalyticsEvent("recap_requested", {
        has_custom_league_id: leagueId.trim() !== defaultLeagueId,
        has_match_id: Boolean(matchId.trim()),
        has_season_override: Boolean(season.trim()),
        interview_intensity:
          branch === "WRITEUPS" ? interviewIntensity : "n/a",
        mode:
          branch === "WRITEUPS"
            ? mode.toLowerCase()
            : "league_game_day_performances",
        requested_quality_tier:
          branch === "WRITEUPS" ? qualityTier.toLowerCase() : "n/a",
        model_judge_enabled:
          branch === "WRITEUPS" ? modelJudgeEnabled : false,
        has_debug_interview_overrides:
          branch === "WRITEUPS" &&
          mode === "SINGLE_GAME" &&
          (winnerInterviewPersonalityType !== "" ||
            loserInterviewPersonalityType !== ""),
      });
      const selectionKey = toRecapSelectionKey(result.kind, result.targetKey);
      setSelectedRecapKey(selectionKey);
      await recapHistoryQuery.refetch();
    } catch (error) {
      captureAnalyticsEvent("recap_request_failed", {
        interview_intensity:
          branch === "WRITEUPS" ? interviewIntensity : "n/a",
        mode:
          branch === "WRITEUPS"
            ? mode.toLowerCase()
            : "league_game_day_performances",
        requested_quality_tier:
          branch === "WRITEUPS" ? qualityTier.toLowerCase() : "n/a",
      });
      setRecapError(readQueryError(error));
    }
  }

  async function handleCopyForumPost() {
    if (!selectedRecap) {
      return;
    }

    try {
      const forumPost =
        selectedRecap.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
          ? selectedPerformanceResult
            ? formatLeagueGameDayPerformancesForumPost(
                selectedRecap,
                selectedPerformanceResult,
              )
            : null
          : selectedWriteupResult
            ? formatRecapForumPost(selectedRecap, selectedWriteupResult)
            : null;
      if (!forumPost) {
        return;
      }

      await copyTextToClipboard(forumPost);
      captureAnalyticsEvent("recap_forum_post_copied", {
        mode: selectedRecap.kind.toLowerCase(),
        status: selectedRecap.status,
      });
      setCopyFeedback({
        message:
          selectedRecap.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
            ? "Forum-ready performances copied."
            : "Forum-ready recap copied.",
        tone: "success",
      });
    } catch {
      setCopyFeedback({
        message: "Clipboard copy failed.",
        tone: "error",
      });
    }
  }

  const selectedRecap =
    recaps.find((recap) => recap.selectionKey === selectedRecapKey) ??
    recaps.at(0) ??
    null;
  const selectedWriteupResult =
    selectedRecap && selectedRecap.kind !== "LEAGUE_GAME_DAY_PERFORMANCES"
      ? toGameDayRecapResult(selectedRecap.resultJson)
      : null;
  const selectedPerformanceResult =
    selectedRecap?.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? toLeagueGameDayPerformancesResult(selectedRecap.resultJson)
      : null;
  const selectedRecapCost =
    selectedRecap?.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? null
      : toGameDayRecapCost(selectedRecap?.costJson);
  const selectedGameOfTheDay = selectedWriteupResult
    ? findGameOfTheDay(selectedWriteupResult)
    : null;
  const selectedCoverage = toGameDayRecapCoverage(selectedRecap?.coverageJson);
  const selectedRecapDisplayError = selectedRecap
    ? getRecapDisplayError(selectedRecap)
    : null;
  const selectedRecapTimedOut = selectedRecap
    ? isLocallyTimedOutRecap(selectedRecap)
    : false;
  const recapDetail = selectedRecap
    ? describeRecapRecord(selectedRecap)
    : branch === "WRITEUPS"
      ? "No writeup selected"
      : "No performances report selected";
  const selectedRecapCostSummary = formatRecapCostSummary(selectedRecapCost);
  const selectedRecapModelJudgeEnabled = selectedRecap
    ? didRecapRequestRunModelJudge(selectedRecap)
    : false;
  const currentLeagueName = safeContext.connection?.leagueName ?? "Your league";
  const normalizedLeagueTimeZone = normalizeLeagueTimeZone(leagueTimeZone);
  const maxGameDate = resolveRecapInputMaxDate(leagueTimeZone);
  const activeMode =
    recapModes.find((entry) => entry.value === mode) ?? recapModes[0];
  const activeApproach =
    recapApproachOptions.find((entry) => entry.value === approach) ??
    recapApproachOptions[0];
  const activeInterviewIntensity =
    recapInterviewIntensityOptions.find(
      (entry) => entry.value === interviewIntensity,
    ) ?? recapInterviewIntensityOptions[1];
  const activeQualityTier =
    recapQualityTierOptions.find((entry) => entry.value === qualityTier) ??
    recapQualityTierOptions[0];
  if (!activeMode) {
    throw new Error("At least one recap mode must be configured.");
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            disabled={Boolean(submissionBlockReason)}
            loading={isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {submitLabelForSelection(branch, mode)}
          </Button>
        }
        description="Switch between premium AI writeups and the free deterministic performances report inside one recap hub."
        eyebrow="Recaps"
        title="Recap generator"
      />

      <div className={modeSwitcherClassName}>
        {recapBranches.map((entry) => (
          <Button
            key={entry.value}
            onClick={() => setBranch(entry.value)}
            size="sm"
            variant={branch === entry.value ? "primary" : "secondary"}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <p className={statusCopyClassName}>
        {branch === "WRITEUPS"
          ? RECAP_CAPABILITY_SUMMARY
          : PERFORMANCE_CAPABILITY_SUMMARY}
      </p>

      {branch === "WRITEUPS" && !canUseLeagueWriteups ? (
        <Alert>
          {isLoadingLeagueWriteupAccess
            ? "Checking writeup access."
            : "AI writeups require Premium. Switch to Performances for the free league game-day report."}
        </Alert>
      ) : null}

      {recapError ? <Alert>{recapError}</Alert> : null}

      <div className={twoColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description={
              branch === "WRITEUPS"
                ? activeMode.description
                : "Build the deterministic league game-day performances report from the final regular-season slate."
            }
            title="Request"
            titleAs="h4"
          />

          {branch === "WRITEUPS" ? (
            <>
              <div className={modeSwitcherClassName}>
                {recapModes.map((entry) => (
                  <Button
                    key={entry.value}
                    onClick={() => setMode(entry.value)}
                    size="sm"
                    variant={mode === entry.value ? "primary" : "secondary"}
                  >
                    {entry.label}
                  </Button>
                ))}
              </div>

              <div className="mt-4 grid gap-3">
                <SectionHeading
                  description={activeApproach?.description}
                  title="Generation approach"
                  titleAs="h5"
                />
                <div className={modeSwitcherClassName}>
                  {recapApproachOptions.map((entry) => (
                    <Button
                      key={entry.value}
                      onClick={() => setApproach(entry.value)}
                      size="sm"
                      variant={
                        approach === entry.value ? "primary" : "secondary"
                      }
                    >
                      {entry.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <SectionHeading
                  description={activeInterviewIntensity?.description}
                  title="Interview intensity"
                  titleAs="h5"
                />
                <div className={modeSwitcherClassName}>
                  {recapInterviewIntensityOptions.map((entry) => (
                    <Button
                      key={entry.value}
                      onClick={() => setInterviewIntensity(entry.value)}
                      size="sm"
                      variant={
                        interviewIntensity === entry.value
                          ? "primary"
                          : "secondary"
                      }
                    >
                      {entry.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <SectionHeading
                  description={activeQualityTier?.description}
                  title="Writeup tier"
                  titleAs="h5"
                />
                <div className={modeSwitcherClassName}>
                  {recapQualityTierOptions.map((entry) => (
                    <Button
                      key={entry.value}
                      onClick={() => setQualityTier(entry.value)}
                      size="sm"
                      variant={
                        qualityTier === entry.value ? "primary" : "secondary"
                      }
                    >
                      {entry.label}
                    </Button>
                  ))}
                </div>
                <label className="flex max-w-xl items-start gap-3 rounded-md border border-black/10 bg-surface-muted/50 px-3 py-2 text-sm leading-6 text-ink">
                  <input
                    checked={modelJudgeEnabled}
                    className="mt-1 size-4 accent-ink"
                    onChange={(event) =>
                      setModelJudgeEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                    <span>
                      <span className="block font-medium">Model fact review</span>
                      <span className="block text-ink-muted">
                        Run the extra AI judge pass for this request.
                      </span>
                      <span className="block text-ink-muted">
                        Turning it off skips only that extra review. Deterministic
                        fact checks still run.
                      </span>
                    </span>
                  </label>
              </div>

              {mode === "LEAGUE_DATE" ? (
                <>
                  <div className={formGridClassName}>
                    <Field label="League number">
                      <Input
                        onChange={(event) => setLeagueId(event.target.value)}
                        placeholder="League number"
                        value={leagueId}
                      />
                    </Field>
                    <Field
                      hint={`Max date uses ${normalizedLeagueTimeZone ?? "your browser default"} league-day mapping.`}
                      label="Game date"
                    >
                      <Input
                        max={maxGameDate}
                        onChange={(event) => setGameDate(event.target.value)}
                        type="date"
                        value={gameDate}
                      />
                    </Field>
                  </div>

                  <Field
                    error={
                      leagueTimeZone.trim() && !normalizedLeagueTimeZone
                        ? "Enter a valid IANA time zone such as America/New_York."
                        : null
                    }
                    hint="Date-based recaps use the league's local calendar day to match that day's schedule."
                    label="League time zone"
                  >
                    <Input
                      onChange={(event) => setLeagueTimeZone(event.target.value)}
                      placeholder="America/New_York"
                      value={leagueTimeZone}
                    />
                  </Field>
                </>
              ) : null}

              {mode === "LEAGUE_GAME_DAY" ? (
                <div className={formGridClassName}>
                  <Field label="League number">
                    <Input
                      onChange={(event) => setLeagueId(event.target.value)}
                      placeholder="League number"
                      value={leagueId}
                    />
                  </Field>
                  <Field hint="Regular season only, from 1 to 22." label="Game day">
                    <Input
                      max={22}
                      min={1}
                      onChange={(event) => setGameDayNumber(event.target.value)}
                      type="number"
                      value={gameDayNumber}
                    />
                  </Field>
                  <Field
                    hint="Leave blank to use the current/open season."
                    label="Season (optional)"
                  >
                    <Input
                      min={1}
                      onChange={(event) => setSeason(event.target.value)}
                      placeholder="Current"
                      type="number"
                      value={season}
                    />
                  </Field>
                </div>
              ) : null}

              {mode === "SINGLE_GAME" ? (
                <div className="grid gap-4">
                  <Field hint="Example: 137828772" label="Game number">
                    <Input
                      inputMode="numeric"
                      onChange={(event) => setMatchId(event.target.value)}
                      placeholder="Game number"
                      value={matchId}
                    />
                  </Field>
                  {isNonProdDebugUi ? (
                    <div className={formGridClassName}>
                      <Field
                        hint="Override the winner interview voice for this single-game debug request."
                        label="Winner interview voice"
                      >
                        <Select
                          onChange={(event) =>
                            setWinnerInterviewPersonalityType(
                              event.currentTarget
                                .value as DebugInterviewPersonalitySelection,
                            )
                          }
                          value={winnerInterviewPersonalityType}
                        >
                          <option value="">Auto</option>
                          {INTERVIEW_PERSONALITY_TYPES.map(
                            (personalityType) => (
                              <option
                                key={`winner:${personalityType}`}
                                value={personalityType}
                              >
                                {resolveInterviewPersonalityLabel(
                                  personalityType,
                                )}
                              </option>
                            ),
                          )}
                        </Select>
                      </Field>
                      <Field
                        hint="Override the loser interview voice for this single-game debug request."
                        label="Loser interview voice"
                      >
                        <Select
                          onChange={(event) =>
                            setLoserInterviewPersonalityType(
                              event.currentTarget
                                .value as DebugInterviewPersonalitySelection,
                            )
                          }
                          value={loserInterviewPersonalityType}
                        >
                          <option value="">Auto</option>
                          {INTERVIEW_PERSONALITY_TYPES.map(
                            (personalityType) => (
                              <option
                                key={`loser:${personalityType}`}
                                value={personalityType}
                              >
                                {resolveInterviewPersonalityLabel(
                                  personalityType,
                                )}
                              </option>
                            ),
                          )}
                        </Select>
                      </Field>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className={formGridClassName}>
              <Field label="League number">
                <Input
                  onChange={(event) => setLeagueId(event.target.value)}
                  placeholder="League number"
                  value={leagueId}
                />
              </Field>
              <Field hint="Regular season only, from 1 to 22." label="Game day">
                <Input
                  max={22}
                  min={1}
                  onChange={(event) => setGameDayNumber(event.target.value)}
                  type="number"
                  value={gameDayNumber}
                />
              </Field>
              <Field
                hint="Leave blank to use the current/open season."
                label="Season (optional)"
              >
                <Input
                  min={1}
                  onChange={(event) => setSeason(event.target.value)}
                  placeholder="Current"
                  type="number"
                  value={season}
                />
              </Field>
            </div>
          )}

          {submissionBlockReason ? <Alert>{submissionBlockReason}</Alert> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              detail="Uses your connected club by default."
              label="Default source"
              value={currentLeagueName}
            />
            <StatCard
              detail={
                selectedCoverage
                  ? describeCoverage(selectedCoverage)
                  : branch === "WRITEUPS"
                    ? "No writeup result has been selected yet."
                    : "No performances report has been selected yet."
              }
              label="Latest coverage"
              value={selectedCoverage?.availableGames ?? 0}
            />
          </div>
        </Panel>

        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            actions={
              <Button
                loading={isLoadingRecaps}
                onClick={() => void recapHistoryQuery.refetch()}
                size="sm"
                variant="secondary"
              >
                Refresh list
              </Button>
            }
            title={
              branch === "WRITEUPS" ? "Recent writeups" : "Recent performances"
            }
            titleAs="h4"
          />

          {recaps.length ? (
            <ul className={listClassName}>
              {recaps.map((recap) => {
                const selected =
                  recap.selectionKey === selectedRecap?.selectionKey;
                const recapCostSnippet = formatRecapCostListSnippet(
                  recap.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
                    ? null
                    : recap.costJson,
                );
                return (
                  <li className={listItemClassName} key={recap.selectionKey}>
                    <button
                      className={[
                        "grid gap-1 rounded-2xl border px-4 py-3 text-left transition",
                        selected
                          ? "border-accent bg-accent/10"
                          : "hover:border-accent/35 border-black/8 bg-white",
                      ].join(" ")}
                      onClick={() => setSelectedRecapKey(recap.selectionKey)}
                      type="button"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-ink text-sm">
                          {recapTitle(recap)}
                        </strong>
                        <StatusBadge tone={getRecapStatusTone(recap)}>
                          {formatRecapStatus(recap)}
                        </StatusBadge>
                      </div>
                      <span className={statusCopyClassName}>
                        {describeRecapRecord(recap)}
                        {recapCostSnippet ? ` • ${recapCostSnippet}` : ""}
                        {" • "}
                        {formatTimestamp(recap.updatedAt)}
                      </span>
                      {getRecapDisplayError(recap) ? (
                        <span className="text-danger text-sm">
                          {getRecapDisplayError(recap)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={statusCopyClassName}>
              {branch === "WRITEUPS"
                ? "No writeups have been recorded yet."
                : "No performance reports have been recorded yet."}
            </p>
          )}
        </Panel>
      </div>

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          description={recapDetail}
          title={detailTitleForSelection({
            branch,
            record: selectedRecap,
            performancesResult: selectedPerformanceResult,
            writeupResult: selectedWriteupResult,
          })}
          titleAs="h4"
        />

        {selectedRecap ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone={getRecapStatusTone(selectedRecap)}>
                {formatRecapStatus(selectedRecap)}
              </StatusBadge>
              <StatusBadge tone="neutral">
                {modeLabelForRecord(selectedRecap)}
              </StatusBadge>
              {selectedRecap.kind !== "LEAGUE_GAME_DAY_PERFORMANCES" ? (
                <StatusBadge tone="neutral">
                  {formatRecapGenerationApproachLabel(
                    recapApproachForRecord(selectedRecap),
                  )}
                </StatusBadge>
              ) : null}
              {selectedRecap.completedAt ? (
                <span className={statusCopyClassName}>
                  Completed {formatTimestamp(selectedRecap.completedAt)}
                </span>
              ) : null}
            </div>
            {selectedRecapCostSummary ? (
              <p className={statusCopyClassName}>{selectedRecapCostSummary}</p>
            ) : null}
            {selectedRecapCost ? (
              <details className="rounded-panel border border-black/8 bg-surface px-4 py-3">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <strong className="text-ink text-sm">
                    {formatRecapCostBreakdownLabel(selectedRecapCost)}
                  </strong>
                  <StatusBadge tone="neutral">
                    {formatRecapCostPricingStatusLabel(
                      selectedRecapCost.pricingStatus,
                    )}
                  </StatusBadge>
                  {typeof selectedRecapCost.estimatedTotalCostUsd === "number" ? (
                    <StatusBadge tone="note">
                      {formatUsdCost(selectedRecapCost.estimatedTotalCostUsd)} total
                    </StatusBadge>
                  ) : null}
                  {typeof selectedRecapCost.estimatedPerGameCostUsd === "number" ? (
                    <StatusBadge tone="neutral">
                      {formatUsdCost(selectedRecapCost.estimatedPerGameCostUsd)} per game
                    </StatusBadge>
                  ) : null}
                </summary>
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                      detail="Based on known model pricing for the stages that reported usage."
                      label="Pricing status"
                      value={formatRecapCostPricingStatusLabel(
                        selectedRecapCost.pricingStatus,
                      )}
                    />
                    <StatCard
                      detail="Across all recap model stages for this request."
                      label="Total estimate"
                      value={
                        typeof selectedRecapCost.estimatedTotalCostUsd === "number"
                          ? formatUsdCost(selectedRecapCost.estimatedTotalCostUsd)
                          : "Unavailable"
                      }
                    />
                    <StatCard
                      detail="Approximate cost share for each generated game summary."
                      label="Per-game estimate"
                      value={
                        typeof selectedRecapCost.estimatedPerGameCostUsd === "number"
                          ? formatUsdCost(selectedRecapCost.estimatedPerGameCostUsd)
                          : "Unavailable"
                      }
                    />
                    <StatCard
                      detail={`${selectedRecapCost.requestCount.toLocaleString("en-US")} model ${selectedRecapCost.requestCount === 1 ? "request" : "requests"}`}
                      label="Total tokens"
                      value={selectedRecapCost.totalTokens.toLocaleString("en-US")}
                    />
                  </div>
                  {selectedRecapCost.stages.length ? (
                    <div className="grid gap-3">
                      {selectedRecapCost.stages.map((stage, index) => (
                        <div
                          className="rounded-panel border border-black/8 bg-white px-4 py-3"
                          key={`${stage.stage}-${stage.modelId}-${index}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-ink text-sm">
                              {formatRecapCostStageSummary(stage)}
                            </strong>
                            <StatusBadge tone="neutral">
                              {stage.providerName}
                            </StatusBadge>
                          </div>
                          <p className={`${statusCopyClassName} mt-2`}>
                            {formatRecapCostStageDetail(stage)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={statusCopyClassName}>
                      No stage-level model usage was recorded for this recap.
                    </p>
                  )}
                </div>
              </details>
            ) : null}

            {selectedCoverage?.partial ? (
              <Alert>
                Partial coverage: {selectedCoverage.availableGames} of{" "}
                {selectedCoverage.requestedGames} games were available. Missing
                games:{" "}
                {selectedCoverage.missingGames
                  .map(
                    (game) =>
                      `${game.awayTeamName} at ${game.homeTeamName} (${game.reason})`,
                  )
                  .join("; ")}
              </Alert>
            ) : null}

            {selectedRecapDisplayError ? (
              <Alert>{selectedRecapDisplayError}</Alert>
            ) : null}

            {selectedRecap.kind === "LEAGUE_GAME_DAY_PERFORMANCES" &&
            selectedPerformanceResult ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => void handleCopyForumPost()}
                    size="sm"
                    variant="secondary"
                  >
                    {copyFeedback && copyFeedback.tone !== "error"
                      ? "Copied"
                      : "Copy for forum"}
                  </Button>
                  <span
                    className={
                      copyFeedback?.tone === "error"
                        ? "text-danger text-sm leading-7"
                        : statusCopyClassName
                    }
                  >
                    {copyFeedback?.message ??
                      "Copies BBCode with night results, leaderboards, and spotlight sections for forum posting."}
                  </span>
                </div>
                <div className="grid gap-4">
                  <Panel as="article" padding="sm" variant="glass">
                    <SectionHeading title="Night results" titleAs="h5" />
                    <ul className={listClassName}>
                      {selectedPerformanceResult.games.map((game) => (
                        <li className={listItemClassName} key={game.matchId}>
                          <span className="text-ink text-sm font-semibold">
                            {formatPerformanceGameResult(game)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Panel as="article" padding="sm" variant="glass">
                      <SectionHeading
                        title="Best team performances"
                        titleAs="h5"
                      />
                      {renderPerformancesLeaderboardList(
                        selectedPerformanceResult.teamLeaders,
                      )}
                    </Panel>
                    <Panel as="article" padding="sm" variant="glass">
                      <SectionHeading
                        title="Best player performances"
                        titleAs="h5"
                      />
                      {renderPerformancesLeaderboardList(
                        selectedPerformanceResult.playerLeaders,
                      )}
                    </Panel>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Panel as="article" padding="sm" variant="glass">
                      <SectionHeading title="Top five" titleAs="h5" />
                      {renderPerformancesLeaderboardList(
                        selectedPerformanceResult.topFive,
                      )}
                    </Panel>
                    <Panel as="article" padding="sm" variant="glass">
                      <SectionHeading title="Spotlight" titleAs="h5" />
                      {renderPerformanceSpotlight(selectedPerformanceResult)}
                    </Panel>
                  </div>

                  <Panel as="article" padding="sm" variant="glass">
                    <SectionHeading title="Stat callouts" titleAs="h5" />
                    {renderPerformancesLeaderboardList(
                      selectedPerformanceResult.statCallouts,
                    )}
                  </Panel>
                </div>
              </>
            ) : selectedWriteupResult ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => void handleCopyForumPost()}
                    size="sm"
                    variant="secondary"
                  >
                    {copyFeedback && copyFeedback.tone !== "error"
                      ? "Copied"
                      : "Copy for forum"}
                  </Button>
                  <span
                    className={
                      copyFeedback?.tone === "error"
                        ? "text-danger text-sm leading-7"
                        : statusCopyClassName
                    }
                  >
                    {copyFeedback?.message ??
                      "Copies BBCode with match links for forum posting."}
                  </span>
                </div>
                {selectedGameOfTheDay ? (
                  <Panel as="article" padding="sm" variant="glass">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="note">Game of the day</StatusBadge>
                      {selectedGameOfTheDay.surpriseFactor != null ? (
                        <StatusBadge tone="neutral">
                          Surprise factor:{" "}
                          {formatSurpriseFactor(
                            selectedGameOfTheDay.surpriseFactor,
                          )}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <p className="text-ink mt-3 text-sm font-semibold">
                      {selectedGameOfTheDay.headline}
                    </p>
                  </Panel>
                ) : null}
                <p className={statusCopyClassName}>
                  {selectedWriteupResult.summary.lede}
                </p>
                <div className="grid gap-4">
                  {selectedWriteupResult.games.map((game) => {
                    const validation = getRecapGameValidation(game);
                    const hasValidationWarnings =
                      validation.status !== "VALID" && validation.issueCount > 0;
                    const validationIssuesBySource = partitionRecapValidationIssues(
                      validation.issues,
                    );
                    const hasDeterministicWarnings =
                      validationIssuesBySource.deterministic.length > 0;
                    const hasJudgeWarnings =
                      validationIssuesBySource.judge.length > 0;
                    const validationAlertSummary = hasValidationWarnings
                      ? buildRecapValidationAlertSummary({
                          hasDeterministicWarnings,
                          hasJudgeWarnings,
                          modelJudgeEnabled: selectedRecapModelJudgeEnabled,
                        })
                      : null;
                    const postgameInterviews = (
                      game.postgameInterviews?.length
                        ? game.postgameInterviews
                        : game.postgameInterview
                          ? [game.postgameInterview]
                          : []
                    ).filter(isPresent);
                    const postgameInterviewDiagnostics = (
                      game.postgameInterviewDiagnostics ?? []
                    ).filter(isPresent);
                    const hasSuspectPostgameInterview =
                      postgameInterviewDiagnostics.some(
                        (diagnostic) => diagnostic.status === "suspect",
                      );
                    return (
                    <Panel as="article" key={game.matchId} padding="sm" variant="glass">
                      <SectionHeading title={game.headline} titleAs="h5" />
                      {game.surpriseFactor != null ||
                      game.matchId === selectedGameOfTheDay?.matchId ||
                      hasValidationWarnings ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {hasValidationWarnings ? (
                            <StatusBadge tone={validation.status === "UNSAFE" ? "danger" : "note"}>
                              {formatRecapValidationStatus(validation.status)}
                            </StatusBadge>
                          ) : null}
                          {game.surpriseFactor != null ? (
                            <StatusBadge tone="neutral">
                              Surprise factor:{" "}
                              {formatSurpriseFactor(game.surpriseFactor)}
                            </StatusBadge>
                          ) : null}
                          {game.matchId === selectedGameOfTheDay?.matchId ? (
                            <StatusBadge tone="note">
                              Game of the day
                            </StatusBadge>
                          ) : null}
                          {selectedRecapCost?.estimatedPerGameCostUsd != null ? (
                            <StatusBadge tone="neutral">
                              Est. cost share:{" "}
                              {formatUsdCost(
                                selectedRecapCost.estimatedPerGameCostUsd,
                              )}
                            </StatusBadge>
                          ) : null}
                        </div>
                      ) : null}
                      {hasValidationWarnings ? (
                        <Alert className="mb-3" tone="note">
                          <strong className="text-ink">
                            Fact checks flagged this recap
                          </strong>
                          {validationAlertSummary ? (
                            <p className="mt-1 text-sm text-ink-muted">
                              {validationAlertSummary}
                            </p>
                          ) : null}
                          {hasDeterministicWarnings ? (
                            <div className="mt-3 grid gap-2">
                              <strong className="text-ink text-sm">
                                Deterministic fact checks
                              </strong>
                              <ul className="grid list-disc gap-1 pl-5">
                                {validationIssuesBySource.deterministic.map(
                                  (issue, index) => (
                                    <li
                                      key={`${issue.source}:${issue.field}:${issue.sentenceIndex}:${index}`}
                                    >
                                      {formatRecapValidationIssue(issue)}
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}
                          {hasJudgeWarnings ? (
                            <div className="mt-3 grid gap-2">
                              <strong className="text-ink text-sm">
                                Model fact review
                              </strong>
                              <ul className="grid list-disc gap-1 pl-5">
                                {validationIssuesBySource.judge.map(
                                  (issue, index) => (
                                    <li
                                      key={`${issue.source}:${issue.field}:${issue.sentenceIndex}:${index}`}
                                    >
                                      {formatRecapValidationIssue(issue)}
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}
                        </Alert>
                      ) : null}
                      <div className="grid gap-3">
                        {splitRecapWriteupParagraphs(game.writeup).map(
                          (paragraph, index) => (
                            <p className="text-ink text-sm leading-7" key={index}>
                              {paragraph}
                            </p>
                          ),
                        )}
                      </div>
                      {postgameInterviews.length ? (
                        <div className="mt-4 grid gap-3">
                          {hasSuspectPostgameInterview ? (
                            <p className={statusCopyClassName}>
                              Interview note: both sides&apos; quotes were kept for
                              this single-game recap, and one or more answers may
                              include unsupported details.
                            </p>
                          ) : null}
                          {postgameInterviews.map((interview, interviewIndex) => (
                            <div
                              className="grid gap-3 rounded-panel border border-black/8 bg-surface px-4 py-3"
                              key={`${interview.teamSide}:${interview.playerName}:${interviewIndex}`}
                            >
                              <div className="grid gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <strong className="text-ink text-sm">
                                    {interview.title}
                                  </strong>
                                  {isNonProdDebugUi ? (
                                    <RecapInterviewDebugBadges
                                      context={safeContext}
                                      interview={interview}
                                    />
                                  ) : null}
                                </div>
                                <span className={statusCopyClassName}>
                                  {interview.playerName} • {interview.teamName}
                                </span>
                              </div>
                              <div className="grid gap-3">
                                {interview.qa.map((exchange, index) => (
                                  <div className="grid gap-1" key={index}>
                                    <p className="text-ink text-sm leading-6">
                                      <strong>Q:</strong> {exchange.question}
                                    </p>
                                    <p className={statusCopyClassName}>
                                      <strong className="text-ink">A:</strong>{" "}
                                      {exchange.answer}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {isNonProdDebugUi &&
                          postgameInterviewDiagnostics.length ? (
                            <div className={statusCopyClassName}>
                              {postgameInterviewDiagnostics
                                .map(
                                  (diagnostic) =>
                                    `${diagnostic.side}: ${diagnostic.status}${
                                      diagnostic.reason
                                        ? ` (${diagnostic.reason})`
                                        : ""
                                    }`,
                                )
                                .join(" · ")}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {game.evidenceTags.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {game.evidenceTags.map((tag) => (
                            <StatusBadge key={tag} tone="neutral">
                              {formatEvidenceTag(tag)}
                            </StatusBadge>
                          ))}
                        </div>
                      ) : null}
                    </Panel>
                    );
                  })}
                </div>
              </>
            ) : (
              selectedRecap.kind !== "LEAGUE_GAME_DAY_PERFORMANCES" &&
              selectedRecap.failureJson ? (
                <RecapFailureDiagnostics failure={selectedRecap.failureJson} />
              ) : (
                <p className={statusCopyClassName}>
                  {selectedRecapTimedOut
                    ? selectedRecap.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
                      ? "The selected performances request timed out before a structured report was saved."
                      : "The selected recap request timed out before a structured result was saved."
                    : selectedRecap.status === "FAILED"
                    ? selectedRecap.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
                      ? "The selected performances request failed before a structured report was saved."
                      : "The selected recap failed before a structured result was saved."
                    : selectedRecap.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
                      ? "Report details will appear here once the request finishes."
                      : "Writeup details will appear here once the request finishes."}
                </p>
              )
            )}
          </div>
        ) : (
          <p className={statusCopyClassName}>
            {branch === "WRITEUPS"
              ? "Select a prior writeup or generate a new one to review the stories."
              : "Select a prior performances report or generate a new one to review the slate leaders."}
          </p>
        )}
      </Panel>
    </Panel>
  );
}

type RecapSubmissionDependencies = {
  setBbLeagueTimeZone: typeof setBbLeagueTimeZoneMutation;
  submitGameDayRecap: typeof submitGameDayRecapMutation;
  submitLeagueGameDayPerformances: typeof submitLeagueGameDayPerformancesMutation;
  submitLeagueGameDayRecap: typeof submitLeagueGameDayRecapMutation;
  submitSingleGameSummary: typeof submitSingleGameSummaryMutation;
};

const defaultRecapSubmissionDependencies: RecapSubmissionDependencies = {
  setBbLeagueTimeZone: setBbLeagueTimeZoneMutation,
  submitGameDayRecap: submitGameDayRecapMutation,
  submitLeagueGameDayPerformances: submitLeagueGameDayPerformancesMutation,
  submitLeagueGameDayRecap: submitLeagueGameDayRecapMutation,
  submitSingleGameSummary: submitSingleGameSummaryMutation,
};

async function submitRecapRequest(
  args: {
    approach: RecapGenerationApproach;
    branch: RecapBranch;
    canUseLeagueWriteups: boolean;
    context: RecapPanelContext;
    gameDate: string;
    gameDayNumber: string;
    interviewIntensity: RecapInterviewIntensity;
    leagueId: string;
    leagueTimeZone: string;
    loserInterviewPersonalityType: DebugInterviewPersonalitySelection;
    matchId: string;
    modelJudgeEnabled: boolean;
    mode: RecapMode;
    qualityTier: DebugRecapQualityTier;
    season: string;
    winnerInterviewPersonalityType: DebugInterviewPersonalitySelection;
  },
  dependencies: RecapSubmissionDependencies = defaultRecapSubmissionDependencies,
): Promise<{ kind: RecapHistoryKind; targetKey: string }> {
  const normalizedLeagueId = args.leagueId.trim();
  const normalizedTimeZone = normalizeLeagueTimeZone(args.leagueTimeZone);
  const numericGameDay = Number(args.gameDayNumber);
  const seasonValue = args.season.trim() ? Number(args.season) : undefined;

  if (args.branch === "PERFORMANCES") {
    if (!normalizedLeagueId || !Number.isInteger(numericGameDay)) {
      throw new Error(
        "Enter a league number and regular-season game day from 1 to 22.",
      );
    }
    if (numericGameDay < 1 || numericGameDay > 22) {
      throw new Error("League game day must be between 1 and 22.");
    }
    if (
      args.season.trim() &&
      (!Number.isInteger(seasonValue) || (seasonValue ?? 0) < 1)
    ) {
      throw new Error("Season must be a positive integer when provided.");
    }

    const result = await dependencies.submitLeagueGameDayPerformances({
      gameDayNumber: numericGameDay,
      leagueId: normalizedLeagueId,
      ...(seasonValue ? { season: seasonValue } : {}),
    });
    return {
      kind: "LEAGUE_GAME_DAY_PERFORMANCES",
      targetKey: result.targetKey,
    };
  }

  if (!args.canUseLeagueWriteups) {
    throw new Error(
      "AI writeups require Premium. Switch to Performances for the free league game-day report.",
    );
  }

  switch (args.mode) {
    case "LEAGUE_DATE": {
      if (!normalizedLeagueId || !args.gameDate) {
        throw new Error(
          "Pick a league number, date, and time zone before requesting a recap.",
        );
      }
      if (!normalizedTimeZone) {
        throw new Error(
          "Enter a valid league time zone before requesting a date-based recap.",
        );
      }

      const currentTimeZone = resolveWorkspaceLeagueTimeZone(args.context);
      if (currentTimeZone !== normalizedTimeZone) {
        await dependencies.setBbLeagueTimeZone({
          leagueTimeZone: normalizedTimeZone,
        });
      }

      const result = await dependencies.submitGameDayRecap({
        approach: args.approach,
        gameDate: args.gameDate,
        interviewIntensity: args.interviewIntensity,
        leagueId: normalizedLeagueId,
        leagueTimeZone: normalizedTimeZone,
        modelJudgeEnabled: args.modelJudgeEnabled,
        ...(args.qualityTier !== "AUTO"
          ? { qualityTier: args.qualityTier }
          : {}),
      });
      return {
        kind: "LEAGUE_DATE",
        targetKey: result.targetKey,
      };
    }
    case "LEAGUE_GAME_DAY": {
      if (!normalizedLeagueId || !Number.isInteger(numericGameDay)) {
        throw new Error(
          "Enter a league number and regular-season game day from 1 to 22.",
        );
      }
      if (numericGameDay < 1 || numericGameDay > 22) {
        throw new Error("League game day must be between 1 and 22.");
      }
      if (
        args.season.trim() &&
        (!Number.isInteger(seasonValue) || (seasonValue ?? 0) < 1)
      ) {
        throw new Error("Season must be a positive integer when provided.");
      }

      const result = await dependencies.submitLeagueGameDayRecap({
        approach: args.approach,
        gameDayNumber: numericGameDay,
        interviewIntensity: args.interviewIntensity,
        leagueId: normalizedLeagueId,
        modelJudgeEnabled: args.modelJudgeEnabled,
        ...(args.qualityTier !== "AUTO"
          ? { qualityTier: args.qualityTier }
          : {}),
        ...(seasonValue ? { season: seasonValue } : {}),
      });
      return {
        kind: "LEAGUE_GAME_DAY",
        targetKey: result.targetKey,
      };
    }
    case "SINGLE_GAME": {
      const normalizedMatchId = args.matchId.trim();
      if (!/^\d+$/.test(normalizedMatchId)) {
        throw new Error("Enter a numeric BuzzerBeater game number.");
      }

      const result = await dependencies.submitSingleGameSummary({
        approach: args.approach,
        interviewIntensity: args.interviewIntensity,
        ...(args.loserInterviewPersonalityType
          ? {
              loserInterviewPersonalityType:
                args.loserInterviewPersonalityType,
            }
          : {}),
        matchId: normalizedMatchId,
        modelJudgeEnabled: args.modelJudgeEnabled,
        ...(args.qualityTier !== "AUTO"
          ? { qualityTier: args.qualityTier }
          : {}),
        ...(args.winnerInterviewPersonalityType
          ? {
              winnerInterviewPersonalityType:
                args.winnerInterviewPersonalityType,
            }
          : {}),
      });
      return {
        kind: "SINGLE_GAME",
        targetKey: result.targetKey,
      };
    }
  }
}

function toRecapSelectionKey(kind: RecapHistoryKind, targetKey: string): string {
  return `${kind}:${targetKey}`;
}

function sortRecapHistory(
  recaps: readonly RecapHistoryRecord[],
): RecapHistoryRecord[] {
  return [...recaps].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function recapTitle(record: RecapHistoryRecord): string {
  const headline =
    record.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? null
      : toGameDayRecapResult(record.resultJson)?.summary.headline;
  if (headline) {
    return headline;
  }

  if (record.kind === "LEAGUE_GAME_DAY_PERFORMANCES") {
    return `${record.leagueName ?? "League"} performances`;
  }

  if (record.kind === "SINGLE_GAME") {
    return "Single-game recap";
  }

  return record.leagueName ?? "League recap";
}

function describeRecapRecord(record: RecapHistoryRecord): string {
  const approachLabel =
    record.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? null
      : formatRecapGenerationApproachLabel(recapApproachForRecord(record));
  const intensityLabel =
    record.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? null
      : formatRecapInterviewIntensityLabel(recapInterviewIntensityForRecord(record));
  switch (record.kind) {
    case "LEAGUE_GAME_DAY_PERFORMANCES":
      return `${record.leagueName ?? "League"} • performances • game day ${record.gameDayNumber}${record.gameDate ? ` • ${record.gameDate}` : ""}${record.season ? ` • season ${record.season}` : ""}`;
    case "LEAGUE_GAME_DAY":
      return `${record.leagueName ?? "League"} • game day ${record.gameDayNumber}${record.season ? ` • season ${record.season}` : ""}${approachLabel ? ` • ${approachLabel}` : ""}${intensityLabel ? ` • ${intensityLabel}` : ""}`;
    case "SINGLE_GAME":
      return `${record.leagueName ?? "Single game"}${record.gameDate ? ` • ${record.gameDate}` : ""}${approachLabel ? ` • ${approachLabel}` : ""}${intensityLabel ? ` • ${intensityLabel}` : ""}`;
    case "LEAGUE_DATE":
    default:
      return `${record.leagueName ?? "League"} • ${record.gameDate}${approachLabel ? ` • ${approachLabel}` : ""}${intensityLabel ? ` • ${intensityLabel}` : ""}`;
  }
}

function describeRecapForumRecord(record: RecapHistoryRecord): string {
  switch (record.kind) {
    case "LEAGUE_GAME_DAY_PERFORMANCES":
      return `${record.leagueName ?? "League"} • performances • game day ${record.gameDayNumber}${record.gameDate ? ` • ${record.gameDate}` : ""}${record.season ? ` • season ${record.season}` : ""}`;
    case "LEAGUE_GAME_DAY":
      return `${record.leagueName ?? "League"} • game day ${record.gameDayNumber}${record.season ? ` • season ${record.season}` : ""}`;
    case "SINGLE_GAME":
      return `${record.leagueName ?? "Single game"}${record.gameDate ? ` • ${record.gameDate}` : ""}`;
    case "LEAGUE_DATE":
    default:
      return `${record.leagueName ?? "League"} • ${record.gameDate}`;
  }
}

function recapApproachForRecord(
  record: RecapHistoryRecord,
): RecapGenerationApproach {
  if (record.kind === "LEAGUE_GAME_DAY_PERFORMANCES") {
    return RecapGenerationApproachEnum.LEGACY;
  }

  const targetKeyApproach = recapApproachForTargetKey(record.targetKey);
  if (targetKeyApproach) {
    return targetKeyApproach;
  }

  const approach = (
    record.requestJson as { approach?: RecapGenerationApproach | null }
  ).approach;
  switch (approach) {
    case RecapGenerationApproachEnum.FACT_LIBRARY_FIRST:
      return RecapGenerationApproachEnum.FACT_LIBRARY_FIRST;
    case RecapGenerationApproachEnum.SIMPLE_FACT_LIBRARY:
      return RecapGenerationApproachEnum.SIMPLE_FACT_LIBRARY;
    case RecapGenerationApproachEnum.LEGACY:
    case null:
    case undefined:
    default:
      return RecapGenerationApproachEnum.LEGACY;
  }
}

function recapApproachForTargetKey(
  targetKey: string,
): RecapGenerationApproach | null {
  if (targetKey.includes("#simple-fact-library")) {
    return RecapGenerationApproachEnum.SIMPLE_FACT_LIBRARY;
  }
  if (targetKey.includes("#fact-library-first")) {
    return RecapGenerationApproachEnum.FACT_LIBRARY_FIRST;
  }

  return null;
}

function formatRecapGenerationApproachLabel(
  approach: RecapGenerationApproach,
): string {
  switch (approach) {
    case RecapGenerationApproachEnum.FACT_LIBRARY_FIRST:
      return "Fact library first";
    case RecapGenerationApproachEnum.SIMPLE_FACT_LIBRARY:
      return "Simple fact library";
    case RecapGenerationApproachEnum.LEGACY:
    default:
      return "Classic recap engine";
  }
}

function recapInterviewIntensityForRecord(
  record: RecapHistoryRecord,
): RecapInterviewIntensity {
  if (record.kind === "LEAGUE_GAME_DAY_PERFORMANCES") {
    return RecapInterviewIntensityEnum.PG13;
  }

  const interviewIntensity = (
    record.requestJson as {
      interviewIntensity?: RecapInterviewIntensity | null;
    }
  ).interviewIntensity;
  switch (interviewIntensity) {
    case RecapInterviewIntensityEnum.CLEAN:
      return RecapInterviewIntensityEnum.CLEAN;
    case RecapInterviewIntensityEnum.FULL_HEAT:
      return RecapInterviewIntensityEnum.FULL_HEAT;
    case RecapInterviewIntensityEnum.NONE:
      return RecapInterviewIntensityEnum.NONE;
    case RecapInterviewIntensityEnum.PG13:
      return RecapInterviewIntensityEnum.PG13;
    case null:
    case undefined:
      return RecapInterviewIntensityEnum.PG13;
  }
}

function formatRecapInterviewIntensityLabel(
  intensity: RecapInterviewIntensity,
): string {
  switch (intensity) {
    case RecapInterviewIntensityEnum.CLEAN:
      return "Clean voice";
    case RecapInterviewIntensityEnum.FULL_HEAT:
      return "Full heat voice";
    case RecapInterviewIntensityEnum.NONE:
      return "No player interviews";
    case RecapInterviewIntensityEnum.PG13:
    default:
      return "PG-13 voice";
  }
}

function modeLabelForRecord(record: RecapHistoryRecord): string {
  if (record.kind === "LEAGUE_GAME_DAY_PERFORMANCES") {
    return "Performances";
  }

  return (
    recapModes.find((entry) => entry.value === record.kind)?.label ??
    record.kind
  );
}

function submitLabelForSelection(branch: RecapBranch, mode: RecapMode): string {
  if (branch === "PERFORMANCES") {
    return "Generate performances";
  }

  switch (mode) {
    case "LEAGUE_GAME_DAY":
      return "Generate game-day recap";
    case "SINGLE_GAME":
      return "Generate game summary";
    case "LEAGUE_DATE":
    default:
      return "Generate recap";
  }
}

function getWriteupSubmissionBlockReason(args: {
  gameDate: string;
  gameDayNumber: string;
  leagueId: string;
  leagueTimeZone: string;
  matchId: string;
  mode: RecapMode;
}): string | null {
  switch (args.mode) {
    case "LEAGUE_DATE":
      if (!args.leagueId.trim() || !args.gameDate) {
        return "League date recaps require both a league number and a game date.";
      }
      if (!normalizeLeagueTimeZone(args.leagueTimeZone)) {
        return "Date-based recaps require a valid league time zone.";
      }
      return null;
    case "LEAGUE_GAME_DAY": {
      const numericGameDay = Number(args.gameDayNumber);
      if (!args.leagueId.trim()) {
        return "League game-day recaps require a league number.";
      }
      if (
        !Number.isInteger(numericGameDay) ||
        numericGameDay < 1 ||
        numericGameDay > 22
      ) {
        return "League game day must be a whole number from 1 to 22.";
      }
      return null;
    }
    case "SINGLE_GAME":
      return /^\d+$/.test(args.matchId.trim())
        ? null
        : "Single-game summaries require a numeric game number.";
  }
}

function getPerformancesSubmissionBlockReason(args: {
  gameDayNumber: string;
  leagueId: string;
  season: string;
}): string | null {
  const numericGameDay = Number(args.gameDayNumber);
  if (!args.leagueId.trim()) {
    return "League performances require a league number.";
  }
  if (
    !Number.isInteger(numericGameDay) ||
    numericGameDay < 1 ||
    numericGameDay > 22
  ) {
    return "League game day must be a whole number from 1 to 22.";
  }
  if (
    args.season.trim() &&
    (!Number.isInteger(Number(args.season)) || Number(args.season) < 1)
  ) {
    return "Season must be a positive whole number when provided.";
  }

  return null;
}

function resolveSubmissionBlockReason(args: {
  branch: RecapBranch;
  canUseLeagueWriteups: boolean;
  context: Partial<RecapPanelContext> | null | undefined;
  gameDate: string;
  gameDayNumber: string;
  historyLoaded: boolean;
  isLoadingLeagueWriteupAccess: boolean;
  leagueId: string;
  leagueTimeZone: string;
  matchId: string;
  mode: RecapMode;
  season: string;
}): string | null {
  if (!args.historyLoaded || !hasUsableRecapContext(args.context)) {
    return "Recap tools are still loading. Try again in a moment.";
  }

  if (args.branch === "PERFORMANCES") {
    return getPerformancesSubmissionBlockReason(args);
  }

  if (args.isLoadingLeagueWriteupAccess) {
    return "Writeup access is still loading. Try again in a moment.";
  }

  if (!args.canUseLeagueWriteups) {
    return "AI writeups require Premium. Switch to Performances for the free league game-day report.";
  }

  return getWriteupSubmissionBlockReason(args);
}

function hasUsableRecapContext(
  context: Partial<RecapPanelContext> | null | undefined,
): boolean {
  return Boolean(
    context &&
      context.connection &&
      typeof context.connection === "object",
  );
}

function filterRecapHistoryForBranch(
  recaps: readonly RecapHistoryRecord[],
  branch: RecapBranch,
): RecapHistoryRecord[] {
  return recaps.filter((record) =>
    branch === "WRITEUPS"
      ? record.kind !== "LEAGUE_GAME_DAY_PERFORMANCES"
      : record.kind === "LEAGUE_GAME_DAY_PERFORMANCES",
  );
}

export function resolveWorkspaceLeagueTimeZone(
  context: Partial<RecapPanelContext> | null | undefined,
): string | null {
  return (
    normalizeLeagueTimeZone(context?.connection?.leagueTimeZone) ??
    inferLeagueTimeZone({
      countryId: context?.connection?.countryId ?? null,
      countryName: context?.connection?.countryName ?? null,
    })
  );
}

export function resolveRecapInputMaxDate(
  timeZone: string | null | undefined,
): string {
  return (
    resolveCalendarDateKey(new Date().toISOString(), timeZone) ??
    new Date().toISOString().slice(0, 10)
  );
}

export function resolveDefaultRecapDate(
  context: Partial<RecapPanelContext> | null | undefined,
): string {
  const timeZone = resolveWorkspaceLeagueTimeZone(context);
  const recentMatches = Array.isArray(context?.recentMatches)
    ? context.recentMatches
    : [];
  const recentMatchDate = recentMatches
    .map((match) => resolveCalendarDateKey(match.startTime, timeZone))
    .find((startTime): startTime is string => Boolean(startTime));

  return recentMatchDate ?? resolveRecapInputMaxDate(timeZone);
}

export function sortGameDayRecaps(
  recaps: readonly GameDayRecapRecord[],
): GameDayRecapRecord[] {
  return [...recaps].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function hasActiveGameDayRecap(
  recaps: readonly GameDayRecapRecord[],
  nowMs = Date.now(),
): boolean {
  return recaps.some(
    (recap) =>
      Boolean(recap.status) &&
      !terminalStatuses.has(recap.status) &&
      !isLocallyTimedOutRecap(recap, nowMs),
  );
}

export function hasActiveRecapHistory(
  recaps: readonly RecapHistoryRecord[],
  nowMs = Date.now(),
): boolean {
  return recaps.some(
    (recap) =>
      typeof recap.status === "string" &&
      !terminalStatuses.has(recap.status) &&
      !isLocallyTimedOutRecap(recap, nowMs),
  );
}

function formatRecapStatus(
  record: RecapHistoryRecord,
  nowMs = Date.now(),
): string {
  if (isLocallyTimedOutRecap(record, nowMs)) {
    return record.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
      ? "Report timed out"
      : "Writeup timed out";
  }

  if (record.kind === "LEAGUE_GAME_DAY_PERFORMANCES") {
    if (record.status === "SUCCEEDED") {
      return "Report ready";
    }
    if (record.status === "FAILED") {
      return "Report failed";
    }
    if (record.status) {
      return "Report in progress";
    }

    return "Report unavailable";
  }

  return formatWriteupStatus(record.status);
}

function getRecapStatusTone(
  record: RecapHistoryRecord,
  nowMs = Date.now(),
) {
  return isLocallyTimedOutRecap(record, nowMs)
    ? "danger"
    : statusToneFromValue(record.status);
}

function isLocallyTimedOutRecap(
  record: Pick<RecapHistoryRecord, "status" | "updatedAt">,
  nowMs = Date.now(),
): boolean {
  if (!record.status || terminalStatuses.has(record.status)) {
    return false;
  }

  const updatedAtMs = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return nowMs - updatedAtMs >= RECAP_STALE_TIMEOUT_MS;
}

function getRecapDisplayError(
  record: RecapHistoryRecord,
  nowMs = Date.now(),
): string | null {
  if (record.error) {
    return record.error;
  }

  if (!isLocallyTimedOutRecap(record, nowMs)) {
    return null;
  }

  return record.kind === "LEAGUE_GAME_DAY_PERFORMANCES"
    ? "This performances request timed out before the backend marked it complete. Refresh the list or submit a new request."
    : "This writeup request timed out before the backend marked it complete. Refresh the list or submit a new request.";
}

function toGameDayRecapCoverage(
  value: unknown,
): GameDayRecapCoveragePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as GameDayRecapCoveragePayload;
}

function toGameDayRecapResult(
  value: unknown,
): GameDayRecapResultPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as GameDayRecapResultPayload;
}

function toGameDayRecapCost(
  value: unknown,
): GameDayRecapCostPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as GameDayRecapCostPayload;
}

function toLeagueGameDayPerformancesResult(
  value: unknown,
): LeagueGameDayPerformancesResultPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as LeagueGameDayPerformancesResultPayload;
}

function readQueryError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "The request failed without a detailed error message.";
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

function formatUsdCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const absoluteValue = Math.abs(value);
  const fractionDigits =
    absoluteValue >= 1
      ? 2
      : absoluteValue >= 0.1
        ? 3
        : absoluteValue >= 0.01
          ? 4
          : absoluteValue >= 0.001
            ? 5
            : 6;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(value);
}

function formatRecapCostListSnippet(
  value: unknown,
): string | null {
  const cost = toGameDayRecapCost(value);
  if (!cost) {
    return null;
  }

  const prefix =
    cost.pricingStatus === "partial" ? "Partial est." : "Est.";
  if (typeof cost.estimatedPerGameCostUsd === "number") {
    return `${prefix} ${formatUsdCost(cost.estimatedPerGameCostUsd)}/game`;
  }
  if (typeof cost.estimatedTotalCostUsd === "number") {
    return `${prefix} ${formatUsdCost(cost.estimatedTotalCostUsd)}`;
  }

  return cost.totalTokens > 0
    ? `${cost.totalTokens.toLocaleString("en-US")} tokens`
    : null;
}

function formatRecapCostSummary(
  value: unknown,
): string | null {
  const cost = toGameDayRecapCost(value);
  if (!cost) {
    return null;
  }

  const details: string[] = [];
  if (typeof cost.estimatedTotalCostUsd === "number") {
    details.push(`${formatUsdCost(cost.estimatedTotalCostUsd)} total`);
  }
  if (typeof cost.estimatedPerGameCostUsd === "number") {
    details.push(`${formatUsdCost(cost.estimatedPerGameCostUsd)} per game summary`);
  }
  details.push(
    `${cost.requestCount.toLocaleString("en-US")} model ${cost.requestCount === 1 ? "request" : "requests"}`,
  );
  details.push(`${cost.totalTokens.toLocaleString("en-US")} tokens`);

  const prefix =
    cost.pricingStatus === "partial"
      ? "Partial estimated cost"
      : typeof cost.estimatedTotalCostUsd === "number"
        ? "Estimated cost"
        : "Model usage";

  return `${prefix}: ${details.join(" • ")}`;
}

function formatRecapCostPricingStatusLabel(
  pricingStatus: GameDayRecapCostPayload["pricingStatus"],
): string {
  switch (pricingStatus) {
    case "estimated":
      return "Estimated";
    case "partial":
      return "Partial estimate";
    default:
      return "Usage only";
  }
}

function formatRecapCostBreakdownLabel(
  value: unknown,
): string {
  const cost = toGameDayRecapCost(value);
  if (!cost) {
    return "Cost breakdown";
  }

  return `Cost breakdown • ${formatRecapCostPricingStatusLabel(cost.pricingStatus).toLowerCase()}`;
}

function formatRecapCostStageLabel(
  stage: GameDayRecapCostPayload["stages"][number]["stage"],
): string {
  switch (stage) {
    case "writer":
      return "Writer";
    case "retry_writer":
      return "Retry writer";
    case "judge":
      return "Judge";
    default:
      return stage;
  }
}

function formatRecapCostStageSummary(
  stage: GameDayRecapCostPayload["stages"][number],
): string {
  const details = [
    typeof stage.estimatedCostUsd === "number"
      ? `Est. ${formatUsdCost(stage.estimatedCostUsd)}`
      : "Cost unavailable",
    `${stage.requestCount.toLocaleString("en-US")} ${stage.requestCount === 1 ? "request" : "requests"}`,
    `${stage.totalTokens.toLocaleString("en-US")} tokens`,
  ];

  return `${formatRecapCostStageLabel(stage.stage)} • ${details.join(" • ")}`;
}

function formatRecapCostStageDetail(
  stage: GameDayRecapCostPayload["stages"][number],
): string {
  const cacheReadInputTokens = stage.cacheReadInputTokens ?? 0;
  const cacheWriteInputTokens = stage.cacheWriteInputTokens ?? 0;
  const details = [
    `Model: ${stage.modelId}`,
    `Input ${stage.inputTokens.toLocaleString("en-US")}`,
    `Output ${stage.outputTokens.toLocaleString("en-US")}`,
  ];

  if (cacheReadInputTokens > 0) {
    details.push(
      `Cache read ${cacheReadInputTokens.toLocaleString("en-US")}`,
    );
  }
  if (cacheWriteInputTokens > 0) {
    details.push(
      `Cache write ${cacheWriteInputTokens.toLocaleString("en-US")}`,
    );
  }

  return details.join(" • ");
}

function describeCoverage(coverage: GameDayRecapCoveragePayload): string {
  return coverage.partial
    ? `${coverage.availableGames} of ${coverage.requestedGames} final games were available.`
    : `${coverage.availableGames} games were covered.`;
}

function detailTitleForSelection(args: {
  branch: RecapBranch;
  performancesResult: LeagueGameDayPerformancesResultPayload | null;
  record: RecapHistoryRecord | null;
  writeupResult: GameDayRecapResultPayload | null;
}): string {
  if (args.writeupResult) {
    return args.writeupResult.summary.headline;
  }
  if (args.performancesResult) {
    return `${args.performancesResult.leagueName ?? args.record?.leagueName ?? "League"} game day ${args.performancesResult.gameDayNumber} performances`;
  }

  return args.branch === "WRITEUPS"
    ? "Selected writeup"
    : "Selected performances report";
}

function renderPerformancesLeaderboardList(
  leaderboards: ReadonlyArray<
    | LeagueGameDayPerformancesResultPayload["playerLeaders"][number]
    | LeagueGameDayPerformancesResultPayload["teamLeaders"][number]
    | LeagueGameDayPerformancesResultPayload["topFive"][number]
  >,
) {
  return (
    <ul className={listClassName}>
      {leaderboards.map((leaderboard) => (
        <li className={listItemClassName} key={leaderboard.key}>
          <strong className="text-ink text-sm">{leaderboard.label}</strong>
          <span className={statusCopyClassName}>
            {formatPerformancesLeaderboardLine(leaderboard)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderPerformanceSpotlight(
  result: LeagueGameDayPerformancesResultPayload,
) {
  return (
    <div className="grid gap-4">
      <div>
        <strong className="text-ink text-sm">MVP</strong>
        <p className={statusCopyClassName}>
          {formatPerformancesLeaderboardLine(result.mvp)}
        </p>
      </div>
      <div>
        <strong className="text-ink text-sm">Bad performance</strong>
        <p className={statusCopyClassName}>
          {formatPerformancesLeaderboardLine(result.badPerformance)}
        </p>
      </div>
      <div>
        <strong className="text-ink text-sm">Triple-doubles</strong>
        <p className={statusCopyClassName}>
          {result.tripleDoubles.length
            ? result.tripleDoubles
                .map((player) => formatPerformancePlayerWithStats(player))
                .join("; ")
            : "No triple-doubles were recorded."}
        </p>
      </div>
    </div>
  );
}

function formatPerformancesLeaderboardLine(
  leaderboard:
    | LeagueGameDayPerformancesResultPayload["playerLeaders"][number]
    | LeagueGameDayPerformancesResultPayload["teamLeaders"][number]
    | LeagueGameDayPerformancesResultPayload["topFive"][number],
): string {
  const formattedValue = formatPerformanceValue(
    leaderboard.value,
    "unit" in leaderboard ? leaderboard.unit ?? null : null,
  );
  const leaders = leaderboard.leaders.map((leader) =>
    "teamName" in leader && !("playerName" in leader)
      ? escapeForumText(leader.teamName)
      : formatPerformancePlayerWithStats(leader),
  );

  return `${formattedValue}: ${leaders.join(", ")}`;
}

function formatPerformanceGameResult(
  game: LeagueGameDayPerformancesResultPayload["games"][number],
): string {
  const away = `${escapeForumText(game.awayTeamName)} ${game.awayScore}`;
  const home = `${escapeForumText(game.homeTeamName)} ${game.homeScore}`;
  const awayWon = game.awayScore > game.homeScore;
  const homeWon = game.homeScore > game.awayScore;
  const matchTag = formatInlineForumMatchTag(game.matchId);

  return [
    awayWon ? `[b]${away}[/b]` : away,
    homeWon ? `[b]${home}[/b]` : home,
  ].join(" - ") + (matchTag ? ` ${matchTag}` : "");
}

function formatPerformancePlayerSummary(
  player: LeagueGameDayPerformancesResultPayload["tripleDoubles"][number],
): string {
  return `${escapeForumText(player.playerName)} (${escapeForumText(player.teamName)}) - ${player.position}`;
}

function formatPerformancePlayerWithStats(
  player: LeagueGameDayPerformancesResultPayload["tripleDoubles"][number],
): string {
  return `${formatPerformancePlayerSummary(player)} (${player.statLine.points} points, ${player.statLine.rebounds} rebounds, ${player.statLine.assists} assists, ${player.statLine.steals} steals, ${player.statLine.blocks} blocks) • Efficiency ${formatPerformanceValue(player.efficiency, null)}`;
}

function formatPerformanceValue(
  value: number,
  unit: string | null,
): string {
  const number = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);

  return unit ? `${number}${unit}` : number;
}

function formatRecapForumPost(
  record: RecapHistoryRecord,
  result: GameDayRecapResultPayload,
): string {
  const gameOfTheDay = findGameOfTheDay(result);
  const lines = [
    `[b]${escapeForumText(result.summary.headline)}[/b]`,
    `[i]${escapeForumText(describeRecapForumRecord(record))}[/i]`,
    "",
    `[quote]${escapeForumText(result.summary.lede)}[/quote]`,
  ];

  if (gameOfTheDay && gameOfTheDay.surpriseFactor != null) {
    lines.push(
      `[i]Game of the day: ${escapeForumText(gameOfTheDay.headline)} • Surprise factor: ${formatSurpriseFactor(
        gameOfTheDay.surpriseFactor,
      )}[/i]`,
    );
  }

  for (const game of result.games) {
    lines.push("");
    lines.push(`[b]${escapeForumText(game.headline)}[/b]`);
    if (game.surpriseFactor != null || game.matchId === gameOfTheDay?.matchId) {
      const metadata: string[] = [];
      if (game.surpriseFactor != null) {
        metadata.push(
          `Surprise factor: ${formatSurpriseFactor(game.surpriseFactor)}`,
        );
      }
      if (game.matchId === gameOfTheDay?.matchId) {
        metadata.push("Game of the day");
      }
      lines.push(`[i]${escapeForumText(metadata.join(" • "))}[/i]`);
    }
	    lines.push(formatForumWriteup(game.writeup));
	    const postgameInterviews =
	      (
	        game.postgameInterviews?.length
	          ? game.postgameInterviews
	          : game.postgameInterview
	            ? [game.postgameInterview]
	            : []
	      ).filter(isPresent);
	    for (const interview of postgameInterviews) {
      lines.push("");
      lines.push(`[i]${escapeForumText(interview.title)}[/i]`);
      lines.push(
        `[i]${escapeForumText(interview.playerName)} • ${escapeForumText(interview.teamName)}[/i]`,
      );
      for (const exchange of interview.qa) {
        lines.push(`[b]Q:[/b] ${escapeForumText(exchange.question)}`);
        lines.push(`[b]A:[/b] ${escapeForumText(exchange.answer)}`);
      }
    }

    const matchLink = formatForumMatchLink(game.matchId);
    if (matchLink) {
      lines.push(matchLink);
    }
  }

  return lines.join("\n").trim();
}

function formatForumWriteup(writeup: string): string {
  return splitRecapWriteupParagraphs(writeup)
    .map((paragraph) => escapeForumText(paragraph))
    .join("\n\n");
}

function getRecapGameValidation(
  game: GameDayRecapResultPayload["games"][number],
): NonNullable<GameDayRecapResultPayload["games"][number]["validation"]> {
  return (
    game.validation ?? {
      issueCount: 0,
      issues: [],
      status: "VALID",
    }
  );
}

function formatRecapValidationStatus(status: string): string {
  if (status === "UNSAFE") {
    return "Likely factual issue";
  }
  if (status === "SUSPECT") {
    return "Needs fact review";
  }

  return "Validated";
}

function formatRecapValidationIssue(
  issue: NonNullable<
    GameDayRecapResultPayload["games"][number]["validation"]
  >["issues"][number],
): string {
  const field = humanizeRecapValidationToken(issue.field);
  const source =
    issue.source === "judge" ? "model judge" : "deterministic check";
  return `${field}: ${issue.reason} (${source}; "${issue.sentence}")`;
}

function partitionRecapValidationIssues(
  issues: NonNullable<
    GameDayRecapResultPayload["games"][number]["validation"]
  >["issues"],
): {
  deterministic: typeof issues;
  judge: typeof issues;
} {
  return {
    deterministic: issues.filter((issue) => issue.source !== "judge"),
    judge: issues.filter((issue) => issue.source === "judge"),
  };
}

function buildRecapValidationAlertSummary(args: {
  hasDeterministicWarnings: boolean;
  hasJudgeWarnings: boolean;
  modelJudgeEnabled: boolean;
}): string {
  if (args.hasDeterministicWarnings && args.hasJudgeWarnings) {
    return "Deterministic fact checks and the extra model fact review both flagged issues in this recap.";
  }
  if (args.hasJudgeWarnings) {
    return "The extra model fact review flagged issues in this recap.";
  }
  if (args.modelJudgeEnabled) {
    return "Deterministic fact checks flagged issues in this recap. The extra model fact review ran too, but it did not add separate warnings here.";
  }

  return "Deterministic fact checks flagged issues in this recap. The extra model fact review was turned off for this request.";
}

function didRecapRequestRunModelJudge(record: RecapHistoryRecord): boolean {
  if (record.kind === "LEAGUE_GAME_DAY_PERFORMANCES") {
    return false;
  }

  return (
    (
      record.requestJson as {
        modelJudgeEnabled?: boolean | null;
      }
    ).modelJudgeEnabled === true
  );
}

function humanizeRecapValidationToken(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function RecapFailureDiagnostics({
  failure,
}: {
  failure: GameDayRecapFailurePayload;
}) {
  return (
    <div className="grid gap-3">
      <Alert tone="danger">
        <strong className="text-ink">Writeup could not be saved safely.</strong>
        <p className="mt-1">{failure.message}</p>
        <p className="mt-1">
          Validation found {failure.issueCount} issue
          {failure.issueCount === 1 ? "" : "s"} across{" "}
          {failure.failedGameCount} game
          {failure.failedGameCount === 1 ? "" : "s"} before a structured
          result was saved.
        </p>
      </Alert>
      {failure.games.length ? (
        <div className="grid gap-3">
          {failure.games.map((game, index) => (
            <Panel key={`${game.matchId ?? "game"}:${index}`} padding="sm" variant="glass">
              <strong className="text-ink text-sm">
                {formatFailureGameLabel(game)}
              </strong>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm leading-6 text-ink-muted">
                {game.issues.map((issue, issueIndex) => (
                  <li key={`${issue.source}:${issue.field}:${issue.sentenceIndex}:${issueIndex}`}>
                    {formatRecapValidationIssue(issue)}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatFailureGameLabel(
  game: GameDayRecapFailurePayload["games"][number],
): string {
  if (game.homeTeamName && game.awayTeamName) {
    return `${game.awayTeamName} at ${game.homeTeamName}`;
  }
  return game.matchId ? `Match ${game.matchId}` : "Generated game";
}

function splitRecapWriteupParagraphs(writeup: string): string[] {
  const paragraphs = writeup
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) {
    return paragraphs;
  }

  const sentences = splitRecapDisplaySentences(writeup);
  if (sentences.length < 5) {
    return paragraphs.length ? paragraphs : [writeup.trim()].filter(Boolean);
  }

  const gameFlowIndex = findRecapDisplayGameFlowIndex(sentences);
  const closingIndex = findRecapDisplayClosingIndex(sentences, gameFlowIndex);
  if (gameFlowIndex <= 0 || closingIndex <= gameFlowIndex) {
    return groupRecapDisplaySentencesEvenly(sentences);
  }

  return [
    sentences.slice(0, gameFlowIndex).join(" "),
    sentences.slice(gameFlowIndex, closingIndex).join(" "),
    sentences.slice(closingIndex).join(" "),
  ].filter(Boolean);
}

function splitRecapDisplaySentences(writeup: string): string[] {
  return writeup
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function findRecapDisplayGameFlowIndex(sentences: string[]): number {
  const index = sentences.findIndex((sentence, sentenceIndex) => {
    if (sentenceIndex === 0) {
      return false;
    }
    return /\b(?:after|at halftime|by halftime|through three|quarter|period|run|lead|trailed|tied|entered|final frame|final period)\b/i.test(
      sentence,
    );
  });

  return index > 0 ? index : Math.min(2, sentences.length - 3);
}

function findRecapDisplayClosingIndex(
  sentences: string[],
  gameFlowIndex: number,
): number {
  const index = sentences.findIndex((sentence, sentenceIndex) => {
    if (sentenceIndex <= gameFlowIndex) {
      return false;
    }
    return /\b(?:led .* with \d+|added \d+|finished with|scored \d+|grabbed \d+|team talent|rating|perimeter defense|inside defense|rebounding|won by|victory)\b/i.test(
      sentence,
    );
  });

  return index > gameFlowIndex
    ? index
    : Math.max(gameFlowIndex + 1, sentences.length - 2);
}

function groupRecapDisplaySentencesEvenly(sentences: string[]): string[] {
  const setupEnd = Math.min(2, Math.max(1, sentences.length - 3));
  const closingStart = Math.max(setupEnd + 1, sentences.length - 2);
  return [
    sentences.slice(0, setupEnd).join(" "),
    sentences.slice(setupEnd, closingStart).join(" "),
    sentences.slice(closingStart).join(" "),
  ].filter(Boolean);
}

function formatLeagueGameDayPerformancesForumPost(
  record: LeagueGameDayPerformancesHistoryRecord,
  result: LeagueGameDayPerformancesResultPayload,
): string {
  const titleDate = result.gameDate ?? record.gameDate ?? "unknown date";
  const lines = [
    `[u][b]Game day ${result.gameDayNumber} (${escapeForumText(titleDate)}) performances[/b][/u]`,
    "",
    "[b]Night results[/b]",
    ...result.games.map((game) => formatPerformanceGameResult(game)),
    "",
    "[b]Best team performances of the evening[/b]",
    ...result.teamLeaders.map(
      (leaderboard) =>
        `[u]${escapeForumText(leaderboard.label)}[/u] : ${formatPerformanceValue(
          leaderboard.value,
          leaderboard.unit ?? null,
        )} : ${leaderboard.leaders
          .map((leader) => escapeForumText(leader.teamName))
          .join(", ")}`,
    ),
    "",
    "[b]Best player performances of the evening[/b]",
    ...result.playerLeaders.map(
      (leaderboard) =>
        `[u]${escapeForumText(leaderboard.label)}[/u] : ${formatPerformanceValue(
          leaderboard.value,
          leaderboard.unit ?? null,
        )} : ${leaderboard.leaders
          .map((leader) => formatPerformancePlayerSummary(leader))
          .join(", ")}`,
    ),
    "",
    "[b]Top five of the evening[/b]",
    ...result.topFive.map(
      (leaderboard) =>
        `[u]${escapeForumText(leaderboard.label)}[/u] : ${leaderboard.leaders
          .map((leader) => formatPerformancePlayerWithStats(leader))
          .join(", ")} : Efficiency ${formatPerformanceValue(
          leaderboard.value,
          null,
        )}`,
    ),
    "",
    "[b]MVP of the evening[/b]",
    formatPerformancesLeaderboardLine(result.mvp),
    "",
    "[b]Bad performance of the evening[/b]",
    formatPerformancesLeaderboardLine(result.badPerformance),
    "",
    "[b]Triple-doubles of the evening[/b]",
    result.tripleDoubles.length
      ? result.tripleDoubles
          .map((leader) => formatPerformancePlayerWithStats(leader))
          .join("\n")
      : "No triple-doubles were recorded.",
    "",
    "[b]All kinds of statistics[/b]",
    ...result.statCallouts.map(
      (leaderboard) =>
        `[u]${escapeForumText(leaderboard.label)}[/u] : ${leaderboard.leaders
          .map((leader) => formatPerformancePlayerSummary(leader))
          .join(", ")} : ${formatPerformanceValue(
          leaderboard.value,
          leaderboard.unit ?? null,
        )}`,
    ),
  ];

  return lines.join("\n").trim();
}

function findGameOfTheDay(
  result: GameDayRecapResultPayload,
): GameDayRecapResultPayload["games"][number] | null {
  if (result.games.length < 2) {
    return null;
  }

  const explicitMatchId = result.summary.gameOfTheDayMatchId;
  if (explicitMatchId) {
    const explicitGame = result.games.find(
      (game) => game.matchId === explicitMatchId,
    );
    if (explicitGame) {
      return explicitGame;
    }
  }

  let bestGame: GameDayRecapResultPayload["games"][number] | null = null;
  for (const game of result.games) {
    if (game.surpriseFactor == null) {
      continue;
    }
    if (
      !bestGame ||
      game.surpriseFactor > (bestGame.surpriseFactor ?? -Infinity)
    ) {
      bestGame = game;
    }
  }

  return bestGame;
}

function formatSurpriseFactor(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value)}/10`;
}

function escapeForumText(value: string): string {
  return value.trim().replace(/\[/g, "(").replace(/\]/g, ")");
}

function formatForumMatchLink(
  matchId: string | null | undefined,
): string | null {
  const normalizedMatchId = matchId?.trim();
  if (!normalizedMatchId) {
    return null;
  }

  return /^\d+$/.test(normalizedMatchId)
    ? `Match: [match=${normalizedMatchId}]`
    : `Match: ${escapeForumText(normalizedMatchId)}`;
}

function formatInlineForumMatchTag(
  matchId: string | null | undefined,
): string | null {
  const normalizedMatchId = matchId?.trim();
  if (!normalizedMatchId || !/^\d+$/.test(normalizedMatchId)) {
    return null;
  }

  return `[match=${normalizedMatchId}]`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  const clipboard =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { clipboard?: Clipboard }).clipboard;

  if (typeof clipboard?.writeText === "function") {
    await clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable.");
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.append(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy was rejected.");
    }
  } finally {
    textArea.remove();
  }
}

function formatEvidenceTag(tag: string): string {
  return tag
    .replace(/_/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function RecapInterviewDebugBadges(args: {
  context: Partial<RecapPanelContext>;
  interview: NonNullable<
    NonNullable<GameDayRecapResultPayload["games"][number]["postgameInterview"]>
  >;
}) {
  const personality = resolveRecapInterviewPersonalityDebugState(args);
  if (!personality) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone="neutral">{personality.typeLabel}</StatusBadge>
      <StatusBadge tone="note">{personality.sourceLabel}</StatusBadge>
    </div>
  );
}

function resolveRecapInterviewPersonalityDebugState(args: {
  context: Partial<RecapPanelContext>;
  interview: Pick<
    NonNullable<
      NonNullable<GameDayRecapResultPayload["games"][number]["postgameInterview"]>
    >,
    "personalitySource" | "personalityType" | "playerName" | "teamName"
  >;
}): {
  sourceLabel: string;
  typeLabel: string;
} | null {
  const appliedPersonalityType = isInterviewPersonalityType(
    args.interview.personalityType,
  )
    ? args.interview.personalityType
    : null;
  if (appliedPersonalityType) {
    const appliedPersonalitySource = isInterviewPersonalitySource(
      args.interview.personalitySource,
    )
      ? args.interview.personalitySource
      : "auto";
    return {
      sourceLabel: INTERVIEW_PERSONALITY_SOURCE_LABELS[appliedPersonalitySource],
      typeLabel: resolveInterviewPersonalityLabel(appliedPersonalityType),
    };
  }

  const matchedPlayer = args.context.playerLabPlayers?.find(
    (player) =>
      player.fullName.trim().toLowerCase() ===
      args.interview.playerName.trim().toLowerCase(),
  );
  const matchedType = matchedPlayer?.interviewPersonalityType;
  const matchedSource = matchedPlayer?.interviewPersonalitySource;
  const personalityType = isInterviewPersonalityType(matchedType)
    ? matchedType
    : resolveDeterministicInterviewPersonality(
        buildInterviewPersonalitySeed({
          playerName: args.interview.playerName,
          teamName: args.interview.teamName,
        }),
      );
  const personalitySource = isInterviewPersonalitySource(matchedSource)
    ? matchedSource
    : "auto";

  return {
    sourceLabel: INTERVIEW_PERSONALITY_SOURCE_LABELS[personalitySource],
    typeLabel: resolveInterviewPersonalityLabel(personalityType),
  };
}

export const __testing = {
  DEFAULT_MODEL_JUDGE_ENABLED,
  PERFORMANCE_CAPABILITY_SUMMARY,
  RECAP_CAPABILITY_SUMMARY,
  buildRecapValidationAlertSummary,
  describeRecapRecord,
  didRecapRequestRunModelJudge,
  filterRecapHistoryForBranch,
  formatRecapCostBreakdownLabel,
  formatLeagueGameDayPerformancesForumPost,
  formatRecapCostListSnippet,
  formatRecapCostPricingStatusLabel,
  formatRecapCostStageDetail,
  formatRecapCostStageSummary,
  formatRecapCostSummary,
  formatRecapForumPost,
  formatRecapStatus,
  getRecapDisplayError,
  hasActiveGameDayRecap,
  hasActiveRecapHistory,
  isLocallyTimedOutRecap,
  partitionRecapValidationIssues,
  recapApproachOptions,
  RECAP_STALE_TIMEOUT_MS,
  resolveSubmissionBlockReason,
  recapInterviewIntensityOptions,
  recapTitle,
  resolveRecapInterviewPersonalityDebugState,
  splitRecapWriteupParagraphs,
  submitRecapRequest,
};
