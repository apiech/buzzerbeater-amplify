import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as competitionProfileTesting,
  buildOpponentCompetitionProfile,
} from "../amplify/data/_backend/opponent-competition-profile";

const TEAM_ID = "OUR";

test("buildBbstatsTotal converts team ratings into total BBStats", () => {
  assert.equal(
    competitionProfileTesting.buildBbstatsTotal({
      insideDefense: 7.6,
      insideScoring: 7.3,
      offensiveFlow: 5.0,
      outsideDefense: 6.3,
      outsideScoring: 5.3,
      rebounding: 6.0,
    }),
    113,
  );
});

test("competition profile keeps scrimmages opt-in in the default schedule view", () => {
  const profile = buildOpponentCompetitionProfile({
    availableSeasons: [72, 71],
    seasons: [
      {
        boxScores: [
          createBoxScore("rs-1", {
            effortDelta: 1,
            players: createStrongCorePlayers(),
            startTime: "2026-03-25T20:00:00Z",
            type: "league.rs",
          }),
          createBoxScore("cup-1", {
            effortDelta: 0,
            players: createMixedCorePlayers(),
            startTime: "2026-03-29T20:00:00Z",
            type: "cup.round4",
          }),
          createBoxScore("scrim-1", {
            effortDelta: 1,
            players: createStrongCorePlayers(),
            startTime: "2026-04-04T20:00:00Z",
            type: "friendly",
          }),
        ],
        matches: [
          createMatch("rs-1", {
            opponentScore: 84,
            startTime: "2026-03-25T20:00:00Z",
            teamScore: 102,
            type: "league.rs",
          }),
          createMatch("cup-1", {
            opponentScore: 88,
            startTime: "2026-03-29T20:00:00Z",
            teamScore: 95,
            type: "cup.round4",
          }),
          createMatch("scrim-1", {
            opponentScore: 79,
            startTime: "2026-04-04T20:00:00Z",
            teamScore: 97,
            type: "friendly",
          }),
        ],
        season: 72,
      },
      {
        boxScores: [
          createBoxScore("old-1", {
            effortDelta: 1,
            players: createStrongCorePlayers(),
            startTime: "2026-02-11T20:00:00Z",
            type: "league.rs",
          }),
        ],
        matches: [
          createMatch("old-1", {
            opponentScore: 81,
            startTime: "2026-02-11T20:00:00Z",
            teamScore: 98,
            type: "league.rs",
          }),
        ],
        season: 71,
      },
    ],
    selectedSeason: 72,
    teamId: TEAM_ID,
  });

  const byMatchId = new Map(profile.rows.map((row) => [row.matchId, row]));
  assert.equal(byMatchId.get("rs-1")?.seriousness, "YES");
  assert.ok(byMatchId.get("cup-1")?.seriousness);

  assert.ok(
    profile.competitionOptions.some((option) => option.key === "SCRIMMAGE"),
  );
  assert.equal(profile.selectedCompetitionKeys.includes("SCRIMMAGE"), false);
  assert.equal(profile.rows.some((row) => row.matchId === "scrim-1"), false);
});

test("forecast sample prioritizes current serious games before supporting and prior-season fallback", () => {
  const selection = competitionProfileTesting.buildForecastSample([
    {
      games: [
        createForecastGame("current-yes", {
          season: 72,
          seriousness: "YES",
          startTime: "2026-04-04T20:00:00Z",
        }),
        createForecastGame("current-maybe", {
          season: 72,
          seriousness: "MAYBE",
          startTime: "2026-04-01T20:00:00Z",
        }),
      ],
      season: 72,
    },
    {
      games: [
        createForecastGame("previous-yes", {
          season: 71,
          seriousness: "YES",
          startTime: "2026-03-01T20:00:00Z",
        }),
      ],
      season: 71,
    },
  ] as any);

  assert.deepStrictEqual(
    selection.games.map((game) => game.row.matchId),
    ["current-yes", "current-maybe", "previous-yes"],
  );
  assert.equal(
    selection.sampleStrategy,
    "CROSS_SEASON_SERIOUS_FALLBACK",
  );
  assert.equal(selection.seriousGamesConsidered, 2);
  assert.equal(selection.supportingGamesConsidered, 1);
});

test("computeSeriousnessForGame does not auto-promote playoffs without corroborating signals", () => {
  const result = competitionProfileTesting.computeSeriousnessForGame({
    boxScore: createBoxScore("po-1", {
      effortDelta: -1,
      players: createWeakCorePlayers(),
      startTime: "2026-04-02T20:00:00Z",
      type: "league.round1",
    }),
    competitionKey: "PLAYOFFS",
    coreProfile: {
      corePlayerIds: new Set([
        "core-1",
        "core-2",
        "core-3",
        "core-4",
        "core-5",
        "core-6",
        "core-7",
      ]),
      primaryStarterIds: new Set([
        "core-1",
        "core-2",
        "core-3",
        "core-4",
        "core-5",
      ]),
    },
    isTvGame: false,
    match: createMatch("po-1", {
      opponentScore: 93,
      startTime: "2026-04-02T20:00:00Z",
      teamScore: 75,
      type: "league.round1",
    }),
    teamId: TEAM_ID,
  });

  assert.equal(result.label, "NO");
  assert.equal(result.reason, "Negative effort and weak core usage");
  assert.equal(result.score, 0);
});

test("competition profile tolerates players without performance stats", () => {
  const profile = buildOpponentCompetitionProfile({
    availableSeasons: [72],
    seasons: [
      {
        boxScores: [
          createBoxScore("rs-missing-stats", {
            players: [
              createPlayerWithoutPerformanceStats("core-1", "PG", 40, true),
              createPlayerWithoutPerformanceStats("core-2", "SG", 38, true),
              createPlayerWithoutPerformanceStats("core-3", "SF", 36, true),
              createPlayerWithoutPerformanceStats("core-4", "PF", 34, true),
              createPlayerWithoutPerformanceStats("core-5", "C", 32, true),
              createPlayerWithoutPerformanceStats("core-6", "SG", 18, false),
              createPlayerWithoutPerformanceStats("core-7", "PF", 16, false),
            ],
            startTime: "2026-04-08T20:00:00Z",
            type: "league.rs",
          }),
        ],
        matches: [
          createMatch("rs-missing-stats", {
            opponentScore: 81,
            startTime: "2026-04-08T20:00:00Z",
            teamScore: 89,
            type: "league.rs",
          }),
        ],
        season: 72,
      },
    ],
    selectedSeason: 72,
    teamId: TEAM_ID,
  });

  assert.equal(profile.rows[0]?.matchId, "rs-missing-stats");
  assert.equal(profile.summary.completedGames, 1);
});

test("competition profile tolerates players without starter details or minute positions", () => {
  const profile = buildOpponentCompetitionProfile({
    availableSeasons: [72],
    seasons: [
      {
        boxScores: [
          createBoxScore("rs-missing-lineup-shape", {
            players: [
              createPlayerWithoutLineupShape("core-1"),
              createPlayerWithoutLineupShape("core-2"),
              createPlayerWithoutLineupShape("core-3"),
              createPlayerWithoutLineupShape("core-4"),
              createPlayerWithoutLineupShape("core-5"),
              createPlayerWithoutLineupShape("core-6"),
              createPlayerWithoutLineupShape("core-7"),
            ],
            startTime: "2026-04-09T20:00:00Z",
            type: "league.rs",
          }),
        ],
        matches: [
          createMatch("rs-missing-lineup-shape", {
            opponentScore: 78,
            startTime: "2026-04-09T20:00:00Z",
            teamScore: 88,
            type: "league.rs",
          }),
        ],
        season: 72,
      },
    ],
    selectedSeason: 72,
    teamId: TEAM_ID,
  });

  assert.equal(profile.rows[0]?.matchId, "rs-missing-lineup-shape");
  assert.equal(profile.summary.completedGames, 1);
});

function createMatch(
  matchId: string,
  overrides: Partial<{
    opponentScore: number;
    startTime: string;
    teamScore: number;
    type: string;
  }> = {},
) {
  return {
    id: matchId,
    startTime: overrides.startTime ?? "2026-03-01T20:00:00Z",
    type: overrides.type ?? "league.rs",
    awayTeam: {
      id: "OPP",
      score: overrides.opponentScore ?? 82,
      teamName: "Opponent Club",
    },
    homeTeam: {
      id: TEAM_ID,
      score: overrides.teamScore ?? 90,
      teamName: "Visionaries",
    },
  } as const;
}

function createBoxScore(
  matchId: string,
  overrides: Partial<{
    effortDelta: number;
    players: Array<Record<string, unknown>>;
    startTime: string;
    type: string;
  }> = {},
) {
  return {
    attendance: {},
    awayTeam: {
      defStrategy: "23Zone",
      details: {},
      efficiency: {},
      gdp: {},
      id: "OPP",
      offStrategy: "Motion",
      partialScores: [20, 20, 20, 20],
      players: [],
      ratings: {
        insideDefense: 6,
        insideScoring: 7,
        offensiveFlow: 5.5,
        outsideDefense: 6,
        outsideScoring: 6.5,
        rebounding: 5.5,
      },
      score: 82,
      shortName: "OPP",
      teamName: "Opponent Club",
      teamTotals: {},
    },
    details: {},
    effortDelta: overrides.effortDelta ?? 0,
    endTime: overrides.startTime ?? "2026-03-01T22:00:00Z",
    homeTeam: {
      defStrategy: "ManToMan",
      details: {},
      efficiency: {},
      gdp: {},
      id: TEAM_ID,
      offStrategy: "Patient",
      partialScores: [24, 24, 24, 24],
      players: overrides.players ?? createStrongCorePlayers(),
      ratings: {
        insideDefense: 7,
        insideScoring: 8,
        offensiveFlow: 6.5,
        outsideDefense: 7,
        outsideScoring: 7.5,
        rebounding: 7,
      },
      score: 96,
      shortName: "VIS",
      teamName: "Visionaries",
      teamTotals: {},
    },
    matchId,
    neutral: false,
    retrievedAt: "2026-04-11T18:00:00Z",
    startTime: overrides.startTime ?? "2026-03-01T20:00:00Z",
    type: overrides.type ?? "league.rs",
    version: "1",
  } as const;
}

function createStrongCorePlayers() {
  return [
    createPlayer("core-1", "PG", 42, true, 24),
    createPlayer("core-2", "SG", 40, true, 20),
    createPlayer("core-3", "SF", 38, true, 18),
    createPlayer("core-4", "PF", 36, true, 16),
    createPlayer("core-5", "C", 34, true, 14),
    createPlayer("core-6", "PF", 26, false, 9),
    createPlayer("core-7", "SG", 24, false, 7),
  ];
}

function createMixedCorePlayers() {
  return [
    createPlayer("core-1", "PG", 40, true, 22),
    createPlayer("core-2", "SG", 38, true, 18),
    createPlayer("core-3", "SF", 36, true, 15),
    createPlayer("alt-1", "PF", 34, true, 12),
    createPlayer("alt-2", "C", 22, true, 8),
    createPlayer("core-4", "PF", 20, false, 9),
    createPlayer("core-5", "C", 18, false, 7),
    createPlayer("core-6", "SF", 16, false, 6),
    createPlayer("core-7", "SG", 10, false, 5),
    createPlayer("alt-3", "PG", 6, false, 2),
  ];
}

function createWeakCorePlayers() {
  return [
    createPlayer("alt-1", "PG", 42, true, 20),
    createPlayer("alt-2", "SG", 40, true, 18),
    createPlayer("alt-3", "SF", 38, true, 15),
    createPlayer("alt-4", "PF", 36, true, 12),
    createPlayer("alt-5", "C", 34, true, 10),
    createPlayer("core-1", "PG", 18, false, 6),
    createPlayer("core-2", "SG", 16, false, 5),
    createPlayer("core-3", "SF", 8, false, 2),
    createPlayer("alt-6", "PF", 6, false, 1),
    createPlayer("alt-7", "C", 2, false, 0),
  ];
}

function createPlayer(
  playerId: string,
  position: string,
  minutes: number,
  isStarter: boolean,
  points: number,
) {
  return {
    details: { isStarter },
    didNotPlay: false,
    firstName: playerId,
    fullName: playerId,
    id: playerId,
    lastName: playerId,
    minutesByPosition: {
      [position]: minutes,
    },
    performanceStats: {
      ast: Math.round(points / 4),
      blk: 1,
      fga: 10,
      fgm: 5,
      fta: 2,
      ftm: 2,
      oreb: 1,
      pf: 2,
      pts: points,
      reb: Math.round(points / 3),
      stl: 1,
      to: 2,
      tpa: 3,
      tpm: 1,
    },
    ratingRaw: String(points),
    ratingValue: points,
  };
}

function createPlayerWithoutPerformanceStats(
  playerId: string,
  position: string,
  minutes: number,
  isStarter: boolean,
) {
  return {
    details: { isStarter },
    didNotPlay: false,
    firstName: playerId,
    fullName: playerId,
    id: playerId,
    lastName: playerId,
    minutesByPosition: {
      [position]: minutes,
    },
    ratingRaw: "0",
    ratingValue: 0,
  };
}

function createPlayerWithoutLineupShape(playerId: string) {
  return {
    didNotPlay: false,
    firstName: playerId,
    fullName: playerId,
    id: playerId,
    lastName: playerId,
    performanceStats: {},
    ratingRaw: "0",
    ratingValue: 0,
  };
}

function createForecastGame(
  matchId: string,
  overrides: Partial<{
    score: number;
    season: number;
    seriousness: "MAYBE" | "NO" | "YES";
    startTime: string;
  }> = {},
) {
  const seriousness = overrides.seriousness ?? "YES";
  return {
    boxScore: {
      matchId,
    },
    competitionKey: "LEAGUE_REGULAR_SEASON",
    forecastEffortDelta: seriousness === "MAYBE" ? 0 : -1,
    match: createMatch(matchId, {
      opponentScore: 80,
      startTime: overrides.startTime ?? "2026-03-01T20:00:00Z",
      teamScore: 90,
      type: "league.rs",
    }),
    row: {
      competitionKey: "LEAGUE_REGULAR_SEASON",
      competitionLabel: "League regular season",
      hasBoxscore: true,
      isTvGame: false,
      matchId,
      opponentBbStatsTotal: 90,
      opponentDefense: "23Zone",
      opponentOffense: "Motion",
      opponentScore: 80,
      opponentTeamId: "OPP",
      opponentTeamName: "Opponent Club",
      outcome: "WIN",
      season: overrides.season ?? 72,
      seriousness,
      seriousnessReason:
        seriousness === "YES" ? "Higher effort + full core" : "Mixed seriousness signals",
      seriousnessScore: seriousness === "YES" ? 0.85 : 0.5,
      stageLabel: "Regular season",
      startTime: overrides.startTime ?? "2026-03-01T20:00:00Z",
      teamBbStatsTotal: 110,
      teamDefense: "ManToMan",
      teamOffense: "Patient",
      teamScore: overrides.score ?? 90,
      venue: "HOME",
    },
    seriousness,
    seriousnessReason:
      seriousness === "YES" ? "Higher effort + full core" : "Mixed seriousness signals",
    seriousnessScore: seriousness === "YES" ? 0.85 : 0.5,
  };
}
