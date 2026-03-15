"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button, Heading, Text, TextField } from "@aws-amplify/ui-react";

import { client } from "@/app/amplify-client";
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
      [...response.data].sort((left, right) =>
        String(right.savedAt ?? right.createdAt ?? "").localeCompare(
          String(left.savedAt ?? left.createdAt ?? ""),
        ),
      ),
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
      minuteTargets,
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
    <article className="subpanel">
      <div className="section-header">
        <div>
          <Heading level={4}>Lineup Planner</Heading>
          <Text>
            Recommendation engine for starters, minutes, and saved lineup scenarios.
          </Text>
        </div>
        <Button
          className="secondary-button"
          onClick={() => void loadPlan()}
          isLoading={isLoadingPlan}
        >
          Refresh plan
        </Button>
      </div>

      {plannerError ? <div className="inline-alert">{plannerError}</div> : null}

      {plan ? (
        <>
          <div className="summary-strip">
            <div className="summary-card">
              <span className="summary-label">Confidence</span>
              <strong className="summary-value">
                {Math.round(Number(plan.confidence ?? 0) * 100)}%
              </strong>
              <span className="summary-detail">
                Generated {formatTimestamp(plan.generatedAt ?? null)}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Starter core</span>
              <strong className="summary-value">{starters.length}/5</strong>
              <span className="summary-detail">
                {starters[0]?.fullName ?? "No locked anchor yet"}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Saved scenarios</span>
              <strong className="summary-value">{savedScenarios.length}</strong>
              <span className="summary-detail">
                {lastSavedScenario?.name ?? "No scenario saved this session"}
              </span>
            </div>
          </div>

          <div className="dashboard-grid two-column">
            <div>
              <Heading level={5}>Recommended starters</Heading>
              <ul className="data-list">
                {starters.map((player) => (
                  <li key={player.playerId}>
                    <strong>{player.fullName}</strong>
                    <span>
                      {player.bestPosition ?? "Flex"} • Starts{" "}
                      {player.projectedStarterCount ?? 0} • Score{" "}
                      {formatDecimal(player.score)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <Heading level={5}>Bench order</Heading>
              <ul className="data-list">
                {bench.length ? (
                  bench.map((player) => (
                    <li key={player.playerId}>
                      <strong>{player.fullName}</strong>
                      <span>
                        {player.bestPosition ?? "Flex"} • Score{" "}
                        {formatDecimal(player.score)}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No bench depth has been ranked yet.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="dashboard-grid two-column">
            <div>
              <Heading level={5}>Minute targets</Heading>
              <div className="prediction-form-grid">
                {starters.map((player) => (
                  <label className="field-group" key={`minutes-${player.playerId}`}>
                    <span>{player.fullName}</span>
                    <input
                      className="prediction-input"
                      type="number"
                      min={12}
                      max={48}
                      value={minuteTargets[player.playerId] ?? 0}
                      onChange={(event) =>
                        setMinuteTargets((current) => ({
                          ...current,
                          [player.playerId]: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Heading level={5}>Matchup rationale</Heading>
              <ul className="data-list">
                {matchupRationale.length ? (
                  matchupRationale.map((note) => <li key={note}>{note}</li>)
                ) : (
                  <li>No matchup rationale is available yet.</li>
                )}
              </ul>
              <div className="subpanel-spacer" />
              <Heading level={5}>Rotation notes</Heading>
              <ul className="data-list">
                {rotationNotes.length ? (
                  rotationNotes.map((note) => <li key={note}>{note}</li>)
                ) : (
                  <li>No rotation notes are available yet.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="prediction-form-grid">
            <TextField
              label="Scenario name"
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              placeholder="Primary lineup"
            />
            <TextField
              label="Coach note"
              value={scenarioNote}
              onChange={(event) => setScenarioNote(event.target.value)}
              placeholder="Plan for a press-heavy scout"
            />
          </div>

          <div className="action-row">
            <Button onClick={() => void handleSaveScenario()} isLoading={isSavingScenario}>
              Save scenario
            </Button>
            {lastSavedScenario ? (
              <Text className="status-copy">
                Saved {lastSavedScenario.name} at{" "}
                {formatTimestamp(lastSavedScenario.savedAt ?? null)}.
              </Text>
            ) : null}
          </div>

          <div className="subpanel-spacer" />
          <Heading level={5}>Saved scenarios</Heading>
          <ul className="data-list">
            {savedScenarios.length ? (
              savedScenarios.map((scenario) => (
                <li key={scenario.scenarioId}>
                  <strong>{scenario.name ?? "Saved lineup"}</strong>
                  <span>
                    {formatTimestamp(scenario.savedAt ?? scenario.createdAt ?? null)}
                    {scenario.note ? ` • ${scenario.note}` : ""}
                  </span>
                </li>
              ))
            ) : (
              <li>No saved lineup scenarios yet.</li>
            )}
          </ul>
        </>
      ) : isLoadingPlan ? (
        <Text>Building the current lineup plan.</Text>
      ) : (
        <Text>No lineup plan is available yet.</Text>
      )}
    </article>
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

function toMinuteTargets(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, rawValue]) => [key, Number(rawValue)])
      .filter((entry) => Number.isFinite(entry[1])),
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
