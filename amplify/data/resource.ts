import {
  a,
  defineData,
  defineFunction,
  secret,
  type ClientSchema,
} from "@aws-amplify/backend";

import { getAccessibleMatch } from "../get-accessible-match/resource";
import { getAccessiblePlayByPlay } from "../get-accessible-play-by-play/resource";
import { getMatchBoxscoreDetails } from "../get-match-boxscore-details/resource";
import { listAccessibleMatches } from "../list-accessible-matches/resource";
import { predictionSubmit } from "../prediction-submit/resource";
import { predictionWorker } from "../prediction-worker/resource";

const secureFunctionEnvironment = {
  BB_CONNECTION_ENCRYPTION_SECRET: secret("BB_CONNECTION_ENCRYPTION_SECRET"),
};

export const connectBbAccount = defineFunction({
  resourceGroupName: "data",
  name: "connect-bb-account",
  entry: "./connect-bb-account/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const disconnectBbAccount = defineFunction({
  resourceGroupName: "data",
  name: "disconnect-bb-account",
  entry: "./disconnect-bb-account/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const refreshWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "refresh-workspace",
  entry: "./refresh-workspace/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getHomeWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-home-workspace",
  entry: "./get-home-workspace/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getTeamHub = defineFunction({
  resourceGroupName: "data",
  name: "get-team-hub",
  entry: "./get-team-hub/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getScoutWorkspace = defineFunction({
  resourceGroupName: "data",
  name: "get-scout-workspace",
  entry: "./get-scout-workspace/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getLeagueIntel = defineFunction({
  resourceGroupName: "data",
  name: "get-league-intel",
  entry: "./get-league-intel/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

export const getPlayerLab = defineFunction({
  resourceGroupName: "data",
  name: "get-player-lab",
  entry: "./get-player-lab/handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

const getPlayerTrend = defineFunction({
  resourceGroupName: "data",
  name: "get-player-trend",
  entry: "./get-player-trend/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const getLineupPlan = defineFunction({
  resourceGroupName: "data",
  name: "get-lineup-plan",
  entry: "./get-lineup-plan/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const saveLineupScenario = defineFunction({
  resourceGroupName: "data",
  name: "save-lineup-scenario",
  entry: "./save-lineup-scenario/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const getSalaryProjection = defineFunction({
  resourceGroupName: "data",
  name: "get-salary-projection",
  entry: "./get-salary-projection/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const generateSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "generate-shared-player-card",
  entry: "./generate-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const revokeSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "revoke-shared-player-card",
  entry: "./revoke-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

const lookupSharedPlayerCard = defineFunction({
  resourceGroupName: "data",
  name: "lookup-shared-player-card",
  entry: "./lookup-shared-player-card/handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: secureFunctionEnvironment,
});

export const refreshBbWorkspaces = defineFunction({
  resourceGroupName: "data",
  name: "refresh-bb-workspaces",
  entry: "./refresh-bb-workspaces/handler.ts",
  timeoutSeconds: 300,
  memoryMB: 1024,
  environment: secureFunctionEnvironment,
});

const dataFunctions = [
  connectBbAccount,
  disconnectBbAccount,
  refreshWorkspace,
  getHomeWorkspace,
  getTeamHub,
  getScoutWorkspace,
  getLeagueIntel,
  getPlayerLab,
  getPlayerTrend,
  getLineupPlan,
  saveLineupScenario,
  getSalaryProjection,
  listAccessibleMatches,
  getAccessibleMatch,
  getAccessiblePlayByPlay,
  getMatchBoxscoreDetails,
  generateSharedPlayerCard,
  revokeSharedPlayerCard,
  lookupSharedPlayerCard,
  refreshBbWorkspaces,
  predictionSubmit,
  predictionWorker,
];

const schema = a
  .schema({
    ConnectionStatus: a.enum([
      "UNSET",
      "CONNECTED",
      "INVALID",
      "ERROR",
      "DISCONNECTED",
    ]),

    SyncStatus: a.enum(["IDLE", "SYNCING", "SUCCEEDED", "FAILED"]),

    PredictionJobStatus: a.enum([
      "QUEUED",
      "RESOLVING_INPUT",
      "INVOKING_MODEL",
      "SUCCEEDED",
      "FAILED",
    ]),

    PredictionRequestMode: a.enum(["MANUAL", "CONNECTED"]),

    MatchIngestStatus: a.enum(["PENDING", "PARTIAL", "SUCCEEDED", "FAILED"]),

    WorkspaceResponse: a.customType({
      status: a.string().required(),
      syncedAt: a.datetime(),
      payload: a.json(),
      error: a.string(),
    }),

    ConnectionResult: a.customType({
      bbLoginName: a.string().required(),
      status: a.ref("ConnectionStatus").required(),
      accessKeyLast4: a.string(),
      teamId: a.string(),
      teamName: a.string(),
      leagueId: a.string(),
      leagueName: a.string(),
      countryId: a.string(),
      countryName: a.string(),
      connectedAt: a.datetime(),
      lastValidatedAt: a.datetime(),
      lastSyncAt: a.datetime(),
      lastSyncError: a.string(),
    }),

    SharedPlayerCardResult: a.customType({
      shareToken: a.string().required(),
      shareUrl: a.string(),
      title: a.string(),
      note: a.string(),
      expiresAt: a.datetime(),
      revokedAt: a.datetime(),
      payload: a.json(),
    }),

    PredictionJobSubmitResult: a.customType({
      jobId: a.string().required(),
    }),

    JsonLookupResponse: a.customType({
      status: a.string().required(),
      payload: a.json(),
      error: a.string(),
    }),

    LineupPlan: a.customType({
      generatedAt: a.datetime().required(),
      recommendedStarters: a.json().required(),
      benchOrder: a.json().required(),
      minuteTargets: a.json().required(),
      rotationNotes: a.json(),
      matchupRationale: a.json(),
      injuryAlerts: a.json(),
      confidence: a.float().required(),
    }),

    LineupScenario: a.customType({
      scenarioId: a.string().required(),
      name: a.string().required(),
      savedAt: a.datetime().required(),
      starters: a.json().required(),
      minuteTargets: a.json().required(),
      note: a.string(),
    }),

    SalaryProjection: a.customType({
      playerId: a.string().required(),
      fullName: a.string().required(),
      bestPosition: a.string(),
      nationalityName: a.string(),
      currentSalary: a.integer(),
      projectedSalary: a.integer(),
      weeklyDelta: a.integer(),
      trend: a.string().required(),
      isFlagTarget: a.boolean().required(),
      flagReason: a.string(),
    }),

    BbConnection: a
      .model({
        userId: a.string().required(),
        bbLoginName: a.string().required(),
        status: a.ref("ConnectionStatus").required(),
        accessKeyLast4: a.string(),
        teamId: a.string(),
        teamName: a.string(),
        shortName: a.string(),
        leagueId: a.string(),
        leagueName: a.string(),
        countryId: a.string(),
        countryName: a.string(),
        connectedAt: a.datetime(),
        lastValidatedAt: a.datetime(),
        lastSyncAt: a.datetime(),
        lastSyncError: a.string(),
        profileJson: a.json(),
        workspaceCacheJson: a.json(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    BbCredential: a
      .model({
        userId: a.string().required(),
        cipherText: a.string().required(),
        iv: a.string().required(),
        authTag: a.string().required(),
        algorithm: a.string().required(),
      })
      .identifier(["userId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedTeam: a
      .model({
        userId: a.string().required(),
        teamId: a.string().required(),
        name: a.string().required(),
        shortName: a.string(),
        leagueId: a.string(),
        leagueName: a.string(),
        countryId: a.string(),
        countryName: a.string(),
        arenaName: a.string(),
        rivalId: a.string(),
        isPrimary: a.boolean(),
        summaryJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "teamId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedPlayer: a
      .model({
        userId: a.string().required(),
        playerId: a.string().required(),
        teamId: a.string().required(),
        teamName: a.string(),
        firstName: a.string(),
        lastName: a.string(),
        fullName: a.string().required(),
        bestPosition: a.string(),
        salary: a.integer(),
        age: a.integer(),
        height: a.integer(),
        nationalityName: a.string(),
        gameShape: a.string(),
        dmi: a.integer(),
        injuryWeeks: a.integer(),
        profileJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "playerId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    TrackedMatch: a
      .model({
        userId: a.string().required(),
        matchId: a.string().required(),
        teamId: a.string().required(),
        opponentTeamId: a.string(),
        opponentTeamName: a.string(),
        type: a.string(),
        season: a.integer(),
        startTime: a.datetime(),
        isHome: a.boolean(),
        isNeutral: a.boolean(),
        teamScore: a.integer(),
        opponentScore: a.integer(),
        outcome: a.string(),
        matchJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "matchId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    MatchBoxscore: a
      .model({
        userId: a.string().required(),
        matchId: a.string().required(),
        teamId: a.string().required(),
        opponentTeamId: a.string(),
        opponentTeamName: a.string(),
        offStrategy: a.string(),
        defStrategy: a.string(),
        opponentOffStrategy: a.string(),
        opponentDefStrategy: a.string(),
        teamRatingsJson: a.json(),
        opponentRatingsJson: a.json(),
        teamEfficiencyJson: a.json(),
        opponentEfficiencyJson: a.json(),
        boxscoreJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "matchId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    LeagueStanding: a
      .model({
        userId: a.string().required(),
        season: a.integer().required(),
        teamId: a.string().required(),
        leagueId: a.string(),
        leagueName: a.string(),
        conferenceIndex: a.integer(),
        teamName: a.string(),
        wins: a.integer(),
        losses: a.integer(),
        pf: a.integer(),
        pa: a.integer(),
        isBot: a.boolean(),
        standingJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "season", "teamId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    WeeklyPlayerSnapshot: a
      .model({
        userId: a.string().required(),
        playerId: a.string().required(),
        weekKey: a.string().required(),
        teamId: a.string().required(),
        gameShape: a.string(),
        dmi: a.integer(),
        injuryWeeks: a.integer(),
        salary: a.integer(),
        snapshotJson: a.json(),
        fetchedAt: a.datetime(),
      })
      .identifier(["userId", "playerId", "weekKey"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    SyncRun: a
      .model({
        userId: a.string().required(),
        kind: a.string().required(),
        status: a.ref("SyncStatus").required(),
        startedAt: a.datetime().required(),
        completedAt: a.datetime(),
        error: a.string(),
        detailsJson: a.json(),
      })
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    SharedPlayerCard: a
      .model({
        shareToken: a.string().required(),
        userId: a.string().required(),
        playerId: a.string().required(),
        title: a.string(),
        note: a.string(),
        expiresAt: a.datetime(),
        revokedAt: a.datetime(),
        payloadJson: a.json(),
      })
      .identifier(["shareToken"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    SavedLineupScenario: a
      .model({
        scenarioId: a.string().required(),
        userId: a.string().required(),
        name: a.string().required(),
        startersJson: a.json().required(),
        minuteTargetsJson: a.json().required(),
        note: a.string(),
        savedAt: a.datetime().required(),
      })
      .identifier(["scenarioId"])
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    PredictionJob: a
      .model({
        userId: a.string().required(),
        status: a.ref("PredictionJobStatus").required(),
        mode: a.ref("PredictionRequestMode").required(),
        request: a.json().required(),
        resolvedInputSnapshot: a.json(),
        result: a.json(),
        error: a.string(),
        modelVersion: a.string(),
      })
      .authorization((allow) => [allow.ownerDefinedIn("userId").to(["read"])]),

    connectBbAccount: a
      .mutation()
      .arguments({
        bbLoginName: a.string().required(),
        accessKey: a.string().required(),
      })
      .returns(a.ref("ConnectionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(connectBbAccount)),

    disconnectBbAccount: a
      .mutation()
      .returns(a.ref("ConnectionResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(disconnectBbAccount)),

    refreshWorkspace: a
      .mutation()
      .returns(a.ref("WorkspaceResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(refreshWorkspace)),

    getHomeWorkspace: a
      .query()
      .returns(a.ref("WorkspaceResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getHomeWorkspace)),

    getTeamHub: a
      .query()
      .returns(a.ref("WorkspaceResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getTeamHub)),

    getScoutWorkspace: a
      .query()
      .arguments({
        teamId: a.string(),
      })
      .returns(a.ref("WorkspaceResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getScoutWorkspace)),

    getLeagueIntel: a
      .query()
      .returns(a.ref("WorkspaceResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLeagueIntel)),

    getPlayerLab: a
      .query()
      .returns(a.ref("WorkspaceResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getPlayerLab)),

    getPlayerTrend: a
      .query()
      .arguments({
        playerId: a.string().required(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getPlayerTrend)),

    getLineupPlan: a
      .query()
      .returns(a.ref("LineupPlan"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getLineupPlan)),

    saveLineupScenario: a
      .mutation()
      .arguments({
        name: a.string().required(),
        starters: a.json().required(),
        minuteTargets: a.json().required(),
        note: a.string(),
      })
      .returns(a.ref("LineupScenario"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(saveLineupScenario)),

    getSalaryProjection: a
      .query()
      .arguments({
        playerId: a.string().required(),
      })
      .returns(a.ref("SalaryProjection"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getSalaryProjection)),

    getMatchBoxscoreDetails: a
      .query()
      .arguments({
        matchId: a.string().required(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getMatchBoxscoreDetails)),

    listAccessibleMatches: a
      .query()
      .arguments({
        teamId: a.string(),
        season: a.integer(),
        cursor: a.string(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(listAccessibleMatches)),

    getAccessibleMatch: a
      .query()
      .arguments({
        matchId: a.string().required(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getAccessibleMatch)),

    getAccessiblePlayByPlay: a
      .query()
      .arguments({
        matchId: a.string().required(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getAccessiblePlayByPlay)),

    generateSharedPlayerCard: a
      .mutation()
      .arguments({
        playerId: a.string().required(),
        title: a.string(),
        note: a.string(),
      })
      .returns(a.ref("SharedPlayerCardResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(generateSharedPlayerCard)),

    revokeSharedPlayerCard: a
      .mutation()
      .arguments({
        shareToken: a.string().required(),
      })
      .returns(a.ref("SharedPlayerCardResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(revokeSharedPlayerCard)),

    lookupSharedPlayerCard: a
      .query()
      .arguments({
        shareToken: a.string().required(),
      })
      .returns(a.ref("JsonLookupResponse"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(lookupSharedPlayerCard)),

    submitPredictionJob: a
      .mutation()
      .arguments({
        request: a.json().required(),
      })
      .returns(a.ref("PredictionJobSubmitResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(predictionSubmit)),
  })
  .authorization((allow) =>
    dataFunctions.map((resource) => allow.resource(resource).to(["query", "mutate"])),
  );

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
