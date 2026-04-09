import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompetitiveRecentSample,
  type CompetitiveSampleIncludedGame,
  type CompetitiveRecentSample,
} from "../amplify/data/_backend/match-importance";
import type {
  BBApiBoxScore,
  BBApiBoxScorePlayer,
  BBApiScheduleMatch,
} from "../lib/bbapi";
import { resolveBuzzerBeaterNumericValue } from "../lib/buzzerbeater/rating-scale";
import { __testing as workspaceTesting } from "../amplify/data/_backend/workspace";

const TEAM_ID = "OUR";

test("home core ranking keeps a defense-first stopper above a scoring-only backup", () => {
  const roster = [
    createRosterPlayer("stopper", "Wing Stopper", 150000, {
      bestPosition: "SF",
      dmi: 220000,
      gameShape: "strong",
      skills: {
        jumpShot: "respectable",
        jumpRange: "respectable",
        outsideDefense: "prolific",
        handling: "strong",
        driving: "strong",
        passing: "strong",
        insideShot: "average",
        insideDefense: "proficient",
        rebounding: "prominent",
        shotBlocking: "proficient",
        stamina: "strong",
        freeThrow: "strong",
        experience: "proficient",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("microwave", "Microwave Guard", 60000, {
      bestPosition: "PG",
      dmi: 90000,
      gameShape: "respectable",
      skills: {
        jumpShot: "prolific",
        jumpRange: "proficient",
        outsideDefense: "mediocre",
        handling: "strong",
        driving: "strong",
        passing: "average",
        insideShot: "average",
        insideDefense: "inept",
        rebounding: "awful",
        shotBlocking: "awful",
        stamina: "respectable",
        freeThrow: "strong",
        experience: "respectable",
        gameShape: "respectable",
      },
    }),
    createRosterPlayer("anchor", "Anchor Big", 170000, {
      bestPosition: "C",
      dmi: 230000,
      gameShape: "strong",
      skills: {
        jumpShot: "average",
        jumpRange: "atrocious",
        outsideDefense: "average",
        handling: "mediocre",
        driving: "average",
        passing: "strong",
        insideShot: "prolific",
        insideDefense: "proficient",
        rebounding: "prolific",
        shotBlocking: "proficient",
        stamina: "strong",
        freeThrow: "respectable",
        experience: "proficient",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("lead", "Lead Creator", 180000, {
      bestPosition: "PG",
      dmi: 240000,
      gameShape: "proficient",
      skills: {
        jumpShot: "prolific",
        jumpRange: "prolific",
        outsideDefense: "strong",
        handling: "prolific",
        driving: "proficient",
        passing: "prolific",
        insideShot: "strong",
        insideDefense: "strong",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "strong",
        freeThrow: "proficient",
        experience: "proficient",
        gameShape: "proficient",
      },
    }),
    createRosterPlayer("forward", "Steady Forward", 140000, {
      bestPosition: "PF",
      dmi: 180000,
      gameShape: "strong",
      skills: {
        jumpShot: "strong",
        jumpRange: "average",
        outsideDefense: "strong",
        handling: "average",
        driving: "strong",
        passing: "average",
        insideShot: "strong",
        insideDefense: "strong",
        rebounding: "strong",
        shotBlocking: "strong",
        stamina: "strong",
        freeThrow: "strong",
        experience: "respectable",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("bench", "Bench Wing", 50000, {
      bestPosition: "SG",
      dmi: 70000,
      gameShape: "respectable",
      skills: {
        jumpShot: "strong",
        jumpRange: "average",
        outsideDefense: "respectable",
        handling: "respectable",
        driving: "average",
        passing: "average",
        insideShot: "average",
        insideDefense: "average",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "respectable",
        freeThrow: "respectable",
        experience: "respectable",
        gameShape: "respectable",
      },
    }),
  ];
  const competitiveSample = createCompetitiveSample([
    createIncludedGame("g1", [
      createTeamBoxPlayer("stopper", 34, { pts: 6, reb: 8, ast: 3, stl: 2, blk: 1, to: 1 }),
      createTeamBoxPlayer("microwave", 14, { pts: 17, reb: 2, ast: 1, stl: 0, blk: 0, to: 2 }, false),
      createTeamBoxPlayer("anchor", 35, { pts: 14, reb: 13, ast: 2, stl: 1, blk: 3, to: 2 }),
      createTeamBoxPlayer("lead", 36, { pts: 18, reb: 4, ast: 9, stl: 2, blk: 0, to: 3 }),
      createTeamBoxPlayer("forward", 33, { pts: 12, reb: 9, ast: 3, stl: 1, blk: 1, to: 1 }),
    ]),
    createIncludedGame("g2", [
      createTeamBoxPlayer("stopper", 35, { pts: 7, reb: 7, ast: 2, stl: 3, blk: 1, to: 1 }),
      createTeamBoxPlayer("microwave", 16, { pts: 19, reb: 1, ast: 2, stl: 0, blk: 0, to: 2 }, false),
      createTeamBoxPlayer("anchor", 34, { pts: 15, reb: 12, ast: 1, stl: 1, blk: 2, to: 2 }),
      createTeamBoxPlayer("lead", 35, { pts: 20, reb: 5, ast: 8, stl: 1, blk: 0, to: 2 }),
      createTeamBoxPlayer("forward", 32, { pts: 11, reb: 10, ast: 4, stl: 1, blk: 1, to: 1 }),
    ]),
    createIncludedGame("g3", [
      createTeamBoxPlayer("stopper", 33, { pts: 5, reb: 8, ast: 4, stl: 2, blk: 2, to: 1 }),
      createTeamBoxPlayer("microwave", 15, { pts: 16, reb: 2, ast: 1, stl: 1, blk: 0, to: 2 }, false),
      createTeamBoxPlayer("anchor", 35, { pts: 13, reb: 11, ast: 2, stl: 1, blk: 2, to: 2 }),
      createTeamBoxPlayer("lead", 36, { pts: 21, reb: 4, ast: 7, stl: 2, blk: 0, to: 2 }),
      createTeamBoxPlayer("forward", 31, { pts: 12, reb: 8, ast: 3, stl: 1, blk: 1, to: 1 }),
    ]),
    createIncludedGame("g4", [
      createTeamBoxPlayer("stopper", 34, { pts: 8, reb: 7, ast: 2, stl: 2, blk: 1, to: 1 }),
      createTeamBoxPlayer("microwave", 17, { pts: 18, reb: 2, ast: 2, stl: 0, blk: 0, to: 2 }, false),
      createTeamBoxPlayer("anchor", 34, { pts: 16, reb: 12, ast: 1, stl: 1, blk: 3, to: 2 }),
      createTeamBoxPlayer("lead", 35, { pts: 19, reb: 3, ast: 8, stl: 2, blk: 0, to: 2 }),
      createTeamBoxPlayer("forward", 32, { pts: 11, reb: 9, ast: 3, stl: 1, blk: 1, to: 1 }),
    ]),
    createIncludedGame("g5", [
      createTeamBoxPlayer("stopper", 34, { pts: 6, reb: 9, ast: 3, stl: 2, blk: 1, to: 1 }),
      createTeamBoxPlayer("microwave", 15, { pts: 20, reb: 1, ast: 1, stl: 0, blk: 0, to: 3 }, false),
      createTeamBoxPlayer("anchor", 35, { pts: 14, reb: 12, ast: 2, stl: 1, blk: 2, to: 2 }),
      createTeamBoxPlayer("lead", 36, { pts: 22, reb: 4, ast: 9, stl: 1, blk: 0, to: 3 }),
      createTeamBoxPlayer("forward", 31, { pts: 10, reb: 8, ast: 4, stl: 1, blk: 1, to: 1 }),
    ]),
  ]);

  const topPlayers = workspaceTesting.buildHomeCorePlayers({
    rosterPlayers: roster as any,
    teamStats: createTeamStats({
      stopper: 6.1,
      microwave: 17.8,
      anchor: 14.4,
      lead: 19.2,
      forward: 11.0,
    }) as any,
    competitiveSample,
    teamId: TEAM_ID,
  });

  const stopperIndex = topPlayers.findIndex((player) => player.playerId === "stopper");
  const microwaveIndex = topPlayers.findIndex(
    (player) => player.playerId === "microwave",
  );

  assert.notEqual(stopperIndex, -1);
  assert.notEqual(microwaveIndex, -1);
  assert.ok(stopperIndex < microwaveIndex);
  assert.equal(topPlayers[stopperIndex]?.recentStartCount, 5);
});

test("scrimmage-heavy schedules do not pollute the home core ranking", () => {
  const matches = [
    createScheduleMatch("scrim-1", "2026-03-10T19:00:00Z", "friendly", 94, 83),
    createScheduleMatch("scrim-2", "2026-03-09T19:00:00Z", "scrimmage", 96, 81),
    createScheduleMatch("league-1", "2026-03-08T19:00:00Z", "league.rs", 91, 85),
    createScheduleMatch("league-2", "2026-03-07T19:00:00Z", "league.rs", 89, 84),
  ];
  const boxScores = [
    createIncludedGame("scrim-1", [
      createTeamBoxPlayer("practice-ace", 40, { pts: 24, reb: 3, ast: 3, stl: 1, blk: 0, to: 1 }),
    ]).boxScore,
    createIncludedGame("scrim-2", [
      createTeamBoxPlayer("practice-ace", 39, { pts: 22, reb: 4, ast: 2, stl: 1, blk: 0, to: 1 }),
    ]).boxScore,
    createIncludedGame("league-1", [
      createTeamBoxPlayer("core-wing", 35, { pts: 12, reb: 7, ast: 3, stl: 2, blk: 1, to: 1 }),
    ]).boxScore,
    createIncludedGame("league-2", [
      createTeamBoxPlayer("core-wing", 34, { pts: 11, reb: 8, ast: 2, stl: 2, blk: 1, to: 1 }),
    ]).boxScore,
  ];

  const sample = buildCompetitiveRecentSample({
    matches,
    boxScores,
    teamId: TEAM_ID,
    rawLookback: 12,
    maxIncludedGames: 5,
  });

  assert.deepStrictEqual(
    sample.includedGames.map((game) => game.match.id),
    ["league-1", "league-2"],
  );
});

test("home schedule selectors ignore all-star and unrelated completed rows", () => {
  const matches = [
    createScheduleMatch("league-win", "2026-03-10T19:00:00Z", "league.rs", 94, 83),
    createScheduleMatch("all-star", "2026-03-11T19:00:00Z", "league.allstar", 171, 144),
    {
      id: "other-team",
      startTime: "2026-03-12T19:00:00Z",
      type: "league.rs",
      homeTeam: {
        id: "ALT",
        teamName: "Another Club",
        score: 88,
      },
      awayTeam: {
        id: "OPP",
        teamName: "Opponent",
        score: 84,
      },
    },
  ];

  assert.deepStrictEqual(
    workspaceTesting
      .selectCompletedMatches(matches as any, TEAM_ID, 5)
      .map((match) => match.id),
    ["league-win"],
  );
});

test("home next-match selector ignores all-star and unrelated upcoming rows", () => {
  const matches = [
    {
      id: "all-star-upcoming",
      startTime: "2026-03-20T19:00:00Z",
      type: "league.allstar",
      homeTeam: {
        id: TEAM_ID,
        teamName: "Visionaries",
        score: null,
      },
      awayTeam: {
        id: "OPP",
        teamName: "Opponent",
        score: null,
      },
    },
    {
      id: "other-team-upcoming",
      startTime: "2026-03-19T19:00:00Z",
      type: "league.rs",
      homeTeam: {
        id: "ALT",
        teamName: "Another Club",
        score: null,
      },
      awayTeam: {
        id: "OPP",
        teamName: "Opponent",
        score: null,
      },
    },
    {
      id: "next-real-game",
      startTime: "2026-03-18T19:00:00Z",
      type: "league.rs",
      homeTeam: {
        id: TEAM_ID,
        teamName: "Visionaries",
        score: null,
      },
      awayTeam: {
        id: "OPP",
        teamName: "Opponent",
        score: null,
      },
    },
  ];

  const match = workspaceTesting.selectNextMatch(matches as any, TEAM_ID);
  assert.ok(match);
  assert.equal(match.id, "next-real-game");
});

test("punt-game blowout losses are ignored for home core usage", () => {
  const matches = [
    createScheduleMatch("punt-loss", "2026-03-10T19:00:00Z", "league.rs", 70, 101),
    createScheduleMatch("real-1", "2026-03-09T19:00:00Z", "league.rs", 92, 86),
    createScheduleMatch("real-2", "2026-03-08T19:00:00Z", "league.rs", 88, 82),
  ];
  const boxScores = [
    createIncludedGame("punt-loss", [
      createTeamBoxPlayer("bench-bucket", 38, { pts: 23, reb: 2, ast: 2, stl: 0, blk: 0, to: 3 }),
    ]).boxScore,
    createIncludedGame("real-1", [
      createTeamBoxPlayer("core-guard", 36, { pts: 16, reb: 4, ast: 8, stl: 2, blk: 0, to: 2 }),
    ]).boxScore,
    createIncludedGame("real-2", [
      createTeamBoxPlayer("core-guard", 35, { pts: 15, reb: 5, ast: 7, stl: 1, blk: 0, to: 2 }),
    ]).boxScore,
  ];

  const sample = buildCompetitiveRecentSample({
    matches,
    boxScores,
    teamId: TEAM_ID,
    rawLookback: 12,
    maxIncludedGames: 5,
  });

  assert.deepStrictEqual(
    sample.includedGames.map((game) => game.match.id),
    ["real-1", "real-2"],
  );
  assert.deepStrictEqual(
    sample.excludedGames.map((game) => [game.match.id, game.reason]),
    [["punt-loss", "STRATEGIC_DEEMPHASIS_LOSS"]],
  );
});

test("with fewer than two competitive games the ranking falls back to talent salary and form", () => {
  const roster = [
    createRosterPlayer("star", "New Transfer", 250000, {
      bestPosition: "PG",
      dmi: 250000,
      gameShape: "strong",
      skills: {
        jumpShot: "prolific",
        jumpRange: "prolific",
        outsideDefense: "proficient",
        handling: "prolific",
        driving: "prolific",
        passing: "prolific",
        insideShot: "strong",
        insideDefense: "strong",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "strong",
        freeThrow: "proficient",
        experience: "proficient",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("hot-hand", "Hot Hand", 80000, {
      bestPosition: "SG",
      dmi: 90000,
      gameShape: "respectable",
      skills: {
        jumpShot: "proficient",
        jumpRange: "strong",
        outsideDefense: "mediocre",
        handling: "strong",
        driving: "strong",
        passing: "average",
        insideShot: "average",
        insideDefense: "inept",
        rebounding: "awful",
        shotBlocking: "awful",
        stamina: "respectable",
        freeThrow: "strong",
        experience: "respectable",
        gameShape: "respectable",
      },
    }),
    createRosterPlayer("filler-1", "Filler One", 70000, {
      bestPosition: "SF",
      dmi: 85000,
      gameShape: "respectable",
      skills: {
        jumpShot: "respectable",
        jumpRange: "average",
        outsideDefense: "respectable",
        handling: "respectable",
        driving: "average",
        passing: "average",
        insideShot: "average",
        insideDefense: "average",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "respectable",
        freeThrow: "respectable",
        experience: "respectable",
        gameShape: "respectable",
      },
    }),
    createRosterPlayer("filler-2", "Filler Two", 65000, {
      bestPosition: "PF",
      dmi: 82000,
      gameShape: "mediocre",
      skills: {
        jumpShot: "average",
        jumpRange: "average",
        outsideDefense: "average",
        handling: "average",
        driving: "average",
        passing: "average",
        insideShot: "average",
        insideDefense: "average",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "respectable",
        freeThrow: "average",
        experience: "respectable",
        gameShape: "mediocre",
      },
    }),
    createRosterPlayer("filler-3", "Filler Three", 60000, {
      bestPosition: "C",
      dmi: 80000,
      gameShape: "mediocre",
      skills: {
        jumpShot: "average",
        jumpRange: "atrocious",
        outsideDefense: "average",
        handling: "average",
        driving: "average",
        passing: "average",
        insideShot: "average",
        insideDefense: "average",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "respectable",
        freeThrow: "average",
        experience: "respectable",
        gameShape: "mediocre",
      },
    }),
  ];
  const competitiveSample: CompetitiveRecentSample = {
    rawMatchesConsidered: 1,
    includedGames: [
      createIncludedGame("only-real-game", [
        createTeamBoxPlayer("hot-hand", 40, { pts: 24, reb: 3, ast: 2, stl: 1, blk: 0, to: 2 }),
      ]),
    ],
    excludedGames: [],
  };

  const topPlayers = workspaceTesting.buildHomeCorePlayers({
    rosterPlayers: roster as any,
    teamStats: createTeamStats({
      star: 4.2,
      "hot-hand": 18.0,
    }) as any,
    competitiveSample,
    teamId: TEAM_ID,
  });

  const topPlayer = topPlayers[0];
  assert.ok(topPlayer);
  assert.equal(topPlayer.playerId, "star");
  assert.equal(topPlayer.recentAvgMinutes, null);
});

test("a low-usage transfer drops out of the top five once current regulars have enough competitive games", () => {
  const roster = [
    createRosterPlayer("transfer", "Blue Chip Transfer", 260000, {
      bestPosition: "SG",
      dmi: 255000,
      gameShape: "strong",
      skills: {
        jumpShot: "prolific",
        jumpRange: "prolific",
        outsideDefense: "strong",
        handling: "prolific",
        driving: "proficient",
        passing: "strong",
        insideShot: "strong",
        insideDefense: "strong",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "strong",
        freeThrow: "proficient",
        experience: "proficient",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("starter-1", "Starter One", 180000, {
      bestPosition: "PG",
      dmi: 210000,
      gameShape: "strong",
      skills: {
        jumpShot: "proficient",
        jumpRange: "strong",
        outsideDefense: "strong",
        handling: "proficient",
        driving: "strong",
        passing: "prolific",
        insideShot: "average",
        insideDefense: "average",
        rebounding: "average",
        shotBlocking: "average",
        stamina: "strong",
        freeThrow: "strong",
        experience: "proficient",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("starter-2", "Starter Two", 170000, {
      bestPosition: "SF",
      dmi: 205000,
      gameShape: "strong",
      skills: {
        jumpShot: "strong",
        jumpRange: "average",
        outsideDefense: "strong",
        handling: "strong",
        driving: "strong",
        passing: "average",
        insideShot: "strong",
        insideDefense: "strong",
        rebounding: "strong",
        shotBlocking: "strong",
        stamina: "strong",
        freeThrow: "strong",
        experience: "respectable",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("starter-3", "Starter Three", 165000, {
      bestPosition: "PF",
      dmi: 200000,
      gameShape: "strong",
      skills: {
        jumpShot: "average",
        jumpRange: "average",
        outsideDefense: "strong",
        handling: "average",
        driving: "average",
        passing: "average",
        insideShot: "proficient",
        insideDefense: "proficient",
        rebounding: "proficient",
        shotBlocking: "proficient",
        stamina: "strong",
        freeThrow: "average",
        experience: "respectable",
        gameShape: "strong",
      },
    }),
    createRosterPlayer("starter-4", "Starter Four", 160000, {
      bestPosition: "C",
      dmi: 195000,
      gameShape: "respectable",
      skills: {
        jumpShot: "average",
        jumpRange: "atrocious",
        outsideDefense: "average",
        handling: "average",
        driving: "average",
        passing: "average",
        insideShot: "proficient",
        insideDefense: "proficient",
        rebounding: "proficient",
        shotBlocking: "proficient",
        stamina: "strong",
        freeThrow: "average",
        experience: "respectable",
        gameShape: "respectable",
      },
    }),
    createRosterPlayer("bench", "Bench Guard", 75000, {
      bestPosition: "PG",
      dmi: 90000,
      gameShape: "respectable",
      skills: {
        jumpShot: "strong",
        jumpRange: "average",
        outsideDefense: "mediocre",
        handling: "strong",
        driving: "strong",
        passing: "average",
        insideShot: "average",
        insideDefense: "inept",
        rebounding: "awful",
        shotBlocking: "awful",
        stamina: "respectable",
        freeThrow: "strong",
        experience: "respectable",
        gameShape: "respectable",
      },
    }),
  ];
  const competitiveSample = createCompetitiveSample([
    createIncludedGame("g1", [
      createTeamBoxPlayer("starter-1", 35, { pts: 15, reb: 4, ast: 7, stl: 1, blk: 0, to: 2 }),
      createTeamBoxPlayer("starter-2", 34, { pts: 13, reb: 7, ast: 3, stl: 1, blk: 1, to: 1 }),
      createTeamBoxPlayer("starter-3", 33, { pts: 12, reb: 8, ast: 2, stl: 1, blk: 1, to: 1 }),
      createTeamBoxPlayer("starter-4", 32, { pts: 11, reb: 11, ast: 2, stl: 1, blk: 2, to: 2 }),
      createTeamBoxPlayer("bench", 16, { pts: 14, reb: 2, ast: 2, stl: 0, blk: 0, to: 2 }, false),
      createTeamBoxPlayer("transfer", 8, { pts: 5, reb: 1, ast: 1, stl: 0, blk: 0, to: 1 }, false),
    ]),
    createIncludedGame("g2", [
      createTeamBoxPlayer("starter-1", 35, { pts: 16, reb: 4, ast: 8, stl: 1, blk: 0, to: 2 }),
      createTeamBoxPlayer("starter-2", 34, { pts: 12, reb: 8, ast: 3, stl: 1, blk: 1, to: 1 }),
      createTeamBoxPlayer("starter-3", 33, { pts: 11, reb: 9, ast: 2, stl: 1, blk: 1, to: 1 }),
      createTeamBoxPlayer("starter-4", 32, { pts: 10, reb: 10, ast: 2, stl: 1, blk: 2, to: 2 }),
      createTeamBoxPlayer("bench", 17, { pts: 15, reb: 2, ast: 2, stl: 0, blk: 0, to: 2 }, false),
      createTeamBoxPlayer("transfer", 6, { pts: 4, reb: 1, ast: 0, stl: 0, blk: 0, to: 1 }, false),
    ]),
  ]);

  const topPlayers = workspaceTesting.buildHomeCorePlayers({
    rosterPlayers: roster as any,
    teamStats: createTeamStats({
      transfer: 4.8,
      "starter-1": 15.5,
      "starter-2": 12.9,
      "starter-3": 11.8,
      "starter-4": 10.6,
      bench: 13.5,
    }) as any,
    competitiveSample,
    teamId: TEAM_ID,
  });

  assert.equal(
    topPlayers.some((player) => player.playerId === "transfer"),
    false,
  );
});

function createCompetitiveSample(
  includedGames: CompetitiveRecentSample["includedGames"],
): CompetitiveRecentSample {
  return {
    rawMatchesConsidered: includedGames.length,
    includedGames,
    excludedGames: [],
  };
}

function createIncludedGame(
  matchId: string,
  players: Array<ReturnType<typeof createTeamBoxPlayer>>,
): CompetitiveSampleIncludedGame {
  return {
    match: createScheduleMatch(matchId, "2026-03-01T19:00:00Z", "league.rs", 90, 82),
    boxScore: createGameBoxScore(matchId, players),
    margin: 8,
    competition: {
      competitionKey: "LEAGUE_REGULAR_SEASON",
      competitionLabel: "League regular season",
      isTvGame: false,
      stageKey: "REGULAR_SEASON",
      stageLabel: "Regular season",
    },
  };
}

function createScheduleMatch(
  matchId: string,
  startTime: string,
  type: string,
  teamScore: number,
  opponentScore: number,
): BBApiScheduleMatch {
  return {
    id: matchId,
    startTime,
    type,
    awayTeam: {
      id: "OPP",
      teamName: "Opponent",
      score: opponentScore,
    },
    homeTeam: {
      id: TEAM_ID,
      teamName: "Visionaries",
      score: teamScore,
    },
  };
}

function createGameBoxScore(
  matchId: string,
  players: Array<ReturnType<typeof createTeamBoxPlayer>>,
): BBApiBoxScore {
  return {
    version: "1",
    retrievedAt: "2026-03-15T00:00:00Z",
    matchId,
    type: "league.rs",
    startTime: "2026-03-01T19:00:00Z",
    endTime: "2026-03-01T21:00:00Z",
    neutral: false,
    effortDelta: 0,
    attendance: {},
    awayTeam: {
      id: "OPP",
      teamName: "Opponent",
      shortName: "OPP",
      offStrategy: "Motion",
      defStrategy: "Man to man",
      score: 82,
      partialScores: [20, 20, 20, 22],
      teamTotals: {},
      ratings: null,
      efficiency: {},
      gdp: {},
      players: [],
      details: {},
    },
    homeTeam: {
      id: TEAM_ID,
      teamName: "Visionaries",
      shortName: "VIS",
      offStrategy: "Motion",
      defStrategy: "Man to man",
      score: 90,
      partialScores: [23, 22, 21, 24],
      teamTotals: {},
      ratings: null,
      efficiency: {},
      gdp: {},
      players,
      details: {},
    },
    details: {},
  };
}

function createTeamBoxPlayer(
  playerId: string,
  minutes: number,
  performance: Partial<{
    ast: number;
    blk: number;
    pts: number;
    reb: number;
    stl: number;
    to: number;
  }>,
  isStarter = true,
): BBApiBoxScorePlayer {
  return {
    id: playerId,
    firstName: playerId,
    lastName: "Player",
    fullName: `${playerId} Player`,
    didNotPlay: false,
    performanceStats: {
      fga: 0,
      fgm: 0,
      fta: 0,
      ftm: 0,
      oreb: 0,
      pf: 0,
      pts: performance.pts ?? 0,
      reb: performance.reb ?? 0,
      ast: performance.ast ?? 0,
      stl: performance.stl ?? 0,
      blk: performance.blk ?? 0,
      to: performance.to ?? 0,
      tpa: 0,
      tpm: 0,
    },
    ratingRaw: minutes > 0 ? "12" : "N/A",
    ratingValue: minutes > 0 ? 12 : null,
    minutesByPosition: {
      PG: minutes,
      SG: 0,
      SF: 0,
      PF: 0,
      C: 0,
    },
    details: {
      isStarter,
    },
  };
}

function createRosterPlayer(
  id: string,
  fullName: string,
  salary: number,
  overrides: Partial<{
    age: number;
    bestPosition: string;
    dmi: number;
    gameShape: string;
    injuryWeeks: number;
    skills: Record<string, string | number>;
  }> = {},
) {
  return {
    id,
    firstName: fullName.split(" ")[0] ?? fullName,
    lastName: fullName.split(" ").slice(1).join(" ") || "Player",
    fullName,
    salary,
    bestPosition: overrides.bestPosition ?? "SF",
    age: overrides.age ?? 27,
    height: 195,
    dmi: overrides.dmi ?? 150000,
    injuryWeeks: overrides.injuryWeeks ?? 0,
    nationality: {
      id: "1",
      name: "USA",
      attributes: {
        id: "1",
      },
    },
    skills: buildOwnedRosterSkills(
      overrides.skills ?? {
        gameShape: overrides.gameShape ?? "strong",
        potential: 10,
        jumpShot: 1,
        range: 1,
        outsideDef: 1,
        handling: 1,
        driving: 1,
        passing: 1,
        insideShot: 1,
        insideDef: 1,
        rebound: 1,
        block: 1,
        stamina: 1,
        freeThrow: 1,
        experience: 1,
      },
    ),
  };
}

function buildOwnedRosterSkills(
  skills: Record<string, string | number>,
): Record<string, number> {
  const mapped = Object.entries(skills).reduce<Record<string, number>>(
    (accumulator, [rawKey, rawValue]) => {
      const key = normalizeRosterSkillKey(rawKey);
      const numeric = normalizeRosterSkillValue(key, rawValue);
      accumulator[key] = numeric;
      return accumulator;
    },
    {},
  );

  return {
    gameShape: mapped.gameShape ?? 8,
    potential: mapped.potential ?? 10,
    jumpShot: mapped.jumpShot ?? 1,
    range: mapped.range ?? 1,
    outsideDef: mapped.outsideDef ?? 1,
    handling: mapped.handling ?? 1,
    driving: mapped.driving ?? 1,
    passing: mapped.passing ?? 1,
    insideShot: mapped.insideShot ?? 1,
    insideDef: mapped.insideDef ?? 1,
    rebound: mapped.rebound ?? 1,
    block: mapped.block ?? 1,
    stamina: mapped.stamina ?? 1,
    freeThrow: mapped.freeThrow ?? 1,
    experience: mapped.experience ?? 1,
  };
}

function normalizeRosterSkillKey(value: string): string {
  switch (value) {
    case "jumpRange":
      return "range";
    case "outsideDefense":
      return "outsideDef";
    case "insideDefense":
      return "insideDef";
    case "rebounding":
      return "rebound";
    case "shotBlocking":
      return "block";
    default:
      return value;
  }
}

function normalizeRosterSkillValue(key: string, value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const scale = key === "gameShape" ? "game_shape" : "player_rating";
  const numeric = resolveBuzzerBeaterNumericValue(scale, value);
  if (numeric === null) {
    throw new Error(`Unexpected ${key} test value: ${value}`);
  }
  return numeric;
}

function createTeamStats(ppgByPlayerId: Record<string, number>) {
  return {
    version: "1",
    retrievedAt: "2026-03-15T00:00:00Z",
    teamId: TEAM_ID,
    season: 72,
    mode: "averages",
    fields: {},
    categories: {},
    players: Object.entries(ppgByPlayerId).map(([id, ppg]) => ({
      id,
      firstName: id,
      lastName: "Player",
      fullName: `${id} Player`,
      stats: {
        ppg,
      },
    })),
  };
}
