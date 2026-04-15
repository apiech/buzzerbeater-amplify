import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __testing as recommendationTesting } from "../amplify/data/_backend/next-game-recommendation";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const nextGameRecommendationJobsSource = readFileSync(
  join(repoRoot, "amplify", "_backend", "next-game-recommendation-jobs.ts"),
  "utf8",
);
const nextGameRecommendationWorkerResourceSource = readFileSync(
  join(repoRoot, "amplify", "next-game-recommendation-worker", "resource.ts"),
  "utf8",
);

test("normalizeRecommendationInput defaults enthusiasm and validates switch mappings", () => {
  assert.deepStrictEqual(
    recommendationTesting.normalizeRecommendationInput({
      excludedPlayerIds: ["p2", "p1", "p2"],
      defensiveSwitch: {
        c: "c",
        pf: "pf",
        pg: "pg",
        sf: "sf",
        sg: "sg",
      },
    }),
    {
      excludedPlayerIds: ["p1", "p2"],
      enthusiasm: 8,
      defensiveSwitch: {
        pg: "PG",
        sg: "SG",
        sf: "SF",
        pf: "PF",
        c: "C",
      },
    },
  );

  assert.throws(
    () =>
      recommendationTesting.normalizeRecommendationInput({
        enthusiasm: 11,
        defensiveSwitch: {
          pg: "PG",
          sg: "PG",
          sf: "SF",
          pf: "PF",
          c: "C",
        },
      }),
    /one-to-one mapping/i,
  );
});

test("normalizeExcludedPlayerIds sorts and dedupes recommendation exclusions", () => {
  assert.deepStrictEqual(
    recommendationTesting.normalizeExcludedPlayerIds([" p3 ", "p1", "p3", ""]),
    ["p1", "p3"],
  );
});

test("effortChoiceToOrdinal maps take-it-easy, normal, and crunch-time labels", () => {
  assert.equal(recommendationTesting.effortChoiceToOrdinal("Take It Easy"), -1);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("TIE"), -1);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("Normal"), 0);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("CT"), 1);
  assert.equal(recommendationTesting.effortChoiceToOrdinal("Crunch Time"), 1);
});

test("next-game recommendation worker keeps lineup-helper snapshot prerequisites", () => {
  assert.match(
    nextGameRecommendationWorkerResourceSource,
    /buildBbConnectionSecretFunctionEnvironment/,
  );
  assert.match(nextGameRecommendationWorkerResourceSource, /memoryMB:\s*3072/);
  assert.match(
    nextGameRecommendationJobsSource,
    /PLAYER_SKILL_SNAPSHOT_TABLE_NAME/,
  );
  assert.match(
    nextGameRecommendationJobsSource,
    /playerSkillSnapshotTable\.grantReadData/,
  );
  assert.doesNotMatch(
    nextGameRecommendationJobsSource,
    /ACTIVE_TRACKED_TEAMS_TABLE_NAME/,
  );
});

test("next-game recommendation statuses normalize legacy and granular worker phases", () => {
  assert.equal(
    recommendationTesting.normalizeRecommendationStatus("PREPARING_INPUTS"),
    "PREPARING_INPUTS",
  );
  assert.equal(
    recommendationTesting.normalizeRecommendationStatus("EVALUATING_CANDIDATES"),
    "EVALUATING_CANDIDATES",
  );
  assert.equal(
    recommendationTesting.normalizeRecommendationStatus("RESOLVING_CONTEXT"),
    "RESOLVING_CONTEXT",
  );
  assert.equal(
    recommendationTesting.normalizeRecommendationStatus("OPTIMIZING_LINEUPS"),
    "OPTIMIZING_LINEUPS",
  );
  assert.equal(
    recommendationTesting.normalizeRecommendationStatus("SCORING_MATCHUPS"),
    "SCORING_MATCHUPS",
  );
  assert.equal(
    recommendationTesting.normalizeRecommendationStatus("BUILDING_PLANNER"),
    "BUILDING_PLANNER",
  );
  assert.equal(
    recommendationTesting.normalizeRecommendationStatus("mystery"),
    "FAILED",
  );
});

test("next-game recommendation worker persists granular progress phases in order", () => {
  const source = readFileSync(
    join(
      repoRoot,
      "amplify",
      "data",
      "_backend",
      "next-game-recommendation.ts",
    ),
    "utf8",
  );

  assert.match(source, /status: "RESOLVING_CONTEXT"/);
  assert.match(source, /status: "OPTIMIZING_LINEUPS"/);
  assert.match(source, /status: "SCORING_MATCHUPS"/);
  assert.match(source, /status: "BUILDING_PLANNER"/);
  assert.ok(
    source.indexOf('status: "RESOLVING_CONTEXT"') <
      source.indexOf('status: "OPTIMIZING_LINEUPS"') &&
      source.indexOf('status: "OPTIMIZING_LINEUPS"') <
        source.indexOf('status: "SCORING_MATCHUPS"') &&
      source.indexOf('status: "SCORING_MATCHUPS"') <
        source.indexOf('status: "BUILDING_PLANNER"'),
  );
});

test("next-game recommendation progress records completed phases and preserves the failed phase index", () => {
  const queued = recommendationTesting.normalizeRecommendationProgress(null, {
    completedAt: null,
    error: null,
    requestJson: {
      excludedPlayerIds: ["p1"],
    },
    requestedAt: "2026-04-14T17:51:33.000Z",
    resultJson: null,
    startedAt: null,
    status: "QUEUED",
  } as any);

  const resolving = recommendationTesting.advanceRecommendationProgress({
    currentProgress: queued,
    currentPhaseStartedAt: "2026-04-14T17:51:35.000Z",
    nextPhaseKey: "RESOLVING_CONTEXT",
    summary: "Resolving workspace, forecast, and source match context.",
    updatedAt: "2026-04-14T17:51:35.000Z",
  });
  const optimizing = recommendationTesting.advanceRecommendationProgress({
    completedUnits: 10,
    currentProgress: resolving,
    currentPhaseStartedAt: "2026-04-14T17:51:41.000Z",
    nextPhaseKey: "OPTIMIZING_LINEUPS",
    summary: recommendationTesting.buildLineupOptimizationSummary(10, 70),
    totalUnits: 70,
    unitLabel: "tactic pairs",
    updatedAt: "2026-04-14T17:51:41.000Z",
  });
  const failed = recommendationTesting.buildFailedRecommendationProgress({
    currentProgress: optimizing,
    errorMessage: "No usable opponent source boxscore with ratings is available yet.",
    updatedAt: "2026-04-14T17:51:45.000Z",
  });

  assert.deepStrictEqual(
    optimizing.completedPhases.map((phase) => phase.phaseKey),
    ["RESOLVING_CONTEXT"],
  );
  assert.equal(optimizing.completedPhases[0]?.durationMs, 6000);
  assert.equal(optimizing.phaseIndex, 2);
  assert.equal(optimizing.completedUnits, 10);
  assert.equal(optimizing.totalUnits, 70);
  assert.equal(failed.phaseKey, "FAILED");
  assert.equal(failed.phaseIndex, 2);
  assert.equal(
    failed.summary,
    "No usable opponent source boxscore with ratings is available yet.",
  );
});

test("next-game recommendation latest lookup uses explicit ids instead of recomputing context", () => {
  const source = readFileSync(
    join(
      repoRoot,
      "amplify",
      "data",
      "_backend",
      "next-game-recommendation.ts",
    ),
    "utf8",
  );
  const getLatestSection = source.slice(
    source.indexOf("export async function getLatestNextGameRecommendation"),
    source.indexOf("export async function getNextGamePlannerDetail"),
  );

  assert.match(getLatestSection, /forecastJobId: unknown/);
  assert.match(getLatestSection, /matchId: unknown/);
  assert.match(getLatestSection, /opponentTeamId: unknown/);
  assert.match(getLatestSection, /get_latest\.received/);
  assert.doesNotMatch(getLatestSection, /resolveRecommendationContext/);
  assert.doesNotMatch(getLatestSection, /resolveLatestForecastContext/);
  assert.doesNotMatch(getLatestSection, /resolveOpponentSourceContext/);
});

test("next-game recommendation worker emits structured progress diagnostics", () => {
  const source = readFileSync(
    join(
      repoRoot,
      "amplify",
      "data",
      "_backend",
      "next-game-recommendation.ts",
    ),
    "utf8",
  );

  assert.match(source, /process\.status_transition/);
  assert.match(source, /process\.context\.ready/);
  assert.match(source, /process\.lineup_optimization\.progress/);
  assert.match(source, /process\.lineup_optimization\.completed/);
  assert.match(source, /process\.planner\.request\.ready/);
  assert.match(source, /process\.planner\.response\.ready/);
  assert.match(source, /process\.planner\.batch\.completed/);
  assert.match(source, /optimizeLineupHelperBatch/);
  assert.match(source, /invokePlannerRequests/);
  assert.match(source, /progressJson/);
});

test("estimated tactics stay first-class in predictor payloads and use lineup-only fallback mappings", () => {
  const perspective = recommendationTesting.buildPredictorPerspective({
    opponentDefense: "ManToMan",
    opponentEffort: 0,
    opponentOffense: "Motion",
    opponentRatings: {
      outsideScoring: 7,
      insideScoring: 8,
      outsideDefense: 9,
      insideDefense: 10,
      rebounding: 11,
      offensiveFlow: 12,
    },
    ourDefense: "InsideBoxAndOne",
    ourEffort: 0,
    ourIsHome: true,
    ourOffense: "InsideIsolation",
    ourRatings: {
      outsideScoring: 1,
      insideScoring: 2,
      outsideDefense: 3,
      insideDefense: 4,
      rebounding: 5,
      offensiveFlow: 6,
    },
  });

  assert.equal(perspective.payload.home_offStrategy, "InsideIsolation");
  assert.equal(perspective.payload.home_defStrategy, "InsideBoxAndOne");

  const source = readFileSync(
    join(
      repoRoot,
      "amplify",
      "data",
      "_backend",
      "next-game-recommendation.ts",
    ),
    "utf8",
  );
  assert.match(
    source,
    /case "InsideIsolation":[\s\S]*?return "Base Offense";/,
  );
  assert.match(
    source,
    /case "OutsideIsolation":[\s\S]*?return "Base Offense";/,
  );
  assert.match(
    source,
    /case "InsideBoxAndOne":[\s\S]*?return "Man to man";/,
  );
  assert.match(
    source,
    /case "OutsideBoxAndOne":[\s\S]*?return "Man to man";/,
  );
});

test("buildPredictorPerspective flips home-away orientation for away games", () => {
  const perspective = recommendationTesting.buildPredictorPerspective({
    opponentDefense: "ManToMan",
    opponentEffort: 1,
    opponentOffense: "Motion",
    opponentRatings: {
      outsideScoring: 6,
      insideScoring: 7,
      outsideDefense: 8,
      insideDefense: 9,
      rebounding: 10,
      offensiveFlow: 11,
    },
    ourDefense: "23Zone",
    ourEffort: -1,
    ourIsHome: false,
    ourOffense: "Base",
    ourRatings: {
      outsideScoring: 1,
      insideScoring: 2,
      outsideDefense: 3,
      insideDefense: 4,
      rebounding: 5,
      offensiveFlow: 6,
    },
  });

  assert.equal(perspective.teamIsHome, false);
  assert.equal(perspective.payload.home_offStrategy, "Motion");
  assert.equal(perspective.payload.away_offStrategy, "Base");
  assert.equal(perspective.payload.effortDelta, 2);
  assert.equal(perspective.payload.home_outsideScoring, 6);
  assert.equal(perspective.payload.away_outsideScoring, 1);
});

test("adaptPredictionResultToUserPerspective flips away-game margin and scores", () => {
  assert.deepStrictEqual(
    recommendationTesting.adaptPredictionResultToUserPerspective(
      {
        awayScore: 91.2,
        homeScore: 101.4,
        pointDiff: 10.2,
      },
      false,
    ),
    {
      predictedOpponentScore: 101.4,
      predictedPointDiff: -10.2,
      predictedTeamScore: 91.2,
    },
  );
});

test("candidate selection prefers biggest win and efficient 10-point win", () => {
  const candidates = [
    createCandidate("Base Offense", "Man to man", "Normal", 12.2, 108, 95, 1),
    createCandidate("Motion", "2-3 Zone", "Take It Easy", 10.1, 102, 91.9, 0),
    createCandidate(
      "Run and Gun",
      "Full Court Press",
      "Crunch Time",
      15.4,
      111,
      95.6,
      2,
    ),
  ];

  assert.equal(
    recommendationTesting.selectBiggestWinCandidate(candidates)?.offense,
    "Run and Gun",
  );
  assert.equal(
    recommendationTesting.selectEfficientWinCandidate(candidates)?.offense,
    "Motion",
  );
});

test("efficient selection falls back to smallest positive win, then least-bad margin", () => {
  const noTenPointWin = [
    createCandidate("Base Offense", "Man to man", "Normal", 8.9, 101, 92.1, 1),
    createCandidate("Motion", "2-3 Zone", "Take It Easy", 3.2, 96.5, 93.3, 0),
  ];
  assert.equal(
    recommendationTesting.selectEfficientWinCandidate(noTenPointWin)?.offense,
    "Motion",
  );

  const noPositiveWin = [
    createCandidate("Base Offense", "Man to man", "Normal", -6.4, 90, 96.4, 1),
    createCandidate("Motion", "2-3 Zone", "Take It Easy", -2.1, 91.4, 93.5, 0),
  ];
  assert.equal(
    recommendationTesting.selectEfficientWinCandidate(noPositiveWin)?.offense,
    "Motion",
  );
});

test("jobMatchesRecommendationSettings and stale detection use exact persisted settings", () => {
  assert.equal(
    recommendationTesting.jobMatchesRecommendationSettings(
      {
        enthusiasm: 8,
        matchId: "m-1",
        opponentTeamId: "opp-1",
        requestJson: {
          excludedPlayerIds: ["p1", "p2"],
        },
        switchC: "C",
        switchPf: "PF",
        switchPg: "PG",
        switchSf: "SF",
        switchSg: "SG",
      },
      {
        excludedPlayerIds: ["p2", "p1", "p2"],
        enthusiasm: 8,
        matchId: "m-1",
        opponentTeamId: "opp-1",
        defensiveSwitch: {
          pg: "PG",
          sg: "SG",
          sf: "SF",
          pf: "PF",
          c: "C",
        },
      },
    ),
    true,
  );
  assert.equal(
    recommendationTesting.jobMatchesRecommendationSettings(
      {
        enthusiasm: 8,
        matchId: "m-1",
        opponentTeamId: "opp-1",
        requestJson: {
          excludedPlayerIds: ["p9"],
        },
        switchC: "C",
        switchPf: "PF",
        switchPg: "PG",
        switchSf: "SF",
        switchSg: "SG",
      },
      {
        excludedPlayerIds: ["p1"],
        enthusiasm: 8,
        matchId: "m-1",
        opponentTeamId: "opp-1",
        defensiveSwitch: {
          pg: "PG",
          sg: "SG",
          sf: "SF",
          pf: "PF",
          c: "C",
        },
      },
    ),
    false,
  );
  assert.equal(
    recommendationTesting.computeRecommendationStale(
      "forecast-1",
      "forecast-2",
    ),
    true,
  );
  assert.equal(
    recommendationTesting.computeRecommendationStale(
      "forecast-2",
      "forecast-2",
    ),
    false,
  );
});

function createCandidate(
  offense: string,
  defense: string,
  effortChoice: string,
  predictedPointDiff: number,
  predictedTeamScore: number,
  predictedOpponentScore: number,
  effortCost: number,
) {
  return {
    offense,
    defense,
    effortChoice,
    effortCost,
    effortValue: effortCost - 1,
    lineup: [
      {
        playerId: "p1",
        fullName: "Lead Guard",
        position: "PG",
        minutes: 36,
      },
    ],
    weightedExpectedPointDiff: predictedPointDiff,
    floorPointDiff: predictedPointDiff,
    ceilingPointDiff: predictedPointDiff,
    winProbability: predictedPointDiff > 0 ? 1 : 0,
    scenarioResults: [],
    predictedPointDiff,
    predictedTeamScore,
    predictedOpponentScore,
  };
}
