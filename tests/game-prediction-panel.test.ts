import assert from "node:assert/strict";
import test from "node:test";

import { __testing as gamePredictionTesting } from "../app/game-prediction-panel";
import type {
  PredictionMatrixTacticPair,
  PredictionMatrixView,
} from "../app/types";

const pairFixtures: PredictionMatrixTacticPair[] = [
  {
    defense: "3-2 Zone",
    estimated: false,
    offense: "Patient",
    pairId: "patient-32",
    supportTier: "DIRECT",
  },
  {
    defense: "2-3 Zone",
    estimated: false,
    offense: "Run and Gun",
    pairId: "rag-23",
    supportTier: "DIRECT",
  },
  {
    defense: "Man to Man",
    estimated: false,
    offense: "Patient",
    pairId: "patient-m2m",
    supportTier: "DIRECT",
  },
] as PredictionMatrixTacticPair[];

const teamAPairs: PredictionMatrixTacticPair[] = [
  {
    defense: "Man to Man",
    estimated: false,
    offense: "Patient",
    pairId: "a-patient-m2m",
    supportTier: "DIRECT",
  },
  {
    defense: "2-3 Zone",
    estimated: false,
    offense: "Run and Gun",
    pairId: "a-rag-23",
    supportTier: "DIRECT",
  },
] as PredictionMatrixTacticPair[];

const teamBPairs: PredictionMatrixTacticPair[] = [
  {
    defense: "3-2 Zone",
    estimated: false,
    offense: "Patient",
    pairId: "b-patient-32",
    supportTier: "DIRECT",
  },
  {
    defense: "Man to Man",
    estimated: false,
    offense: "Motion",
    pairId: "b-motion-m2m",
    supportTier: "DIRECT",
  },
] as PredictionMatrixTacticPair[];

const viewFixture: PredictionMatrixView = {
  label: "Expected",
  rows: [
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 6,
          predictedTeamAScore: 118,
          predictedTeamBScore: 112,
          teamAPairId: "a-patient-m2m",
        },
        {
          available: true,
          predictedPointDiff: -4,
          predictedTeamAScore: 109,
          predictedTeamBScore: 113,
          teamAPairId: "a-rag-23",
        },
      ],
      teamBPairId: "b-patient-32",
    },
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 8,
          predictedTeamAScore: 121,
          predictedTeamBScore: 113,
          teamAPairId: "a-patient-m2m",
        },
        {
          available: true,
          predictedPointDiff: -7,
          predictedTeamAScore: 108,
          predictedTeamBScore: 115,
          teamAPairId: "a-rag-23",
        },
      ],
      teamBPairId: "b-motion-m2m",
    },
  ],
  viewId: "expected",
} as PredictionMatrixView;

const minimaxAverageTieViewFixture: PredictionMatrixView = {
  label: "Expected",
  rows: [
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 2,
          predictedTeamAScore: 102,
          predictedTeamBScore: 100,
          teamAPairId: "a-rag-23",
        },
        {
          available: true,
          predictedPointDiff: 2,
          predictedTeamAScore: 103,
          predictedTeamBScore: 101,
          teamAPairId: "a-patient-m2m",
        },
      ],
      teamBPairId: "b-patient-32",
    },
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 5,
          predictedTeamAScore: 115,
          predictedTeamBScore: 110,
          teamAPairId: "a-rag-23",
        },
        {
          available: true,
          predictedPointDiff: 6,
          predictedTeamAScore: 116,
          predictedTeamBScore: 110,
          teamAPairId: "a-patient-m2m",
        },
      ],
      teamBPairId: "b-motion-m2m",
    },
  ],
  viewId: "expected-average",
} as PredictionMatrixView;

const minimaxStableTieViewFixture: PredictionMatrixView = {
  label: "Expected",
  rows: [
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 4,
          predictedTeamAScore: 104,
          predictedTeamBScore: 100,
          teamAPairId: "a-patient-m2m",
        },
        {
          available: true,
          predictedPointDiff: 4,
          predictedTeamAScore: 104,
          predictedTeamBScore: 100,
          teamAPairId: "a-rag-23",
        },
      ],
      teamBPairId: "b-patient-32",
    },
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 4,
          predictedTeamAScore: 104,
          predictedTeamBScore: 100,
          teamAPairId: "a-patient-m2m",
        },
        {
          available: true,
          predictedPointDiff: 4,
          predictedTeamAScore: 104,
          predictedTeamBScore: 100,
          teamAPairId: "a-rag-23",
        },
      ],
      teamBPairId: "b-motion-m2m",
    },
  ],
  viewId: "expected-stable",
} as PredictionMatrixView;

test("prediction matrix pair sorting prioritizes offense before defense", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.sortPairs(pairFixtures).map((pair) => pair.pairId),
    ["patient-m2m", "patient-32", "rag-23"],
  );
});

test("prediction matrix builds offense groups with expansion state", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.buildOffenseGroups({
      expandedOffenses: ["Patient"],
      pairs: pairFixtures,
    }).map((group) => ({
      expanded: group.expanded,
      offense: group.offense,
      pairIds: group.pairs.map((pair) => pair.pairId),
    })),
    [
      {
        expanded: true,
        offense: "Patient",
        pairIds: ["patient-m2m", "patient-32"],
      },
      {
        expanded: false,
        offense: "Run and Gun",
        pairIds: ["rag-23"],
      },
    ],
  );
});

test("prediction matrix defense filters keep only the chosen defenses", () => {
  assert.deepStrictEqual(
    gamePredictionTesting
      .filterPairsByDefenses({
        enabledDefenses: ["Man to Man"],
        pairs: pairFixtures,
      })
      .map((pair) => pair.pairId),
    ["patient-m2m"],
  );
});

test("prediction matrix selection reconciliation falls back to all options when overlap disappears", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.reconcileSelectedOptions(["Motion"], [
      "Patient",
      "Run and Gun",
    ]),
    ["Patient", "Run and Gun"],
  );
});

test("prediction matrix defense toggles do not allow every visible option to disappear", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.toggleRequiredOption(["Patient"], "Patient", [
      "Patient",
      "Run and Gun",
    ]),
    ["Patient"],
  );
});

test("prediction matrix offense disclosures do not allow the final visible group to collapse", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.toggleExpandedOffense(["Patient"], "Patient", [
      "Patient",
      "Run and Gun",
    ]),
    ["Patient"],
  );
});

test("prediction matrix selection defaults to the recommendation when nothing is inspected yet", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.resolveVisibleSelection({
      currentTeamAPairId: null,
      currentTeamBPairId: null,
      recommendedTeamAPairId: "a-patient-m2m",
      recommendedTeamBPairId: "b-patient-32",
      teamAPairs,
      teamBPairs,
      view: viewFixture,
    }),
    {
      teamAPairId: "a-patient-m2m",
      teamBPairId: "b-patient-32",
    },
  );
});

test("prediction matrix selection falls back to the first visible cell in reading order when the inspected cell is hidden", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.resolveVisibleSelection({
      currentTeamAPairId: "missing-team-a",
      currentTeamBPairId: "missing-team-b",
      recommendedTeamAPairId: "a-patient-m2m",
      recommendedTeamBPairId: "b-patient-32",
      teamAPairs: [teamAPairs[1]],
      teamBPairs,
      view: viewFixture,
    }),
    {
      teamAPairId: "a-rag-23",
      teamBPairId: "b-patient-32",
    },
  );
});

test("prediction matrix minimax recommendation picks the best worst-case visible matchup", () => {
  const result = gamePredictionTesting.findMinimaxVisibleResult({
    teamAPairs,
    teamBPairs,
    view: viewFixture,
  });

  assert.ok(result);
  assert.equal(result.teamAPair.pairId, "a-patient-m2m");
  assert.equal(result.teamBPair.pairId, "b-patient-32");
  assert.equal(result.cell.predictedPointDiff, 6);
});

test("prediction matrix minimax recommendation breaks Team A ties with higher average margin", () => {
  const result = gamePredictionTesting.findMinimaxVisibleResult({
    teamAPairs: [teamAPairs[1], teamAPairs[0]],
    teamBPairs,
    view: minimaxAverageTieViewFixture,
  });

  assert.ok(result);
  assert.equal(result.teamAPair.pairId, "a-patient-m2m");
  assert.equal(result.teamBPair.pairId, "b-patient-32");
  assert.equal(result.cell.predictedPointDiff, 2);
});

test("prediction matrix minimax recommendation keeps stable tactic ordering for tied Team A and Team B options", () => {
  const result = gamePredictionTesting.findMinimaxVisibleResult({
    teamAPairs,
    teamBPairs,
    view: minimaxStableTieViewFixture,
  });

  assert.ok(result);
  assert.equal(result.teamAPair.pairId, "a-patient-m2m");
  assert.equal(result.teamBPair.pairId, "b-patient-32");
  assert.equal(result.cell.predictedPointDiff, 4);
});

test("prediction matrix best and worst helpers honor the active visible pairs only", () => {
  const teamAPairIds = new Set(["a-rag-23"]);
  const teamBPairIds = new Set(["b-patient-32", "b-motion-m2m"]);

  const best = gamePredictionTesting.findExtremeVisibleCell({
    comparator: (candidate, current) => candidate > current,
    teamAPairIds,
    teamAPairs,
    teamBPairIds,
    teamBPairs,
    view: viewFixture,
  });
  const worst = gamePredictionTesting.findExtremeVisibleCell({
    comparator: (candidate, current) => candidate < current,
    teamAPairIds,
    teamAPairs,
    teamBPairIds,
    teamBPairs,
    view: viewFixture,
  });

  assert.ok(best);
  assert.ok(worst);
  assert.equal(best.teamAPair.pairId, "a-rag-23");
  assert.equal(best.teamBPair.pairId, "b-patient-32");
  assert.equal(best.cell.predictedPointDiff, -4);
  assert.equal(worst.teamAPair.pairId, "a-rag-23");
  assert.equal(worst.teamBPair.pairId, "b-motion-m2m");
  assert.equal(worst.cell.predictedPointDiff, -7);
});

test("prediction matrix lookup resolves cells by Team A row and Team B column ids", () => {
  const cell = gamePredictionTesting.findSelectedCell({
    teamAPairId: "a-rag-23",
    teamBPairId: "b-patient-32",
    view: viewFixture,
  });

  assert.ok(cell);
  assert.equal(cell.predictedPointDiff, -4);
  assert.equal(cell.predictedTeamAScore, 109);
  assert.equal(cell.predictedTeamBScore, 113);
});

test("prediction matrix compact cell labels use a dash for unavailable cells", () => {
  assert.equal(
    gamePredictionTesting.formatCompactCellMargin({
      available: false,
      teamAPairId: "a-rag-23",
    }),
    "—",
  );
  assert.equal(
    gamePredictionTesting.formatCompactCellMargin({
      available: true,
      predictedPointDiff: 6,
      teamAPairId: "a-patient-m2m",
    }),
    "+6.0",
  );
});

test("prediction matrix heatmap levels clamp negative and positive margins", () => {
  assert.equal(
    gamePredictionTesting.getPredictionCellHeatmapLevel({
      available: true,
      predictedPointDiff: -40,
      teamAPairId: "a-rag-23",
    }),
    -1,
  );
  assert.equal(
    gamePredictionTesting.getPredictionCellHeatmapLevel({
      available: true,
      predictedPointDiff: 10,
      teamAPairId: "a-rag-23",
    }),
    0.5,
  );
  assert.equal(
    gamePredictionTesting.getPredictionCellHeatmapLevel({
      available: true,
      predictedPointDiff: 40,
      teamAPairId: "a-rag-23",
    }),
    1,
  );
  assert.equal(
    gamePredictionTesting.getPredictionCellHeatmapLevel({
      available: false,
      teamAPairId: "a-rag-23",
    }),
    null,
  );
});
