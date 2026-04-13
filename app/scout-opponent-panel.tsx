"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { boxscoreQueryOptions } from "@/app/dashboard/workspace-query-client";
import {
  GAME_PREDICTION_DEFENSE_OPTIONS,
  GAME_PREDICTION_EFFORT_OPTIONS,
  GAME_PREDICTION_OFFENSE_OPTIONS,
  createDefaultPredictionRatings,
  toPredictionDefenseDisplay,
  toPredictionOffenseDisplay,
} from "@/app/game-prediction-state";
import type {
  MatchBoxscorePayload,
  MatchBoxscoreTeam,
  OpponentForecastScenario,
  OpponentForecastSnapshot,
  ScoutWorkspacePayload,
  ScoutedOpponentSheet,
} from "@/app/types";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input, Select, Textarea } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import { StatusBadge } from "@/app/ui/primitives/status-badge";

type ScoutOpponentPanelProps = {
  canUsePredictions: boolean;
  forecast: OpponentForecastSnapshot | null;
  forecastError: string | null;
  isLoadingForecast: boolean;
  isNextOpponent: boolean;
  isRefreshingForecast: boolean;
  nextMatchContext: string | null;
  onRefreshForecast: () => void;
  onSendToPrediction: (sheet: ScoutedOpponentSheet) => void;
  openScheduleHref: string;
  scout: ScoutWorkspacePayload;
};

const ratingGridClassName =
  "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

export function ScoutOpponentPanel({
  canUsePredictions,
  forecast,
  forecastError,
  isLoadingForecast,
  isNextOpponent,
  isRefreshingForecast,
  nextMatchContext,
  onRefreshForecast,
  onSendToPrediction,
  openScheduleHref,
  scout,
}: ScoutOpponentPanelProps) {
  const summary = scout.summary;
  const sourceMatchId =
    summary?.recentGames.find((match) => match.matchId && match.hasBoxscore)?.matchId ??
    null;
  const sourceBoxscoreQuery = useQuery({
    ...boxscoreQueryOptions({ matchId: sourceMatchId ?? "" }),
    enabled: Boolean(sourceMatchId),
  });
  const sourceTeam = useMemo(
    () =>
      selectBoxscoreTeamForOpponent(
        sourceBoxscoreQuery.data ?? null,
        scout.teamId ?? scout.requestedTeamId ?? null,
      ),
    [scout.requestedTeamId, scout.teamId, sourceBoxscoreQuery.data],
  );
  const baseSheet = useMemo(
    () =>
      buildScoutedOpponentSheet({
        forecast,
        scout,
        sourceMatchId,
        sourceTeam,
      }),
    [forecast, scout, sourceMatchId, sourceTeam],
  );
  const [draft, setDraft] = useState<ScoutedOpponentSheet>(baseSheet);

  useEffect(() => {
    setDraft(baseSheet);
  }, [baseSheet]);

  if (!summary) {
    return (
      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading title="Scouted opponent" titleAs="h4" />
        <p className="text-sm leading-7 text-ink-muted">
          {scout.message ?? "Load an opponent to build the scouting sheet."}
        </p>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4">
      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-transparent px-3.5 text-xs font-semibold text-ink-muted transition duration-150 hover:border-border-soft hover:bg-white/45 hover:text-ink"
                href={openScheduleHref}
                prefetch={false}
              >
                Open opponent schedule
              </Link>
              <Button
                disabled={!canUsePredictions}
                onClick={() => onSendToPrediction(draft)}
                size="sm"
                variant="secondary"
              >
                Send to prediction
              </Button>
            </div>
          }
          description={
            isNextOpponent && nextMatchContext
              ? `Upcoming matchup: ${nextMatchContext}`
              : "Editable opponent-only scouting output for the selected club."
          }
          title={summary.teamName ?? "Scouted opponent"}
          titleAs="h4"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            detail={summary.teamName ?? "Selected club"}
            label="Record"
            value={formatRecord(summary.record)}
          />
          <StatCard
            detail="Latest five results from this opponent's recent games."
            label="Recent form"
            value={describeRecentForm(summary.recentGames)}
          />
          <StatCard
            detail={
              draft.scenarioLabel
                ? `Scenario ${draft.scenarioLabel}`
                : "Most recent boxscore or neutral baseline"
            }
            label="Forecast confidence"
            value={formatConfidence(draft.confidence)}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel as="article" padding="sm" variant="solid">
            <SectionHeading
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!canUsePredictions}
                    loading={isRefreshingForecast}
                    onClick={onRefreshForecast}
                    size="sm"
                    variant="secondary"
                  >
                    Refresh forecast
                  </Button>
                  <Button
                    onClick={() => setDraft(baseSheet)}
                    size="sm"
                    variant="ghost"
                  >
                    Reset to forecast
                  </Button>
                </div>
              }
              title="Scouted opponent sheet"
              titleAs="h4"
            />

            {forecastError ? <Alert>{forecastError}</Alert> : null}
            {!canUsePredictions ? (
              <Alert>
                Premium access is required to generate a fresh scouting forecast.
              </Alert>
            ) : null}
            {forecast?.error ? <Alert>{forecast.error}</Alert> : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Team name">
                <Input
                  onChange={(event) => {
                    const teamName = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      teamName,
                    }));
                  }}
                  value={draft.teamName}
                />
              </Field>
              <Field label="Team ID">
                <Input
                  onChange={(event) => {
                    const teamId = event.currentTarget.value.trim() || null;
                    setDraft((current) => ({
                      ...current,
                      teamId,
                    }));
                  }}
                  value={draft.teamId ?? ""}
                />
              </Field>
              <Field label="Projected offense">
                <Select
                  onChange={(event) => {
                    const offense = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      offense,
                    }));
                  }}
                  value={draft.offense}
                >
                  {GAME_PREDICTION_OFFENSE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Projected defense">
                <Select
                  onChange={(event) => {
                    const defense = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      defense,
                    }));
                  }}
                  value={draft.defense}
                >
                  {GAME_PREDICTION_DEFENSE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Projected effort">
                <Select
                  onChange={(event) => {
                    const effortChoice = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      effortChoice,
                    }));
                  }}
                  value={draft.effortChoice}
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
                    setDraft((current) => ({
                      ...current,
                      gdpFocus,
                    }));
                  }}
                  value={draft.gdpFocus}
                />
              </Field>
              <Field label="GDP pace">
                <Input
                  onChange={(event) => {
                    const gdpPace = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      gdpPace,
                    }));
                  }}
                  value={draft.gdpPace}
                />
              </Field>
              <Field
                hint="Shows where the editable ratings came from."
                label="Ratings source"
              >
                <Input
                  onChange={(event) => {
                    const sourceLabel = event.currentTarget.value.trim() || null;
                    setDraft((current) => ({
                      ...current,
                      sourceLabel,
                    }));
                  }}
                  value={draft.sourceLabel ?? ""}
                />
              </Field>
            </div>

            <div className={ratingGridClassName}>
              {renderRatingField("Outside scoring", draft.ratings.outsideScoring, (value) =>
                updateDraftRating(setDraft, "outsideScoring", value),
              )}
              {renderRatingField("Inside scoring", draft.ratings.insideScoring, (value) =>
                updateDraftRating(setDraft, "insideScoring", value),
              )}
              {renderRatingField("Outside defense", draft.ratings.outsideDefense, (value) =>
                updateDraftRating(setDraft, "outsideDefense", value),
              )}
              {renderRatingField("Inside defense", draft.ratings.insideDefense, (value) =>
                updateDraftRating(setDraft, "insideDefense", value),
              )}
              {renderRatingField("Rebounding", draft.ratings.rebounding, (value) =>
                updateDraftRating(setDraft, "rebounding", value),
              )}
              {renderRatingField("Offensive flow", draft.ratings.offensiveFlow, (value) =>
                updateDraftRating(setDraft, "offensiveFlow", value),
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Field label="Projected lineup">
                <Textarea
                  onChange={(event) => {
                    const lineupText = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      lineupText,
                    }));
                  }}
                  value={draft.lineupText}
                />
              </Field>
              <Field label="Projected rotation">
                <Textarea
                  onChange={(event) => {
                    const rotationText = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      rotationText,
                    }));
                  }}
                  value={draft.rotationText}
                />
              </Field>
            </div>

            <Field
              hint="One clue per line."
              label="Evidence and provenance"
            >
              <Textarea
                onChange={(event) => {
                  const evidence = event.currentTarget.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean);
                  setDraft((current) => ({
                    ...current,
                    evidence,
                  }));
                }}
                value={draft.evidence.join("\n")}
              />
            </Field>
          </Panel>

          <div className="grid gap-4">
            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Forecast status" titleAs="h4" />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={forecast?.status === "SUCCEEDED" ? "success" : "neutral"}>
                  {forecast?.status ?? "NOT_READY"}
                </StatusBadge>
                {draft.generatedAt ? (
                  <span className="text-xs font-semibold text-ink-muted">
                    Generated {formatTimestamp(draft.generatedAt)}
                  </span>
                ) : null}
                {draft.scenarioProbability !== null ? (
                  <span className="text-xs font-semibold text-ink-muted">
                    {formatPercent(draft.scenarioProbability)}
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-7 text-ink-muted">
                {isLoadingForecast
                  ? "Loading the latest stored scouting forecast."
                  : draft.scenarioLabel
                    ? `${draft.scenarioLabel} is the current editable baseline.`
                    : "No stored forecast was available, so the sheet falls back to the latest usable game context."}
              </p>
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Top players" titleAs="h4" />
              <ul className="grid list-none gap-3 p-0">
                {summary.topPlayers.length ? (
                  summary.topPlayers.slice(0, 6).map((player) => (
                    <li
                      className="grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0"
                      key={player.playerId ?? player.fullName}
                    >
                      <strong className="text-sm text-ink">{player.fullName}</strong>
                      <span className="text-sm text-ink-muted">
                        {[
                          player.bestPosition,
                          typeof player.recentAvgMinutes === "number"
                            ? `${Math.round(player.recentAvgMinutes)} mpg`
                            : null,
                          typeof player.ppg === "number"
                            ? `${player.ppg.toFixed(1)} ppg`
                            : null,
                        ]
                          .filter((value): value is string => Boolean(value))
                          .join(" • ") || "No recent production summary"}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-ink-muted">
                    No opponent player summary is ready yet.
                  </li>
                )}
              </ul>
            </Panel>

            <Panel as="article" padding="sm" variant="solid">
              <SectionHeading title="Recent games" titleAs="h4" />
              <ul className="grid list-none gap-3 p-0">
                {summary.recentGames.length ? (
                  summary.recentGames.slice(0, 5).map((game) => (
                    <li
                      className="grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0"
                      key={game.matchId ?? `${game.startTime}-${game.opponentTeamName}`}
                    >
                      <strong className="text-sm text-ink">
                        {game.opponentTeamName ?? "Unknown opponent"}
                      </strong>
                      <span className="text-sm text-ink-muted">
                        {formatMatchResult(game)}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-ink-muted">
                    No recent games are available yet.
                  </li>
                )}
              </ul>
            </Panel>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function buildScoutedOpponentSheet(args: {
  forecast: OpponentForecastSnapshot | null;
  scout: ScoutWorkspacePayload;
  sourceMatchId: string | null;
  sourceTeam: MatchBoxscoreTeam | null;
}): ScoutedOpponentSheet {
  const summary = args.scout.summary;
  const primaryScenario = args.forecast?.result?.topScenarios[0] ?? null;
  const sourceRatings = args.sourceTeam?.ratings ?? null;
  const ratings = sourceRatings
    ? {
        insideDefense: sourceRatings.insideDefense,
        insideScoring: sourceRatings.insideScoring,
        offensiveFlow: sourceRatings.offensiveFlow,
        outsideDefense: sourceRatings.outsideDefense,
        outsideScoring: sourceRatings.outsideScoring,
        rebounding: sourceRatings.rebounding,
      }
    : createDefaultPredictionRatings();
  const projectedOffense =
    primaryScenario?.offense ??
    toPredictionOffenseDisplay(args.sourceTeam?.offStrategy);
  const projectedDefense =
    primaryScenario?.defense ??
    toPredictionDefenseDisplay(args.sourceTeam?.defStrategy);

  return {
    confidence: args.forecast?.result?.confidence ?? null,
    defense: toPredictionDefenseDisplay(projectedDefense),
    effortChoice: primaryScenario?.effortChoice ?? "Normal",
    evidence:
      primaryScenario?.evidence.length
        ? [...primaryScenario.evidence]
        : args.sourceTeam
          ? ["Ratings derived from the latest usable opponent boxscore."]
          : ["No stored forecast yet. Start from this editable baseline."],
    gdpFocus: primaryScenario?.gdpFocus ?? "N/A",
    gdpPace: primaryScenario?.gdpPace ?? "N/A",
    generatedAt:
      args.forecast?.result?.generatedAt ??
      args.forecast?.completedAt ??
      null,
    lineupText: formatProjectionPlayers(primaryScenario?.starters ?? []),
    offense: toPredictionOffenseDisplay(projectedOffense),
    ratings,
    rotationText: formatProjectionPlayers(primaryScenario?.rotation ?? []),
    scenarioLabel: primaryScenario?.label ?? null,
    scenarioProbability: primaryScenario?.probability ?? null,
    sourceLabel:
      args.sourceTeam && args.sourceMatchId
        ? `Latest usable boxscore ${args.sourceMatchId}`
        : "Editable baseline",
    sourceMatchId: args.sourceMatchId,
    teamId: args.scout.teamId ?? args.scout.requestedTeamId ?? null,
    teamName: summary?.teamName ?? "Selected opponent",
  };
}

function selectBoxscoreTeamForOpponent(
  match: MatchBoxscorePayload | null,
  opponentTeamId: string | null,
): MatchBoxscoreTeam | null {
  if (!match || !opponentTeamId) {
    return null;
  }

  if (match.homeTeam?.teamId === opponentTeamId) {
    return match.homeTeam;
  }
  if (match.awayTeam?.teamId === opponentTeamId) {
    return match.awayTeam;
  }
  return null;
}

function updateDraftRating(
  setDraft: Dispatch<SetStateAction<ScoutedOpponentSheet>>,
  key: keyof ScoutedOpponentSheet["ratings"],
  value: string,
) {
  setDraft((current) => ({
    ...current,
    ratings: {
      ...current.ratings,
      [key]: normalizeNumericInput(value, current.ratings[key]),
    },
  }));
}

function renderRatingField(
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

function formatProjectionPlayers(players: OpponentForecastScenario["starters"]): string {
  if (!players.length) {
    return "";
  }

  return players
    .map((player) => {
      const parts = [
        player.fullName,
        player.bestPosition,
        typeof player.expectedMinutes === "number"
          ? `${player.expectedMinutes} min`
          : null,
      ].filter((value): value is string => Boolean(value));
      return parts.join(" • ");
    })
    .join("\n");
}

function formatRecord(
  record:
    | NonNullable<NonNullable<ScoutWorkspacePayload["summary"]>["record"]>
    | null
    | undefined,
): string {
  if (!record) {
    return "N/A";
  }
  return `${record.wins ?? 0}-${record.losses ?? 0}`;
}

function describeRecentForm(
  games: NonNullable<ScoutWorkspacePayload["summary"]>["recentGames"],
): string {
  const sequence = games
    .slice(0, 5)
    .map((game) => {
      if (game.outcome === "WIN") {
        return "W";
      }
      if (game.outcome === "LOSS") {
        return "L";
      }
      return "•";
    })
    .join("");

  return sequence || "No recent games";
}

function formatConfidence(value: number | null): string {
  if (typeof value !== "number") {
    return "Not ready";
  }
  return formatPercent(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unknown time";
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

function formatMatchResult(
  match: NonNullable<ScoutWorkspacePayload["summary"]>["recentGames"][number],
): string {
  const score =
    typeof match.teamScore === "number" && typeof match.opponentScore === "number"
      ? `${match.teamScore}-${match.opponentScore}`
      : "Score unavailable";
  const outcome = match.outcome ? `${match.outcome} • ` : "";
  const venue = match.type ? `${match.type} • ` : "";
  return `${outcome}${venue}${score}`;
}

function normalizeNumericInput(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Number(parsed.toFixed(2));
}
