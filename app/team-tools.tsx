"use client";

import { useEffect, useEffectEvent, useState } from "react";
import Link from "next/link";

import { client } from "@/app/amplify-client";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import type {
  LineupPlan,
  LineupScenario,
  SavedLineupScenarioRecord,
} from "@/app/types";

type LineupPlayer = {
  playerId: string;
  fullName: string;
  bestPosition: string | null;
  projectedStarterCount?: number | null;
  score?: number | null;
};

const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-2";
const formGridClassName = "grid gap-4 md:grid-cols-2";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";

export function LineupPlanner() {
  const [plan, setPlan] = useState<LineupPlan | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<SavedLineupScenarioRecord[]>(
    [],
  );
  const [scenarioName, setScenarioName] = useState("Primary lineup");
  const [scenarioNote, setScenarioNote] = useState("");
  const [minuteTargets, setMinuteTargets] = useState<Record<string, number>>({});
  const [lastSavedScenario, setLastSavedScenario] = useState<LineupScenario | null>(
    null,
  );
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [isLoadingPlan, setIsLoadingPlan] = useState(true);
  const [isSavingScenario, setIsSavingScenario] = useState(false);

  useEffect(() => {
    if (!plan) {
      return;
    }

    const nextTargets = toMinuteTargets(plan.minuteTargets);
    setMinuteTargets(nextTargets);
  }, [plan]);

  const initialize = useEffectEvent(async () => {
    await Promise.all([loadPlan(), loadSavedScenarios()]);
  });

  useEffect(() => {
    void initialize();
  }, []);

  async function loadPlan() {
    setIsLoadingPlan(true);
    setPlannerError(null);

    const response = await client.queries.getLineupPlan();
    if (response.errors?.length || !response.data) {
      setPlannerError(formatAmplifyErrors(response.errors));
      setPlan(null);
      setIsLoadingPlan(false);
      return;
    }

    setPlan(response.data);
    setIsLoadingPlan(false);
  }

  async function loadSavedScenarios() {
    const response = await client.models.SavedLineupScenario.list({ limit: 8 });
    if (response.errors?.length) {
      setPlannerError(formatAmplifyErrors(response.errors));
      setSavedScenarios([]);
      return;
    }

    setSavedScenarios(
      [...response.data].sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
    );
  }

  async function handleSaveScenario() {
    if (!plan) {
      return;
    }

    setIsSavingScenario(true);
    setPlannerError(null);

    const response = await client.mutations.saveLineupScenario({
      name: scenarioName.trim() || "Primary lineup",
      starters: toLineupPlayers(plan.recommendedStarters),
      minuteTargets: Object.entries(minuteTargets).map(([playerId, minutes]) => ({
        playerId,
        minutes,
      })),
      note: scenarioNote.trim() || undefined,
    });

    if (response.errors?.length || !response.data) {
      setPlannerError(formatAmplifyErrors(response.errors));
      setIsSavingScenario(false);
      return;
    }

    setLastSavedScenario(response.data);
    setIsSavingScenario(false);
    await loadSavedScenarios();
  }

  const starters = toLineupPlayers(plan?.recommendedStarters);
  const bench = toLineupPlayers(plan?.benchOrder);
  const rotationNotes = toStringList(plan?.rotationNotes);
  const matchupRationale = toStringList(plan?.matchupRationale);

  return (
    <div className="grid gap-4">
      <SectionHeading
        actions={
          <div className="flex flex-wrap gap-3">
            <Button
              loading={isLoadingPlan}
              onClick={() => void loadPlan()}
              variant="secondary"
            >
              Refresh plan
            </Button>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90"
              href="/workspace/lineups"
            >
              Open Lineup Helper
            </Link>
          </div>
        }
        description="Recommendations for starters, minutes, and saved lineup scenarios."
        title="Lineup Planner"
        titleAs="h4"
      />

      {plannerError ? <Alert>{plannerError}</Alert> : null}

      {plan ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              detail={`Generated ${formatTimestamp(plan.generatedAt)}`}
              label="Confidence"
              value={`${Math.round(plan.confidence * 100)}%`}
            />
            <StatCard
              detail={starters[0]?.fullName ?? "No locked anchor yet"}
              label="Starter core"
              value={`${starters.length}/5`}
            />
            <StatCard
              detail={lastSavedScenario?.name ?? "No scenario saved this session"}
              label="Saved scenarios"
              value={savedScenarios.length}
            />
          </div>

          <div className={twoColumnGridClassName}>
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Recommended starters" titleAs="h5" />
              <ul className={listClassName}>
                {starters.map((player) => (
                  <li className={listItemClassName} key={player.playerId}>
                    <strong className="text-sm text-ink">{player.fullName}</strong>
                    <span className={statusCopyClassName}>
                      {player.bestPosition ?? "Flex"} • Starts{" "}
                      {player.projectedStarterCount ?? 0} • Score{" "}
                      {formatDecimal(player.score)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Bench order" titleAs="h5" />
              <ul className={listClassName}>
                {bench.length ? (
                  bench.map((player) => (
                    <li className={listItemClassName} key={player.playerId}>
                      <strong className="text-sm text-ink">{player.fullName}</strong>
                      <span className={statusCopyClassName}>
                        {player.bestPosition ?? "Flex"} • Score{" "}
                        {formatDecimal(player.score)}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-ink-muted">
                    No bench depth has been ranked yet.
                  </li>
                )}
              </ul>
            </Panel>
          </div>

          <div className={twoColumnGridClassName}>
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Minute targets" titleAs="h5" />
              <div className={formGridClassName}>
                {starters.map((player) => (
                  <Field key={`minutes-${player.playerId}`} label={player.fullName}>
                    <Input
                      max={48}
                      min={12}
                      onChange={(event) =>
                        setMinuteTargets((current) => ({
                          ...current,
                          [player.playerId]: Number(event.target.value) || 0,
                        }))
                      }
                      type="number"
                      value={minuteTargets[player.playerId] ?? 0}
                    />
                  </Field>
                ))}
              </div>
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Matchup rationale" titleAs="h5" />
              <ul className={listClassName}>
                {matchupRationale.length ? (
                  matchupRationale.map((note) => (
                    <li className={listItemClassName} key={note}>
                      <span className={statusCopyClassName}>{note}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-ink-muted">
                    No matchup rationale is available yet.
                  </li>
                )}
              </ul>
              <div className="h-1" />
              <SectionHeading title="Rotation notes" titleAs="h5" />
              <ul className={listClassName}>
                {rotationNotes.length ? (
                  rotationNotes.map((note) => (
                    <li className={listItemClassName} key={note}>
                      <span className={statusCopyClassName}>{note}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-ink-muted">
                    No rotation notes are available yet.
                  </li>
                )}
              </ul>
            </Panel>
          </div>

          <div className={formGridClassName}>
            <Field label="Scenario name">
              <Input
                onChange={(event) => setScenarioName(event.target.value)}
                placeholder="Primary lineup"
                value={scenarioName}
              />
            </Field>
            <Field label="Coach note">
              <Input
                onChange={(event) => setScenarioNote(event.target.value)}
                placeholder="Plan for a press-heavy opponent"
                value={scenarioNote}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button loading={isSavingScenario} onClick={() => void handleSaveScenario()}>
              Save scenario
            </Button>
            {lastSavedScenario ? (
              <p className={statusCopyClassName}>
                Saved {lastSavedScenario.name} at{" "}
                {formatTimestamp(lastSavedScenario.savedAt)}.
              </p>
            ) : null}
          </div>

          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading title="Saved scenarios" titleAs="h5" />
            <ul className={listClassName}>
              {savedScenarios.length ? (
                savedScenarios.map((scenario) => (
                  <li className={listItemClassName} key={scenario.scenarioId}>
                    <strong className="text-sm text-ink">
                      {scenario.name}
                    </strong>
                    <span className={statusCopyClassName}>
                      {formatTimestamp(scenario.savedAt)}
                      {scenario.note ? ` • ${scenario.note}` : ""}
                    </span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-ink-muted">No saved lineup scenarios yet.</li>
              )}
            </ul>
          </Panel>
        </>
      ) : isLoadingPlan ? (
        <p className={statusCopyClassName}>Building the current lineup plan.</p>
      ) : (
        <p className={statusCopyClassName}>No lineup plan is available yet.</p>
      )}
    </div>
  );
}

function toLineupPlayers(value: unknown): LineupPlayer[] {
  return Array.isArray(value)
    ? value
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
        .map((entry) => ({
          playerId: String(entry.playerId ?? ""),
          fullName: String(entry.fullName ?? "Unknown player"),
          bestPosition:
            typeof entry.bestPosition === "string" ? entry.bestPosition : null,
          projectedStarterCount:
            typeof entry.projectedStarterCount === "number"
              ? entry.projectedStarterCount
              : null,
          score: typeof entry.score === "number" ? entry.score : null,
        }))
        .filter((entry) => Boolean(entry.playerId))
    : [];
}

function toMinuteTargets(
  value: Array<{ minutes?: number | null; playerId?: string | null }> | null | undefined,
): Record<string, number> {
  if (!Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    value
      .map((entry) => [entry.playerId ?? "", Number(entry.minutes)] as const)
      .filter(([playerId, minutes]) => Boolean(playerId) && Number.isFinite(minutes)),
  );
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry))
    : [];
}

function formatAmplifyErrors(
  errors: Array<{ message?: string }> | null | undefined,
): string {
  if (!errors?.length) {
    return "The operation failed without a detailed error message.";
  }

  return errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
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

function formatDecimal(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "N/A";
}
