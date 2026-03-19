import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyForecastScenarioToDraft,
  buildSubmissionRequest,
  clearForecastPrefill,
  createDefaultManualPredictionInput,
  createDefaultPredictionDraft,
  mapOpponentEffortChoiceToRelativeDelta,
} from "../app/prediction-panel-state";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const fixturePath = join(currentDir, "fixtures", "prediction-resolved-input.json");

test("manual prediction fixture stays aligned with the webapp payload shape", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  const defaults = createDefaultManualPredictionInput();

  assert.deepStrictEqual(Object.keys(fixture).sort(), Object.keys(defaults).sort());
});

test("connected submission always carries the manual fallback payload", () => {
  const manualInput = createDefaultManualPredictionInput();
  const draft = {
    ...createDefaultPredictionDraft({
      home: {
        recentMatches: [],
      },
      scout: {
        summary: null,
      },
    } as any),
    connectedOverrides: {
      away_gdp_focus: "Balanced.hit",
      away_gdp_pace: "Normal.hit",
      away_offStrategy: "Motion",
      away_defStrategy: "23Zone",
      effortDelta: -1,
    },
    manualInput,
  };
  const submission = buildSubmissionRequest({
    draft: {
      ...draft,
      connectedSelection: {
        awaySourceMatchId: "away-match",
        homeSourceMatchId: "home-match",
      },
      forecastPrefill: {
        context: {
          evidence: ["Analog consensus"],
          forecastGeneratedAt: "2026-03-19T00:00:00.000Z",
          forecastJobId: "job-1",
          forecastModelVersion: "forecast-v1",
          scenarioId: "scenario-1",
          scenarioLabel: "Primary",
          scenarioProbability: 0.62,
          sourceTeamId: "team-1",
        },
        overrides: {
          away_defStrategy: "23Zone",
          away_gdp_focus: "Balanced.hit",
          away_gdp_pace: "Normal.hit",
          away_offStrategy: "Motion",
          effortDelta: -1,
        },
      },
    },
    homeTeamId: "HOME",
    awayTeamId: "AWAY",
  });

  assert.equal(submission.mode, "CONNECTED");
  const connectedInput = (submission as { connectedInput: Record<string, unknown> }).connectedInput;
  assert.deepStrictEqual(connectedInput.manualFallback, manualInput);
  assert.equal(connectedInput.away_gdp_focus, "Balanced.hit");
  assert.equal(connectedInput.away_gdp_pace, "Normal.hit");
  assert.deepStrictEqual(connectedInput.forecastContext, {
    evidence: ["Analog consensus"],
    forecastGeneratedAt: "2026-03-19T00:00:00.000Z",
    forecastJobId: "job-1",
    forecastModelVersion: "forecast-v1",
    scenarioId: "scenario-1",
    scenarioLabel: "Primary",
    scenarioProbability: 0.62,
    sourceTeamId: "team-1",
  });
});

test("forecast scenario prefill can be cleared without removing later edits", () => {
  const draft = applyForecastScenarioToDraft({
    draft: createDefaultPredictionDraft({
      home: {
        recentMatches: [{ hasBoxscore: true, matchId: "home-match" }],
      },
      scout: {
        summary: {
          recentGames: [{ hasBoxscore: true, matchId: "away-match" }],
        },
      },
    } as any),
    scenario: {
      defense: "23Zone",
      effortChoice: "Crunch Time",
      evidence: ["Cup pressure"],
      gdpFocus: "Balanced.hit",
      gdpPace: "Normal.hit",
      label: "Primary",
      offense: "Motion",
      probability: 0.54,
      rotation: [],
      scenarioId: "scenario-1",
      starters: [],
    },
    snapshot: {
      completedAt: "2026-03-19T00:05:00.000Z",
      error: null,
      jobId: "job-1",
      modelVersion: "forecast-v1",
      requestedAt: "2026-03-19T00:00:00.000Z",
      result: null,
      startedAt: "2026-03-19T00:01:00.000Z",
      status: "SUCCEEDED",
      teamId: "team-1",
      teamName: "Forecast Club",
    },
    sourceTeamId: "team-1",
    workspace: {
      home: {
        recentMatches: [{ hasBoxscore: true, matchId: "home-match" }],
      },
      scout: {
        summary: {
          recentGames: [{ hasBoxscore: true, matchId: "away-match" }],
        },
      },
    } as any,
  });

  const edited = {
    ...draft,
    connectedOverrides: {
      ...draft.connectedOverrides,
      away_gdp_focus: "Inside.hit",
    },
  };
  const cleared = clearForecastPrefill(edited);

  assert.equal(cleared.forecastPrefill, null);
  assert.equal(cleared.connectedOverrides.away_offStrategy, undefined);
  assert.equal(cleared.connectedOverrides.away_defStrategy, undefined);
  assert.equal(cleared.connectedOverrides.away_gdp_pace, undefined);
  assert.equal(cleared.connectedOverrides.effortDelta, undefined);
  assert.equal(cleared.connectedOverrides.away_gdp_focus, "Inside.hit");
});

test("opponent effort mapping uses the fixed home-normal baseline", () => {
  assert.equal(mapOpponentEffortChoiceToRelativeDelta("Take It Easy"), 1);
  assert.equal(mapOpponentEffortChoiceToRelativeDelta("Normal"), 0);
  assert.equal(mapOpponentEffortChoiceToRelativeDelta("Crunch Time"), -1);
});
