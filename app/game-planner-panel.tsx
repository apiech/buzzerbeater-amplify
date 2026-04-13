"use client";

import { useEffect, useMemo, useState } from "react";

import { formatRecommendationSwitchSummary } from "@/app/next-game-recommendation-state";
import type {
  NextGamePlannerDetailPayload,
  NextGameRecommendationInput,
  NextGameRecommendationSnapshot,
  OpponentForecastSnapshot,
  RecommendedGamePlan,
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

type GamePlannerPanelProps = {
  blockedReason: string | null;
  detail: NextGamePlannerDetailPayload | null;
  detailError: string | null;
  detailLoading: boolean;
  forecast: OpponentForecastSnapshot | null;
  input: NextGameRecommendationInput;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  recommendation: NextGameRecommendationSnapshot | null;
};

type PlanCardDefinition = {
  accentClassName: string;
  key: string;
  label: string;
  plan: RecommendedGamePlan | null;
};

type PlannerScenario = NonNullable<
  NonNullable<NextGameRecommendationSnapshot["result"]>["evaluatedScenarios"]
>[number];

export function GamePlannerPanel({
  blockedReason,
  detail,
  detailError,
  detailLoading,
  forecast,
  input,
  isLoading,
  isRefreshing,
  onRefresh,
  recommendation,
}: GamePlannerPanelProps) {
  const result = recommendation?.result ?? null;
  const [selectedViewId, setSelectedViewId] = useState("expected");
  const [selectedOurPairId, setSelectedOurPairId] = useState<string | null>(null);
  const [selectedOpponentPairId, setSelectedOpponentPairId] = useState<string | null>(
    null,
  );

  const planCards = useMemo<PlanCardDefinition[]>(
    () => [
      {
        accentClassName: "border-l-4 border-l-accent",
        key: "bestExpected",
        label: "Best expected",
        plan: result?.bestExpectedPlan ?? result?.biggestWinPlan ?? null,
      },
      {
        accentClassName: "border-l-4 border-l-ink",
        key: "safest",
        label: "Safest",
        plan: result?.safestPlan ?? null,
      },
      {
        accentClassName: "border-l-4 border-l-note",
        key: "efficient",
        label: "Efficient",
        plan: result?.efficientPlan ?? result?.efficientWinPlan ?? null,
      },
    ],
    [result],
  );
  const activeRecommendationPlan =
    planCards.find((card) => card.plan?.pairId)?.plan ?? null;
  const sortedOurPairs = useMemo(
    () => sortPlannerPairs(detail?.ourPairs ?? []),
    [detail?.ourPairs],
  );
  const sortedOpponentPairs = useMemo(
    () => sortPlannerPairs(detail?.opponentPairs ?? []),
    [detail?.opponentPairs],
  );
  const activeView =
    detail?.views.find((view) => view.viewId === selectedViewId) ??
    detail?.views[0] ??
    null;
  const viewTabs = detail?.views ?? [];
  const forecastScenarios = (forecast?.result?.topScenarios ?? []).slice(0, 3);
  const highlightedPairIds = new Set(
    planCards.map((card) => card.plan?.pairId).filter((value): value is string => Boolean(value)),
  );
  const highlightedOpponentPairIds = useMemo(
    () =>
      resolveHighlightedOpponentPairIds({
        opponentPairs: detail?.opponentPairs ?? [],
        scenarios: result?.evaluatedScenarios ?? [],
        viewId: activeView?.viewId ?? null,
      }),
    [activeView?.viewId, detail?.opponentPairs, result?.evaluatedScenarios],
  );

  useEffect(() => {
    if (!detail?.views.length) {
      return;
    }

    setSelectedViewId((current) =>
      detail.views.some((view) => view.viewId === current)
        ? current
        : detail.views[0]?.viewId ?? "expected",
    );
  }, [detail?.views]);

  useEffect(() => {
    const fallbackOurPairId =
      activeRecommendationPlan?.pairId ?? sortedOurPairs[0]?.pairId ?? null;
    setSelectedOurPairId((current) =>
      current && sortedOurPairs.some((pair) => pair.pairId === current)
        ? current
        : fallbackOurPairId,
    );
  }, [activeRecommendationPlan?.pairId, sortedOurPairs]);

  useEffect(() => {
    const highlightedOpponentPairId =
      Array.from(highlightedOpponentPairIds)[0] ??
      sortedOpponentPairs[0]?.pairId ??
      null;
    setSelectedOpponentPairId((current) =>
      current && sortedOpponentPairs.some((pair) => pair.pairId === current)
        ? current
        : highlightedOpponentPairId,
    );
  }, [highlightedOpponentPairIds, sortedOpponentPairs]);

  const selectedCell = useMemo(() => {
    if (!activeView || !selectedOpponentPairId || !selectedOurPairId) {
      return null;
    }

    const row = activeView.rows.find(
      (candidate) => candidate.opponentPairId === selectedOpponentPairId,
    );
    return (
      row?.cells.find((candidate) => candidate.ourPairId === selectedOurPairId) ?? null
    );
  }, [activeView, selectedOpponentPairId, selectedOurPairId]);

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            disabled={Boolean(blockedReason)}
            loading={isRefreshing || (isLoading && recommendation?.status !== "SUCCEEDED")}
            onClick={onRefresh}
            size="sm"
            variant="secondary"
          >
            {recommendation ? "Refresh planner" : "Generate planner"}
          </Button>
        }
        eyebrow="Predictions"
        title="Game planner"
      />

      <p className="text-sm leading-7 text-ink-muted">
        Compare every tactic pair against the next opponent&apos;s likely looks,
        then drop into the manual simulator only when you want a custom what-if.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={statusToneFromValue(recommendation?.status ?? "QUEUED")}>
          {recommendation?.status ?? "NOT_READY"}
        </StatusBadge>
        <span className="text-xs font-semibold text-ink-muted">
          Enthusiasm {input.enthusiasm}
        </span>
        <span className="text-xs font-semibold text-ink-muted">
          Switch {formatRecommendationSwitchSummary(input.defensiveSwitch)}
        </span>
        {recommendation?.completedAt ? (
          <span className="text-xs font-semibold text-ink-muted">
            Updated {formatTimestamp(recommendation.completedAt)}
          </span>
        ) : null}
      </div>

      {result?.stale ? (
        <Alert>
          The stored planner used an older opponent forecast. Refresh it to
          recompute the current opponent outlook and tactic matrix.
        </Alert>
      ) : null}
      {recommendation?.error ? <Alert>{recommendation.error}</Alert> : null}
      {detailError ? <Alert>{detailError}</Alert> : null}

      {blockedReason ? (
        <Alert>{blockedReason}</Alert>
      ) : result ? (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Opponent outlook" titleAs="h4" />
              {forecastScenarios.length ? (
                <div className="grid gap-3">
                  {forecastScenarios.map((scenario) => (
                    <div
                      className="rounded-card grid gap-3 border border-black/8 bg-white/70 p-4"
                      key={scenario.scenarioId}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="grid gap-1">
                          <strong className="text-ink text-sm">
                            {scenario.label}
                          </strong>
                          <span className="text-sm text-ink-muted">
                            Off {scenario.offense} • Def {scenario.defense} •
                            Effort {scenario.effortChoice}
                          </span>
                        </div>
                        <StatusBadge tone="note">
                          {formatPercent(scenario.probability)}
                        </StatusBadge>
                      </div>
                      {scenario.starters.length ? (
                        <p className="text-sm text-ink-muted">
                          Starters{" "}
                          {scenario.starters
                            .map((player) => player.fullName)
                            .join(", ")}
                        </p>
                      ) : null}
                      {scenario.evidence.length ? (
                        <p className="text-sm text-ink-muted">
                          {scenario.evidence.join(" • ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-7 text-ink-muted">
                  No forecast scenarios are available yet.
                </p>
              )}
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Recommended plans" titleAs="h4" />
              <div className="grid gap-3">
                {planCards.map((card) =>
                  card.plan ? (
                    <button
                      className={cn(
                        "rounded-card grid gap-3 border border-black/8 bg-white/70 p-4 text-left transition hover:-translate-y-px",
                        card.accentClassName,
                      )}
                      key={card.key}
                      onClick={() => setSelectedOurPairId(card.plan?.pairId ?? null)}
                      type="button"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="grid gap-1">
                          <strong className="text-ink text-sm">{card.label}</strong>
                          <span className="text-sm text-ink-muted">
                            {card.plan.offense} / {card.plan.defense}
                          </span>
                        </div>
                        <StatusBadge
                          tone={
                            card.plan.predictedPointDiff > 0 ? "success" : "neutral"
                          }
                        >
                          {formatSigned(card.plan.predictedPointDiff)}
                        </StatusBadge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <StatCard
                          detail={formatScoreline(card.plan)}
                          label="Expected margin"
                          value={formatSigned(card.plan.weightedExpectedPointDiff)}
                        />
                        <StatCard
                          detail={`Floor ${formatSigned(card.plan.floorPointDiff)} • Ceiling ${formatSigned(card.plan.ceilingPointDiff)}`}
                          label="Effort"
                          value={card.plan.effortChoice}
                        />
                      </div>
                    </button>
                  ) : null,
                )}
              </div>
            </Panel>
          </div>

          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading title="Full tactic-pair explorer" titleAs="h4" />

            <div className="mt-3 flex flex-wrap gap-2">
              {viewTabs.map((view) => (
                <Button
                  key={view.viewId}
                  onClick={() => setSelectedViewId(view.viewId)}
                  size="sm"
                  variant={view.viewId === activeView?.viewId ? "secondary" : "ghost"}
                >
                  {view.label}
                  {typeof view.probability === "number"
                    ? ` • ${formatPercent(view.probability)}`
                    : ""}
                </Button>
              ))}
            </div>

            {detailLoading && !detail ? (
              <p className="mt-4 text-sm leading-7 text-ink-muted">
                Loading the full tactic-pair matrix.
              </p>
            ) : activeView && sortedOurPairs.length && sortedOpponentPairs.length ? (
              <>
                <div className="mt-4 hidden md:block">
                  <div className="max-h-[70vh] overflow-auto rounded-card border border-black/8">
                    <table className="w-max min-w-full border-collapse text-left">
                      <thead className="bg-surface">
                        <tr>
                          <th
                            className="sticky top-0 left-0 z-30 min-w-[14rem] border-b border-black/8 bg-surface px-3 py-3 text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted"
                            rowSpan={2}
                          >
                            Opponent pair
                          </th>
                          {groupPairsByDefense(sortedOurPairs).map((group) => (
                            <th
                              className="sticky top-0 z-20 border-b border-black/8 bg-surface px-3 py-3 text-center text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted"
                              colSpan={group.pairs.length}
                              key={group.defense}
                            >
                              {group.defense}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          {sortedOurPairs.map((pair) => (
                            <th
                              className={cn(
                                "sticky top-[2.65rem] z-20 min-w-[8.5rem] border-b border-black/8 bg-surface px-3 py-3 text-center text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink-muted",
                                highlightedPairIds.has(pair.pairId) && "bg-note-bg",
                              )}
                              key={pair.pairId}
                            >
                              <div className="grid gap-1">
                                <span className="text-ink">{pair.offense}</span>
                                {pair.estimated ? (
                                  <span className="text-[0.65rem] text-note">
                                    Estimated
                                  </span>
                                ) : null}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedOpponentPairs.map((opponentPair) => {
                          const row = activeView.rows.find(
                            (candidate) =>
                              candidate.opponentPairId === opponentPair.pairId,
                          );
                          const cellsByOurPairId = new Map(
                            (row?.cells ?? []).map((cell) => [cell.ourPairId, cell]),
                          );

                          return (
                            <tr key={opponentPair.pairId}>
                              <td
                                className={cn(
                                  "sticky left-0 z-10 border-b border-black/8 bg-white px-3 py-3 align-top text-sm text-ink",
                                  highlightedOpponentPairIds.has(opponentPair.pairId) &&
                                    "bg-accent/10",
                                )}
                              >
                                <div className="grid gap-1">
                                  <strong className="text-sm">
                                    {opponentPair.defense}
                                  </strong>
                                  <span className="text-sm text-ink-muted">
                                    {opponentPair.offense}
                                  </span>
                                  {opponentPair.estimated ? (
                                    <span className="text-xs font-semibold text-note">
                                      Estimated
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              {sortedOurPairs.map((ourPair) => {
                                const cell = cellsByOurPairId.get(ourPair.pairId) ?? null;
                                const isSelected =
                                  selectedOpponentPairId === opponentPair.pairId &&
                                  selectedOurPairId === ourPair.pairId;

                                return (
                                  <td
                                    className={cn(
                                      "border-b border-black/8 px-3 py-3 text-center align-top",
                                      highlightedPairIds.has(ourPair.pairId) &&
                                        "bg-note-bg/40",
                                      isSelected && "bg-accent/10",
                                    )}
                                    key={`${opponentPair.pairId}-${ourPair.pairId}`}
                                  >
                                    <button
                                      className="grid w-full gap-1 text-left"
                                      onClick={() => {
                                        setSelectedOpponentPairId(opponentPair.pairId);
                                        setSelectedOurPairId(ourPair.pairId);
                                      }}
                                      type="button"
                                    >
                                      <strong className="text-sm text-ink">
                                        {formatCellMargin(cell)}
                                      </strong>
                                      <span className="text-xs text-ink-muted">
                                        {formatCellScoreline(cell)}
                                      </span>
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

                <div className="mt-4 grid gap-4 md:hidden">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Our pair">
                      <Select
                        onChange={(event) => setSelectedOurPairId(event.currentTarget.value)}
                        value={selectedOurPairId ?? ""}
                      >
                        {sortedOurPairs.map((pair) => (
                          <option key={pair.pairId} value={pair.pairId}>
                            {pair.defense} / {pair.offense}
                            {pair.estimated ? " (Estimated)" : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Opponent pair">
                      <Select
                        onChange={(event) =>
                          setSelectedOpponentPairId(event.currentTarget.value)
                        }
                        value={selectedOpponentPairId ?? ""}
                      >
                        {sortedOpponentPairs.map((pair) => (
                          <option key={pair.pairId} value={pair.pairId}>
                            {pair.defense} / {pair.offense}
                            {pair.estimated ? " (Estimated)" : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Panel as="article" padding="sm" variant="solid">
                    <SectionHeading title="Selected matchup" titleAs="h4" />
                    <div className="grid gap-3">
                      <StatCard
                        detail={formatCellScoreline(selectedCell)}
                        label="Predicted margin"
                        value={formatCellMargin(selectedCell)}
                      />
                      <p className="text-sm leading-7 text-ink-muted">
                        {describeSelectedMatchup({
                          opponentPairId: selectedOpponentPairId,
                          opponentPairs: sortedOpponentPairs,
                          ourPairId: selectedOurPairId,
                          ourPairs: sortedOurPairs,
                        })}
                      </p>
                    </div>
                  </Panel>

                  <Panel as="article" padding="sm" variant="solid">
                    <SectionHeading title="Plan coverage" titleAs="h4" />
                    <ul className="grid list-none gap-3 p-0">
                      {planCards.map((card) =>
                        card.plan ? (
                          <li
                            className="grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0"
                            key={card.key}
                          >
                            <strong className="text-sm text-ink">{card.label}</strong>
                            <span className="text-sm text-ink-muted">
                              {card.plan.offense} / {card.plan.defense} •{" "}
                              {card.plan.effortChoice}
                            </span>
                            <span className="text-sm text-ink-muted">
                              Win {formatPercent(card.plan.winProbability)} • Floor{" "}
                              {formatSigned(card.plan.floorPointDiff)}
                            </span>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </Panel>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm leading-7 text-ink-muted">
                The tactic-pair explorer will appear after the planner finishes
                generating.
              </p>
            )}
          </Panel>
        </div>
      ) : (
        <p className="mt-4 text-sm leading-7 text-ink-muted">
          {isLoading
            ? "Loading the latest stored planner."
            : "No stored planner is available yet."}
        </p>
      )}
    </Panel>
  );
}

function sortPlannerPairs<
  TPair extends { defense: string; offense: string; pairId: string },
>(pairs: readonly TPair[]): TPair[] {
  return [...pairs].sort(
    (left, right) =>
      left.defense.localeCompare(right.defense) ||
      left.offense.localeCompare(right.offense) ||
      left.pairId.localeCompare(right.pairId),
  );
}

function groupPairsByDefense<
  TPair extends { defense: string; offense: string; pairId: string },
>(pairs: readonly TPair[]) {
  const groups: Array<{ defense: string; pairs: TPair[] }> = [];
  for (const pair of pairs) {
    const current = groups[groups.length - 1];
    if (!current || current.defense !== pair.defense) {
      groups.push({ defense: pair.defense, pairs: [pair] });
      continue;
    }
    current.pairs.push(pair);
  }
  return groups;
}

function resolveHighlightedOpponentPairIds(args: {
  opponentPairs: NextGamePlannerDetailPayload["opponentPairs"];
  scenarios: PlannerScenario[];
  viewId: string | null;
}): Set<string> {
  if (!args.opponentPairs.length || !args.scenarios.length) {
    return new Set();
  }

  if (args.viewId && args.viewId !== "expected" && args.viewId.startsWith("scenario:")) {
    const scenarioId = args.viewId.slice("scenario:".length);
    const scenario = args.scenarios.find((entry) => entry.scenarioId === scenarioId);
    const pairId = scenario ? resolvePairId(args.opponentPairs, scenario) : null;
    return pairId ? new Set([pairId]) : new Set();
  }

  return new Set(
    args.scenarios
      .map((scenario) => resolvePairId(args.opponentPairs, scenario))
      .filter((value): value is string => Boolean(value)),
  );
}

function resolvePairId(
  pairs: NextGamePlannerDetailPayload["opponentPairs"],
  scenario: PlannerScenario,
): string | null {
  return (
    pairs.find(
      (pair) => pair.offense === scenario.offense && pair.defense === scenario.defense,
    )?.pairId ?? null
  );
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatScoreline(plan: RecommendedGamePlan): string {
  return `${plan.predictedTeamScore.toFixed(1)}-${plan.predictedOpponentScore.toFixed(1)}`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatCellMargin(
  cell:
    | NextGamePlannerDetailPayload["views"][number]["rows"][number]["cells"][number]
    | null,
): string {
  if (!cell?.available || typeof cell.predictedPointDiff !== "number") {
    return "N/A";
  }
  return formatSigned(cell.predictedPointDiff);
}

function formatCellScoreline(
  cell:
    | NextGamePlannerDetailPayload["views"][number]["rows"][number]["cells"][number]
    | null,
): string {
  if (
    !cell?.available ||
    typeof cell.predictedTeamScore !== "number" ||
    typeof cell.predictedOpponentScore !== "number"
  ) {
    return "Unavailable";
  }
  return `${cell.predictedTeamScore.toFixed(1)}-${cell.predictedOpponentScore.toFixed(1)}`;
}

function describeSelectedMatchup(args: {
  opponentPairId: string | null;
  opponentPairs: NextGamePlannerDetailPayload["opponentPairs"];
  ourPairId: string | null;
  ourPairs: NextGamePlannerDetailPayload["ourPairs"];
}): string {
  const ourPair = args.ourPairs.find((pair) => pair.pairId === args.ourPairId);
  const opponentPair = args.opponentPairs.find(
    (pair) => pair.pairId === args.opponentPairId,
  );
  if (!ourPair || !opponentPair) {
    return "Pick a matchup to inspect its predicted scoreline.";
  }

  return `Our ${ourPair.defense} / ${ourPair.offense} versus their ${opponentPair.defense} / ${opponentPair.offense}.`;
}
