"use client";

import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Button, Heading, Text } from "@aws-amplify/ui-react";

import { client } from "@/app/amplify-client";
import type {
  DashboardWorkspace,
  ManualPredictionInput,
  PredictionJobRecord,
  PredictionResult,
  PredictionSubmissionRequest,
} from "@/app/types";

const OFFENSE_OPTIONS = [
  "Base",
  "Push",
  "Patient",
  "Motion",
  "RunAndGun",
  "Princeton",
  "LookInside",
  "LowPost",
  "InsideIsolation",
  "OutsideIsolation",
];

const DEFENSE_OPTIONS = [
  "ManToMan",
  "23Zone",
  "32Zone",
  "131Zone",
  "Press",
  "InsideBoxAndOne",
  "OutsideBoxAndOne",
];

const GDP_FOCUS_OPTIONS = [
  "N/A",
  "Inside.hit",
  "Inside.miss",
  "outside.hit",
  "outside.miss",
  "Balanced.hit",
  "Balanced.miss",
];

const GDP_PACE_OPTIONS = [
  "N/A",
  "Fast.hit",
  "Fast.miss",
  "Normal.hit",
  "Normal.miss",
  "Slow.hit",
  "Slow.miss",
];

const RATING_FIELDS: Array<{
  label: string;
  homeKey: NumericManualField;
  awayKey: NumericManualField;
}> = [
  {
    label: "Outside scoring",
    homeKey: "home_outsideScoring",
    awayKey: "away_outsideScoring",
  },
  {
    label: "Inside scoring",
    homeKey: "home_insideScoring",
    awayKey: "away_insideScoring",
  },
  {
    label: "Outside defense",
    homeKey: "home_outsideDefense",
    awayKey: "away_outsideDefense",
  },
  {
    label: "Inside defense",
    homeKey: "home_insideDefense",
    awayKey: "away_insideDefense",
  },
  {
    label: "Rebounding",
    homeKey: "home_rebounding",
    awayKey: "away_rebounding",
  },
  {
    label: "Offensive flow",
    homeKey: "home_offensiveFlow",
    awayKey: "away_offensiveFlow",
  },
];

type PredictionPanelProps = {
  workspace: DashboardWorkspace;
};

type SubmissionMode = "MANUAL" | "CONNECTED";

type ConnectedSelectionState = {
  homeSourceMatchId: string;
  awaySourceMatchId: string;
};

type NumericManualField =
  | "home_outsideScoring"
  | "home_insideScoring"
  | "home_outsideDefense"
  | "home_insideDefense"
  | "home_rebounding"
  | "home_offensiveFlow"
  | "away_outsideScoring"
  | "away_insideScoring"
  | "away_outsideDefense"
  | "away_insideDefense"
  | "away_rebounding"
  | "away_offensiveFlow"
  | "effortDelta";

type TextManualField = Exclude<keyof ManualPredictionInput, NumericManualField>;

const terminalStatuses = new Set(["SUCCEEDED", "FAILED"]);

export function PredictionPanel({ workspace }: PredictionPanelProps) {
  const [mode, setMode] = useState<SubmissionMode>("CONNECTED");
  const [manualInput, setManualInput] = useState<ManualPredictionInput>(
    createDefaultManualPredictionInput(),
  );
  const [connectedSelection, setConnectedSelection] =
    useState<ConnectedSelectionState>({
      homeSourceMatchId: workspace.home.recentMatches[0]?.matchId ?? "",
      awaySourceMatchId: workspace.scout.summary?.recentGames[0]?.matchId ?? "",
    });
  const [jobs, setJobs] = useState<PredictionJobRecord[]>([]);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const homeMatchOptions = workspace.home.recentMatches.filter(
    (match) => Boolean(match.matchId && match.hasBoxscore),
  );
  const awayMatchOptions = workspace.scout.summary?.recentGames.filter(
    (match) => Boolean(match.matchId && match.hasBoxscore),
  ) ?? [];
  const defaultHomeSourceMatchId = homeMatchOptions[0]?.matchId ?? "";
  const defaultAwaySourceMatchId = awayMatchOptions[0]?.matchId ?? "";
  const homeTeamId = workspace.home.team.teamId;
  const awayTeamId = workspace.scout.summary?.matchupPerspective.opponentTeamId ?? null;

  useEffect(() => {
    setConnectedSelection((current) => ({
      homeSourceMatchId: current.homeSourceMatchId || defaultHomeSourceMatchId,
      awaySourceMatchId: current.awaySourceMatchId || defaultAwaySourceMatchId,
    }));
  }, [defaultHomeSourceMatchId, defaultAwaySourceMatchId]);

  useEffect(() => {
    void loadJobs();
  }, []);

  useEffect(() => {
    const hasActiveJob = jobs.some(
      (job) => job.status && !terminalStatuses.has(job.status),
    );
    if (!hasActiveJob) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadJobs();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [jobs]);

  async function loadJobs() {
    setIsLoadingJobs(true);
    const { data, errors } = await client.models.PredictionJob.list({ limit: 12 });

    if (errors?.length) {
      setPredictionError(formatAmplifyErrors(errors));
      setJobs([]);
      setIsLoadingJobs(false);
      return;
    }

    const sorted = [...data].sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? "").localeCompare(
        left.updatedAt ?? left.createdAt ?? "",
      ),
    );
    setJobs(sorted);
    setIsLoadingJobs(false);
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setPredictionError(null);

    const request = buildSubmissionRequest({
      mode,
      manualInput,
      homeSourceMatchId: connectedSelection.homeSourceMatchId,
      awaySourceMatchId: connectedSelection.awaySourceMatchId,
      homeTeamId,
      awayTeamId,
    });

    const result = await client.mutations.submitPredictionJob({
      request: request as unknown as Record<string, unknown>,
    });

    if (result.errors?.length || !result.data) {
      setPredictionError(formatAmplifyErrors(result.errors));
      setIsSubmitting(false);
      return;
    }

    await loadJobs();
    setIsSubmitting(false);
  }

  const connectedReady = Boolean(
    connectedSelection.homeSourceMatchId &&
      connectedSelection.awaySourceMatchId &&
      homeTeamId &&
      awayTeamId,
  );
  const latestJob = jobs[0] ?? null;
  const latestResult = latestJob ? toPredictionResult(latestJob.result) : null;
  const latestExplanation = latestJob
    ? describeResolvedInput(latestJob.resolvedInputSnapshot)
    : [];

  return (
    <section className="dashboard-card">
      <div className="section-header">
        <div>
          <Text className="eyebrow">Prediction Lab</Text>
          <Heading level={2}>Async matchup predictions via SageMaker</Heading>
        </div>
        <div className="prediction-toolbar">
          <div className="mode-toggle" role="tablist" aria-label="Prediction mode">
            <button
              type="button"
              className={`mode-button ${mode === "CONNECTED" ? "active" : ""}`}
              onClick={() => setMode("CONNECTED")}
            >
              Connected
            </button>
            <button
              type="button"
              className={`mode-button ${mode === "MANUAL" ? "active" : ""}`}
              onClick={() => setMode("MANUAL")}
            >
              Manual
            </button>
          </div>
          <Button
            onClick={() => void handleSubmit()}
            isLoading={isSubmitting}
            isDisabled={mode === "CONNECTED" && !connectedReady}
          >
            {mode === "CONNECTED" ? "Queue connected prediction" : "Queue manual prediction"}
          </Button>
        </div>
      </div>

      <Text className="status-copy">
        The web app submits a prediction job, the backend resolves the final
        matchup payload, and the worker invokes a SageMaker Serverless endpoint.
        Connected mode uses cached source box scores plus the manual form as a
        fallback.
      </Text>

      {predictionError ? <div className="inline-alert">{predictionError}</div> : null}

      <div className="dashboard-grid two-column">
        <article className="subpanel">
          <Heading level={4}>Connected sources</Heading>
          <Text>
            Choose one recent game for your team and one for the opponent. The
            worker will reuse the cached ratings from those box scores.
          </Text>

          <div className="prediction-form-grid">
            <label className="field-group">
              <span>Home source match</span>
              <select
                className="prediction-select"
                value={connectedSelection.homeSourceMatchId}
                onChange={(event) =>
                  setConnectedSelection((current) => ({
                    ...current,
                    homeSourceMatchId: event.target.value,
                  }))
                }
              >
                <option value="">Select a recent home match</option>
                {homeMatchOptions.map((match) => (
                  <option key={match.matchId} value={match.matchId ?? ""}>
                    {formatMatchOption(match.opponentTeamName, match.startTime, match.teamScore, match.opponentScore)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group">
              <span>Away source match</span>
              <select
                className="prediction-select"
                value={connectedSelection.awaySourceMatchId}
                onChange={(event) =>
                  setConnectedSelection((current) => ({
                    ...current,
                    awaySourceMatchId: event.target.value,
                  }))
                }
              >
                <option value="">Select a recent opponent match</option>
                {awayMatchOptions.map((match) => (
                  <option key={match.matchId} value={match.matchId ?? ""}>
                    {formatMatchOption(match.opponentTeamName, match.startTime, match.teamScore, match.opponentScore)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="summary-strip prediction-status-strip">
            <div className="summary-card">
              <span className="summary-label">Home team</span>
              <strong className="summary-value">
                {workspace.home.team.teamName ?? "Unavailable"}
              </strong>
              <span className="summary-detail">Uses your workspace cache.</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Opponent</span>
              <strong className="summary-value">
                {workspace.scout.summary?.teamName ?? "No cached opponent"}
              </strong>
              <span className="summary-detail">
                {awayMatchOptions.length
                  ? `${awayMatchOptions.length} recent opponent games cached`
                  : "Refresh the workspace to populate opponent samples."}
              </span>
            </div>
          </div>
        </article>

        <article className="subpanel">
          <Heading level={4}>
            {mode === "MANUAL" ? "Manual matchup payload" : "Manual fallback payload"}
          </Heading>
          <Text>
            Ratings are required for manual predictions and serve as the fallback
            payload when connected source matches are unavailable.
          </Text>

          <div className="rating-table">
            <div className="rating-table-header">Metric</div>
            <div className="rating-table-header">Home</div>
            <div className="rating-table-header">Away</div>
            {RATING_FIELDS.map((field) => (
              <div className="rating-table-row" key={field.label}>
                <span className="rating-label">{field.label}</span>
                <input
                  className="prediction-input"
                  type="number"
                  step="0.1"
                  value={manualInput[field.homeKey]}
                  onChange={(event) =>
                    updateNumericField(
                      field.homeKey,
                      event.target.value,
                      setManualInput,
                    )
                  }
                />
                <input
                  className="prediction-input"
                  type="number"
                  step="0.1"
                  value={manualInput[field.awayKey]}
                  onChange={(event) =>
                    updateNumericField(
                      field.awayKey,
                      event.target.value,
                      setManualInput,
                    )
                  }
                />
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="dashboard-grid two-column">
        <article className="subpanel">
          <Heading level={4}>Tactics and prep</Heading>
          <div className="prediction-form-grid">
            <label className="field-group">
              <span>Home offense</span>
              <select
                className="prediction-select"
                value={manualInput.home_offStrategy}
                onChange={(event) =>
                  updateTextField("home_offStrategy", event.target.value, setManualInput)
                }
              >
                {OFFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Home defense</span>
              <select
                className="prediction-select"
                value={manualInput.home_defStrategy}
                onChange={(event) =>
                  updateTextField("home_defStrategy", event.target.value, setManualInput)
                }
              >
                {DEFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Away offense</span>
              <select
                className="prediction-select"
                value={manualInput.away_offStrategy}
                onChange={(event) =>
                  updateTextField("away_offStrategy", event.target.value, setManualInput)
                }
              >
                {OFFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Away defense</span>
              <select
                className="prediction-select"
                value={manualInput.away_defStrategy}
                onChange={(event) =>
                  updateTextField("away_defStrategy", event.target.value, setManualInput)
                }
              >
                {DEFENSE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Home GDP focus</span>
              <select
                className="prediction-select"
                value={manualInput.home_gdp_focus}
                onChange={(event) =>
                  updateTextField("home_gdp_focus", event.target.value, setManualInput)
                }
              >
                {GDP_FOCUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Home GDP pace</span>
              <select
                className="prediction-select"
                value={manualInput.home_gdp_pace}
                onChange={(event) =>
                  updateTextField("home_gdp_pace", event.target.value, setManualInput)
                }
              >
                {GDP_PACE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Away GDP focus</span>
              <select
                className="prediction-select"
                value={manualInput.away_gdp_focus}
                onChange={(event) =>
                  updateTextField("away_gdp_focus", event.target.value, setManualInput)
                }
              >
                {GDP_FOCUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Away GDP pace</span>
              <select
                className="prediction-select"
                value={manualInput.away_gdp_pace}
                onChange={(event) =>
                  updateTextField("away_gdp_pace", event.target.value, setManualInput)
                }
              >
                {GDP_PACE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </article>

        <article className="subpanel">
          <Heading level={4}>Game context and queue status</Heading>
          <div className="prediction-form-grid">
            <label className="field-group">
              <span>Neutral site</span>
              <select
                className="prediction-select"
                value={manualInput.neutral}
                onChange={(event) =>
                  updateTextField("neutral", event.target.value, setManualInput)
                }
              >
                <option value="0">Home court</option>
                <option value="1">Neutral site</option>
              </select>
            </label>
            <label className="field-group">
              <span>Effort delta</span>
              <input
                className="prediction-input"
                type="number"
                min={-2}
                max={2}
                step={1}
                value={manualInput.effortDelta}
                onChange={(event) =>
                  updateNumericField("effortDelta", event.target.value, setManualInput)
                }
              />
            </label>
          </div>

          {latestJob ? (
            <div className="job-summary">
              <span className={`status-badge status-${latestJob.status?.toLowerCase()}`}>
                {humanizeJobStatus(latestJob.status)}
              </span>
              <strong>{describePredictionJob(latestJob)}</strong>
              <span className="summary-detail">
                Updated {formatTimestamp(latestJob.updatedAt ?? latestJob.createdAt ?? null)}
              </span>
              {latestResult ? (
                <span className="summary-detail">
                  Model {latestResult.modelVersion}
                </span>
              ) : null}
              {latestExplanation.length ? (
                <div className="chip-group prediction-explainer">
                  {latestExplanation.map((item) => (
                    <span className="chip" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <Text>No prediction jobs submitted yet.</Text>
          )}
        </article>
      </div>

      <article className="subpanel">
        <Heading level={4}>Recent prediction jobs</Heading>
        {isLoadingJobs ? (
          <Text>Loading prediction job history.</Text>
        ) : jobs.length ? (
          <ul className="data-list">
            {jobs.map((job) => (
              <li key={job.id}>
                <strong>{describePredictionJob(job)}</strong>
                <span>
                  {humanizeJobStatus(job.status)}
                  {job.modelVersion ? ` • ${job.modelVersion}` : ""}
                  {" • "}
                  {formatTimestamp(job.updatedAt ?? job.createdAt ?? null)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Text>No prediction jobs are stored yet.</Text>
        )}
      </article>
    </section>
  );
}

export function buildSubmissionRequest(args: {
  mode: SubmissionMode;
  manualInput: ManualPredictionInput;
  homeSourceMatchId: string;
  awaySourceMatchId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
}): PredictionSubmissionRequest {
  if (args.mode === "MANUAL") {
    return {
      mode: "MANUAL",
      manualInput: args.manualInput,
    };
  }

  return {
    mode: "CONNECTED",
    connectedInput: {
      homeSourceMatchId: args.homeSourceMatchId || undefined,
      awaySourceMatchId: args.awaySourceMatchId || undefined,
      homeTeamId: args.homeTeamId ?? undefined,
      awayTeamId: args.awayTeamId ?? undefined,
      home_offStrategy: args.manualInput.home_offStrategy,
      home_defStrategy: args.manualInput.home_defStrategy,
      away_offStrategy: args.manualInput.away_offStrategy,
      away_defStrategy: args.manualInput.away_defStrategy,
      home_gdp_focus: args.manualInput.home_gdp_focus,
      home_gdp_pace: args.manualInput.home_gdp_pace,
      away_gdp_focus: args.manualInput.away_gdp_focus,
      away_gdp_pace: args.manualInput.away_gdp_pace,
      neutral: args.manualInput.neutral,
      effortDelta: args.manualInput.effortDelta,
      manualFallback: args.manualInput,
    },
  };
}

export function createDefaultManualPredictionInput(): ManualPredictionInput {
  return {
    home_outsideScoring: 10,
    home_insideScoring: 10,
    home_outsideDefense: 10,
    home_insideDefense: 10,
    home_rebounding: 10,
    home_offensiveFlow: 10,
    away_outsideScoring: 10,
    away_insideScoring: 10,
    away_outsideDefense: 10,
    away_insideDefense: 10,
    away_rebounding: 10,
    away_offensiveFlow: 10,
    home_offStrategy: "Base",
    home_defStrategy: "ManToMan",
    away_offStrategy: "Base",
    away_defStrategy: "ManToMan",
    neutral: "0",
    effortDelta: 0,
    home_gdp_focus: "N/A",
    home_gdp_pace: "N/A",
    away_gdp_focus: "N/A",
    away_gdp_pace: "N/A",
  };
}

function updateNumericField(
  field: NumericManualField,
  nextValue: string,
  setManualInput: Dispatch<SetStateAction<ManualPredictionInput>>,
) {
  const parsed = Number(nextValue);
  setManualInput((current) => ({
    ...current,
    [field]: Number.isFinite(parsed) ? parsed : 0,
  }));
}

function updateTextField(
  field: TextManualField,
  nextValue: string,
  setManualInput: Dispatch<SetStateAction<ManualPredictionInput>>,
) {
  setManualInput((current) => ({
    ...current,
    [field]: nextValue,
  }));
}

function describePredictionJob(job: PredictionJobRecord): string {
  const result = toPredictionResult(job.result);
  if (result) {
    return `${result.homeScore.toFixed(1)} - ${result.awayScore.toFixed(1)} (${formatSigned(result.pointDiff)})`;
  }

  if (job.error) {
    return job.error;
  }

  return job.mode === "CONNECTED"
    ? "Connected prediction queued"
    : "Manual prediction queued";
}

function toPredictionResult(value: unknown): PredictionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typed = value as Partial<PredictionResult>;
  if (
    typeof typed.homeScore !== "number" ||
    typeof typed.awayScore !== "number" ||
    typeof typed.pointDiff !== "number"
  ) {
    return null;
  }

  return {
    homeScore: typed.homeScore,
    awayScore: typed.awayScore,
    pointDiff: typed.pointDiff,
    modelVersion: typed.modelVersion ?? "unknown",
  };
}

function describeResolvedInput(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const snapshot = value as Partial<Record<string, unknown>>;
  const notes = [
    summarizeStrategy(snapshot, "home", "Home"),
    summarizeStrategy(snapshot, "away", "Away"),
    summarizeVenue(snapshot.neutral),
    summarizeEffort(snapshot.effortDelta),
    summarizeMatchupEdge(
      "Perimeter",
      snapshot.home_outsideScoring,
      snapshot.away_outsideDefense,
    ),
    summarizeMatchupEdge(
      "Interior",
      snapshot.home_insideScoring,
      snapshot.away_insideDefense,
    ),
    summarizeMatchupEdge(
      "Boards",
      snapshot.home_rebounding,
      snapshot.away_rebounding,
      false,
    ),
  ].filter((note): note is string => Boolean(note));

  return notes.slice(0, 6);
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

function humanizeJobStatus(status: PredictionJobRecord["status"]): string {
  if (!status) {
    return "Unknown";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
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

function formatMatchOption(
  opponentTeamName: string | null,
  startTime: string | null,
  teamScore: number | null,
  opponentScore: number | null,
): string {
  const result =
    teamScore !== null && opponentScore !== null
      ? ` • ${teamScore}-${opponentScore}`
      : "";
  return `${opponentTeamName ?? "Unknown opponent"} • ${formatTimestamp(startTime)}${result}`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

function summarizeStrategy(
  snapshot: Partial<Record<string, unknown>>,
  side: "home" | "away",
  label: string,
): string | null {
  const offense = asOptionalString(snapshot[`${side}_offStrategy`]);
  const defense = asOptionalString(snapshot[`${side}_defStrategy`]);
  if (!offense && !defense) {
    return null;
  }

  return `${label} ${offense ?? "Base"} / ${defense ?? "ManToMan"}`;
}

function summarizeVenue(value: unknown): string | null {
  const normalized = asOptionalString(value);
  if (!normalized) {
    return null;
  }

  return normalized === "1" ? "Neutral site" : "Home court";
}

function summarizeEffort(value: unknown): string | null {
  const numeric = asOptionalNumber(value);
  if (numeric === null || numeric === 0) {
    return null;
  }

  return `Effort Δ ${numeric > 0 ? `+${numeric}` : numeric}`;
}

function summarizeMatchupEdge(
  label: string,
  offense: unknown,
  defense: unknown,
  treatAsDefense = true,
): string | null {
  const offenseValue = asOptionalNumber(offense);
  const defenseValue = asOptionalNumber(defense);

  if (offenseValue === null || defenseValue === null) {
    return null;
  }

  const diff = treatAsDefense ? offenseValue - defenseValue : offenseValue - defenseValue;
  return `${label} ${formatSigned(diff)}`;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
