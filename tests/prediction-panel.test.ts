import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  countRenderablePredictionGridCells,
  findBestPredictionGridCell,
  findPredictionGridCell,
  hasRenderablePredictionGrid,
  isPredictionGridSelectionSupported,
  readPredictionGridSelection,
  toPredictionTacticsGrid,
  toPredictionResult,
} from "../app/prediction-result";
import {
  applyForecastScenarioToDraft,
  buildSubmissionRequest,
  clearForecastPrefill,
  createDefaultManualPredictionInput,
  createDefaultPredictionDraft,
  mapOpponentEffortChoiceToRelativeDelta,
  reconcilePredictionDraft,
} from "../app/prediction-panel-state";
import {
  applyBoxscoreRatingsToPredictionInput,
  buildModelInputFromPredictionInput,
  normalizePredictionRatingsFromBoxscore,
} from "../lib/prediction/normalization";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const fixturePath = join(
  currentDir,
  "fixtures",
  "prediction-resolved-input.json",
);

test("resolved prediction fixture stays aligned with the model payload shape", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<
    string,
    unknown
  >;
  const defaults = buildModelInputFromPredictionInput(
    createDefaultManualPredictionInput(),
  );

  assert.deepStrictEqual(
    Object.keys(fixture).sort(),
    Object.keys(defaults).sort(),
  );
});

test("prediction submission uses the editable grid as the source of truth", () => {
  const input = {
    ...createDefaultManualPredictionInput(),
    away_gdp_focus: "Balanced.hit",
    away_gdp_pace: "Normal.hit",
    effortDelta: -1,
  };
  const submission = buildSubmissionRequest({
    draft: {
      ...createDefaultPredictionDraft({
        home: {
          recentMatches: [],
        },
        scout: {
          summary: null,
        },
      } as any),
      forecastPrefill: {
        appliedValues: {
          effortDelta: -1,
        },
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
        previousValues: {
          effortDelta: 0,
        },
      },
      input,
    },
  });

  assert.deepStrictEqual(submission, {
    forecastContext: {
      evidence: ["Analog consensus"],
      forecastGeneratedAt: "2026-03-19T00:00:00.000Z",
      forecastJobId: "job-1",
      forecastModelVersion: "forecast-v1",
      scenarioId: "scenario-1",
      scenarioLabel: "Primary",
      scenarioProbability: 0.62,
      sourceTeamId: "team-1",
    },
    input: {
      ...input,
      away_gdp_focus: "N/A",
      away_gdp_pace: "N/A",
    },
  });
});

test("boxscore normalization removes source tactics and home court exactly once", () => {
  const normalized = normalizePredictionRatingsFromBoxscore({
    sourceTeam: {
      defStrategy: "32Zone",
      offStrategy: "Motion",
      players: [],
      teamId: "HOME",
      teamName: "Home Club",
      ratings: [
        { key: "outsideScoring", numberValue: 12.3 },
        { key: "insideScoring", numberValue: 7.74 },
        { key: "outsideDefense", numberValue: 11.66 },
        { key: "insideDefense", numberValue: 9.328 },
        { key: "rebounding", numberValue: 8.12056 },
        { key: "offensiveFlow", numberValue: 10.4 },
      ],
      efficiency: [],
      partialScores: [],
      score: 100,
      shortName: "HOME",
      teamTotals: [],
    },
    teamLocation: "HOME",
  });

  assert.equal(normalized.outsideScoring, 10);
  assert.equal(normalized.insideScoring, 9);
  assert.equal(normalized.outsideDefense, 10);
  assert.equal(normalized.insideDefense, 10);
  assert.ok(Math.abs(normalized.rebounding - 8.5) < 0.01);
  assert.equal(normalized.offensiveFlow, 10);

  const applied = applyBoxscoreRatingsToPredictionInput({
    input: createDefaultManualPredictionInput(),
    side: "home",
    sourceTeam: {
      defStrategy: "32Zone",
      offStrategy: "Motion",
      players: [],
      teamId: "HOME",
      teamName: "Home Club",
      ratings: [
        { key: "outsideScoring", numberValue: 12.3 },
        { key: "insideScoring", numberValue: 7.74 },
        { key: "outsideDefense", numberValue: 11.66 },
        { key: "insideDefense", numberValue: 9.328 },
        { key: "rebounding", numberValue: 8.12056 },
        { key: "offensiveFlow", numberValue: 10.4 },
      ],
      efficiency: [],
      partialScores: [],
      score: 100,
      shortName: "HOME",
      teamTotals: [],
    },
    teamLocation: "HOME",
  });

  assert.equal(applied.home_outsideDefense, 10);
  assert.equal(applied.home_rebounding, 8.497);
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
    input: {
      ...draft.input,
      away_gdp_focus: "Inside.hit",
    },
  };
  const cleared = clearForecastPrefill(edited);

  assert.equal(cleared.forecastPrefill, null);
  assert.equal(cleared.input.away_gdp_focus, "Inside.hit");
  assert.equal(cleared.input.away_gdp_pace, "N/A");
  assert.equal(cleared.input.effortDelta, 0);
});

test("reconcilePredictionDraft resets stale GDP values back to N/A", () => {
  const reconciled = reconcilePredictionDraft(
    {
      home: {
        recentMatches: [],
      },
      scout: {
        summary: null,
      },
    } as any,
    {
      input: {
        ...createDefaultManualPredictionInput(),
        away_gdp_focus: "Balanced.hit",
        away_gdp_pace: "Normal.hit",
        home_gdp_focus: "Inside.hit",
        home_gdp_pace: "Fast.hit",
      },
    },
  );

  assert.equal(reconciled.input.home_gdp_focus, "N/A");
  assert.equal(reconciled.input.home_gdp_pace, "N/A");
  assert.equal(reconciled.input.away_gdp_focus, "N/A");
  assert.equal(reconciled.input.away_gdp_pace, "N/A");
});

test("opponent effort mapping uses the fixed home-normal baseline", () => {
  assert.equal(mapOpponentEffortChoiceToRelativeDelta("Take It Easy"), 1);
  assert.equal(mapOpponentEffortChoiceToRelativeDelta("Normal"), 0);
  assert.equal(mapOpponentEffortChoiceToRelativeDelta("Crunch Time"), -1);
});

test("scalar-only legacy prediction results still parse cleanly", () => {
  const result = toPredictionResult({
    awayScore: 93.4,
    homeScore: 98.2,
    pointDiff: 4.8,
  });

  assert.deepStrictEqual(result, {
    awayScore: 93.4,
    homeScore: 98.2,
    modelVersion: "unknown",
    pointDiff: 4.8,
  });
});

test("partial grids remain renderable when at least one valid cell exists", () => {
  const grid = toPredictionTacticsGrid({
    defenses: ["ManToMan", "23Zone"],
    offenses: ["Base", "Motion"],
    cells: [
      [
        {
          awayDefense: "ManToMan",
          awayScore: 95,
          homeOffense: "Base",
          homeScore: 101,
          pointDiff: 6,
        },
      ],
      [null],
    ],
  });

  assert.ok(grid);
  assert.equal(countRenderablePredictionGridCells(grid), 1);
  assert.equal(hasRenderablePredictionGrid(grid), true);
  assert.deepStrictEqual(grid.cells[0][1], {
    awayDefense: "ManToMan",
    awayScore: null,
    homeOffense: "Motion",
    homeScore: null,
    pointDiff: null,
  });
  assert.deepStrictEqual(grid.cells[1][0], {
    awayDefense: "23Zone",
    awayScore: null,
    homeOffense: "Base",
    homeScore: null,
    pointDiff: null,
  });
  assert.deepStrictEqual(findBestPredictionGridCell(grid), {
    awayDefense: "ManToMan",
    awayScore: 95,
    homeOffense: "Base",
    homeScore: 101,
    pointDiff: 6,
  });
});

test("all-null grids are not considered renderable", () => {
  const grid = toPredictionTacticsGrid({
    defenses: ["ManToMan"],
    offenses: ["Base"],
    cells: [
      [
        {
          awayDefense: "ManToMan",
          awayScore: null,
          homeOffense: "Base",
          homeScore: null,
          pointDiff: null,
        },
      ],
    ],
  });

  assert.ok(grid);
  assert.equal(countRenderablePredictionGridCells(grid), 0);
  assert.equal(hasRenderablePredictionGrid(grid), false);
});

test("grid-enabled prediction results parse and expose the best cell", () => {
  const result = toPredictionResult({
    awayScore: 95,
    homeScore: 101,
    modelVersion: "bundle-v1",
    pointDiff: 6,
    tacticsGrid: {
      offenses: ["Base", "Motion"],
      defenses: ["ManToMan", "23Zone"],
      cells: [
        [
          {
            awayDefense: "ManToMan",
            awayScore: 95,
            homeOffense: "Base",
            homeScore: 101,
            pointDiff: 6,
          },
          {
            awayDefense: "ManToMan",
            awayScore: 94,
            homeOffense: "Motion",
            homeScore: 103,
            pointDiff: 9,
          },
        ],
        [
          {
            awayDefense: "23Zone",
            awayScore: 96,
            homeOffense: "Base",
            homeScore: 99,
            pointDiff: 3,
          },
          {
            awayDefense: "23Zone",
            awayScore: null,
            homeOffense: "Motion",
            homeScore: null,
            pointDiff: null,
          },
        ],
      ],
    },
  });

  assert.ok(result);
  assert.ok(result.tacticsGrid);
  assert.equal(result.tacticsGrid.cells[0][1].pointDiff, 9);
  assert.deepStrictEqual(findBestPredictionGridCell(result.tacticsGrid), {
    awayDefense: "ManToMan",
    awayScore: 94,
    homeOffense: "Motion",
    homeScore: 103,
    pointDiff: 9,
  });
});

test("grid selection helpers align the highlighted cell with resolved tactics", () => {
  const grid = {
    offenses: ["Base", "Motion"],
    defenses: ["ManToMan", "23Zone"],
    cells: [
      [
        {
          awayDefense: "ManToMan",
          awayScore: 95,
          homeOffense: "Base",
          homeScore: 101,
          pointDiff: 6,
        },
        {
          awayDefense: "ManToMan",
          awayScore: 94,
          homeOffense: "Motion",
          homeScore: 103,
          pointDiff: 9,
        },
      ],
      [
        {
          awayDefense: "23Zone",
          awayScore: 96,
          homeOffense: "Base",
          homeScore: 99,
          pointDiff: 3,
        },
        {
          awayDefense: "23Zone",
          awayScore: null,
          homeOffense: "Motion",
          homeScore: null,
          pointDiff: null,
        },
      ],
    ],
  };

  const selection = readPredictionGridSelection({
    away_defStrategy: "23Zone",
    home_offStrategy: "Motion",
  });

  assert.deepStrictEqual(selection, {
    awayDefense: "23Zone",
    homeOffense: "Motion",
  });
  assert.ok(selection);
  assert.equal(isPredictionGridSelectionSupported(grid, selection), true);
  assert.deepStrictEqual(findPredictionGridCell(grid, selection), {
    awayDefense: "23Zone",
    awayScore: null,
    homeOffense: "Motion",
    homeScore: null,
    pointDiff: null,
  });
});

test("press remains unsupported by the returned tactics grid", () => {
  const grid = {
    offenses: ["Base", "Motion"],
    defenses: ["ManToMan", "23Zone"],
    cells: [],
  };

  assert.equal(
    isPredictionGridSelectionSupported(grid, {
      awayDefense: "Press",
      homeOffense: "Motion",
    }),
    false,
  );
});
