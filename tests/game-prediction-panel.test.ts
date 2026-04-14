import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultPredictionDraft,
  reconcilePredictionDraft,
} from "../app/game-prediction-state";
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

const customOrderFixtures: PredictionMatrixTacticPair[] = [
  {
    defense: "2-3 Zone",
    estimated: false,
    offense: "Inside Isolation",
    pairId: "ii-23",
    supportTier: "DIRECT",
  },
  {
    defense: "Man to Man",
    estimated: false,
    offense: "Base Offense",
    pairId: "base-m2m",
    supportTier: "DIRECT",
  },
  {
    defense: "Outside Box + 1",
    estimated: false,
    offense: "Push the Ball",
    pairId: "ptb-obox",
    supportTier: "DIRECT",
  },
  {
    defense: "Full Court Press",
    estimated: false,
    offense: "Motion",
    pairId: "mot-fcp",
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

const overviewTeamAPairs: PredictionMatrixTacticPair[] = [
  {
    defense: "Man to Man",
    estimated: false,
    offense: "Patient",
    pairId: "overview-a-patient-m2m",
    supportTier: "DIRECT",
  },
  {
    defense: "2-3 Zone",
    estimated: false,
    offense: "Patient",
    pairId: "overview-a-patient-23",
    supportTier: "DIRECT",
  },
  {
    defense: "3-2 Zone",
    estimated: false,
    offense: "Motion",
    pairId: "overview-a-motion-32",
    supportTier: "DIRECT",
  },
] as PredictionMatrixTacticPair[];

const overviewTeamBPairs: PredictionMatrixTacticPair[] = [
  {
    defense: "Man to Man",
    estimated: false,
    offense: "Patient",
    pairId: "overview-b-patient-m2m",
    supportTier: "DIRECT",
  },
  {
    defense: "3-2 Zone",
    estimated: false,
    offense: "Patient",
    pairId: "overview-b-patient-32",
    supportTier: "DIRECT",
  },
  {
    defense: "2-3 Zone",
    estimated: false,
    offense: "Motion",
    pairId: "overview-b-motion-23",
    supportTier: "DIRECT",
  },
] as PredictionMatrixTacticPair[];

const overviewViewFixture: PredictionMatrixView = {
  label: "Expected",
  rows: [
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 6,
          predictedTeamAScore: 116,
          predictedTeamBScore: 110,
          teamAPairId: "overview-a-patient-m2m",
        },
        {
          available: true,
          predictedPointDiff: 4,
          predictedTeamAScore: 113,
          predictedTeamBScore: 109,
          teamAPairId: "overview-a-patient-23",
        },
        {
          available: true,
          predictedPointDiff: 2,
          predictedTeamAScore: 108,
          predictedTeamBScore: 106,
          teamAPairId: "overview-a-motion-32",
        },
      ],
      teamBPairId: "overview-b-patient-m2m",
    },
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 1,
          predictedTeamAScore: 104,
          predictedTeamBScore: 103,
          teamAPairId: "overview-a-patient-m2m",
        },
        {
          available: true,
          predictedPointDiff: 3,
          predictedTeamAScore: 106,
          predictedTeamBScore: 103,
          teamAPairId: "overview-a-patient-23",
        },
        {
          available: true,
          predictedPointDiff: 0,
          predictedTeamAScore: 101,
          predictedTeamBScore: 101,
          teamAPairId: "overview-a-motion-32",
        },
      ],
      teamBPairId: "overview-b-patient-32",
    },
    {
      cells: [
        {
          available: true,
          predictedPointDiff: 5,
          predictedTeamAScore: 114,
          predictedTeamBScore: 109,
          teamAPairId: "overview-a-patient-m2m",
        },
        {
          available: true,
          predictedPointDiff: 4,
          predictedTeamAScore: 112,
          predictedTeamBScore: 108,
          teamAPairId: "overview-a-patient-23",
        },
        {
          available: true,
          predictedPointDiff: 7,
          predictedTeamAScore: 118,
          predictedTeamBScore: 111,
          teamAPairId: "overview-a-motion-32",
        },
      ],
      teamBPairId: "overview-b-motion-23",
    },
  ],
  viewId: "overview",
} as PredictionMatrixView;

test("game prediction drafts default model selection to bundle default", () => {
  const draft = createDefaultPredictionDraft({
    teamAId: "team-a",
    teamAName: "Team A",
    teamBId: "team-b",
    teamBName: "Team B",
  });

  assert.equal(draft.modelKey, null);
});

test("game prediction draft reconciliation normalizes modelKey", () => {
  const reconciled = reconcilePredictionDraft(
    {
      modelKey: "  catboost  ",
    },
    createDefaultPredictionDraft({
      teamAId: "team-a",
      teamAName: "Team A",
      teamBId: "team-b",
      teamBName: "Team B",
    }),
  );

  assert.equal(reconciled.modelKey, "catboost");
});

test("prediction matrix pair sorting prioritizes offense before defense", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.sortPairs(pairFixtures).map((pair) => pair.pairId),
    ["patient-m2m", "patient-32", "rag-23"],
  );
});

test("prediction matrix pair sorting follows the requested custom tactic order", () => {
  assert.deepStrictEqual(
    gamePredictionTesting
      .sortPairs(customOrderFixtures)
      .map((pair) => pair.pairId),
    ["base-m2m", "ptb-obox", "mot-fcp", "ii-23"],
  );
});

test("prediction matrix treats legacy 'Man to man' labels as M2M for ordering and abbreviations", () => {
  const result = gamePredictionTesting.sortPairs([
    {
      defense: "3-2 Zone",
      estimated: false,
      offense: "Patient",
      pairId: "patient-32",
      supportTier: "DIRECT",
    },
    {
      defense: "Man to man",
      estimated: false,
      offense: "Patient",
      pairId: "patient-m2m-legacy",
      supportTier: "DIRECT",
    },
  ] as PredictionMatrixTacticPair[]);

  assert.deepStrictEqual(
    result.map((pair) => pair.pairId),
    ["patient-m2m-legacy", "patient-32"],
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixDefenseLabel("Man to man"),
    "M2M",
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

test("prediction matrix defense reconciliation upgrades legacy labels to canonical M2M", () => {
  assert.deepStrictEqual(
    gamePredictionTesting.reconcileSelectedDefenseOptions(
      ["3-2 Zone", "Man to man", "2-3 Zone"],
      [
        "Man to Man",
        "3-2 Zone",
        "1-3-1 Zone",
        "2-3 Zone",
        "Outside Box + 1",
        "Inside Box + 1",
        "Full Court Press",
      ],
    ),
    ["Man to Man", "3-2 Zone", "2-3 Zone"],
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

test("prediction matrix offense overview cells compute minimax over visible defenses", () => {
  const rows = gamePredictionTesting.buildOffenseOverviewRows({
    teamAPairs: overviewTeamAPairs,
    teamBPairs: overviewTeamBPairs,
    view: overviewViewFixture,
  });

  const patientVsPatient = gamePredictionTesting.findOffenseOverviewCell({
    rows,
    teamAOffense: "Patient",
    teamBOffense: "Patient",
  });

  assert.ok(patientVsPatient);
  assert.ok(patientVsPatient.result);
  assert.equal(patientVsPatient.result.teamAPair.pairId, "overview-a-patient-23");
  assert.equal(patientVsPatient.result.teamBPair.pairId, "overview-b-patient-32");
  assert.equal(patientVsPatient.result.cell.predictedPointDiff, 3);
});

test("prediction matrix offense overview rows stay offense-ordered for Team A and Team B", () => {
  const rows = gamePredictionTesting.buildOffenseOverviewRows({
    teamAPairs: overviewTeamAPairs,
    teamBPairs: overviewTeamBPairs,
    view: overviewViewFixture,
  });

  assert.deepStrictEqual(rows.map((row) => row.teamAOffense), [
    "Patient",
    "Motion",
  ]);
  assert.deepStrictEqual(
    rows[0]?.cells.map((cell) => cell.teamBOffense),
    ["Patient", "Motion"],
  );
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

test("prediction matrix uses compact tactic abbreviations in dense column headers", () => {
  assert.equal(
    gamePredictionTesting.abbreviateMatrixOffenseLabel("Run and Gun"),
    "RnG",
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixOffenseLabel("Push the Ball"),
    "PtB",
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixOffenseLabel("Outside Isolation"),
    "OI",
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixOffenseLabel("Inside Isolation"),
    "II",
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixOffenseLabel("Princeton"),
    "Prc",
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixDefenseLabel("Inside Box + 1"),
    "IBox",
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixDefenseLabel("Man to Man"),
    "M2M",
  );
  assert.equal(
    gamePredictionTesting.abbreviateMatrixDefenseLabel("Outside Box + 1"),
    "OBox",
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
