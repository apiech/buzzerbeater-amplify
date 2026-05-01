import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as repositoryTesting,
  createNextGameRecommendationJob,
  createOpponentForecastJob,
  createSyncRun,
  getBbConnection,
  getGameDayRecap,
  getLeagueGameDayRecap,
  getMatchBoxscore,
  getSingleGameSummary,
  upsertNextGamePlannerArtifact,
  upsertNextGamePlannerArtifactRows,
  getRivalsBackfill,
  getPredictionJob,
  getUserPreference,
  listPredictionGridCellsByUserAndRequestId,
  listPlayerSkillObservations,
  listExpiredSyncRuns,
  updateSyncRun,
  upsertBbConnection,
  upsertLeagueSeasonSimulationArtifact,
  upsertRivalsBackfill,
  upsertPredictionGridCells,
  upsertPredictionJob,
  upsertSingleGameSummary,
  upsertMatchBoxscore,
  upsertUserPreference,
  upsertTrackedPlayer,
  updatePredictionJobIfRequestMatches,
} from "../amplify/data/_backend/repository";
import {
  createStoredOwnedRosterPlayer,
  createStoredTeamInfo,
  createWorkspaceCachePayload,
} from "./fixtures/owned-data";

test("createSyncRun serializes AWSJSON payloads before model.create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SyncRun: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return {
                data: {
                  id: "sync-1",
                  userId: "u1",
                  kind: "workspace-refresh",
                  status: "SYNCING",
                  startedAt: "2026-03-15T00:00:00.000Z",
                  detailsJson: { teamId: "123" },
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await createSyncRun({} as any, {
    userId: "u1",
    kind: "workspace-refresh",
    status: "SYNCING",
    startedAt: "2026-03-15T00:00:00.000Z",
    detailsJson: { teamId: "123" },
  });

  assert.deepStrictEqual(createInput, {
    userId: "u1",
    kind: "workspace-refresh",
    status: "SYNCING",
    startedAt: "2026-03-15T00:00:00.000Z",
    detailsJson: '{"teamId":"123"}',
    expiryKey: "EXPIRABLE",
    expiresAt: "2026-03-29T00:00:00.000Z",
  });
  assert.deepStrictEqual(record.detailsJson, { teamId: "123" });
});

test("createOpponentForecastJob serializes AWSJSON payloads before model.create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          OpponentForecastJob: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return {
                data: {
                  id: "forecast-1",
                  userId: "u1",
                  teamId: "200",
                  status: "QUEUED",
                  requestJson: { teamId: "200" },
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await createOpponentForecastJob({} as any, {
    id: "forecast-1",
    userId: "u1",
    teamId: "200",
    teamName: "Rivals",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: { teamId: "200" },
    resolvedContextJson: { recentGames: 8 },
    resultJson: null,
    error: null,
    modelVersion: null,
  });

  assert.deepStrictEqual(createInput, {
    id: "forecast-1",
    userId: "u1",
    teamId: "200",
    teamName: "Rivals",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: { teamId: "200" },
    resolvedContextJson: { recentGames: 8 },
    resultJson: null,
    error: null,
    modelVersion: null,
    requestedAt: createInput?.["requestedAt"],
    expiryKey: "EXPIRABLE",
    expiresAt: createInput?.["expiresAt"],
  });
  assert.deepStrictEqual(record.requestJson, { teamId: "200" });
});

test("createNextGameRecommendationJob serializes AWSJSON payloads before model.create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          NextGameRecommendationJob: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return {
                data: {
                  id: "recommendation-1",
                  userId: "u1",
                  matchId: "m-1",
                  opponentTeamId: "opp-1",
                  enthusiasm: 8,
                  switchPg: "PG",
                  switchSg: "SG",
                  switchSf: "SF",
                  switchPf: "PF",
                  switchC: "C",
                  status: "QUEUED",
                  requestJson: {
                    excludedPlayerIds: [],
                    input: {
                      excludedPlayerIds: [],
                      enthusiasm: 8,
                    },
                  },
                  progressJson: {
                    phaseKey: "QUEUED",
                    phaseIndex: 0,
                    phaseCount: 4,
                    summary: "Queued",
                    updatedAt: "2026-04-14T17:51:33.000Z",
                    completedPhases: [],
                  },
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await createNextGameRecommendationJob({} as any, {
    id: "recommendation-1",
    userId: "u1",
    matchId: "m-1",
    opponentTeamId: "opp-1",
    opponentTeamName: "Rivals",
    enthusiasm: 8,
    switchPg: "PG",
    switchSg: "SG",
    switchSf: "SF",
    switchPf: "PF",
    switchC: "C",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: {
      excludedPlayerIds: [],
      input: {
        excludedPlayerIds: [],
        enthusiasm: 8,
      },
    },
    progressJson: {
      phaseKey: "QUEUED",
      phaseIndex: 0,
      phaseCount: 4,
      summary: "Queued",
      updatedAt: "2026-04-14T17:51:33.000Z",
      completedPhases: [],
    },
    resultJson: {
      biggestWinPlan: {
        offense: "Base Offense",
      },
    },
    error: null,
    executionArn: null,
  });

  assert.deepStrictEqual(createInput, {
    id: "recommendation-1",
    userId: "u1",
    matchId: "m-1",
    opponentTeamId: "opp-1",
    opponentTeamName: "Rivals",
    enthusiasm: 8,
    switchPg: "PG",
    switchSg: "SG",
    switchSf: "SF",
    switchPf: "PF",
    switchC: "C",
    status: "QUEUED",
    startedAt: null,
    completedAt: null,
    requestJson: {
      excludedPlayerIds: [],
      input: {
        excludedPlayerIds: [],
        enthusiasm: 8,
      },
    },
    progressJson: {
      phaseKey: "QUEUED",
      phaseIndex: 0,
      phaseCount: 4,
      summary: "Queued",
      updatedAt: "2026-04-14T17:51:33.000Z",
      completedPhases: [],
    },
    resultJson: {
      biggestWinPlan: {
        offense: "Base Offense",
      },
    },
    error: null,
    executionArn: null,
    requestedAt: createInput?.["requestedAt"],
    expiryKey: "EXPIRABLE",
    expiresAt: createInput?.["expiresAt"],
  });
  assert.deepStrictEqual(record.requestJson, {
    excludedPlayerIds: [],
    input: {
      excludedPlayerIds: [],
      enthusiasm: 8,
    },
  });
  assert.deepStrictEqual(record.progressJson, {
    phaseKey: "QUEUED",
    phaseIndex: 0,
    phaseCount: 4,
    summary: "Queued",
    updatedAt: "2026-04-14T17:51:33.000Z",
    completedPhases: [],
  });
});

test("planner artifact upserts serialize planner AWSJSON payloads", async (t) => {
  const createdArtifacts: Record<string, unknown>[] = [];
  const createdRows: Record<string, unknown>[] = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          NextGamePlannerArtifact: {
            get: async () => ({ data: null }),
            create: async (input: Record<string, unknown>) => {
              createdArtifacts.push(input);
              return { data: { artifactKey: input.artifactKey } };
            },
          },
          NextGamePlannerArtifactRow: {
            get: async () => ({ data: null }),
            create: async (input: Record<string, unknown>) => {
              createdRows.push(input);
              return {
                data: {
                  artifactKey: input.artifactKey,
                  opponentPairId: input.opponentPairId,
                  viewId: input.viewId,
                },
              };
            },
          },
        },
      }) as any,
  );

  await upsertNextGamePlannerArtifact({} as any, {
    artifactKey: "artifact-1",
    userId: "u1",
    jobId: "job-1",
    matchId: "m-1",
    opponentTeamId: "opp-1",
    generatedAt: "2026-04-12T00:00:00.000Z",
    evaluatedScenariosJson: [{ scenarioId: "s1", label: "Base" }],
    ourPairsJson: [
      { pairId: "p1", offense: "Base Offense", defense: "Man to man" },
    ],
    opponentPairsJson: [
      { pairId: "p2", offense: "Motion", defense: "2-3 Zone" },
    ],
    expiryKey: "EXPIRABLE",
    expiresAt: "2026-04-26T00:00:00.000Z",
  });
  await upsertNextGamePlannerArtifactRows({} as any, [
    {
      artifactKey: "artifact-1",
      viewId: "expected",
      opponentPairId: "p2",
      userId: "u1",
      jobId: "job-1",
      rowOrder: 0,
      rowJson: {
        viewId: "expected",
        label: "Expected",
        opponentPairId: "p2",
        cells: [{ ourPairId: "p1", opponentPairId: "p2", available: true }],
      },
      expiryKey: "EXPIRABLE",
      expiresAt: "2026-04-26T00:00:00.000Z",
    },
  ]);

  assert.deepStrictEqual(createdArtifacts[0], {
    artifactKey: "artifact-1",
    userId: "u1",
    jobId: "job-1",
    matchId: "m-1",
    opponentTeamId: "opp-1",
    generatedAt: "2026-04-12T00:00:00.000Z",
    evaluatedScenariosJson: [{ scenarioId: "s1", label: "Base" }],
    ourPairsJson: [
      { pairId: "p1", offense: "Base Offense", defense: "Man to man" },
    ],
    opponentPairsJson: [
      { pairId: "p2", offense: "Motion", defense: "2-3 Zone" },
    ],
    expiryKey: "EXPIRABLE",
    expiresAt: "2026-04-26T00:00:00.000Z",
  });
  assert.deepStrictEqual(createdRows[0], {
    artifactKey: "artifact-1",
    viewId: "expected",
    opponentPairId: "p2",
    userId: "u1",
    jobId: "job-1",
    rowOrder: 0,
    rowJson: {
      viewId: "expected",
      label: "Expected",
      opponentPairId: "p2",
      cells: [{ ourPairId: "p1", opponentPairId: "p2", available: true }],
    },
    expiryKey: "EXPIRABLE",
    expiresAt: "2026-04-26T00:00:00.000Z",
  });
});

test("league season simulation artifacts serialize JSON payloads", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          LeagueSeasonSimulationArtifact: {
            get: async () => ({ data: null }),
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: input };
            },
          },
        },
      }) as any,
  );

  await upsertLeagueSeasonSimulationArtifact({} as any, {
    artifactKey: "context",
    artifactOrder: 0,
    artifactType: "CONTEXT",
    expiresAt: "2026-06-01T00:00:00.000Z",
    expiryKey: "EXPIRABLE",
    jobId: "job-1",
    payloadJson: {
      remainingGames: [{ matchId: "m-1" }],
      season: 72,
    } as any,
    userId: "user-1",
  });

  assert.deepStrictEqual(createInput, {
    artifactKey: "context",
    artifactOrder: 0,
    artifactType: "CONTEXT",
    expiresAt: "2026-06-01T00:00:00.000Z",
    expiryKey: "EXPIRABLE",
    jobId: "job-1",
    payloadJson: '{"remainingGames":[{"matchId":"m-1"}],"season":72}',
    userId: "user-1",
  });
});

test("updateSyncRun serializes AWSJSON payloads before model.update", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SyncRun: {
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: { id: "sync-1" } };
            },
          },
        },
      }) as any,
  );

  await updateSyncRun({} as any, {
    id: "sync-1",
    status: "SUCCEEDED",
    detailsJson: { nextOpponentTeamId: "opp-1" },
  });

  assert.deepStrictEqual(updateInput, {
    id: "sync-1",
    status: "SUCCEEDED",
    detailsJson: '{"nextOpponentTeamId":"opp-1"}',
  });
});

test("generic upserts serialize AWSJSON payloads before model.create", async (t) => {
  let getInput: Record<string, unknown> | null = null;
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          TrackedPlayer: {
            get: async (input: Record<string, unknown>) => {
              getInput = input;
              return { data: null };
            },
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { userId: "u1", playerId: "p1" } };
            },
          },
        },
      }) as any,
  );

  await upsertTrackedPlayer({} as any, {
    userId: "u1",
    playerId: "p1",
    teamId: "t1",
    fullName: "Prospect",
    profileJson: createStoredOwnedRosterPlayer(),
  });

  assert.deepStrictEqual(getInput, {
    userId: "u1",
    playerId: "p1",
  });
  assert.deepStrictEqual(createInput, {
    userId: "u1",
    playerId: "p1",
    teamId: "t1",
    fullName: "Prospect",
    profileJson: createStoredOwnedRosterPlayer(),
  });
});

test("upsertRivalsBackfill keeps failedSeasons as a typed array on create", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          RivalsBackfill: {
            get: async () => ({ data: null }),
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { ...input } };
            },
          },
        },
      }) as any,
  );

  await upsertRivalsBackfill({} as any, {
    completedAt: null,
    error: null,
    executionArn: null,
    failedSeasons: [69, 71],
    requestedAt: "2026-04-11T15:00:00.000Z",
    startedAt: null,
    status: "QUEUED",
    teamId: "t1",
    updatedAt: "2026-04-11T15:00:00.000Z",
    userId: "u1",
  });

  assert.deepStrictEqual(createInput, {
    completedAt: null,
    error: null,
    executionArn: null,
    failedSeasons: [69, 71],
    requestedAt: "2026-04-11T15:00:00.000Z",
    startedAt: null,
    status: "QUEUED",
    teamId: "t1",
    updatedAt: "2026-04-11T15:00:00.000Z",
    userId: "u1",
  });
});

test("upsertRivalsBackfill keeps failedSeasons as a typed array on update", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          RivalsBackfill: {
            get: async () => ({
              data: {
                teamId: "t1",
                userId: "u1",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: { ...input } };
            },
          },
        },
      }) as any,
  );

  await upsertRivalsBackfill({} as any, {
    completedAt: null,
    error: null,
    executionArn: null,
    failedSeasons: [70],
    requestedAt: "2026-04-11T15:00:00.000Z",
    startedAt: null,
    status: "FAILED",
    teamId: "t1",
    updatedAt: "2026-04-11T15:01:00.000Z",
    userId: "u1",
  });

  assert.deepStrictEqual(updateInput, {
    completedAt: null,
    error: null,
    executionArn: null,
    failedSeasons: [70],
    requestedAt: "2026-04-11T15:00:00.000Z",
    startedAt: null,
    status: "FAILED",
    teamId: "t1",
    updatedAt: "2026-04-11T15:01:00.000Z",
    userId: "u1",
  });
});

test("getRivalsBackfill normalizes missing failedSeasons to an empty array", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          RivalsBackfill: {
            get: async () => ({
              data: {
                requestedAt: "2026-04-11T15:00:00.000Z",
                status: "SUCCEEDED",
                teamId: "t1",
                updatedAt: "2026-04-11T15:01:00.000Z",
                userId: "u1",
              },
            }),
          },
        },
      }) as any,
  );

  const record = await getRivalsBackfill({} as any, "u1", "t1");

  assert.deepStrictEqual(record?.failedSeasons, []);
});

test("getRivalsBackfill preserves stored failedSeasons arrays", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          RivalsBackfill: {
            get: async () => ({
              data: {
                failedSeasons: [69, 71],
                requestedAt: "2026-04-11T15:00:00.000Z",
                status: "SUCCEEDED",
                teamId: "t1",
                updatedAt: "2026-04-11T15:01:00.000Z",
                userId: "u1",
              },
            }),
          },
        },
      }) as any,
  );

  const record = await getRivalsBackfill({} as any, "u1", "t1");

  assert.deepStrictEqual(record?.failedSeasons, [69, 71]);
});

test("upsertBbConnection preserves the explicit connection payload on create", async (t) => {
  let getInput: Record<string, unknown> | null = null;
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async (input: Record<string, unknown>) => {
              getInput = input;
              return { data: null };
            },
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { userId: "u1" } };
            },
          },
        },
      }) as any,
  );

  await upsertBbConnection({} as any, {
    userId: "u1",
    bbLoginName: "coach",
    status: "INVALID",
    connectedAt: null,
    lastValidatedAt: null,
    lastSyncAt: null,
  });

  assert.deepStrictEqual(getInput, { userId: "u1" });
  assert.ok(createInput);
  assert.equal(createInput["userId"], "u1");
  assert.equal(createInput["bbLoginName"], "coach");
  assert.equal(createInput["status"], "INVALID");
  assert.equal(createInput["connectedAt"], null);
  assert.equal(createInput["lastValidatedAt"], null);
  assert.equal(createInput["lastSyncAt"], null);
});

test("upsertBbConnection updates the existing record without adding refresh metadata", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async () => ({
              data: {
                userId: "u1",
                bbLoginName: "coach",
                status: "DISCONNECTED",
                connectedAt: "2026-03-15T00:00:00.000Z",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: { userId: "u1" } };
            },
          },
        },
      }) as any,
  );

  await upsertBbConnection({} as any, {
    userId: "u1",
    bbLoginName: "coach",
    status: "DISCONNECTED",
    connectedAt: null,
    lastValidatedAt: null,
    lastSyncAt: null,
  });

  assert.deepStrictEqual(updateInput, {
    userId: "u1",
    bbLoginName: "coach",
    status: "DISCONNECTED",
    connectedAt: null,
    lastValidatedAt: null,
    lastSyncAt: null,
  });
});

test("prepareModelInput preserves valid explicit BbConnection payloads", () => {
  const payload = repositoryTesting.prepareModelInput("BbConnection", {
    userId: "u1",
    bbLoginName: "coach",
    profileJson: createStoredTeamInfo({
      teamId: "29656",
      teamName: "Visionaries",
      league: {
        id: "1000",
        name: "NBBA",
      },
      country: {
        id: "1",
        name: "USA",
      },
    }),
    status: "CONNECTED",
    workspaceCacheJson: createWorkspaceCachePayload(),
  });

  assert.deepStrictEqual(payload, {
    userId: "u1",
    bbLoginName: "coach",
    profileJson: createStoredTeamInfo({
      teamId: "29656",
      teamName: "Visionaries",
      league: {
        id: "1000",
        name: "NBBA",
      },
      country: {
        id: "1",
        name: "USA",
      },
    }),
    status: "CONNECTED",
    workspaceCacheJson: createWorkspaceCachePayload(),
  });
});

test("prepareModelInput rejects unsupported nested keys for tracked-team summaries", () => {
  assert.throws(
    () =>
      repositoryTesting.prepareModelInput("TrackedTeam", {
        name: "Visionaries",
        summaryJson: createStoredTeamInfo({
          league: {
            id: "1000",
            name: "NBBA",
            attributes: {
              level: "D.II",
            },
          },
        }),
        teamId: "29656",
        userId: "u1",
      } as any),
    /TrackedTeam\.summaryJson.*unsupported key\(s\): attributes/,
  );
});

test("prepareModelInput rejects unsupported nested keys for owned BbConnection payloads", () => {
  assert.throws(
    () =>
      repositoryTesting.assertModelInputShape("BbConnection", {
        bbLoginName: "coach",
        profileJson: createStoredTeamInfo({
          country: {
            __typename: "NamedReference",
            id: "1",
            name: "USA",
          },
        }),
        status: "CONNECTED",
        userId: "u1",
      }),
    /BbConnection\.profileJson.*unsupported key\(s\): __typename/,
  );
});

test("upsertBbConnection rejects invalid owned payloads before model.update", async (t) => {
  let updateCalled = false;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async () => ({
              data: {
                userId: "u1",
              },
            }),
            update: async () => {
              updateCalled = true;
              return {
                data: {
                  userId: "u1",
                },
              };
            },
          },
        },
      }) as any,
  );

  await assert.rejects(
    () =>
      upsertBbConnection({} as any, {
        bbLoginName: "coach",
        profileJson: createStoredTeamInfo({
          league: {
            id: "1000",
            level: "D.II",
            name: "NBBA",
          },
        }),
        status: "CONNECTED",
        userId: "u1",
      } as any),
    /BbConnection\.profileJson.*unsupported key\(s\): level/,
  );

  assert.equal(updateCalled, false);
});

test("upsertBbConnection explains GraphQL drift when AppSync rejects a valid payload", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async () => ({
              data: {
                userId: "u1",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return {
                data: null,
                errors: [
                  {
                    message:
                      "The variables input contains a field that is not defined for input object type 'NamedReferenceInput'",
                  },
                ],
              };
            },
          },
        },
      }) as any,
  );

  await assert.rejects(
    () =>
      upsertBbConnection({} as any, {
        bbLoginName: "coach",
        profileJson: createStoredTeamInfo({
          league: {
            id: "1000",
            name: "NBBA",
          },
        }),
        status: "CONNECTED",
        userId: "u1",
        workspaceCacheJson: createWorkspaceCachePayload(),
      }),
    /NamedReferenceInput'.*passed local owned-contract validation.*owned-data\/contracts\.ts/,
  );
  assert.deepStrictEqual(
    updateInput?.profileJson,
    createStoredTeamInfo({
      league: {
        id: "1000",
        name: "NBBA",
      },
    }),
  );
});

test("getBbConnection returns JSON fields as plain objects", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async () => ({
              data: {
                userId: "u1",
                bbLoginName: "apiech",
                status: "CONNECTED",
                accessKeyLast4: "****1234",
                teamId: "123",
                teamName: "Buzz City",
                shortName: "BC",
                leagueId: "9",
                leagueName: "League",
                countryId: "1",
                countryName: "USA",
                connectedAt: "2026-03-15T00:00:00.000Z",
                lastValidatedAt: "2026-03-15T00:00:00.000Z",
                lastSyncAt: "2026-03-15T00:00:00.000Z",
                lastSyncError: null,
                profileJson: createStoredTeamInfo({
                  teamId: "123",
                  teamName: "Buzz City",
                }),
                workspaceCacheJson: createWorkspaceCachePayload({
                  home: {
                    connection: {
                      teamId: "123",
                      teamName: "Buzz City",
                    },
                    team: {
                      teamId: "123",
                      teamName: "Buzz City",
                    },
                  },
                  teamHub: {
                    team: {
                      teamId: "123",
                      teamName: "Buzz City",
                    },
                  },
                }),
              },
            }),
          },
        },
      }) as any,
  );

  const record = await getBbConnection({} as any, "u1");

  assert.ok(record);
  assert.deepStrictEqual(
    record.profileJson,
    createStoredTeamInfo({
      teamId: "123",
      teamName: "Buzz City",
    }),
  );
  assert.deepStrictEqual(
    record.workspaceCacheJson,
    createWorkspaceCachePayload({
      home: {
        connection: {
          teamId: "123",
          teamName: "Buzz City",
        },
        team: {
          teamId: "123",
          teamName: "Buzz City",
        },
      },
      teamHub: {
        team: {
          teamId: "123",
          teamName: "Buzz City",
        },
      },
    }),
  );
});

test("getBbConnection suppresses legacy workspace cache coercion errors when the record data is otherwise available", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          BbConnection: {
            get: async () => ({
              data: {
                userId: "u1",
                bbLoginName: "apiech",
                status: "CONNECTED",
                teamId: "123",
                workspaceCacheJson: null,
              },
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'ArenaWorkspace' within parent 'WorkspaceCachePayload' (/getBbConnection/workspaceCacheJson/arena)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getBbConnection({} as any, "u1");

  assert.deepStrictEqual(record, {
    userId: "u1",
    bbLoginName: "apiech",
    profileJson: null,
    status: "CONNECTED",
    teamId: "123",
    workspaceCacheJson: null,
  });
});

test("getGameDayRecap tolerates legacy requestJson qualityTier coercion errors", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          GameDayRecap: {
            get: async () => ({
              data: {
                userId: "u1",
                targetKey: "100#2026-03-15",
                leagueId: "100",
                leagueName: "Elite League",
                gameDate: "2026-03-15",
                season: null,
                status: "SUCCEEDED",
                requestedAt: "2026-03-15T23:00:00.000Z",
                requestJson: null,
              },
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'RecapQualityTier' within parent 'GameDayRecapStoredRequest' (/getGameDayRecap/requestJson/qualityTier)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getGameDayRecap({} as any, "u1", "100#2026-03-15");

  assert.deepStrictEqual(record?.requestJson, {
    approach: "LEGACY",
    gameDate: "2026-03-15",
    interviewIntensity: "pg13",
    leagueId: "100",
    modelJudgeEnabled: false,
    mode: "FULL_SLATE",
    qualityTier: "standard",
  });
});

test("getGameDayRecap returns null when a legacy qualityTier error comes back without data", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          GameDayRecap: {
            get: async () => ({
              data: null,
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'RecapQualityTier' within parent 'GameDayRecapStoredRequest' (/getGameDayRecap/requestJson/qualityTier)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getGameDayRecap({} as any, "u1", "100#2026-03-15");

  assert.equal(record, null);
});

test("getLeagueGameDayRecap tolerates legacy requestJson qualityTier coercion errors", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          LeagueGameDayRecap: {
            get: async () => ({
              data: {
                userId: "u1",
                targetKey: "100#64#gameday-6",
                leagueId: "100",
                leagueName: "Elite League",
                gameDayNumber: 6,
                season: 64,
                status: "SUCCEEDED",
                requestedAt: "2026-03-15T23:00:00.000Z",
                requestJson: null,
              },
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'RecapQualityTier' within parent 'LeagueGameDayRecapStoredRequest' (/getLeagueGameDayRecap/requestJson/qualityTier)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getLeagueGameDayRecap(
    {} as any,
    "u1",
    "100#64#gameday-6",
  );

  assert.deepStrictEqual(record?.requestJson, {
    approach: "LEGACY",
    gameDayNumber: 6,
    interviewIntensity: "pg13",
    leagueId: "100",
    modelJudgeEnabled: false,
    mode: "LEAGUE_GAME_DAY",
    qualityTier: "standard",
    season: 64,
  });
});

test("getLeagueGameDayRecap returns null when a legacy qualityTier error comes back without data", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          LeagueGameDayRecap: {
            get: async () => ({
              data: null,
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'RecapQualityTier' within parent 'LeagueGameDayRecapStoredRequest' (/getLeagueGameDayRecap/requestJson/qualityTier)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getLeagueGameDayRecap(
    {} as any,
    "u1",
    "100#64#gameday-6",
  );

  assert.equal(record, null);
});

test("getSingleGameSummary tolerates legacy requestJson qualityTier coercion errors", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SingleGameSummary: {
            get: async () => ({
              data: {
                userId: "u1",
                targetKey: "137828772",
                matchId: "137828772",
                gameDate: "2026-03-15",
                leagueId: "100",
                leagueName: "Elite League",
                season: 64,
                status: "SUCCEEDED",
                requestedAt: "2026-03-15T23:00:00.000Z",
                requestJson: null,
              },
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'RecapQualityTier' within parent 'SingleGameSummaryStoredRequest' (/getSingleGameSummary/requestJson/qualityTier)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getSingleGameSummary({} as any, "u1", "137828772");

  assert.deepStrictEqual(record?.requestJson, {
    approach: "LEGACY",
    interviewIntensity: "pg13",
    matchId: "137828772",
    modelJudgeEnabled: false,
    mode: "SINGLE_GAME",
    qualityTier: "standard",
    winnerInterviewPersonalityType: null,
    loserInterviewPersonalityType: null,
  });
});

test("upsertSingleGameSummary and getSingleGameSummary round-trip interview overrides", async (t) => {
  let storedRecord: Record<string, unknown> | null = null;
  let createdInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SingleGameSummary: {
            get: async () => ({
              data: storedRecord,
            }),
            create: async (input: Record<string, unknown>) => {
              createdInput = input;
              storedRecord = {
                ...input,
              };
              return {
                data: storedRecord,
              };
            },
            update: async (input: Record<string, unknown>) => {
              storedRecord = {
                ...(storedRecord ?? {}),
                ...input,
              };
              return {
                data: storedRecord,
              };
            },
          },
        },
      }) as any,
  );

  await upsertSingleGameSummary({} as any, {
    gameDate: "2026-03-15",
    leagueId: "100",
    leagueName: "Elite League",
    matchId: "137828772",
    requestJson: {
      approach: "FACT_LIBRARY_FIRST",
      interviewIntensity: "full_heat",
      loserInterviewPersonalityType: "rambling",
      matchId: "137828772",
      modelJudgeEnabled: true,
      mode: "SINGLE_GAME",
      qualityTier: "premium",
      winnerInterviewPersonalityType: "reflective",
    },
    requestedAt: "2026-03-15T23:00:00.000Z",
    season: 64,
    status: "QUEUED",
    targetKey:
      "137828772#fact-library-first#quality-premium#intensity-full-heat#winner-voice-reflective#loser-voice-rambling#model-judge",
    userId: "u1",
  } as any);

  assert.deepStrictEqual(createdInput?.requestJson, {
    approach: "FACT_LIBRARY_FIRST",
    interviewIntensity: "full_heat",
    loserInterviewPersonalityType: "rambling",
    matchId: "137828772",
    modelJudgeEnabled: true,
    mode: "SINGLE_GAME",
    qualityTier: "premium",
    winnerInterviewPersonalityType: "reflective",
  });

  const record = await getSingleGameSummary(
    {} as any,
    "u1",
    "137828772#fact-library-first#quality-premium#intensity-full-heat#winner-voice-reflective#loser-voice-rambling#model-judge",
  );

  assert.deepStrictEqual(record?.requestJson, {
    approach: "FACT_LIBRARY_FIRST",
    interviewIntensity: "full_heat",
    loserInterviewPersonalityType: "rambling",
    matchId: "137828772",
    modelJudgeEnabled: true,
    mode: "SINGLE_GAME",
    qualityTier: "premium",
    winnerInterviewPersonalityType: "reflective",
  });
});

test("getSingleGameSummary returns null when a legacy qualityTier error comes back without data", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SingleGameSummary: {
            get: async () => ({
              data: null,
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'RecapQualityTier' within parent 'SingleGameSummaryStoredRequest' (/getSingleGameSummary/requestJson/qualityTier)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getSingleGameSummary({} as any, "u1", "137828772");

  assert.equal(record, null);
});

test("listPlayerSkillObservations queries the user history index with a player prefix", async (t) => {
  const queryCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PlayerSkillObservation: {
            listPlayerSkillObservationsByUserIdAndPlayerCapturedAtKey: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              queryCalls.push({ input, options });
              if (options?.nextToken === "page-2") {
                return {
                  data: [
                    {
                      userId: "u1",
                      playerId: "p1",
                      capturedAt: "2026-03-10T00:00:00.000Z",
                      playerCapturedAtKey: "p1#2026-03-10T00:00:00.000Z",
                      fullName: "Prospect Player",
                      teamId: "t1",
                    },
                  ],
                  nextToken: null,
                };
              }

              return {
                data: [
                  {
                    userId: "u1",
                    playerId: "p1",
                    capturedAt: "2026-03-17T00:00:00.000Z",
                    playerCapturedAtKey: "p1#2026-03-17T00:00:00.000Z",
                    fullName: "Prospect Player",
                    teamId: "t1",
                  },
                ],
                nextToken: "page-2",
              };
            },
          },
        },
      }) as any,
  );

  const records = await listPlayerSkillObservations({} as any, "u1", "p1", 2);

  assert.deepStrictEqual(queryCalls, [
    {
      input: {
        userId: "u1",
        playerCapturedAtKey: { beginsWith: "p1#" },
      },
      options: {
        limit: 2,
        nextToken: null,
        sortDirection: "DESC",
      },
    },
    {
      input: {
        userId: "u1",
        playerCapturedAtKey: { beginsWith: "p1#" },
      },
      options: {
        limit: 1,
        nextToken: "page-2",
        sortDirection: "DESC",
      },
    },
  ]);
  assert.deepStrictEqual(
    records.map((record) => record.capturedAt),
    ["2026-03-17T00:00:00.000Z", "2026-03-10T00:00:00.000Z"],
  );
});

test("expired sync run helper queries the expiry index", async (t) => {
  const syncRunCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          SyncRun: {
            listSyncRunsByExpiryKeyAndExpiresAt: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              syncRunCalls.push({ input, options });
              return {
                data: [
                  {
                    id: "sync-1",
                    userId: "u1",
                    kind: "workspace-refresh",
                    status: "FAILED",
                    startedAt: "2026-03-01T00:00:00.000Z",
                  },
                ],
                nextToken: "next-sync-page",
              };
            },
          },
        },
      }) as any,
  );

  const syncRunPage = await listExpiredSyncRuns(
    {} as any,
    "2026-03-15T12:00:00.000Z",
    { limit: 100 },
  );

  assert.deepStrictEqual(syncRunCalls, [
    {
      input: {
        expiryKey: "EXPIRABLE",
        expiresAt: { lt: "2026-03-15T12:00:00.000Z" },
      },
      options: {
        limit: 100,
        sortDirection: "ASC",
      },
    },
  ]);
  assert.equal(syncRunPage.nextToken, "next-sync-page");
  assert.equal(syncRunPage.records[0]?.id, "sync-1");
});

test("upsertPredictionJob stores typed prediction fields without AWSJSON encoding", async (t) => {
  let createInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionJob: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { ...input } };
            },
            get: async () => ({ data: null }),
            update: async () => {
              throw new Error("PredictionJob.update should not be called");
            },
          },
        },
      }) as any,
  );

  await upsertPredictionJob({} as any, {
    away_gdp_focus: "N/A",
    away_gdp_pace: "N/A",
    away_insideDefense: 7,
    away_insideScoring: 7,
    away_offensiveFlow: 7,
    away_outsideDefense: 7,
    away_outsideScoring: 7,
    away_rebounding: 7,
    awayScore: null,
    effortDelta: 0,
    error: null,
    executionArn: null,
    home_gdp_focus: "N/A",
    home_gdp_pace: "N/A",
    home_insideDefense: 8,
    home_insideScoring: 8,
    home_offensiveFlow: 8,
    home_outsideDefense: 8,
    home_outsideScoring: 8,
    home_rebounding: 8,
    homeScore: null,
    modelKey: "catboost",
    modelVersion: null,
    neutral: "0",
    pointDiff: null,
    requestId: "request-1",
    requestedAt: "2026-03-15T00:00:00.000Z",
    status: "QUEUED",
    userId: "u1",
  });

  assert.ok(createInput);
  assert.equal(createInput.away_gdp_focus, "N/A");
  assert.equal(createInput.home_outsideScoring, 8);
  assert.equal(createInput.executionArn, null);
  assert.equal(createInput.homeScore, null);
  assert.equal(createInput.modelKey, "catboost");
  assert.equal(createInput.pointDiff, null);
});

test("getPredictionJob returns the typed persisted prediction record", async (t) => {
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionJob: {
            get: async () => ({
              data: {
                away_gdp_focus: "N/A",
                away_gdp_pace: "N/A",
                away_insideDefense: 7,
                away_insideScoring: 7,
                away_offensiveFlow: 7,
                away_outsideDefense: 7,
                away_outsideScoring: 7,
                away_rebounding: 7,
                effortDelta: 0,
                error: null,
                executionArn: null,
                home_gdp_focus: "N/A",
                home_gdp_pace: "N/A",
                home_insideDefense: 8,
                home_insideScoring: 8,
                home_offensiveFlow: 8,
                home_outsideDefense: 8,
                home_outsideScoring: 8,
                home_rebounding: 8,
                modelKey: "xgb",
                neutral: "0",
                modelVersion: "bundle-v1",
                requestId: "request-1",
                requestedAt: "2026-03-15T00:00:00.000Z",
                awayScore: 94.8,
                homeScore: 101.3,
                pointDiff: 6.5,
                status: "SUCCEEDED",
                userId: "u1",
              },
            }),
          },
        },
      }) as any,
  );

  const record = await getPredictionJob({} as any, "u1");

  assert.ok(record);
  assert.equal(record.home_outsideScoring, 8);
  assert.equal(record.away_gdp_focus, "N/A");
  assert.equal(record.homeScore, 101.3);
  assert.equal(record.modelKey, "xgb");
  assert.equal(record.pointDiff, 6.5);
});

test("getMatchBoxscore treats legacy AppSync boxscore coercion failures as cache misses", async (t) => {
  const warnings: Array<{
    details: Record<string, unknown>;
    message: string;
  }> = [];

  t.mock.method(console, "warn", (message: string, details: Record<string, unknown>) => {
    warnings.push({ message, details });
  });
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          MatchBoxscore: {
            get: async () => ({
              data: null,
              errors: [
                {
                  message:
                    "Can't resolve value (/getMatchBoxscore/boxscoreJson/homeTeam/teamTotals) : type mismatch error, expected type LIST",
                },
                {
                  message:
                    "Cannot return null for non-nullable type: 'Boolean' within parent 'MatchBoxscorePlayerLine' (/getMatchBoxscore/boxscoreJson/homeTeam/players[0]/isStarter)",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  const record = await getMatchBoxscore({} as any, "u1", "m-legacy");

  assert.equal(record, null);
  assert.equal(warnings.length, 1);
  const warning = warnings[0];
  assert.ok(warning);
  assert.match(
    warning.message,
    /Treating unreadable MatchBoxscore cache row as a cache miss/,
  );
  assert.equal(warning.details.userId, "u1");
  assert.equal(warning.details.matchId, "m-legacy");
  assert.match(
    String(warning.details.errorMessage),
    /load match boxscore failed:/,
  );
});

test("getMatchBoxscore rethrows unrelated model read failures", async (t) => {
  const warnings: Array<Record<string, unknown>> = [];

  t.mock.method(console, "warn", (_message: string, details: Record<string, unknown>) => {
    warnings.push(details);
  });
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          MatchBoxscore: {
            get: async () => ({
              data: null,
              errors: [
                {
                  message: "AccessDenied: user is not authorized to read MatchBoxscore",
                },
              ],
            }),
          },
        },
      }) as any,
  );

  await assert.rejects(
    () => getMatchBoxscore({} as any, "u1", "m-1"),
    /load match boxscore failed: AccessDenied/,
  );
  assert.deepStrictEqual(warnings, []);
});

test("upsertMatchBoxscore overwrites unreadable legacy rows instead of failing the refresh path", async (t) => {
  const warnings: Array<{
    details: Record<string, unknown>;
    message: string;
  }> = [];
  const updateInputs: Array<Record<string, unknown>> = [];

  t.mock.method(console, "warn", (message: string, details: Record<string, unknown>) => {
    warnings.push({ message, details });
  });
  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          MatchBoxscore: {
            get: async () => ({
              data: null,
              errors: [
                {
                  message:
                    "Cannot return null for non-nullable type: 'String' within parent 'StoredMatchBoxscore' (/getMatchBoxscore/boxscoreJson/source)",
                },
              ],
            }),
            update: async (input: Record<string, unknown>) => {
              updateInputs.push(input);
              return { data: input };
            },
            create: async () => {
              throw new Error("MatchBoxscore.create should not be called");
            },
          },
        },
      }) as any,
  );

  await upsertMatchBoxscore({} as any, {
    userId: "u1",
    matchId: "m-legacy",
    fetchedAt: "2026-04-14T00:00:00.000Z",
    boxscoreJson: {
      matchId: "m-legacy",
      source: "WORKSPACE_CACHE",
      homeTeam: null,
      awayTeam: null,
      context: null,
    } as any,
  });

  assert.equal(updateInputs.length, 1);
  const updateInput = updateInputs[0];
  assert.ok(updateInput);
  assert.equal(updateInput.userId, "u1");
  assert.equal(updateInput.matchId, "m-legacy");
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0]?.message ?? "",
    /Overwriting unreadable MatchBoxscore cache row during upsert/,
  );
});

test("prediction grid cells are stored and read as typed rows", async (t) => {
  const createInputs: Array<Record<string, unknown>> = [];
  const listCalls: Array<{
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionGridCell: {
            create: async (input: Record<string, unknown>) => {
              createInputs.push(input);
              return { data: input };
            },
            get: async () => ({ data: null }),
            listPredictionGridCellsByUserIdAndRequestId: async (
              input: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              listCalls.push({ input, options });
              return {
                data: [
                  {
                    awayDefense: "ManToMan",
                    awayScore: 94.8,
                    homeOffense: "Base",
                    homeScore: 101.3,
                    pointDiff: 6.5,
                    requestId: "request-1",
                    userId: "u1",
                  },
                ],
              };
            },
            update: async () => {
              throw new Error("PredictionGridCell.update should not be called");
            },
          },
        },
      }) as any,
  );

  await upsertPredictionGridCells({} as any, [
    {
      awayDefense: "ManToMan",
      awayScore: 94.8,
      homeOffense: "Base",
      homeScore: 101.3,
      pointDiff: 6.5,
      requestId: "request-1",
      userId: "u1",
    },
  ]);
  const rows = await listPredictionGridCellsByUserAndRequestId(
    {} as any,
    "u1",
    "request-1",
  );

  assert.deepStrictEqual(createInputs[0], {
    awayDefense: "ManToMan",
    awayScore: 94.8,
    homeOffense: "Base",
    homeScore: 101.3,
    pointDiff: 6.5,
    requestId: "request-1",
    userId: "u1",
  });
  assert.deepStrictEqual(listCalls, [
    {
      input: {
        requestId: { eq: "request-1" },
        userId: "u1",
      },
      options: {
        limit: 100,
        nextToken: null,
        sortDirection: "ASC",
      },
    },
  ]);
  assert.deepStrictEqual(rows, [
    {
      awayDefense: "ManToMan",
      awayScore: 94.8,
      homeOffense: "Base",
      homeScore: 101.3,
      pointDiff: 6.5,
      requestId: "request-1",
      userId: "u1",
    },
  ]);
});

test("updatePredictionJobIfRequestMatches ignores stale completions", async (t) => {
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          PredictionJob: {
            create: async () => {
              throw new Error("PredictionJob.create should not be called");
            },
            get: async () => ({
              data: {
                requestId: "current-request",
                status: "QUEUED",
                userId: "u1",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: input };
            },
          },
        },
      }) as any,
  );

  const updated = await updatePredictionJobIfRequestMatches({} as any, {
    requestId: "stale-request",
    status: "SUCCEEDED",
    userId: "u1",
  });

  assert.equal(updated, false);
  assert.equal(updateInput, null);
});

test("getUserPreference loads the stored account theme", async (t) => {
  let getInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          UserPreference: {
            get: async (input: Record<string, unknown>) => {
              getInput = input;
              return {
                data: {
                  userId: "u1",
                  themeId: "arena",
                },
              };
            },
          },
        },
      }) as any,
  );

  const record = await getUserPreference({} as any, "u1");

  assert.deepStrictEqual(getInput, { userId: "u1" });
  assert.deepStrictEqual(record, {
    userId: "u1",
    themeId: "arena",
  });
});

test("upsertUserPreference creates a preference when one does not exist", async (t) => {
  let createInput: Record<string, unknown> | null = null;
  let updateCalled = false;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          UserPreference: {
            create: async (input: Record<string, unknown>) => {
              createInput = input;
              return { data: { userId: "u1", themeId: "nightfall" } };
            },
            get: async () => ({ data: null }),
            update: async () => {
              updateCalled = true;
              return { data: { userId: "u1", themeId: "nightfall" } };
            },
          },
        },
      }) as any,
  );

  await upsertUserPreference({} as any, {
    userId: "u1",
    themeId: "nightfall",
  });

  assert.equal(updateCalled, false);
  assert.deepStrictEqual(createInput, {
    userId: "u1",
    themeId: "nightfall",
  });
});

test("upsertUserPreference updates an existing preference", async (t) => {
  let createCalled = false;
  let updateInput: Record<string, unknown> | null = null;

  t.mock.method(
    repositoryTesting.runtime,
    "getClient",
    async () =>
      ({
        models: {
          UserPreference: {
            create: async () => {
              createCalled = true;
              return { data: { userId: "u1", themeId: "clubhouse" } };
            },
            get: async () => ({
              data: {
                userId: "u1",
                themeId: "arena",
              },
            }),
            update: async (input: Record<string, unknown>) => {
              updateInput = input;
              return { data: { userId: "u1", themeId: "clubhouse" } };
            },
          },
        },
      }) as any,
  );

  await upsertUserPreference({} as any, {
    userId: "u1",
    themeId: "clubhouse",
  });

  assert.equal(createCalled, false);
  assert.deepStrictEqual(updateInput, {
    userId: "u1",
    themeId: "clubhouse",
  });
});
