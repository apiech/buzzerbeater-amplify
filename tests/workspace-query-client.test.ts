import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { client } from "../app/amplify-client";
import {
  boxscoreQueryOptions,
  fetchConnectionRecord,
  fetchLeagueIntelQuery,
  fetchLatestLeagueSeasonSimulationQuery,
  fetchManualSalaryEstimateQuery,
  fetchMatchBoxscoreQuery,
  fetchSalaryCalculatorSeedQuery,
  fetchHomeWorkspaceQuery,
  repairOwnerRosterDataMutation,
  refreshNextGameAfterConnectionUpdate,
  refreshLineupHelperAfterOwnerRosterRepair,
  fetchScoutTeamSummaryQuery,
  submitLeagueSeasonSimulationJobMutation,
  submitProductFeedbackMutation,
  fetchTeamHighlightsQuery,
  workspaceQueryKeys,
} from "../app/dashboard/workspace-query-client";
import { createStoredTeamInfo } from "./fixtures/owned-data";

function installQueryMock<TName extends keyof typeof client.queries>(
  t: TestContext,
  name: TName,
  handler: (typeof client.queries)[TName],
) {
  const original = client.queries[name];
  client.queries[name] = handler;
  t.after(() => {
    client.queries[name] = original;
  });
}

function installMutationMock<TName extends keyof typeof client.mutations>(
  t: TestContext,
  name: TName,
  handler: (typeof client.mutations)[TName],
) {
  const original = client.mutations[name];
  client.mutations[name] = handler;
  t.after(() => {
    client.mutations[name] = original;
  });
}

function installReadMock<TName extends keyof typeof client.reads>(
  t: TestContext,
  name: TName,
  handler: (typeof client.reads)[TName],
) {
  const original = client.reads[name];
  client.reads[name] = handler;
  t.after(() => {
    client.reads[name] = original;
  });
}

test("home workspace parsing accepts key-based tendencies and omits home connection userId", async (t) => {
  installQueryMock(t, "getHomeWorkspace", async () => ({
    data: {
      connection: {
        bbLoginName: "apiech",
        status: "CONNECTED",
        teamName: "Visionaries",
      },
      league: {
        freshnessMessage: null,
        freshnessStatus: "FRESH",
        league: {
          id: "nbba",
          name: "NBBA",
        },
        season: 72,
        standings: [],
      },
      nextMatch: null,
      nextOpponent: {
        injuries: [],
        record: {
          losses: 8,
          wins: 8,
        },
        teamId: "opp-1",
        teamName: "Rivals",
        tendencies: {
          defense: [{ count: 1, key: "ManToMan" }],
          offense: [{ count: 2, key: "Push" }],
        },
      },
      nextScoutMatch: null,
      recentMatches: [],
      syncedAt: "2026-04-11T22:07:00.000Z",
      team: {
        injuries: [],
        record: {
          losses: 6,
          wins: 10,
        },
        shortName: "Visionaries",
        teamId: "our-1",
        teamName: "Visionaries",
        topPlayers: [],
      },
    },
    errors: null,
  }));

  const workspace = await fetchHomeWorkspaceQuery();

  assert.equal(workspace.connection.userId, undefined);
  assert.deepStrictEqual(workspace.nextOpponent?.tendencies.offense, [
    { count: 2, key: "Push" },
  ]);
});

test("connection loading tolerates a connected record with a null workspace cache", async (t) => {
  installReadMock(t, "getCurrentBbConnection", async () => ({
    data: {
      bbLoginName: "apiech",
      status: "CONNECTED",
      teamId: "our-1",
      teamName: "Visionaries",
      workspaceCacheJson: null,
    },
    errors: null,
  }));

  const connection = await fetchConnectionRecord();

  assert.ok(connection);
  assert.equal(connection.status, "CONNECTED");
  assert.equal(connection.workspaceCacheJson, null);
});

test("connection loading rejects owned extra fields from the read contract", async (t) => {
  installReadMock(t, "getCurrentBbConnection", async () => ({
    data: {
      bbLoginName: "apiech",
      profileJson: {
        ...createStoredTeamInfo(),
        unexpected: true,
      },
      status: "CONNECTED",
      teamId: "our-1",
      teamName: "Visionaries",
    },
    errors: null,
  }));

  await assert.rejects(
    () => fetchConnectionRecord(),
    /unsupported key\(s\): unexpected/,
  );
});

test("scout summary parsing accepts key-based tendencies", async (t) => {
  installQueryMock(t, "getScoutTeamSummary", async () => ({
    data: {
      availableOpponents: [],
      message: null,
      recentMatchups: [],
      requestedTeamId: "opp-1",
      schedule: null,
      summary: {
        matchupPerspective: {
          opponentTeamId: "opp-1",
          ourTeamId: "our-1",
        },
        nextMatch: null,
        recentGames: [],
        record: {
          losses: 8,
          wins: 8,
        },
        roster: [],
        tendencies: {
          defense: [{ count: 1, key: "23Zone" }],
          offense: [{ count: 2, key: "Push" }],
        },
        teamName: "Rivals",
        topPlayers: [],
      },
      syncedAt: "2026-04-11T22:07:00.000Z",
      teamId: "opp-1",
    },
    errors: null,
  }));

  const scout = await fetchScoutTeamSummaryQuery({ teamId: "opp-1" });

  assert.ok(scout?.summary);
  assert.deepStrictEqual(scout.summary.tendencies.defense, [
    { count: 1, key: "23Zone" },
  ]);
});

test("league intel parsing accepts enriched comparison payloads and still tolerates missing comparisons", async (t) => {
  installQueryMock(t, "getLeagueIntel", async () => ({
    data: {
      comparisons: {
        arena: [
          {
            bleachers: 14000,
            conferenceIndex: 0,
            courtside: 500,
            lowerTier: 6243,
            luxuryBoxes: 50,
            standingsIndex: 0,
            teamId: "our-1",
            teamName: "Visionaries",
            totalCapacity: 20793,
          },
        ],
        builtAt: "2026-04-19T22:30:00.000Z",
        defense: [
          {
            blocks: {
              diff: -0.9,
              opponent: 8.3,
              team: 7.4,
            },
            conferenceIndex: 0,
            fouls: {
              diff: -2.8,
              opponent: 16.3,
              team: 13.5,
            },
            gamesPlayed: 14,
            standingsIndex: 0,
            steals: {
              diff: 0.2,
              opponent: 5.6,
              team: 5.8,
            },
            teamId: "our-1",
            teamName: "Visionaries",
            totalRebounds: {
              diff: 1.6,
              opponent: 49.8,
              team: 51.4,
            },
            turnovers: {
              diff: -1.5,
              opponent: 11,
              team: 9.5,
            },
          },
        ],
        incompleteTeamCount: 1,
        offense: [
          {
            assists: {
              diff: 0.4,
              opponent: 19,
              team: 19.4,
            },
            conferenceIndex: 0,
            effectiveFgPct: {
              diff: 5.2,
              opponent: 99.3,
              team: 104.5,
            },
            fgPct: {
              diff: 5,
              opponent: 33.1,
              team: 38.1,
            },
            ftPct: {
              diff: 5.6,
              opponent: 84.5,
              team: 90.1,
            },
            gamesPlayed: 14,
            offensiveRebounds: {
              diff: 0.7,
              opponent: 12,
              team: 12.7,
            },
            points: {
              diff: 17,
              opponent: 74.2,
              team: 91.2,
            },
            standingsIndex: 0,
            teamId: "our-1",
            teamName: "Visionaries",
            threePtPct: {
              diff: null,
              opponent: 26.2,
              team: 27.8,
            },
          },
        ],
        payroll: [
          {
            averageSalary: 63886,
            conferenceIndex: 0,
            payrollRanks6To10: 19076,
            playerCount: 11,
            standingsIndex: 0,
            standardDeviation: 89094,
            teamId: "our-1",
            teamName: "Visionaries",
            top10Payroll: 702515,
            top5Payroll: 683439,
            top8Payroll: 701923,
            totalPayroll: 702741,
          },
        ],
        season: 72,
      },
      freshnessMessage: null,
      freshnessStatus: "FRESH",
      league: {
        id: "nbba",
        name: "NBBA",
      },
      season: 72,
      standings: [],
    },
    errors: null,
  }));

  const league = await fetchLeagueIntelQuery();

  assert.ok(league?.comparisons);
  assert.equal(league.comparisons.incompleteTeamCount, 1);
  assert.equal(league.comparisons.offense[0]?.threePtPct?.diff, null);
  assert.equal(league.comparisons.arena[0]?.totalCapacity, 20793);
});

test("league season simulation parsing forwards league and job ids and accepts current-season selection strategies", async (t) => {
  let input: Record<string, unknown> | undefined;
  installQueryMock(t, "getLatestLeagueSeasonSimulation", async (value) => {
    input = value as Record<string, unknown> | undefined;
    return {
    data: {
      completedAt: "2026-05-01T00:10:00.000Z",
      executionArn: "arn:simulation-1",
      jobId: "simulation-1",
      leagueId: "league-1",
      leagueName: "NBBA",
      progress: {
        completedPhases: [],
        phaseCount: 7,
        phaseIndex: 5,
        phaseKey: "SUCCEEDED",
        summary: "Projected final standings are ready.",
        updatedAt: "2026-05-01T00:10:00.000Z",
      },
      requestedAt: "2026-05-01T00:00:00.000Z",
      result: {
        conferences: [
          {
            conferenceIndex: 0,
            teams: [
              {
                averageFinish: 1.7,
                currentLosses: 2,
                currentPointMargin: 41,
                currentWins: 4,
                expectedLosses: 6.2,
                expectedPointMargin: 88.4,
                expectedWins: 10.8,
                finishProbabilities: [{ place: 1, probability: 0.62 }],
                firstPlaceProbability: 0.62,
                snapshot: {
                  candidateGameCount: 4,
                  defense: "23Zone",
                  effectiveRatings: {
                    insideDefense: 6,
                    insideScoring: 5,
                    offensiveFlow: 7,
                    outsideDefense: 2.4,
                    outsideScoring: 9.3,
                    rebounding: 8,
                  },
                  offense: "Motion",
                  ratingModifiers: {
                    insideDefense: 0,
                    insideScoring: 0,
                    offensiveFlow: 0,
                    outsideDefense: -0.6,
                    outsideScoring: 1.3,
                    rebounding: 0,
                  },
                  ratings: {
                    insideDefense: 6,
                    insideScoring: 5,
                    offensiveFlow: 7,
                    outsideDefense: 3,
                    outsideScoring: 8,
                    rebounding: 8,
                  },
                  selectionStrategy: "CURRENT_SEASON_15TH_PERCENTILE",
                  teamId: "our-1",
                },
                standingsIndex: 0,
                teamId: "our-1",
                teamName: "Visionaries",
                winsP10: 9.4,
                winsP50: 10.7,
                winsP90: 12.1,
              },
            ],
          },
        ],
        generatedAt: "2026-05-01T00:10:00.000Z",
        leagueId: "league-1",
        leagueName: "NBBA",
        lowSampleTeamCount: 0,
        modelVersion: "sim-v1",
        remainingGames: [],
        residualSigma: 10,
        scenarioKey: "scenario-test",
        season: 68,
        simulationCount: 10000,
      },
      season: 68,
      status: "SUCCEEDED",
      teamId: "our-1",
      teamName: "Visionaries",
    },
    errors: null,
    };
  });

  const snapshot = await fetchLatestLeagueSeasonSimulationQuery({
    jobId: "scenario-job",
    leagueId: "league-2",
  });

  assert.deepStrictEqual(input, {
    jobId: "scenario-job",
    leagueId: "league-2",
  });
  assert.equal(
    snapshot!.result!.conferences[0]!.teams[0]!.snapshot.selectionStrategy,
    "CURRENT_SEASON_15TH_PERCENTILE",
  );
  assert.equal(snapshot!.result!.simulationCount, 10000);
  assert.equal(snapshot!.result!.residualSigma, 10);
  assert.equal(snapshot!.result!.conferences[0]!.teams[0]!.winsP50, 10.7);
  assert.equal(snapshot!.result!.scenarioKey, "scenario-test");
  assert.equal(
    snapshot!.result!.conferences[0]!.teams[0]!.snapshot.ratingModifiers
      ?.outsideScoring,
    1.3,
  );
});

test("league season simulation mutation forwards league ids and modifiers and returns the queued job envelope", async (t) => {
  let input: Record<string, unknown> | undefined;
  installMutationMock(t, "submitLeagueSeasonSimulationJob", async (value) => {
    input = value as Record<string, unknown> | undefined;
    return {
    data: {
      executionArn: "arn:simulation-1",
      jobId: "simulation-1",
    },
    errors: null,
    };
  });

  const result = await submitLeagueSeasonSimulationJobMutation({
    leagueId: "league-2",
    snapshotModifiers: [
      {
        ratings: {
          outsideDefense: -0.6,
          outsideScoring: 1.3,
        },
        teamId: "our-1",
      },
    ],
  });

  assert.deepStrictEqual(input, {
    leagueId: "league-2",
    snapshotModifiers: [
      {
        ratings: {
          outsideDefense: -0.6,
          outsideScoring: 1.3,
        },
        teamId: "our-1",
      },
    ],
  });
  assert.equal(result.jobId, "simulation-1");
  assert.equal(result.executionArn, "arn:simulation-1");
});

test("league intel parsing still accepts standings-only payloads", async (t) => {
  let input: Record<string, unknown> | undefined;
  installQueryMock(t, "getLeagueIntel", async (value) => {
    input = value as Record<string, unknown> | undefined;
    return {
    data: {
      freshnessMessage: null,
      freshnessStatus: "FRESH",
      league: {
        id: "nbba",
        name: "NBBA",
      },
      season: 72,
      standings: [
        {
          index: 0,
          teams: [
            {
              losses: 4,
              pointMargin: 30,
              teamId: "our-1",
              teamName: "Visionaries",
              wins: 10,
            },
          ],
        },
      ],
    },
    errors: null,
    };
  });

  const league = await fetchLeagueIntelQuery({ leagueId: "league-2" });

  assert.deepStrictEqual(input, { leagueId: "league-2" });
  assert.ok(league);
  assert.equal(league.comparisons, undefined);
  assert.equal(league.standings[0]?.teams[0]?.teamId, "our-1");
});

test("league intel parsing accepts an explicit unavailable freshness payload", async (t) => {
  installQueryMock(t, "getLeagueIntel", async () => ({
    data: {
      comparisons: null,
      freshnessMessage:
        "Live league standings are unavailable right now. League tables and projections stay hidden until a fresh refresh succeeds.",
      freshnessStatus: "UNAVAILABLE",
      league: {
        id: "nbba",
        name: "NBBA",
      },
      season: 72,
      standings: [],
    },
    errors: null,
  }));

  const league = await fetchLeagueIntelQuery();

  assert.ok(league);
  assert.equal(league.freshnessStatus, "UNAVAILABLE");
  assert.equal(league.season, 72);
  assert.equal(league.standings.length, 0);
});

test("team highlights parsing accepts string periods from the generated API contract", async (t) => {
  installQueryMock(t, "getMyTeamHighlights", async () => ({
    data: {
      filters: {
        onlyOutcomeChange: true,
        perspective: "BOTH",
      },
      items: [
        {
          comment: "Buzzer beater.",
          eventKind: "shot",
          matchId: "m-1",
          momentId: "moment-1",
          outcomeChanged: true,
          period: "Q4",
          perspective: "FOR",
          playerName: "Closer",
          recordId: "record-1",
          teamId: "team-1",
          viewerUrl: "https://example.com/viewer",
        },
      ],
      nextCursor: null,
      scanStatus: null,
      summary: {
        againstMoments: 0,
        filteredMoments: 1,
        forMoments: 1,
        outcomeChangeMoments: 1,
        totalMoments: 1,
      },
      team: {
        teamId: "team-1",
        teamName: "Visionaries",
      },
    },
    errors: null,
  }));

  const payload = await fetchTeamHighlightsQuery({
    onlyOutcomeChange: true,
    perspective: "BOTH",
  });

  assert.equal(payload?.items[0]?.period, "Q4");
});

test("match boxscore queries forward preferLive when requested", async (t) => {
  let receivedInput: Record<string, unknown> | undefined;

  installQueryMock(t, "getMatchBoxscoreDetails", async (input?: unknown) => {
    receivedInput = (input ?? undefined) as Record<string, unknown> | undefined;
    return {
      data: {
        attendance: null,
        awayTeam: null,
        context: null,
        endTime: null,
        homeTeam: null,
        matchId: "match-1",
        matchType: "League",
        source: "LIVE_BB_API",
        startTime: "2026-04-14T20:00:00.000Z",
      },
      errors: null,
    };
  });

  const payload = await fetchMatchBoxscoreQuery({
    matchId: "match-1",
    preferLive: true,
  });

  assert.equal(receivedInput?.matchId, "match-1");
  assert.equal(receivedInput.preferLive, true);
  assert.equal(payload?.source, "LIVE_BB_API");
});

test("boxscore query keys separate prefer-live imports from cache-first reads", () => {
  const cacheFirst = boxscoreQueryOptions({ matchId: "match-1" }).queryKey;
  const preferLive = boxscoreQueryOptions({
    matchId: "match-1",
    preferLive: true,
  }).queryKey;

  assert.deepStrictEqual(
    cacheFirst,
    workspaceQueryKeys.boxscore("match-1", false),
  );
  assert.deepStrictEqual(
    preferLive,
    workspaceQueryKeys.boxscore("match-1", true),
  );
  assert.notDeepStrictEqual(cacheFirst, preferLive);
});

test("product feedback mutation parses the submit result and preserves notification state", async (t) => {
  installMutationMock(t, "submitProductFeedback", async () => ({
    data: {
      id: "feedback-1",
      notified: false,
      submittedAt: "2026-04-14T20:14:00.000Z",
    },
    errors: null,
  }));

  const result = await submitProductFeedbackMutation({
    kind: "FEATURE_REQUEST",
    message: "Please add a feedback shortcut.",
    subject: "Feedback shortcut",
  });

  assert.deepStrictEqual(result, {
    id: "feedback-1",
    notified: false,
    submittedAt: "2026-04-14T20:14:00.000Z",
  });
});

test("salary calculator seed parsing accepts synced skill values above 20", async (t) => {
  installQueryMock(t, "getSalaryCalculatorSeed", async () => ({
    data: {
      bestPosition: "PG",
      currentSalary: 325000,
      fullName: "Seed Guard",
      playerId: "player-1",
      skills: {
        driving: 24,
        handling: 25,
        insideDefense: 11,
        insideScoring: 9,
        jumpRange: 23,
        jumpShot: 25,
        outsideDefense: 24,
        passing: 25,
        rebounding: 8,
        shotBlocking: 4,
      },
    },
    errors: null,
  }));

  const seed = await fetchSalaryCalculatorSeedQuery({ playerId: "player-1" });

  assert.ok(seed);
  assert.equal(seed.skills.jumpShot, 25);
  assert.equal(seed.skills.jumpRange, 23);
  assert.equal(seed.currentSalary, 325000);
});

test("manual salary estimate parsing accepts the typed source metadata payload", async (t) => {
  installQueryMock(t, "getManualSalaryEstimate", async () => ({
    data: {
      bestPosition: "PG",
      calibrationMode: "IDENTITY",
      correctionFactorApplied: 1,
      modelSource: "chromebb",
      modelSourceConfidence: "direct_public_code",
      predictedSalary: 482000,
      salaryByPosition: {
        C: 223000,
        PF: 252000,
        PG: 482000,
        SF: 342000,
        SG: 467000,
      },
    },
    errors: null,
  }));

  const estimate = await fetchManualSalaryEstimateQuery({
    input: {
      skills: {
        driving: 24,
        handling: 25,
        insideDefense: 11,
        insideScoring: 9,
        jumpRange: 23,
        jumpShot: 25,
        outsideDefense: 24,
        passing: 25,
        rebounding: 8,
        shotBlocking: 4,
      },
    },
  });

  assert.ok(estimate);
  assert.equal(estimate.predictedSalary, 482000);
  assert.equal(estimate.salaryByPosition.PG, 482000);
  assert.equal(estimate.calibrationMode, "IDENTITY");
});

test("owner roster repair mutation parses compact repair results", async (t) => {
  installMutationMock(t, "repairOwnerRosterData", async () => ({
    data: {
      completedAt: "2026-04-13T03:40:00.000Z",
      repairedPlayerCount: 11,
    },
    errors: null,
  }));

  const result = await repairOwnerRosterDataMutation();

  assert.equal(result.completedAt, "2026-04-13T03:40:00.000Z");
  assert.equal(result.repairedPlayerCount, 11);
});

test("owner roster repair refresh only replaces the lineup-helper cache", async (t) => {
  installQueryMock(t, "getLineupHelperWorkspace", async () => ({
    data: {
      availableDefenses: ["Man to man"],
      availableLocations: ["Home Court"],
      availableOffenses: ["Base Offense"],
      defaultAssignments: [],
      defaultContext: {
        defense: "Man to man",
        defensiveSwitch: {
          c: "C",
          pf: "PF",
          pg: "PG",
          sf: "SF",
          sg: "SG",
        },
        enthusiasm: 5,
        homeCourt: "Home Court",
        offense: "Base Offense",
      },
      evaluation: null,
      generatedAt: "2026-04-13T03:41:00.000Z",
      roster: [],
      snapshotWarnings: [],
      syncedAt: "2026-04-13T03:41:00.000Z",
    },
    errors: null,
  }));

  const queryClient = new QueryClient();
  queryClient.setQueryData(workspaceQueryKeys.home, {
    team: { teamName: "Visionaries" },
  });

  const refreshed =
    await refreshLineupHelperAfterOwnerRosterRepair(queryClient);

  assert.equal(
    queryClient.getQueryData(workspaceQueryKeys.lineupHelper),
    refreshed,
  );
  assert.deepStrictEqual(queryClient.getQueryData(workspaceQueryKeys.home), {
    team: { teamName: "Visionaries" },
  });
});

test("next-game reconnect refresh clears wizard caches and reloads the current next-opponent context", async (t) => {
  installMutationMock(t, "refreshWorkspace", async () => ({
    data: {
      connection: {
        bbLoginName: "apiech",
        status: "CONNECTED",
        teamName: "Visionaries",
      },
      league: {
        freshnessMessage: null,
        freshnessStatus: "FRESH",
        league: {
          id: "nbba",
          name: "NBBA",
        },
        season: 72,
        standings: [],
      },
      nextMatch: {
        isHome: true,
        matchId: "match-1",
        opponentTeamId: "opp-1",
        opponentTeamName: "Rivals",
        startTime: "2026-04-15T23:00:00.000Z",
        type: "League",
      },
      nextOpponent: null,
      nextScoutMatch: null,
      recentMatches: [],
      syncedAt: "2026-04-15T02:35:00.000Z",
      team: {
        injuries: [],
        record: null,
        shortName: "Visionaries",
        teamId: "our-1",
        teamName: "Visionaries",
        topPlayers: [],
      },
    },
    errors: null,
  }));
  installQueryMock(t, "getLineupHelperWorkspace", async () => ({
    data: {
      availableDefenses: ["Man to man"],
      availableLocations: ["Home Court"],
      availableOffenses: ["Base Offense"],
      defaultAssignments: [],
      defaultContext: {
        defense: "Man to man",
        defensiveSwitch: {
          c: "C",
          pf: "PF",
          pg: "PG",
          sf: "SF",
          sg: "SG",
        },
        enthusiasm: 5,
        homeCourt: "Home Court",
        offense: "Base Offense",
      },
      evaluation: null,
      generatedAt: "2026-04-15T02:35:00.000Z",
      roster: [],
      snapshotWarnings: [],
      syncedAt: "2026-04-15T02:35:00.000Z",
    },
    errors: null,
  }));

  const queryClient = new QueryClient();
  const recommendationKey = workspaceQueryKeys.nextGameRecommendation({
    forecastJobId: "job-1",
    input: {
      defensiveSwitch: {
        c: "C",
        pf: "PF",
        pg: "PG",
        sf: "SF",
        sg: "SG",
      },
      enthusiasm: 5,
      excludedPlayerIds: [],
    },
    matchId: "match-1",
    opponentTeamId: "opp-1",
  });

  queryClient.setQueryData(workspaceQueryKeys.scoutSummary("opp-1"), {
    teamId: "opp-1",
  });
  queryClient.setQueryData(workspaceQueryKeys.opponentForecast("opp-1"), {
    jobId: "job-1",
    status: "FAILED",
  });
  queryClient.setQueryData(recommendationKey, {
    status: "FAILED",
  });
  queryClient.setQueryData(
    workspaceQueryKeys.nextGamePlannerDetail("artifact-1"),
    {
      artifactKey: "artifact-1",
    },
  );

  const refreshed = await refreshNextGameAfterConnectionUpdate(queryClient);

  assert.equal(
    refreshed.home.nextMatch?.opponentTeamId,
    "opp-1",
  );
  assert.equal(
    refreshed.lineupHelper.generatedAt,
    "2026-04-15T02:35:00.000Z",
  );
  assert.equal(
    queryClient.getQueryData(workspaceQueryKeys.home),
    refreshed.home,
  );
  assert.equal(
    queryClient.getQueryData(workspaceQueryKeys.lineupHelper),
    refreshed.lineupHelper,
  );
  assert.equal(
    queryClient.getQueryData(workspaceQueryKeys.scoutSummary("opp-1")),
    undefined,
  );
  assert.equal(
    queryClient.getQueryData(workspaceQueryKeys.opponentForecast("opp-1")),
    undefined,
  );
  assert.equal(queryClient.getQueryData(recommendationKey), undefined);
  assert.equal(
    queryClient.getQueryData(
      workspaceQueryKeys.nextGamePlannerDetail("artifact-1"),
    ),
    undefined,
  );
});
