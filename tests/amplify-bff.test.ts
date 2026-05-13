import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  __testing as bffTesting,
  isQueryName,
  isMutationName,
  runQueryOperation,
  runMutationOperation,
} from "../app/server/amplify-bff";

function installServerDataClient(
  t: TestContext,
  client: Record<string, unknown>,
) {
  const originalGetServerDataClient = bffTesting.runtime.getServerDataClient;
  bffTesting.runtime.getServerDataClient = async () => client as never;
  t.after(() => {
    bffTesting.runtime.getServerDataClient = originalGetServerDataClient;
  });
}

function installLoggerSpies(t: TestContext) {
  const infoCalls: Array<{ event: string; details: Record<string, unknown> }> =
    [];
  const errorCalls: Array<{ event: string; details: Record<string, unknown> }> =
    [];
  const originalInfo = bffTesting.logger.info;
  const originalError = bffTesting.logger.error;

  bffTesting.logger.info = (event, details) => {
    infoCalls.push({ event, details });
  };
  bffTesting.logger.error = (event, details) => {
    errorCalls.push({ event, details });
  };

  t.after(() => {
    bffTesting.logger.info = originalInfo;
    bffTesting.logger.error = originalError;
  });

  return {
    errorCalls,
    infoCalls,
  };
}

test("clearMyTeamHighlightsData is routed through the mutation BFF", async (t) => {
  let calls = 0;

  installServerDataClient(t, {
    mutations: {
      clearMyTeamHighlightsData: async () => {
        calls += 1;
        return {
          data: {
            clearedCoverageCount: 3,
            deletedMomentCount: 12,
            teamId: "163730",
            teamName: "Visionaries",
          },
        };
      },
    },
  });

  assert.equal(isMutationName("clearMyTeamHighlightsData"), true);

  const result = await runMutationOperation("clearMyTeamHighlightsData");

  assert.equal(calls, 1);
  assert.deepStrictEqual(result.data, {
    clearedCoverageCount: 3,
    deletedMomentCount: 12,
    teamId: "163730",
    teamName: "Visionaries",
  });
});

test("submitLeagueGameDayPerformances is routed through the mutation BFF", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    mutations: {
      submitLeagueGameDayPerformances: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            executionArn:
              "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:performances",
            targetKey: "100#71#gameday-22",
          },
        };
      },
    },
  });

  assert.equal(isMutationName("submitLeagueGameDayPerformances"), true);

  const result = await runMutationOperation("submitLeagueGameDayPerformances", {
    gameDayNumber: 22,
    leagueId: "100",
    season: 71,
  });

  assert.deepStrictEqual(input, {
    gameDayNumber: 22,
    leagueId: "100",
    season: 71,
  });
  assert.deepStrictEqual(result.data, {
    executionArn:
      "arn:aws:states:us-east-1:123456789012:execution:gameday-recap:performances",
    targetKey: "100#71#gameday-22",
  });
});

test("submitLeagueSeasonSimulationJob is routed through the mutation BFF", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    mutations: {
      submitLeagueSeasonSimulationJob: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            executionArn: "arn:simulation-1",
            jobId: "simulation-1",
          },
        };
      },
    },
  });

  assert.equal(isMutationName("submitLeagueSeasonSimulationJob"), true);

  const result = await runMutationOperation("submitLeagueSeasonSimulationJob", {
    leagueId: "league-2",
    snapshotModifiers: [
      {
        ratings: {
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
          outsideScoring: 1.3,
        },
        teamId: "our-1",
      },
    ],
  });
  assert.deepStrictEqual(result.data, {
    executionArn: "arn:simulation-1",
    jobId: "simulation-1",
  });
});

test("connectBbAccount BFF logs redact the access key while preserving useful metadata", async (t) => {
  const logs = installLoggerSpies(t);

  installServerDataClient(t, {
    mutations: {
      connectBbAccount: async (value: Record<string, unknown>) => ({
        data: {
          bbLoginName: value.bbLoginName,
          status: "CONNECTED",
        },
      }),
    },
  });

  await runMutationOperation("connectBbAccount", {
    accessKey: "super-secret",
    bbLoginName: "apiech",
  });

  const startLog = logs.infoCalls[0];
  const completedLog = logs.infoCalls[1];
  assert.equal(logs.infoCalls.length, 2);
  assert.equal(startLog.event, "appBff.operation.start");
  assert.equal(completedLog.event, "appBff.operation.completed");
  assert.equal(startLog.details.bbLoginName, "apiech");
  assert.equal(startLog.details.hasAccessKey, true);
  assert.deepStrictEqual(startLog.details.inputKeys, [
    "accessKey",
    "bbLoginName",
  ]);
  assert.equal("accessKey" in startLog.details, false);
});

test("connectBbAccount BFF failures log the operation name without leaking secrets", async (t) => {
  const logs = installLoggerSpies(t);

  installServerDataClient(t, {
    mutations: {
      connectBbAccount: async () => {
        throw new Error("named reference exploded");
      },
    },
  });

  await assert.rejects(
    runMutationOperation("connectBbAccount", {
      accessKey: "super-secret",
      bbLoginName: "apiech",
    }),
    /named reference exploded/,
  );

  const failedLog = logs.errorCalls[0];
  assert.equal(logs.errorCalls.length, 1);
  assert.equal(failedLog.event, "appBff.operation.failed");
  assert.equal(failedLog.details.name, "connectBbAccount");
  assert.equal(failedLog.details.kind, "mutation");
  assert.equal(failedLog.details.bbLoginName, "apiech");
  assert.equal(failedLog.details.hasAccessKey, true);
  assert.equal("accessKey" in failedLog.details, false);
});

test("submitProductFeedback BFF logs only input keys and not freeform submission text", async (t) => {
  const logs = installLoggerSpies(t);

  installServerDataClient(t, {
    mutations: {
      submitProductFeedback: async () => ({
        data: {
          id: "feedback-1",
          notified: true,
          submittedAt: "2026-04-14T19:30:00.000Z",
        },
      }),
    },
  });

  await runMutationOperation("submitProductFeedback", {
    kind: "FEATURE_REQUEST",
    message: "Please add a lineup import shortcut.",
    subject: "Lineup imports",
  });

  const startLog = logs.infoCalls[0];
  const completedLog = logs.infoCalls[1];

  assert.equal(startLog.event, "appBff.operation.start");
  assert.equal(completedLog.event, "appBff.operation.completed");
  assert.deepStrictEqual(startLog.details.inputKeys, [
    "kind",
    "message",
    "subject",
  ]);
  assert.equal("message" in startLog.details, false);
  assert.equal("subject" in startLog.details, false);
  assert.equal(
    JSON.stringify(startLog.details).includes(
      "Please add a lineup import shortcut.",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(completedLog.details).includes("Lineup imports"),
    false,
  );
});

test("getLatestNextGameRecommendation is routed through the query BFF", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    queries: {
      getLatestNextGameRecommendation: async (
        value: Record<string, unknown>,
      ) => {
        input = value;
        return {
          data: {
            jobId: "recommendation-1",
            matchId: "m-1",
            opponentTeamId: "opp-1",
            excludedPlayerIds: [],
            enthusiasm: 8,
            defensiveSwitch: {
              pg: "PG",
              sg: "SG",
              sf: "SF",
              pf: "PF",
              c: "C",
            },
            requestedAt: "2026-04-09T00:00:00.000Z",
            status: "QUEUED",
          },
        };
      },
    },
  });

  assert.equal(isQueryName("getLatestNextGameRecommendation"), true);

  const result = await runQueryOperation("getLatestNextGameRecommendation", {
    forecastJobId: "forecast-1",
    input: {
      excludedPlayerIds: [],
      enthusiasm: 8,
      defensiveSwitch: {
        pg: "PG",
        sg: "SG",
        sf: "SF",
        pf: "PF",
        c: "C",
      },
    },
    matchId: "m-1",
    opponentTeamId: "opp-1",
  });

  assert.deepStrictEqual(input, {
    forecastJobId: "forecast-1",
    input: {
      excludedPlayerIds: [],
      enthusiasm: 8,
      defensiveSwitch: {
        pg: "PG",
        sg: "SG",
        sf: "SF",
        pf: "PF",
        c: "C",
      },
    },
    matchId: "m-1",
    opponentTeamId: "opp-1",
  });
  assert.equal((result.data as { jobId: string }).jobId, "recommendation-1");
});

test("getLatestLeagueSeasonSimulation is routed through the query BFF", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    queries: {
      getLatestLeagueSeasonSimulation: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            jobId: "simulation-1",
            leagueId: "league-1",
            requestedAt: "2026-05-01T00:00:00.000Z",
            season: 68,
            status: "QUEUED",
            teamId: "our-1",
          },
        };
      },
    },
  });

  assert.equal(isQueryName("getLatestLeagueSeasonSimulation"), true);

  const result = await runQueryOperation("getLatestLeagueSeasonSimulation", {
    jobId: "scenario-job",
    leagueId: "league-2",
  });

  assert.deepStrictEqual(input, {
    jobId: "scenario-job",
    leagueId: "league-2",
  });
  assert.equal((result.data as { jobId: string }).jobId, "simulation-1");
});

test("getNextGamePlannerDetail is routed through the query BFF", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    queries: {
      getNextGamePlannerDetail: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            artifactKey: "artifact-1",
            generatedAt: "2026-04-12T00:00:00.000Z",
            evaluatedScenarios: [],
            opponentPairs: [],
            ourPairs: [],
            views: [],
          },
        };
      },
    },
  });

  assert.equal(isQueryName("getNextGamePlannerDetail"), true);

  const result = await runQueryOperation("getNextGamePlannerDetail", {
    artifactKey: "artifact-1",
  });

  assert.deepStrictEqual(input, {
    artifactKey: "artifact-1",
  });
  assert.equal(
    (result.data as { artifactKey: string }).artifactKey,
    "artifact-1",
  );
});

test("evaluatePredictionMatrix forwards the typed request object to GraphQL", async (t) => {
  let input: Record<string, unknown> | null = null;

  installServerDataClient(t, {
    queries: {
      evaluatePredictionMatrix: async (value: Record<string, unknown>) => {
        input = value;
        return {
          data: {
            generatedAt: "2026-04-12T00:00:00.000Z",
            modelKey: "catboost",
            modelVersion: "matrix-v1",
            selectedTeamAPairId: "Base__ManToMan",
            selectedTeamBPairId: "Base__ManToMan",
            teamAPairs: [],
            teamASide: {
              defense: "Man to Man",
              effortChoice: "Normal",
              offense: "Base",
              teamId: "our-team",
              teamName: "Our Team",
            },
            teamBPairs: [],
            teamBSide: {
              defense: "Man to Man",
              effortChoice: "Normal",
              offense: "Base",
              teamId: "opp-team",
              teamName: "Opponent",
            },
            venue: "NEUTRAL",
            views: [],
          },
        };
      },
    },
  });

  await runQueryOperation("evaluatePredictionMatrix", {
    request: {
      teamA: {
        defense: "Man to Man",
        effortChoice: "Normal",
        offense: "Base",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
        teamId: "our-team",
        teamName: "Our Team",
      },
      teamB: {
        defense: "Man to Man",
        effortChoice: "Normal",
        offense: "Base",
        ratings: {
          insideDefense: 9,
          insideScoring: 9,
          offensiveFlow: 9,
          outsideDefense: 9,
          outsideScoring: 9,
          rebounding: 9,
        },
        teamId: "opp-team",
        teamName: "Opponent",
      },
      modelKey: "catboost",
      venue: "NEUTRAL",
    },
  });

  assert.deepStrictEqual(input, {
    request: {
      teamA: {
        defense: "Man to Man",
        effortChoice: "Normal",
        offense: "Base",
        ratings: {
          insideDefense: 10,
          insideScoring: 10,
          offensiveFlow: 10,
          outsideDefense: 10,
          outsideScoring: 10,
          rebounding: 10,
        },
        teamId: "our-team",
        teamName: "Our Team",
      },
      teamB: {
        defense: "Man to Man",
        effortChoice: "Normal",
        offense: "Base",
        ratings: {
          insideDefense: 9,
          insideScoring: 9,
          offensiveFlow: 9,
          outsideDefense: 9,
          outsideScoring: 9,
          rebounding: 9,
        },
        teamId: "opp-team",
        teamName: "Opponent",
      },
      modelKey: "catboost",
      venue: "NEUTRAL",
    },
  });
});
