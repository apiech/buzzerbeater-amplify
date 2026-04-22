import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as performancesTesting,
  buildLeagueGameDayPerformancesResult,
} from "../amplify/data/_backend/league-game-day-performances";
import type {
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiBoxScoreTeam,
} from "../lib/bbapi/types";

function createPerformanceStats(
  overrides: Partial<BBApiBoxScorePlayer["performanceStats"]> = {},
): BBApiBoxScorePlayer["performanceStats"] {
  return {
    ast: 0,
    blk: 0,
    fga: 0,
    fgm: 0,
    fta: 0,
    ftm: 0,
    oreb: 0,
    pf: 0,
    pts: 0,
    reb: 0,
    stl: 0,
    to: 0,
    tpa: 0,
    tpm: 0,
    ...overrides,
  };
}

function createPlayer(args: {
  firstName: string;
  id: string;
  lastName: string;
  minutesByPosition: Record<string, number>;
  performanceStats: Partial<BBApiBoxScorePlayer["performanceStats"]>;
  ratingValue: number | null;
}): BBApiBoxScorePlayer {
  return {
    details: {},
    didNotPlay: false,
    firstName: args.firstName,
    fullName: `${args.firstName} ${args.lastName}`,
    id: args.id,
    lastName: args.lastName,
    minutesByPosition: args.minutesByPosition,
    performanceStats: createPerformanceStats(args.performanceStats),
    ratingRaw: args.ratingValue === null ? null : String(args.ratingValue),
    ratingValue: args.ratingValue,
  };
}

function createTeam(args: {
  id: string;
  name: string;
  players: BBApiBoxScorePlayer[];
  score: number;
  teamTotals: Record<string, number>;
}): BBApiBoxScoreTeam {
  return {
    defStrategy: null,
    details: {},
    efficiency: {},
    gdp: {},
    id: args.id,
    offStrategy: null,
    partialScores: [],
    players: args.players,
    ratings: null,
    score: args.score,
    shortName: null,
    teamName: args.name,
    teamTotals: args.teamTotals,
  };
}

function createBoxScore(args: {
  awayTeam: BBApiBoxScoreTeam;
  homeTeam: BBApiBoxScoreTeam;
  matchId: string;
  startTime: string;
}): BBApiBoxScore {
  return {
    attendance: {},
    awayTeam: args.awayTeam,
    details: {},
    effortDelta: 0,
    endTime: null,
    homeTeam: args.homeTeam,
    matchId: args.matchId,
    neutral: false,
    retrievedAt: "2026-04-11T00:00:00Z",
    startTime: args.startTime,
    type: "League",
    version: "1",
  };
}

function buildSamplePerformancesResult() {
  const alpha = createTeam({
    id: "alpha",
    name: "Alpha",
    players: [
      createPlayer({
        firstName: "Jules",
        id: "pg-alpha",
        lastName: "Alpha",
        minutesByPosition: { C: 0, PF: 0, PG: 38, SF: 0, SG: 0 },
        performanceStats: {
          ast: 10,
          fga: 10,
          fgm: 4,
          fta: 4,
          ftm: 4,
          oreb: 2,
          pts: 12,
          reb: 14,
          stl: 3,
          to: 2,
        },
        ratingValue: 14.5,
      }),
      createPlayer({
        firstName: "Shane",
        id: "sg-alpha",
        lastName: "Alpha",
        minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 0, SG: 36 },
        performanceStats: {
          ast: 1,
          fga: 20,
          fgm: 13,
          fta: 5,
          ftm: 4,
          oreb: 1,
          pts: 32,
          reb: 7,
          stl: 2,
          to: 1,
          tpa: 11,
          tpm: 5,
        },
        ratingValue: 17,
      }),
      createPlayer({
        firstName: "Corey",
        id: "c-alpha",
        lastName: "Alpha",
        minutesByPosition: { C: 40, PF: 0, PG: 0, SF: 0, SG: 0 },
        performanceStats: {
          ast: 4,
          fga: 15,
          fgm: 9,
          oreb: 7,
          pts: 18,
          reb: 17,
          to: 1,
        },
        ratingValue: 18,
      }),
    ],
    score: 77,
    teamTotals: {
      "3fg": 9,
      "3fga": 20,
      ast: 28,
      blk: 5,
      fg: 30,
      fga: 55,
      ft: 8,
      fta: 10,
      orb: 20,
      reb: 55,
      stl: 9,
      to: 12,
    },
  });

  const beta = createTeam({
    id: "beta",
    name: "Beta",
    players: [
      createPlayer({
        firstName: "Frank",
        id: "sf-beta",
        lastName: "Beta",
        minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 36, SG: 0 },
        performanceStats: {
          ast: 3,
          blk: 2,
          fga: 18,
          fgm: 10,
          fta: 6,
          ftm: 5,
          oreb: 1,
          pts: 27,
          reb: 8,
          stl: 3,
          to: 3,
          tpa: 6,
          tpm: 2,
        },
        ratingValue: 22,
      }),
      createPlayer({
        firstName: "Nico",
        id: "pg-beta",
        lastName: "Beta",
        minutesByPosition: { C: 0, PF: 0, PG: 40, SF: 0, SG: 0 },
        performanceStats: {
          ast: 2,
          fga: 18,
          fgm: 2,
          fta: 4,
          ftm: 2,
          pts: 6,
          reb: 6,
          stl: 1,
          to: 6,
        },
        ratingValue: 0,
      }),
    ],
    score: 66,
    teamTotals: {
      "3fg": 6,
      "3fga": 18,
      ast: 16,
      blk: 3,
      drb: 24,
      fg: 25,
      fga: 50,
      ft: 10,
      fta: 14,
      orb: 10,
      reb: 34,
      stl: 4,
      to: 17,
    },
  });

  const gamma = createTeam({
    id: "gamma",
    name: "Gamma",
    players: [
      createPlayer({
        firstName: "Paula",
        id: "pf-gamma",
        lastName: "Gamma",
        minutesByPosition: { C: 0, PF: 40, PG: 0, SF: 0, SG: 0 },
        performanceStats: {
          ast: 1,
          blk: 7,
          fga: 16,
          fgm: 9,
          fta: 6,
          ftm: 4,
          oreb: 5,
          pts: 22,
          reb: 22,
          stl: 1,
          to: 2,
        },
        ratingValue: 18.7,
      }),
      createPlayer({
        firstName: "Carter",
        id: "c-gamma",
        lastName: "Gamma",
        minutesByPosition: { C: 48, PF: 0, PG: 0, SF: 0, SG: 0 },
        performanceStats: {
          ast: 4,
          blk: 1,
          fga: 16,
          fgm: 9,
          fta: 2,
          ftm: 2,
          oreb: 4,
          pf: 6,
          pts: 18,
          reb: 15,
          stl: 1,
        },
        ratingValue: 18,
      }),
    ],
    score: 91,
    teamTotals: {
      "3fg": 12,
      "3fga": 24,
      ast: 22,
      blk: 12,
      drb: 30,
      fg: 32,
      fga: 64,
      ft: 15,
      fta: 15,
      orb: 14,
      reb: 44,
      stl: 5,
      to: 10,
    },
  });

  const delta = createTeam({
    id: "delta",
    name: "Delta",
    players: [
      createPlayer({
        firstName: "Drew",
        id: "sg-delta",
        lastName: "Delta",
        minutesByPosition: { C: 0, PF: 0, PG: 0, SF: 0, SG: 36 },
        performanceStats: {
          ast: 2,
          fga: 23,
          fgm: 13,
          fta: 15,
          ftm: 15,
          oreb: 1,
          pts: 44,
          reb: 5,
          stl: 1,
          to: 6,
          tpa: 13,
          tpm: 6,
        },
        ratingValue: 20.5,
      }),
    ],
    score: 81,
    teamTotals: {
      "3fg": 12,
      "3fga": 30,
      ast: 14,
      blk: 2,
      drb: 20,
      fg: 29,
      fga: 58,
      ft: 20,
      fta: 20,
      orb: 11,
      reb: 31,
      stl: 3,
      to: 17,
    },
  });

  return buildLeagueGameDayPerformancesResult({
    gameDate: "2026-04-11",
    gameDayNumber: 22,
    games: [
      {
        boxScore: createBoxScore({
          awayTeam: beta,
          homeTeam: alpha,
          matchId: "137828772",
          startTime: "2026-04-11T23:00:00Z",
        }),
        requestedGame: {
          awayTeamName: "Beta",
          homeTeamName: "Alpha",
          matchId: "137828772",
        },
      },
      {
        boxScore: createBoxScore({
          awayTeam: delta,
          homeTeam: gamma,
          matchId: "137828773",
          startTime: "2026-04-11T23:30:00Z",
        }),
        requestedGame: {
          awayTeamName: "Delta",
          homeTeamName: "Gamma",
          matchId: "137828773",
        },
      },
    ],
    leagueId: "100",
    leagueName: "Elite League",
    season: 71,
  });
}

function findPlayerLeaderboard(
  result: ReturnType<typeof buildSamplePerformancesResult>,
  key: string,
) {
  const leaderboard = result.playerLeaders.find((entry) => entry.key === key);
  assert.ok(leaderboard, `Expected player leaderboard ${key}.`);
  return leaderboard;
}

function findTeamLeaderboard(
  result: ReturnType<typeof buildSamplePerformancesResult>,
  key: string,
) {
  const leaderboard = result.teamLeaders.find((entry) => entry.key === key);
  assert.ok(leaderboard, `Expected team leaderboard ${key}.`);
  return leaderboard;
}

function findTopFiveSlot(
  result: ReturnType<typeof buildSamplePerformancesResult>,
  position: string,
) {
  const leaderboard = result.topFive.find((entry) => entry.position === position);
  assert.ok(leaderboard, `Expected top-five position ${position}.`);
  return leaderboard;
}

test("league game day performances compute deterministic leaders, ties, and spotlight sections", () => {
  const result = buildSamplePerformancesResult();

  assert.equal(result.leagueId, "100");
  assert.equal(result.leagueName, "Elite League");
  assert.equal(result.gameDayNumber, 22);
  assert.equal(result.gameDate, "2026-04-11");
  assert.deepStrictEqual(
    result.games.map((game) => game.matchId),
    ["137828772", "137828773"],
  );

  assert.equal(findPlayerLeaderboard(result, "points").value, 44);
  assert.deepStrictEqual(
    findPlayerLeaderboard(result, "points").leaders.map((leader) => leader.playerName),
    ["Drew Delta"],
  );
  assert.deepStrictEqual(
    findPlayerLeaderboard(result, "field-goals-made").leaders.map(
      (leader) => leader.playerName,
    ),
    ["Drew Delta", "Shane Alpha"],
  );
  assert.deepStrictEqual(
    findPlayerLeaderboard(result, "steals").leaders.map((leader) => leader.playerName),
    ["Frank Beta", "Jules Alpha"],
  );
  assert.deepStrictEqual(
    findPlayerLeaderboard(result, "turnovers").leaders.map(
      (leader) => leader.playerName,
    ),
    ["Drew Delta", "Nico Beta"],
  );
  assert.equal(findPlayerLeaderboard(result, "rating").value, 22);
  assert.equal(findPlayerLeaderboard(result, "efficiency").value, 42);

  assert.equal(findTeamLeaderboard(result, "defense").value, 66);
  assert.deepStrictEqual(
    findTeamLeaderboard(result, "defense").leaders.map((leader) => leader.teamName),
    ["Alpha"],
  );
  assert.equal(findTeamLeaderboard(result, "field-goal-percentage").value, 54.5);
  assert.deepStrictEqual(
    findTeamLeaderboard(result, "three-pointers-made").leaders.map(
      (leader) => leader.teamName,
    ),
    ["Delta", "Gamma"],
  );
  assert.deepStrictEqual(
    findTeamLeaderboard(result, "free-throw-percentage").leaders.map(
      (leader) => leader.teamName,
    ),
    ["Delta", "Gamma"],
  );
  assert.equal(findTeamLeaderboard(result, "defensive-rebounds").value, 35);
  assert.deepStrictEqual(
    findTeamLeaderboard(result, "defensive-rebounds").leaders.map(
      (leader) => leader.teamName,
    ),
    ["Alpha"],
  );
  assert.equal(findTeamLeaderboard(result, "rating").value, 49.5);
  assert.equal(findTeamLeaderboard(result, "efficiency").value, 96);

  assert.deepStrictEqual(
    findTopFiveSlot(result, "PG").leaders.map((leader) => leader.playerName),
    ["Jules Alpha"],
  );
  assert.deepStrictEqual(
    findTopFiveSlot(result, "SG").leaders.map((leader) => leader.playerName),
    ["Drew Delta"],
  );
  assert.deepStrictEqual(
    findTopFiveSlot(result, "C").leaders.map((leader) => leader.playerName),
    ["Carter Gamma", "Corey Alpha"],
  );
  assert.equal(findTopFiveSlot(result, "C").value, 32);

  assert.deepStrictEqual(
    result.mvp.leaders.map((leader) => leader.playerName),
    ["Paula Gamma"],
  );
  assert.equal(result.mvp.value, 42);
  assert.deepStrictEqual(
    result.badPerformance.leaders.map((leader) => leader.playerName),
    ["Nico Beta"],
  );
  assert.equal(result.badPerformance.value, -9);
  assert.deepStrictEqual(
    result.tripleDoubles.map((leader) => leader.playerName),
    ["Jules Alpha"],
  );

  const [turnoverCallout, foulCallout] = result.statCallouts;
  assert.ok(turnoverCallout);
  assert.equal(turnoverCallout.key, "turnovers");
  assert.deepStrictEqual(
    turnoverCallout.leaders.map((leader) => leader.playerName),
    ["Drew Delta", "Nico Beta"],
  );
  assert.ok(foulCallout);
  assert.deepStrictEqual(
    foulCallout.leaders.map((leader) => leader.playerName),
    ["Carter Gamma"],
  );
  assert.equal(result.statCallouts[2]?.value, 48);
  assert.equal(result.statCallouts[3]?.value, 6);
  assert.equal(result.statCallouts[4]?.value, 22);
  assert.equal(result.statCallouts[5]?.value, 0);
});

test("league game day performances resolve primary-position ties in PG-to-C order", () => {
  const position = performancesTesting.resolvePrimaryPosition(
    createPlayer({
      firstName: "Taylor",
      id: "utility-1",
      lastName: "Flex",
      minutesByPosition: { C: 12, PF: 12, PG: 12, SF: 12, SG: 12 },
      performanceStats: {},
      ratingValue: null,
    }),
  );

  assert.equal(position, "PG");
});
