import assert from "node:assert/strict";
import test from "node:test";

import { buildArenaWorkspace } from "../amplify/data/_backend/arena-pricing";

test("arena pricing raises prices after repeated sellouts", () => {
  const matches = [
    createUpcomingHomeMatch(),
    createCompletedHomeMatch("m-3", "2026-04-10T23:00:00.000Z", "League", 101, 90, "Opp 3"),
    createCompletedHomeMatch("m-2", "2026-04-03T23:00:00.000Z", "League", 98, 87, "Opp 2"),
    createCompletedHomeMatch("m-1", "2026-03-27T23:00:00.000Z", "League", 103, 94, "Opp 1"),
  ];
  const boxScores = [
    createBoxScore("m-3", { bleachers: 100, lowerTier: 60, courtside: 20, luxury: 5 }),
    createBoxScore("m-2", { bleachers: 100, lowerTier: 60, courtside: 20, luxury: 5 }),
    createBoxScore("m-1", { bleachers: 100, lowerTier: 60, courtside: 20, luxury: 5 }),
  ];
  const snapshots = ["m-1", "m-2", "m-3"].map((matchId, index) =>
    createSnapshot(matchId, `2026-03-${20 + index}T12:00:00.000Z`, {
      bleachers: { capacity: 100, price: 10 },
      lowerTier: { capacity: 60, price: 30 },
      courtside: { capacity: 20, price: 80 },
      luxury: { capacity: 5, price: 500 },
    }),
  );

  const workspace = buildArenaWorkspace({
    referenceBoxScores: boxScores,
    referenceMatches: matches,
    snapshots,
    syncedAt: "2026-04-14T12:00:00.000Z",
    workspace: createWorkspace({
      matches,
      prices: {
        bleachers: 10,
        lowerTier: 30,
        courtside: 80,
        luxury: 500,
      },
    }),
  });

  const bleachers = findRecommendationSection(workspace, "bleachers");
  const lowerTier = findRecommendationSection(workspace, "lowerTier");

  assert.equal(bleachers.recommendedPrice, 11);
  assert.equal(lowerTier.recommendedPrice, 32);
  assert.equal(workspace.diagnostics.lowConfidenceReasons.length, 0);
});

test("arena pricing cuts weak demand and respects BB price clamps", () => {
  const matches = [
    createUpcomingHomeMatch(),
    createCompletedHomeMatch("m-weak", "2026-04-10T23:00:00.000Z", "League", 90, 101, "Opp 1"),
  ];
  const boxScores = [
    createBoxScore("m-weak", {
      bleachers: 50,
      lowerTier: 48,
      courtside: 12,
      luxury: 2,
    }),
  ];

  const workspace = buildArenaWorkspace({
    referenceBoxScores: boxScores,
    referenceMatches: matches,
    snapshots: [
      createSnapshot("m-weak", "2026-04-05T12:00:00.000Z", {
        bleachers: { capacity: 100, price: 20 },
        lowerTier: { capacity: 60, price: 35 },
        courtside: { capacity: 20, price: 50 },
        luxury: { capacity: 5, price: 400 },
      }),
    ],
    syncedAt: "2026-04-14T12:00:00.000Z",
    workspace: createWorkspace({
      matches,
      prices: {
        bleachers: 20,
        lowerTier: 35,
        courtside: 50,
        luxury: 400,
      },
    }),
  });

  assert.equal(findRecommendationSection(workspace, "bleachers").recommendedPrice, 18);
  assert.equal(findRecommendationSection(workspace, "courtside").recommendedPrice, 50);
  assert.equal(findRecommendationSection(workspace, "luxury").recommendedPrice, 400);
});

test("arena pricing applies the adjacent-section guardrail", () => {
  const matches = [
    createUpcomingHomeMatch(),
    createCompletedHomeMatch("m-guardrail", "2026-04-10T23:00:00.000Z", "League", 97, 88, "Opp 1"),
  ];
  const boxScores = [
    createBoxScore("m-guardrail", {
      bleachers: 100,
      lowerTier: 45,
      courtside: 16,
      luxury: 4,
    }),
  ];
  const workspace = buildArenaWorkspace({
    referenceBoxScores: boxScores,
    referenceMatches: matches,
    snapshots: [
      createSnapshot("m-guardrail", "2026-04-05T12:00:00.000Z", {
        bleachers: { capacity: 100, price: 15 },
        lowerTier: { capacity: 60, price: 40 },
        courtside: { capacity: 20, price: 80 },
        luxury: { capacity: 5, price: 500 },
      }),
    ],
    syncedAt: "2026-04-14T12:00:00.000Z",
    workspace: createWorkspace({
      matches,
      prices: {
        bleachers: 15,
        lowerTier: 40,
        courtside: 80,
        luxury: 500,
      },
    }),
  });

  const bleachers = findRecommendationSection(workspace, "bleachers");
  const lowerTier = findRecommendationSection(workspace, "lowerTier");

  assert.equal(bleachers.recommendedPrice, 15);
  assert.equal(bleachers.delta, 0);
  assert.match(bleachers.reason, /guardrail/i);
  assert.equal(lowerTier.recommendedPrice, 38);
  assert.equal(lowerTier.delta, -2);
});

test("arena pricing prefers an exact pregame snapshot match over a newer unrelated snapshot", () => {
  const match = createCompletedHomeMatch(
    "m-history",
    "2026-04-10T23:00:00.000Z",
    "League",
    101,
    95,
    "Opp 1",
  );
  const matches = [createUpcomingHomeMatch(), match];
  const workspace = buildArenaWorkspace({
    referenceBoxScores: [
      createBoxScore("m-history", {
        bleachers: 80,
        lowerTier: 42,
        courtside: 15,
        luxury: 3,
      }),
    ],
    referenceMatches: matches,
    snapshots: [
      createSnapshot("m-history", "2026-04-01T12:00:00.000Z", {
        bleachers: { capacity: 100, price: 9 },
        lowerTier: { capacity: 60, price: 28 },
        courtside: { capacity: 20, price: 75 },
        luxury: { capacity: 5, price: 450 },
      }),
      createSnapshot("m-other", "2026-04-09T12:00:00.000Z", {
        bleachers: { capacity: 100, price: 13 },
        lowerTier: { capacity: 60, price: 31 },
        courtside: { capacity: 20, price: 82 },
        luxury: { capacity: 5, price: 510 },
      }),
    ],
    syncedAt: "2026-04-14T12:00:00.000Z",
    workspace: createWorkspace({
      matches,
      prices: {
        bleachers: 12,
        lowerTier: 30,
        courtside: 80,
        luxury: 500,
      },
    }),
  });

  const bleachers = findRecentSection(workspace, "m-history", "bleachers");
  assert.equal(bleachers.price, 9);
  assert.equal(bleachers.usedMatchedSnapshot, true);
});

test("arena pricing surfaces low-confidence reasons when history is sparse", () => {
  const matches = [
    createUpcomingHomeMatch(),
    createCompletedHomeMatch("m-solo", "2026-04-10T23:00:00.000Z", "Cup", 96, 91, "Cup Opp"),
  ];
  const workspace = buildArenaWorkspace({
    referenceBoxScores: [
      createBoxScore("m-solo", {
        bleachers: 80,
        lowerTier: 40,
        courtside: 14,
        luxury: 3,
      }),
    ],
    referenceMatches: matches,
    snapshots: [],
    syncedAt: "2026-04-14T12:00:00.000Z",
    workspace: createWorkspace({
      matches,
      prices: {
        bleachers: 12,
        lowerTier: 30,
        courtside: 80,
        luxury: 500,
      },
      nextMatchType: "Cup",
    }),
  });

  assert.match(
    workspace.diagnostics.lowConfidenceReasons.join(" "),
    /Fewer than three recent home games/i,
  );
  assert.match(
    workspace.diagnostics.lowConfidenceReasons.join(" "),
    /snapshots are sparse/i,
  );
});

function createWorkspace(args: {
  matches: Record<string, unknown>[];
  nextMatchType?: string;
  prices: Record<"bleachers" | "lowerTier" | "courtside" | "luxury", number>;
}) {
  return {
    teamInfo: {
      teamId: "team-1",
    },
    schedule: {
      matches: args.matches,
    },
    arena: {
      name: "Vision Dome",
      seats: {
        bleachers: { capacity: 100, price: args.prices.bleachers, nextPrice: args.prices.bleachers },
        lowerTier: { capacity: 60, price: args.prices.lowerTier, nextPrice: args.prices.lowerTier },
        courtside: { capacity: 20, price: args.prices.courtside, nextPrice: args.prices.courtside },
        luxury: { capacity: 5, price: args.prices.luxury, nextPrice: args.prices.luxury },
      },
      expansion: null,
    },
    economy: {
      fields: {
        cash: 100000,
        availableBalance: 85000,
      },
      transactions: [],
    },
  } as any;
}

function createUpcomingHomeMatch(type = "League") {
  return {
    id: "m-next-home",
    startTime: "2026-04-20T23:00:00.000Z",
    type,
    homeTeam: {
      id: "team-1",
      teamName: "Visionaries",
      score: null,
    },
    awayTeam: {
      id: "opp-next",
      teamName: "Next Opponent",
      score: null,
    },
  };
}

function createCompletedHomeMatch(
  id: string,
  startTime: string,
  type: string,
  homeScore: number,
  awayScore: number,
  opponentTeamName: string,
) {
  return {
    id,
    startTime,
    type,
    homeTeam: {
      id: "team-1",
      teamName: "Visionaries",
      score: homeScore,
    },
    awayTeam: {
      id: `opp-${id}`,
      teamName: opponentTeamName,
      score: awayScore,
    },
  };
}

function createBoxScore(
  matchId: string,
  attendance: Record<"bleachers" | "lowerTier" | "courtside" | "luxury", number>,
) {
  return {
    matchId,
    attendance,
  } as any;
}

function createSnapshot(
  nextHomeMatchId: string,
  capturedAt: string,
  seats: Record<
    "bleachers" | "lowerTier" | "courtside" | "luxury",
    { capacity: number; price: number }
  >,
) {
  return {
    userId: "user-1",
    capturedAt,
    nextHomeMatchId,
    nextHomeMatchStartTime: "2026-04-10T23:00:00.000Z",
    arenaName: "Vision Dome",
    seats: Object.entries(seats).map(([section, seat]) => ({
      section,
      capacity: seat.capacity,
      price: seat.price,
      nextPrice: seat.price,
      minPrice: 0,
      maxPrice: 0,
    })),
    expansion: null,
    cash: 100000,
    availableBalance: 85000,
    transactions: [],
  } as any;
}

function findRecommendationSection(
  workspace: ReturnType<typeof buildArenaWorkspace>,
  section: "bleachers" | "lowerTier" | "courtside" | "luxury",
) {
  const entry = workspace.recommendation?.sections.find(
    (candidate) => candidate.section === section,
  );
  if (!entry) {
    assert.fail(`Expected recommendation for section ${section}.`);
  }
  return entry;
}

function findRecentSection(
  workspace: ReturnType<typeof buildArenaWorkspace>,
  matchId: string,
  section: "bleachers" | "lowerTier" | "courtside" | "luxury",
) {
  const game = workspace.recentHomeGames.find((candidate) => candidate.matchId === matchId);
  if (!game) {
    assert.fail(`Expected recent home game ${matchId}.`);
  }

  const entry = game.sections.find((candidate) => candidate.section === section);
  if (!entry) {
    assert.fail(`Expected recent section ${section} for match ${matchId}.`);
  }

  return entry;
}
