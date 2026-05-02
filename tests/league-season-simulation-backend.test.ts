import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  __testing as seasonSimulationTesting,
  finalizeLeagueSeasonSimulationWorkflowFailure,
  getLatestLeagueSeasonSimulation,
  processLeagueSeasonSimulationWorkerAction,
  submitLeagueSeasonSimulationJob,
} from "../amplify/data/_backend/league-season-simulation";
import { resolveLeagueSeasonSimulationPlannerConcurrency } from "../amplify/_backend/league-season-simulation-jobs";
import { installInactiveMaintenanceRuntime } from "./inactive-maintenance-runtime";

installInactiveMaintenanceRuntime();

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const seasonSimulationSource = readFileSync(
  join(repoRoot, "amplify", "data", "_backend", "league-season-simulation.ts"),
  "utf8",
);
const seasonSimulationJobsSource = readFileSync(
  join(repoRoot, "amplify", "_backend", "league-season-simulation-jobs.ts"),
  "utf8",
);
const dataResourceSource = readFileSync(
  join(repoRoot, "amplify", "data", "resource.ts"),
  "utf8",
);
const seasonSimulationWorkerResourceSource = readFileSync(
  join(repoRoot, "amplify", "league-season-simulation-worker", "resource.ts"),
  "utf8",
);

test("current-season snapshot selection uses the 15th percentile when enough games exist", () => {
  const selected =
    seasonSimulationTesting.selectPreferredSeasonSimulationSnapshotCandidate({
      candidates: [
        {
          matchId: "current-low",
          normalizedScalar: 12,
          season: 68,
          startTime: "2026-04-01T00:00:00.000Z",
        },
        {
          matchId: "current-mid",
          normalizedScalar: 18,
          season: 68,
          startTime: "2026-04-02T00:00:00.000Z",
        },
        {
          matchId: "current-high",
          normalizedScalar: 26,
          season: 68,
          startTime: "2026-04-03T00:00:00.000Z",
        },
        {
          matchId: "previous-elite",
          normalizedScalar: 40,
          season: 67,
          startTime: "2025-04-03T00:00:00.000Z",
        },
      ] as any,
      currentSeason: 68,
    });

  assert.equal(selected.strategy, "CURRENT_SEASON_15TH_PERCENTILE");
  assert.equal(selected.candidate?.matchId, "current-low");
});

test("snapshot selection falls back to the multi-season third-best rule when this season is too sparse", () => {
  const selected =
    seasonSimulationTesting.selectPreferredSeasonSimulationSnapshotCandidate({
      candidates: [
        {
          matchId: "best",
          normalizedScalar: 30,
          season: 67,
          startTime: "2025-04-03T00:00:00.000Z",
        },
        {
          matchId: "second",
          normalizedScalar: 28,
          season: 67,
          startTime: "2025-04-02T00:00:00.000Z",
        },
        {
          matchId: "third",
          normalizedScalar: 24,
          season: 67,
          startTime: "2025-04-01T00:00:00.000Z",
        },
        {
          matchId: "current-only",
          normalizedScalar: 20,
          season: 68,
          startTime: "2026-04-01T00:00:00.000Z",
        },
      ] as any,
      currentSeason: 68,
    });

  assert.equal(selected.strategy, "MULTI_SEASON_THIRD_BEST");
  assert.equal(selected.candidate?.matchId, "third");
});

test("remaining league slate dedupes by match id and keeps only unfinished regular-season league games", () => {
  const games = seasonSimulationTesting.buildRemainingRegularSeasonLeagueGames({
    schedulesByTeamId: new Map([
      [
        "home",
        {
          matches: [
            {
              awayTeam: { id: "away", score: null, teamName: "Away" },
              homeTeam: { id: "home", score: null, teamName: "Home" },
              id: "m-1",
              startTime: "2026-05-02T00:00:00.000Z",
              type: "league.rs",
            },
            {
              awayTeam: { id: "away", score: 70, teamName: "Away" },
              homeTeam: { id: "home", score: 75, teamName: "Home" },
              id: "done",
              startTime: "2026-04-01T00:00:00.000Z",
              type: "league.rs",
            },
            {
              awayTeam: { id: "away", score: null, teamName: "Away" },
              homeTeam: { id: "home", score: null, teamName: "Home" },
              id: "tv",
              startTime: "2026-05-04T00:00:00.000Z",
              type: "LEAGUE.RS.TV",
            },
          ],
        } as any,
      ],
      [
        "away",
        {
          matches: [
            {
              awayTeam: { id: "away", score: null, teamName: "Away" },
              homeTeam: { id: "home", score: null, teamName: "Home" },
              id: "m-1",
              startTime: "2026-05-02T00:00:00.000Z",
              type: "league.rs",
            },
            {
              awayTeam: { id: "away", score: null, teamName: "Away" },
              homeTeam: { id: "home", score: null, teamName: "Home" },
              id: "scrim",
              startTime: "2026-05-03T00:00:00.000Z",
              type: "friendly",
            },
            {
              awayTeam: { id: "away", score: null, teamName: "Away" },
              homeTeam: { id: "home", score: null, teamName: "Home" },
              id: "playoffs",
              startTime: "2026-05-05T00:00:00.000Z",
              type: "league.semifinal",
            },
          ],
        } as any,
      ],
    ]),
  });

  assert.deepStrictEqual(
    games.map((game) => game.matchId),
    ["m-1", "tv"],
  );
});

test("remaining league slate keeps all 176 games for a fresh 16-team regular season", () => {
  const { schedulesByTeamId, teams } = createRegularSeasonScheduleFixture();
  const games = seasonSimulationTesting.buildRemainingRegularSeasonLeagueGames({
    schedulesByTeamId,
  });
  const coverage = seasonSimulationTesting.buildLeagueSeasonSlateCoverage({
    remainingGames: games,
    teams,
  });

  assert.equal(games.length, 176);
  assert.deepStrictEqual(coverage.issues, []);
});

test("slate coverage accepts a partial season only when standings account for completed games", () => {
  const { schedulesByTeamId, teams } = createRegularSeasonScheduleFixture({
    completedRounds: 3,
    currentGamesPerTeam: 3,
  });
  const games = seasonSimulationTesting.buildRemainingRegularSeasonLeagueGames({
    schedulesByTeamId,
  });
  const coverage = seasonSimulationTesting.buildLeagueSeasonSlateCoverage({
    remainingGames: games,
    teams,
  });

  assert.equal(games.length, 152);
  assert.deepStrictEqual(coverage.issues, []);
});

test("prepare context fails incomplete regular-season slate coverage instead of simulating partial totals", async () => {
  let update: Record<string, unknown> | null = null;
  const schedulesByTeamId = createIncompleteTwoTeamSchedules();
  const job = {
    id: "job-incomplete",
    leagueId: "league-1",
    leagueName: "NBBA",
    progressJson: null,
    requestedAt: "2026-05-01T19:30:10.000Z",
    season: 72,
    status: "RESOLVING_CONTEXT",
    teamId: "home",
    userId: "user-1",
  };

  await assert.rejects(
    () =>
      processLeagueSeasonSimulationWorkerAction(
        {
          endpointName: "endpoint",
          env: {},
          event: {
            action: "PREPARE_CONTEXT",
            jobId: job.id,
            userId: job.userId,
          },
        },
        {
          assertMaintenanceInactive: async () => undefined,
          artifactStore: {
            get: async () => null,
            listByJobId: async () => ({ nextToken: null, records: [] }),
            upsert: async () => {
              throw new Error("incomplete coverage should fail before artifacts are written");
            },
          },
          createBbClient: () =>
            ({
              getSchedule: async (teamId: string) =>
                schedulesByTeamId.get(teamId) ?? { matches: [], season: 72 },
              getSeasons: async () => ({
                seasons: [{ id: 72 }],
                version: "1",
              }),
              getStandings: async () => ({
                conferences: [
                  {
                    index: 0,
                    teams: [
                      {
                        id: "home",
                        losses: 0,
                        pa: 0,
                        pf: 0,
                        teamName: "Home",
                        wins: 0,
                      },
                      {
                        id: "away",
                        losses: 0,
                        pa: 0,
                        pf: 0,
                        teamName: "Away",
                        wins: 0,
                      },
                    ],
                  },
                ],
                league: { id: "league-1", name: "NBBA" },
                season: 72,
              }),
            }) as any,
          getBbConnection: async () =>
            ({
              bbLoginName: "coach",
              status: "CONNECTED",
            }) as any,
          getLeagueSeasonSimulationJob: async () => job as any,
          resolveBbAccessKey: async () => "secret",
          updateLeagueSeasonSimulationJob: async (_env, input) => {
            update = input;
          },
        } as any,
      ),
    /slate coverage is incomplete/,
  );

  assert.ok(update);
  assert.equal(update.status, "FAILED");
  assert.match(String(update.error), /19 remaining = 19/);
});

test("future regression starts at zero and caps at twenty percent", () => {
  assert.equal(
    seasonSimulationTesting.computeFutureRegressionRatio({
      gameIndex: 0,
      totalGames: 5,
    }),
    0,
  );
  assert.equal(
    seasonSimulationTesting.computeFutureRegressionRatio({
      gameIndex: 4,
      totalGames: 5,
    }),
    0.2,
  );
});

test("conference ranking uses wins then point margin then stable order", () => {
  const ranking = seasonSimulationTesting.rankConferenceTeamIndexes({
    pointMargins: [8, 8, 2],
    stableRanks: [1, 0, 2],
    teamIndexes: [0, 1, 2],
    wins: [10, 10, 9],
  });

  assert.deepStrictEqual(ranking, [1, 0, 2]);
});

test("deterministic expected outcomes add win probability and expected margin once per game", () => {
  const outcomes = seasonSimulationTesting.buildDeterministicExpectedOutcomes({
    scoredGames: [
      {
        awayDefense: "23Zone",
        awayOffense: "Motion",
        awayTeamId: "away",
        awayTeamIndex: 1,
        awayTeamName: "Away",
        expectedAwayScore: 78,
        expectedHomeScore: 84,
        expectedMargin: 6,
        homeDefense: "ManToMan",
        homeOffense: "Base",
        homeTeamId: "home",
        homeTeamIndex: 0,
        homeTeamName: "Home",
        homeWinProbability: 0.75,
        matchId: "m-1",
        modelVersion: "sim-v1",
        startTime: "2026-05-02T00:00:00.000Z",
      },
    ] as any,
    snapshots: [
      {
        currentLosses: 2,
        currentPointMargin: 14,
        currentWins: 5,
      },
      {
        currentLosses: 3,
        currentPointMargin: -14,
        currentWins: 4,
      },
    ] as any,
  });

  assert.deepStrictEqual(outcomes, {
    expectedLosses: [2.25, 3.75],
    expectedPointMargins: [20, -20],
    expectedWins: [5.75, 4.25],
  });
});

test("minimax planner selection uses the best worst-case margin with average margin tiebreak", () => {
  const selected = seasonSimulationTesting.selectMinimaxPlannerResult({
    awayPairs: [
      {
        defense: "23Zone",
        offense: "Motion",
        pairId: "away-a",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
      },
      {
        defense: "Press",
        offense: "Push",
        pairId: "away-b",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
      },
    ],
    homePairs: [
      {
        defense: "ManToMan",
        offense: "Base",
        pairId: "home-a",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
      },
      {
        defense: "32Zone",
        offense: "Motion",
        pairId: "home-b",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
      },
      {
        defense: "Press",
        offense: "Push",
        pairId: "home-c",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
      },
    ],
    view: {
      rows: [
        {
          cells: [
            {
              available: true,
              opponentPairId: "away-a",
              ourPairId: "home-a",
              predictedOpponentScore: 92,
              predictedPointDiff: 5,
              predictedTeamScore: 97,
            },
            {
              available: true,
              opponentPairId: "away-a",
              ourPairId: "home-b",
              predictedOpponentScore: 94,
              predictedPointDiff: 3,
              predictedTeamScore: 97,
            },
            {
              available: true,
              opponentPairId: "away-a",
              ourPairId: "home-c",
              predictedOpponentScore: 91,
              predictedPointDiff: 2,
              predictedTeamScore: 93,
            },
          ],
          opponentPairId: "away-a",
        },
        {
          cells: [
            {
              available: true,
              opponentPairId: "away-b",
              ourPairId: "home-a",
              predictedOpponentScore: 96,
              predictedPointDiff: -1,
              predictedTeamScore: 95,
            },
            {
              available: true,
              opponentPairId: "away-b",
              ourPairId: "home-b",
              predictedOpponentScore: 91,
              predictedPointDiff: 0,
              predictedTeamScore: 91,
            },
            {
              available: true,
              opponentPairId: "away-b",
              ourPairId: "home-c",
              predictedOpponentScore: 90,
              predictedPointDiff: 0,
              predictedTeamScore: 90,
            },
          ],
          opponentPairId: "away-b",
        },
      ],
    },
  });

  assert.equal(selected.homePair.pairId, "home-b");
  assert.equal(selected.awayPair.pairId, "away-b");
  assert.equal(selected.cell.predictedPointDiff, 0);
});

test("deterministic season simulation aggregates finish probabilities", () => {
  const result = seasonSimulationTesting.runSeasonMonteCarlo({
    deterministicExpectations: {
      expectedLosses: [0, 2],
      expectedPointMargins: [16, -16],
      expectedWins: [2, 0],
    },
    leagueId: "league-1",
    leagueName: "NBBA",
    random: () => 0.5,
    residualSigma: 0,
    scoredGames: [
      {
        awayDefense: "23Zone",
        awayOffense: "Motion",
        awayTeamId: "away",
        awayTeamIndex: 1,
        awayTeamName: "Away",
        expectedAwayScore: 78,
        expectedHomeScore: 84,
        expectedMargin: 6,
        homeDefense: "ManToMan",
        homeOffense: "Base",
        homeTeamId: "home",
        homeTeamIndex: 0,
        homeTeamName: "Home",
        homeWinProbability: 1,
        matchId: "m-1",
        modelVersion: "sim-v1",
        startTime: "2026-05-02T00:00:00.000Z",
      },
    ] as any,
    season: 68,
    simulationCount: 10,
    snapshots: [
      {
        candidateGameCount: 3,
        candidates: [],
        conferenceIndex: 0,
        currentLosses: 0,
        currentPointMargin: 10,
        currentWins: 1,
        normalizedRatings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
        sampleWarning: null,
        selectionStrategy: "CURRENT_SEASON_15TH_PERCENTILE",
        sourceDefense: "ManToMan",
        sourceMatchId: "source-home",
        sourceOffense: "Base",
        sourceSeason: 68,
        sourceStartTime: "2026-04-01T00:00:00.000Z",
        stableRank: 0,
        teamId: "home",
        teamName: "Home",
      },
      {
        candidateGameCount: 3,
        candidates: [],
        conferenceIndex: 0,
        currentLosses: 1,
        currentPointMargin: -10,
        currentWins: 0,
        normalizedRatings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
        sampleWarning: null,
        selectionStrategy: "CURRENT_SEASON_15TH_PERCENTILE",
        sourceDefense: "ManToMan",
        sourceMatchId: "source-away",
        sourceOffense: "Base",
        sourceSeason: 68,
        sourceStartTime: "2026-04-01T00:00:00.000Z",
        stableRank: 1,
        teamId: "away",
        teamName: "Away",
      },
    ] as any,
  });

  const home = result.conferences[0]!.teams[0]!;
  const away = result.conferences[0]!.teams[1]!;
  assert.equal(home.teamId, "home");
  assert.equal(home.expectedWins, 2);
  assert.equal(home.finishProbabilities[0]!.probability, 1);
  assert.equal(home.winsP10, 2);
  assert.equal(home.winsP50, 2);
  assert.equal(home.winsP90, 2);
  assert.equal(away.teamId, "away");
  assert.equal(away.expectedLosses, 2);
  assert.equal(result.residualSigma, 0);
  assert.equal(result.remainingGames[0]!.homeOffense, "Base");
  assert.equal(result.remainingGames[0]!.awayDefense, "23Zone");
});

test("submitLeagueSeasonSimulationJob queues work for premium users", async () => {
  let createdRecord: Record<string, unknown> | null = null;
  let queuedMessage: Record<string, string> | null = null;

  const result = await submitLeagueSeasonSimulationJob(
    {
      env: {},
      identity: { sub: "user-1" },
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:league-season-simulation",
    },
    {
      createBbClient: () =>
        ({
          getSchedule: async () => ({
            matches: [],
            season: 71,
          }),
          getSeasons: async () => ({
            seasons: [{ id: 72 }, { id: 71 }],
            version: "1",
          }),
        }) as any,
      createLeagueSeasonSimulationJob: async (_env, input) => {
        createdRecord = input as Record<string, unknown>;
        return {
          ...(input as Record<string, unknown>),
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        } as any;
      },
      getBbConnection: async () =>
        ({
          bbLoginName: "apiech",
          leagueId: "league-1",
          leagueName: "NBBA",
          teamId: "our-1",
          teamName: "Visionaries",
        }) as any,
      requireFeatureAccess: async () => "premium",
      resolveBbAccessKey: async () => "secret",
      startWorkflowExecution: async (_stateMachineArn, _executionName, message) => {
        queuedMessage = message;
        return "arn:simulation-1";
      },
      updateLeagueSeasonSimulationJob: async () => {},
    },
  );

  assert.match(String(result.jobId), /^[0-9a-f-]{36}$/i);
  assert.equal(result.executionArn, "arn:simulation-1");
  assert.equal(createdRecord!.status, "QUEUED");
  assert.equal(createdRecord!.leagueId, "league-1");
  assert.equal(createdRecord!.leagueName, "NBBA");
  assert.equal(createdRecord!.season, 71);
  assert.deepStrictEqual(queuedMessage, {
    jobId: result.jobId,
    userId: "user-1",
  });
});

test("submitLeagueSeasonSimulationJob can target an explicit league id", async () => {
  let createdRecord: Record<string, unknown> | null = null;

  const result = await submitLeagueSeasonSimulationJob(
    {
      env: {},
      identity: { sub: "user-1" },
      leagueId: "league-2",
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:league-season-simulation",
    },
    {
      createBbClient: () =>
        ({
          getSchedule: async () => ({
            matches: [],
            season: 71,
          }),
          getSeasons: async () => ({
            seasons: [{ id: 72 }, { id: 71 }],
            version: "1",
          }),
        }) as any,
      createLeagueSeasonSimulationJob: async (_env, input) => {
        createdRecord = input as Record<string, unknown>;
        return {
          ...(input as Record<string, unknown>),
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        } as any;
      },
      getBbConnection: async () =>
        ({
          bbLoginName: "apiech",
          leagueId: "league-1",
          leagueName: "NBBA",
          teamId: "our-1",
          teamName: "Visionaries",
        }) as any,
      requireFeatureAccess: async () => "premium",
      resolveBbAccessKey: async () => "secret",
      startWorkflowExecution: async () => "arn:simulation-2",
      updateLeagueSeasonSimulationJob: async () => {},
    },
  );

  assert.equal(result.executionArn, "arn:simulation-2");
  assert.equal(createdRecord!.leagueId, "league-2");
  assert.equal(createdRecord!.leagueName, null);
  assert.deepStrictEqual(
    (createdRecord!.requestJson as Record<string, unknown>).leagueId,
    "league-2",
  );
});

test("getLatestLeagueSeasonSimulation filters jobs using the effective live season", async () => {
  const result = await getLatestLeagueSeasonSimulation(
    {
      env: {},
      identity: { sub: "user-1" },
    },
    {
      createBbClient: () =>
        ({
          getSchedule: async () => ({
            matches: [],
            season: 72,
          }),
          getSeasons: async () => ({
            seasons: [{ id: 73 }, { id: 72 }],
            version: "1",
          }),
        }) as any,
      getBbConnection: async () =>
        ({
          bbLoginName: "apiech",
          leagueId: "league-1",
          teamId: "our-1",
        }) as any,
      listLeagueSeasonSimulationJobsByUser: async () => ({
        records: [
          {
            id: "job-71",
            leagueId: "league-1",
            progressJson: null,
            requestedAt: "2026-05-01T00:00:00.000Z",
            season: 71,
            status: "SUCCEEDED",
            teamId: "our-1",
            teamName: "Visionaries",
            userId: "user-1",
          },
          {
            id: "job-72",
            leagueId: "league-1",
            progressJson: null,
            requestedAt: "2026-05-01T00:00:00.000Z",
            season: 72,
            status: "SUCCEEDED",
            teamId: "our-1",
            teamName: "Visionaries",
            userId: "user-1",
          },
        ],
      }) as any,
      resolveBbAccessKey: async () => "secret",
    },
  );

  assert.ok(result);
  assert.equal(result.jobId, "job-72");
  assert.equal(result.season, 72);
});

test("getLatestLeagueSeasonSimulation can target an explicit league id", async () => {
  const result = await getLatestLeagueSeasonSimulation(
    {
      env: {},
      identity: { sub: "user-1" },
      leagueId: "league-2",
    },
    {
      createBbClient: () =>
        ({
          getSchedule: async () => ({
            matches: [],
            season: 72,
          }),
          getSeasons: async () => ({
            seasons: [{ id: 73 }, { id: 72 }],
            version: "1",
          }),
        }) as any,
      getBbConnection: async () =>
        ({
          bbLoginName: "apiech",
          leagueId: "league-1",
          teamId: "our-1",
        }) as any,
      listLeagueSeasonSimulationJobsByUser: async () => ({
        records: [
          {
            id: "connected-league-job",
            leagueId: "league-1",
            progressJson: null,
            requestedAt: "2026-05-01T00:00:00.000Z",
            season: 72,
            status: "SUCCEEDED",
            teamId: "our-1",
            teamName: "Visionaries",
            userId: "user-1",
          },
          {
            id: "requested-league-job",
            leagueId: "league-2",
            progressJson: null,
            requestedAt: "2026-05-01T00:01:00.000Z",
            season: 72,
            status: "SUCCEEDED",
            teamId: "our-1",
            teamName: "Visionaries",
            userId: "user-1",
          },
        ],
      }) as any,
      resolveBbAccessKey: async () => "secret",
    },
  );

  assert.ok(result);
  assert.equal(result.jobId, "requested-league-job");
  assert.equal(result.leagueId, "league-2");
});

test("season simulation runtime config parses planner concurrency overrides", () => {
  assert.deepStrictEqual(
    seasonSimulationTesting.resolveSeasonSimulationRuntimeConfig({
      LEAGUE_SEASON_SIMULATION_PLANNER_CONCURRENCY: "1",
    }),
    {
      plannerBatchConcurrency: 1,
    },
  );
  assert.deepStrictEqual(
    seasonSimulationTesting.resolveSeasonSimulationRuntimeConfig({}),
    {
      plannerBatchConcurrency: 2,
    },
  );
});

test("league season simulation synth concurrency defaults to sandbox-safe values", () => {
  assert.equal(
    resolveLeagueSeasonSimulationPlannerConcurrency("sandbox-karey"),
    1,
  );
  assert.equal(
    resolveLeagueSeasonSimulationPlannerConcurrency("dev"),
    2,
  );
});

test("season simulation planner requests opt into the expected-only response mode", () => {
  const request = seasonSimulationTesting.buildSeasonSimulationPlannerRequest({
    awayPairs: [
      {
        defense: "23Zone",
        offense: "Motion",
        pairId: "away-1",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
      },
    ],
    forecastAwayPairId: "away-1",
    homePairs: [
      {
        defense: "ManToMan",
        offense: "Base",
        pairId: "home-1",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
      },
    ],
  }) as {
    plannerRequest?: {
      responseMode?: string;
    };
  };

  assert.equal(request.plannerRequest?.responseMode, "EXPECTED_ONLY");
});

test("season simulation scores remaining games through per-game planner requests", () => {
  assert.match(seasonSimulationSource, /invokePlannerRequests\(/);
  assert.doesNotMatch(seasonSimulationSource, /invokePlannerBatchRequests\(/);
});

test("league season simulation worker keeps prediction endpoint and secret access prerequisites", () => {
  assert.match(
    seasonSimulationWorkerResourceSource,
    /buildBbConnectionSecretFunctionEnvironment/,
  );
  assert.match(
    seasonSimulationJobsSource,
    /LEAGUE_SEASON_SIMULATION_JOB_STATE_MACHINE_ARN/,
  );
  assert.match(seasonSimulationJobsSource, /PREDICTION_ENDPOINT_NAME/);
  assert.match(
    seasonSimulationJobsSource,
    /LEAGUE_SEASON_SIMULATION_PLANNER_CONCURRENCY/,
  );
  assert.match(seasonSimulationJobsSource, /sagemaker:InvokeEndpoint/);
});

test("league season simulation workflow is chunked with explicit failure finalization", () => {
  assert.doesNotMatch(seasonSimulationJobsSource, /createSingleLambdaWorkflow/);
  assert.match(seasonSimulationJobsSource, /PREPARE_CONTEXT/);
  assert.match(seasonSimulationJobsSource, /COLLECT_SNAPSHOTS_CHUNK/);
  assert.match(seasonSimulationJobsSource, /FINALIZE_SNAPSHOTS/);
  assert.match(seasonSimulationJobsSource, /SCORE_GAMES_CHUNK/);
  assert.match(seasonSimulationJobsSource, /RUN_MONTE_CARLO/);
  assert.match(seasonSimulationJobsSource, /new sfn\.Choice/);
  assert.match(seasonSimulationJobsSource, /LeagueSeasonSimulationJobFinalizeFailure/);
  assert.match(seasonSimulationJobsSource, /grantRead\(backend\.getLatestLeagueSeasonSimulation/);
  assert.match(seasonSimulationWorkerResourceSource, /timeoutSeconds: 120/);
});

test("league simulation failure finalizer is bound to the data API", () => {
  const dataFunctionsBlock =
    /const dataFunctions = \[([\s\S]*?)\];/.exec(dataResourceSource)?.[1] ??
    "";

  assert.match(dataFunctionsBlock, /leagueSeasonSimulationFailureFinalizer/);
  assert.match(dataFunctionsBlock, /gameDayRecapFailureFinalizer/);
  assert.match(
    dataResourceSource,
    /allow\.resource\(resource\)\.to\(\["query", "mutate"\]\)/,
  );
});

test("league simulation artifacts use typed payload fields instead of opaque JSON", () => {
  const artifactModelBlock =
    /LeagueSeasonSimulationArtifact: a\s+\.model\(\{([\s\S]*?)\}\)\s+\.identifier/.exec(
      dataResourceSource,
    )?.[1] ?? "";

  assert.doesNotMatch(artifactModelBlock, /payloadJson/);
  assert.doesNotMatch(artifactModelBlock, /a\.json/);
  assert.match(artifactModelBlock, /contextPayload/);
  assert.match(artifactModelBlock, /snapshotPayload/);
  assert.match(artifactModelBlock, /scoredGamePayload/);
});

test("getLatestLeagueSeasonSimulation reconciles terminal workflow failures", async () => {
  let update: Record<string, unknown> | null = null;
  const result = await getLatestLeagueSeasonSimulation(
    {
      env: {},
      identity: { sub: "user-1" },
    },
    {
      createBbClient: () =>
        ({
          getSchedule: async () => ({
            matches: [],
            season: 72,
          }),
          getSeasons: async () => ({
            seasons: [{ id: 72 }],
            version: "1",
          }),
        }) as any,
      describeWorkflowExecution: async () => ({
        cause: "Task timed out after 300.00 seconds",
        error: "Sandbox.Timedout",
        executionArn: "arn:execution",
        startDate: "2026-05-01T19:30:10.000Z",
        status: "FAILED",
        stopDate: "2026-05-01T19:35:12.000Z",
      }),
      getBbConnection: async () =>
        ({
          bbLoginName: "apiech",
          leagueId: "league-1",
          teamId: "our-1",
        }) as any,
      listLeagueSeasonSimulationJobsByUser: async () => ({
        records: [
          {
            executionArn: "arn:execution",
            id: "job-timeout",
            leagueId: "league-1",
            progressJson: {
              completedPhases: [],
              completedUnits: 94,
              context: null,
              currentPhaseStartedAt: "2026-05-01T19:30:10.000Z",
              phaseCount: 7,
              phaseIndex: 3,
              phaseKey: "SCORING_GAMES",
              summary: "Scoring games.",
              totalUnits: 152,
              unitLabel: "games",
              updatedAt: "2026-05-01T19:35:11.000Z",
            },
            requestedAt: "2026-05-01T19:30:10.000Z",
            season: 72,
            status: "SCORING_GAMES",
            teamId: "our-1",
            teamName: "Visionaries",
            userId: "user-1",
          },
        ],
      }) as any,
      resolveBbAccessKey: async () => "secret",
      updateLeagueSeasonSimulationJob: async (_env, input) => {
        update = input;
      },
    },
  );

  assert.equal(result.status, "FAILED");
  assert.match(result.error ?? "", /Sandbox\.Timedout/);
  assert.ok(update);
  assert.equal(update.status, "FAILED");
  assert.equal(update.completedAt, "2026-05-01T19:35:12.000Z");
});

test("league simulation failure finalizer marks active jobs failed", async () => {
  let update: Record<string, unknown> | null = null;
  const result = await finalizeLeagueSeasonSimulationWorkflowFailure(
    {
      env: {},
      event: {
        error: {
          Cause: "Task timed out after 300.00 seconds",
          Error: "Sandbox.Timedout",
        },
        jobId: "job-1",
        userId: "user-1",
      },
    },
    {
      getLeagueSeasonSimulationJob: async () =>
        ({
          id: "job-1",
          leagueId: "league-1",
          progressJson: null,
          requestedAt: "2026-05-01T19:30:10.000Z",
          season: 72,
          status: "SCORING_GAMES",
          teamId: "our-1",
          userId: "user-1",
        }) as any,
      updateLeagueSeasonSimulationJob: async (_env, input) => {
        update = input;
      },
    },
  );

  assert.deepStrictEqual(result, { updated: true });
  assert.ok(update);
  assert.equal(update.status, "FAILED");
  assert.match(String(update.error), /Sandbox\.Timedout/);
});

test("league simulation scoring chunks skip persisted games on retry", async () => {
  const artifacts = new Map<string, any>();
  const artifactKey = (artifact: {
    artifactKey: string;
    artifactType: string;
    jobId: string;
  }) =>
    `${artifact.jobId}|${artifact.artifactType}|${artifact.artifactKey}`;
  const job = {
    expiresAt: "2026-06-01T00:00:00.000Z",
    expiryKey: "EXPIRABLE",
    id: "job-1",
    leagueId: "league-1",
    progressJson: null,
    requestedAt: "2026-05-01T19:30:10.000Z",
    season: 72,
    status: "SCORING_GAMES",
    teamId: "home",
    userId: "user-1",
  };
  const context = {
    artifactKey: "context",
    artifactOrder: 0,
    artifactType: "CONTEXT",
    contextPayload: {
      candidateGameCount: 0,
      currentSeason: 72,
      leagueId: "league-1",
      leagueName: "NBBA",
      remainingGames: [
        {
          awayTeamId: "away",
          awayTeamName: "Away",
          homeTeamId: "home",
          homeTeamName: "Home",
          matchId: "m-1",
          startTime: "2026-05-02T00:00:00.000Z",
        },
        {
          awayTeamId: "away",
          awayTeamName: "Away",
          homeTeamId: "home",
          homeTeamName: "Home",
          matchId: "m-2",
          startTime: "2026-05-03T00:00:00.000Z",
        },
      ],
      teamCount: 2,
      teams: [
        {
          conferenceIndex: 0,
          currentLosses: 0,
          currentPointMargin: 10,
          currentWins: 1,
          stableRank: 0,
          teamId: "home",
          teamName: "Home",
        },
        {
          conferenceIndex: 0,
          currentLosses: 1,
          currentPointMargin: -10,
          currentWins: 0,
          stableRank: 1,
          teamId: "away",
          teamName: "Away",
        },
      ],
    },
    jobId: job.id,
    userId: job.userId,
  };
  const snapshots = context.contextPayload.teams.map((team, index) => ({
    artifactKey: team.teamId,
    artifactOrder: 2_000 + index,
    artifactType: "FINALIZED_SNAPSHOT",
    jobId: job.id,
    snapshotPayload: {
      ...team,
      candidateGameCount: 3,
      normalizedRatings: {
        insideDefense: 10,
        insideScoring: 10,
        offensiveFlow: 10,
        outsideDefense: 10,
        outsideScoring: 10,
        rebounding: 10,
      },
      sampleWarning: null,
      selectionStrategy: "CURRENT_SEASON_15TH_PERCENTILE",
      sourceDefense: "ManToMan",
      sourceMatchId: "source",
      sourceOffense: "Base",
      sourceSeason: 72,
      sourceStartTime: "2026-04-01T00:00:00.000Z",
    },
    userId: job.userId,
  }));
  const existingScored = {
    artifactKey: "m-1",
    artifactOrder: 3_000,
    artifactType: "SCORED_GAME",
    jobId: job.id,
    scoredGamePayload: {
      ...context.contextPayload.remainingGames[0],
      awayDefense: "ManToMan",
      awayOffense: "Base",
      awayTeamIndex: 1,
      expectedAwayScore: 80,
      expectedHomeScore: 85,
      expectedMargin: 5,
      homeDefense: "ManToMan",
      homeOffense: "Base",
      homeTeamIndex: 0,
      homeWinProbability: 0.7,
      modelVersion: "planner-v1",
    },
    userId: job.userId,
  };
  for (const artifact of [context, ...snapshots, existingScored]) {
    artifacts.set(artifactKey(artifact), artifact);
  }
  let predictorCalls = 0;

  const result = await processLeagueSeasonSimulationWorkerAction(
    {
      endpointName: "endpoint",
      env: {},
      event: {
        action: "SCORE_GAMES_CHUNK",
        jobId: job.id,
        nextGameIndex: 0,
        userId: job.userId,
      },
      remainingTimeInMillis: () => 120_000,
    },
    {
      assertMaintenanceInactive: async () => undefined,
      artifactStore: {
        get: async (_env, input) => artifacts.get(artifactKey(input)) ?? null,
        listByJobId: async () => ({
          nextToken: null,
          records: [...artifacts.values()],
        }),
        upsert: async (_env, artifact) => {
          artifacts.set(artifactKey(artifact), artifact);
        },
      },
      getLeagueSeasonSimulationJob: async () => job as any,
      invokePredictionRuntime: async (_endpointName, payload) => {
        predictorCalls += 1;
        const request = payload.plannerRequest;
        const opponentPairId =
          request.opponentScenarios[0].opponentPairs[0].pairId;
        const ourPairId = request.ourPairs[0].pairId;
        return {
          expectedMatrix: {
            label: "Expected",
            rows: [
              {
                cells: [
                  {
                    available: true,
                    bestEffortChoice: "Normal",
                    opponentPairId,
                    ourPairId,
                    predictedOpponentScore: 82,
                    predictedPointDiff: 4,
                    predictedTeamScore: 86,
                  },
                ],
                opponentPairId,
              },
            ],
            viewId: "expected",
          },
          modelVersion: "planner-v1",
        };
      },
      updateLeagueSeasonSimulationJob: async () => undefined,
    } as any,
  );

  assert.equal(predictorCalls, 1);
  assert.equal(result.scoringComplete, true);
  assert.ok(artifacts.get(`${job.id}|SCORED_GAME|m-2`));
});

function createRegularSeasonScheduleFixture(args: {
  completedRounds?: number;
  currentGamesPerTeam?: number;
} = {}): {
  schedulesByTeamId: Map<string, any>;
  teams: any[];
} {
  const teams = Array.from({ length: 16 }, (_, index) => ({
    conferenceIndex: index < 8 ? 0 : 1,
    currentLosses: 0,
    currentPointMargin: 0,
    currentWins: args.currentGamesPerTeam ?? 0,
    stableRank: index % 8,
    teamId: `team-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
  const schedulesByTeamId = new Map(
    teams.map((team) => [
      team.teamId,
      {
        matches: [],
        retrievedAt: null,
        season: 72,
        teamId: team.teamId,
        version: "test",
      },
    ] as const),
  );
  const baseRounds = buildRoundRobinRounds(teams.map((team) => team.teamId));
  const regularSeasonRounds = [
    ...baseRounds,
    ...baseRounds.slice(0, 7).map((round) =>
      round.map((pair) => ({
        awayTeamId: pair.homeTeamId,
        homeTeamId: pair.awayTeamId,
      })),
    ),
  ];

  regularSeasonRounds.forEach((round, roundIndex) => {
    const completed = roundIndex < (args.completedRounds ?? 0);
    const type = roundIndex % 5 === 0 ? "LEAGUE.RS.TV" : "league.rs";
    round.forEach((pair, gameIndex) => {
      addFixtureMatch(schedulesByTeamId, {
        awayScore: completed ? 80 : null,
        awayTeamId: pair.awayTeamId,
        homeScore: completed ? 84 : null,
        homeTeamId: pair.homeTeamId,
        matchId: `round-${roundIndex + 1}-game-${gameIndex + 1}`,
        startTime: `2026-05-${String(roundIndex + 1).padStart(2, "0")}T00:00:00.000Z`,
        type,
      });
    });
  });

  return { schedulesByTeamId, teams };
}

function buildRoundRobinRounds(teamIds: string[]): Array<
  Array<{ awayTeamId: string; homeTeamId: string }>
> {
  let rotation = [...teamIds];
  const rounds: Array<Array<{ awayTeamId: string; homeTeamId: string }>> = [];
  for (let roundIndex = 0; roundIndex < teamIds.length - 1; roundIndex += 1) {
    const round: Array<{ awayTeamId: string; homeTeamId: string }> = [];
    for (let index = 0; index < teamIds.length / 2; index += 1) {
      const left = rotation[index]!;
      const right = rotation[rotation.length - 1 - index]!;
      round.push(
        roundIndex % 2 === 0
          ? { awayTeamId: right, homeTeamId: left }
          : { awayTeamId: left, homeTeamId: right },
      );
    }
    rounds.push(round);
    rotation = [
      rotation[0]!,
      rotation[rotation.length - 1]!,
      ...rotation.slice(1, rotation.length - 1),
    ];
  }
  return rounds;
}

function createIncompleteTwoTeamSchedules(): Map<string, any> {
  const schedulesByTeamId = new Map([
    ["home", { matches: [], season: 72, teamId: "home" }],
    ["away", { matches: [], season: 72, teamId: "away" }],
  ]);
  for (let index = 0; index < 19; index += 1) {
    addFixtureMatch(schedulesByTeamId, {
      awayScore: null,
      awayTeamId: "away",
      homeScore: null,
      homeTeamId: "home",
      matchId: `missing-round-${index + 1}`,
      startTime: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      type: index % 3 === 0 ? "LEAGUE.RS.TV" : "league.rs",
    });
  }
  return schedulesByTeamId;
}

function addFixtureMatch(
  schedulesByTeamId: Map<string, any>,
  args: {
    awayScore: number | null;
    awayTeamId: string;
    homeScore: number | null;
    homeTeamId: string;
    matchId: string;
    startTime: string;
    type: string;
  },
): void {
  const match = {
    awayTeam: {
      id: args.awayTeamId,
      score: args.awayScore,
      teamName: args.awayTeamId,
    },
    homeTeam: {
      id: args.homeTeamId,
      score: args.homeScore,
      teamName: args.homeTeamId,
    },
    id: args.matchId,
    startTime: args.startTime,
    type: args.type,
  };
  schedulesByTeamId.get(args.homeTeamId)?.matches.push(match);
  schedulesByTeamId.get(args.awayTeamId)?.matches.push(match);
}
