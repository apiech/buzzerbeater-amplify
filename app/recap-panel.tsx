"use client";

import { useEffect, useEffectEvent, useState } from "react";

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
import { formatWriteupStatus } from "@/app/ui/presentation";
import type {
  DashboardWorkspace,
  GameDayRecapRecord,
  GameDayRecapCoveragePayload,
  GameDayRecapResultPayload,
  RecapHistoryKind,
  RecapHistoryRecord,
} from "@/app/types";
import {
  inferLeagueTimeZone,
  normalizeLeagueTimeZone,
  resolveCalendarDateKey,
} from "@/lib/league-timezones";

const terminalStatuses = new Set(["FAILED", "SUCCEEDED"]);
const formGridClassName = "grid gap-4 md:grid-cols-2";
const listClassName = "grid list-none gap-3 p-0";
const listItemClassName =
  "grid gap-2 border-b border-black/8 pb-3 last:border-b-0 last:pb-0";
const modeSwitcherClassName = "flex flex-wrap gap-2";
const statusCopyClassName = "text-sm leading-7 text-ink-muted";
const twoColumnGridClassName = "grid gap-4 xl:grid-cols-[1.5fr_0.9fr]";

type RecapPanelProps = {
  workspace: DashboardWorkspace;
};

type RecapMode = RecapHistoryKind;

type MutationResultLike = {
  data?: { targetKey: string } | null;
  errors?: Array<{ message?: string }> | null;
};

const recapModes: Array<{
  description: string;
  label: string;
  value: RecapMode;
}> = [
  {
    description: "Pick a league number and calendar date in the league's local time zone.",
    label: "League date",
    value: "LEAGUE_DATE",
  },
  {
    description: "Use the regular-season game day number from 1 to 22.",
    label: "League game day",
    value: "LEAGUE_GAME_DAY",
  },
  {
    description: "Summarize one finished game by entering its BuzzerBeater game number.",
    label: "Single game",
    value: "SINGLE_GAME",
  },
];

export function RecapPanel({ workspace }: RecapPanelProps) {
  const defaultLeagueId = workspace.home.connection.leagueId ?? "";
  const defaultLeagueTimeZone = resolveWorkspaceLeagueTimeZone(workspace);
  const [mode, setMode] = useState<RecapMode>("LEAGUE_DATE");
  const [leagueId, setLeagueId] = useState(defaultLeagueId);
  const [leagueTimeZone, setLeagueTimeZone] = useState(defaultLeagueTimeZone ?? "");
  const [gameDate, setGameDate] = useState(resolveDefaultRecapDate(workspace));
  const [gameDayNumber, setGameDayNumber] = useState("1");
  const [season, setSeason] = useState("");
  const [matchId, setMatchId] = useState("");
  const [recaps, setRecaps] = useState<RecapHistoryRecord[]>([]);
  const [selectedRecapKey, setSelectedRecapKey] = useState<string | null>(null);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [isLoadingRecaps, setIsLoadingRecaps] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadRecapsEffect = useEffectEvent(
    (preferredKey: string | null = selectedRecapKey) => {
      void loadRecaps(preferredKey);
    },
  );

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
    loadRecapsEffect();
  }, []);

  useEffect(() => {
    if (!hasActiveRecap(recaps)) {
      return;
    }

    const interval = window.setInterval(() => {
      loadRecapsEffect(selectedRecapKey);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [recaps, selectedRecapKey]);

  async function loadRecaps(preferredKey: string | null = selectedRecapKey) {
    setIsLoadingRecaps(true);
    setRecapError(null);

    const response = await client.reads.getRecapHistory({ limit: 8 });

    if (response.errors?.length || !response.data) {
      setRecapError(formatAmplifyErrors(response.errors));
      setRecaps([]);
      setSelectedRecapKey(null);
      setIsLoadingRecaps(false);
      return;
    }

    const combined = sortRecapHistory(response.data.items);

    setRecaps(combined);
    setSelectedRecapKey((current) => {
      const targetKey = preferredKey ?? current;
      if (targetKey && combined.some((recap) => recap.selectionKey === targetKey)) {
        return targetKey;
      }

      return combined[0]?.selectionKey ?? null;
    });
    setIsLoadingRecaps(false);
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setRecapError(null);

    try {
      const result = await submitRecapRequest({
        gameDate,
        gameDayNumber,
        leagueId,
        leagueTimeZone,
        mode,
        season,
        workspace,
        matchId,
      });
      if (result.errors?.length || !result.data) {
        setRecapError(formatAmplifyErrors(result.errors));
        setIsSubmitting(false);
        return;
      }

      const selectionKey = toRecapSelectionKey(mode, result.data.targetKey);
      setSelectedRecapKey(selectionKey);
      await loadRecaps(selectionKey);
    } catch (error) {
      setRecapError(error instanceof Error ? error.message : String(error));
    }

    setIsSubmitting(false);
  }

  const selectedRecap =
    recaps.find((recap) => recap.selectionKey === selectedRecapKey) ??
    recaps.at(0) ??
    null;
  const selectedResult = toGameDayRecapResult(selectedRecap?.resultJson);
  const selectedCoverage = toGameDayRecapCoverage(selectedRecap?.coverageJson);
  const recapDetail = selectedRecap
    ? describeRecapRecord(selectedRecap)
    : "No recap selected";
  const currentLeagueName = workspace.home.connection.leagueName ?? "Your league";
  const normalizedLeagueTimeZone = normalizeLeagueTimeZone(leagueTimeZone);
  const maxGameDate = resolveRecapInputMaxDate(leagueTimeZone);
  const activeMode = recapModes.find((entry) => entry.value === mode) ?? recapModes[0];
  if (!activeMode) {
    throw new Error("At least one recap mode must be configured.");
  }

  return (
    <Panel>
      <SectionHeading
        actions={
          <Button
            disabled={Boolean(getSubmissionBlockReason({
              gameDate,
              gameDayNumber,
              leagueId,
              leagueTimeZone,
              matchId,
              mode,
            }))}
            loading={isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {submitLabelForMode(mode)}
          </Button>
        }
        description="Use your connected league by default, or switch to manual league and single-game requests when you need them."
        eyebrow="Recaps"
        title="Recap generator"
      />

      <p className={statusCopyClassName}>
        v1 uses standings, schedules, recent form, box scores, and effort context only.
        Transfers and play-by-play are intentionally excluded for now.
      </p>

      {recapError ? <Alert>{recapError}</Alert> : null}

      <div className={twoColumnGridClassName}>
        <Panel as="article" padding="sm" variant="solid">
          <SectionHeading
            description={activeMode.description}
            title="Request"
            titleAs="h4"
          />

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
            <Field hint="Example: 137828772" label="Game number">
              <Input
                inputMode="numeric"
                onChange={(event) => setMatchId(event.target.value)}
                placeholder="Game number"
                value={matchId}
              />
            </Field>
          ) : null}

          {getSubmissionBlockReason({
            gameDate,
            gameDayNumber,
            leagueId,
            leagueTimeZone,
            matchId,
            mode,
          }) ? (
            <Alert>
              {
                getSubmissionBlockReason({
                  gameDate,
                  gameDayNumber,
                  leagueId,
                  leagueTimeZone,
                  matchId,
                  mode,
                }) as string
              }
            </Alert>
          ) : null}

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
                onClick={() => void loadRecaps(selectedRecapKey)}
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
                const selected = recap.selectionKey === selectedRecap?.selectionKey;
                return (
                  <li className={listItemClassName} key={recap.selectionKey}>
                    <button
                      className={[
                        "grid gap-1 rounded-2xl border px-4 py-3 text-left transition",
                        selected
                          ? "border-accent bg-accent/10"
                          : "border-black/8 bg-white hover:border-accent/35",
                      ].join(" ")}
                      onClick={() => setSelectedRecapKey(recap.selectionKey)}
                      type="button"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm text-ink">
                          {recapTitle(recap)}
                        </strong>
                        <StatusBadge tone={statusToneFromValue(recap.status)}>
                          {formatWriteupStatus(recap.status)}
                        </StatusBadge>
                      </div>
                      <span className={statusCopyClassName}>
                        {describeRecapRecord(recap)} • {formatTimestamp(recap.updatedAt)}
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
              No writeups have been recorded yet.
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
                {formatWriteupStatus(selectedRecap.status)}
              </StatusBadge>
              <StatusBadge tone="neutral">{modeLabelForRecord(selectedRecap)}</StatusBadge>
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
                    <Panel as="article" key={game.matchId} padding="sm" variant="glass">
                      <SectionHeading title={game.headline} titleAs="h5" />
                      <p className="text-sm leading-7 text-ink">{game.writeup}</p>
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
                  ))}
                </div>
              </>
            ) : (
              <p className={statusCopyClassName}>
                {selectedRecap.status === "FAILED"
                  ? "The selected recap failed before a structured result was saved."
                  : "Writeup details will appear here once the request finishes."}
              </p>
            )}
          </div>
        ) : (
          <p className={statusCopyClassName}>
            Select a prior recap or generate a new one to review the writeups.
          </p>
        )}
      </Panel>
    </Panel>
  );
}

async function submitRecapRequest(args: {
  gameDate: string;
  gameDayNumber: string;
  leagueId: string;
  leagueTimeZone: string;
  matchId: string;
  mode: RecapMode;
  season: string;
  workspace: DashboardWorkspace;
}): Promise<MutationResultLike> {
  const normalizedLeagueId = args.leagueId.trim();
  const normalizedTimeZone = normalizeLeagueTimeZone(args.leagueTimeZone);

  switch (args.mode) {
    case "LEAGUE_DATE": {
      if (!normalizedLeagueId || !args.gameDate) {
        throw new Error("Pick a league number, date, and time zone before requesting a recap.");
      }
      if (!normalizedTimeZone) {
        throw new Error("Enter a valid league time zone before requesting a date-based recap.");
      }

      const currentTimeZone = resolveWorkspaceLeagueTimeZone(args.workspace);
      if (currentTimeZone !== normalizedTimeZone) {
        const updateResult = await client.mutations.setBbLeagueTimeZone({
          leagueTimeZone: normalizedTimeZone,
        });
        if (updateResult.errors?.length) {
          return {
            data: null,
            errors: updateResult.errors,
          };
        }
      }

      return client.mutations.submitGameDayRecap({
        gameDate: args.gameDate,
        leagueId: normalizedLeagueId,
      });
    }
    case "LEAGUE_GAME_DAY": {
      const numericGameDay = Number(args.gameDayNumber);
      const seasonValue = args.season.trim() ? Number(args.season) : undefined;
      if (!normalizedLeagueId || !Number.isInteger(numericGameDay)) {
        throw new Error("Enter a league number and regular-season game day from 1 to 22.");
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

      return client.mutations.submitLeagueGameDayRecap({
        gameDayNumber: numericGameDay,
        leagueId: normalizedLeagueId,
        ...(seasonValue ? { season: seasonValue } : {}),
      });
    }
    case "SINGLE_GAME": {
      const normalizedMatchId = args.matchId.trim();
      if (!/^\d+$/.test(normalizedMatchId)) {
        throw new Error("Enter a numeric BuzzerBeater game number.");
      }

      return client.mutations.submitSingleGameSummary({
        matchId: normalizedMatchId,
      });
    }
  }
}

function toRecapSelectionKey(kind: RecapMode, targetKey: string): string {
  return `${kind}:${targetKey}`;
}

function sortRecapHistory(recaps: readonly RecapHistoryRecord[]): RecapHistoryRecord[] {
  return [...recaps].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function hasActiveRecap(recaps: readonly RecapHistoryRecord[]): boolean {
  return recaps.some(
    (recap) => Boolean(recap.status) && !terminalStatuses.has(recap.status ?? ""),
  );
}

function recapTitle(record: RecapHistoryRecord): string {
  const headline = toGameDayRecapResult(record.resultJson)?.summary.headline;
  if (headline) {
    return headline;
  }

  if (record.kind === "SINGLE_GAME") {
    return "Single-game recap";
  }

  return record.leagueName ?? "League recap";
}

function describeRecapRecord(record: RecapHistoryRecord): string {
  switch (record.kind) {
    case "LEAGUE_GAME_DAY":
      return `${record.leagueName ?? "League"} • game day ${record.gameDayNumber}${record.season ? ` • season ${record.season}` : ""}`;
    case "SINGLE_GAME":
      return `${record.leagueName ?? "Single game"}${record.gameDate ? ` • ${record.gameDate}` : ""}`;
    case "LEAGUE_DATE":
    default:
      return `${record.leagueName ?? "League"} • ${record.gameDate ?? "date unavailable"}`;
  }
}

function modeLabelForRecord(record: RecapHistoryRecord): string {
  return recapModes.find((entry) => entry.value === record.kind)?.label ?? record.kind;
}

function submitLabelForMode(mode: RecapMode): string {
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

function getSubmissionBlockReason(args: {
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
      if (!Number.isInteger(numericGameDay) || numericGameDay < 1 || numericGameDay > 22) {
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

export function resolveWorkspaceLeagueTimeZone(
  workspace: DashboardWorkspace,
): string | null {
  return (
    normalizeLeagueTimeZone(workspace.home.connection.leagueTimeZone) ??
    inferLeagueTimeZone({
      countryId: workspace.home.connection.countryId ?? null,
      countryName: workspace.home.connection.countryName ?? null,
    })
  );
}

export function resolveRecapInputMaxDate(timeZone: string | null | undefined): string {
  return (
    resolveCalendarDateKey(new Date().toISOString(), timeZone) ??
    new Date().toISOString().slice(0, 10)
  );
}

export function resolveDefaultRecapDate(workspace: DashboardWorkspace): string {
  const timeZone = resolveWorkspaceLeagueTimeZone(workspace);
  const recentMatchDate = workspace.home.recentMatches
    .map((match) => resolveCalendarDateKey(match.startTime, timeZone))
    .find((startTime): startTime is string => Boolean(startTime));

  return recentMatchDate ?? resolveRecapInputMaxDate(timeZone);
}

export function sortGameDayRecaps(
  recaps: readonly GameDayRecapRecord[],
): GameDayRecapRecord[] {
  return [...recaps].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

export const __testing = {
  describeRecapRecord,
  recapTitle,
};
