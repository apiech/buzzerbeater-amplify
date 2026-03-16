"use client";

import { useEffect, useState } from "react";

import { client } from "@/app/amplify-client";
import { Alert } from "@/app/ui/primitives/alert";
import { Button } from "@/app/ui/primitives/button";
import { Field, Input } from "@/app/ui/primitives/field";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { StatCard } from "@/app/ui/primitives/stat-card";
import {
  StatusBadge,
  statusToneFromValue,
} from "@/app/ui/primitives/status-badge";
import type {
  DashboardWorkspace,
  GameDayRecapCoveragePayload,
  GameDayRecapRecord,
  GameDayRecapResultPayload,
} from "@/app/types";

const terminalStatuses = new Set(["FAILED", "SUCCEEDED"]);
const formGridClassName = "grid gap-4 md:grid-cols-2";
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-2 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-[1.5fr_0.9fr]";

type RecapPanelProps = {
  workspace: DashboardWorkspace;
};

export function RecapPanel({ workspace }: RecapPanelProps) {
  const [leagueId, setLeagueId] = useState(workspace.home.connection.leagueId ?? "");
  const [gameDate, setGameDate] = useState(resolveDefaultRecapDate(workspace));
  const [recaps, setRecaps] = useState<GameDayRecapRecord[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [isLoadingRecaps, setIsLoadingRecaps] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!leagueId && workspace.home.connection.leagueId) {
      setLeagueId(workspace.home.connection.leagueId);
    }
  }, [leagueId, workspace.home.connection.leagueId]);

  useEffect(() => {
    void loadRecaps();
  }, []);

  useEffect(() => {
    if (!hasActiveGameDayRecap(recaps)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadRecaps(selectedTargetKey);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [recaps, selectedTargetKey]);

  async function loadRecaps(preferredTargetKey: string | null = selectedTargetKey) {
    setIsLoadingRecaps(true);

    const { data, errors } = await client.models.GameDayRecap.list({ limit: 12 });
    if (errors?.length) {
      setRecapError(formatAmplifyErrors(errors));
      setRecaps([]);
      setSelectedTargetKey(null);
      setIsLoadingRecaps(false);
      return;
    }

    const sorted = sortGameDayRecaps(data);
    setRecaps(sorted);
    setSelectedTargetKey((current) => {
      const targetKey = preferredTargetKey ?? current;
      if (targetKey && sorted.some((recap) => recap.targetKey === targetKey)) {
        return targetKey;
      }
      return sorted[0]?.targetKey ?? null;
    });
    setIsLoadingRecaps(false);
  }

  async function handleSubmit() {
    const normalizedLeagueId = leagueId.trim();
    if (!normalizedLeagueId || !gameDate) {
      setRecapError("Pick a league and date before requesting a recap.");
      return;
    }

    setIsSubmitting(true);
    setRecapError(null);

    const result = await client.mutations.submitGameDayRecap({
      gameDate,
      leagueId: normalizedLeagueId,
    });

    if (result.errors?.length || !result.data) {
      setRecapError(formatAmplifyErrors(result.errors));
      setIsSubmitting(false);
      return;
    }

    setSelectedTargetKey(result.data.targetKey);
    await loadRecaps(result.data.targetKey);
    setIsSubmitting(false);
  }

  const selectedRecap =
    recaps.find((recap) => recap.targetKey === selectedTargetKey) ?? recaps[0] ?? null;
  const selectedResult = toGameDayRecapResult(selectedRecap?.resultJson);
  const selectedCoverage = toGameDayRecapCoverage(selectedRecap?.coverageJson);
  const recapDetail =
    selectedRecap?.leagueName || selectedRecap?.leagueId
      ? `${selectedRecap?.leagueName ?? selectedRecap?.leagueId} • ${selectedRecap?.gameDate}`
      : "No recap selected";
  const currentLeagueName = workspace.home.connection.leagueName ?? "Connected league";

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            disabled={!leagueId.trim() || !gameDate}
            loading={isSubmitting}
            onClick={() => void handleSubmit()}
          >
            Generate recap
          </Button>
        }
        description="Request a league-day recap, keep polling while it runs, and browse prior recaps without leaving the workspace."
        eyebrow="Recaps"
        title="Game day recap"
      />

      <p className={statusCopyClassName}>
        v1 uses standings, schedules, recent form, box scores, and effort context only.
        Transfers and play-by-play are intentionally excluded for now.
      </p>

      {recapError ? <Alert>{recapError}</Alert> : null}

      <div className={twoColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description="League id defaults to your connected club when available, but you can point the job at any league."
            title="Request"
            titleAs="h4"
          />
          <div className={formGridClassName}>
            <Field label="League id">
              <Input
                onChange={(event) => setLeagueId(event.target.value)}
                placeholder="League id"
                value={leagueId}
              />
            </Field>
            <Field label="Game date">
              <Input
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setGameDate(event.target.value)}
                type="date"
                value={gameDate}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              detail={
                workspace.home.connection.leagueId
                  ? `Connected league ${workspace.home.connection.leagueId}`
                  : "No connected league detected."
              }
              label="Default source"
              value={currentLeagueName}
            />
            <StatCard
              detail={
                selectedCoverage
                  ? describeCoverage(selectedCoverage)
                  : "No recap result has been selected yet."
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
                onClick={() => void loadRecaps(selectedTargetKey)}
                size="sm"
                variant="secondary"
              >
                Refresh list
              </Button>
            }
            title="Recent recaps"
            titleAs="h4"
          />

          {recaps.length ? (
            <ul className={listClassName}>
              {recaps.map((recap) => {
                const selected = recap.targetKey === selectedRecap?.targetKey;
                return (
                  <li className={listItemClassName} key={recap.targetKey}>
                    <button
                      className={[
                        "grid gap-1 rounded-2xl border px-4 py-3 text-left transition",
                        selected
                          ? "border-accent bg-accent/10"
                          : "border-black/8 bg-white hover:border-accent/35",
                      ].join(" ")}
                      onClick={() => setSelectedTargetKey(recap.targetKey)}
                      type="button"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm text-ink">
                          {recap.leagueName ?? recap.leagueId}
                        </strong>
                        <StatusBadge tone={statusToneFromValue(recap.status)}>
                          {humanizeStatus(recap.status)}
                        </StatusBadge>
                      </div>
                      <span className={statusCopyClassName}>
                        {recap.gameDate} • {formatTimestamp(recap.updatedAt ?? recap.requestedAt)}
                      </span>
                      {recap.error ? (
                        <span className="text-sm text-danger">{recap.error}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={statusCopyClassName}>
              No recap jobs have been recorded yet.
            </p>
          )}
        </Panel>
      </div>

      <Panel as="article" padding="sm" variant="solid">
        <SectionHeading
          description={recapDetail}
          title={selectedResult?.summary.headline ?? "Selected recap"}
          titleAs="h4"
        />

        {selectedRecap ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone={statusToneFromValue(selectedRecap.status)}>
                {humanizeStatus(selectedRecap.status)}
              </StatusBadge>
              {selectedRecap.modelId ? (
                <span className={statusCopyClassName}>Model {selectedRecap.modelId}</span>
              ) : null}
              {selectedRecap.completedAt ? (
                <span className={statusCopyClassName}>
                  Completed {formatTimestamp(selectedRecap.completedAt)}
                </span>
              ) : null}
            </div>

            {selectedCoverage?.partial ? (
              <Alert>
                Partial coverage: {selectedCoverage.availableGames} of{" "}
                {selectedCoverage.requestedGames} games were available. Missing games:{" "}
                {selectedCoverage.missingGames
                  .map(
                    (game) =>
                      `${game.awayTeamName} at ${game.homeTeamName} (${game.reason})`,
                  )
                  .join("; ")}
              </Alert>
            ) : null}

            {selectedRecap.error ? <Alert>{selectedRecap.error}</Alert> : null}

            {selectedResult ? (
              <>
                <p className={statusCopyClassName}>{selectedResult.summary.lede}</p>
                <div className="grid gap-4">
                  {selectedResult.games.map((game) => (
                    <Panel
                      as="article"
                      key={game.matchId}
                      padding="sm"
                      variant="glass"
                    >
                      <SectionHeading
                        description={`Match ${game.matchId}`}
                        title={game.headline}
                        titleAs="h5"
                      />
                      <p className="text-sm leading-7 text-ink">{game.writeup}</p>
                      {game.evidenceTags.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {game.evidenceTags.map((tag) => (
                            <StatusBadge
                              key={tag}
                              tone="neutral"
                            >
                              {formatEvidenceTag(tag)}
                            </StatusBadge>
                          ))}
                        </div>
                      ) : null}
                    </Panel>
                  ))}
                </div>
              </>
            ) : (
              <p className={statusCopyClassName}>
                {selectedRecap.status === "FAILED"
                  ? "The selected recap failed before a structured result was saved."
                  : "Structured recap output will appear here once the job finishes."}
              </p>
            )}
          </div>
        ) : (
          <p className={statusCopyClassName}>
            Select a prior recap or generate a new one to review the slate writeups.
          </p>
        )}
      </Panel>
    </Panel>
  );
}

export function resolveDefaultRecapDate(workspace: DashboardWorkspace): string {
  const recentMatchDate = workspace.home.recentMatches
    .map((match) => match.startTime)
    .find((startTime): startTime is string => Boolean(resolveDateKey(startTime)));

  return resolveDateKey(recentMatchDate) ?? new Date().toISOString().slice(0, 10);
}

export function sortGameDayRecaps(
  recaps: readonly GameDayRecapRecord[],
): GameDayRecapRecord[] {
  return [...recaps].sort((left, right) =>
    String(right.updatedAt ?? right.requestedAt ?? "").localeCompare(
      String(left.updatedAt ?? left.requestedAt ?? ""),
    ),
  );
}

export function hasActiveGameDayRecap(
  recaps: readonly GameDayRecapRecord[],
): boolean {
  return recaps.some(
    (recap) => Boolean(recap.status) && !terminalStatuses.has(recap.status),
  );
}

function toGameDayRecapCoverage(
  value: unknown,
): GameDayRecapCoveragePayload | null {
  const record = parseJsonRecord(value);
  const missingGames = Array.isArray(record?.missingGames) ? record.missingGames : null;
  const availableGames = asNumber(record?.availableGames);
  const requestedGames = asNumber(record?.requestedGames);

  if (!record || !missingGames) {
    return null;
  }

  return {
    availableGames,
    missingGames: missingGames
      .map((entry) => parseJsonRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        awayTeamName: asString(entry.awayTeamName) ?? "Away team",
        homeTeamName: asString(entry.homeTeamName) ?? "Home team",
        matchId: asString(entry.matchId) ?? "unknown",
        reason: asString(entry.reason) ?? "coverage unavailable",
      })),
    partial: Boolean(record.partial),
    requestedGames,
  };
}

function toGameDayRecapResult(
  value: unknown,
): GameDayRecapResultPayload | null {
  const record = parseJsonRecord(value);
  const summary = parseJsonRecord(record?.summary);
  const games = Array.isArray(record?.games) ? record.games : null;

  if (!summary || !games) {
    return null;
  }

  const headline = asString(summary.headline);
  const lede = asString(summary.lede);
  if (!headline || !lede) {
    return null;
  }

  return {
    games: games
      .map((game) => parseJsonRecord(game))
      .filter((game): game is Record<string, unknown> => Boolean(game))
      .map((game) => ({
        evidenceTags: Array.isArray(game.evidenceTags)
          ? game.evidenceTags.filter((tag): tag is string => typeof tag === "string")
          : [],
        headline: asString(game.headline) ?? "Untitled game recap",
        matchId: asString(game.matchId) ?? "unknown",
        writeup: asString(game.writeup) ?? "",
      })),
    summary: {
      headline,
      lede,
    },
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return parseJsonRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveDateKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : null;
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

function humanizeStatus(status: string | null | undefined): string {
  if (!status) {
    return "Unknown";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function describeCoverage(coverage: GameDayRecapCoveragePayload): string {
  return coverage.partial
    ? `${coverage.availableGames} of ${coverage.requestedGames} final games were available.`
    : `${coverage.availableGames} games were covered.`;
}

function formatEvidenceTag(tag: string): string {
  return tag
    .replace(/_/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}
